package dev.daemon.app.llm

import android.content.Context
import android.content.SharedPreferences
import dev.daemon.app.security.SecureKeyStore

/**
 * Single source of truth for which providers exist and which is selected.
 *
 * Selection persists via plain SharedPreferences (the choice isn't sensitive).
 * BYOK API keys live in [SecureKeyStore] — Android Keystore-backed.
 *
 * [refresh] rebuilds the BYOK providers with the current keys — call it
 * after the user pastes or clears a key in Settings.
 */
class ProviderRegistry(context: Context) {

    private val appContext: Context = context.applicationContext

    private val prefs: SharedPreferences =
        appContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    val keys: SecureKeyStore = SecureKeyStore(appContext)

    @Volatile
    private var providers: List<LlmProvider> = buildProviders()

    private fun buildProviders(): List<LlmProvider> = listOf(
        EchoProvider(),
        GeminiNanoProvider(appContext),
        // Free tier — Daemon-relay-funded OpenRouter. Worker is in the path;
        // users who want full L1 trust use one of the BYOK providers below.
        DaemonRelayProvider(appContext),
        OpenRouterProvider(
            appContext,
            apiKey = keys.get("openrouter"),
            model = getProviderModel("openrouter") ?: DEFAULT_OPENROUTER_MODEL,
        ),
        AnthropicProvider(appContext, apiKey = keys.get("anthropic")),
        MistralProvider(appContext, apiKey = keys.get("mistral")),
    )

    /** Per-provider model selection (currently only used by OpenRouter). */
    fun getProviderModel(providerId: String): String? =
        prefs.getString(modelKey(providerId), null)?.takeIf { it.isNotBlank() }

    fun setProviderModel(providerId: String, modelId: String) {
        prefs.edit().putString(modelKey(providerId), modelId).apply()
        // Provider needs to be rebuilt to pick up the new model.
        refresh()
    }

    private fun modelKey(providerId: String) = "model:$providerId"

    fun list(): List<LlmProvider> = providers

    /** Rebuild after a key change so providers pick up the new credential. */
    fun refresh() {
        providers = buildProviders()
    }

    fun selected(): LlmProvider {
        val id = prefs.getString(KEY_SELECTED_ID, DEFAULT_ID) ?: DEFAULT_ID
        return providers.firstOrNull { it.id == id } ?: providers.first()
    }

    fun select(id: String) {
        if (providers.none { it.id == id }) return
        prefs.edit().putString(KEY_SELECTED_ID, id).apply()
    }

    companion object {
        private const val PREFS_NAME = "daemon_app_settings"
        private const val KEY_SELECTED_ID = "selected_provider_id"
        private const val DEFAULT_ID = "echo"
    }
}
