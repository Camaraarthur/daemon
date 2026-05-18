package dev.daemon.app.vault

import android.content.ContentResolver
import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import java.io.File
import java.io.FileOutputStream
import java.io.InputStream
import java.security.DigestInputStream
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.UUID
import javax.crypto.Cipher
import javax.crypto.CipherOutputStream
import javax.crypto.CipherInputStream
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

/**
 * Imports arbitrary URIs (audio, video, PDFs, photos, archives, whatever)
 * into the encrypted vault as L0 raw bytes. No mime gating, no rejection.
 *
 * Storage layout on disk:
 *
 *   ${filesDir}/blobs/<sha256>.enc
 *
 *     File layout:
 *       [12 bytes IV][AES-256-GCM ciphertext of the plaintext bytes]
 *
 *     Encryption key is derived per-vault via [Vault.fileBlobKey] — bound
 *     to the same biometric-gated SQLCipher passphrase, so file blobs are
 *     unreadable without a fresh fingerprint.
 *
 *   ${filesDir}/blobs/.tmp-<uuid>
 *
 *     Used during import so we can stream → hash → finalize. On rename
 *     conflict (content-addressed dedup) the temp file is deleted.
 *
 * Stored bytes are reachable later via [open], which streams decrypted
 * plaintext for follow-up pipelines (transcription, embedding, etc.).
 */
class FileStore(private val context: Context, private val vault: Vault) {

    /** Outcome of [import]. */
    data class ImportResult(
        val file: Vault.FileRow,
        /** True if a row for this sha256 already existed; new blob was discarded. */
        val deduplicated: Boolean,
    )

    /**
     * Read all bytes from [uri], compute sha256 on the plaintext, encrypt
     * with AES-256-GCM, write to the blobs dir under the content-addressed
     * name, and insert a row in the [Vault.files] table.
     *
     * If the same content (matching sha256) is already in the vault, the
     * new blob is discarded and the existing row is returned with
     * [ImportResult.deduplicated] = true.
     *
     * Throws on read failure. Does NOT apply any size limit — callers can
     * confirm-on-huge before invoking, but the store itself is agnostic.
     */
    fun import(uri: Uri, name: String?, mime: String?): ImportResult {
        val blobsDir = ensureBlobsDir()
        val tmpFile = File(blobsDir, ".tmp-${UUID.randomUUID()}")

        val key = vault.fileBlobKey()
        val iv = ByteArray(GCM_IV_BYTES).also { SecureRandom().nextBytes(it) }
        val cipher = Cipher.getInstance(AES_GCM).apply {
            init(
                Cipher.ENCRYPT_MODE,
                SecretKeySpec(key, "AES"),
                GCMParameterSpec(GCM_TAG_BITS, iv),
            )
        }

        val digest = MessageDigest.getInstance("SHA-256")
        var totalBytes = 0L

        try {
            val cr: ContentResolver = context.contentResolver
            val input: InputStream = cr.openInputStream(uri)
                ?: throw IllegalStateException("ContentResolver returned null InputStream for $uri")

            FileOutputStream(tmpFile).use { fos ->
                fos.write(iv)
                DigestInputStream(input, digest).use { dis ->
                    CipherOutputStream(fos, cipher).use { cos ->
                        val buf = ByteArray(IO_BUF)
                        while (true) {
                            val n = dis.read(buf)
                            if (n < 0) break
                            cos.write(buf, 0, n)
                            totalBytes += n
                        }
                    }
                }
            }
        } catch (t: Throwable) {
            tmpFile.delete()
            throw t
        }

        val sha256 = digest.digest().toHex()
        val finalFile = File(blobsDir, "$sha256.enc")

        if (finalFile.exists()) {
            tmpFile.delete()
            val existing = vault.findFileBySha256(sha256)
                ?: vault.appendFile(sha256, name, mime, totalBytes, blobRelPath(finalFile))
            return ImportResult(existing, deduplicated = true)
        }

        if (!tmpFile.renameTo(finalFile)) {
            tmpFile.delete()
            throw IllegalStateException("Could not finalize blob to ${finalFile.absolutePath}")
        }

        val row = vault.appendFile(sha256, name, mime, totalBytes, blobRelPath(finalFile))
        return ImportResult(row, deduplicated = false)
    }

    /**
     * Open a decrypted [InputStream] over a previously-imported file's
     * plaintext bytes. Caller is responsible for closing the stream.
     */
    fun open(file: Vault.FileRow): InputStream {
        val blob = File(context.filesDir, file.blobPath)
        val fis = blob.inputStream()
        val iv = ByteArray(GCM_IV_BYTES)
        val read = fis.read(iv)
        if (read != GCM_IV_BYTES) {
            fis.close()
            throw IllegalStateException("Truncated blob at ${file.blobPath}")
        }
        val key = vault.fileBlobKey()
        val cipher = Cipher.getInstance(AES_GCM).apply {
            init(
                Cipher.DECRYPT_MODE,
                SecretKeySpec(key, "AES"),
                GCMParameterSpec(GCM_TAG_BITS, iv),
            )
        }
        return CipherInputStream(fis, cipher)
    }

    private fun ensureBlobsDir(): File {
        val dir = File(context.filesDir, BLOBS_DIR)
        if (!dir.exists()) dir.mkdirs()
        return dir
    }

    private fun blobRelPath(absolute: File): String =
        "$BLOBS_DIR/${absolute.name}"

    /** Probe a URI for display metadata. Best-effort; null on hostile providers. */
    fun probeMetadata(uri: Uri): UriMetadata {
        var name: String? = null
        var size: Long? = null
        try {
            context.contentResolver.query(uri, null, null, null, null)?.use { c ->
                if (c.moveToFirst()) {
                    val nIdx = c.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                    if (nIdx >= 0 && !c.isNull(nIdx)) name = c.getString(nIdx)
                    val sIdx = c.getColumnIndex(OpenableColumns.SIZE)
                    if (sIdx >= 0 && !c.isNull(sIdx)) size = c.getLong(sIdx)
                }
            }
        } catch (_: Throwable) { /* swallow — some CPs refuse the query */ }
        val mime = try { context.contentResolver.getType(uri) } catch (_: Throwable) { null }
        return UriMetadata(name = name, mime = mime, sizeBytes = size)
    }

    data class UriMetadata(val name: String?, val mime: String?, val sizeBytes: Long?)

    companion object {
        private const val BLOBS_DIR = "blobs"
        private const val AES_GCM = "AES/GCM/NoPadding"
        private const val GCM_IV_BYTES = 12
        private const val GCM_TAG_BITS = 128
        private const val IO_BUF = 64 * 1024
    }
}

private fun ByteArray.toHex(): String {
    val sb = StringBuilder(this.size * 2)
    for (b in this) {
        val v = b.toInt() and 0xFF
        sb.append(HEX[v ushr 4])
        sb.append(HEX[v and 0x0F])
    }
    return sb.toString()
}

private val HEX = "0123456789abcdef".toCharArray()
