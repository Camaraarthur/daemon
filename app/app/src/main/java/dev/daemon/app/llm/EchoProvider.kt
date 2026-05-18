package dev.daemon.app.llm

import kotlinx.coroutines.delay

/**
 * Debug provider. Stays in the build for diagnostics.
 */
class EchoProvider : LlmProvider {
    override val id = "echo"
    override val displayName = "Echo (debug)"
    override val needsKey = false
    override val isLocal = true
    override suspend fun isAvailable(): Boolean = true
    override suspend fun generate(prompt: String): GenerationResult {
        delay(400)
        return GenerationResult(
            text = "echo: $prompt",
            modelLabel = "echo",
            inputTokens = prompt.length / 4,
            outputTokens = (prompt.length + 6) / 4,
            costUsd = 0.0,
            trainsOnData = "no",
            via = "on-device",
        )
    }
}
