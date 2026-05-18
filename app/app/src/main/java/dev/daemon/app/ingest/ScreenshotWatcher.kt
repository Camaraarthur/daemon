package dev.daemon.app.ingest

import android.content.Context
import android.database.ContentObserver
import android.graphics.BitmapFactory
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.provider.MediaStore
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import dev.daemon.app.vault.Vault
import dev.daemon.app.vault.VaultSession
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

/**
 * Watches `MediaStore.Images` for new screenshots and OCRs them on-device with
 * ML Kit Text Recognition v2 (Latin). OCR text is appended to the vault as a
 * SYSTEM message so the model can pick it up as context on the next turn.
 *
 * Nothing leaves the device. ML Kit's text-recognition library runs entirely
 * on-device — no Google Play Services call out, no network.
 *
 * Scope filter: only items in `RELATIVE_PATH` starting with "Pictures/Screenshots/"
 * (the Android-standard screenshot dir). Other gallery images are ignored.
 *
 * Dedup: the vault.settings table holds the last-processed `date_added` epoch;
 * we only OCR images newer than that.
 *
 * v0.1 limitation: only fires when the app is in the foreground (the observer
 * lives on the activity). v0.2 will move this to a foreground service so it
 * keeps ingesting while daemon is in the background.
 */
class ScreenshotWatcher(private val context: Context) {

    private val cr = context.contentResolver
    private val recognizer =
        TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var observer: ContentObserver? = null

    fun start() {
        if (observer != null) return
        val obs = object : ContentObserver(Handler(Looper.getMainLooper())) {
            override fun onChange(selfChange: Boolean, uri: Uri?) {
                super.onChange(selfChange, uri)
                scope.launch { processNew() }
            }
        }
        cr.registerContentObserver(
            MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
            /* notifyForDescendants */ true,
            obs,
        )
        observer = obs
        // Run an initial sweep in case screenshots landed before we registered.
        scope.launch { processNew() }
    }

    fun stop() {
        observer?.let { cr.unregisterContentObserver(it) }
        observer = null
    }

    fun shutdown() {
        stop()
        runCatching { recognizer.close() }
    }

    private suspend fun processNew() {
        val vault = VaultSession.vault ?: return
        val lastProcessed = vault.getSetting(KEY_LAST_TS)?.toLongOrNull() ?: 0L

        val projection = arrayOf(
            MediaStore.Images.Media._ID,
            MediaStore.Images.Media.DISPLAY_NAME,
            MediaStore.Images.Media.RELATIVE_PATH,
            MediaStore.Images.Media.DATE_ADDED,
        )
        val selection =
            "${MediaStore.Images.Media.RELATIVE_PATH} LIKE ? " +
                "AND ${MediaStore.Images.Media.DATE_ADDED} > ?"
        val args = arrayOf("Pictures/Screenshots/%", (lastProcessed / 1000L).toString())
        val sort = "${MediaStore.Images.Media.DATE_ADDED} ASC"

        cr.query(
            MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
            projection, selection, args, sort,
        )?.use { c ->
            val idColumn = c.getColumnIndexOrThrow(MediaStore.Images.Media._ID)
            val nameColumn = c.getColumnIndexOrThrow(MediaStore.Images.Media.DISPLAY_NAME)
            val tsColumn = c.getColumnIndexOrThrow(MediaStore.Images.Media.DATE_ADDED)
            var lastSeen = lastProcessed
            while (c.moveToNext()) {
                val id = c.getLong(idColumn)
                val name = c.getString(nameColumn) ?: "screenshot.png"
                val tsSec = c.getLong(tsColumn)
                val uri = Uri.withAppendedPath(
                    MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
                    id.toString(),
                )
                try {
                    val ocr = ocrFromUri(uri)
                    if (ocr.isNotBlank()) {
                        appendToVault(vault, name, ocr)
                    }
                } catch (_: Throwable) {
                    // skip unreadable screenshot; don't poison the cursor
                }
                lastSeen = (tsSec * 1000L).coerceAtLeast(lastSeen)
            }
            vault.setSetting(KEY_LAST_TS, lastSeen.toString())
        }
    }

    private suspend fun ocrFromUri(uri: Uri): String {
        val bytes = cr.openInputStream(uri)?.use { it.readBytes() }
            ?: return ""
        val bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
            ?: return ""
        val image = InputImage.fromBitmap(bitmap, 0)
        return suspendCancellableCoroutine { cont ->
            recognizer.process(image)
                .addOnSuccessListener { cont.resume(it.text) }
                .addOnFailureListener { cont.resumeWithException(it) }
        }
    }

    private fun appendToVault(vault: Vault, name: String, ocr: String) {
        val text = "📸 $name\n${ocr.take(MAX_OCR_CHARS)}"
        vault.appendMessage("system", text)
    }

    companion object {
        private const val KEY_LAST_TS = "screenshot_watcher_last_ts_ms"
        private const val MAX_OCR_CHARS = 4000 // keep one screenshot from filling context
    }
}
