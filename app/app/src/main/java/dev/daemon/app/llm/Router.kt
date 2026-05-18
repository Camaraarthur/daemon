package dev.daemon.app.llm

/**
 * On-device smart router. Classifies the user's prompt with cheap heuristics
 * and picks (provider, model) from what's available.
 *
 * Runs entirely in the app — daemon-the-company doesn't know which model
 * a given query was routed to. The routing decision is shown to the user
 * inline ("✦ qwen3.5-flash · short chat") so it's never opaque.
 *
 * Preference order is "best-available-given-the-class," cascading through
 * the providers the user has set up. The order is:
 *
 *   short chat  → cheap-and-fast: qwen3.5-flash > gemini-nano > sonnet
 *   coding      → claude-tuned:   anthropic > openrouter→sonnet > local
 *   reasoning   → high-quality:   openrouter→opus > anthropic-sonnet > local
 *   default     → balanced:       sonnet via either path > local
 *
 * v0.2: per-class preference will be user-configurable.
 */
object Router {

    enum class QueryClass { SHORT_CHAT, CODING, REASONING, DEFAULT }

    data class RoutingChoice(
        val provider: LlmProvider,
        val modelOverride: String?,
        val reason: String,
    )

    /**
     * Classify and pick. [available] must include only providers that pass
     * `isAvailable()` — caller does that filtering so this stays sync.
     */
    fun pick(prompt: String, available: List<LlmProvider>): RoutingChoice? {
        if (available.isEmpty()) return null
        val byId = available.associateBy { it.id }
        val cls = classify(prompt)

        // Provider-id + optional model-override preference list per class.
        // BYOK providers (user's own key) are preferred over daemon-relay
        // (Daemons-paid free tier) when both exist — keeps the relay budget
        // for users who haven't BYOK-ed yet.
        val pref: List<Pair<String, String?>> = when (cls) {
            QueryClass.SHORT_CHAT -> listOf(
                "gemini-nano" to null,                                   // local — free
                "openrouter" to "qwen/qwen3.6-flash",                    // BYOK cheap
                "daemon-relay" to "qwen/qwen3.6-flash",                  // free-tier cheap
                "openrouter" to "anthropic/claude-haiku-4.5",
                "daemon-relay" to "anthropic/claude-haiku-4.5",
                "anthropic" to null,
                "mistral" to null,
                "echo" to null,
            )
            QueryClass.CODING -> listOf(
                "anthropic" to null,                                     // user's Anthropic key
                "openrouter" to "anthropic/claude-sonnet-4.6",           // BYOK OR
                "daemon-relay" to "anthropic/claude-sonnet-4.6",         // free-tier
                "openrouter" to "openai/gpt-5.1-codex",
                "daemon-relay" to "openai/gpt-5.1-codex",
                "mistral" to null,
                "gemini-nano" to null,
                "echo" to null,
            )
            QueryClass.REASONING -> listOf(
                "openrouter" to "anthropic/claude-opus-4.7",
                "daemon-relay" to "anthropic/claude-opus-4.7",
                "anthropic" to null,
                "openrouter" to "anthropic/claude-sonnet-4.6",
                "daemon-relay" to "anthropic/claude-sonnet-4.6",
                "openrouter" to "google/gemini-3.1-pro",
                "mistral" to null,
                "gemini-nano" to null,
                "echo" to null,
            )
            QueryClass.DEFAULT -> listOf(
                "anthropic" to null,
                "openrouter" to "anthropic/claude-sonnet-4.6",
                "daemon-relay" to "anthropic/claude-sonnet-4.6",
                "mistral" to null,
                "gemini-nano" to null,
                "openrouter" to "qwen/qwen3.6-flash",
                "daemon-relay" to "qwen/qwen3.6-flash",
                "echo" to null,
            )
        }

        for ((id, model) in pref) {
            val p = byId[id] ?: continue
            val reason = when (cls) {
                QueryClass.SHORT_CHAT -> "short chat → ${model ?: id}"
                QueryClass.CODING -> "code → ${model ?: id}"
                QueryClass.REASONING -> "reasoning → ${model ?: id}"
                QueryClass.DEFAULT -> "default → ${model ?: id}"
            }
            return RoutingChoice(p, model, reason)
        }
        // Last-resort: any available.
        return RoutingChoice(available.first(), null, "fallback")
    }

    fun classify(prompt: String): QueryClass {
        val lower = prompt.lowercase()
        val len = prompt.length
        // Coding takes precedence if explicit code markers or strong keywords.
        if (prompt.contains("```")) return QueryClass.CODING
        if (CODING_KEYWORDS.any { lower.contains(it) }) return QueryClass.CODING
        // Reasoning: long-form OR explicit reasoning verbs.
        if (len > 500) return QueryClass.REASONING
        if (REASONING_KEYWORDS.any { lower.contains(it) }) return QueryClass.REASONING
        // Short chat: small + no special markers.
        if (len < 80) return QueryClass.SHORT_CHAT
        return QueryClass.DEFAULT
    }

    private val CODING_KEYWORDS = listOf(
        "function", "class", "def ", " bug", "stacktrace", "compile", "regex",
        "kotlin", "python", "javascript", "typescript", "rust", "swift",
        "refactor", "implement", "code review", "snippet",
    )
    private val REASONING_KEYWORDS = listOf(
        "explain", "analyze", "analyse", "compare", "contrast",
        "why does", "why is", "what's the difference",
        "pros and cons", "trade-off", "tradeoff",
    )
}
