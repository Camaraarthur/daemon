package dev.daemon.app.vault

import android.content.Context
import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import java.security.SecureRandom

/**
 * Owns the Android Keystore master key used to seal the SQLCipher passphrase.
 *
 * Architecture:
 *  - A random 32-byte passphrase is generated once and used as the SQLCipher
 *    database key.
 *  - The passphrase is encrypted with an AES-256-GCM key in the Android
 *    Keystore (hardware-backed on Pixel 8 Pro). That Keystore key is bound
 *    to biometric auth: every call to [encryptCipher] / [decryptCipher]
 *    requires a fresh BiometricPrompt unlock.
 *  - The wrapped blob (iv || ciphertext) lives in plain SharedPreferences —
 *    no security loss because without the Keystore key it's useless.
 *  - On biometric enrollment change the Keystore key is auto-invalidated;
 *    the database becomes unreadable, the user starts fresh. (v0.1; key
 *    rotation/migration UX is post-MVP.)
 */
class VaultKey(private val context: Context) {

    /** Ensure the Keystore master key exists. Idempotent. */
    fun ensureMasterKey() {
        val ks = KeyStore.getInstance(KEYSTORE).apply { load(null) }
        if (ks.containsAlias(ALIAS)) return

        val builder = KeyGenParameterSpec.Builder(
            ALIAS,
            KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
        )
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256)
            .setUserAuthenticationRequired(true)
            .setInvalidatedByBiometricEnrollment(true)

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            // 0s timeout = require fresh biometric per operation (strongest).
            builder.setUserAuthenticationParameters(
                0,
                KeyProperties.AUTH_BIOMETRIC_STRONG,
            )
        } else {
            @Suppress("DEPRECATION")
            builder.setUserAuthenticationValidityDurationSeconds(-1)
        }

        val gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE)
        gen.init(builder.build())
        gen.generateKey()
    }

    fun hasSealedPassphrase(): Boolean = readWrappedBlob() != null

    /**
     * Wrap a freshly-generated passphrase with the (just-unlocked) cipher and
     * persist it. The cipher must come from [encryptCipher] AND have already
     * been unlocked by a successful BiometricPrompt call.
     */
    fun sealPassphrase(passphrase: ByteArray, unlockedCipher: Cipher) {
        val ciphertext = unlockedCipher.doFinal(passphrase)
        val iv = unlockedCipher.iv
        // Layout: [1-byte iv-length][iv][ciphertext]
        val out = ByteArray(1 + iv.size + ciphertext.size)
        out[0] = iv.size.toByte()
        System.arraycopy(iv, 0, out, 1, iv.size)
        System.arraycopy(ciphertext, 0, out, 1 + iv.size, ciphertext.size)
        writeWrappedBlob(out)
    }

    /**
     * Reverse of [sealPassphrase]. [unlockedCipher] must come from
     * [decryptCipher] AND have been unlocked by BiometricPrompt.
     */
    fun unsealPassphrase(unlockedCipher: Cipher): ByteArray {
        val blob = readWrappedBlob()
            ?: throw IllegalStateException("No wrapped passphrase to unseal — vault may have been wiped.")
        val ivLen = blob[0].toInt() and 0xFF
        val ciphertext = ByteArray(blob.size - 1 - ivLen)
        System.arraycopy(blob, 1 + ivLen, ciphertext, 0, ciphertext.size)
        return unlockedCipher.doFinal(ciphertext)
    }

    /**
     * Initialised but NOT yet authenticated. Pass to BiometricPrompt as the
     * CryptoObject; on success [sealPassphrase] uses the now-unlocked cipher.
     */
    fun encryptCipher(): Cipher {
        val cipher = Cipher.getInstance(TRANSFORM)
        cipher.init(Cipher.ENCRYPT_MODE, getMasterKey())
        return cipher
    }

    /** Same shape as [encryptCipher] but for unsealing. */
    fun decryptCipher(): Cipher {
        val blob = readWrappedBlob()
            ?: throw IllegalStateException("No wrapped passphrase yet — call sealPassphrase first.")
        val ivLen = blob[0].toInt() and 0xFF
        val iv = ByteArray(ivLen)
        System.arraycopy(blob, 1, iv, 0, ivLen)
        val cipher = Cipher.getInstance(TRANSFORM)
        cipher.init(Cipher.DECRYPT_MODE, getMasterKey(), GCMParameterSpec(128, iv))
        return cipher
    }

    fun generatePassphrase(): ByteArray = ByteArray(32).also { SecureRandom().nextBytes(it) }

    /** Nuke the wrapped passphrase + Keystore key. Use on full reset. */
    fun wipe() {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit().remove(KEY_WRAPPED).apply()
        try {
            val ks = KeyStore.getInstance(KEYSTORE).apply { load(null) }
            ks.deleteEntry(ALIAS)
        } catch (_: Throwable) { /* idempotent */ }
    }

    private fun getMasterKey(): SecretKey {
        val ks = KeyStore.getInstance(KEYSTORE).apply { load(null) }
        return ks.getKey(ALIAS, null) as SecretKey
    }

    private fun readWrappedBlob(): ByteArray? {
        val b64 = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getString(KEY_WRAPPED, null) ?: return null
        return try { Base64.decode(b64, Base64.DEFAULT) } catch (_: Throwable) { null }
    }

    private fun writeWrappedBlob(blob: ByteArray) {
        val b64 = Base64.encodeToString(blob, Base64.DEFAULT)
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit().putString(KEY_WRAPPED, b64).apply()
    }

    companion object {
        private const val KEYSTORE = "AndroidKeyStore"
        private const val ALIAS = "dev.daemon.app.vault.master.v1"
        private const val PREFS = "daemon_vault_meta"
        private const val KEY_WRAPPED = "wrapped_passphrase"
        private const val TRANSFORM = "AES/GCM/NoPadding"
    }
}
