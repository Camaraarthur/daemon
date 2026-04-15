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

/**
 * Accumulates PCM audio chunks from the pendant BLE audio stream,
 * saves as WAV on recording stop, and transcribes via Deepgram.
 *
 * Audio format: 16-bit signed PCM, 16kHz, mono.
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

    fun startRecording() {
        buffer.reset()
        isRecording = true
        Log.d(TAG, "Recording started (pendant BLE chunks)")
    }

    fun addChunk(data: ByteArray) {
        if (isRecording) {
            buffer.write(data)
        }
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
        val rec = try {
            AudioRecord(
                MediaRecorder.AudioSource.VOICE_RECOGNITION,
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
                        val transcript = json
                            .optJSONArray("results")
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
        scope.cancel()
    }
}
