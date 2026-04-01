# Daemon Android Architecture — Background Agent on Android 14-16

**Last updated:** 2026-04-01
**Target:** SDK 34 (Android 14) through SDK 36 (Android 16)
**Device:** Pixel 8 Pro (arthur's phone)

---

## Executive Summary

The daemon Android app acts as a remote agent: it maintains a persistent connection to the daemon server and executes commands (camera, GPS, sensors, shell, file access, streaming). The primary challenge is Android's increasingly aggressive background restrictions across API 34-36, which limit camera/microphone access, impose timeouts on certain foreground service types, and throttle network in Doze mode.

**Recommended architecture:** A single multi-typed Foreground Service (`camera|microphone|location|connectedDevice`) combined with FCM high-priority push as a wake-up fallback, and Companion Device Manager for process priority elevation. No Accessibility Service. No Device Admin. Sideload-only (not Play Store), which removes most policy constraints.

---

## Table of Contents

1. [Foreground Service Strategy](#1-foreground-service-strategy)
2. [Camera from a Service](#2-camera-from-a-service)
3. [WebSocket Persistence](#3-websocket-persistence)
4. [FCM Wake-Up Signal](#4-fcm-wake-up-signal)
5. [Companion Device Manager](#5-companion-device-manager)
6. [WorkManager for Periodic Tasks](#6-workmanager-for-periodic-tasks)
7. [Accessibility Service](#7-accessibility-service)
8. [Device Admin / Device Owner](#8-device-admin--device-owner)
9. [Battery Optimization](#9-battery-optimization)
10. [Manifest and Permissions](#10-manifest-and-permissions)
11. [Battery Impact Estimates](#11-battery-impact-estimates)
12. [Play Store Compliance](#12-play-store-compliance)
13. [Recommended Implementation Plan](#13-recommended-implementation-plan)

---

## 1. Foreground Service Strategy

### Which foreground service types to declare

The service needs multiple capabilities. Declare all required types in the manifest and specify the active subset at runtime via `startForeground()`:

```xml
<service
    android:name=".service.DaemonService"
    android:exported="false"
    android:foregroundServiceType="camera|microphone|location|connectedDevice" />
```

### Type-by-type analysis

| Type | Timeout (Android 15+) | Use case | Notes |
|------|----------------------|----------|-------|
| `camera` | **No timeout** | Photo capture, frame streaming | Requires CAMERA runtime permission. Cannot start from BOOT_COMPLETED on API 35+. |
| `microphone` | **No timeout** | Audio capture/streaming | Requires RECORD_AUDIO. Same BOOT_COMPLETED restriction. |
| `location` | **No timeout** | GPS tracking | Requires ACCESS_FINE_LOCATION. Can run indefinitely with notification. |
| `connectedDevice` | **No timeout** | WebSocket to server, ESP32/BLE | Requires FOREGROUND_SERVICE_CONNECTED_DEVICE + one of: BLUETOOTH_CONNECT, CHANGE_NETWORK_STATE, etc. |
| `dataSync` | **6 hours / 24h** | Bulk uploads | DO NOT use for WebSocket. The 6-hour cap kills it. |
| `mediaPlayback` | **No timeout** | Silent audio trick | Can run forever but is meant for actual playback. Abuse risks rejection. |
| `specialUse` | **No timeout** | Catch-all | Requires Play Console justification. Useful as a fallback for sideloaded apps. |
| `shortService` | **3 minutes** | Quick tasks | Useless for persistent connection. |

### Recommendation

Use `connectedDevice` as the primary type for the persistent WebSocket (it has no timeout and fits "network connection to external server"). Add `camera`, `microphone`, and `location` to the same service, activating them dynamically when commands require them.

**Critical rule on Android 14+:** You must start the foreground service while the app has a visible activity (or meets an exemption). The main exemptions relevant to daemon:
- App is in the foreground (activity visible)
- App received a high-priority FCM message
- App has the `REQUEST_COMPANION_RUN_IN_BACKGROUND` permission via CompanionDeviceManager
- Device reboot (but NOT for camera/microphone types on API 35+)

### Runtime type selection pattern

On Android 14+ (API 34), you specify foreground service types at `startForeground()` time:

```kotlin
// Base connection mode — just WebSocket + location
startForeground(
    NOTIFICATION_ID,
    notification,
    ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE or
    ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION
)

// When camera command arrives, restart with camera type added
// (requires stopping and restarting foreground with new types)
```

**Important:** On Android 14+, you cannot dynamically add foreground service types after `startForeground()` is called. To add camera/microphone, you must call `stopForeground()` then `startForeground()` again with the new type combination. This causes a brief notification flicker but is the only legal approach.

Alternative: Start with all types from the beginning (camera|microphone|location|connectedDevice). This is simpler but requires all runtime permissions to be granted upfront.

---

## 2. Camera from a Service

### Camera2 API (recommended)

The existing `CommandExecutor.takePhoto()` uses Camera2 directly, which is the correct approach for a service. Camera2 does NOT require a `LifecycleOwner` or a preview surface.

**Does it work on Android 16?** Yes. Camera2 is the stable low-level API. It works from any context (Activity, Service, etc.) as long as:
1. CAMERA runtime permission is granted
2. The foreground service has `foregroundServiceType="camera"` declared and active
3. The service was started while the app was in the foreground (or via an exemption)

### Current code assessment

The existing `capturePhoto()` in `CommandExecutor.kt` is solid. Issues to fix:
- No auto-exposure warmup: The first frame from `TEMPLATE_STILL_CAPTURE` may be dark. Add a brief preview session (3-5 frames) before capture to let AE/AWB converge.
- `ImageReader` is not closed after use (memory leak on repeated captures).
- No camera ID mapping: front vs back should be explicit ("0" = back, "1" = front on most devices, but use `CameraCharacteristics.LENS_FACING` to be safe).

### Improved capture pattern

```kotlin
suspend fun takePhoto(context: Context, cmd: JSONObject): JSONObject {
    val facing = if (cmd.optString("camera", "back") == "front")
        CameraCharacteristics.LENS_FACING_FRONT
    else
        CameraCharacteristics.LENS_FACING_BACK

    val cameraId = findCameraId(context, facing)
    val handler = ensureCameraThread()

    return withTimeout(15_000) {
        suspendCancellableCoroutine { cont ->
            val cm = context.getSystemService(Context.CAMERA_SERVICE) as CameraManager
            val characteristics = cm.getCameraCharacteristics(cameraId)
            val size = chooseOptimalSize(characteristics, 1280, 960)
            val reader = ImageReader.newInstance(size.width, size.height, ImageFormat.JPEG, 2)

            reader.setOnImageAvailableListener({ ir ->
                val image = ir.acquireLatestImage() ?: return@setOnImageAvailableListener
                val buffer = image.planes[0].buffer
                val bytes = ByteArray(buffer.remaining())
                buffer.get(bytes)
                image.close()
                reader.close() // <-- important: prevent leak
                val b64 = Base64.encodeToString(bytes, Base64.NO_WRAP)
                cont.resume(JSONObject().apply {
                    put("base64", b64)
                    put("format", "jpeg")
                    put("size", bytes.size)
                })
            }, handler)

            cm.openCamera(cameraId, object : CameraDevice.StateCallback() {
                override fun onOpened(camera: CameraDevice) {
                    // Run 5 throwaway frames for AE/AWB convergence
                    val previewBuilder = camera.createCaptureRequest(CameraDevice.TEMPLATE_PREVIEW)
                    previewBuilder.addTarget(reader.surface)

                    camera.createCaptureSession(listOf(reader.surface),
                        object : CameraCaptureSession.StateCallback() {
                            override fun onConfigured(session: CameraCaptureSession) {
                                // Burst 5 preview frames, then capture
                                session.setRepeatingRequest(previewBuilder.build(), null, handler)
                                handler.postDelayed({
                                    session.stopRepeating()
                                    val captureBuilder = camera.createCaptureRequest(
                                        CameraDevice.TEMPLATE_STILL_CAPTURE
                                    )
                                    captureBuilder.addTarget(reader.surface)
                                    captureBuilder.set(CaptureRequest.JPEG_QUALITY, 85.toByte())
                                    session.capture(captureBuilder.build(),
                                        object : CameraCaptureSession.CaptureCallback() {
                                            override fun onCaptureCompleted(...) { camera.close() }
                                            override fun onCaptureFailed(...) {
                                                camera.close()
                                                cont.resume(JSONObject().put("error", "Capture failed"))
                                            }
                                        }, handler)
                                }, 500) // 500ms warmup
                            }
                            override fun onConfigureFailed(session: CameraCaptureSession) {
                                camera.close()
                                cont.resume(JSONObject().put("error", "Session config failed"))
                            }
                        }, handler)
                }
                override fun onDisconnected(camera: CameraDevice) { camera.close() }
                override fun onError(camera: CameraDevice, error: Int) { camera.close() }
            }, handler)
        }
    }
}
```

### Camera frame streaming

For continuous streaming (e.g., video feed to server), use Camera2 with `ImageReader` in YUV_420_888 format:

```kotlin
// Stream frames as JPEG over WebSocket
val reader = ImageReader.newInstance(640, 480, ImageFormat.YUV_420_888, 4)
reader.setOnImageAvailableListener({ ir ->
    val image = ir.acquireLatestImage() ?: return@setOnImageAvailableListener
    val jpeg = yuvToJpeg(image, quality = 50) // compress for streaming
    image.close()
    webSocket?.send(ByteString.of(*jpeg)) // send binary frame
}, handler)

// Use TEMPLATE_RECORD for continuous streaming
val builder = camera.createCaptureRequest(CameraDevice.TEMPLATE_RECORD)
builder.addTarget(reader.surface)
session.setRepeatingRequest(builder.build(), null, handler)
```

**Frame rate consideration:** At 640x480 JPEG quality 50, each frame is ~15-30KB. At 10 fps, that's 150-300 KB/s (~1-2 Mbps). Manageable on WiFi, tight on mobile data.

### CameraX alternative

CameraX requires a `LifecycleOwner`. You can use `LifecycleService` from `androidx.lifecycle:lifecycle-service` to satisfy this. However:
- CameraX adds abstraction overhead with no real benefit for headless capture
- CameraX is designed around preview + capture flows, not raw frame processing
- Camera2 gives direct control over frame timing and format

**Verdict:** Stick with Camera2. The existing code is on the right track.

### MediaProjection (screen capture)

MediaProjection requires:
1. User consent dialog every time (Android 14+ made the previous persistent token invalid)
2. `foregroundServiceType="mediaProjection"`
3. Cannot start from background
4. On Android 15+, automatically stops when device locks

**Not useful for daemon.** Screen capture requires active user interaction and stops on lock. The daemon needs camera access, not screen recording.

---

## 3. WebSocket Persistence

### Current implementation assessment

The existing `DaemonService.kt` WebSocket setup is reasonable. Key improvements needed:

### Doze mode handling

In Doze mode (screen off, stationary, on battery), Android:
- Blocks network access except during maintenance windows (~every 15-60 min, increasing)
- Kills wakelocks
- Defers alarms

A foreground service with `connectedDevice` type helps but does NOT fully exempt from Doze network restrictions. The WebSocket will disconnect in deep Doze.

### Recommended WebSocket strategy

```kotlin
class DaemonService : Service() {

    private var webSocket: WebSocket? = null
    private var reconnectAttempt = 0
    private val maxReconnectDelay = 300_000L // 5 min max
    private val networkCallback: ConnectivityManager.NetworkCallback

    private val client = OkHttpClient.Builder()
        .readTimeout(0, TimeUnit.MILLISECONDS)
        .pingInterval(30, TimeUnit.SECONDS)  // OkHttp sends pings automatically
        .retryOnConnectionFailure(true)
        .build()

    // Monitor network transitions (WiFi <-> Mobile)
    private fun registerNetworkCallback() {
        val cm = getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        val request = NetworkRequest.Builder()
            .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
            .build()

        networkCallback = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) {
                Log.d(TAG, "Network available, reconnecting WebSocket")
                reconnectAttempt = 0 // Reset backoff
                reconnectWebSocket()
            }

            override fun onLost(network: Network) {
                Log.d(TAG, "Network lost")
                updateNotification("Network lost, waiting...")
            }
        }
        cm.registerNetworkCallback(request, networkCallback)
    }

    private fun reconnectWebSocket() {
        webSocket?.cancel() // Kill existing connection cleanly
        webSocket = null
        connectWebSocket()
    }

    // Exponential backoff with jitter
    private fun scheduleReconnect() {
        val delay = minOf(
            (1000L * (1 shl minOf(reconnectAttempt, 8))) + Random.nextLong(0, 1000),
            maxReconnectDelay
        )
        reconnectAttempt++
        scope.launch {
            delay(delay)
            if (webSocket == null) connectWebSocket()
        }
    }
}
```

### Handling network transitions (WiFi <-> Mobile)

The `NetworkCallback` above handles this. When the active network changes, OkHttp's existing connection becomes invalid. The callback detects the new network and triggers a reconnect with reset backoff.

### Keeping alive through Doze

**You cannot fully prevent Doze from pausing network.** The correct strategy is:

1. **Foreground service** with `connectedDevice` type — reduces Doze aggressiveness
2. **REQUEST_IGNORE_BATTERY_OPTIMIZATIONS** — exempts from some Doze restrictions (see Section 9)
3. **FCM high-priority push** — wakes the app even in deep Doze (see Section 4)
4. **Aggressive reconnect on wake** — when maintenance window opens, reconnect immediately
5. **OkHttp ping interval** of 30s keeps the connection alive during light Doze

The practical result: WebSocket stays connected when screen is on or recently used. In deep Doze (hours of inactivity), the connection drops but FCM can wake the app to reconnect.

---

## 4. FCM Wake-Up Signal

FCM high-priority data messages are delivered even in Doze mode. Use this as a fallback when the WebSocket is disconnected.

### Architecture

```
Server detects device WebSocket disconnected
  -> Server sends FCM high-priority data message to device
    -> Android wakes app, delivers message to FirebaseMessagingService
      -> Service starts/reconnects DaemonService WebSocket
        -> Device registers back on WebSocket
```

### Implementation

```kotlin
class DaemonFCMService : FirebaseMessagingService() {

    override fun onMessageReceived(message: RemoteMessage) {
        val data = message.data

        when (data["action"]) {
            "wake" -> {
                // Reconnect WebSocket
                startForegroundService(Intent(this, DaemonService::class.java).apply {
                    action = DaemonService.ACTION_START
                })
            }
            "command" -> {
                // Execute command directly from FCM payload
                // (for when WebSocket is down and command is urgent)
                val cmd = JSONObject(data["payload"] ?: "{}")
                // Process and send result via HTTP POST back to server
            }
        }
    }

    override fun onNewToken(token: String) {
        // Send new FCM token to daemon server
        scope.launch {
            sendTokenToServer(token)
        }
    }
}
```

### FCM manifest

```xml
<service
    android:name=".service.DaemonFCMService"
    android:exported="false">
    <intent-filter>
        <action android:name="com.google.firebase.MESSAGING_EVENT" />
    </intent-filter>
</service>
```

### Server-side (Python)

```python
import firebase_admin
from firebase_admin import messaging

def wake_device(fcm_token: str):
    message = messaging.Message(
        data={"action": "wake"},
        token=fcm_token,
        android=messaging.AndroidConfig(
            priority="high",  # Bypasses Doze
            ttl=0,  # Don't queue, deliver now or drop
        ),
    )
    messaging.send(message)
```

### Limitations

- FCM delivery is not instant (typically 0-10s, sometimes longer)
- Google Play Services required (available on Pixel, not on degoogled phones)
- High-priority messages should be used sparingly to avoid FCM throttling
- Data-only messages (no notification) are needed to avoid user-visible notification

### Dependencies to add

```kotlin
// build.gradle.kts
implementation(platform("com.google.firebase:firebase-bom:33.7.0"))
implementation("com.google.firebase:firebase-messaging-ktx")
```

---

## 5. Companion Device Manager

The CompanionDeviceManager API (API 26+) is designed for apps that manage external devices (watches, fitness trackers, IoT). It provides two critical benefits:

1. **`REQUEST_COMPANION_RUN_IN_BACKGROUND`** — exempts the app from background restrictions
2. **`REQUEST_COMPANION_USE_DATA_IN_BACKGROUND`** — exempts from Doze data restrictions
3. **Process priority elevation** via `CompanionDeviceService` binding

### How to use it for daemon

The daemon pendant (ESP32 hardware device) is the legitimate companion device. Pair it via BLE:

```kotlin
class DaemonApp : Application() {
    fun pairCompanionDevice(activity: Activity) {
        val deviceManager = getSystemService(CompanionDeviceManager::class.java)

        val request = AssociationRequest.Builder()
            .addDeviceFilter(
                BluetoothLeDeviceFilter.Builder()
                    .setNamePattern(Pattern.compile("daemon-.*"))
                    .build()
            )
            .setSingleDevice(false)
            .build()

        deviceManager.associate(request, object : CompanionDeviceManager.Callback() {
            override fun onAssociationPending(intentSender: IntentSender) {
                activity.startIntentSenderForResult(intentSender, 0, null, 0, 0, 0)
            }
            override fun onAssociationCreated(associationInfo: AssociationInfo) {
                // Association saved. Now request background permissions.
                Log.d("Daemon", "Companion device paired: ${associationInfo.id}")
            }
            override fun onFailure(error: CharSequence?) {
                Log.e("Daemon", "Companion pairing failed: $error")
            }
        }, null)
    }
}
```

### CompanionDeviceService for process keep-alive

```kotlin
class DaemonCompanionService : CompanionDeviceService() {
    override fun onDeviceAppeared(associationInfo: AssociationInfo) {
        // ESP32 pendant is nearby — ensure DaemonService is running
        startForegroundService(Intent(this, DaemonService::class.java).apply {
            action = DaemonService.ACTION_START
        })
    }

    override fun onDeviceDisappeared(associationInfo: AssociationInfo) {
        // Pendant out of range — optionally reduce to low-power mode
        Log.d("Daemon", "Companion device out of range")
    }
}
```

### Manifest

```xml
<uses-permission android:name="android.permission.REQUEST_COMPANION_RUN_IN_BACKGROUND" />
<uses-permission android:name="android.permission.REQUEST_COMPANION_USE_DATA_IN_BACKGROUND" />
<uses-permission android:name="android.permission.REQUEST_COMPANION_START_FOREGROUND_SERVICES_FROM_BACKGROUND" />

<service
    android:name=".service.DaemonCompanionService"
    android:exported="true"
    android:permission="android.permission.BIND_COMPANION_DEVICE_SERVICE">
    <intent-filter>
        <action android:name="android.companion.CompanionDeviceService" />
    </intent-filter>
</service>
```

### Why this matters for daemon

Even without the physical pendant present, once a companion association exists, `REQUEST_COMPANION_RUN_IN_BACKGROUND` and `REQUEST_COMPANION_START_FOREGROUND_SERVICES_FROM_BACKGROUND` remain granted. This gives daemon the critical ability to:
- Start foreground services from background (bypasses the "must have visible activity" rule)
- Use network data during Doze
- Maintain elevated process priority

**This is the single most important API for daemon's reliability.**

---

## 6. WorkManager for Periodic Tasks

### What it's good for

- **Periodic health checks** (every 15 min minimum interval)
- **Uploading queued data** when conditions are met (WiFi, charging)
- **Ensuring DaemonService is running** (watchdog pattern)

### What it's NOT good for

- Real-time command execution (15 min minimum interval)
- Camera capture (cannot access camera from WorkManager worker)
- WebSocket management (workers are short-lived, ~10 min max)

### Watchdog pattern

Use WorkManager as a safety net to restart DaemonService if it was killed:

```kotlin
class DaemonWatchdogWorker(ctx: Context, params: WorkerParameters) : CoroutineWorker(ctx, params) {
    override suspend fun doWork(): Result {
        // Check if DaemonService is running
        val isRunning = DaemonService.isRunning // static flag in DaemonService
        if (!isRunning) {
            // Restart it
            val intent = Intent(applicationContext, DaemonService::class.java).apply {
                action = DaemonService.ACTION_START
            }
            applicationContext.startForegroundService(intent)
        }
        return Result.success()
    }
}

// Schedule in DaemonApp.onCreate()
val watchdog = PeriodicWorkRequestBuilder<DaemonWatchdogWorker>(15, TimeUnit.MINUTES)
    .setConstraints(Constraints.Builder()
        .setRequiredNetworkType(NetworkType.CONNECTED)
        .build())
    .build()
WorkManager.getInstance(this).enqueueUniquePeriodicWork(
    "daemon_watchdog",
    ExistingPeriodicWorkPolicy.KEEP,
    watchdog
)
```

### Sensor data collection (periodic)

For non-urgent sensor snapshots, WorkManager is appropriate:

```kotlin
class SensorSnapshotWorker(ctx: Context, params: WorkerParameters) : CoroutineWorker(ctx, params) {
    override suspend fun doWork(): Result {
        val data = CommandExecutor.readSensors(applicationContext)
        val battery = CommandExecutor.getBatteryInfo(applicationContext)
        val location = CommandExecutor.getLocation(applicationContext)

        // Queue for next WebSocket send, or POST to server directly
        DataStore.queueTelemetry(data, battery, location)
        return Result.success()
    }
}
```

---

## 7. Accessibility Service

### What it can do

- Observe all UI events on the device
- Read screen content
- Perform gestures and clicks
- Overlay windows on top of other apps

### What it CANNOT do

- Access camera or microphone
- Run in background more reliably than a foreground service
- Bypass Doze mode

### Play Store implications

Google's policy is strict: **"Only services designed to help people with disabilities are eligible to declare that they are accessibility tools."** Apps using Accessibility Services for non-accessibility purposes are rejected from the Play Store and can be removed retroactively.

### Verdict for daemon

**Do not use.** Accessibility Service adds nothing that daemon needs. Camera/sensor/GPS access comes from regular permissions. Background execution comes from foreground service + companion device. The only thing Accessibility Service would add is UI automation (reading other apps' screens, performing taps), which is:
- Not part of daemon's current requirements
- A compliance nightmare if Play Store distribution is ever desired
- Possible to achieve via `adb shell` commands if ever needed (daemon already has `runCommand`)

---

## 8. Device Admin / Device Owner

### Device Admin (deprecated)

Deprecated since Android 9. Camera-related policies removed in Android 10+. **Do not use.**

### Device Owner

Device Owner mode gives complete control over the device:
- Silently install/uninstall apps
- Control all permissions
- Disable factory reset
- Set always-on VPN
- Kiosk mode (lock to single app)

### How to set Device Owner (without MDM)

```bash
# Factory reset the device, then during setup:
adb shell dpm set-device-owner com.daemon.app/.admin.DaemonDeviceAdmin

# OR without factory reset (must remove all accounts first):
adb shell pm list accounts  # check for accounts
# Remove all accounts from Settings
adb shell dpm set-device-owner com.daemon.app/.admin.DaemonDeviceAdmin
```

### What it enables for daemon

- **Auto-grant all permissions** (no user prompts)
- **Prevent battery optimization** from killing the app
- **Lock task mode** (kiosk) if the phone becomes a dedicated daemon device
- **Silent app updates** via `PackageInstaller`

### Verdict

**Overkill for now, but worth knowing.** If the Pixel becomes a dedicated daemon device (not Arthur's daily driver), Device Owner gives ultimate control. For a phone that's also used normally, the companion device + foreground service approach is better.

---

## 9. Battery Optimization

### REQUEST_IGNORE_BATTERY_OPTIMIZATIONS

This permission lets you prompt the user to disable battery optimization for your app. When granted:
- App is partially exempt from Doze (network access less restricted)
- App Standby buckets don't apply
- Alarms are less deferred

### How to request

```kotlin
fun requestBatteryExemption(activity: Activity) {
    val pm = activity.getSystemService(Context.POWER_SERVICE) as PowerManager
    if (!pm.isIgnoringBatteryOptimizations(activity.packageName)) {
        val intent = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).apply {
            data = Uri.parse("package:${activity.packageName}")
        }
        activity.startActivity(intent)
    }
}
```

### Play Store policy

Google restricts this permission to specific app categories (messaging, VoIP, task automation, etc.). **Since daemon is sideloaded, this restriction doesn't apply.** Use it freely.

### Recommendation

**Always request this on first launch.** Combined with companion device background permissions, this gives daemon the strongest possible background execution guarantee.

### Additional OEM-specific battery killers

Many OEMs (Samsung, Xiaomi, Huawei, OnePlus) have their own battery optimization layers beyond stock Android. Pixel is the best-case scenario since it follows stock Android behavior closely. If daemon ever runs on other devices, check https://dontkillmyapp.com for OEM-specific workarounds.

---

## 10. Manifest and Permissions

### Complete recommended AndroidManifest.xml

```xml
<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">

    <!-- Core -->
    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
    <uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
    <uses-permission android:name="android.permission.WAKE_LOCK" />
    <uses-permission android:name="android.permission.RECEIVE_BOOT_COMPLETED" />
    <uses-permission android:name="android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS" />

    <!-- Foreground service type permissions (Android 14+) -->
    <uses-permission android:name="android.permission.FOREGROUND_SERVICE_CAMERA" />
    <uses-permission android:name="android.permission.FOREGROUND_SERVICE_MICROPHONE" />
    <uses-permission android:name="android.permission.FOREGROUND_SERVICE_LOCATION" />
    <uses-permission android:name="android.permission.FOREGROUND_SERVICE_CONNECTED_DEVICE" />

    <!-- Camera -->
    <uses-permission android:name="android.permission.CAMERA" />

    <!-- Audio -->
    <uses-permission android:name="android.permission.RECORD_AUDIO" />

    <!-- Location -->
    <uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
    <uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />
    <uses-permission android:name="android.permission.ACCESS_BACKGROUND_LOCATION" />

    <!-- Files -->
    <uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE" />
    <uses-permission android:name="android.permission.READ_MEDIA_IMAGES" />
    <uses-permission android:name="android.permission.READ_MEDIA_VIDEO" />
    <uses-permission android:name="android.permission.READ_MEDIA_AUDIO" />

    <!-- Bluetooth (for companion device + ESP32) -->
    <uses-permission android:name="android.permission.BLUETOOTH" />
    <uses-permission android:name="android.permission.BLUETOOTH_ADMIN" />
    <uses-permission android:name="android.permission.BLUETOOTH_SCAN" />
    <uses-permission android:name="android.permission.BLUETOOTH_CONNECT" />

    <!-- Network state (for connectedDevice FGS type + network monitoring) -->
    <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
    <uses-permission android:name="android.permission.CHANGE_NETWORK_STATE" />

    <!-- Companion Device Manager -->
    <uses-permission android:name="android.permission.REQUEST_COMPANION_RUN_IN_BACKGROUND" />
    <uses-permission android:name="android.permission.REQUEST_COMPANION_USE_DATA_IN_BACKGROUND" />
    <uses-permission android:name="android.permission.REQUEST_COMPANION_START_FOREGROUND_SERVICES_FROM_BACKGROUND" />

    <application
        android:name=".DaemonApp"
        android:allowBackup="false"
        android:icon="@mipmap/ic_launcher"
        android:roundIcon="@mipmap/ic_launcher"
        android:label="daemon"
        android:supportsRtl="true"
        android:theme="@style/Theme.Daemon"
        android:usesCleartextTraffic="true">

        <!-- Main Activity -->
        <activity
            android:name=".MainActivity"
            android:exported="true">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>

        <!-- Core daemon service -->
        <service
            android:name=".service.DaemonService"
            android:exported="false"
            android:foregroundServiceType="camera|microphone|location|connectedDevice" />

        <!-- Companion device service (process keep-alive) -->
        <service
            android:name=".service.DaemonCompanionService"
            android:exported="true"
            android:permission="android.permission.BIND_COMPANION_DEVICE_SERVICE">
            <intent-filter>
                <action android:name="android.companion.CompanionDeviceService" />
            </intent-filter>
        </service>

        <!-- FCM service -->
        <service
            android:name=".service.DaemonFCMService"
            android:exported="false">
            <intent-filter>
                <action android:name="com.google.firebase.MESSAGING_EVENT" />
            </intent-filter>
        </service>

        <!-- Boot receiver (restart service after reboot) -->
        <receiver
            android:name=".receiver.BootReceiver"
            android:exported="true">
            <intent-filter>
                <action android:name="android.intent.action.BOOT_COMPLETED" />
            </intent-filter>
        </receiver>

    </application>
</manifest>
```

### Boot receiver

Note: On Android 15+, BOOT_COMPLETED cannot start camera/microphone foreground services directly. Start with `connectedDevice|location` types only, then upgrade when the user opens the app:

```kotlin
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == Intent.ACTION_BOOT_COMPLETED) {
            // Start with non-camera types (camera FGS from BOOT_COMPLETED blocked on API 35+)
            val serviceIntent = Intent(context, DaemonService::class.java).apply {
                action = DaemonService.ACTION_START
                putExtra("boot_start", true) // Flag to use reduced FGS types
            }
            context.startForegroundService(serviceIntent)
        }
    }
}
```

---

## 11. Battery Impact Estimates

| Component | Drain estimate | Notes |
|-----------|---------------|-------|
| Foreground service (idle WebSocket) | ~1-2% / hour | OkHttp ping every 30s, notification displayed |
| WebSocket active data transfer | ~2-3% / hour | Depends on message frequency |
| Camera single photo capture | ~0.1% per capture | Brief camera open, capture, close |
| Camera continuous streaming (10fps) | ~8-15% / hour | Significant drain; use sparingly |
| GPS single fix | ~0.05% per fix | Using last known location is free |
| GPS continuous tracking | ~3-5% / hour | High drain |
| Sensor reads (accelerometer etc.) | ~0.1% / hour | Minimal impact |
| FCM listener (idle) | ~0% additional | Uses Google Play Services' existing connection |
| WorkManager watchdog (15 min) | ~0.1% / hour | Negligible |

### Total estimated drain (typical usage)

- **Idle connected (WebSocket + periodic pings):** 2-3% / hour
- **Active use (occasional photos + GPS):** 3-5% / hour
- **Heavy use (streaming + GPS):** 15-25% / hour

On a Pixel 8 Pro (5050 mAh), idle connected mode gives roughly 30-40 hours of standby. Acceptable for a sideloaded agent.

---

## 12. Play Store Compliance

### Current plan: Sideload only

Since daemon is sideloaded via ADB or direct APK install, Play Store policies do not apply. This means:
- `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` — free to use
- `specialUse` foreground service type — no justification needed
- Companion device permissions — no review process
- Camera/microphone from foreground service — no policy review

### If Play Store distribution is ever desired

The following would need attention:

| Feature | Play Store risk | Mitigation |
|---------|----------------|------------|
| Camera foreground service | Medium — must justify why camera is used in background | Declare as "security camera" or "remote monitoring" app |
| `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` | High — only allowed for specific categories | Must fit messaging/VoIP/automation category |
| `connectedDevice` foreground service | Low — companion device is legitimate | ESP32 pendant is the companion device |
| Shell command execution | High — arbitrary code execution | Would need to be removed or heavily sandboxed |
| File system access | Medium | Scope to app-specific directories |
| Accessibility Service | DO NOT USE | Not needed, instant rejection risk |

### Recommendation

Stay sideloaded. The app's feature set (remote shell execution, camera access from background, full file system access) is fundamentally incompatible with Play Store policies. This is fine — it's a personal agent for a single device.

---

## 13. Recommended Implementation Plan

### Phase 1: Harden existing service (immediate)

1. Add `connectedDevice` to foreground service types (currently only `camera|microphone`)
2. Add `location` to foreground service types
3. Add `FOREGROUND_SERVICE_CONNECTED_DEVICE` and `FOREGROUND_SERVICE_LOCATION` permissions
4. Add `NetworkCallback` for WiFi/mobile transition handling
5. Implement exponential backoff with jitter for WebSocket reconnect
6. Fix camera: add AE warmup, close `ImageReader`, use `LENS_FACING` for camera selection
7. Request battery optimization exemption on first launch

### Phase 2: FCM + Boot receiver (next)

1. Add Firebase dependency and `google-services.json`
2. Implement `DaemonFCMService` for wake-up signals
3. Send FCM token to server on registration
4. Server-side: detect WebSocket disconnect, send FCM wake
5. Add `BootReceiver` to restart service after reboot (with reduced FGS types on API 35+)

### Phase 3: Companion Device Manager (after pendant hardware)

1. Implement BLE pairing flow for ESP32 pendant
2. Register companion device association
3. Add `CompanionDeviceService` for presence-based keep-alive
4. Request `REQUEST_COMPANION_RUN_IN_BACKGROUND` permission
5. Implement `startObservingDevicePresence()` for auto-bind

### Phase 4: Camera streaming

1. Add streaming command to `CommandExecutor`
2. Implement YUV_420_888 -> JPEG pipeline with configurable quality/resolution
3. Send frames as WebSocket binary messages
4. Add server-side frame receiver and viewer
5. Implement adaptive quality based on network bandwidth

### Phase 5: WorkManager watchdog

1. Add WorkManager dependency
2. Implement `DaemonWatchdogWorker` (15 min periodic)
3. Add sensor telemetry worker for periodic snapshots
4. Add queued data upload worker

---

## Architecture Diagram

```
+------------------+     FCM high-priority      +------------------+
|  Daemon Server   | --------------------------> | DaemonFCMService |
|  (arturito)      |                             | (wakes app)      |
|                  | <-- WebSocket (persistent)  +--------+---------+
|  - Orchestrator  | <-------------------------> |        |
|  - Claude CLI    |     commands / responses    |  DaemonService   |
|  - Qdrant        |                             |  (foreground)    |
+------------------+                             |                  |
                                                 |  - WebSocket     |
+------------------+    BLE presence             |  - CommandExec   |
|  ESP32 Pendant   | ........................... |  - Camera        |
|  (daemon HW)     |    CompanionDeviceService   |  - Sensors       |
+------------------+                             |  - GPS           |
                                                 |  - Shell         |
                                                 +--------+---------+
                                                          |
                                                 +--------+---------+
                                                 | WorkManager      |
                                                 | - Watchdog (15m) |
                                                 | - Telemetry sync |
                                                 +------------------+

                                                 +------------------+
                                                 | BootReceiver     |
                                                 | (restarts after  |
                                                 |  device reboot)  |
                                                 +------------------+
```

---

## Key Takeaways

1. **connectedDevice + camera + microphone + location** foreground service types give everything daemon needs with no timeouts.
2. **Companion Device Manager** is the secret weapon for background persistence. The ESP32 pendant is a legitimate companion device.
3. **FCM high-priority** is the only reliable way to wake an app from deep Doze. Essential fallback.
4. **Camera2 is correct** for headless camera access from a service. CameraX adds unnecessary complexity.
5. **Sideload distribution** removes all Play Store policy constraints. Stay sideloaded.
6. **Do not use** Accessibility Service, Device Admin, or MediaProjection. They add complexity without solving the actual problems.
7. **Battery drain is manageable** (~2-3%/hour idle) on Pixel 8 Pro's 5050 mAh battery.
