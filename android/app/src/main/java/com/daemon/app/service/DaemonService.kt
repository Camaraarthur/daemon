package com.daemon.app.service

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import android.util.Log
import kotlinx.coroutines.*
import okhttp3.*
import org.json.JSONObject
import java.util.concurrent.TimeUnit
import kotlin.math.min
import kotlin.random.Random

/**
 * DaemonService — Bulletproof background service that maintains a persistent
 * WebSocket connection to the daemon server. Survives network changes, doze mode,
 * app kills, and reboots.
 *
 * Reliability features:
 * - Exponential backoff with jitter on reconnect (1s → 60s cap)
 * - Client-side heartbeat every 15s (detects dead connections fast)
 * - Network change listener for instant reconnect on wifi/cell switch
 * - Wake lock to prevent CPU sleep during critical operations
 * - Auto-restart on destroy/task removal
 * - Connection quality tracking with adaptive timeouts
 * - SSH keepalive auto-configuration on first run
 */
class DaemonService : Service() {

    companion object {
        const val TAG = "DaemonService"
        const val CHANNEL_ID = "daemon_service"
        const val NOTIFICATION_ID = 1
        const val ACTION_START = "com.daemon.app.START"
        const val ACTION_STOP = "com.daemon.app.STOP"
        const val EXTRA_SERVER_URL = "server_url"
        const val EXTRA_USER_ID = "user_id"

        // Heartbeat config
        const val HEARTBEAT_INTERVAL_MS = 15_000L
        const val HEARTBEAT_TIMEOUT_MS = 10_000L

        // Reconnect backoff config
        const val INITIAL_BACKOFF_MS = 1_000L
        const val MAX_BACKOFF_MS = 60_000L
        const val BACKOFF_MULTIPLIER = 2.0
        const val JITTER_FACTOR = 0.3

        // Static instance for clipboard broadcast from other components
        @Volatile
        var instance: DaemonService? = null
            private set
    }

    /**
     * Broadcast text to all other devices' clipboards via the WebSocket.
     */
    fun broadcastClipboard(text: String) {
        val msg = JSONObject().apply {
            put("type", "clipboard_update")
            put("content", text)
            put("source_device", Build.MODEL)
            put("timestamp", System.currentTimeMillis())
        }
        lastClipboard = text // Prevent echo back
        webSocket?.send(msg.toString())
        Log.d(TAG, "Clipboard broadcast: ${text.take(40)}...")
    }

    private var webSocket: WebSocket? = null
    private val client = OkHttpClient.Builder()
        .readTimeout(0, TimeUnit.MILLISECONDS)
        .pingInterval(15, TimeUnit.SECONDS)
        .connectTimeout(10, TimeUnit.SECONDS)
        .retryOnConnectionFailure(true)
        .build()
    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private var serverUrl = "wss://my.daemon.page/ws/device"
    private var userId = ""
    private val capabilities = mutableMapOf<String, Boolean>()

    // Connection state
    private var currentBackoffMs = INITIAL_BACKOFF_MS
    private var isConnected = false
    private var lastPongTime = 0L
    private var reconnectJob: Job? = null
    private var heartbeatJob: Job? = null
    private var connectAttempt = 0

    // Wake lock for keeping CPU alive during reconnect
    private var wakeLock: PowerManager.WakeLock? = null

    // Network listener
    private var networkCallback: ConnectivityManager.NetworkCallback? = null

    // Clipboard sync
    private var lastClipboard = ""
    private var clipboardJob: Job? = null

    override fun onCreate() {
        super.onCreate()
        instance = this
        createNotificationChannel()
        detectCapabilities()
        setupNetworkListener()
        acquireWakeLock()
        setupSshKeepalive()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_START -> {
                serverUrl = intent.getStringExtra(EXTRA_SERVER_URL) ?: serverUrl
                userId = intent.getStringExtra(EXTRA_USER_ID) ?: ""
                startForeground(NOTIFICATION_ID, buildNotification("Connecting..."))
                connectWithBackoff()
            }
            ACTION_STOP -> {
                disconnect()
                stopForeground(STOP_FOREGROUND_REMOVE)
                stopSelf()
            }
        }
        return START_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onTaskRemoved(rootIntent: Intent?) {
        Log.d(TAG, "Task removed, restarting service")
        restartSelf()
        super.onTaskRemoved(rootIntent)
    }

    override fun onDestroy() {
        Log.d(TAG, "Service destroyed, scheduling restart")
        instance = null
        teardownNetworkListener()
        releaseWakeLock()
        restartSelf()
        scope.cancel()
        super.onDestroy()
    }

