package com.daemon.app.pendant

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
    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())

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
        scope.cancel()
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
        // Skip pendant setMic() — we're using the PHONE mic for capture. The
        // pendant mic isn't streaming audio yet, and setMic(true) causes the
        // pendant to emit a spurious 0x04 DOUBLE event that confuses routing.
        // Revisit when firmware v0.9 streams audio on AUDIO_STREAM char.
        audioRecorder.startPhoneMicRecording()
        sendWsMessage(JSONObject().apply {
            put("type", "pendant.recording_state")
            put("recording", true)
            put("mode", mode)
        })
        canvasText(if (mode == "conversation") "🟢 conversation recording" else "🎤 listening…")
        debugLog("recording start mode=$mode at $sessionStartMs")
    }

    private fun stopRecording() {
        if (!isRecording) return
        isRecording = false
        holdActive = false
        sessionEndMs = System.currentTimeMillis()
        // Matching startRecording — not touching pendant mic.
        audioRecorder.stopPhoneMicRecording()
        sendWsMessage(JSONObject().apply {
            put("type", "pendant.recording_state")
            put("recording", false)
            put("mode", sessionMode ?: "unknown")
            put("duration_ms", sessionEndMs - sessionStartMs)
        })
        canvasText("⏸ transcribing…")
        debugLog("recording stop mode=${sessionMode} duration=${sessionEndMs - sessionStartMs}ms")
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
                        sendWsMessage(JSONObject().apply {
                            put("type", "pendant.connection")
                            put("connected", event.connected)
                        })
                        // Visible state card on /canvas.
                        val cardData = JSONObject().apply {
                            put("title", "Pendant")
                            put("body", if (event.connected) "✅ connected" else "⚠️ disconnected — reconnecting…")
                        }
                        pushCanvas("card", cardData)
                        // Auto-reconnect on unexpected disconnect
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
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getString(KEY_BONDED_ADDRESS, null)
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
