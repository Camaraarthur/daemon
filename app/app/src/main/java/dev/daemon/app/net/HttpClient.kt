package dev.daemon.app.net

import android.content.Context
import dev.daemon.app.privacy.EgressLog
import okhttp3.Interceptor
import okhttp3.OkHttpClient
import okhttp3.Response
import java.util.concurrent.TimeUnit

/**
 * Wraps the count of PII tokens redacted from the outbound body, so the
 * egress interceptor can record it. Stored as an OkHttp request tag.
 *
 * We use a typed wrapper (instead of `req.tag(Int::class.java)`) because
 * OkHttp's tag map stores values as `Any` — and Kotlin's `Int::class.java`
 * is the primitive `int.class`, so the retrieve-time auto-unbox crashes
 * with `Integer cannot be cast to int`. A real data class is unambiguous.
 */
data class PiiCountTag(val count: Int)

/**
 * Single OkHttp client for all outbound BYOK calls. Includes the egress
 * interceptor that logs every request to [EgressLog] so the audit screen
 * can render it.
 *
 * Important: no User-Agent identifying the user. A generic agent string
 * keeps the daemon installation un-fingerprintable across providers.
 */
object HttpClient {

    @Volatile private var instance: OkHttpClient? = null

    fun get(context: Context): OkHttpClient = instance ?: synchronized(this) {
        instance ?: build(context.applicationContext).also { instance = it }
    }

    private fun build(appContext: Context): OkHttpClient {
        val egressLog = EgressLog(appContext)
        return OkHttpClient.Builder()
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(60, TimeUnit.SECONDS)
            .writeTimeout(60, TimeUnit.SECONDS)
            .addInterceptor(GenericUserAgentInterceptor())
            .addInterceptor(EgressLoggingInterceptor(egressLog))
            .build()
    }

    private class GenericUserAgentInterceptor : Interceptor {
        override fun intercept(chain: Interceptor.Chain): Response {
            val req = chain.request().newBuilder()
                .header("User-Agent", "daemon/0.1")
                .build()
            return chain.proceed(req)
        }
    }

    private class EgressLoggingInterceptor(private val log: EgressLog) : Interceptor {
        override fun intercept(chain: Interceptor.Chain): Response {
            val req = chain.request()
            val piiCount = req.tag(PiiCountTag::class.java)?.count ?: 0
            val sent = req.body?.contentLength()?.coerceAtLeast(0) ?: 0
            val response = chain.proceed(req)
            val received = response.body?.contentLength()?.coerceAtLeast(0) ?: 0
            log.append(
                EgressLog.Entry(
                    tsEpochMs = System.currentTimeMillis(),
                    method = req.method,
                    host = req.url.host,
                    path = req.url.encodedPath,
                    bytesSent = sent,
                    bytesReceived = received,
                    statusCode = response.code,
                    piiRedactionsCount = piiCount,
                )
            )
            return response
        }
    }
}
