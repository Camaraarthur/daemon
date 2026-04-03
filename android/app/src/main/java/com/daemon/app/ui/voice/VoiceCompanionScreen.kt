package com.daemon.app.ui.voice

import android.Manifest
import android.content.pm.PackageManager
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.AudioTrack
import android.media.MediaRecorder
import androidx.compose.animation.core.*
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import com.daemon.app.ui.chat.DarkBg
import com.daemon.app.ui.chat.DarkSurface
import com.daemon.app.ui.chat.DaemonRed
import com.daemon.app.ui.chat.TextDark
import kotlinx.coroutines.*
import okhttp3.*
import okio.ByteString
import okio.ByteString.Companion.toByteString
import org.json.JSONObject
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.concurrent.TimeUnit

data class TranscriptEntry(
    val role: String, // "user" or "model"
    val text: String,
    val timestamp: Long = System.currentTimeMillis(),
)

enum class SessionState { IDLE, CONNECTING, CONNECTED, ERROR }

@Composable
fun VoiceCompanionScreen(
    serverUrl: String = "ws://100.124.245.114:4803/ws",
    onBack: () -> Unit,
) {
    val context = LocalContext.current
    var state by remember { mutableStateOf(SessionState.IDLE) }
    var transcript by remember { mutableStateOf(listOf<TranscriptEntry>()) }
    var brainCount by remember { mutableIntStateOf(0) }
    var brainAction by remember { mutableStateOf("") }
    var error by remember { mutableStateOf("") }
    var holdActive by remember { mutableStateOf(false) }
    var liveUserText by remember { mutableStateOf("") }
    var liveModelText by remember { mutableStateOf("") }
    val listState = rememberLazyListState()
    val scope = rememberCoroutineScope()

    // WebSocket + audio refs
    var ws by remember { mutableStateOf<WebSocket?>(null) }
    var audioRecord by remember { mutableStateOf<AudioRecord?>(null) }
    var audioTrack by remember { mutableStateOf<AudioTrack?>(null) }
    var captureJob by remember { mutableStateOf<Job?>(null) }

    val hasMic = ContextCompat.checkSelfPermission(
        context, Manifest.permission.RECORD_AUDIO
    ) == PackageManager.PERMISSION_GRANTED

    // Auto-scroll
    LaunchedEffect(transcript.size) {
        if (transcript.isNotEmpty()) {
            listState.animateScrollToItem(transcript.size - 1)
        }
    }

    // Cleanup on dispose
    DisposableEffect(Unit) {
        onDispose {
            captureJob?.cancel()
            audioRecord?.stop()
            audioRecord?.release()
            audioTrack?.stop()
            audioTrack?.release()
            ws?.close(1000, "disposed")
        }
    }

    fun startSession() {
        if (!hasMic) {
            error = "Microphone permission required"
            return
        }
        state = SessionState.CONNECTING
        error = ""
        transcript = emptyList()

        val client = OkHttpClient.Builder()
            .readTimeout(0, TimeUnit.MILLISECONDS)
            .connectTimeout(10, TimeUnit.SECONDS)
            .build()

        val request = Request.Builder().url(serverUrl).build()

        // Start audio playback track (24kHz PCM16 mono)
        val playTrack = AudioTrack.Builder()
            .setAudioFormat(
                AudioFormat.Builder()
                    .setSampleRate(24000)
                    .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                    .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                    .build()
            )
            .setBufferSizeInBytes(
                AudioTrack.getMinBufferSize(24000, AudioFormat.CHANNEL_OUT_MONO, AudioFormat.ENCODING_PCM_16BIT) * 2
            )
            .setTransferMode(AudioTrack.MODE_STREAM)
            .build()
        playTrack.play()
        audioTrack = playTrack

        ws = client.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                // Tell server to start Gemini session
                webSocket.send(JSONObject().put("type", "connect").toString())
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                val data = JSONObject(text)
                when (data.optString("type")) {
                    "status" -> {
                        when (data.optString("state")) {
                            "connected" -> {
                                state = SessionState.CONNECTED
                                // Start mic capture
                                startCapture(webSocket, scope) { rec, job ->
                                    audioRecord = rec
                                    captureJob = job
                                }
                            }
                            "disconnected" -> state = SessionState.IDLE
                            "error" -> {
                                state = SessionState.ERROR
                                error = data.optString("message", "Connection failed")
                            }
                        }
                    }
                    "audio" -> {
                        // Decode base64 PCM and play
                        val b64 = data.optString("data", "")
                        if (b64.isNotEmpty()) {
                            val bytes = android.util.Base64.decode(b64, android.util.Base64.DEFAULT)
                            playTrack.write(bytes, 0, bytes.size)
                        }
                    }
                    "transcript" -> {
                        val role = data.optString("role")
                        val text = data.optString("text")
                        val partial = data.optBoolean("partial", false)

                        if (partial) {
                            // Live streaming text — accumulate
                            if (role == "user") {
                                liveUserText += text
                            } else {
                                liveModelText += text
                            }
                        } else {
                            // Final turn text — save to transcript, clear live
                            if (role == "user") {
                                transcript = transcript + TranscriptEntry(role = "user", text = text)
                                liveUserText = ""
                            } else {
                                transcript = transcript + TranscriptEntry(role = "model", text = text)
                                liveModelText = ""
                            }
                        }
                    }
                    "brain_update" -> {
                        brainAction = data.optString("action", "")
                        brainCount = data.optInt("count", 0)
                    }
                    "hold" -> {
                        holdActive = data.optBoolean("active", false)
                    }
                }
            }

            override fun onMessage(webSocket: WebSocket, bytes: ByteString) {
                // Binary audio from server — play directly
                val audioBytes = bytes.toByteArray()
                playTrack.write(audioBytes, 0, audioBytes.size)
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                state = SessionState.ERROR
                error = "Connection failed: ${t.message}"
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                state = SessionState.IDLE
                captureJob?.cancel()
            }
        })
    }

    fun stopSession() {
        captureJob?.cancel()
        audioRecord?.stop()
        audioRecord?.release()
        audioRecord = null
        audioTrack?.stop()
        audioTrack?.release()
        audioTrack = null
        ws?.send(JSONObject().put("type", "disconnect").toString())
        ws?.close(1000, "user stopped")
        ws = null
        state = SessionState.IDLE
    }

    // UI
    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(DarkBg)
            .statusBarsPadding()
            .navigationBarsPadding()
    ) {
        // Header
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            TextButton(onClick = onBack) {
                Text("← chat", color = TextDark, fontSize = 13.sp)
            }
            Text(
                "voice companion",
                color = Color.White,
                fontWeight = FontWeight.Medium,
                fontSize = 18.sp,
            )
            Spacer(Modifier.weight(1f))
            if (brainCount > 0) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Box(
                        modifier = Modifier
                            .size(8.dp)
                            .clip(CircleShape)
                            .background(
                                when (brainAction) {
                                    "THINKING" -> Color(0xFFEAB308) // yellow
                                    "UPDATED" -> Color(0xFF22C55E) // green
                                    else -> Color(0xFF333333)
                                }
                            )
                    )
                    Spacer(Modifier.width(6.dp))
                    Text(
                        "brain: $brainCount",
                        color = TextDark,
                        fontSize = 11.sp,
                    )
                }
            }
        }

        // Transcript
        LazyColumn(
            modifier = Modifier
                .weight(1f)
                .padding(horizontal = 16.dp),
            state = listState,
        ) {
            if (transcript.isEmpty() && state == SessionState.IDLE) {
                item {
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(top = 120.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                    ) {
                        Box(
                            modifier = Modifier
                                .size(80.dp)
                                .clip(CircleShape)
                                .background(DarkSurface),
                            contentAlignment = Alignment.Center,
                        ) {
                            Text("◉", color = TextDark, fontSize = 32.sp)
                        }
                        Spacer(Modifier.height(16.dp))
                        Text(
                            "Talk to your daemon.\nIt knows you — your messages, notes, years of history.",
                            color = TextDark,
                            fontSize = 13.sp,
                            lineHeight = 20.sp,
                            modifier = Modifier.padding(horizontal = 32.dp),
                        )
                    }
                }
            }

            items(transcript) { entry ->
                TranscriptBubble(entry)
                Spacer(Modifier.height(8.dp))
            }

            // Live streaming text (partial, still being spoken)
            if (liveUserText.isNotEmpty()) {
                item {
                    Column(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalAlignment = Alignment.End,
                    ) {
                        Text("you", color = TextDark, fontSize = 10.sp,
                            modifier = Modifier.padding(horizontal = 4.dp, vertical = 2.dp))
                        Box(
                            modifier = Modifier
                                .widthIn(max = 300.dp)
                                .clip(RoundedCornerShape(16.dp))
                                .background(DarkSurface.copy(alpha = 0.6f))
                                .padding(horizontal = 14.dp, vertical = 10.dp)
                        ) {
                            Text(liveUserText, color = Color(0xFF999999),
                                fontSize = 14.sp, lineHeight = 20.sp)
                        }
                    }
                    Spacer(Modifier.height(8.dp))
                }
            }
            if (liveModelText.isNotEmpty()) {
                item {
                    Column(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalAlignment = Alignment.Start,
                    ) {
                        Text("companion", color = TextDark, fontSize = 10.sp,
                            modifier = Modifier.padding(horizontal = 4.dp, vertical = 2.dp))
                        Box(
                            modifier = Modifier
                                .widthIn(max = 300.dp)
                                .clip(RoundedCornerShape(16.dp))
                                .background(Color(0xFF141414).copy(alpha = 0.6f))
                                .padding(horizontal = 14.dp, vertical = 10.dp)
                        ) {
                            Text(liveModelText, color = Color(0xFF777777),
                                fontSize = 14.sp, lineHeight = 20.sp)
                        }
                    }
                    Spacer(Modifier.height(8.dp))
                }
            }

            if (state == SessionState.CONNECTED) {
                item {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(vertical = 8.dp),
                        horizontalArrangement = Arrangement.Center,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        if (holdActive) {
                            Box(
                                modifier = Modifier
                                    .size(6.dp)
                                    .clip(CircleShape)
                                    .background(Color(0xFFEAB308))
                            )
                            Spacer(Modifier.width(8.dp))
                            Text("holding — speak freely", color = Color(0xFFEAB308), fontSize = 12.sp)
                        } else {
                            PulseDot()
                            Spacer(Modifier.width(4.dp))
                            PulseDot(delay = 200)
                            Spacer(Modifier.width(4.dp))
                            PulseDot(delay = 400)
                            Spacer(Modifier.width(8.dp))
                            Text("listening", color = TextDark, fontSize = 12.sp)
                        }
                    }
                }
            }
        }

        // Controls
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(vertical = 24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            if (error.isNotEmpty()) {
                Text(
                    error,
                    color = DaemonRed,
                    fontSize = 12.sp,
                    modifier = Modifier.padding(bottom = 12.dp, start = 32.dp, end = 32.dp),
                )
            }

            // Big mic button + hold button
            val pulseAnim = rememberInfiniteTransition(label = "pulse")
            val pulseScale by pulseAnim.animateFloat(
                initialValue = 1f,
                targetValue = 1.08f,
                animationSpec = infiniteRepeatable(
                    tween(800, easing = EaseInOutCubic),
                    RepeatMode.Reverse,
                ),
                label = "pulseScale",
            )

            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.Center,
                modifier = Modifier.fillMaxWidth(),
            ) {
                // Hold button — "just listen, don't respond"
                if (state == SessionState.CONNECTED) {
                    Button(
                        onClick = {
                            val newHold = !holdActive
                            ws?.send(
                                JSONObject().put(
                                    "type",
                                    if (newHold) "hold_start" else "hold_stop"
                                ).toString()
                            )
                            holdActive = newHold
                        },
                        modifier = Modifier.size(52.dp),
                        shape = CircleShape,
                        colors = ButtonDefaults.buttonColors(
                            containerColor = if (holdActive) Color(0xFFEAB308) else DarkSurface,
                        ),
                        contentPadding = PaddingValues(0.dp),
                    ) {
                        Text(
                            if (holdActive) "▶" else "✋",
                            color = if (holdActive) Color.Black else TextDark,
                            fontSize = 18.sp,
                        )
                    }
                    Spacer(Modifier.width(24.dp))
                }

                // Main mic button
                Button(
                    onClick = {
                        if (state == SessionState.CONNECTED) stopSession()
                        else startSession()
                    },
                    modifier = Modifier
                        .size(80.dp)
                        .then(
                            if (state == SessionState.CONNECTED && !holdActive)
                                Modifier.scale(pulseScale)
                            else Modifier
                        ),
                    shape = CircleShape,
                    colors = ButtonDefaults.buttonColors(
                        containerColor = when {
                            holdActive -> Color(0xFF2A2A00) // dim yellow-ish when held
                            state == SessionState.CONNECTED -> DaemonRed
                            else -> DarkSurface
                        }
                    ),
                    enabled = state != SessionState.CONNECTING,
                    contentPadding = PaddingValues(0.dp),
                ) {
                    when (state) {
                        SessionState.CONNECTED -> Text("■", color = Color.White, fontSize = 24.sp)
                        SessionState.CONNECTING -> {
                            CircularProgressIndicator(
                                modifier = Modifier.size(24.dp),
                                color = TextDark,
                                strokeWidth = 2.dp,
                            )
                        }
                        else -> Text("◉", color = Color(0xFF888888), fontSize = 28.sp)
                    }
                }
            }

            Spacer(Modifier.height(8.dp))
            Text(
                when {
                    holdActive -> "hold — just listening, tap ✋ when ready"
                    state == SessionState.CONNECTED -> "tap to end · ✋ to hold"
                    state == SessionState.CONNECTING -> "connecting to gemini live..."
                    else -> "tap to start talking"
                },
                color = if (holdActive) Color(0xFFEAB308) else TextDark,
                fontSize = 12.sp,
            )
        }
    }
}

