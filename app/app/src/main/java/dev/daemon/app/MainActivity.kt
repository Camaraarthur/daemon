package dev.daemon.app

import android.os.Bundle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import dev.daemon.app.ingest.IngestPrefs
import dev.daemon.app.ingest.ScreenshotWatcher
import dev.daemon.app.share.SharedIntent
import dev.daemon.app.share.SharedPayload
import dev.daemon.app.ui.BiometricLockScreen
import dev.daemon.app.ui.DaemonApp
import dev.daemon.app.vault.Vault
import dev.daemon.app.vault.VaultKey
import dev.daemon.app.vault.VaultSession
import javax.crypto.Cipher

class MainActivity : FragmentActivity() {

    private val screenshotWatcher by lazy { ScreenshotWatcher(applicationContext) }
    private val ingestPrefs by lazy { IngestPrefs(applicationContext) }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()

        val initialShare: SharedPayload? = SharedIntent.parse(intent, contentResolver)
        val vaultKey = VaultKey(this)

        try { vaultKey.ensureMasterKey() } catch (_: Throwable) { /* very rare */ }

        val biometricAvailable = canUseBiometric()

        setContent {
            MaterialTheme(
                colorScheme = darkColorScheme(
                    background = Color.Black,
                    surface = Color.Black,
                    primary = Color.White,
                    onBackground = Color.White,
                    onSurface = Color.White,
                ),
            ) {
                Surface(
                    modifier = Modifier.fillMaxSize().background(Color.Black),
                    color = Color.Black,
                ) {
                    val sessionUnlocked = remember { mutableStateOf(VaultSession.isUnlocked) }
                    val authError = remember { mutableStateOf<String?>(null) }

                    when {
                        sessionUnlocked.value -> {
                            DaemonApp(initialShare = initialShare)
                        }
                        !biometricAvailable -> {
                            BiometricLockScreen(
                                error = "no fingerprint enrolled on this device.\n" +
                                    "set one up in Android Settings → Security to enable the vault.",
                                onUnlock = { /* nothing to do without biometric */ },
                            )
                        }
                        else -> {
                            BiometricLockScreen(
                                error = authError.value,
                                onUnlock = {
                                    authError.value = null
                                    promptAndOpenVault(
                                        vaultKey = vaultKey,
                                        onSuccess = {
                                            sessionUnlocked.value = true
                                            // Start screenshot watcher if the user has it on.
                                            if (ingestPrefs.watchScreenshots) {
                                                screenshotWatcher.start()
                                            }
                                        },
                                        onError = { msg -> authError.value = msg },
                                    )
                                },
                            )
                        }
                    }
                }
            }
        }
    }

    override fun onResume() {
        super.onResume()
        if (VaultSession.isUnlocked && ingestPrefs.watchScreenshots) {
            screenshotWatcher.start()
        }
    }

    override fun onPause() {
        super.onPause()
        // v0.1: pause the observer when daemon isn't foreground. A foreground
        // service in v0.2 keeps OCR running while the app is in background.
        screenshotWatcher.stop()
    }

    override fun onDestroy() {
        super.onDestroy()
        screenshotWatcher.shutdown()
    }

    private fun canUseBiometric(): Boolean {
        val bm = BiometricManager.from(this)
        val authenticators = BiometricManager.Authenticators.BIOMETRIC_STRONG
        return bm.canAuthenticate(authenticators) == BiometricManager.BIOMETRIC_SUCCESS
    }

    private fun promptAndOpenVault(
        vaultKey: VaultKey,
        onSuccess: () -> Unit,
        onError: (String) -> Unit,
    ) {
        val firstTime = !vaultKey.hasSealedPassphrase()
        val cipher: Cipher = try {
            if (firstTime) vaultKey.encryptCipher() else vaultKey.decryptCipher()
        } catch (t: Throwable) {
            vaultKey.wipe()
            try { vaultKey.ensureMasterKey() } catch (_: Throwable) {}
            onError("biometric changed — vault was reset. tap to set up again.")
            return
        }

        val executor = ContextCompat.getMainExecutor(this)
        val prompt = BiometricPrompt(
            this,
            executor,
            object : BiometricPrompt.AuthenticationCallback() {
                override fun onAuthenticationSucceeded(
                    result: BiometricPrompt.AuthenticationResult,
                ) {
                    val unlocked = result.cryptoObject?.cipher
                        ?: return onError("biometric returned no cipher.")
                    try {
                        val passphrase = if (firstTime) {
                            val pp = vaultKey.generatePassphrase()
                            vaultKey.sealPassphrase(pp, unlocked)
                            pp
                        } else {
                            vaultKey.unsealPassphrase(unlocked)
                        }
                        val vault = Vault.open(this@MainActivity, passphrase)
                        VaultSession.bind(vault)
                        onSuccess()
                    } catch (t: Throwable) {
                        onError("vault open failed: ${t.message ?: t.javaClass.simpleName}")
                    }
                }

                override fun onAuthenticationError(code: Int, msg: CharSequence) {
                    if (code == BiometricPrompt.ERROR_USER_CANCELED ||
                        code == BiometricPrompt.ERROR_NEGATIVE_BUTTON
                    ) return
                    onError("biometric error: $msg")
                }

                override fun onAuthenticationFailed() {
                    // Single fingerprint miss — the system retries automatically.
                }
            },
        )

        val info = BiometricPrompt.PromptInfo.Builder()
            .setTitle("unlock daemon")
            .setSubtitle(
                if (firstTime) "your vault key will be created on-device, " +
                    "bound to your fingerprint"
                else "decrypt your vault",
            )
            .setNegativeButtonText("cancel")
            .setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_STRONG)
            .build()

        prompt.authenticate(info, BiometricPrompt.CryptoObject(cipher))
    }
}
