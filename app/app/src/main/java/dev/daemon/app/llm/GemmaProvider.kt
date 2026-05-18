package dev.daemon.app.llm

import android.content.Context
import com.google.mediapipe.tasks.genai.llminference.LlmInference
import com.google.mediapipe.tasks.genai.llminference.LlmInferenceSession
import dev.daemon.app.llm.local.ModelDownloader
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.withContext
import java.io.File

/**
 * Gemma 4 E2B running locally via MediaPipe LLM Inference. Nothing leaves
 * the device once the model file is on disk.
 *
 * Source: `litert-community/gemma-4-E2B-it-litert-lm` on HuggingFace
 * (public, no auth, ~1.87 GB at INT4). Downloaded once, stored in
 * `filesDir/`, then runs offline forever.
 *
 * isAvailable() reflects honestly: "is the file on disk?" — not a check
 * against some Google service. This is the "we manage our own model"
 * answer to Arthur's "wdym isn't available if it is downloaded locally."
 */
class GemmaProvider(private val context: Context) : LlmProvider {
    override val id = "gemma-4-e2b"
    override val displayName = "Gemma 4 E2B (on-device)"
    override val needsKey = false
    override val isLocal = true

    /** Available iff the model file exists on disk. */
    override suspend fun isAvailable(): Boolean = modelFile(context).exists()

    @Volatile private var inference: LlmInference? = null

    override suspend fun generate(prompt: String): GenerationResult = withContext(Dispatchers.IO) {
        val file = modelFile(context)
        if (!file.exists()) {
            throw IllegalStateException(
                "Gemma 4 E2B not downloaded. Open Settings → Download Gemma 4 E2B (1.9 GB)."
            )
        }

        val llm = ensureInference(file)
        val sessionOptions = LlmInferenceSession.LlmInferenceSessionOptions.builder()
            .setTopK(40)
            .setTemperature(0.8f)
            .build()
        val text = LlmInferenceSession.createFromOptions(llm, sessionOptions).use { session ->
            session.addQueryChunk(prompt)
            session.generateResponse()
        }

        GenerationResult(
            text = text,
            modelLabel = "gemma-4-e2b",
            // MediaPipe doesn't return precise token counts; estimate by char/4
            inputTokens = prompt.length / 4,
            outputTokens = text.length / 4,
            costUsd = 0.0,
            trainsOnData = "no",
            via = "on-device",
        )
    }

    private fun ensureInference(file: File): LlmInference {
        inference?.let { return it }
        synchronized(this) {
            inference?.let { return it }
            val opts = LlmInference.LlmInferenceOptions.builder()
                .setModelPath(file.absolutePath)
                .setMaxTokens(1024)
                .build()
            val created = LlmInference.createFromOptions(context, opts)
            inference = created
            return created
        }
    }

    /** Stream a download of the model. Caller renders progress UI. */
    fun download(): Flow<ModelDownloader.Progress> =
        ModelDownloader.download(context, MODEL_URL, modelFile(context))

    fun deleteModel(): Boolean = modelFile(context).delete().also {
        synchronized(this) {
            inference?.close()
            inference = null
        }
    }

    fun close() {
        synchronized(this) {
            inference?.close()
            inference = null
        }
    }

    companion object {
        // Public asset on HuggingFace litert-community. ~1.87 GB. No auth.
        const val MODEL_URL =
            "https://huggingface.co/litert-community/gemma-4-E2B-it-litert-lm/resolve/main/gemma-4-E2B-it-web.task"
        const val MODEL_FILENAME = "gemma-4-e2b-it-int4.task"
        const val MODEL_SIZE_BYTES = 2_003_697_664L

        fun modelFile(context: Context): File =
            File(context.applicationContext.filesDir, MODEL_FILENAME)
    }
}
