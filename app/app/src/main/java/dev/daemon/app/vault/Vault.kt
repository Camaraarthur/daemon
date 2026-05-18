package dev.daemon.app.vault

import android.content.Context
import net.zetetic.database.sqlcipher.SQLiteDatabase
import net.zetetic.database.sqlcipher.SQLiteOpenHelper
import java.io.File

/**
 * SQLCipher-encrypted vault. Lives in the app's private sandbox at
 * `files/vault.db`. The 32-byte passphrase is supplied at open time by
 * [VaultKey] after biometric unlock.
 *
 * v0.1 schema:
 *   - messages(id INTEGER PK, role TEXT, text TEXT, ts INTEGER)
 *   - settings(k TEXT PK, v TEXT)
 *
 * Future: imports table for vault-stored shared files (Step 9 work), keys
 * migration from SecureKeyStore, multi-conversation table.
 */
class Vault private constructor(
    context: Context,
    private val passphrase: ByteArray,
) : SQLiteOpenHelper(
    context,
    DB_NAME,
    passphrase,
    null,
    DB_VERSION,
    0,
    null,
    null,
    false,
) {

    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL("""
            CREATE TABLE messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                role TEXT NOT NULL,
                text TEXT NOT NULL,
                ts INTEGER NOT NULL
            )
        """.trimIndent())
        db.execSQL("""
            CREATE TABLE settings (
                k TEXT PRIMARY KEY,
                v TEXT
            )
        """.trimIndent())
        db.execSQL("CREATE INDEX idx_messages_ts ON messages(ts)")
    }

    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
        // v0.1 — no migrations needed yet.
    }

    data class Row(val id: Long, val role: String, val text: String, val tsEpochMs: Long)

    fun appendMessage(role: String, text: String): Row {
        val ts = System.currentTimeMillis()
        val db = writableDatabase
        val id = db.compileStatement(
            "INSERT INTO messages(role, text, ts) VALUES(?, ?, ?)"
        ).apply {
            bindString(1, role)
            bindString(2, text)
            bindLong(3, ts)
        }.executeInsert()
        return Row(id, role, text, ts)
    }

    fun listMessages(limit: Int = 500): List<Row> {
        val out = ArrayList<Row>()
        readableDatabase.query(
            "messages", arrayOf("id", "role", "text", "ts"),
            null, null, null, null, "ts ASC", limit.toString(),
        ).use { c ->
            while (c.moveToNext()) {
                out.add(Row(c.getLong(0), c.getString(1), c.getString(2), c.getLong(3)))
            }
        }
        return out
    }

    fun clearMessages() {
        writableDatabase.execSQL("DELETE FROM messages")
    }

    fun setSetting(key: String, value: String?) {
        writableDatabase.execSQL(
            "INSERT OR REPLACE INTO settings(k, v) VALUES(?, ?)",
            arrayOf(key, value),
        )
    }

    fun getSetting(key: String): String? {
        readableDatabase.query(
            "settings", arrayOf("v"), "k = ?", arrayOf(key), null, null, null,
        ).use { c -> if (c.moveToFirst()) return c.getString(0) }
        return null
    }

    companion object {
        private const val DB_NAME = "vault.db"
        private const val DB_VERSION = 1

        @Volatile private var loadedLibs = false
        private fun loadLibsOnce(context: Context) {
            if (loadedLibs) return
            synchronized(this) {
                if (loadedLibs) return
                System.loadLibrary("sqlcipher")
                loadedLibs = true
            }
        }

        fun open(context: Context, passphrase: ByteArray): Vault {
            loadLibsOnce(context.applicationContext)
            return Vault(context.applicationContext, passphrase)
        }

        /** Path on disk — useful for debugging / verifying encryption. */
        fun dbPath(context: Context): File =
            context.applicationContext.getDatabasePath(DB_NAME)
    }
}
