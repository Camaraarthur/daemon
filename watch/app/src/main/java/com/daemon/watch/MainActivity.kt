package com.daemon.watch

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.view.KeyEvent
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.core.content.ContextCompat
import com.daemon.watch.network.DaemonApiClient
import com.daemon.watch.service.WatchDaemonService
import com.daemon.watch.ui.DaemonWatchScreen
import kotlinx.coroutines.*

class MainActivity : ComponentActivity() {

    private lateinit var apiClient: DaemonApiClient
    private var speechRecognizer: SpeechRecognizer? = null
    private val scope = CoroutineScope(Dispatchers.Main + SupervisorJob())

    // Observable state for Compose
    private val _isRecording = mutableStateOf(false)
    private val _responseText = mutableStateOf("")
    private val _isProcessing = mutableStateOf(false)
    private val _devices = mutableStateListOf<DeviceInfo>()

    private val permissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted ->
        if (granted) {
            initSpeechRecognizer()
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Check auth
        val prefs = getSharedPreferences("daemon", MODE_PRIVATE)
        var token = prefs.getString("daemon_token", null)
        if (token.isNullOrBlank()) {
            // First launch — set hardcoded token for Arthur's account
            // TODO: replace with Wear Data Layer sync from phone app
            token = "d443f602369165440b99380e57bd69c577cd46bda016baabf17fd8e359764c9b"
            prefs.edit()
                .putString("daemon_token", token)
                .putString("daemon_name", "my")
                .apply()
        }

        apiClient = DaemonApiClient(token)

        // Request mic permission
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO)
            != PackageManager.PERMISSION_GRANTED
        ) {
            permissionLauncher.launch(Manifest.permission.RECORD_AUDIO)
        } else {
            initSpeechRecognizer()
        }

        // Start foreground service
        startForegroundService(Intent(this, WatchDaemonService::class.java))

        // Poll device health
        scope.launch {
            while (isActive) {
                try {
                    val devices = apiClient.getDeviceHealth()
                    _devices.clear()
                    _devices.addAll(devices)
                } catch (_: Exception) {}
                delay(60_000)
            }
        }

        setContent {
            DaemonWatchScreen(
                isRecording = _isRecording.value,
                isProcessing = _isProcessing.value,
                responseText = _responseText.value,
                devices = _devices,
                onMicTap = { toggleRecording() },
            )
        }
    }

    private fun initSpeechRecognizer() {
        if (!SpeechRecognizer.isRecognitionAvailable(this)) return
        speechRecognizer = SpeechRecognizer.createSpeechRecognizer(this).apply {
            setRecognitionListener(object : RecognitionListener {
                override fun onReadyForSpeech(params: Bundle?) {
                    _isRecording.value = true
                }
                override fun onBeginningOfSpeech() {}
                override fun onRmsChanged(rmsdB: Float) {}
                override fun onBufferReceived(buffer: ByteArray?) {}
                override fun onEndOfSpeech() {
                    _isRecording.value = false
                    _isProcessing.value = true
                }
                override fun onError(error: Int) {
                    _isRecording.value = false
                    _isProcessing.value = false
                    if (error != SpeechRecognizer.ERROR_NO_MATCH) {
                        _responseText.value = "Speech error ($error). Try again."
                    }
                }
                override fun onResults(results: Bundle?) {
                    val matches = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
                    val transcript = matches?.firstOrNull() ?: ""
                    if (transcript.isNotBlank()) {
                        sendToDaemon(transcript)
                    } else {
                        _isProcessing.value = false
                        _responseText.value = "No speech detected."
                    }
                }
                override fun onPartialResults(partialResults: Bundle?) {}
                override fun onEvent(eventType: Int, params: Bundle?) {}
            })
        }
    }

    private fun toggleRecording() {
        if (_isRecording.value) {
            speechRecognizer?.stopListening()
        } else {
            startListening()
        }
    }

    private fun startListening() {
        _responseText.value = ""
        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, false)
            putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
        }
        speechRecognizer?.startListening(intent)
    }

    private fun sendToDaemon(transcript: String) {
        scope.launch {
            try {
                val response = apiClient.sendText(transcript)
                _responseText.value = response
            } catch (e: Exception) {
                _responseText.value = "Error: ${e.message}"
            }
            _isProcessing.value = false
        }
    }

    // STEM_1 button: push-to-talk
    override fun onKeyDown(keyCode: Int, event: KeyEvent?): Boolean {
        if (keyCode == KeyEvent.KEYCODE_STEM_1 && event?.repeatCount == 0) {
            if (!_isRecording.value && !_isProcessing.value) {
                startListening()
            }
            return true
        }
        return super.onKeyDown(keyCode, event)
    }

    override fun onKeyUp(keyCode: Int, event: KeyEvent?): Boolean {
        if (keyCode == KeyEvent.KEYCODE_STEM_1) {
            if (_isRecording.value) {
                speechRecognizer?.stopListening()
            }
            return true
        }
        return super.onKeyUp(keyCode, event)
    }

    override fun onDestroy() {
        super.onDestroy()
        speechRecognizer?.destroy()
        scope.cancel()
    }
}
