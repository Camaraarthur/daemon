package com.daemon.app.overlay

import android.annotation.SuppressLint
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.drawable.GradientDrawable
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.os.Build
import android.os.Bundle
import android.os.IBinder
import android.util.Log
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.view.inputmethod.EditorInfo
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import com.daemon.app.service.RelayHttpClient
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import androidx.core.app.NotificationCompat
import java.io.ByteArrayOutputStream
import java.io.DataOutputStream
import java.io.File
import kotlin.concurrent.thread

/**
 * Hover-mic overlay. Draws a draggable floating circular button via the
 * WindowManager using SYSTEM_ALERT_WINDOW. Hold = record 16 kHz mono PCM
 * to a temp WAV; release = broadcast an intent to DaemonService which
 * uploads + dispatches to the relay's /api/voice/command endpoint with
 * `source: "hover"`.
 *
 * Lifecycle: started as a foreground service by the companion when the
 * user enables the hover mic in Settings. Persists until explicitly
 * stopped. Overlay state survives process death because the Service is
 * foreground (notification-backed).
 *
 * Intentionally uses classic Views, not Compose — Compose overlays
 * need extra LifecycleOwner plumbing that's not worth the complexity
 * for a single circular button.
 */
class HoverMicService : Service() {
    private lateinit var wm: WindowManager
    private var overlay: View? = null
    private var layoutParams: WindowManager.LayoutParams? = null

    private var recorder: AudioRecord? = null
    private var recordThread: Thread? = null
    @Volatile private var isRecording = false
    private var wavOut: File? = null

