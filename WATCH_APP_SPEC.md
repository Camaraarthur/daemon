# Daemon Watch App — Wear OS Spec for Galaxy Watch 5

**Target:** Samsung Galaxy Watch 5 (Wear OS 4+, API 33+)
**Language:** Kotlin + Compose for Wear OS
**Codename:** daemon-watch

---

## 1. What It Does

A voice-first daemon interface on the wrist. Hold a button, speak, see the response. Glance at the watch face to see which devices are online. Everything routes through the daemon server on arturito.

### Core Interactions

1. **Press and hold side button** -> watch starts recording audio
2. **Release button** -> audio streams/sends to daemon server
3. **Response appears** as text on watch screen (scrollable)
4. **Watch face complications** show device mesh status (phone, laptop, ESP32 — green/red dots)
5. **Voice notes** can be saved locally and batch-sent when convenient

---

## 2. Architecture Decision: Option C (Hybrid)

```
                    ┌─────────────────────────┐
                    │  arturito (server)       │
                    │  - daemon.py (brain)     │
                    │  - ws-server.js :4801    │
                    │  - /api/chat POST        │
                    │  - /health GET           │
                    └────────┬────────────────┘
                             │
              ┌──────────────┼──────────────┐
              │              │              │
         WiFi direct    Data Layer     WiFi direct
         (watch alone)  (via phone)    (phone relay)
              │              │              │
        ┌─────┴─────┐  ┌────┴────┐   ┌────┴────┐
        │ Watch App  │  │  Phone  │   │  Phone  │
        │ (daemon-   │──│  Daemon │   │  Daemon │
        │  watch)    │  │  App    │   │  App    │
        └────────────┘  └─────────┘   └─────────┘
```

**Strategy:**

- **Primary:** Watch connects directly to server over WiFi/LTE (HTTP POST to `/api/chat`, WebSocket to `/ws/device`). Galaxy Watch 5 has WiFi — use it.
- **Fallback:** If no WiFi, use Wear Data Layer API to relay through the phone daemon app.
- **Why not phone-only:** The watch should work independently. Arthur might not have his phone. The daemon is on the server, not the phone.

**Server communication:**

- **Voice input:** Record audio on watch -> send as base64 PCM in HTTP POST to `/api/chat` (or a new `/api/voice` endpoint that accepts audio, runs Deepgram STT, then feeds to daemon)
- **Text response:** JSON response from server displayed on watch
- **Device status:** Poll `/health` on port 4801 every 60s to get connected device list
- **Device registration:** WebSocket to `ws://100.124.245.114:4801/ws/device` for registering the watch as a daemon device

---

## 3. Key Technical Answers

### Can you override the side button on Galaxy Watch 5?

**Yes, partially.** The Galaxy Watch 5 has two physical buttons (Home + Back). In-app, you can intercept `KEYCODE_STEM_1` and `KEYCODE_STEM_2` via `onKeyDown()` in your Activity. You CANNOT override the Home button globally (system reserves it), but:

- **STEM_1** (upper button): Capturable inside your app via `onKeyDown(keyCode, event)` when `keyCode == KeyEvent.KEYCODE_STEM_1`
- **STEM_2** (lower/back button): Can be intercepted in-app
- **Double-press Home**: User can assign to launch your app via Settings > Buttons
- **Press-and-hold Home**: User can assign to Bixby or Power Menu (not custom apps directly)

**Best approach:** User sets double-press Home to launch daemon-watch. Inside the app, STEM_1 = push-to-talk, STEM_2 = back/cancel. The bezel (digital rotating bezel on GW5) scrolls through responses.

### What's the best way to record voice on Wear OS?

**AudioRecord (not MediaRecorder).** MediaRecorder does not work on Wear OS. Use `AudioRecord` with PCM 16-bit, 16kHz sample rate (good for voice, Deepgram-compatible).

