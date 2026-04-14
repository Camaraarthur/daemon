package com.daemon.app.service

import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.net.Uri
import android.graphics.ImageFormat
import android.hardware.camera2.CameraCaptureSession
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraDevice
import android.hardware.camera2.CameraManager
import android.hardware.camera2.CaptureRequest
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.location.LocationManager
import android.media.ImageReader
import android.os.BatteryManager
import android.os.Build
import android.os.Environment
import android.os.Handler
import android.os.HandlerThread
import android.app.NotificationChannel
import android.app.NotificationManager
import android.util.Base64
import android.util.Log
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.File
import java.net.URLEncoder
import kotlinx.coroutines.withTimeout
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlin.coroutines.suspendCoroutine

/**
 * Executes commands from the daemon on the Android device.
 * Each command returns a JSONObject with the result.
 */
object CommandExecutor {

    private var cameraThread: HandlerThread? = null
    private var cameraHandler: Handler? = null

    private fun ensureCameraThread(): Handler {
        if (cameraThread == null) {
            cameraThread = HandlerThread("CameraThread").apply { start() }
            cameraHandler = Handler(cameraThread!!.looper)
        }
        return cameraHandler!!
    }

    suspend fun takePhoto(context: Context, cmd: JSONObject): JSONObject {
        val cameraId = cmd.optString("camera_id", "0")
        Log.d("CommandExecutor", "takePhoto called with cameraId=$cameraId")
        return try {
            val base64 = withTimeout(20000) { capturePhoto(context, cameraId) }
            Log.d("CommandExecutor", "Photo captured, base64 length=${base64.length}")
            JSONObject().apply {
                put("base64", base64)
                put("format", "jpeg")
                put("size", base64.length)
            }
        } catch (e: Exception) {
            Log.e("CommandExecutor", "Camera capture failed", e)
            JSONObject().put("error", "Camera capture failed: ${e.message}")
        }
    }

