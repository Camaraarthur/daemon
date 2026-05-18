package dev.daemon.app.vault

import android.content.Context
import net.zetetic.database.sqlcipher.SQLiteDatabase
import net.zetetic.database.sqlcipher.SQLiteOpenHelper
import java.io.File
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

/**
 * SQLCipher-encrypted vault. Lives in the app's private sandbox at
 * `files/vault.db`. The 32-byte passphrase is supplied at open time by
 * [VaultKey] after biometric unlock.
 *
 * Schema:
 *
 *   v1 (legacy):
 *     - messages(id, role, text, ts)
 *     - settings(k, v)
 *
 *   v2 — data-pit:
 *     - files(id, sha256, name, mime, size_bytes, blob_path, imported_at)
 *         L0 raw bytes — every share-sheet drop, OCR image, mic recording.
 *         Bytes themselves live encrypted on disk under blob_path; this
 *         row is the index.
 *     - message_files(msg_id, file_id, ord)
 *         Junction so a message can reference one or more imported files.
 *     - derivations(id, file_id, kind, model, text, blob, meta, created_at)
 *         L1 (transcript, OCR, embedding, diarization) and L2 (summary,
 *         persona, cross-doc thread) layers — empty in this PR; populated
 *         by future transcription / embedding / synthesis work.
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
        applyV2(db)
    }

    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
        if (oldVersion < 2) applyV2(db)
    }

    private fun applyV2(db: SQLiteDatabase) {
        db.execSQL("""
            CREATE TABLE IF NOT EXISTS files (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                sha256 TEXT NOT NULL UNIQUE,
                name TEXT,
                mime TEXT,
                size_bytes INTEGER NOT NULL,
                blob_path TEXT NOT NULL,
                imported_at INTEGER NOT NULL
            )
        """.trimIndent())
        db.execSQL("""
            CREATE TABLE IF NOT EXISTS message_files (
                msg_id INTEGER NOT NULL,
                file_id INTEGER NOT NULL,
                ord INTEGER NOT NULL,
                PRIMARY KEY (msg_id, file_id),
                FOREIGN KEY (msg_id) REFERENCES messages(id) ON DELETE CASCADE,
                FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE RESTRICT
            )
        """.trimIndent())
        db.execSQL("""
            CREATE TABLE IF NOT EXISTS derivations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                file_id INTEGER NOT NULL,
                kind TEXT NOT NULL,
                model TEXT,
                text TEXT,
                blob BLOB,
                meta TEXT,
                created_at INTEGER NOT NULL,
                FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE
            )
        """.trimIndent())
        db.execSQL("CREATE INDEX IF NOT EXISTS idx_files_sha256 ON files(sha256)")
        db.execSQL("CREATE INDEX IF NOT EXISTS idx_message_files_msg ON message_files(msg_id)")
        db.execSQL("CREATE INDEX IF NOT EXISTS idx_derivations_file ON derivations(file_id)")
        db.execSQL("CREATE INDEX IF NOT EXISTS idx_derivations_kind ON derivations(kind)")
    }

    data class Row(val id: Long, val role: String, val text: String, val tsEpochMs: Long)

    data class FileRow(
        val id: Long,
        val sha256: String,
        val name: String?,
        val mime: String?,
        val sizeBytes: Long,
        val blobPath: String,
        val importedAtEpochMs: Long,
    )

    data class DerivationRow(
        val id: Long,
        val fileId: Long,
        val kind: String,
        val model: String?,
        val text: String?,
        val blob: ByteArray?,
        val meta: String?,
        val createdAtEpochMs: Long,
    )

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

    /**
     * Insert a row for a freshly imported blob. Caller has already written
     * the encrypted bytes to disk at [blobPath] (relative to the app's
     * files dir). If a row with the same [sha256] already exists, returns
     * that existing row instead — true content-addressed dedup.
     */
    fun appendFile(
        sha256: String,
        name: String?,
        mime: String?,
        sizeBytes: Long,
        blobPath: String,
    ): FileRow {
        findFileBySha256(sha256)?.let { return it }
        val ts = System.currentTimeMillis()
        val db = writableDatabase
        val id = db.compileStatement(
            "INSERT INTO files(sha256, name, mime, size_bytes, blob_path, imported_at) " +
                "VALUES(?, ?, ?, ?, ?, ?)",
        ).apply {
            bindString(1, sha256)
            if (name != null) bindString(2, name) else bindNull(2)
            if (mime != null) bindString(3, mime) else bindNull(3)
            bindLong(4, sizeBytes)
            bindString(5, blobPath)
            bindLong(6, ts)
        }.executeInsert()
        return FileRow(id, sha256, name, mime, sizeBytes, blobPath, ts)
    }

    fun findFileBySha256(sha256: String): FileRow? {
        readableDatabase.query(
            "files",
            arrayOf("id", "sha256", "name", "mime", "size_bytes", "blob_path", "imported_at"),
            "sha256 = ?", arrayOf(sha256), null, null, null, "1",
        ).use { c ->
            if (!c.moveToFirst()) return null
            return FileRow(
                id = c.getLong(0),
                sha256 = c.getString(1),
                name = if (c.isNull(2)) null else c.getString(2),
                mime = if (c.isNull(3)) null else c.getString(3),
                sizeBytes = c.getLong(4),
                blobPath = c.getString(5),
                importedAtEpochMs = c.getLong(6),
            )
        }
    }

    fun getFile(id: Long): FileRow? {
        readableDatabase.query(
            "files",
            arrayOf("id", "sha256", "name", "mime", "size_bytes", "blob_path", "imported_at"),
            "id = ?", arrayOf(id.toString()), null, null, null, "1",
        ).use { c ->
            if (!c.moveToFirst()) return null
            return FileRow(
                id = c.getLong(0),
                sha256 = c.getString(1),
                name = if (c.isNull(2)) null else c.getString(2),
                mime = if (c.isNull(3)) null else c.getString(3),
                sizeBytes = c.getLong(4),
                blobPath = c.getString(5),
                importedAtEpochMs = c.getLong(6),
            )
        }
    }

    /** Link a previously-imported file to a message. Ord = position in the message. */
    fun attachFileToMessage(msgId: Long, fileId: Long, ord: Int) {
        writableDatabase.execSQL(
            "INSERT OR IGNORE INTO message_files(msg_id, file_id, ord) VALUES(?, ?, ?)",
            arrayOf<Any>(msgId, fileId, ord),
        )
    }

    fun listFilesForMessage(msgId: Long): List<FileRow> {
        val out = ArrayList<FileRow>()
        readableDatabase.rawQuery(
            "SELECT f.id, f.sha256, f.name, f.mime, f.size_bytes, f.blob_path, f.imported_at " +
                "FROM files f JOIN message_files m ON m.file_id = f.id " +
                "WHERE m.msg_id = ? ORDER BY m.ord ASC",
            arrayOf(msgId.toString()),
        ).use { c ->
            while (c.moveToNext()) {
                out.add(
                    FileRow(
                        id = c.getLong(0),
                        sha256 = c.getString(1),
                        name = if (c.isNull(2)) null else c.getString(2),
                        mime = if (c.isNull(3)) null else c.getString(3),
                        sizeBytes = c.getLong(4),
                        blobPath = c.getString(5),
                        importedAtEpochMs = c.getLong(6),
                    ),
                )
            }
        }
        return out
    }

    /**
     * Record a derived artifact for a file — transcript, OCR text,
     * embedding, summary, persona excerpt. Kind is a free-form string
     * (conventions in [DerivationKind]). Populate either [text] or [blob]
     * depending on whether the derivation is textual or binary.
     */
    fun appendDerivation(
        fileId: Long,
        kind: String,
        model: String? = null,
        text: String? = null,
        blob: ByteArray? = null,
        meta: String? = null,
    ): Long {
        val ts = System.currentTimeMillis()
        val db = writableDatabase
        return db.compileStatement(
            "INSERT INTO derivations(file_id, kind, model, text, blob, meta, created_at) " +
                "VALUES(?, ?, ?, ?, ?, ?, ?)",
        ).apply {
            bindLong(1, fileId)
            bindString(2, kind)
            if (model != null) bindString(3, model) else bindNull(3)
            if (text != null) bindString(4, text) else bindNull(4)
            if (blob != null) bindBlob(5, blob) else bindNull(5)
            if (meta != null) bindString(6, meta) else bindNull(6)
            bindLong(7, ts)
        }.executeInsert()
    }

    fun listDerivationsForFile(fileId: Long, kind: String? = null): List<DerivationRow> {
        val out = ArrayList<DerivationRow>()
        val selection = if (kind == null) "file_id = ?" else "file_id = ? AND kind = ?"
        val args = if (kind == null) {
            arrayOf(fileId.toString())
        } else {
            arrayOf(fileId.toString(), kind)
        }
        readableDatabase.query(
            "derivations",
            arrayOf("id", "file_id", "kind", "model", "text", "blob", "meta", "created_at"),
            selection, args, null, null, "created_at ASC",
        ).use { c ->
            while (c.moveToNext()) {
                out.add(
                    DerivationRow(
                        id = c.getLong(0),
                        fileId = c.getLong(1),
                        kind = c.getString(2),
                        model = if (c.isNull(3)) null else c.getString(3),
                        text = if (c.isNull(4)) null else c.getString(4),
                        blob = if (c.isNull(5)) null else c.getBlob(5),
                        meta = if (c.isNull(6)) null else c.getString(6),
                        createdAtEpochMs = c.getLong(7),
                    ),
                )
            }
        }
        return out
    }

    /**
     * Derived key for encrypting file blobs on disk. Separate from
     * SQLCipher's use of [passphrase] via HMAC-SHA-256 domain separation.
     * Internal to the vault package so [FileStore] can access it without
     * exposing the raw passphrase outside.
     */
    internal fun fileBlobKey(): ByteArray {
        val mac = Mac.getInstance("HmacSHA256")
        mac.init(SecretKeySpec(passphrase, "HmacSHA256"))
        return mac.doFinal(FILE_BLOB_KEY_INFO.toByteArray(Charsets.UTF_8))
    }

    companion object {
        private const val DB_NAME = "vault.db"
        private const val DB_VERSION = 2
        private const val FILE_BLOB_KEY_INFO = "daemon-file-blob-v1"

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

/**
 * Conventional kinds for [Vault.appendDerivation] — string constants only
 * (free-form so future pipelines aren't blocked on an enum migration).
 */
object DerivationKind {
    // L1 — directly derived from raw bytes
    const val TRANSCRIPT = "transcript"     // ASR output (WhisperX, Deepgram, etc.)
    const val OCR = "ocr"                   // image/page → text
    const val DIARIZATION = "diarization"   // speaker turns + labels
    const val EMBEDDING = "embedding"       // vector (blob = packed floats, meta = dim+model)

    // L2 — model-synthesized
    const val SUMMARY = "summary"
    const val PERSONA = "persona"           // persona-aligned excerpts
    const val TAGS = "tags"
}