```kotlin
val sampleRate = 16000
val channelConfig = AudioFormat.CHANNEL_IN_MONO
val audioFormat = AudioFormat.ENCODING_PCM_16BIT
val bufferSize = AudioRecord.getMinBufferSize(sampleRate, channelConfig, audioFormat)

val recorder = AudioRecord(
    MediaRecorder.AudioSource.MIC,
    sampleRate,
    channelConfig,
    audioFormat,
    bufferSize * 2
)
```

**Two modes:**
1. **Stream mode:** Send PCM chunks over WebSocket in real-time as user speaks (lowest latency, ~200ms chunks)
2. **Batch mode:** Record full utterance, send as single payload on release (simpler, slightly more latency)

Recommendation: **Batch mode for v1** (simpler, more reliable on watch WiFi). Upgrade to streaming later.

### Can Wear OS maintain a WebSocket connection?

**Yes, but with caveats.** OkHttp WebSocket works on Wear OS. However:

- **Doze mode kills background connections** after screen off
- **Foreground Service** keeps connection alive (the Android phone app already does this — same pattern)
- **For the watch:** Only maintain WebSocket while app is in foreground or during active use. Don't try to keep it always-on — battery death.
- **Device registration:** Connect WebSocket on app launch, register as `galaxy-watch-5`, disconnect when app backgrounds

The existing `DaemonService.kt` pattern from the phone app works here with minor adaptation.

### How to show device status on the watch face?

**Complications.** Wear OS complications are small data slots on watch faces. You create a `ComplicationDataSourceService` that provides data.

- Create a `DaemonComplicationService` that periodically polls `http://100.124.245.114:4801/health`
- Return `ShortTextComplicationData` with device count or `SmallImageComplicationData` with status icon
- User adds complication to their watch face via watch face settings
- Update frequency: Every 15 minutes (minimum allowed by Wear OS for background complications)

Alternative: **Tile** — a swipeable card from the watch face. More space, shows all devices with names and status dots. Better UX than complications for this use case. Use both.

### Wear Data Layer for phone relay?

**Yes, works well.** The Data Layer API (`com.google.android.gms:play-services-wearable`) enables:

- `MessageClient.sendMessage()` — fire-and-forget messages (watch -> phone)
- `DataClient.putDataItem()` — synced data store
- The phone daemon app would need a `WearableListenerService` to receive messages and forward to server

For v1, skip Data Layer. Direct WiFi is simpler and the watch has WiFi. Add Data Layer in v2 for offline phone relay.

### How to sideload on Galaxy Watch 5?

1. On watch: Settings > About Watch > Software > tap "Software Version" 7 times
2. Back to Settings > Developer Options > enable ADB Debugging
3. Enable Wireless Debugging > Pair via Pairing Code
4. On dev machine: `adb pair <watch-ip>:<port>` with the pairing code
5. Then: `adb connect <watch-ip>:<debug-port>`
6. Install: `adb install daemon-watch.apk`

Alternative: Use **Wear Installer 2** app on phone to sideload via Bluetooth.

### Battery: always-listening vs push-to-talk?

**Push-to-talk wins decisively.** Always-listening drains Galaxy Watch 5 in ~4 hours. Push-to-talk has near-zero idle battery impact. The mic only activates on button press. This is the correct approach.

- No "Hey Daemon" wake word — button press only
- WebSocket only active while app is in foreground
- Complications use WorkManager for periodic (15min) health checks
- Target: <5% battery impact per day with moderate use (10-20 voice interactions)

---

## 4. UI Design

### Main Screen (Voice Interface)

```
    ┌─────────────────────┐
    │      ╭─────╮        │
    │      │  ◉  │        │  <- Daemon "eye" icon (red, blinks on activity)
    │      ╰─────╯        │
    │                     │
    │   "Hold button      │  <- Instruction text (idle state)
    │    to speak"        │
    │                     │
    │  ┌───┐ ┌───┐ ┌───┐ │  <- Device status dots
    │  │ 📱│ │ 💻│ │ ⚡│ │     phone / laptop / ESP32
    │  │ 🟢│ │ 🟢│ │ 🔴│ │     green=online, red=offline
    │  └───┘ └───┘ └───┘ │
    └─────────────────────┘
```

### Recording State

