package dev.daemon.app.llm

/**
 * The plug. Every model — local or BYOK — implements this. The chat loop
 * doesn't know the difference.
 */
interface LlmProvider {
    /** Stable identifier persisted in settings. */
    val id: String

    /** Human-facing label shown in the settings picker. */
    val displayName: String

    /** True if the provider needs an API key the user has to paste. */
    val needsKey: Boolean

    /**
     * True if inference runs entirely on-device (no network egress).
     * Drives the "Daemons sees nothing" UI: local providers wear a small badge,
     * BYOK providers show the host they'll talk to.
     */
    val isLocal: Boolean

    /** True if the provider is ready to handle a generate() call right now. */
    suspend fun isAvailable(): Boolean

    /**
     * Run one turn. Returns text + usage + cost so the UI can surface
     * a per-call price line and a running monthly total. Throws on transport
     * errors, missing keys, etc. — caller surfaces the message to chat.
     */
    suspend fun generate(prompt: String): GenerationResult

    /**
     * Same as [generate] but with an optional per-call model override.
     * Providers without model variants (Echo, Gemini Nano, Anthropic-fixed,
     * Mistral-fixed) ignore the override and behave like [generate].
     * Only OpenRouter currently overrides.
     */
    suspend fun generate(prompt: String, modelOverride: String?): GenerationResult =
        generate(prompt)
}

/**
 * Provider response with metering. [text] is the chat content; the other
 * fields drive the per-call cost line under the assistant bubble.
 *
 * For local providers tokens may be 0 and cost may be 0 — that's the right
 * behaviour: nothing was billed because nothing left the device.
 */
data class GenerationResult(
    val text: String,
    /** Model that handled the call (e.g. "claude-sonnet-4-6"). */
    val modelLabel: String = "",
    val inputTokens: Int = 0,
    val outputTokens: Int = 0,
    val costUsd: Double = 0.0,
    /** Trust badge to render: "no" | "opt_out" | "yes" | "unknown" | null. */
    val trainsOnData: String? = null,
)
