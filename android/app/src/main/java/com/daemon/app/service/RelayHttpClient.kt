package com.daemon.app.service

import android.content.Context
import android.content.SharedPreferences
import android.util.Log
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/**
 * Session token exchange + authenticated HTTP calls to the relay.
 *
 * Flow: native apps are paired via device_token (in TokenStore). That
 * token authenticates the /ws/device socket. For HTTP routes that are
 * cookie-authenticated (chat, voice/command, threads, …), we trade the
 * device_token for a session cookie at /api/auth action=device_token_exchange.
 *
 * This object caches the session token in SharedPreferences so we don't
 * re-exchange on every request. A 401 triggers a re-exchange.
 */
object RelayHttpClient {

    private const val TAG = "RelayHttp"
    private const val PREFS = "daemon_tokens"
    private const val KEY_SESSION = "daemon_session_token"

    private val httpClient: OkHttpClient by lazy {
        OkHttpClient.Builder()
            .connectTimeout(10, TimeUnit.SECONDS)
            .readTimeout(30, TimeUnit.SECONDS)
            .build()
    }

    private val JSON = "application/json; charset=utf-8".toMediaType()

    private fun prefs(ctx: Context): SharedPreferences =
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun loadSessionToken(ctx: Context): String? =
        prefs(ctx).getString(KEY_SESSION, null)?.takeIf { it.isNotBlank() }

    fun saveSessionToken(ctx: Context, token: String) {
        prefs(ctx).edit().putString(KEY_SESSION, token).apply()
    }

    fun clearSessionToken(ctx: Context) {
        prefs(ctx).edit().remove(KEY_SESSION).apply()
    }

    /**
     * Derive the relay HTTP base URL from the stored WS URL by stripping
     * `ws://` → `http://`, `wss://` → `https://`, and dropping the
     * `/ws/device` path suffix.
     */
    fun relayHttpUrl(ctx: Context): String {
        val ws = TokenStore.loadRelayUrl(ctx)
        val http = ws
            .replaceFirst(Regex("^wss://"), "https://")
            .replaceFirst(Regex("^ws://"), "http://")
        return http.removeSuffix("/ws/device").trimEnd('/')
    }

    /**
     * POST /api/auth with action=device_token_exchange. Returns the
     * minted session token, or null on failure. Caches the result.
     */
    @Synchronized
    fun exchangeSessionToken(ctx: Context): String? {
        val deviceToken = TokenStore.loadDeviceToken(ctx) ?: run {
            Log.w(TAG, "No device_token — cannot exchange session token")
            return null
        }
        val url = "${relayHttpUrl(ctx)}/api/auth"
        val payload = JSONObject().apply { put("action", "device_token_exchange") }
        val request = Request.Builder()
            .url(url)
            .header("Authorization", "Bearer $deviceToken")
            .post(payload.toString().toRequestBody(JSON))
            .build()
        return try {
            httpClient.newCall(request).execute().use { resp ->
                if (!resp.isSuccessful) {
                    Log.w(TAG, "device_token_exchange HTTP ${resp.code}")
                    return null
                }
                val body = resp.body?.string() ?: return null
                val json = JSONObject(body)
                val token = json.optString("token", "")
                if (token.isBlank()) {
                    Log.w(TAG, "device_token_exchange response missing token")
                    return null
                }
                saveSessionToken(ctx, token)
                Log.d(TAG, "Session token minted and cached")
                token
            }
        } catch (e: Exception) {
            Log.e(TAG, "Session exchange failed: ${e.message}")
            null
        }
    }

    /**
     * Get a session token, exchanging if missing. Does NOT re-exchange
     * on every call — the token is stable for 30 days.
     */
    fun getOrExchangeSessionToken(ctx: Context): String? {
        return loadSessionToken(ctx) ?: exchangeSessionToken(ctx)
    }

    /**
     * Authenticated POST with JSON body. On 401, clears cache, re-exchanges,
     * and retries exactly once. Fire-and-forget style: returns the HTTP
     * status code or -1 on network error.
     */
    fun postAuthenticated(
        ctx: Context,
        path: String,
        body: JSONObject,
    ): Int {
        var session = getOrExchangeSessionToken(ctx)
            ?: return -1

        fun doRequest(token: String): Int {
            val url = "${relayHttpUrl(ctx)}$path"
            val request = Request.Builder()
                .url(url)
                .header("Cookie", "daemon_token=$token")
                .post(body.toString().toRequestBody(JSON))
                .build()
            return try {
                httpClient.newCall(request).execute().use { resp -> resp.code }
            } catch (e: Exception) {
                Log.e(TAG, "POST $path failed: ${e.message}")
                -1
            }
        }

        val code = doRequest(session)
        if (code != 401) return code

        // Session expired/invalid — re-exchange and retry once.
        Log.d(TAG, "Got 401 on $path, re-exchanging session token")
        clearSessionToken(ctx)
        session = exchangeSessionToken(ctx) ?: return 401
        return doRequest(session)
    }
}
