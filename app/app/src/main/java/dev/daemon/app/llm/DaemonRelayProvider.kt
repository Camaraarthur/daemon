package dev.daemon.app.llm

import android.content.Context
import dev.daemon.app.costs.Pricing
import dev.daemon.app.net.HttpClient
import dev.daemon.app.net.PiiCountTag
import dev.daemon.app.privacy.PiiRedactor
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID

/**
 * Daemon's free-tier relay. Phone → `relay.daemon.page` → OpenRouter →
 * provider. No API key on the phone — Daemons-the-company pays the
 * OpenRouter bill (with per-device rate limit, see ~/daemon/relay/).
 *
 * Trust caveat vs the strict "Daemons sees nothing" promise: this Worker
 * IS in the data plane during transit. The Worker is stateless +
 * open-source + reproducible + rate-limited; nothing is logged beyond a
 * daily request counter per random device id. Users who want full
 * "no-Daemons-server-ever" can switch to BYOK OpenRouter (or any other
 * BYOK provider) — that path skips the Worker entirely.
 *
 * Available iff the user hasn't disabled the free tier in Settings.
 */
class DaemonRelayProvider(
    private val context: Context,
    private val model: String = DEFAULT_MODEL,
) : LlmProvider {
    override val id = "daemon-relay"
    override val displayName = "Daemon free tier (beta)"
    override val needsKey = false
    override val isLocal = false
    override suspend fun isAvailable(): Boolean = true // ships always on for v0.1.2 beta

    override suspend fun generate(prompt: String): GenerationResult = generate(prompt, null)

    override suspend fun generate(
        prompt: String,
        modelOverride: String?,
    ): GenerationResult = withContext(Dispatchers.IO) {
        Pricing.load(context)
        val resolved = modelOverride?.takeIf { it.isNotBlank() } ?: model

        val redactor = PiiRedactor()
        val redacted = redactor.redact(prompt)

        val body = JSONObject().apply {
            put("model", resolved)
            put("max_tokens", MAX_TOKENS)
            put("messages", JSONArray().apply {
                put(JSONObject().apply {
                    put("role", "user")
                    put("content", redacted.text)
                })
            })
        }

        val request = Request.Builder()
            .url(ENDPOINT)
            .post(body.toString().toRequestBody(JSON))
            .header("Content-Type", "application/json")
            .header("x-daemon-device-id", deviceId(context))
            .tag(PiiCountTag::class.java, PiiCountTag(redacted.count))
            .build()

        val response = HttpClient.get(context).newCall(request).execute()
        response.use { r ->
            val bodyText = r.body?.string().orEmpty()
            if (!r.isSuccessful) {
                throw RuntimeException(
                    "Daemon relay ${r.code}: " + when (r.code) {
                        429 -> "Daily free-tier limit reached. " +
                            "Paste your own OpenRouter key in Settings to bypass."
                        502, 503 -> "Daemon relay is down — try a BYOK provider."
                        else -> bodyText.take(200)
                    }
                )
            }
            val parsed = JSONObject(bodyText)
            val choices = parsed.optJSONArray("choices")
            val sb = StringBuilder()
            for (i in 0 until (choices?.length() ?: 0)) {
                val choice = choices!!.optJSONObject(i) ?: continue
                val msg = choice.optJSONObject("message") ?: continue
                sb.append(msg.optString("content"))
            }
            val usage = parsed.optJSONObject("usage")
            val inTokens = usage?.optInt("prompt_tokens") ?: 0
            val outTokens = usage?.optInt("completion_tokens") ?: 0
            val resolvedModel = parsed.optString("model").ifBlank { resolved }
            val pricing = Pricing.get(resolvedModel)
            GenerationResult(
                text = redactor.restore(sb.toString(), redacted.map),
                modelLabel = resolvedModel,
                inputTokens = inTokens,
                outputTokens = outTokens,
                // Free-tier users don't pay; we still display the upstream
                // provider cost so users can see what we cover for them.
                costUsd = 0.0,
                trainsOnData = pricing?.trains,
                via = "daemon relay",
            )
        }
    }

    companion object {
        // Update once `relay.daemon.page` is configured. Until then the
        // workers.dev URL works too; phones can be re-pointed via remote
        // config in v0.2 if we ever move.
        private const val ENDPOINT = "https://relay.daemon.page/v1/chat/completions"
        private const val DEFAULT_MODEL = "anthropic/claude-sonnet-4.6"
        private const val MAX_TOKENS = 1024
        private val JSON = "application/json; charset=utf-8".toMediaType()
        private const val PREFS = "daemon_relay_prefs"
        private const val KEY_DEVICE_ID = "device_id"

        /**
         * Stable per-install random id used only for the relay's per-device
         * rate counter. Not tied to user identity, not derived from any
         * device-specific identifier (no IMEI / ANDROID_ID / etc.). Lives in
         * plain SharedPreferences inside the app sandbox.
         */
        fun deviceId(context: Context): String {
            val prefs = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            prefs.getString(KEY_DEVICE_ID, null)?.let { return it }
            val fresh = UUID.randomUUID().toString()
            prefs.edit().putString(KEY_DEVICE_ID, fresh).apply()
            return fresh
        }
    }
}
