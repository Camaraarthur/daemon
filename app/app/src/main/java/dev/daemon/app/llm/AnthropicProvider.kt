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

class AnthropicProvider(
    private val context: Context,
    private val apiKey: String?,
) : LlmProvider {
    override val id = "anthropic"
    override val displayName = "Claude Sonnet (BYOK)"
    override val needsKey = true
    override val isLocal = false
    override suspend fun isAvailable(): Boolean = !apiKey.isNullOrBlank()

    override suspend fun generate(prompt: String): GenerationResult = withContext(Dispatchers.IO) {
        val key = apiKey
        require(!key.isNullOrBlank()) {
            "No Anthropic API key. Open Settings → Claude Sonnet (BYOK) and paste your key."
        }
        Pricing.load(context)

        val redactor = PiiRedactor()
        val redacted = redactor.redact(prompt)

        val body = JSONObject().apply {
            put("model", MODEL)
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
            .header("x-api-key", key)
            .header("anthropic-version", ANTHROPIC_VERSION)
            .header("content-type", "application/json")
            .tag(PiiCountTag::class.java, PiiCountTag(redacted.count))
            .build()

        val response = HttpClient.get(context).newCall(request).execute()
        response.use { r ->
            val bodyText = r.body?.string().orEmpty()
            if (!r.isSuccessful) {
                throw RuntimeException(
                    "Anthropic ${r.code}: " + when (r.code) {
                        401 -> "API key rejected. Check key in Settings."
                        429 -> "Rate limit. Wait a moment + retry."
                        else -> bodyText.take(200)
                    }
                )
            }
            val parsed = JSONObject(bodyText)
            val content = parsed.optJSONArray("content")
            val sb = StringBuilder()
            for (i in 0 until (content?.length() ?: 0)) {
                val part = content!!.optJSONObject(i) ?: continue
                if (part.optString("type") == "text") sb.append(part.optString("text"))
            }
            val usage = parsed.optJSONObject("usage")
            val inTokens = usage?.optInt("input_tokens") ?: 0
            val outTokens = usage?.optInt("output_tokens") ?: 0
            val pricing = Pricing.get(MODEL)
            GenerationResult(
                text = redactor.restore(sb.toString(), redacted.map),
                modelLabel = MODEL,
                inputTokens = inTokens,
                outputTokens = outTokens,
                costUsd = pricing?.costUsd(inTokens, outTokens) ?: 0.0,
                trainsOnData = pricing?.trains ?: "no",
                via = "your anthropic key",
            )
        }
    }

    companion object {
        private const val ENDPOINT = "https://api.anthropic.com/v1/messages"
        private const val MODEL = "claude-sonnet-4-6"
        private const val ANTHROPIC_VERSION = "2023-06-01"
        private const val MAX_TOKENS = 1024
        private val JSON = "application/json; charset=utf-8".toMediaType()
    }
}