```
    ┌─────────────────────┐
    │      ╭─────╮        │
    │      │  ●  │        │  <- Pulsing red dot (recording)
    │      ╰─────╯        │
    │                     │
    │   ▓▓▓▒▒▒▓▓▓▒▒▒     │  <- Audio waveform visualization
    │                     │
    │   "listening..."    │  <- Status text
    │                     │
    └─────────────────────┘
```

### Response State

```
    ┌─────────────────────┐
    │  daemon              │  <- Header
    │─────────────────────│
    │                     │
    │  "The MSI laptop    │  <- Scrollable response text
    │   is online. ESP32  │     (bezel to scroll)
    │   last seen 3 min   │
    │   ago. Battery at   │
    │   72%."             │
    │                     │
    │  ┌───────────────┐  │
    │  │  Hold to speak │  │  <- Action hint
    │  └───────────────┘  │
    └─────────────────────┘
```

### Tile (Swipe from watch face)

```
    ┌─────────────────────┐
    │  daemon mesh         │
    │─────────────────────│
    │                     │
    │  📱 Pixel 8 Pro  🟢 │
    │  💻 MSI Laptop   🟢 │
    │  ⚡ ESP32        🔴 │
    │  ⌚ This Watch   🟢 │
    │                     │
    │  Last sync: 2m ago  │
    └─────────────────────┘
```

---

## 5. Project Structure

```
daemon/watch/
├── app/
│   ├── build.gradle.kts
│   └── src/main/
│       ├── AndroidManifest.xml
│       ├── java/com/daemon/watch/
│       │   ├── WatchApp.kt                  # Application class
│       │   ├── MainActivity.kt              # Main entry, button handling
│       │   ├── ui/
│       │   │   ├── DaemonWatchScreen.kt     # Main voice interface
│       │   │   ├── ResponseScreen.kt        # Scrollable response view
│       │   │   ├── DeviceStatusRow.kt       # Device dots component
│       │   │   └── theme/
│       │   │       └── WatchTheme.kt        # Dark theme, daemon red
│       │   ├── audio/
│       │   │   └── VoiceRecorder.kt         # AudioRecord wrapper
│       │   ├── network/
│       │   │   ├── DaemonApiClient.kt       # HTTP client (chat, voice)
│       │   │   ├── DaemonWebSocket.kt       # WebSocket device registration
│       │   │   └── DeviceHealthPoller.kt    # Poll /health for device status
│       │   ├── service/
│       │   │   └── WatchDaemonService.kt    # Foreground service (lightweight)
│       │   ├── complication/
│       │   │   └── DeviceStatusComplication.kt  # Watch face complication
│       │   └── tile/
│       │       └── DaemonMeshTile.kt        # Device mesh tile
│       └── res/
│           ├── drawable/
│           │   └── ic_daemon.xml            # Daemon eye icon
│           └── values/
│               └── strings.xml
├── build.gradle.kts                         # Project-level
├── settings.gradle.kts
└── gradle/
    └── libs.versions.toml
```

---

## 6. Dependencies

```toml
# gradle/libs.versions.toml
[versions]
wear-compose = "1.5.0"
compose-bom = "2025.05.00"
horologist = "0.6.20"
okhttp = "4.12.0"
tiles = "1.4.1"
play-services-wearable = "18.2.0"

[libraries]
# Wear Compose (NOT regular material3)
wear-compose-material = { module = "androidx.wear.compose:compose-material", version.ref = "wear-compose" }
wear-compose-foundation = { module = "androidx.wear.compose:compose-foundation", version.ref = "wear-compose" }
wear-compose-navigation = { module = "androidx.wear.compose:compose-navigation", version.ref = "wear-compose" }

# Horologist (responsive layouts, volume control, audio)
horologist-compose-layout = { module = "com.google.android.horologist:horologist-compose-layout", version.ref = "horologist" }
horologist-audio = { module = "com.google.android.horologist:horologist-audio", version.ref = "horologist" }

# Networking
okhttp = { module = "com.squareup.okhttp3:okhttp", version.ref = "okhttp" }

# Tiles
tiles = { module = "androidx.wear.tiles:tiles", version.ref = "tiles" }
tiles-material = { module = "androidx.wear.tiles:tiles-material", version.ref = "tiles" }

# Complications
wear-watchface-complications = { module = "androidx.wear.watchface:watchface-complications-data-source-ktx", version = "1.2.1" }

# Data Layer (v2 — phone relay)
play-services-wearable = { module = "com.google.android.gms:play-services-wearable", version.ref = "play-services-wearable" }

# Coroutines
coroutines-core = { module = "org.jetbrains.kotlinx:kotlinx-coroutines-core", version = "1.8.1" }
coroutines-android = { module = "org.jetbrains.kotlinx:kotlinx-coroutines-android", version = "1.8.1" }
```