    @Suppress("DEPRECATION")
    private suspend fun capturePhoto(context: Context, cameraId: String): String = suspendCoroutine { cont ->
        val handler = ensureCameraThread()
        val cm = context.getSystemService(Context.CAMERA_SERVICE) as CameraManager
        var resumed = false

        fun safeResume(value: String) {
            if (!resumed) { resumed = true; cont.resume(value) }
        }
        fun safeFail(e: Exception) {
            if (!resumed) { resumed = true; cont.resumeWithException(e) }
        }

        try {
            val ids = cm.cameraIdList
            Log.d("CommandExecutor", "Available cameras: ${ids.toList()}")
            if (ids.isEmpty()) { safeFail(Exception("No cameras found")); return@suspendCoroutine }

            val id = if (ids.contains(cameraId)) cameraId else ids[0]
            val characteristics = cm.getCameraCharacteristics(id)
            val map = characteristics.get(CameraCharacteristics.SCALER_STREAM_CONFIGURATION_MAP)
            if (map == null) { safeFail(Exception("No stream config for camera $id")); return@suspendCoroutine }

            val sizes = map.getOutputSizes(ImageFormat.JPEG)
            Log.d("CommandExecutor", "JPEG sizes: ${sizes.map { "${it.width}x${it.height}" }}")
            val size = sizes.firstOrNull { it.width <= 1280 } ?: sizes.last()

            val reader = ImageReader.newInstance(size.width, size.height, ImageFormat.JPEG, 2)

            reader.setOnImageAvailableListener({ ir ->
                try {
                    val image = ir.acquireLatestImage()
                    if (image != null) {
                        val buffer = image.planes[0].buffer
                        val bytes = ByteArray(buffer.remaining())
                        buffer.get(bytes)
                        image.close()
                        Log.d("CommandExecutor", "Image captured: ${bytes.size} bytes")
                        val b64 = Base64.encodeToString(bytes, Base64.NO_WRAP)
                        safeResume(b64)
                    }
                } catch (e: Exception) {
                    Log.e("CommandExecutor", "ImageReader error", e)
                    safeFail(e)
                }
            }, handler)

            cm.openCamera(id, object : CameraDevice.StateCallback() {
                override fun onOpened(camera: CameraDevice) {
                    Log.d("CommandExecutor", "Camera opened: $id")
                    try {
                        val captureBuilder = camera.createCaptureRequest(CameraDevice.TEMPLATE_STILL_CAPTURE)
                        captureBuilder.addTarget(reader.surface)
                        captureBuilder.set(CaptureRequest.CONTROL_MODE, CaptureRequest.CONTROL_MODE_AUTO)
                        captureBuilder.set(CaptureRequest.JPEG_QUALITY, 85.toByte())

                        camera.createCaptureSession(listOf(reader.surface), object : CameraCaptureSession.StateCallback() {
                            override fun onConfigured(session: CameraCaptureSession) {
                                Log.d("CommandExecutor", "Capture session configured")
                                try {
                                    session.capture(captureBuilder.build(), object : CameraCaptureSession.CaptureCallback() {
                                        override fun onCaptureCompleted(session: CameraCaptureSession, request: CaptureRequest, result: android.hardware.camera2.TotalCaptureResult) {
                                            Log.d("CommandExecutor", "Capture completed")
                                            camera.close()
                                        }
                                        override fun onCaptureFailed(session: CameraCaptureSession, request: CaptureRequest, failure: android.hardware.camera2.CaptureFailure) {
                                            Log.e("CommandExecutor", "Capture failed: reason=${failure.reason}")
                                            camera.close()
                                            safeFail(Exception("Capture failed: reason=${failure.reason}"))
                                        }
                                    }, handler)
                                } catch (e: Exception) {
                                    camera.close(); safeFail(e)
                                }
                            }
                            override fun onConfigureFailed(session: CameraCaptureSession) {
                                Log.e("CommandExecutor", "Session configure failed")
                                camera.close()
                                safeFail(Exception("Camera session configuration failed"))
                            }
                        }, handler)
                    } catch (e: Exception) {
                        camera.close(); safeFail(e)
                    }
                }
                override fun onDisconnected(camera: CameraDevice) { camera.close(); safeFail(Exception("Camera disconnected")) }
                override fun onError(camera: CameraDevice, error: Int) {
                    Log.e("CommandExecutor", "Camera error: $error")
                    camera.close()
                    safeFail(Exception("Camera error code: $error"))
                }
            }, handler)
        } catch (e: SecurityException) {
            Log.e("CommandExecutor", "No camera permission", e)
            safeFail(Exception("Camera permission not granted"))
        } catch (e: Exception) {
            Log.e("CommandExecutor", "Camera setup error", e)
            safeFail(e)
        }
    }

    fun getLocation(context: Context): JSONObject {
        val lm = context.getSystemService(Context.LOCATION_SERVICE) as LocationManager
        return try {
            val loc = lm.getLastKnownLocation(LocationManager.NETWORK_PROVIDER)
                ?: lm.getLastKnownLocation(LocationManager.GPS_PROVIDER)
            if (loc != null) {
                JSONObject().apply {
                    put("latitude", loc.latitude)
                    put("longitude", loc.longitude)
                    put("accuracy", loc.accuracy)
                    put("altitude", loc.altitude)
                    put("time", loc.time)
                }
            } else {
                JSONObject().put("error", "No location available")
            }
        } catch (e: SecurityException) {
            JSONObject().put("error", "Location permission not granted")
        }
    }

    fun readSensors(context: Context): JSONObject {
        val sm = context.getSystemService(Context.SENSOR_SERVICE) as SensorManager
        val result = JSONObject()
        val sensors = JSONArray()

        for (sensor in sm.getSensorList(Sensor.TYPE_ALL)) {
            sensors.put(JSONObject().apply {
                put("name", sensor.name)
                put("type", sensor.stringType)
                put("vendor", sensor.vendor)
                put("resolution", sensor.resolution)
                put("max_range", sensor.maximumRange)
            })
        }
        result.put("sensors", sensors)
        result.put("count", sensors.length())
        return result
    }

