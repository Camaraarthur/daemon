package com.daemon.app.pendant

import android.content.Context
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
        Log.d(TAG, "Recording started")
    }

    fun addChunk(data: ByteArray) {
        if (isRecording) {
            buffer.write(data)
        }
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