```kotlin
// app/build.gradle.kts
plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

android {
    namespace = "com.daemon.watch"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.daemon.watch"
        minSdk = 30          // Wear OS 3+ (Galaxy Watch 4/5/6/7)
        targetSdk = 34       // Wear OS 5
        versionCode = 1
        versionName = "0.1.0"

        buildConfigField("String", "DAEMON_API_URL", "\"https://my.daemon.page\"")
        buildConfigField("String", "DAEMON_WS_URL", "\"ws://100.124.245.114:4801/ws/device\"")
        buildConfigField("String", "DAEMON_HEALTH_URL", "\"http://100.124.245.114:4801/health\"")
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }
}

dependencies {
    // Wear Compose UI (NOT regular material3)
    implementation(libs.wear.compose.material)
    implementation(libs.wear.compose.foundation)
    implementation(libs.wear.compose.navigation)

    // Horologist for responsive wearable layouts
    implementation(libs.horologist.compose.layout)

    // Networking
    implementation(libs.okhttp)
    implementation(libs.coroutines.core)
    implementation(libs.coroutines.android)

    // Tiles
    implementation(libs.tiles)
    implementation(libs.tiles.material)

    // Complications
    implementation(libs.wear.watchface.complications)

    // Lifecycle
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.7")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.8.7")
    implementation("androidx.activity:activity-compose:1.9.3")
    implementation("androidx.core:core-ktx:1.15.0")
}
```

---

## 7. Key Code Patterns

### 7.1 Voice Recorder (AudioRecord on Wear OS)

```kotlin
// audio/VoiceRecorder.kt
package com.daemon.watch.audio

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.util.Base64
import androidx.core.content.ContextCompat
import kotlinx.coroutines.*
import java.io.ByteArrayOutputStream

class VoiceRecorder(private val context: Context) {

    companion object {
        const val SAMPLE_RATE = 16000           // 16kHz — optimal for speech/Deepgram
        const val CHANNEL = AudioFormat.CHANNEL_IN_MONO
        const val FORMAT = AudioFormat.ENCODING_PCM_16BIT
    }

    private var recorder: AudioRecord? = null
    private var recordingJob: Job? = null
    private val audioBuffer = ByteArrayOutputStream()

    val isRecording: Boolean get() = recorder?.recordingState == AudioRecord.RECORDSTATE_RECORDING

    fun startRecording(): Boolean {
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO)
            != PackageManager.PERMISSION_GRANTED) return false

        val bufferSize = AudioRecord.getMinBufferSize(SAMPLE_RATE, CHANNEL, FORMAT)
        if (bufferSize == AudioRecord.ERROR_BAD_VALUE) return false

        recorder = AudioRecord(
            MediaRecorder.AudioSource.MIC,
            SAMPLE_RATE,
            CHANNEL,
            FORMAT,
            bufferSize * 2
        )

        audioBuffer.reset()
        recorder?.startRecording()

        recordingJob = CoroutineScope(Dispatchers.IO).launch {
            val buffer = ByteArray(bufferSize)
            while (isActive && isRecording) {
                val read = recorder?.read(buffer, 0, buffer.size) ?: 0
                if (read > 0) {
                    synchronized(audioBuffer) {
                        audioBuffer.write(buffer, 0, read)
                    }
                }
            }
        }

        return true
    }

    fun stopRecording(): ByteArray {
        recorder?.stop()
        recordingJob?.cancel()
        recorder?.release()
        recorder = null

        val pcmData: ByteArray
        synchronized(audioBuffer) {
            pcmData = audioBuffer.toByteArray()
            audioBuffer.reset()
        }
        return pcmData
    }

    /**
     * Returns recorded audio as base64-encoded PCM for sending to server.
     */
    fun stopAndEncode(): String {
        val pcm = stopRecording()
        return Base64.encodeToString(pcm, Base64.NO_WRAP)
    }
}
```