    companion object {
        private const val TAG = "HoverMic"
        private const val NOTIF_CHANNEL = "daemon_hover_mic"
        private const val NOTIF_ID = 7101
        const val ACTION_START = "com.daemon.app.hover_mic.START"
        const val ACTION_STOP = "com.daemon.app.hover_mic.STOP"
        /** Emitted on release after audio file is written. Extras:
         *  WAV_PATH (String), DURATION_MS (Long). DaemonService listens. */
        const val ACTION_UTTERANCE_READY = "com.daemon.app.hover_mic.UTTERANCE_READY"
        const val EXTRA_WAV_PATH = "wav_path"
        const val EXTRA_DURATION_MS = "duration_ms"

        private const val SAMPLE_RATE = 16000
        private const val CHANNEL_CONFIG = AudioFormat.CHANNEL_IN_MONO
        private const val ENCODING = AudioFormat.ENCODING_PCM_16BIT
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> { stopSelf(); return START_NOT_STICKY }
        }
        // NOT a foreground service. Starting a microphone-type FGS from a
        // background WS command isn't allowed on SDK 35; specialUse
        // requires a <property> manifest declaration. Keeping this as a
        // regular Service is fine:
        //   - SYSTEM_ALERT_WINDOW lets the overlay View stay visible.
        //   - Audio recording happens while the user is actively holding
        //     the button, which is foreground interaction by definition.
        //   - If Android kills us under memory pressure, the user can
        //     re-enable via the toggle.
        if (overlay == null) showOverlay()
        return START_STICKY
    }

    @SuppressLint("ClickableViewAccessibility", "InflateParams")
    private fun showOverlay() {
        wm = getSystemService(Context.WINDOW_SERVICE) as WindowManager

        // Circular button: red mic pictogram on a pure black circle —
        // matches the Daemon wordmark palette (red on black).
        val size = (resources.displayMetrics.density * 52).toInt()
        val container = FrameLayout(this).apply {
            layoutParams = FrameLayout.LayoutParams(size, size)
            background = GradientDrawable().apply {
                shape = GradientDrawable.OVAL
                setColor(Color.BLACK)
            }
            clipToOutline = true
            elevation = resources.displayMetrics.density * 6
        }
        // The drawable is already red-on-black (generated via icon-gen
        // M4 pictogram prompt). No tinting — the red stays red. Small
        // inset only so the pictogram's black background lines up with
        // the button's black background seamlessly; the red shape fills
        // the circle.
        val glyph = ImageView(this).apply {
            setImageResource(com.daemon.app.R.drawable.ic_hover_mic)
            scaleType = ImageView.ScaleType.CENTER_CROP
            layoutParams = FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT,
            )
        }
        container.addView(glyph)

        // Default position: bottom-right (thumb-reach) above the nav bar.
        // Anchored TOP|START so the drag handler's dx/dy math stays
        // intuitive (positive x = right, positive y = down).
        val dm = resources.displayMetrics
        val dp = dm.density
        layoutParams = WindowManager.LayoutParams(
            size, size,
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
                WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
            else
                @Suppress("DEPRECATION") WindowManager.LayoutParams.TYPE_PHONE,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                or WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
            PixelFormat.TRANSLUCENT,
        ).apply {
            gravity = Gravity.TOP or Gravity.START
            x = dm.widthPixels - size - (dp * 16).toInt()
            y = dm.heightPixels - size - (dp * 200).toInt()
        }

        // Gesture recognition — three distinct interactions:
        //   TAP     → open the text-input overlay (quick release, no drag)
        //   HOLD    → record & transcribe (press > 250ms then release)
        //   DRAG    → move the button, snap to nearest horizontal edge on release
        //
        // Recording only starts after the HOLD threshold so a tap doesn't
        // create a junk 1-frame WAV. Snap happens on ACTION_UP when the
        // user dragged.
        val tapThresholdMs = 320L
        val moveThresholdPx = (dm.density * 8).toInt()
        var downX = 0
        var downY = 0
        var touchX = 0f
        var touchY = 0f
        var moved = false
        var downAt = 0L
        var holdFired = false
        var released = false
        val holdRunnable = Runnable {
            // Triple guard: released flag catches the case where the
            // Runnable is already on the Looper but ACTION_UP came first
            // (removeCallbacks is no-op once the message is in flight).
            if (released || moved || holdFired) return@Runnable
            holdFired = true
            container.animate().scaleX(0.92f).scaleY(0.92f).setDuration(80).start()
            startRecording()
        }

        container.setOnTouchListener { _, ev ->
            when (ev.action) {
                MotionEvent.ACTION_DOWN -> {
                    downX = layoutParams!!.x
                    downY = layoutParams!!.y
                    touchX = ev.rawX
                    touchY = ev.rawY
                    moved = false
                    downAt = System.currentTimeMillis()
                    holdFired = false
                    released = false
                    container.postDelayed(holdRunnable, tapThresholdMs)
                    true
                }
                MotionEvent.ACTION_MOVE -> {
                    val dx = (ev.rawX - touchX).toInt()
                    val dy = (ev.rawY - touchY).toInt()
                    if (!moved && (Math.abs(dx) > moveThresholdPx || Math.abs(dy) > moveThresholdPx)) {
                        moved = true
                        container.removeCallbacks(holdRunnable)
                    }
                    if (moved) {
                        layoutParams!!.x = downX + dx
                        layoutParams!!.y = downY + dy
                        try { wm.updateViewLayout(container, layoutParams) } catch (_: Exception) {}
                    }
                    true
                }
                MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                    // Set released BEFORE removing callbacks so a
                    // Runnable already on the Looper's queue sees the
                    // flag and aborts instead of starting the recorder.
                    released = true
                    container.removeCallbacks(holdRunnable)
                    val elapsed = System.currentTimeMillis() - downAt
                    when {
                        moved -> {
                            // Snap to whichever side is closer.
                            val edgeMargin = (dm.density * 8).toInt()
                            val screenW = dm.widthPixels
                            val centerX = layoutParams!!.x + size / 2
                            val targetX = if (centerX < screenW / 2) edgeMargin else screenW - size - edgeMargin
                            // Clamp y to visible area.
                            val topMargin = (dm.density * 48).toInt()
                            val bottomMargin = (dm.density * 96).toInt()
                            layoutParams!!.y = layoutParams!!.y.coerceIn(topMargin, dm.heightPixels - size - bottomMargin)
                            animateSnapTo(container, targetX)
                        }
                        holdFired -> {
                            container.animate().scaleX(1f).scaleY(1f).setDuration(120).start()
                            stopRecordingAndDispatch()
                        }
                        elapsed < tapThresholdMs -> {
                            // Pure tap → open text input overlay.
                            container.animate().scaleX(1f).scaleY(1f).setDuration(120).start()
                            showTextInput()
                        }
                        else -> {
                            container.animate().scaleX(1f).scaleY(1f).setDuration(120).start()
                        }
                    }
                    true
                }
                else -> false
            }
        }

        try {
            wm.addView(container, layoutParams)
            overlay = container
            Log.d(TAG, "overlay shown")
        } catch (e: Exception) {
            Log.e(TAG, "failed to add overlay — SYSTEM_ALERT_WINDOW not granted?", e)
            stopSelf()
        }
    }

    private fun startRecording() {
        if (isRecording) return
        val minBuf = AudioRecord.getMinBufferSize(SAMPLE_RATE, CHANNEL_CONFIG, ENCODING)
        if (minBuf <= 0) {
            Log.e(TAG, "AudioRecord.getMinBufferSize failed: $minBuf")
            return
        }
        try {
            val rec = AudioRecord(
                MediaRecorder.AudioSource.MIC,
                SAMPLE_RATE, CHANNEL_CONFIG, ENCODING,
                minBuf * 4,
            )
            if (rec.state != AudioRecord.STATE_INITIALIZED) {
                Log.e(TAG, "AudioRecord not initialized (permission denied?)")
                rec.release()
                return
            }
            recorder = rec
            val wav = File(cacheDir, "hover-mic-${System.currentTimeMillis()}.wav")
            wavOut = wav
            val startedAt = System.currentTimeMillis()
            rec.startRecording()
            isRecording = true
            val pcm = ByteArrayOutputStream()
            // Recording thread writes PCM as it comes in; when the main
            // thread flips isRecording=false + calls recorder.stop(),
            // rec.read() returns -1 almost immediately, the loop breaks,
            // and THIS thread writes the WAV + fires the broadcast. The
            // UI handler doesn't join — release-to-sent is instant from
            // the user's POV.
            recordThread = thread(start = true, name = "HoverMicRecord") {
                val buf = ByteArray(minBuf)
                while (isRecording) {
                    val n = try { rec.read(buf, 0, buf.size) } catch (_: Exception) { -1 }
                    if (n > 0) pcm.write(buf, 0, n) else break
                }
                try { rec.release() } catch (_: Exception) {}
                writeWav(wav, pcm.toByteArray(), SAMPLE_RATE)
                val durationMs = System.currentTimeMillis() - startedAt
                if (durationMs < 400) {
                    try { wav.delete() } catch (_: Exception) {}
                } else {
                    sendBroadcast(Intent(ACTION_UTTERANCE_READY).setPackage(packageName).apply {
                        putExtra(EXTRA_WAV_PATH, wav.absolutePath)
                        putExtra(EXTRA_DURATION_MS, durationMs)
                    })
                }
            }
        } catch (e: SecurityException) {
            Log.e(TAG, "RECORD_AUDIO not granted", e)
        } catch (e: Exception) {
            Log.e(TAG, "startRecording failed", e)
        }
    }

    private fun stopRecordingAndDispatch() {
        if (!isRecording) return
        // Signal the recording thread to exit. It will release the
        // recorder, write the WAV, and broadcast the utterance itself —
        // we don't join here, so this returns in microseconds and the
        // UI stays responsive.
        isRecording = false
        try { recorder?.stop() } catch (_: Exception) {}
        recorder = null
        recordThread = null
        wavOut = null
    }

    private fun writeWav(file: File, pcm: ByteArray, sampleRate: Int) {
        try {
            file.outputStream().use { raw ->
                DataOutputStream(raw).use { out ->
                    val byteRate = sampleRate * 2 * 1  // 16-bit mono
                    val totalDataLen = pcm.size + 36
                    out.writeBytes("RIFF")
                    out.writeIntLE(totalDataLen)
                    out.writeBytes("WAVE")
                    out.writeBytes("fmt ")
                    out.writeIntLE(16)
                    out.writeShortLE(1)          // PCM
                    out.writeShortLE(1)          // channels
                    out.writeIntLE(sampleRate)
                    out.writeIntLE(byteRate)
                    out.writeShortLE(2)          // block align
                    out.writeShortLE(16)         // bits per sample
                    out.writeBytes("data")
                    out.writeIntLE(pcm.size)
                    out.write(pcm)
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "writeWav failed", e)
        }
    }

    private fun DataOutputStream.writeIntLE(v: Int) {
        write(v and 0xff); write((v shr 8) and 0xff); write((v shr 16) and 0xff); write((v shr 24) and 0xff)
    }
    private fun DataOutputStream.writeShortLE(v: Int) {
        write(v and 0xff); write((v shr 8) and 0xff)
    }

    // ── Snap-to-edge ──────────────────────────────────────
    private fun animateSnapTo(container: View, targetX: Int) {
        val lp = layoutParams ?: return
        val startX = lp.x
        val anim = android.animation.ValueAnimator.ofInt(startX, targetX).apply {
            duration = 180
            interpolator = android.view.animation.DecelerateInterpolator()
            addUpdateListener {
                lp.x = it.animatedValue as Int
                try { wm.updateViewLayout(container, lp) } catch (_: Exception) {}
            }
        }
        container.animate().scaleX(1f).scaleY(1f).setDuration(120).start()
        anim.start()
    }

    // ── Text input overlay ────────────────────────────────
    //
    // Pure tap on the mic button opens this: a small dark card with a
    // single-line EditText + "send" button, focused immediately so the
    // keyboard pops. On submit, we POST the typed text to the same
    // /api/voice/command endpoint with source="hover-text" so the rest
    // of the pipeline (classifier fast-path OR claude pendant agent)
    // doesn't care whether the input came from voice or text.
    //
    // The overlay is a SEPARATE WindowManager view, focusable (unlike
    // the mic itself), so Android's IME will deliver keystrokes to it.

    private var textInputView: View? = null

    private fun showTextInput() {
        if (textInputView != null) return
        val dm = resources.displayMetrics
        val dp = dm.density
        val pad = (dp * 14).toInt()
        val container = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(pad, pad, pad, pad)
            background = GradientDrawable().apply {
                shape = GradientDrawable.RECTANGLE
                cornerRadius = dp * 14
                setColor(Color.parseColor("#EE000000"))
                setStroke(2, Color.parseColor("#FFFF0505"))
            }
        }
        val edit = EditText(this).apply {
            setTextColor(Color.WHITE)
            setHintTextColor(Color.parseColor("#888888"))
            hint = "tell daemon…"
            // Enter = send (chat-app default). Single line, no newlines —
            // voice commands are short, and users expect Enter to submit.
            // IME_ACTION_SEND tells the soft keyboard to render a ➤ send
            // key; we bind the editor-action listener below to submit.
            inputType = android.text.InputType.TYPE_CLASS_TEXT or
                android.text.InputType.TYPE_TEXT_FLAG_CAP_SENTENCES
            imeOptions = EditorInfo.IME_ACTION_SEND
            maxLines = 1
            setBackgroundColor(Color.TRANSPARENT)
            textSize = 16f
            gravity = Gravity.CENTER_VERTICAL or Gravity.START
        }
        val send = TextView(this).apply {
            text = "send"
            setTextColor(Color.WHITE)
            textSize = 14f
            gravity = Gravity.CENTER
            setPadding(pad, pad / 2, pad, pad / 2)
            background = GradientDrawable().apply {
                shape = GradientDrawable.RECTANGLE
                cornerRadius = dp * 20
                setColor(Color.parseColor("#FFFF0505"))
            }
            setOnClickListener {
                val t = edit.text?.toString()?.trim().orEmpty()
                if (t.isNotEmpty()) submitTypedCommand(t)
                hideTextInput()
            }
        }
        // Submit on the keyboard's send key (Enter → IME_ACTION_SEND).
        // Also catch hardware Enter as a fallback for phones paired with
        // a BT keyboard.
        edit.setOnEditorActionListener { _, actionId, event ->
            val isSend = actionId == EditorInfo.IME_ACTION_SEND
            val isEnter = event?.keyCode == android.view.KeyEvent.KEYCODE_ENTER &&
                event.action == android.view.KeyEvent.ACTION_DOWN
            if (isSend || isEnter) {
                val t = edit.text?.toString()?.trim().orEmpty()
                if (t.isNotEmpty()) submitTypedCommand(t)
                hideTextInput()
                true
            } else false
        }
        container.addView(edit, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT,
        ).also { it.bottomMargin = pad / 2 })
        container.addView(send, LinearLayout.LayoutParams(
            (dp * 90).toInt(), LinearLayout.LayoutParams.WRAP_CONTENT,
        ).also { it.gravity = Gravity.END })

        val params = WindowManager.LayoutParams(
            (dm.widthPixels * 0.86).toInt(),
            WindowManager.LayoutParams.WRAP_CONTENT,
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
                WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
            else
                @Suppress("DEPRECATION") WindowManager.LayoutParams.TYPE_PHONE,
            // FOCUSABLE (no FLAG_NOT_FOCUSABLE) so the EditText can
            // receive IME input. NOT_TOUCH_MODAL + WATCH_OUTSIDE_TOUCH
            // lets touches outside the card reach us so we can dismiss.
            WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN
                or WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL
                or WindowManager.LayoutParams.FLAG_WATCH_OUTSIDE_TOUCH,
            PixelFormat.TRANSLUCENT,
        ).apply {
            // Position near the TOP of the screen so the IME (rising
            // from the bottom) never covers the card. 96dp from top gives
            // room for the status bar + notch.
            gravity = Gravity.TOP or Gravity.CENTER_HORIZONTAL
            y = (dp * 96).toInt()
            softInputMode = WindowManager.LayoutParams.SOFT_INPUT_STATE_ALWAYS_VISIBLE or
                WindowManager.LayoutParams.SOFT_INPUT_ADJUST_NOTHING
        }
        // Catch outside taps at the window level and dismiss.
        container.setOnTouchListener { _, ev ->
            if (ev.action == MotionEvent.ACTION_OUTSIDE) {
                hideTextInput()
                true
            } else false
        }
        try {
            wm.addView(container, params)
            textInputView = container
            edit.requestFocus()
        } catch (e: Exception) {
            Log.e(TAG, "showTextInput: addView failed", e)
        }
    }

    private fun hideTextInput() {
        textInputView?.let { v -> try { wm.removeView(v) } catch (_: Exception) {} }
        textInputView = null
    }

    /** POST the typed text to /api/voice/command with source="hover-text".
     *  Fire-and-forget; server enqueues fast-path classifier then claude. */
    private fun submitTypedCommand(text: String) {
        Thread({
            try {
                val session = RelayHttpClient.getOrExchangeSessionToken(this@HoverMicService) ?: return@Thread
                val url = RelayHttpClient.relayHttpUrl(this@HoverMicService).trimEnd('/') + "/api/voice/command"
                val body = JSONObject().apply {
                    put("transcript", text)
                    put("source", "hover-text")
                    put("device_id", Build.MODEL ?: "phone")
                    com.daemon.app.accessibility.DaemonAccessibilityService
                        .foregroundPackage?.let { put("foreground_package", it) }
                }
                val req = Request.Builder()
                    .url(url)
                    .header("Cookie", "daemon_token=$session")
                    .post(body.toString().toRequestBody("application/json".toMediaType()))
                    .build()
                OkHttpClient().newCall(req).execute().use { r -> Log.d(TAG, "hover-text POST ${r.code}") }
            } catch (e: Exception) {
                Log.e(TAG, "submitTypedCommand failed", e)
            }
        }, "hover-text").start()
    }

    override fun onDestroy() {
        if (isRecording) stopRecordingAndDispatch()
        hideTextInput()
        overlay?.let { v -> try { wm.removeView(v) } catch (_: Exception) {} }
        overlay = null
        super.onDestroy()
    }
}
