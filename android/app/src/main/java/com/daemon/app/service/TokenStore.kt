package com.daemon.app.service

import android.content.Context
import android.content.SharedPreferences

/**
 * Phase 3 — Android device_token storage.
 *
 * Per the OS-research synthesis: every native shell stores TWO
 * tokens, distinct from each other:
 *
 *   device_token  → /ws/device worker authentication
 *   shell_token   → /ws/client + /api/(routes) chat-UI authentication
 *
 * For v1 we use plain SharedPreferences. v1.5 will swap to
 * EncryptedSharedPreferences from androidx.security-crypto so the
 * tokens are AES-256-GCM encrypted at rest with a key from the
 * Android Keystore. The plain version is fine for v1 because
 * Android private app storage is already process-isolated.
 *
 * The pairing flow (QR scan or paste-code) writes here. The
 * DaemonService reads here on every (re)connect.
 */
object TokenStore {

    private const val PREFS = "daemon_tokens"
    private const val KEY_DEVICE_TOKEN = "device_token"
    private const val KEY_SHELL_TOKEN = "shell_token"
    private const val KEY_RELAY_URL = "relay_url"
    private const val DEFAULT_RELAY_URL = "wss://my.daemon.page/ws/device"

    private fun prefs(ctx: Context): SharedPreferences =
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun saveDeviceToken(ctx: Context, token: String) {
        prefs(ctx).edit().putString(KEY_DEVICE_TOKEN, token).apply()
    }

    fun loadDeviceToken(ctx: Context): String? =
        prefs(ctx).getString(KEY_DEVICE_TOKEN, null)?.takeIf { it.isNotBlank() }

    fun saveShellToken(ctx: Context, token: String) {
        prefs(ctx).edit().putString(KEY_SHELL_TOKEN, token).apply()
    }

    fun loadShellToken(ctx: Context): String? =
        prefs(ctx).getString(KEY_SHELL_TOKEN, null)?.takeIf { it.isNotBlank() }

    fun saveRelayUrl(ctx: Context, url: String) {
        prefs(ctx).edit().putString(KEY_RELAY_URL, url).apply()
    }

    fun loadRelayUrl(ctx: Context): String =
        prefs(ctx).getString(KEY_RELAY_URL, DEFAULT_RELAY_URL) ?: DEFAULT_RELAY_URL

    fun isPaired(ctx: Context): Boolean = loadDeviceToken(ctx) != null

    fun clear(ctx: Context) {
        prefs(ctx).edit().clear().apply()
    }
}