### 7.2 Button Handling (STEM_1 = Push-to-Talk)

```kotlin
// MainActivity.kt
package com.daemon.watch

import android.os.Bundle
import android.view.KeyEvent
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.runtime.*
import com.daemon.watch.audio.VoiceRecorder
import com.daemon.watch.network.DaemonApiClient
import com.daemon.watch.ui.DaemonWatchScreen
import kotlinx.coroutines.*

class MainActivity : ComponentActivity() {

    private lateinit var voiceRecorder: VoiceRecorder
    private lateinit var apiClient: DaemonApiClient
    private val scope = CoroutineScope(Dispatchers.Main + SupervisorJob())

    // Observable state for Compose
    private val _isRecording = mutableStateOf(false)
    private val _responseText = mutableStateOf("")
    private val _isProcessing = mutableStateOf(false)
    private val _devices = mutableStateOf<List<DeviceInfo>>(emptyList())

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        voiceRecorder = VoiceRecorder(this)
        apiClient = DaemonApiClient()

        // Start polling device health
        scope.launch {
            while (isActive) {
                _devices.value = apiClient.getDeviceHealth()
                delay(60_000) // Every 60s
            }
        }

        setContent {
            DaemonWatchScreen(
                isRecording = _isRecording.value,
                isProcessing = _isProcessing.value,
                responseText = _responseText.value,
                devices = _devices.value,
            )
        }
    }

    override fun onKeyDown(keyCode: Int, event: KeyEvent?): Boolean {
        if (keyCode == KeyEvent.KEYCODE_STEM_1 && event?.repeatCount == 0) {
            startRecording()
            return true
        }
        return super.onKeyDown(keyCode, event)
    }

    override fun onKeyUp(keyCode: Int, event: KeyEvent?): Boolean {
        if (keyCode == KeyEvent.KEYCODE_STEM_1) {
            stopRecordingAndSend()
            return true
        }
        return super.onKeyUp(keyCode, event)
    }

    private fun startRecording() {
        if (voiceRecorder.startRecording()) {
            _isRecording.value = true
            _responseText.value = ""
        }
    }

    private fun stopRecordingAndSend() {
        _isRecording.value = false
        _isProcessing.value = true

        val audioBase64 = voiceRecorder.stopAndEncode()

        scope.launch {
            try {
                val response = apiClient.sendVoice(audioBase64)
                _responseText.value = response
            } catch (e: Exception) {
                _responseText.value = "Error: ${e.message}"
            }
            _isProcessing.value = false
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        scope.cancel()
    }
}

data class DeviceInfo(
    val id: String,
    val name: String,
    val platform: String,
    val connected: Boolean,
)
```

### 7.3 API Client

