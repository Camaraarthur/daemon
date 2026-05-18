package dev.daemon.app.vault

/**
 * Process-lifetime holder for the unlocked [Vault]. Once biometric unlock
 * succeeds and we've opened the SQLCipher database, that [Vault] handle
 * lives here until the app process dies.
 *
 * On lock event (cold start, biometric change, explicit lock) we null the
 * reference. The database file on disk remains encrypted.
 */
object VaultSession {
    @Volatile var vault: Vault? = null
        private set

    @Synchronized
    fun bind(v: Vault) {
        vault = v
    }

    @Synchronized
    fun clear() {
        vault?.close()
        vault = null
    }

    val isUnlocked: Boolean get() = vault != null
}
