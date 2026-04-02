package com.daemon.app.service

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder
import android.util.Log
import kotlinx.coroutines.*
import okhttp3.*
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/**
 * DaemonService — Background foreground service that maintains WebSocket
 * connection to the daemon server. This is the bridge between the Android
 * device and the daemon brain on arturito.
 *
 * The daemon sends commands (take photo, read sensor, get GPS, etc.)
 * and this service executes them locally and returns results.
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
    }

    private var webSocket: WebSocket? = null
    private val client = OkHttpClient.Builder()
        .readTimeout(0, TimeUnit.MILLISECONDS) // No timeout for WebSocket
        .pingInterval(30, TimeUnit.SECONDS)     // Keep alive
        .build()
    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private var serverUrl = "wss://my.daemon.page/ws/device"
    private var userId = ""
    private val capabilities = mutableMapOf<String, Boolean>()

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
        detectCapabilities()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_START -> {
                serverUrl = intent.getStringExtra(EXTRA_SERVER_URL) ?: serverUrl
                userId = intent.getStringExtra(EXTRA_USER_ID) ?: ""
                startForeground(NOTIFICATION_ID, buildNotification("Connecting..."))
                connectWebSocket()
            }
            ACTION_STOP -> {
                disconnect()
                stopForeground(STOP_FOREGROUND_REMOVE)
                stopSelf()
            }
        }
        return START_STICKY // Restart if killed
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onTaskRemoved(rootIntent: Intent?) {
        // App was swiped away — restart the service
        Log.d(TAG, "Task removed, restarting service")
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
        super.onTaskRemoved(rootIntent)
    }

    override fun onDestroy() {
        // Service being destroyed — try to restart
        Log.d(TAG, "Service destroyed, scheduling restart")
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
        scope.cancel()
        super.onDestroy()
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
        Log.d(TAG, "Capabilities: $capabilities")
    }

    private fun connectWebSocket() {
        val request = Request.Builder()
            .url(serverUrl)
            .build()

        webSocket = client.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                Log.d(TAG, "WebSocket connected to $serverUrl")
                updateNotification("Connected to daemon")

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
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                handleCommand(text)
            }

            override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
                Log.d(TAG, "WebSocket closing: $code $reason")
                webSocket.close(1000, null)
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                Log.d(TAG, "WebSocket closed: $code $reason")
                updateNotification("Disconnected")
                // Reconnect after delay
                scope.launch {
                    delay(5000)
                    connectWebSocket()
                }
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                Log.e(TAG, "WebSocket error: ${t.message}")
                updateNotification("Connection failed, retrying...")
                scope.launch {
                    delay(5000)
                    connectWebSocket()
                }
            }
        })
    }

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
                    "run_command" -> CommandExecutor.runCommand(cmd)
                    "receive_file" -> CommandExecutor.receiveFile(this@DaemonService, cmd)
                    "esp32_command" -> CommandExecutor.esp32Command(cmd)
                    "esp32_scan" -> CommandExecutor.esp32ScanAndCommand(cmd)
                    "ping" -> JSONObject().put("status", "alive")
                    else -> JSONObject().put("error", "Unknown command: $type")
                }

                // Send response back
                val response = JSONObject().apply {
                    put("type", "command_response")
                    put("request_id", requestId)
                    put("result", result)
                }
                webSocket?.send(response.toString())

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

    private fun disconnect() {
        webSocket?.close(1000, "Service stopping")
        webSocket = null
        scope.cancel()
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
