package com.daemon.app.pendant

import android.content.Context
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.util.Log
import kotlinx.coroutines.*
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FileOutputStream
import java.io.RandomAccessFile
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlinx.coroutines.channels.Channel

/**
 * Accumulates PCM audio chunks from the pendant BLE audio stream,
 * saves as WAV on recording stop, and transcribes via Deepgram.
 *
 * Audio format: 16-bit signed PCM, 16kHz, mono.
 *
 * slice-e: pendant-stream recording is now CRASH-SAFE — each addChunk()
 * appends to a RandomAccessFile on disk, fsync'd every 5s, with a 30-min
 * auto-rotate. Bytes are queued through a single-thread coroutine channel
 * so the GATT callback thread is never blocked on file I/O. If the phone
 * crashes/dies mid-recording, at most ~5s of audio is lost AND the file
 * still has a valid (in-progress) WAV header — orphan rescan picks it up.
 */
class PendantAudioRecorder(
    private val context: Context,
    private val httpClient: OkHttpClient,
) {

    companion object {
        private const val TAG = "PendantAudio"
        private const val SAMPLE_RATE = 16000
        private const val BITS_PER_SAMPLE = 16
        private const val CHANNELS = 1
        private const val DEEPGRAM_URL = "https://api.deepgram.com/v1/listen?model=nova-3&smart_format=true"

        // slice-e: rotate every 30 minutes of audio.
        // bytes/sec = SAMPLE_RATE * CHANNELS * BITS_PER_SAMPLE/8 = 32000
        // 30 min cap = 32000 * 60 * 30 = 57_600_000 bytes
        private const val ROTATE_BYTES: Long = 57_600_000L
        // slice-e: fsync cadence.
        private const val SYNC_INTERVAL_MS: Long = 5_000L
    }

    interface Listener {
        fun onRecordingSaved(file: File, durationMs: Long)
        fun onTranscriptReady(file: File, transcript: String)
        fun onTranscriptError(file: File, error: String)
    }

    var listener: Listener? = null

    private val buffer = ByteArrayOutputStream()
    @Volatile var isRecording = false
        private set

    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())

    // ── Pendant-stream crash-safe recording state (slice-e) ────────────
    // The chunkChannel is the single-thread serializer for file I/O; the
    // GATT callback thread offers chunks and returns immediately. If the
    // queue ever overflows (capacity 256) we drop the oldest, never block.
    private var pendantWriterJob: Job? = null
    private var pendantChunkChannel: Channel<ByteArray>? = null
    @Volatile private var pendantRaf: RandomAccessFile? = null
    @Volatile private var pendantFile: File? = null
    @Volatile private var pendantPartIndex: Int = 0
    @Volatile private var pendantSessionTs: Long = 0
    @Volatile private var pendantBytesWritten: Long = 0
    @Volatile private var pendantPartBytes: Long = 0
    @Volatile private var pendantLastSyncMs: Long = 0
    @Volatile private var pendantStartMs: Long = 0
    @Volatile private var pendantStreamMode: Boolean = false

    /**
     * Start a pendant-stream recording session. Opens a WAV file with a
     * placeholder header; subsequent addChunk() calls append PCM bytes.
     * On stop or 30-min auto-rotate, the header is patched and the listener
     * fires onRecordingSaved.
     */
    fun startPendantStreamRecording(sessionTs: Long = System.currentTimeMillis()) {
        if (isRecording) return
        pendantSessionTs = sessionTs
        pendantPartIndex = 0
        pendantBytesWritten = 0
        pendantPartBytes = 0
        pendantLastSyncMs = System.currentTimeMillis()
        pendantStartMs = System.currentTimeMillis()
        pendantStreamMode = true
        isRecording = true
        if (!openNewPendantPart()) {
            Log.e(TAG, "[pendant] failed to open WAV file; aborting recording")
            isRecording = false
            pendantStreamMode = false
            return
        }
        // Conflated-style channel: drop oldest if writer falls behind, never
        // block the GATT thread. 256 chunks × ~512 bytes ≈ 130 KB headroom.
        val ch = Channel<ByteArray>(capacity = 256)
        pendantChunkChannel = ch
        pendantWriterJob = scope.launch {
            try {
                for (chunk in ch) {
                    writePendantChunkInternal(chunk)
                }
            } catch (e: Exception) {
                Log.e(TAG, "[pendant] writer loop error: ${e.message}")
            }
        }
        Log.i(TAG, "[pendant] recording started ts=$pendantSessionTs file=${pendantFile?.name}")
    }

    fun startRecording() {
        // Legacy entry point — preserved for callers expecting in-memory mode.
        // Pendant-stream callers should use startPendantStreamRecording instead.
        buffer.reset()
        isRecording = true
        Log.d(TAG, "Recording started (pendant BLE chunks, in-memory legacy)")
    }

    fun addChunk(data: ByteArray) {
        if (!isRecording) return
        if (pendantStreamMode) {
            // Non-blocking offer — drop oldest if queue full to keep GATT
            // callback thread snappy.
            val ch = pendantChunkChannel ?: return
            val result = ch.trySend(data)
            if (result.isFailure) {
                // Channel full (very unlikely). Try once more synchronously
                // by draining the head; if even that fails we drop this chunk
                // (better than blocking BLE).
                ch.tryReceive()
                ch.trySend(data)
            }
        } else {
            buffer.write(data)
        }
    }

    /** Open a new pendant_<ts>(-partN).wav with a placeholder 44-byte header. */
    private fun openNewPendantPart(): Boolean {
        return try {
            val dir = context.getExternalFilesDir("recordings") ?: run {
                Log.e(TAG, "[pendant] external files dir null"); return false
            }
            dir.mkdirs()
            val name = if (pendantPartIndex == 0)
                "pendant_${pendantSessionTs}.wav"
            else
                "pendant_${pendantSessionTs}-part${pendantPartIndex + 1}.wav"
            val f = File(dir, name)
            val raf = RandomAccessFile(f, "rw")
            // Placeholder header — sizes patched on finalize.
            raf.setLength(0)
            raf.write(buildWavHeader(0))
            raf.fd.sync()
            pendantRaf = raf
            pendantFile = f
            pendantPartBytes = 0
            pendantLastSyncMs = System.currentTimeMillis()
            Log.i(TAG, "[pendant] opened part ${pendantPartIndex + 1} → ${f.absolutePath}")
            true
        } catch (e: Exception) {
            Log.e(TAG, "[pendant] openNewPendantPart failed: ${e.message}")
            false
        }
    }

    private fun writePendantChunkInternal(data: ByteArray) {
        val raf = pendantRaf ?: return
        try {
            raf.write(data)
            pendantPartBytes += data.size
            pendantBytesWritten += data.size

            val now = System.currentTimeMillis()
            if (now - pendantLastSyncMs >= SYNC_INTERVAL_MS) {
                // Patch in-progress header so a crash leaves a recoverable file.
                patchHeaderInPlace(raf, pendantPartBytes)
                raf.fd.sync()
                pendantLastSyncMs = now
            }

            if (pendantPartBytes >= ROTATE_BYTES) {
                Log.i(TAG, "[pendant] rotating part ${pendantPartIndex + 1} at $pendantPartBytes bytes")
                finalizeCurrentPart(notifyListener = true)
                pendantPartIndex++
                openNewPendantPart()
            }
        } catch (e: Exception) {
            Log.e(TAG, "[pendant] write chunk failed: ${e.message}")
        }
    }

    /** Patch RIFF size + data size at the placeholder positions. */
    private fun patchHeaderInPlace(raf: RandomAccessFile, dataSize: Long) {
        val pos = raf.filePointer
        try {
            // RIFF size at offset 4 (LE int32) = 36 + dataSize
            raf.seek(4)
            raf.write(intToLeBytes((36L + dataSize).toInt()))
            // data size at offset 40 (LE int32)
            raf.seek(40)
            raf.write(intToLeBytes(dataSize.toInt()))
        } finally {
            raf.seek(pos)
        }
    }

    private fun intToLeBytes(v: Int): ByteArray = byteArrayOf(
        (v and 0xff).toByte(),
        ((v ushr 8) and 0xff).toByte(),
        ((v ushr 16) and 0xff).toByte(),
        ((v ushr 24) and 0xff).toByte(),
    )

    private fun buildWavHeader(dataSize: Int): ByteArray {
        val byteRate = SAMPLE_RATE * CHANNELS * BITS_PER_SAMPLE / 8
        val blockAlign = CHANNELS * BITS_PER_SAMPLE / 8
        return ByteBuffer.allocate(44).apply {
            order(ByteOrder.LITTLE_ENDIAN)
            put("RIFF".toByteArray())
            putInt(36 + dataSize)
            put("WAVE".toByteArray())
            put("fmt ".toByteArray())
            putInt(16)
            putShort(1)
            putShort(CHANNELS.toShort())
            putInt(SAMPLE_RATE)
            putInt(byteRate)
            putShort(blockAlign.toShort())
            putShort(BITS_PER_SAMPLE.toShort())
            put("data".toByteArray())
            putInt(dataSize)
        }.array()
    }

    private fun finalizeCurrentPart(notifyListener: Boolean) {
        val raf = pendantRaf ?: return
        val f = pendantFile ?: return
        try {
            patchHeaderInPlace(raf, pendantPartBytes)
            raf.fd.sync()
            raf.close()
        } catch (e: Exception) {
            Log.w(TAG, "[pendant] finalize close error: ${e.message}")
        }
        pendantRaf = null
        if (notifyListener && pendantPartBytes > 0) {
            val durMs = (pendantPartBytes * 1000L) / (SAMPLE_RATE * CHANNELS * BITS_PER_SAMPLE / 8L)
            try {
                listener?.onRecordingSaved(f, durMs)
            } catch (e: Exception) {
                Log.w(TAG, "[pendant] listener.onRecordingSaved threw: ${e.message}")
            }
            // Fire transcription on the finalized file.
            transcribe(f)
        }
    }

    /** Stop the pendant-stream session, finalize current part, fire listener. */
    fun stopPendantStreamRecording() {
        if (!pendantStreamMode) return
        isRecording = false
        pendantStreamMode = false
        // Close the channel and wait briefly for the writer to drain.
        val ch = pendantChunkChannel
        pendantChunkChannel = null
        ch?.close()
        // Block briefly on writer drain so finalize sees all queued chunks.
        runCatching {
            kotlinx.coroutines.runBlocking {
                withTimeoutOrNull(2_000) { pendantWriterJob?.join() }
            }
        }
        pendantWriterJob = null
        finalizeCurrentPart(notifyListener = true)
        Log.i(TAG, "[pendant] recording stopped totalBytes=$pendantBytesWritten parts=${pendantPartIndex + 1}")
    }

    // ── Phone-mic capture (used until pendant firmware streams audio) ──

    private var phoneMicJob: Job? = null
    private var phoneMicRecord: AudioRecord? = null
    // If > 0, auto-flush a chunk every N ms (conversation mode).
    // 0 = capture in one long buffer until stop (command mode).
    @Volatile private var chunkFlushMs: Long = 0
    @Volatile private var chunkStartMs: Long = 0
    // 5-minute hard cap for conversation mode (demo safety).
    @Volatile private var sessionCapMs: Long = 0

    fun setConversationChunking(flushMs: Long, capMs: Long) {
        chunkFlushMs = flushMs
        sessionCapMs = capMs
    }

    @Suppress("MissingPermission")
    fun startPhoneMicRecording() {
        if (isRecording) return
        buffer.reset()
        isRecording = true
        chunkStartMs = System.currentTimeMillis()
        Log.d(TAG, "Recording started (phone mic, chunkFlushMs=$chunkFlushMs)")
        val minBuf = AudioRecord.getMinBufferSize(
            SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT,
        ).coerceAtLeast(4096)
        // MIC is the raw front-of-phone source. VOICE_RECOGNITION respects the
        // communication mode and gets hijacked when camera/BT-headset/etc. own
        // the mic — would silently return zero samples. MIC bypasses that.
        val rec = try {
            AudioRecord(
                MediaRecorder.AudioSource.MIC,
                SAMPLE_RATE,
                AudioFormat.CHANNEL_IN_MONO,
                AudioFormat.ENCODING_PCM_16BIT,
                minBuf * 2,
            )
        } catch (e: Exception) {
            Log.e(TAG, "AudioRecord init failed: ${e.message}")
            isRecording = false
            return
        }
        if (rec.state != AudioRecord.STATE_INITIALIZED) {
            Log.e(TAG, "AudioRecord not initialized")
            isRecording = false
            return
        }
        phoneMicRecord = rec
        rec.startRecording()
        phoneMicJob = scope.launch {
            val chunk = ByteArray(minBuf)
            try {
                while (isActive && isRecording) {
                    val n = rec.read(chunk, 0, chunk.size)
                    if (n > 0) buffer.write(chunk, 0, n)

                    // Periodic chunk flush for conversation mode.
                    val now = System.currentTimeMillis()
                    if (chunkFlushMs > 0 && (now - chunkStartMs) >= chunkFlushMs) {
                        val pcm = buffer.toByteArray()
                        buffer.reset()
                        val startedAt = chunkStartMs
                        chunkStartMs = now
                        if (pcm.isNotEmpty()) {
                            launch { flushChunk(pcm, startedAt, now) }
                        }
                    }
                    // Hard cap for conversation mode (5 min safety).
                    if (sessionCapMs > 0 && (now - sessionStartMs()) >= sessionCapMs) {
                        Log.w(TAG, "Conversation cap reached, stopping")
                        isRecording = false
                    }
                }
            } catch (e: Exception) {
                Log.e(TAG, "phone mic read loop: ${e.message}")
            }
        }
    }

    @Volatile private var _sessionStart = 0L
    private fun sessionStartMs(): Long {
        if (_sessionStart == 0L) _sessionStart = System.currentTimeMillis()
        return _sessionStart
    }

    private fun flushChunk(pcm: ByteArray, startedAt: Long, endedAt: Long) {
        val wav = saveWav(pcm) ?: return
        val dur = endedAt - startedAt
        listener?.onRecordingSaved(wav, dur)
        transcribe(wav)  // listener.onTranscriptReady will fire → bridge routes to /voice/context
    }

    fun stopPhoneMicRecording() {
        if (!isRecording) return
        phoneMicJob?.cancel()
        phoneMicJob = null
        try {
            phoneMicRecord?.stop()
            phoneMicRecord?.release()
        } catch (_: Exception) {}
        phoneMicRecord = null
        _sessionStart = 0L
        chunkFlushMs = 0
        sessionCapMs = 0
        stopRecording()
    }

    fun stopRecording() {
        if (!isRecording) return
        isRecording = false

        val pcmData = buffer.toByteArray()
        buffer.reset()

        if (pcmData.isEmpty()) {
            Log.w(TAG, "Empty recording, skipping")
            return
        }

        val durationMs = (pcmData.size.toLong() * 1000) / (SAMPLE_RATE * CHANNELS * BITS_PER_SAMPLE / 8)
        Log.d(TAG, "Recording stopped: ${pcmData.size} bytes, ${durationMs}ms")

        scope.launch {
            val wavFile = saveWav(pcmData)
            if (wavFile != null) {
                listener?.onRecordingSaved(wavFile, durationMs)
                transcribe(wavFile)
            }
        }
    }

    private fun saveWav(pcmData: ByteArray): File? {
        return try {
            val dir = context.getExternalFilesDir("recordings")
            dir?.mkdirs()
            val file = File(dir, "pendant_${System.currentTimeMillis()}.wav")

            FileOutputStream(file).use { fos ->
                val dataSize = pcmData.size
                val byteRate = SAMPLE_RATE * CHANNELS * BITS_PER_SAMPLE / 8
                val blockAlign = CHANNELS * BITS_PER_SAMPLE / 8

                val header = ByteBuffer.allocate(44).apply {
                    order(ByteOrder.LITTLE_ENDIAN)
                    // RIFF header
                    put("RIFF".toByteArray())
                    putInt(36 + dataSize)
                    put("WAVE".toByteArray())
                    // fmt sub-chunk
                    put("fmt ".toByteArray())
                    putInt(16) // sub-chunk size
                    putShort(1) // PCM format
                    putShort(CHANNELS.toShort())
                    putInt(SAMPLE_RATE)
                    putInt(byteRate)
                    putShort(blockAlign.toShort())
                    putShort(BITS_PER_SAMPLE.toShort())
                    // data sub-chunk
                    put("data".toByteArray())
                    putInt(dataSize)
                }
                fos.write(header.array())
                fos.write(pcmData)
            }

            Log.d(TAG, "WAV saved: ${file.absolutePath} (${file.length()} bytes)")
            file
        } catch (e: Exception) {
            Log.e(TAG, "Failed to save WAV: ${e.message}")
            null
        }
    }

    /**
     * slice-e: public entry point for orphan rescan to re-fire transcription
     * on recovered files. The internal transcribe() does the same thing; this
     * keeps the API explicit so the bridge doesn't reach into private methods.
     */
    fun transcribeOrphan(wavFile: File) {
        Log.i(TAG, "[orphan] transcribing recovered file: ${wavFile.name} (${wavFile.length()} bytes)")
        transcribe(wavFile)
    }

    private fun transcribe(wavFile: File) {
        val apiKey = getDeepgramKey()
        if (apiKey.isNullOrBlank()) {
            Log.w(TAG, "No Deepgram API key — skipping transcription")
            listener?.onTranscriptError(wavFile, "No Deepgram API key configured")
            return
        }

        val body = wavFile.readBytes().toRequestBody("audio/wav".toMediaType())
        val request = Request.Builder()
            .url(DEEPGRAM_URL)
            .header("Authorization", "Token $apiKey")
            .post(body)
            .build()

        httpClient.newCall(request).enqueue(object : Callback {
            override fun onFailure(call: Call, e: java.io.IOException) {
                Log.e(TAG, "Transcription failed: ${e.message}")
                listener?.onTranscriptError(wavFile, e.message ?: "Network error")
            }

            override fun onResponse(call: Call, response: Response) {
                response.use { r ->
                    if (!r.isSuccessful) {
                        val err = "Deepgram HTTP ${r.code}"
                        Log.e(TAG, err)
                        listener?.onTranscriptError(wavFile, err)
                        return
                    }
                    try {
                        val json = JSONObject(r.body?.string() ?: "{}")
                        // Deepgram shape: results.channels[0].alternatives[0].transcript
                        val transcript = json
                            .optJSONObject("results")
                            ?.optJSONArray("channels")
                            ?.optJSONObject(0)
                            ?.optJSONArray("alternatives")
                            ?.optJSONObject(0)
                            ?.optString("transcript", "") ?: ""
                        Log.d(TAG, "Transcript: ${transcript.take(100)}")
                        listener?.onTranscriptReady(wavFile, transcript)
                    } catch (e: Exception) {
                        Log.e(TAG, "Transcript parse error: ${e.message}")
                        listener?.onTranscriptError(wavFile, "Parse error: ${e.message}")
                    }
                }
            }
        })
    }

    /**
     * Reads the Deepgram API key from SharedPreferences.
     * The key can be set via:
     *   1. pendant.set_deepgram_key command from the relay
     *   2. BuildConfig if added to build.gradle.kts
     */
    private fun getDeepgramKey(): String? {
        val prefs = context.getSharedPreferences("pendant_prefs", Context.MODE_PRIVATE)
        return prefs.getString("deepgram_api_key", null)
    }

    fun destroy() {
        // slice-e: best-effort finalize of any open pendant-stream file so
        // we never lose data on service teardown.
        try {
            if (pendantStreamMode) {
                stopPendantStreamRecording()
            }
        } catch (_: Exception) {}
        scope.cancel()
    }
}