```kotlin
// network/DaemonApiClient.kt
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

class DaemonApiClient {

    private val client = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(120, TimeUnit.SECONDS)  // Daemon can take time to think
        .writeTimeout(30, TimeUnit.SECONDS)
        .build()

    private val jsonType = "application/json; charset=utf-8".toMediaType()

    /**
     * Send voice audio to daemon. Server does STT + daemon processing.
     * Returns the daemon's text response.
     */
    suspend fun sendVoice(audioBase64: String): String = withContext(Dispatchers.IO) {
        val body = JSONObject().apply {
            put("audio", audioBase64)
            put("format", "pcm_16bit_16khz_mono")
            put("source", "watch")
            put("threadId", "watch-main")
        }.toString().toRequestBody(jsonType)

        val request = Request.Builder()
            .url("${BuildConfig.DAEMON_API_URL}/api/voice")
            .post(body)
            .build()

        val response = client.newCall(request).execute()
        val responseBody = response.body?.string() ?: "{}"
        val json = JSONObject(responseBody)

        when {
            response.isSuccessful -> json.optString("response", "No response")
            else -> "Error ${response.code}: ${json.optString("error", "Unknown")}"
        }
    }

    /**
     * Send text message to daemon (fallback if STT done on-device).
     */
    suspend fun sendText(message: String): String = withContext(Dispatchers.IO) {
        val body = JSONObject().apply {
            put("message", message)
            put("threadId", "watch-main")
        }.toString().toRequestBody(jsonType)

        val request = Request.Builder()
            .url("${BuildConfig.DAEMON_API_URL}/api/chat")
            .post(body)
            .build()

        val response = client.newCall(request).execute()
        val json = JSONObject(response.body?.string() ?: "{}")
        json.optString("response", "No response")
    }

    /**
     * Poll device health from WebSocket server.
     */
    suspend fun getDeviceHealth(): List<DeviceInfo> = withContext(Dispatchers.IO) {
        try {
            val request = Request.Builder()
                .url(BuildConfig.DAEMON_HEALTH_URL)
                .build()

            val response = client.newCall(request).execute()
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
        } catch (e: Exception) {
            emptyList()
        }
    }
}
```

### 7.4 Main Watch Screen (Compose for Wear OS)

```kotlin
// ui/DaemonWatchScreen.kt
package com.daemon.watch.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.wear.compose.material.*
import com.daemon.watch.DeviceInfo

val DaemonRed = Color(0xFFFF0505)
val DarkBg = Color(0xFF111111)
val TextDim = Color(0xFF555555)

@Composable
fun DaemonWatchScreen(
    isRecording: Boolean,
    isProcessing: Boolean,
    responseText: String,
    devices: List<DeviceInfo>,
) {
    Scaffold(
        timeText = { TimeText() },  // Shows time at top of round screen
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .background(DarkBg)
                .padding(8.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
        ) {
            // Daemon eye
            Text(
                text = if (isRecording) "\u25CF" else "\u25C9",  // Filled vs ringed circle
                color = if (isRecording) DaemonRed else DaemonRed.copy(alpha = 0.6f),
                fontSize = 32.sp,
            )

            Spacer(Modifier.height(8.dp))

            // Status / Response area
            when {
                isRecording -> {
                    Text(
                        "listening...",
                        color = DaemonRed,
                        fontSize = 14.sp,
                    )
                    // Audio level indicator would go here
                    Spacer(Modifier.height(4.dp))
                    LinearProgressIndicator(
                        modifier = Modifier.fillMaxWidth(0.6f),
                        color = DaemonRed,
                    )
                }
                isProcessing -> {
                    Text(
                        "thinking...",
                        color = TextDim,
                        fontSize = 14.sp,
                    )
                    Spacer(Modifier.height(4.dp))
                    CircularProgressIndicator(
                        modifier = Modifier.size(24.dp),
                        indicatorColor = DaemonRed,
                        strokeWidth = 2.dp,
                    )
                }
                responseText.isNotEmpty() -> {
                    Text(
                        text = responseText,
                        color = Color.White,
                        fontSize = 13.sp,
                        lineHeight = 17.sp,
                        textAlign = TextAlign.Center,
                        modifier = Modifier
                            .fillMaxWidth()
                            .weight(1f)
                            .verticalScroll(rememberScrollState()),
                            // Bezel/crown scrolling handled by ScalingLazyColumn or
                            // rotaryWithScroll modifier from Horologist
                    )
                }
                else -> {
                    Text(
                        "hold button\nto speak",
                        color = TextDim,
                        fontSize = 14.sp,
                        textAlign = TextAlign.Center,
                    )
                }
            }

            Spacer(Modifier.height(8.dp))

            // Device status row
            DeviceStatusRow(devices)
        }
    }
}

@Composable
fun DeviceStatusRow(devices: List<DeviceInfo>) {
    Row(
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        // Show known device types with status
        val iconMap = mapOf(
            "android" to "\uD83D\uDCF1",  // phone emoji
            "windows" to "\uD83D\uDCBB",  // laptop emoji
            "esp32" to "\u26A1",           // lightning bolt
            "watch" to "\u231A",           // watch emoji
        )

        if (devices.isEmpty()) {
            Text("no devices", color = TextDim, fontSize = 10.sp)
        } else {
            devices.forEach { device ->
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(
                        iconMap[device.platform] ?: "\u2B55",
                        fontSize = 16.sp,
                    )
                    Text(
                        "\u25CF",  // dot
                        color = if (device.connected) Color(0xFF00FF00) else Color(0xFFFF0000),
                        fontSize = 8.sp,
                    )
                }
            }
        }
    }
}
```