    /**
     * Read actual sensor values (accelerometer, gyroscope, etc.)
     * Registers a listener, captures one reading, then unregisters.
     */
    suspend fun readSensorData(context: Context, cmd: JSONObject): JSONObject {
        val sensorType = cmd.optString("sensor_type", "accelerometer")
        val sm = context.getSystemService(Context.SENSOR_SERVICE) as SensorManager

        val androidSensorType = when (sensorType) {
            "accelerometer" -> Sensor.TYPE_ACCELEROMETER
            "gyroscope" -> Sensor.TYPE_GYROSCOPE
            "magnetic_field" -> Sensor.TYPE_MAGNETIC_FIELD
            "gravity" -> Sensor.TYPE_GRAVITY
            "linear_acceleration" -> Sensor.TYPE_LINEAR_ACCELERATION
            "rotation_vector" -> Sensor.TYPE_ROTATION_VECTOR
            "light" -> Sensor.TYPE_LIGHT
            "pressure" -> Sensor.TYPE_PRESSURE
            "proximity" -> Sensor.TYPE_PROXIMITY
            else -> return JSONObject().put("error", "Unknown sensor type: $sensorType")
        }

        val sensor = sm.getDefaultSensor(androidSensorType)
            ?: return JSONObject().put("error", "Sensor not available: $sensorType")

        return withTimeout(5000) {
            suspendCoroutine { cont ->
                var resumed = false
                val listener = object : SensorEventListener {
                    override fun onSensorChanged(event: SensorEvent) {
                        if (!resumed) {
                            resumed = true
                            sm.unregisterListener(this)
                            val values = JSONArray()
                            for (v in event.values) values.put(v.toDouble())
                            val result = JSONObject().apply {
                                put("sensor_type", sensorType)
                                put("sensor_name", sensor.name)
                                put("values", values)
                                put("timestamp", event.timestamp)
                                // Named axes for common sensors
                                if (event.values.size >= 3) {
                                    put("x", event.values[0].toDouble())
                                    put("y", event.values[1].toDouble())
                                    put("z", event.values[2].toDouble())
                                } else if (event.values.isNotEmpty()) {
                                    put("value", event.values[0].toDouble())
                                }
                            }
                            cont.resume(result)
                        }
                    }
                    override fun onAccuracyChanged(sensor: Sensor, accuracy: Int) {}
                }
                sm.registerListener(listener, sensor, SensorManager.SENSOR_DELAY_NORMAL)
            }
        }
    }

    fun getBatteryInfo(context: Context): JSONObject {
        val bm = context.getSystemService(Context.BATTERY_SERVICE) as BatteryManager
        val level = bm.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY)
        val charging = bm.isCharging

        val batteryIntent = context.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
        val temp = (batteryIntent?.getIntExtra(BatteryManager.EXTRA_TEMPERATURE, 0) ?: 0) / 10.0
        val voltage = (batteryIntent?.getIntExtra(BatteryManager.EXTRA_VOLTAGE, 0) ?: 0) / 1000.0

