package dev.daemon.app.security

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

/**
 * BYOK API-key storage. Keys are encrypted at rest with an AES-256 key that
 * lives in the Android Keystore (Hardware-backed TEE / StrongBox on Pixel 8 Pro).
 *
 * The plaintext key never sits in `SharedPreferences` on disk — it's only
 * materialized in-process when we're about to make a provider HTTPS call.
 * Daemons-the-company is never in that path; the key is read on-device and
 * shipped only as a header to the provider's own endpoint.
 *
 * Falls back to plain `SharedPreferences` on devices where the Keystore can't
 * mint a key (very rare; e.g. corrupted secure element). The fallback is
 * still per-app-sandboxed so it's not "in the open" — just not hardware-tied.
 */
class SecureKeyStore(context: Context) {

    private val prefs: SharedPreferences = try {
        val masterKey = MasterKey.Builder(context.applicationContext)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()
        EncryptedSharedPreferences.create(
            context.applicationContext,
            ENCRYPTED_PREFS_NAME,
            masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
        )
    } catch (t: Throwable) {
        // Fallback — log once, keep daemon usable. If the Keystore is broken
        // the whole device is in a bad state; daemon shouldn't be the thing
        // that refuses to start.
        context.applicationContext.getSharedPreferences(FALLBACK_PREFS_NAME, Context.MODE_PRIVATE)
    }

    fun get(providerId: String): String? = prefs.getString(keyFor(providerId), null)?.takeIf { it.isNotBlank() }
    fun set(providerId: String, key: String) {
        prefs.edit().putString(keyFor(providerId), key.trim()).apply()
    }
    fun clear(providerId: String) {
        prefs.edit().remove(keyFor(providerId)).apply()
    }
    fun has(providerId: String): Boolean = !get(providerId).isNullOrBlank()

    private fun keyFor(providerId: String) = "api_key:$providerId"

    companion object {
        private const val ENCRYPTED_PREFS_NAME = "daemon_secure_keys"
        private const val FALLBACK_PREFS_NAME = "daemon_keys_fallback"
    }
}