### 7.5 Watch Face Complication

```kotlin
// complication/DeviceStatusComplication.kt
package com.daemon.watch.complication

import android.graphics.drawable.Icon
import androidx.wear.watchface.complications.data.*
import androidx.wear.watchface.complications.datasource.ComplicationDataSourceService
import androidx.wear.watchface.complications.datasource.ComplicationRequest
import com.daemon.watch.network.DaemonApiClient
import kotlinx.coroutines.runBlocking

class DeviceStatusComplication : ComplicationDataSourceService() {

    override fun getPreviewData(type: ComplicationType): ComplicationData {
        return ShortTextComplicationData.Builder(
            text = PlainComplicationText.Builder("3/4").build(),
            contentDescription = PlainComplicationText.Builder("3 of 4 daemon devices online").build(),
        ).build()
    }

    override fun onComplicationRequest(
        request: ComplicationRequest,
        listener: ComplicationRequestListener,
    ) {
        val client = DaemonApiClient()

        // Fetch device status (blocking OK in complication service)
        val devices = runBlocking {
            try { client.getDeviceHealth() } catch (e: Exception) { emptyList() }
        }

        val online = devices.count { it.connected }
        val total = devices.size

        val data = ShortTextComplicationData.Builder(
            text = PlainComplicationText.Builder("$online/$total").build(),
            contentDescription = PlainComplicationText
                .Builder("$online of $total daemon devices online").build(),
        ).build()

        listener.onComplicationData(data)
    }
}
```

### 7.6 AndroidManifest.xml

```xml
<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">

    <uses-feature android:name="android.hardware.type.watch" />

    <uses-permission android:name="android.permission.RECORD_AUDIO" />
    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
    <uses-permission android:name="android.permission.WAKE_LOCK" />
    <uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
    <uses-permission android:name="android.permission.VIBRATE" />

    <application
        android:name=".WatchApp"
        android:label="daemon"
        android:icon="@drawable/ic_daemon"
        android:theme="@android:style/Theme.DeviceDefault">

        <uses-library
            android:name="com.google.android.wearable"
            android:required="true" />

        <meta-data
            android:name="com.google.android.wearable.standalone"
            android:value="true" />

        <activity
            android:name=".MainActivity"
            android:exported="true"
            android:taskAffinity=""
            android:theme="@android:style/Theme.DeviceDefault">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>

        <!-- Complication data source -->
        <service
            android:name=".complication.DeviceStatusComplication"
            android:exported="true"
            android:permission="com.google.android.wearable.permission.BIND_COMPLICATION_PROVIDER">
            <intent-filter>
                <action android:name="android.support.wearable.complications.ACTION_COMPLICATION_UPDATE_REQUEST" />
            </intent-filter>
            <meta-data
                android:name="android.support.wearable.complications.SUPPORTED_TYPES"
                android:value="SHORT_TEXT" />
            <meta-data
                android:name="android.support.wearable.complications.UPDATE_PERIOD_SECONDS"
                android:value="900" />
        </service>

        <!-- Foreground service for active session -->
        <service
            android:name=".service.WatchDaemonService"
            android:foregroundServiceType="microphone" />

    </application>
</manifest>
```

---

## 8. Server-Side Changes Needed

The daemon server needs a new `/api/voice` endpoint that accepts audio and returns a text response.

