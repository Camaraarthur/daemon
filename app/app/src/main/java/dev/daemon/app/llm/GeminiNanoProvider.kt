package dev.daemon.app.llm

import android.content.Context
import com.google.mlkit.genai.common.DownloadStatus
import com.google.mlkit.genai.common.FeatureStatus
import com.google.mlkit.genai.prompt.Generation
import com.google.mlkit.genai.prompt.GenerativeModel

/**
 * On-device Gemini Nano via ML Kit GenAI Prompt API. Pixel 8 Pro / 9 / S24+.
 * No network, no cost, no training on data.
 */
class GeminiNanoProvider(@Suppress("UNUSED_PARAMETER") context: Context) : LlmProvider {
    override val id = "gemini-nano"
    override val displayName = "Gemini Nano (on-device)"
    override val needsKey = false
    override val isLocal = true

    @Volatile
    private var model: GenerativeModel? = null

    private fun client(): GenerativeModel {
        model?.let { return it }
        synchronized(this) {
            model?.let { return it }
            return Generation.getClient().also { model = it }
        }
    }

    override suspend fun isAvailable(): Boolean = try {
        val status = client().checkStatus()
        status == FeatureStatus.AVAILABLE || status == FeatureStatus.DOWNLOADABLE
    } catch (t: Throwable) {
        false
    }

    override suspend fun generate(prompt: String): GenerationResult {
        val m = client()
        when (val s = m.checkStatus()) {
            FeatureStatus.AVAILABLE -> Unit
            FeatureStatus.UNAVAILABLE -> throw IllegalStateException(
                "Gemini Nano isn't available on this device. " +
                    "Supported devices: Pixel 8 Pro, Pixel 9 series, Galaxy S24+. " +
                    "Open Settings to switch to a BYOK provider."
            )
            FeatureStatus.DOWNLOADABLE, FeatureStatus.DOWNLOADING -> ensureDownloaded(m)
            else -> throw IllegalStateException("Unexpected Gemini Nano status: $s")
        }
        val text = m.generateContent(prompt).candidates.first().text
        return GenerationResult(
            text = text,
            modelLabel = "gemini-nano",
            inputTokens = prompt.length / 4,
            outputTokens = text.length / 4,
            costUsd = 0.0,
            trainsOnData = "no",
            via = "on-device",
        )
    }

    private suspend fun ensureDownloaded(m: GenerativeModel) {
        var ok = false
        var error: Throwable? = null
        m.download().collect { ds ->
            when (ds) {
                is DownloadStatus.DownloadFailed -> error = ds.e
                DownloadStatus.DownloadCompleted -> ok = true
                else -> Unit
            }
        }
        if (!ok) throw IllegalStateException(
            "Gemini Nano download failed: ${error?.message ?: "unknown error"}"
        )
    }

    fun close() {
        synchronized(this) {
            model?.close()
            model = null
        }
    }
}
