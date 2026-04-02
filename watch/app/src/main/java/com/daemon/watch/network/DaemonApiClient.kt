package com.daemon.watch.network

import com.daemon.watch.BuildConfig
import com.daemon.watch.DeviceInfo
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.TimeUnit

class DaemonApiClient(private val token: String = "") {

    companion object {
        private val JSON_TYPE = "application/json; charset=utf-8".toMediaType()
        private val httpClient = OkHttpClient.Builder()
            .connectTimeout(10, TimeUnit.SECONDS)
            .readTimeout(120, TimeUnit.SECONDS)
            .writeTimeout(30, TimeUnit.SECONDS)
            .build()

        /**
         * Login to daemon server, returns token string or null.
         */
        suspend fun login(name: String, password: String): String? = withContext(Dispatchers.IO) {
            val body = JSONObject().apply {
                put("name", name)
                put("password", password)
            }.toString().toRequestBody(JSON_TYPE)

            val request = Request.Builder()
                .url("${BuildConfig.DAEMON_API_URL}/api/auth")
                .post(body)
                .build()

            val response = httpClient.newCall(request).execute()
            if (!response.isSuccessful) return@withContext null

            // Extract token from Set-Cookie header or response body
            val setCookie = response.header("Set-Cookie")
            val cookieToken = setCookie?.let { cookie ->
                cookie.split(";")
                    .firstOrNull { it.trim().startsWith("daemon_token=") }
                    ?.substringAfter("daemon_token=")
                    ?.trim()
            }

            if (cookieToken != null) return@withContext cookieToken

            // Fallback: try response body
            val responseBody = response.body?.string() ?: "{}"
            val json = JSONObject(responseBody)
            val t = json.optString("token", "")
            if (t.isNotEmpty()) t else null
        }
    }

    private fun buildRequest(url: String): Request.Builder {
        return Request.Builder()
            .url(url)
            .addHeader("Cookie", "daemon_token=$token")
    }

    /**
     * Send text message to daemon chat endpoint.
     */
    suspend fun sendText(message: String): String = withContext(Dispatchers.IO) {
        val body = JSONObject().apply {
            put("message", message)
            put("threadId", "watch-main")
        }.toString().toRequestBody(JSON_TYPE)

        val request = buildRequest("${BuildConfig.DAEMON_API_URL}/api/chat")
            .post(body)
            .build()

        val response = httpClient.newCall(request).execute()
        val json = JSONObject(response.body?.string() ?: "{}")

        when {
            response.isSuccessful -> json.optString("response", "No response")
            response.code == 401 -> "Auth expired. Re-login needed."
            else -> "Error ${response.code}: ${json.optString("error", "Unknown")}"
        }
    }

    /**
     * Poll device health endpoint.
     */
    suspend fun getDeviceHealth(): List<DeviceInfo> = withContext(Dispatchers.IO) {
        try {
            val request = buildRequest("${BuildConfig.DAEMON_API_URL}/api/health")
                .get()
                .build()

            val response = httpClient.newCall(request).execute()
            val json = JSONObject(response.body?.string() ?: "{}")
            val devices = json.optJSONArray("devices") ?: JSONArray()

            (0 until devices.length()).map { i ->
                val d = devices.getJSONObject(i)
                DeviceInfo(
                    id = d.optString("id"),
                    name = d.optString("name", "Unknown"),
                    platform = d.optString("platform", ""),
                    connected = d.optBoolean("connected", false),
                )
            }
        } catch (_: Exception) {
            emptyList()
        }
    }
}