```python
# New endpoint in web/src/app/api/voice/route.ts (or add to existing server)
# Accepts: { audio: base64_pcm, format: "pcm_16bit_16khz_mono", source: "watch" }
# Flow: base64 decode -> Deepgram STT -> daemon.send_message(transcript) -> return response

# Pseudocode:
async def handle_voice(request):
    audio_b64 = request.json["audio"]
    pcm_bytes = base64.b64decode(audio_b64)

    # Convert PCM to WAV for Deepgram
    wav_bytes = pcm_to_wav(pcm_bytes, sample_rate=16000, channels=1, sample_width=2)

    # Send to Deepgram for STT
    transcript = await deepgram_transcribe(wav_bytes)

    # Send to daemon brain
    response = await daemon.send_message(transcript)

    return {"response": response, "transcript": transcript}
```

The existing `/health` endpoint on port 4801 already returns device status — no changes needed there.

---

## 9. Implementation Plan

### Phase 1: Minimum Viable Watch (1-2 days)

1. **Create Wear OS module** in `daemon/watch/` with Compose for Wear OS
2. **Voice recording** with AudioRecord (batch mode)
3. **HTTP POST to `/api/chat`** with on-device SpeechRecognizer for STT (skip custom audio endpoint, use Google's built-in recognizer first)
4. **Display response** on watch screen
5. **STEM_1 button** for push-to-talk
6. **Sideload via ADB** to Galaxy Watch 5

This gets a working voice -> daemon -> text loop on the wrist in the shortest time.

### Phase 2: Polish (1-2 days)

7. **Device status dots** — poll `/health` endpoint
8. **Watch face Tile** with device mesh status
9. **Complication** for quick device count on watch face
10. **Bezel scrolling** for long responses (Horologist `rotaryWithScroll`)
11. **Haptic feedback** on button press, response received
12. **Dark theme** matching daemon brand (black + red)

### Phase 3: Audio Pipeline (2-3 days)

13. **Server `/api/voice` endpoint** — accept raw PCM audio
14. **Deepgram STT on server** instead of on-device Google recognizer (better accuracy, works offline from Google services)
15. **Streaming mode** — send audio chunks over WebSocket as user speaks
16. **Voice note saving** — record and store locally, batch upload

### Phase 4: Integration (1-2 days)

17. **WebSocket device registration** — watch appears in daemon mesh
18. **Watch as command receiver** — daemon can send haptic alerts, display messages
19. **Wear Data Layer** for phone relay (offline WiFi fallback)
20. **Battery optimization** — WorkManager for background polling

---

## 10. Build and Deploy

### Build
```bash
# From daemon/watch/
./gradlew assembleDebug
# APK at: watch/app/build/outputs/apk/debug/app-debug.apk
```

### Deploy to Watch
```bash
# Enable ADB on watch first (see Section 3)
# Pair (first time only):
adb pair <watch-ip>:<pairing-port>
# Connect:
adb connect <watch-ip>:<debug-port>
# Install:
adb install -r watch/app/build/outputs/apk/debug/app-debug.apk
```

### Quick iteration
```bash
# Build + install in one shot
./gradlew installDebug
```

---

## 11. Open Questions

1. **Authentication:** The phone app uses token-based auth. Watch should probably use a pre-shared token stored in SharedPreferences (entered once via phone companion or ADB). Or: trust the Tailscale network and skip auth for direct connections to 100.124.245.114.

2. **Text-to-Speech on watch:** Should the daemon response be read aloud? Galaxy Watch 5 has a speaker. Could use Android TTS engine locally. Low priority for v1 but trivial to add.

3. **Offline mode:** Should the watch queue voice notes when offline and send them when connectivity returns? WorkManager can handle this. Nice for v2.

4. **Multi-turn conversation:** The watch screen is small. Show only latest response, or allow scrolling through conversation history? Recommendation: latest response only, with a "history" swipe page.

5. **Companion app integration:** Should the existing phone daemon app gain a Wear Data Layer listener in v2? Yes — add a `WearableListenerService` to the phone app that forwards messages to server.
