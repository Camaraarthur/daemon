package dev.daemon.app.share

import android.content.ContentResolver
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.OpenableColumns

/**
 * Output of parsing an inbound Share Sheet intent ("Share with daemon").
 * v0.1: we surface the share in chat as a tagged message. Vault import
 * happens in Step 9 (biometric + SQLCipher) — until then, file URIs are
 * read-once metadata only; the bytes don't get persisted.
 */
sealed class SharedPayload {
    data class Text(val text: String) : SharedPayload()
    data class Files(val items: List<SharedFile>) : SharedPayload()
}

data class SharedFile(
    val uri: Uri,
    val mimeType: String?,
    val name: String?,
    val sizeBytes: Long?,
)

object SharedIntent {

    fun parse(intent: Intent, contentResolver: ContentResolver): SharedPayload? {
        return when (intent.action) {
            Intent.ACTION_SEND -> {
                val text = intent.getStringExtra(Intent.EXTRA_TEXT)
                if (!text.isNullOrBlank()) return SharedPayload.Text(text)
                val uri = streamUri(intent)
                if (uri != null) {
                    return SharedPayload.Files(listOf(describe(uri, intent.type, contentResolver)))
                }
                null
            }
            Intent.ACTION_SEND_MULTIPLE -> {
                val uris = streamUris(intent)
                if (uris.isNullOrEmpty()) return null
                SharedPayload.Files(uris.map { describe(it, intent.type, contentResolver) })
            }
            else -> null
        }
    }

    private fun streamUri(intent: Intent): Uri? =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java)
        } else {
            @Suppress("DEPRECATION")
            intent.getParcelableExtra<Uri>(Intent.EXTRA_STREAM)
        }

    private fun streamUris(intent: Intent): List<Uri>? =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM, Uri::class.java)
        } else {
            @Suppress("DEPRECATION")
            intent.getParcelableArrayListExtra<Uri>(Intent.EXTRA_STREAM)
        }

    private fun describe(uri: Uri, mimeType: String?, cr: ContentResolver): SharedFile {
        var name: String? = null
        var size: Long? = null
        try {
            cr.query(uri, null, null, null, null)?.use { c ->
                if (c.moveToFirst()) {
                    val nIdx = c.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                    if (nIdx >= 0 && !c.isNull(nIdx)) name = c.getString(nIdx)
                    val sIdx = c.getColumnIndex(OpenableColumns.SIZE)
                    if (sIdx >= 0 && !c.isNull(sIdx)) size = c.getLong(sIdx)
                }
            }
        } catch (_: Throwable) {
            // Some content providers refuse the query — keep going with nulls.
        }
        return SharedFile(uri = uri, mimeType = mimeType, name = name, sizeBytes = size)
    }
}

fun SharedFile.humanSize(): String = when (val b = sizeBytes) {
    null -> "?"
    in 0 until 1024 -> "$b B"
    in 1024 until 1024L * 1024 -> "${b / 1024} KB"
    in 1024L * 1024 until 1024L * 1024 * 1024 -> "${b / (1024 * 1024)} MB"
    else -> "${b / (1024L * 1024 * 1024)} GB"
}