@Composable
private fun TranscriptBubble(entry: TranscriptEntry) {
    val isUser = entry.role == "user"
    Column(
        modifier = Modifier.fillMaxWidth(),
        horizontalAlignment = if (isUser) Alignment.End else Alignment.Start,
    ) {
        Text(
            if (isUser) "you" else "companion",
            color = TextDark,
            fontSize = 10.sp,
            modifier = Modifier.padding(horizontal = 4.dp, vertical = 2.dp),
        )
        Box(
            modifier = Modifier
                .widthIn(max = 300.dp)
                .clip(RoundedCornerShape(16.dp))
                .background(if (isUser) DarkSurface else Color(0xFF141414))
                .padding(horizontal = 14.dp, vertical = 10.dp)
        ) {
            Text(
                entry.text,
                color = if (isUser) Color(0xFFCCCCCC) else Color(0xFF999999),
                fontSize = 14.sp,
                lineHeight = 20.sp,
            )
        }
    }
}

@Composable
private fun PulseDot(delay: Int = 0) {
    val anim = rememberInfiniteTransition(label = "dot")
    val alpha by anim.animateFloat(
        initialValue = 0.3f,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(
            tween(600, delayMillis = delay, easing = EaseInOutCubic),
            RepeatMode.Reverse,
        ),
        label = "dotAlpha",
    )
    Box(
        modifier = Modifier
            .size(6.dp)
            .clip(CircleShape)
            .background(DaemonRed.copy(alpha = alpha))
    )
}

/**
 * Start PCM16 16kHz mono capture and send chunks over WebSocket as binary.
 */
private fun startCapture(
    webSocket: WebSocket,
    scope: CoroutineScope,
    onStarted: (AudioRecord, Job) -> Unit,
) {
    val sampleRate = 16000
    val bufferSize = AudioRecord.getMinBufferSize(
        sampleRate,
        AudioFormat.CHANNEL_IN_MONO,
        AudioFormat.ENCODING_PCM_16BIT,
    ).coerceAtLeast(4096)

    val record = AudioRecord(
        MediaRecorder.AudioSource.VOICE_COMMUNICATION,
        sampleRate,
        AudioFormat.CHANNEL_IN_MONO,
        AudioFormat.ENCODING_PCM_16BIT,
        bufferSize * 2,
    )

    record.startRecording()

    val job = scope.launch(Dispatchers.IO) {
        val buffer = ByteArray(bufferSize)
        try {
            while (isActive) {
                val read = record.read(buffer, 0, buffer.size)
                if (read > 0) {
                    webSocket.send(buffer.copyOf(read).toByteString())
                }
            }
        } finally {
            record.stop()
            record.release()
        }
    }

    onStarted(record, job)
}
