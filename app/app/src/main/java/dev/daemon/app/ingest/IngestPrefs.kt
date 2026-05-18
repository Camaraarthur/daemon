package dev.daemon.app.ingest

import android.content.Context

/**
 * Persisted ingest preferences (off-by-default toggles). Lives in plain
 * SharedPreferences — the flag itself isn't sensitive, only the ingested
 * content is (and that goes into the encrypted vault).
 */
class IngestPrefs(context: Context) {
    private val prefs = context.applicationContext
        .getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    var watchScreenshots: Boolean
        get() = prefs.getBoolean(KEY_WATCH_SCREENSHOTS, false)
        set(v) { prefs.edit().putBoolean(KEY_WATCH_SCREENSHOTS, v).apply() }

    companion object {
        private const val PREFS = "daemon_ingest_prefs"
        private const val KEY_WATCH_SCREENSHOTS = "watch_screenshots"
    }
}
