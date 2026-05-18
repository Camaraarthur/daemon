package dev.daemon.app.costs

import android.content.Context
import org.json.JSONObject

/**
 * On-device price book. Loaded once from `assets/pricing.json` and used to
 * compute per-call cost from the provider's `usage` field. Source of truth
 * stays in the asset file (versioned with the app); v0.2 will refresh from
 * `daemon.page/providers.json` with a signed-payload check.
 *
 * Prices are USD per 1M tokens. Cost is reported in USD; UI may format with
 * the user's locale separator. No EUR conversion for now — keeps things
 * transparent to the provider's billing.
 */
data class ModelPricing(
    val inputUsdPerM: Double,
    val outputUsdPerM: Double,
    val trains: String, // "no" | "opt_out" | "yes" | "unknown"
) {
    fun costUsd(inputTokens: Int, outputTokens: Int): Double =
        (inputTokens * inputUsdPerM + outputTokens * outputUsdPerM) / 1_000_000.0
}

object Pricing {
    @Volatile private var table: Map<String, ModelPricing> = emptyMap()

    @Synchronized
    fun load(context: Context) {
        if (table.isNotEmpty()) return
        val raw = context.applicationContext.assets.open("pricing.json")
            .bufferedReader().use { it.readText() }
        val models = JSONObject(raw).getJSONObject("models")
        val map = HashMap<String, ModelPricing>()
        models.keys().forEach { id ->
            val o = models.getJSONObject(id)
            map[id] = ModelPricing(
                inputUsdPerM = o.optDouble("in", 0.0),
                outputUsdPerM = o.optDouble("out", 0.0),
                trains = o.optString("trains", "unknown"),
            )
        }
        table = map
    }

    fun get(modelId: String): ModelPricing? = table[modelId]
        ?: table[modelId.substringAfter("/")]
        ?: table.entries.firstOrNull { it.key.equals(modelId, ignoreCase = true) }?.value

    /** Convenience: compute cost or return null if pricing unknown. */
    fun costOrNull(modelId: String, inputTokens: Int, outputTokens: Int): Double? =
        get(modelId)?.costUsd(inputTokens, outputTokens)
}
