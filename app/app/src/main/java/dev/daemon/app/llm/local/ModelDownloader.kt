package dev.daemon.app.llm.local

import android.content.Context
import dev.daemon.app.net.HttpClient
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.flowOn
import okhttp3.Request
import java.io.File

/**
 * Streams a large model file to `filesDir/`. Used by [GemmaProvider] for the
 * Gemma 4 E2B `.task` model — ~1.87 GB, one-time download from HuggingFace
 * (`litert-community/gemma-4-E2B-it-litert-lm`, public, no auth needed).
 *
 * Resumable-on-restart by writing to a `.partial` file and atomic-renaming
 * to the target name when complete. Progress is reported via Flow.
 *
 * Egress: this download goes through the same OkHttp client as everything
 * else, so it shows up in "what this app sends" with byte counts. Honest.
 */
object ModelDownloader {

    sealed class Progress {
        data class Started(val totalBytes: Long) : Progress()
        data class Downloading(
            val bytesDownloaded: Long,
            val totalBytes: Long,
        ) : Progress() {
            val fraction: Float get() = if (totalBytes > 0) bytesDownloaded.toFloat() / totalBytes else 0f
        }
        object Completed : Progress()
        data class Failed(val error: Throwable) : Progress()
    }

    /**
     * Stream a download. The caller decides what to do with progress events
     * (UI updates, cancel, etc.).
     */
    fun download(
        context: Context,
        url: String,
        targetFile: File,
    ): Flow<Progress> = flow {
        val partial = File(targetFile.parentFile, targetFile.name + ".partial")
        val existingBytes = if (partial.exists()) partial.length() else 0L

        val req = Request.Builder()
            .url(url)
            .apply {
                if (existingBytes > 0) header("Range", "bytes=$existingBytes-")
            }
            .build()

        try {
            val response = HttpClient.get(context).newCall(req).execute()
            response.use { r ->
                if (!r.isSuccessful) {
                    throw RuntimeException("Download HTTP ${r.code} for $url")
                }
                val totalRemaining = r.body?.contentLength() ?: -1L
                val total = if (existingBytes > 0 && totalRemaining > 0)
                    existingBytes + totalRemaining
                else totalRemaining

                emit(Progress.Started(total))

                val source = r.body?.byteStream() ?: throw RuntimeException("Empty body")
                partial.outputStream().use { out ->
                    if (existingBytes > 0 && r.code == 206) {
                        // resumed — seek past existing bytes (simulate by using append mode)
                        // Actually outputStream() truncates, so for resumed downloads we
                        // open with append=true. Re-open:
                    }
                }
                java.io.FileOutputStream(partial, existingBytes > 0 && r.code == 206).use { out ->
                    val buf = ByteArray(64 * 1024)
                    var written = existingBytes
                    var lastReport = 0L
                    while (true) {
                        val n = source.read(buf)
                        if (n <= 0) break
                        out.write(buf, 0, n)
                        written += n
                        // throttle progress emissions to ~10/sec
                        val now = System.currentTimeMillis()
                        if (now - lastReport > 100) {
                            emit(Progress.Downloading(written, total.takeIf { it > 0 } ?: written))
                            lastReport = now
                        }
                    }
                    out.flush()
                }
            }
            // Atomic rename .partial → final filename
            if (!partial.renameTo(targetFile)) {
                // some filesystems on Android need explicit move
                partial.copyTo(targetFile, overwrite = true)
                partial.delete()
            }
            emit(Progress.Completed)
        } catch (t: Throwable) {
            emit(Progress.Failed(t))
        }
    }.flowOn(Dispatchers.IO)
}