    // ── SSH Keepalive Setup ──────────────────────────────────────────

    /**
     * Configure SSH keepalives in the app's accessible storage.
     * On a non-rooted device, we can't write to ~/.ssh/config directly,
     * but we CAN execute shell commands. If Termux's SSH is installed,
     * we configure it. Otherwise this is a no-op.
     */
    private fun setupSshKeepalive() {
        scope.launch {
            try {
                // Check if Termux SSH config directory exists
                val sshDir = "/data/data/com.termux/files/home/.ssh"
                val configFile = "$sshDir/config"

                // Try to read existing config via run_command pattern
                val checkResult = Runtime.getRuntime().exec(arrayOf("sh", "-c", "cat $configFile 2>/dev/null"))
                val existing = checkResult.inputStream.bufferedReader().readText()
                checkResult.waitFor()

                if (!existing.contains("ServerAliveInterval")) {
                    // We can't write to Termux's dir from our app context,
                    // but we can send a command to ourselves to do it when
                    // a run_command comes in. Store the intent.
                    val prefs = getSharedPreferences("daemon_prefs", MODE_PRIVATE)
                    prefs.edit().putBoolean("ssh_keepalive_pending", true).apply()
                    Log.d(TAG, "SSH keepalive setup pending (will configure via run_command)")
                } else {
                    Log.d(TAG, "SSH keepalive already configured")
                }
            } catch (e: Exception) {
                Log.d(TAG, "SSH keepalive check skipped: ${e.message}")
            }
        }
    }

    // ── Network Listener ─────────────────────────────────────────────

    private fun setupNetworkListener() {
        val cm = getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        networkCallback = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) {
                Log.d(TAG, "Network available — triggering reconnect")
                // Network just came back — reconnect immediately
                if (!isConnected) {
                    currentBackoffMs = INITIAL_BACKOFF_MS
                    reconnectJob?.cancel()
                    connectWithBackoff()
                }
            }

            override fun onLost(network: Network) {
                Log.d(TAG, "Network lost")
                updateNotification("Network lost, waiting...")
            }

