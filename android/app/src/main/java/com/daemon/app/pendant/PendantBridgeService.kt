package com.daemon.app.pendant

import android.annotation.SuppressLint
import android.bluetooth.BluetoothManager
import android.content.Context
import android.util.Log
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.collectLatest
import okhttp3.OkHttpClient
import org.json.JSONObject
import java.io.File

/**
 * Bridges the BLE pendant to the existing DaemonService WebSocket relay.
 *
 * Lifecycle:
 * - Created by DaemonService.onCreate()
 * - Auto-connects to last-known pendant on start
 * - Routes pendant events to WebSocket messages
 * - Handles commands from the relay (LED, mic, record)
 */
class PendantBridgeService(
    private val context: Context,
    private val httpClient: OkHttpClient,
    private val sendWsMessage: (JSONObject) -> Unit,
) {

    companion object {
        private const val TAG = "PendantBridge"
        private const val PREFS = "pendant_prefs"
        private const val KEY_BONDED_ADDRESS = "bonded_pendant_address"
    }

    val gattClient = PendantGattClient(context)
    private val audioRecorder = PendantAudioRecorder(context, httpClient)
    // serviceScope is the long-lived scope tied to this bridge's lifetime.
    // Created in constructor, cancelled only in destroy(). The watchdog runs
    // here so it survives transient GATT churn.
    private val serviceScope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    // scope is kept as an alias for I/O-bound work (HTTP, file I/O) — same
    // lifetime, different dispatcher. Both cancelled in destroy().
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    // Watchdog state (slice-e).
    @Volatile private var lastSeenMs: Long = 0
    @Volatile private var lastDisconnectStatus: Int = -1
    @Volatile private var watchdogBackoffMs: Long = 5_000L
    private var watchdogJob: Job? = null
    // slice-e fix: stale-bond self-heal. If connect fails this many times in a
    // row (status=257 GATT_FAILURE etc.), the stored MAC is wrong/dead and we
    // clear it so the watchdog falls into the scan branch and discovers the
    // pendant that's actually nearby. Was burned hard by a stale 4A:D1 bond
    // blocking the live 4A:D2 pendant from connecting.
    @Volatile private var consecutiveConnectFailures: Int = 0
    private val MAX_CONSECUTIVE_FAILURES_BEFORE_RESCAN = 3

    @Volatile var isRecording = false
        private set

    // Hold state tracking — MAIN_DOWN starts potential hold,
    // HOLD event confirms it, MAIN_UP after hold triggers stop
    private var holdActive = false

    // Current recording session metadata. `sessionMode` is:
    //   "command"      — hold press; transcript → /api/voice/command
    //   "conversation" — double-click; transcripts → /api/voice/context in chunks
    //   null           — idle
    @Volatile private var sessionMode: String? = null
    @Volatile private var sessionStartMs: Long = 0
    @Volatile private var sessionEndMs: Long = 0
    // Stable id per conversation session (rolling chunks reference it).
    @Volatile private var conversationSessionId: String? = null

    init {
        setupAudioListener()
        collectEvents()
    }

    // ── Lifecycle ───────────────────────────────────────────────────

    fun start() {
        debugLog("PendantBridge starting...")
        // B3 fix: if BT adapter isn't ready yet at service start (common during
        // app cold-start), defer the connect until it is. Without this, the
        // bonded-address fast path fails silently and user has to tap "Connect
        // device" to re-kick.
        val btAdapter = (context.getSystemService(Context.BLUETOOTH_SERVICE)
                as? android.bluetooth.BluetoothManager)?.adapter
        if (btAdapter == null || !btAdapter.isEnabled) {
            debugLog("BT adapter not ready (${btAdapter?.state}) — retrying start() in 3s")
            scope.launch {
                var tries = 0
                while (tries < 10 && !(btAdapter?.isEnabled == true)) {
                    delay(1000); tries++
                }
                if (btAdapter?.isEnabled == true) {
                    debugLog("BT ready after ${tries}s, starting")
                    startInternal()
                } else {
                    debugLog("BT still off after 10s, giving up on auto-connect")
                }
            }
            return
        }
        startInternal()
    }

    private fun startInternal() {
        // slice-e: scan for orphan recordings BEFORE any BLE work so we never
        // lose data if connection takes time or fails.
        reUploadOrphans()
        startReconnectWatchdog()
        val address = getBondedAddress()
        if (address != null) {
            debugLog("Auto-connecting to bonded pendant: $address")
            gattClient.connect(address)
        } else {
            debugLog("No bonded pendant — auto-scanning...")
            // Auto-scan and connect to first found pendant
            scope.launch {
                try {
                    debugLog("Starting BLE scan...")
                    val devices = PendantScanner.scan(context, 15000)
                    debugLog("Scan found ${devices.size} devices")
                    if (devices.isNotEmpty()) {
                        val dev = devices.first()
                        debugLog("Connecting to ${dev.name} (${dev.address})")
                        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                            .edit().putString(KEY_BONDED_ADDRESS, dev.address).apply()
                        gattClient.connect(dev.address)
                        debugLog("Connect initiated")
                    } else {
                        debugLog("No DaemonPendant found nearby")
                    }
                } catch (e: Exception) {
                    debugLog("Auto-scan error: ${e.message}")
                    e.printStackTrace()
                }
            }
        }
    }

    // ── Reconnect watchdog (slice-e) ────────────────────────────────
    //
    // Tied to serviceScope (cancelled only in destroy()). Heartbeat-logs every
    // tick so adb logcat shows the watchdog firing even when nothing is wrong.
    // Uses exponential backoff: 5s → 10s → 20s → 45s capped, reset to 5s on
    // any successful connect.
    //
    // Does NOT replace the in-flow auto-reconnect inside collectEvents() (that
    // fires on disconnect-edge, this is the periodic safety net for cases
    // where the disconnect event was missed or the connect attempt silently
    // failed — common after Android process restart or BT stack hiccup).
    /**
     * slice-e stub: log any leftover .wav files in the recordings dir so we
     * have visibility on local archive growth. Full re-upload pipeline is the
     * next iteration — for now we ONLY want to confirm files are landing on
     * disk and surviving across service restarts.
     */
    private fun reUploadOrphans() {
        try {
            val dir = context.getExternalFilesDir("recordings") ?: return
            val wavs = dir.listFiles { f -> f.isFile && f.name.endsWith(".wav") } ?: emptyArray()
            Log.i(TAG, "[orphan] found ${wavs.size} local recordings in ${dir.absolutePath}")
            wavs.sortedByDescending { it.lastModified() }.take(5).forEach { f ->
                Log.i(TAG, "[orphan]   ${f.name} ${f.length()}B mtime=${f.lastModified()}")
            }
        } catch (e: Exception) {
            Log.w(TAG, "[orphan] scan failed: ${e.message}")
        }
    }

    private fun startReconnectWatchdog() {
        watchdogJob?.cancel()
        watchdogJob = serviceScope.launch {
            while (isActive) {
                val isConnected = gattClient.isConnected
                val mac = getBondedAddress() ?: "<none>"
                val nowSinceLastSeen = if (lastSeenMs == 0L) -1
                    else (System.currentTimeMillis() - lastSeenMs) / 1000
                Log.i(TAG, "[watchdog] tick connected=$isConnected " +
                    "lastSeen=${nowSinceLastSeen}s mac=$mac " +
                    "backoff=${watchdogBackoffMs}ms lastStatus=${gattStatusName(lastDisconnectStatus)}")

                if (isConnected) {
                    watchdogBackoffMs = 5_000L
                    consecutiveConnectFailures = 0
                    delay(45_000)
                    continue
                }

                // slice-e fix: belt-and-braces watchdog-side counter. The
                // collectEvents() flow uses collectLatest which can drop rapid
                // ConnectionState events, so we ALSO count tick-while-offline
                // here. Whichever path hits the threshold first triggers the
                // stale-bond clear.
                if (lastSeenMs == 0L && mac != "<none>") {
                    consecutiveConnectFailures++
                    if (consecutiveConnectFailures >= MAX_CONSECUTIVE_FAILURES_BEFORE_RESCAN) {
                        Log.w(TAG, "[watchdog] $consecutiveConnectFailures " +
                            "ticks without ever connecting to $mac — clearing " +
                            "SharedPrefs to force rescan")
                        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                            .edit().remove(KEY_BONDED_ADDRESS).apply()
                        consecutiveConnectFailures = 0
                        watchdogBackoffMs = 5_000L
                        continue
                    }
                }

                // Disconnected — try to (re)connect.
                if (mac != "<none>") {
                    Log.i(TAG, "[watchdog] re-kicking connect to $mac")
                    try {
                        gattClient.connect(mac)
                    } catch (e: Exception) {
                        Log.w(TAG, "[watchdog] connect threw: ${e.message}")
                    }
                } else {
                    // No bonded address — try a short scan.
                    try {
                        val devs = PendantScanner.scan(context, 8_000)
                        if (devs.isNotEmpty()) {
                            val dev = devs.first()
                            Log.i(TAG, "[watchdog] scan found ${dev.name} (${dev.address})")
                            saveBondedAddress(dev.address)
                            gattClient.connect(dev.address)
                        } else {
                            Log.i(TAG, "[watchdog] scan empty")
                        }
                    } catch (e: Exception) {
                        Log.w(TAG, "[watchdog] scan threw: ${e.message}")
                    }
                }

                delay(watchdogBackoffMs)
                watchdogBackoffMs = (watchdogBackoffMs * 2).coerceAtMost(45_000L)
            }
        }
    }

    /** Map common GATT status ints → readable names for logcat. */
    private fun gattStatusName(status: Int): String = when (status) {
        -1 -> "n/a"
        0x00 -> "GATT_SUCCESS(0)"
        0x05 -> "GATT_INSUFFICIENT_AUTHENTICATION(5)"
        0x08 -> "GATT_CONN_TIMEOUT(8)"
        0x13 -> "GATT_CONN_TERMINATE_PEER_USER(19)"
        0x16 -> "GATT_CONN_TERMINATE_LOCAL_HOST(22)"
        0x22 -> "GATT_CONN_LMP_TIMEOUT(34)"
        0x3E -> "GATT_CONN_FAIL_ESTABLISH(62)"
        0x85 -> "GATT_ERROR(133)"
        else -> "status=$status(0x${Integer.toHexString(status)})"
    }

    private fun debugLog(msg: String) {
        Log.d(TAG, msg)
        try {
            val file = File("/storage/emulated/0/Download/pendant_debug.log")
            file.appendText("${System.currentTimeMillis()} $msg\n")
        } catch (_: Exception) {}
        // Also send via WebSocket so the relay can see it
        try {
            sendWsMessage(JSONObject().apply {
                put("type", "pendant.debug")
                put("message", msg)
            })
        } catch (_: Exception) {}
    }

    fun destroy() {
        gattClient.disconnect()
        audioRecorder.destroy()
        watchdogJob?.cancel()
        watchdogJob = null
        scope.cancel()
        serviceScope.cancel()
    }

    // ── Scan + Connect ──────────────────────────────────────────────

    suspend fun scanAndConnect(timeoutMs: Long = 10_000): JSONObject {
        val devices = PendantScanner.scan(context, timeoutMs)
        if (devices.isEmpty()) {
            return JSONObject().apply {
                put("status", "no_pendants_found")
                put("scanned_ms", timeoutMs)
            }
        }
        // Connect to the strongest signal
        val best = devices.maxByOrNull { it.rssi } ?: devices[0]
        gattClient.connect(best.address)
        saveBondedAddress(best.address)
        return JSONObject().apply {
            put("status", "connecting")
            put("device", best.name)
            put("address", best.address)
            put("rssi", best.rssi)
            put("total_found", devices.size)
        }
    }

    fun connectToAddress(address: String) {
        gattClient.connect(address)
        saveBondedAddress(address)
    }

    fun disconnect() {
        gattClient.disconnect()
    }

    // ── Command Handling (from relay) ───────────────────────────────

    fun handleCommand(type: String, cmd: JSONObject): JSONObject {
        return when (type) {
            "pendant.led_set" -> {
                val pattern = cmd.optInt("pattern", 0)
                gattClient.setLed(pattern)
                JSONObject().put("status", "led_set").put("pattern", pattern)
            }
            "pendant.mic_force" -> {
                val on = cmd.optBoolean("on", true)
                gattClient.setMic(on)
                JSONObject().put("status", "mic_set").put("on", on)
            }
            "pendant.record_start" -> {
                startRecording()
                JSONObject().put("status", "recording_started")
            }
            "pendant.record_stop" -> {
                stopRecording()
                JSONObject().put("status", "recording_stopped")
            }
            "pendant.ota.upload" -> {
                val path = cmd.optString("path", "")
                val url = cmd.optString("url", "")
                if (path.isBlank() && url.isBlank()) {
                    JSONObject().put("error", "missing 'path' or 'url'")
                } else {
                    scope.launch {
                        debugLog("OTA fetch: url=$url path=$path")
                        val bin = try {
                            if (url.isNotBlank()) {
                                val req = okhttp3.Request.Builder().url(url).build()
                                httpClient.newCall(req).execute().use { resp ->
                                    if (!resp.isSuccessful) { debugLog("OTA HTTP ${resp.code}"); null }
                                    else resp.body?.bytes()
                                }
                            } else {
                                File(path).inputStream().use { it.readBytes() }
                            }
                        } catch (e: Exception) {
                            debugLog("OTA read failed: ${e.javaClass.simpleName}: ${e.message}")
                            null
                        } ?: return@launch
                        debugLog("OTA upload starting: ${bin.size} bytes")
                        val res = gattClient.uploadFirmware(bin) { sent, total ->
                            if (sent == total || sent % 24000 == 0) {
                                debugLog("OTA progress: $sent/$total")
                            }
                        }
                        res.fold(
                            onSuccess = { debugLog("OTA upload complete, pendant rebooting") },
                            onFailure = { debugLog("OTA upload failed: ${it.message}") },
                        )
                    }
                    JSONObject().put("status", "ota_started")
                }
            }
            "pendant.voice.post" -> {
                // Debug: bypass Deepgram, POST an explicit transcript to /api/voice/command.
                val t = cmd.optString("transcript", "")
                if (t.isBlank()) JSONObject().put("error", "missing 'transcript'")
                else {
                    val now = System.currentTimeMillis()
                    postTranscriptToVoiceCommand(t, now - 1000, now)
                    JSONObject().put("status", "posted").put("transcript", t)
                }
            }
            "pendant.status" -> getStatus()
            "pendant.set_deepgram_key" -> {
                val key = cmd.optString("key", "")
                if (key.isNotBlank()) {
                    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                        .edit().putString("deepgram_api_key", key).apply()
                    JSONObject().put("status", "deepgram_key_saved")
                } else {
                    JSONObject().put("error", "empty key")
                }
            }
            else -> JSONObject().put("error", "unknown pendant command: $type")
        }
    }

    fun getStatus(): JSONObject {
        return JSONObject().apply {
            put("connected", gattClient.isConnected)
            put("battery", gattClient.batteryPercent)
            put("recording", isRecording)
            put("bonded_address", getBondedAddress() ?: JSONObject.NULL)
        }
    }

    // ── Recording ───────────────────────────────────────────────────

    // slice-e: track which audio path was used for THIS recording session so
    // stopRecording() can call the matching stop method.
    @Volatile private var sessionUsedPendantStream: Boolean = false

    private fun startRecording(mode: String = "command") {
        if (isRecording) return
        isRecording = true
        sessionMode = mode
        sessionStartMs = System.currentTimeMillis()
        if (mode == "conversation") {
            conversationSessionId = java.util.UUID.randomUUID().toString()
            chunkIndex = 0
            // 15 s rolling chunks, 5 min hard cap.
            audioRecorder.setConversationChunking(flushMs = 15_000, capMs = 300_000)
        } else {
            audioRecorder.setConversationChunking(flushMs = 0, capMs = 0)
        }
        // slice-e: prefer pendant audio stream when GATT is up. Falls back
        // to phone mic only when the pendant isn't reachable. The chunking
        // setting above only applies to phone-mic mode (rolling-flush);
        // pendant stream uses crash-safe progressive WAV with 30-min rotate.
        if (gattClient.isConnected) {
            Log.i(TAG, "[record] using pendant audio (gatt connected) mode=$mode")
            sessionUsedPendantStream = true
            // Tell pendant to enable mic so it streams chunks over BLE.
            try { gattClient.setMic(true) } catch (e: Exception) {
                Log.w(TAG, "[record] setMic(true) failed: ${e.message}")
            }
            audioRecorder.startPendantStreamRecording(sessionStartMs)
        } else {
            Log.w(TAG, "[record] gatt offline, falling back to phone mic mode=$mode")
            sessionUsedPendantStream = false
            audioRecorder.startPhoneMicRecording()
        }
        sendWsMessage(JSONObject().apply {
            put("type", "pendant.recording_state")
            put("recording", true)
            put("mode", mode)
            put("source", if (sessionUsedPendantStream) "pendant_ble" else "phone_mic")
        })
        canvasText(if (mode == "conversation") "🟢 conversation recording" else "🎤 listening…")
        debugLog("recording start mode=$mode source=${if (sessionUsedPendantStream) "pendant_ble" else "phone_mic"} at $sessionStartMs")
    }

    private fun stopRecording() {
        if (!isRecording) return
        isRecording = false
        holdActive = false
        sessionEndMs = System.currentTimeMillis()
        // slice-e: stop the matching audio path.
        if (sessionUsedPendantStream) {
            try { gattClient.setMic(false) } catch (e: Exception) {
                Log.w(TAG, "[record] setMic(false) failed: ${e.message}")
            }
            audioRecorder.stopPendantStreamRecording()
        } else {
            audioRecorder.stopPhoneMicRecording()
        }
        sendWsMessage(JSONObject().apply {
            put("type", "pendant.recording_state")
            put("recording", false)
            put("mode", sessionMode ?: "unknown")
            put("duration_ms", sessionEndMs - sessionStartMs)
            put("source", if (sessionUsedPendantStream) "pendant_ble" else "phone_mic")
        })
        canvasText("⏸ transcribing…")
        debugLog("recording stop mode=${sessionMode} source=${if (sessionUsedPendantStream) "pendant_ble" else "phone_mic"} duration=${sessionEndMs - sessionStartMs}ms")
    }

    // ── Event Collection ────────────────────────────────────────────

    private fun collectEvents() {
        scope.launch {
            gattClient.events.collectLatest { event ->
                when (event) {
                    is PendantGattClient.PendantEvent.ButtonEvent -> {
                        handleButtonEvent(event.code)
                        sendWsMessage(JSONObject().apply {
                            put("type", "pendant.button")
                            put("code", event.code)
                            put("name", buttonName(event.code))
                        })
                    }
                    is PendantGattClient.PendantEvent.AudioChunk -> {
                        audioRecorder.addChunk(event.data)
                    }
                    is PendantGattClient.PendantEvent.BatteryLevel -> {
                        sendWsMessage(JSONObject().apply {
                            put("type", "pendant.battery")
                            put("percent", event.percent)
                        })
                    }
                    is PendantGattClient.PendantEvent.ConnectionState -> {
                        // slice-e: track lastSeen + last disconnect status for the watchdog.
                        if (event.connected) {
                            lastSeenMs = System.currentTimeMillis()
                            watchdogBackoffMs = 5_000L
                            consecutiveConnectFailures = 0
                            Log.i(TAG, "[connection] connected mac=${getBondedAddress()} " +
                                "status=${gattStatusName(event.status)}")
                        } else {
                            lastDisconnectStatus = event.status
                            consecutiveConnectFailures++
                            Log.i(TAG, "[connection] disconnected mac=${getBondedAddress()} " +
                                "status=${gattStatusName(event.status)} " +
                                "fails=$consecutiveConnectFailures " +
                                "lastSeen=${if (lastSeenMs == 0L) "n/a" else "${(System.currentTimeMillis() - lastSeenMs)/1000}s"}")
                            if (consecutiveConnectFailures >= MAX_CONSECUTIVE_FAILURES_BEFORE_RESCAN) {
                                val stale = getBondedAddress()
                                Log.w(TAG, "[connection] $consecutiveConnectFailures consecutive failures " +
                                    "with bonded=$stale — clearing SharedPrefs to force rescan")
                                context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                                    .edit().remove(KEY_BONDED_ADDRESS).apply()
                                consecutiveConnectFailures = 0
                            }
                        }
                        sendWsMessage(JSONObject().apply {
                            put("type", "pendant.connection")
                            put("connected", event.connected)
                            put("status", event.status)
                            put("status_name", gattStatusName(event.status))
                        })
                        // Visible state card on /canvas.
                        val cardData = JSONObject().apply {
                            put("title", "Pendant")
                            put("body", if (event.connected) "✅ connected" else "⚠️ disconnected — reconnecting…")
                        }
                        pushCanvas("card", cardData)
                        // Auto-reconnect on unexpected disconnect (edge-trigger).
                        // Watchdog also runs as a periodic safety net.
                        if (!event.connected) {
                            val addr = getBondedAddress()
                            if (addr != null) {
                                delay(3000)
                                Log.d(TAG, "Auto-reconnecting to $addr")
                                gattClient.connect(addr)
                            }
                        }
                    }
                }
            }
        }
    }

    /** Test-only entry point: inject a fake button event code. */
    fun simulateButton(code: Int) {
        debugLog("simulateButton 0x${Integer.toHexString(code)}")
        handleButtonEvent(code)
    }

    private fun handleButtonEvent(code: Int) {
        when (code) {
            // 0x03 HOLD_START — command recording (release ends it via 0x06 STOPPED)
            PendantUuids.EVENT_HOLD -> {
                holdActive = true
                if (!isRecording) startRecording(mode = "command")
            }
            // 0x04 DOUBLE — conversation recording starts (or toggles off if already running)
            PendantUuids.EVENT_DOUBLE -> {
                if (isRecording && sessionMode == "conversation") stopRecording()
                else if (!isRecording) startRecording(mode = "conversation")
            }
            // 0x02 MAIN_UP — legacy; not emitted by current firmware
            PendantUuids.EVENT_MAIN_UP -> {
                if (holdActive && isRecording) stopRecording()
            }
            // 0x05 RECORDING — legacy; not emitted by current firmware
            PendantUuids.EVENT_RECORDING -> {
                if (!isRecording) startRecording(mode = "command")
            }
            // 0x06 STOPPED — firmware-signalled stop
            PendantUuids.EVENT_STOPPED -> {
                if (isRecording) stopRecording()
            }
            // 0x07 / 0x08 — CMD_IN_CONVO markers (firmware v0.8.2+).
            // Full handling deferred; mark timestamps for relay to slice later.
            else -> { /* unknown code — ignore for robustness */ }
        }
    }

    private fun setupAudioListener() {
        audioRecorder.listener = object : PendantAudioRecorder.Listener {
            override fun onRecordingSaved(file: File, durationMs: Long) {
                sendWsMessage(JSONObject().apply {
                    put("type", "pendant.recording_saved")
                    put("path", file.absolutePath)
                    put("duration_ms", durationMs)
                    put("size_bytes", file.length())
                })
            }

            override fun onTranscriptReady(file: File, transcript: String) {
                sendWsMessage(JSONObject().apply {
                    put("type", "pendant.recording")
                    put("transcript", transcript)
                    put("audio_path", file.absolutePath)
                    put("mode", sessionMode ?: "unknown")
                })
                if (transcript.isBlank()) {
                    canvasText("🔇 no speech detected")
                } else {
                    canvasText("💬 \"$transcript\"")
                }
                val mode = sessionMode
                val started = sessionStartMs
                val ended = if (sessionEndMs > 0) sessionEndMs else System.currentTimeMillis()
                when (mode) {
                    "conversation" -> postTranscriptChunk(transcript, started, ended)
                    else -> postTranscriptToVoiceCommand(transcript, started, ended)
                }
            }

            override fun onTranscriptError(file: File, error: String) {
                sendWsMessage(JSONObject().apply {
                    put("type", "pendant.transcript_error")
                    put("error", error)
                    put("audio_path", file.absolutePath)
                })
                canvasText("❌ transcript error: $error")
            }
        }
    }

    // ── Voice command routing ───────────────────────────────────────

    /**
     * Forward a pendant transcript to the relay's agent loop via
     * /api/voice/command. Fire-and-forget; the relay responds 202
     * immediately and broadcasts the assistant reply over WS.
     */
    private fun isoTs(ms: Long): String =
        java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", java.util.Locale.US)
            .apply { timeZone = java.util.TimeZone.getTimeZone("UTC") }
            .format(java.util.Date(ms))

    /**
     * Fire-and-forget visual feedback to the /canvas page. Used so the user
     * sees "listening", "transcribing", "<transcript>" in real time,
     * independent of whether the agent ever runs.
     */
    fun pushCanvas(type: String, data: JSONObject) {
        scope.launch {
            try {
                val payload = JSONObject().apply {
                    put("type", type)
                    put("data", data)
                    put("client", "pendant-phone")
                }
                val code = com.daemon.app.service.RelayHttpClient.postAuthenticated(
                    context, "/api/stream/push", payload,
                )
                debugLog("canvas $type → HTTP $code")
            } catch (e: Exception) {
                debugLog("canvas push error: ${e.message}")
            }
        }
    }

    private fun canvasText(s: String, durationMs: Int = 0) {
        val data = JSONObject().put("text", s)
        if (durationMs > 0) data.put("durationMs", durationMs)
        pushCanvas("text", data)
    }

    private fun postTranscriptToVoiceCommand(transcript: String, holdStartedAt: Long, holdEndedAt: Long) {
        if (transcript.isBlank()) { debugLog("voice/command POST skipped — empty transcript"); return }
        scope.launch {
            // One retry for transient network flake. Demo-critical path.
            repeat(2) { attempt ->
                try {
                    val payload = JSONObject().apply {
                        put("transcript", transcript)
                        put("source", "pendant")
                        put("device_id", android.os.Build.MODEL)
                        // Keep both ms and ISO shapes — relay may read either
                        put("hold_started_at", holdStartedAt)
                        put("hold_ended_at", holdEndedAt)
                        put("hold_started_at_iso", isoTs(holdStartedAt))
                        put("hold_ended_at_iso", isoTs(holdEndedAt))
                    }
                    val code = com.daemon.app.service.RelayHttpClient.postAuthenticated(
                        context, "/api/voice/command", payload,
                    )
                    debugLog("voice/command POST → HTTP $code (transcript ${transcript.length}ch attempt=$attempt)")
                    if (code in 200..299) return@launch
                } catch (e: Exception) {
                    debugLog("voice/command POST error attempt=$attempt: ${e.message}")
                }
                if (attempt == 0) delay(500)
            }
        }
    }

    /**
     * Conversation-mode chunk. Each ~15 s transcript slice posts to
     * /api/voice/context with session_id + chunk_index + started_at/ended_at.
     */
    @Volatile private var chunkIndex = 0
    private fun postTranscriptChunk(transcript: String, startedAt: Long, endedAt: Long) {
        if (transcript.isBlank()) return
        val sessionId = conversationSessionId ?: return
        val idx = chunkIndex++
        scope.launch {
            repeat(2) { attempt ->
                try {
                    val payload = JSONObject().apply {
                        put("transcript", transcript)
                        put("source", "pendant")
                        put("device_id", android.os.Build.MODEL)
                        put("session_id", sessionId)
                        put("chunk_index", idx)
                        // /api/voice/context expects ISO8601 strings
                        put("started_at", isoTs(startedAt))
                        put("ended_at", isoTs(endedAt))
                    }
                    val code = com.daemon.app.service.RelayHttpClient.postAuthenticated(
                        context, "/api/voice/context", payload,
                    )
                    debugLog("voice/context POST → HTTP $code (session=${sessionId.take(8)} chunk=$idx attempt=$attempt)")
                    if (code in 200..299) return@launch
                } catch (e: Exception) {
                    debugLog("voice/context POST error attempt=$attempt: ${e.message}")
                }
                if (attempt == 0) delay(500)
            }
        }
    }

    // ── Persistence ─────────────────────────────────────────────────

    private fun saveBondedAddress(address: String) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit().putString(KEY_BONDED_ADDRESS, address).apply()
    }

    fun getBondedAddress(): String? {
        val persisted = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getString(KEY_BONDED_ADDRESS, null)
        if (persisted != null) {
            Log.i(TAG, "[mac] using SharedPrefs persisted: $persisted")
            return persisted
        }
        // slice-e fix: OS bonded-list fallback. Even when SharedPrefs is empty
        // (post-reinstall, post-self-heal), Android's system Bluetooth bond
        // list still has the pendant from a prior pairing — use it directly
        // so we don't depend on the pendant being actively advertising RIGHT
        // NOW for connect to work. autoConnect=true on a known MAC reconnects
        // when the pendant next advertises, no scan required.
        osBondedPendant()?.let { (mac, name) ->
            Log.i(TAG, "[mac] using OS bond list: $mac ($name)")
            saveBondedAddress(mac)
            return mac
        }
        // slice-e: post-reinstall fallback. SharedPrefs is wiped when the
        // APK is reinstalled (new UID); without this seed, getBondedAddress()
        // returns null and PendantScanner.scan() needs BLUETOOTH_SCAN — which
        // is also wiped on reinstall. The default MAC unblocks auto-connect
        // because Android can connectGatt(autoConnect=true) on a known MAC
        // using only BLUETOOTH_CONNECT (which is auto-granted when scan was
        // previously granted, in many install flows).
        val seed = com.daemon.app.BuildConfig.PENDANT_DEFAULT_MAC
        if (seed.isNullOrBlank() || !seed.matches(Regex("^[0-9A-Fa-f:]{17}$"))) {
            return null
        }
        Log.i(TAG, "[mac] using default seed (post-reinstall path): $seed")
        return seed
    }

    @SuppressLint("MissingPermission")
    private fun osBondedPendant(): Pair<String, String>? = try {
        val mgr = context.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
        mgr?.adapter?.bondedDevices
            ?.firstOrNull { it.name?.startsWith("DaemonPendant") == true }
            ?.let { it.address to (it.name ?: "DaemonPendant") }
    } catch (e: Exception) {
        Log.w(TAG, "[mac] osBondedPendant lookup failed: ${e.message}")
        null
    }

    private fun buttonName(code: Int): String = when (code) {
        PendantUuids.EVENT_MAIN_DOWN -> "main_down"
        PendantUuids.EVENT_MAIN_UP -> "main_up"
        PendantUuids.EVENT_HOLD -> "hold"
        PendantUuids.EVENT_DOUBLE -> "double"
        PendantUuids.EVENT_RECORDING -> "recording"
        PendantUuids.EVENT_STOPPED -> "stopped"
        else -> "unknown_0x${code.toString(16)}"
    }
}
