package dev.daemon.app.llm

/**
 * Curated short list of OpenRouter model IDs we surface in the model picker.
 * Mirrors what's price-known in `assets/pricing.json` so the cost meter
 * always has a row to look up.
 *
 * v0.2 will fetch `/api/v1/models` dynamically and refresh from the live
 * provider list. v0.1.1 ships this static set so the dropdown works
 * offline + without an extra request on every settings open.
 */
data class OpenRouterModelOption(
    val id: String,
    val label: String,
    val tier: String,
)

val OPENROUTER_MODELS: List<OpenRouterModelOption> = listOf(
    // Premium reasoning
    OpenRouterModelOption("anthropic/claude-opus-4.7",      "🏆 Claude Opus 4.7",          "premium reasoning"),
    OpenRouterModelOption("anthropic/claude-sonnet-4.6",    "⭐ Claude Sonnet 4.6 (default)", "premium balanced"),
    OpenRouterModelOption("openai/gpt-5.1",                  "GPT-5.1",                     "premium reasoning"),
    OpenRouterModelOption("openai/gpt-5.1-codex",            "GPT-5.1 Codex",               "premium coding"),
    OpenRouterModelOption("google/gemini-3.1-pro",           "Gemini 3.1 Pro",              "premium reasoning"),

    // Mid-tier — Pareto winners
    OpenRouterModelOption("google/gemini-3-flash",           "💸 Gemini 3 Flash",           "Pareto mid"),
    OpenRouterModelOption("anthropic/claude-haiku-4.5",      "Claude Haiku 4.5",            "fast cheap claude"),
    OpenRouterModelOption("openai/gpt-5.4-mini",             "GPT-5.4 Mini",                "fast cheap GPT"),
    OpenRouterModelOption("mistral-large-latest",            "Mistral Large 3 (EU)",        "EU vendor"),

    // Cheap Pareto front
    OpenRouterModelOption("qwen/qwen3.6-plus",               "Qwen 3.6 Plus",               "cheap · EU via AliCloud"),
    OpenRouterModelOption("qwen/qwen3.6-flash",              "💸 Qwen 3.6 Flash",           "cheapest top-10"),
    OpenRouterModelOption("deepseek/deepseek-v4-pro",        "DeepSeek V4 Pro",             "Pareto winner (⚠ trains on data)"),

    // Long-tail specialty
    OpenRouterModelOption("x-ai/grok-4.20",                  "Grok 4.20",                   "xAI"),
    OpenRouterModelOption("moonshotai/kimi-k2.6",            "Kimi K2.6",                   "Moonshot (⚠ unverified training)"),
    OpenRouterModelOption("z-ai/glm-5.1",                    "GLM 5.1",                     "Z.ai (⚠ unverified training)"),
)

const val DEFAULT_OPENROUTER_MODEL = "anthropic/claude-sonnet-4.6"