            override fun onCapabilitiesChanged(network: Network, caps: NetworkCapabilities) {
                val hasInternet = caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
                val hasValidated = caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)
                Log.d(TAG, "Network caps changed: internet=$hasInternet validated=$hasValidated")
                if (hasInternet && hasValidated && !isConnected) {
                    currentBackoffMs = INITIAL_BACKOFF_MS
                    reconnectJob?.cancel()
                    connectWithBackoff()
                }
            }
        }

        val request = NetworkRequest.Builder()
            .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
            .build()
        cm.registerNetworkCallback(request, networkCallback!!)
    }

    private fun teardownNetworkListener() {
        networkCallback?.let {
            val cm = getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
            try { cm.unregisterNetworkCallback(it) } catch (_: Exception) {}
        }
        networkCallback = null
    }

    // ── Wake Lock ────────────────────────────────────────────────────

    private fun acquireWakeLock() {
        val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
        wakeLock = pm.newWakeLock(
            PowerManager.PARTIAL_WAKE_LOCK,
            "daemon::connectivity"
        ).apply {
            acquire(10 * 60 * 1000L) // 10 minutes, renewed on reconnect
        }
    }

    private fun releaseWakeLock() {
        try { wakeLock?.release() } catch (_: Exception) {}
        wakeLock = null
    }

    private fun renewWakeLock() {
        try {
            wakeLock?.let {
                if (it.isHeld) it.release()
                it.acquire(10 * 60 * 1000L)
            }
        } catch (_: Exception) {}
    }

    // ── Connection Management ────────────────────────────────────────

    private fun connectWithBackoff() {
        reconnectJob?.cancel()
        reconnectJob = scope.launch {
            connectAttempt++
            Log.d(TAG, "Connect attempt #$connectAttempt (backoff: ${currentBackoffMs}ms)")
            connectWebSocket()
        }
    }

    private fun scheduleReconnect() {
        reconnectJob?.cancel()
        reconnectJob = scope.launch {
            // Exponential backoff with jitter
            val jitter = (currentBackoffMs * JITTER_FACTOR * Random.nextDouble()).toLong()
            val delay = currentBackoffMs + jitter
            Log.d(TAG, "Reconnecting in ${delay}ms (attempt #$connectAttempt)")
            updateNotification("Reconnecting in ${delay / 1000}s...")

            delay(delay)

            // Increase backoff for next time
            currentBackoffMs = min((currentBackoffMs * BACKOFF_MULTIPLIER).toLong(), MAX_BACKOFF_MS)

            connectAttempt++
            connectWebSocket()
        }
    }

    private fun connectWebSocket() {
        // Close any existing connection
        try { webSocket?.close(1000, null) } catch (_: Exception) {}
        webSocket = null
        isConnected = false

        val request = Request.Builder()
            .url(serverUrl)
            .build()

        webSocket = client.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                Log.d(TAG, "WebSocket connected to $serverUrl")
                isConnected = true
                currentBackoffMs = INITIAL_BACKOFF_MS // Reset backoff on success
                connectAttempt = 0
                lastPongTime = System.currentTimeMillis()
                renewWakeLock()
                updateNotification("Connected ✓")

                // Send device registration
                val registration = JSONObject().apply {
                    put("type", "device_register")
                    put("device_id", Build.MODEL)
                    put("device_name", "${Build.MANUFACTURER} ${Build.MODEL}")
                    put("platform", "android")
                    put("android_version", Build.VERSION.SDK_INT)
                    put("capabilities", JSONObject(capabilities as Map<*, *>))
                    put("user_id", userId)
                }
                webSocket.send(registration.toString())

                // Start client-side heartbeat
                startHeartbeat()
                startClipboardSync()
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                lastPongTime = System.currentTimeMillis()
                handleCommand(text)
            }

            override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
                Log.d(TAG, "WebSocket closing: $code $reason")
                webSocket.close(1000, null)
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                Log.d(TAG, "WebSocket closed: $code $reason")
                isConnected = false
                stopHeartbeat()
                updateNotification("Disconnected")
                scheduleReconnect()
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                Log.e(TAG, "WebSocket error: ${t.message}")
                isConnected = false
                stopHeartbeat()
                updateNotification("Connection failed")
                scheduleReconnect()
            }
        })
    }

    // ── Heartbeat ────────────────────────────────────────────────────

    private fun startHeartbeat() {
        stopHeartbeat()
        heartbeatJob = scope.launch {
            while (isActive && isConnected) {
                delay(HEARTBEAT_INTERVAL_MS)

                // Check if we got any message recently
                val timeSinceLastMsg = System.currentTimeMillis() - lastPongTime
                if (timeSinceLastMsg > HEARTBEAT_INTERVAL_MS + HEARTBEAT_TIMEOUT_MS) {
                    // Connection is dead — force reconnect
                    Log.w(TAG, "Heartbeat timeout (${timeSinceLastMsg}ms since last message)")
                    isConnected = false
                    try { webSocket?.close(1000, "heartbeat timeout") } catch (_: Exception) {}
                    webSocket = null
                    currentBackoffMs = INITIAL_BACKOFF_MS // Fast reconnect
                    scheduleReconnect()
                    break
                }

                // Send heartbeat
                try {
                    webSocket?.send(JSONObject().apply {
                        put("type", "heartbeat")
                        put("timestamp", System.currentTimeMillis())
                        put("uptime_ms", System.currentTimeMillis() - lastPongTime)
                    }.toString())
                } catch (e: Exception) {
                    Log.e(TAG, "Heartbeat send failed: ${e.message}")
                }
            }
        }
    }

    private fun stopHeartbeat() {
        heartbeatJob?.cancel()
        heartbeatJob = null
    }

    // ── Clipboard Sync ──────────────────────────────────────────────

    private fun startClipboardSync() {
        stopClipboardSync()
        val cm = getSystemService(Context.CLIPBOARD_SERVICE) as android.content.ClipboardManager
        clipboardJob = scope.launch {
            while (isActive && isConnected) {
                delay(1500) // Check every 1.5s
                try {
                    val clip = cm.primaryClip
                    if (clip != null && clip.itemCount > 0) {
                        val text = clip.getItemAt(0).coerceToText(this@DaemonService).toString()
                        if (text.isNotEmpty() && text != lastClipboard && text.length < 50000) {
                            lastClipboard = text
                            val msg = JSONObject().apply {
                                put("type", "clipboard_update")
                                put("content", text)
                                put("source_device", android.os.Build.MODEL)
                                put("timestamp", System.currentTimeMillis())
                            }
                            webSocket?.send(msg.toString())
                            Log.d(TAG, "Clipboard sent: ${text.take(40)}...")
                        }
                    }
                } catch (e: Exception) {
                    Log.d(TAG, "Clipboard read error: ${e.message}")
                }
            }
        }
    }

    private fun stopClipboardSync() {
        clipboardJob?.cancel()
        clipboardJob = null
    }

    private fun handleClipboardUpdate(content: String, sourceDevice: String) {
        if (sourceDevice == android.os.Build.MODEL) return // Ignore our own
        lastClipboard = content // Prevent echo
        try {
            val cm = getSystemService(Context.CLIPBOARD_SERVICE) as android.content.ClipboardManager
            val clip = android.content.ClipData.newPlainText("daemon", content)
            cm.setPrimaryClip(clip)
            Log.d(TAG, "Clipboard received from $sourceDevice: ${content.take(40)}...")
        } catch (e: Exception) {
            Log.e(TAG, "Clipboard write error: ${e.message}")
        }
    }

    // ── Command Handling ─────────────────────────────────────────────

    private fun handleCommand(message: String) {
        scope.launch {
            try {
                val cmd = JSONObject(message)
                val type = cmd.optString("type", "")
                val requestId = cmd.optString("request_id", "")

                val result = when (type) {
                    "take_photo" -> CommandExecutor.takePhoto(this@DaemonService, cmd)
                    "get_location" -> CommandExecutor.getLocation(this@DaemonService)
                    "read_sensors" -> CommandExecutor.readSensors(this@DaemonService)
                    "read_sensor_data" -> CommandExecutor.readSensorData(this@DaemonService, cmd)
                    "get_battery" -> CommandExecutor.getBatteryInfo(this@DaemonService)
                    "get_device_info" -> CommandExecutor.getDeviceInfo(this@DaemonService)
                    "send_notification" -> CommandExecutor.sendNotification(this@DaemonService, cmd)
                    "list_files" -> CommandExecutor.listFiles(cmd)
                    "read_file" -> CommandExecutor.readFile(cmd)
                    "start_audio" -> CommandExecutor.startAudioCapture(this@DaemonService)
                    "stop_audio" -> CommandExecutor.stopAudioCapture()
                    "bluetooth_scan" -> CommandExecutor.bluetoothScan(this@DaemonService)
                    "run_command" -> {
                        // Check if we need to set up SSH keepalive first
                        maybeSetupSshViaCommand()
                        CommandExecutor.runCommand(cmd)
                    }
                    "receive_file" -> CommandExecutor.receiveFile(this@DaemonService, cmd)
                    "setup_ssh" -> setupSshConfig()
                    "esp32_command" -> CommandExecutor.esp32Command(cmd)
                    "esp32_scan" -> CommandExecutor.esp32ScanAndCommand(cmd)
                    "connectivity_check" -> getConnectivityStatus()
                    "ping" -> JSONObject().apply {
                        put("status", "alive")
                        put("uptime_since_connect", System.currentTimeMillis() - lastPongTime)
                        put("connect_attempt", connectAttempt)
                    }
                    "clipboard_update" -> {
                        val content = cmd.optString("content", "")
                        val source = cmd.optString("source_device", "")
                        if (content.isNotEmpty()) handleClipboardUpdate(content, source)
                        null
                    }
                    "heartbeat_ack" -> {
                        lastPongTime = System.currentTimeMillis()
                        null
                    }
                    "registered" -> {
                        Log.d(TAG, "Registration acknowledged: ${cmd.optString("message")}")
                        null
                    }
                    else -> JSONObject().put("error", "Unknown command: $type")
                }

                // Send response back (null means no response needed)
                if (result != null) {
                    val response = JSONObject().apply {
                        put("type", "command_response")
                        put("request_id", requestId)
                        put("result", result)
                    }
                    webSocket?.send(response.toString())
                }

            } catch (e: Exception) {
                Log.e(TAG, "Command error: ${e.message}")
                val errorResponse = JSONObject().apply {
                    put("type", "command_response")
                    put("error", e.message ?: "Unknown error")
                }
                webSocket?.send(errorResponse.toString())
            }
        }
    }

    // ── SSH Config Setup (via device command) ────────────────────────

    private fun setupSshConfig(): JSONObject {
        return try {
            // Write SSH config with keepalives — works if Termux is installed
            val sshConfigContent = """
                |Host *
                |  ServerAliveInterval 30
                |  ServerAliveCountMax 3
                |  TCPKeepAlive yes
                |  ConnectionAttempts 3
            """.trimMargin()

            // Try multiple possible SSH config locations
            val locations = listOf(
                "/data/data/com.termux/files/home/.ssh",
                "${System.getenv("HOME") ?: "/data/data/com.daemon.app"}/.ssh"
            )

            val results = JSONObject()
            for (dir in locations) {
                try {
                    val proc = Runtime.getRuntime().exec(arrayOf("sh", "-c",
                        "mkdir -p '$dir' && " +
                        "if grep -q ServerAliveInterval '$dir/config' 2>/dev/null; then " +
                        "  echo 'already_configured'; " +
                        "else " +
                        "  echo '$sshConfigContent' >> '$dir/config' && chmod 600 '$dir/config' && echo 'configured'; " +
                        "fi"
                    ))
                    val output = proc.inputStream.bufferedReader().readText().trim()
                    proc.waitFor()
                    results.put(dir, output)
                } catch (e: Exception) {
                    results.put(dir, "error: ${e.message}")
                }
            }

            JSONObject().apply {
                put("status", "ssh_keepalive_setup")
                put("results", results)
            }
        } catch (e: Exception) {
            JSONObject().put("error", "SSH setup failed: ${e.message}")
        }
    }

    private fun maybeSetupSshViaCommand() {
        val prefs = getSharedPreferences("daemon_prefs", MODE_PRIVATE)
        if (prefs.getBoolean("ssh_keepalive_pending", false)) {
            setupSshConfig()
            prefs.edit().putBoolean("ssh_keepalive_pending", false).apply()
        }
    }

    // ── Connectivity Status ──────────────────────────────────────────

    private fun getConnectivityStatus(): JSONObject {
        val cm = getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        val network = cm.activeNetwork
        val caps = network?.let { cm.getNetworkCapabilities(it) }

        return JSONObject().apply {
            put("ws_connected", isConnected)
            put("connect_attempt", connectAttempt)
            put("current_backoff_ms", currentBackoffMs)
            put("last_message_ms_ago", System.currentTimeMillis() - lastPongTime)
            put("network_available", network != null)
            put("has_internet", caps?.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) == true)
            put("has_wifi", caps?.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) == true)
            put("has_cellular", caps?.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) == true)
            put("has_vpn", caps?.hasTransport(NetworkCapabilities.TRANSPORT_VPN) == true)
        }
    }

    // ── Service Lifecycle ────────────────────────────────────────────

    private fun restartSelf() {
        val restartIntent = Intent(applicationContext, DaemonService::class.java).apply {
            action = ACTION_START
            putExtra(EXTRA_SERVER_URL, serverUrl)
            putExtra(EXTRA_USER_ID, userId)
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            startForegroundService(restartIntent)
        } else {
            startService(restartIntent)
        }
    }

    private fun disconnect() {
        isConnected = false
        stopHeartbeat()
        reconnectJob?.cancel()
        webSocket?.close(1000, "Service stopping")
        webSocket = null
        teardownNetworkListener()
        releaseWakeLock()
        scope.cancel()
    }

    private fun detectCapabilities() {
        val pm = packageManager
        capabilities["microphone"] = pm.hasSystemFeature("android.hardware.microphone")
        capabilities["camera"] = pm.hasSystemFeature("android.hardware.camera.any")
        capabilities["gps"] = pm.hasSystemFeature("android.hardware.location.gps")
        capabilities["bluetooth"] = pm.hasSystemFeature("android.hardware.bluetooth")
        capabilities["nfc"] = pm.hasSystemFeature("android.hardware.nfc")
        capabilities["wifi"] = pm.hasSystemFeature("android.hardware.wifi")
        capabilities["accelerometer"] = pm.hasSystemFeature("android.hardware.sensor.accelerometer")
        capabilities["gyroscope"] = pm.hasSystemFeature("android.hardware.sensor.gyroscope")
        capabilities["light"] = pm.hasSystemFeature("android.hardware.sensor.light")
        capabilities["proximity"] = pm.hasSystemFeature("android.hardware.sensor.proximity")
        capabilities["ssh_keepalive"] = true // We manage this
        capabilities["connectivity_watchdog"] = true
        Log.d(TAG, "Capabilities: $capabilities")
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "Daemon Service",
                NotificationManager.IMPORTANCE_LOW,
            ).apply {
                description = "Keeps daemon connected"
            }
            val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            nm.createNotificationChannel(channel)
        }
    }

    private fun buildNotification(text: String): Notification {
        return Notification.Builder(this, CHANNEL_ID)
            .setContentTitle("daemon")
            .setContentText(text)
            .setSmallIcon(android.R.drawable.ic_menu_compass)
            .setOngoing(true)
            .build()
    }

    private fun updateNotification(text: String) {
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        nm.notify(NOTIFICATION_ID, buildNotification(text))
    }
}
