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

/**
 * OpenRouter as a one-key BYOK provider. ~350 models through one endpoint.
 * Daemon-the-company is NOT in the request path — phone → api.openrouter.ai
 * directly with the user's own OpenRouter key.
 */
class OpenRouterProvider(
    private val context: Context,
    private val apiKey: String?,
    private val model: String = DEFAULT_MODEL,
) : LlmProvider {
    override val id = "openrouter"
    override val displayName = "OpenRouter (BYOK · all models)"
    override val needsKey = true
    override val isLocal = false
    override suspend fun isAvailable(): Boolean = !apiKey.isNullOrBlank()

    override suspend fun generate(prompt: String): GenerationResult = generate(prompt, null)

    override suspend fun generate(
        prompt: String,
        modelOverride: String?,
    ): GenerationResult = withContext(Dispatchers.IO) {
        val key = apiKey
        require(!key.isNullOrBlank()) {
            "No OpenRouter API key. Open Settings → OpenRouter (BYOK · all models) and paste your key."
        }
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
            .header("Authorization", "Bearer $key")
            .header("Content-Type", "application/json")
            .header("HTTP-Referer", "https://daemon.page")
            .header("X-Title", "daemon")
            .tag(PiiCountTag::class.java, PiiCountTag(redacted.count))
            .build()

        val response = HttpClient.get(context).newCall(request).execute()
        response.use { r ->
            val bodyText = r.body?.string().orEmpty()
            if (!r.isSuccessful) {
                throw RuntimeException(
                    "OpenRouter ${r.code}: " + when (r.code) {
                        401 -> "API key rejected. Check key in Settings."
                        402 -> "OpenRouter balance exhausted. Top up at openrouter.ai/credits."
                        429 -> "Rate limit. Wait a moment + retry."
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
            // OpenRouter echoes the resolved model id in the response — prefer
            // that over the requested name so e.g. ":free" suffixes show up.
            val resolvedModel = parsed.optString("model").ifBlank { resolved }
            val pricing = Pricing.get(resolvedModel)
            GenerationResult(
                text = redactor.restore(sb.toString(), redacted.map),
                modelLabel = resolvedModel,
                inputTokens = inTokens,
                outputTokens = outTokens,
                costUsd = pricing?.costUsd(inTokens, outTokens) ?: 0.0,
                trainsOnData = pricing?.trains,
            )
        }
    }

    companion object {
        private const val ENDPOINT = "https://openrouter.ai/api/v1/chat/completions"
        private const val DEFAULT_MODEL = "anthropic/claude-sonnet-4.6"
        private const val MAX_TOKENS = 1024
        private val JSON = "application/json; charset=utf-8".toMediaType()
    }
}
