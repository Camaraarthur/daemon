package dev.daemon.app.privacy

import android.content.Context
import android.content.SharedPreferences
import org.json.JSONArray
import org.json.JSONObject

/**
 * Records every HTTPS request the app makes. The "What this app sends" screen
 * in Settings renders this log so the user can verify the trust promise:
 *
 *   - In Local mode → zero entries
 *   - After BYOK → only the provider's host (`api.anthropic.com`, `api.mistral.ai`)
 *   - Never anything Daemons-operated
 *
 * Logged: timestamp, method, host, path, bytes sent, bytes received, status,
 * number of PII tokens redacted in the outbound body.
 *
 * Storage: plain SharedPreferences (the log itself is not sensitive — it's
 * the *fact* of communication, not the content). 7-day rolling window.
 */
class EgressLog(context: Context) {

    private val prefs: SharedPreferences = context.applicationContext
        .getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    data class Entry(
        val tsEpochMs: Long,
        val method: String,
        val host: String,
        val path: String,
        val bytesSent: Long,
        val bytesReceived: Long,
        val statusCode: Int,
        val piiRedactionsCount: Int,
    ) {
        fun toJson(): JSONObject = JSONObject().apply {
            put("ts", tsEpochMs)
            put("m", method)
            put("h", host)
            put("p", path)
            put("bs", bytesSent)
            put("br", bytesReceived)
            put("sc", statusCode)
            put("pii", piiRedactionsCount)
        }
        companion object {
            fun fromJson(j: JSONObject) = Entry(
                tsEpochMs = j.getLong("ts"),
                method = j.getString("m"),
                host = j.getString("h"),
                path = j.optString("p", ""),
                bytesSent = j.optLong("bs", 0),
                bytesReceived = j.optLong("br", 0),
                statusCode = j.optInt("sc", 0),
                piiRedactionsCount = j.optInt("pii", 0),
            )
        }
    }

    @Synchronized
    fun append(entry: Entry) {
        val arr = readArray()
        arr.put(entry.toJson())
        val pruned = pruneOlderThan(arr, System.currentTimeMillis() - WINDOW_MS)
        prefs.edit().putString(KEY_ENTRIES, pruned.toString()).apply()
    }

    @Synchronized
    fun list(): List<Entry> {
        val arr = readArray()
        val out = ArrayList<Entry>(arr.length())
        for (i in 0 until arr.length()) {
            runCatching { out.add(Entry.fromJson(arr.getJSONObject(i))) }
        }
        // newest first
        return out.sortedByDescending { it.tsEpochMs }
    }

    @Synchronized
    fun clear() {
        prefs.edit().remove(KEY_ENTRIES).apply()
    }

    private fun readArray(): JSONArray {
        val raw = prefs.getString(KEY_ENTRIES, null) ?: return JSONArray()
        return try { JSONArray(raw) } catch (_: Throwable) { JSONArray() }
    }

    private fun pruneOlderThan(arr: JSONArray, cutoffMs: Long): JSONArray {
        val keep = JSONArray()
        for (i in 0 until arr.length()) {
            val o = arr.optJSONObject(i) ?: continue
            if (o.optLong("ts", 0) >= cutoffMs) keep.put(o)
        }
        return keep
    }

    companion object {
        private const val PREFS_NAME = "daemon_egress_log"
        private const val KEY_ENTRIES = "entries"
        private const val WINDOW_MS = 7L * 24L * 60L * 60L * 1000L
    }
}