        return JSONObject().apply {
            put("level", level)
            put("charging", charging)
            put("temperature", temp)
            put("voltage", voltage)
        }
    }

    fun getDeviceInfo(context: Context): JSONObject {
        return JSONObject().apply {
            put("manufacturer", Build.MANUFACTURER)
            put("model", Build.MODEL)
            put("android_version", Build.VERSION.RELEASE)
            put("sdk", Build.VERSION.SDK_INT)
            put("device", Build.DEVICE)
            put("product", Build.PRODUCT)
            put("brand", Build.BRAND)
        }
    }

    fun sendNotification(context: Context, cmd: JSONObject): JSONObject {
        val title = cmd.optString("title", "daemon")
        val body = cmd.optString("body", "")

        val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            nm.createNotificationChannel(
                NotificationChannel("daemon_msgs", "Daemon Messages", NotificationManager.IMPORTANCE_HIGH)
            )
        }

        val notification = android.app.Notification.Builder(context, "daemon_msgs")
            .setContentTitle(title)
            .setContentText(body)
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setAutoCancel(true)
            .build()

        nm.notify(System.currentTimeMillis().toInt(), notification)
        return JSONObject().put("sent", true)
    }

    fun listFiles(cmd: JSONObject): JSONObject {
        val path = cmd.optString("path", Environment.getExternalStorageDirectory().absolutePath)
        val dir = File(path)

        if (!dir.exists() || !dir.isDirectory) {
            return JSONObject().put("error", "Not a directory: $path")
        }

        val files = JSONArray()
        dir.listFiles()?.take(100)?.forEach { f ->
            files.put(JSONObject().apply {
                put("name", f.name)
                put("is_dir", f.isDirectory)
                put("size", f.length())
                put("modified", f.lastModified())
            })
        }

        return JSONObject().apply {
            put("path", path)
            put("files", files)
            put("count", files.length())
        }
    }

    fun readFile(cmd: JSONObject): JSONObject {
        val path = cmd.optString("path", "")
        val file = File(path)

        if (!file.exists()) {
            return JSONObject().put("error", "File not found: $path")
        }

        return if (file.length() < 1_000_000) { // < 1MB
            JSONObject().apply {
                put("path", path)
                put("content", file.readText())
                put("size", file.length())
            }
        } else {
            JSONObject().apply {
                put("path", path)
                put("size", file.length())
                put("error", "File too large, use streaming")
            }
        }
    }

    fun runCommand(cmd: JSONObject): JSONObject {
        val command = cmd.optString("command", "")
        if (command.isBlank()) return JSONObject().put("error", "No command")
        return try {
            val process = Runtime.getRuntime().exec(arrayOf("sh", "-c", command))
            val stdout = process.inputStream.bufferedReader().readText()
            val stderr = process.errorStream.bufferedReader().readText()
            val exitCode = process.waitFor()
            JSONObject().apply {
                put("stdout", stdout.take(10000))
                put("stderr", stderr.take(5000))
                put("exit_code", exitCode)
            }
        } catch (e: Exception) {
            JSONObject().put("error", e.message)
        }
    }

    fun receiveFile(context: Context, cmd: JSONObject): JSONObject {
        val filename = cmd.optString("filename", "")
        val base64Data = cmd.optString("data", "")
        if (filename.isBlank() || base64Data.isBlank()) {
            return JSONObject().put("error", "Need filename and data (base64)")
        }
        return try {
            val bytes = Base64.decode(base64Data, Base64.DEFAULT)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                // Android 10+ — use MediaStore
                val resolver = context.contentResolver
                val values = android.content.ContentValues().apply {
                    put(android.provider.MediaStore.Downloads.DISPLAY_NAME, filename)
                    put(android.provider.MediaStore.Downloads.MIME_TYPE, guessMimeType(filename))
                    put(android.provider.MediaStore.Downloads.IS_PENDING, 1)
                }
                val uri = resolver.insert(android.provider.MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
                if (uri != null) {
                    resolver.openOutputStream(uri)?.use { it.write(bytes) }
                    values.clear()
                    values.put(android.provider.MediaStore.Downloads.IS_PENDING, 0)
                    resolver.update(uri, values, null, null)
                    JSONObject().apply {
                        put("saved", true)
                        put("filename", filename)
                        put("size", bytes.size)
                        put("uri", uri.toString())
                    }
                } else {
                    JSONObject().put("error", "Failed to create MediaStore entry")
                }
            } else {
                // Older Android — write directly
                val dir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)
                val file = File(dir, filename)
                file.writeBytes(bytes)
                JSONObject().apply {
                    put("saved", true)
                    put("filename", filename)
                    put("size", bytes.size)
                    put("path", file.absolutePath)
                }
            }
        } catch (e: Exception) {
            JSONObject().put("error", "Save failed: ${e.message}")
        }
    }

    private fun guessMimeType(filename: String): String {
        return when (filename.substringAfterLast('.', "").lowercase()) {
            "txt", "md" -> "text/plain"
            "pdf" -> "application/pdf"
            "jpg", "jpeg" -> "image/jpeg"
            "png" -> "image/png"
            "json" -> "application/json"
            "html" -> "text/html"
            "apk" -> "application/vnd.android.package-archive"
            else -> "application/octet-stream"
        }
    }

    fun startAudioCapture(context: Context): JSONObject {
        return JSONObject().put("status", "not_implemented_yet")
    }

    fun stopAudioCapture(): JSONObject {
        return JSONObject().put("status", "stopped")
    }

    fun bluetoothScan(context: Context): JSONObject {
        return JSONObject().put("status", "not_implemented_yet")
    }

    fun esp32Command(cmd: JSONObject): JSONObject {
        val command = cmd.optString("command", "")
        val ip = cmd.optString("ip", "")
        val port = cmd.optInt("port", 8266)

        if (command.isBlank() || ip.isBlank()) {
            return JSONObject().put("error", "Need command and ip")
        }

        return try {
            val socket = java.net.Socket()
            socket.connect(java.net.InetSocketAddress(ip, port), 5000)
            socket.soTimeout = 10000
            socket.getOutputStream().write(command.toByteArray())
            Thread.sleep(2000)
            val response = socket.getInputStream().bufferedReader().readText()
            socket.close()
            JSONObject().apply {
                put("response", response)
                put("ip", ip)
            }
        } catch (e: Exception) {
            JSONObject().put("error", "ESP32 at $ip:$port — ${e.message}")
        }
    }

    /**
     * Launch another installed app by its package name.
     * Returns {ok:true, package:...} on success, {ok:false, error:"not installed"} if
     * no launch intent is registered for that package.
     */
    fun openApp(context: Context, cmd: JSONObject): JSONObject {
        val packageName = cmd.optString("package_name", "")
        if (packageName.isBlank()) {
            Log.w("CommandExecutor", "openApp called with blank package_name")
            return JSONObject().apply {
                put("ok", false)
                put("error", "package_name is required")
            }
        }
        return try {
            val intent = context.packageManager.getLaunchIntentForPackage(packageName)
            if (intent == null) {
                Log.w("CommandExecutor", "openApp: no launch intent for $packageName")
                JSONObject().apply {
                    put("ok", false)
                    put("error", "not installed")
                    put("package", packageName)
                }
            } else {
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                context.startActivity(intent)
                Log.i("CommandExecutor", "openApp launched $packageName")
                JSONObject().apply {
                    put("ok", true)
                    put("package", packageName)
                }
            }
        } catch (e: Exception) {
            Log.e("CommandExecutor", "openApp failed for $packageName", e)
            JSONObject().apply {
                put("ok", false)
                put("error", e.message ?: "unknown error")
                put("package", packageName)
            }
        }
    }

    /**
     * Open WhatsApp with a prefilled message using the wa.me deep link.
     * NOTE: this OPENS WhatsApp with the message pre-filled — the user still
     * has to tap send. Full autosend would require an accessibility service.
     */
    fun sendWhatsApp(context: Context, cmd: JSONObject): JSONObject {
        val phone = cmd.optString("phone", "")
        val message = cmd.optString("message", "")
        if (phone.isBlank()) {
            Log.w("CommandExecutor", "sendWhatsApp called with blank phone")
            return JSONObject().apply {
                put("ok", false)
                put("error", "phone is required (E.164 without +)")
            }
        }
        return try {
            val encoded = URLEncoder.encode(message, "UTF-8")
            val uri = Uri.parse("https://wa.me/${phone}?text=${encoded}")
            val intent = Intent(Intent.ACTION_VIEW, uri).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            context.startActivity(intent)
            Log.i("CommandExecutor", "sendWhatsApp opened chat for $phone (msg len=${message.length})")
            JSONObject().apply {
                put("ok", true)
                put("phone", phone)
                put("prefilled", true)
                put("note", "WhatsApp opened with prefilled message; user must tap send")
            }
        } catch (e: Exception) {
            Log.e("CommandExecutor", "sendWhatsApp failed for $phone", e)
            JSONObject().apply {
                put("ok", false)
                put("error", e.message ?: "unknown error")
                put("phone", phone)
            }
        }
    }

    fun esp32ScanAndCommand(cmd: JSONObject): JSONObject {
        // Scan local network for ESP32 on port 8266, then send command
        val command = cmd.optString("command", "1+1")

        // Try common hotspot subnets
        val subnets = listOf("10.235.24", "192.168.43", "192.168.49", "192.168.1")
        for (subnet in subnets) {
            for (last in 1..254) {
                try {
                    val socket = java.net.Socket()
                    socket.connect(java.net.InetSocketAddress("$subnet.$last", 8266), 100)
                    socket.soTimeout = 3000
                    socket.getOutputStream().write(command.toByteArray())
                    Thread.sleep(1000)
                    val response = socket.getInputStream().bufferedReader().readText()
                    socket.close()
                    return JSONObject().apply {
                        put("response", response)
                        put("ip", "$subnet.$last")
                        put("found", true)
                    }
                } catch (_: Exception) {}
            }
        }
        return JSONObject().put("error", "ESP32 not found on local network")
    }
}

