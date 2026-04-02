package com.daemon.app.ui.chat

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import kotlinx.coroutines.launch
import java.util.Locale

data class ChatMessage(
    val id: String,
    val role: String,
    val content: String,
    val timestamp: Long = System.currentTimeMillis(),
)

val DarkBg = Color(0xFF111111)
val DarkSurface = Color(0xFF1A1A1A)
val DaemonRed = Color(0xFFFF0505)
val TextGrey = Color(0xFFBFBFBF)
val TextDark = Color(0xFF555555)

@Composable
fun ChatScreen(
    daemonName: String = "My",
    onSendMessage: suspend (String) -> String,
    modifier: Modifier = Modifier,
) {
    var messages by remember { mutableStateOf(listOf<ChatMessage>()) }
    var inputText by remember { mutableStateOf("") }
    var isLoading by remember { mutableStateOf(false) }
    var statusText by remember { mutableStateOf("") }
    val listState = rememberLazyListState()
    val scope = rememberCoroutineScope()
    val keyboardController = LocalSoftwareKeyboardController.current

    fun send() {
        val text = inputText.trim()
        if (text.isEmpty() || isLoading) return
        inputText = ""
        keyboardController?.hide()
        val userMsg = ChatMessage(
            id = System.currentTimeMillis().toString(),
            role = "user",
            content = text,
        )
        messages = messages + userMsg
        isLoading = true
        statusText = "thinking..."
        scope.launch {
            // Animate status text while waiting
            launch {
                val steps = listOf("thinking...", "reasoning...", "checking devices...", "processing...", "composing response...")
                var i = 0
                while (isLoading) {
                    statusText = steps[i % steps.size]
                    i++
                    kotlinx.coroutines.delay(3000)
                }
            }
            try {
                val response = onSendMessage(text)
                messages = messages + ChatMessage(
                    id = (System.currentTimeMillis() + 1).toString(),
                    role = "daemon",
                    content = response,
                )
            } catch (e: Exception) {
                messages = messages + ChatMessage(
                    id = (System.currentTimeMillis() + 1).toString(),
                    role = "daemon",
                    content = "Error: ${e.message}",
                )
            }
            isLoading = false
            statusText = ""
            if (messages.isNotEmpty()) {
                listState.animateScrollToItem(messages.size - 1)
            }
        }
    }

    Column(
        modifier = modifier
            .fillMaxSize()
            .background(DarkBg)
            .statusBarsPadding()
            .navigationBarsPadding()
            .imePadding()
    ) {
        // Header
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(
                modifier = Modifier
                    .size(10.dp)
                    .clip(CircleShape)
                    .background(DaemonRed)
            )
            Spacer(Modifier.width(8.dp))
            Text(
                daemonName,
                color = Color.White,
                fontWeight = FontWeight.Medium,
                fontSize = 18.sp,
            )
            Spacer(Modifier.width(6.dp))
            Text(
                "daemon",
                color = TextDark,
                fontSize = 13.sp,
            )
        }

        // Messages
        LazyColumn(
            modifier = Modifier
                .weight(1f)
                .padding(horizontal = 16.dp),
            state = listState,
        ) {
            items(messages) { msg ->
                ChatBubble(msg)
                Spacer(Modifier.height(8.dp))
            }
            if (isLoading) {
                item {
                    Column(modifier = Modifier.padding(8.dp)) {
                        Row(
                            horizontalArrangement = Arrangement.spacedBy(4.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            repeat(3) {
                                Box(
                                    modifier = Modifier
                                        .size(6.dp)
                                        .clip(CircleShape)
                                        .background(DaemonRed.copy(alpha = 0.6f))
                                )
                            }
                            Spacer(Modifier.width(8.dp))
                            Text(
                                statusText,
                                color = TextDark,
                                fontSize = 12.sp,
                            )
                        }
                    }
                }
            }
        }

        // Input bar
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 12.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            OutlinedTextField(
                value = inputText,
                onValueChange = { inputText = it },
                modifier = Modifier.weight(1f),
                placeholder = { Text("Message $daemonName...", color = TextDark, fontSize = 14.sp) },
                colors = OutlinedTextFieldDefaults.colors(
                    focusedContainerColor = DarkSurface,
                    unfocusedContainerColor = DarkSurface,
                    focusedTextColor = Color.White,
                    unfocusedTextColor = Color.White,
                    focusedBorderColor = DaemonRed.copy(alpha = 0.3f),
                    unfocusedBorderColor = Color(0xFF222222),
                    cursorColor = DaemonRed,
                ),
                shape = RoundedCornerShape(24.dp),
                maxLines = 4,
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Send),
                keyboardActions = KeyboardActions(onSend = { send() }),
                textStyle = LocalTextStyle.current.copy(fontSize = 14.sp),
            )
            Spacer(Modifier.width(6.dp))
            // Mic button — uses Android SpeechRecognizer
            MicButton(onResult = { text -> inputText = (inputText + " " + text).trim() })
            Spacer(Modifier.width(6.dp))
            Button(
                onClick = { send() },
                modifier = Modifier.size(48.dp),
                shape = CircleShape,
                colors = ButtonDefaults.buttonColors(
                    containerColor = if (inputText.isNotBlank() && !isLoading) DaemonRed else DarkSurface,
                    disabledContainerColor = DarkSurface,
                ),
                contentPadding = PaddingValues(0.dp),
                enabled = inputText.isNotBlank() && !isLoading,
            ) {
                Text("↑", color = Color.White, fontSize = 20.sp)
            }
        }
    }
}

@Composable
fun MicButton(onResult: (String) -> Unit) {
    val context = LocalContext.current
    var listening by remember { mutableStateOf(false) }
    val recognizer = remember { SpeechRecognizer.createSpeechRecognizer(context) }

    DisposableEffect(Unit) {
        val listener = object : RecognitionListener {
            override fun onResults(results: Bundle?) {
                val text = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()
                if (!text.isNullOrBlank()) onResult(text)
                listening = false
            }
            override fun onError(error: Int) { listening = false }
            override fun onReadyForSpeech(params: Bundle?) {}
            override fun onBeginningOfSpeech() {}
            override fun onRmsChanged(rmsdB: Float) {}
            override fun onBufferReceived(buffer: ByteArray?) {}
            override fun onEndOfSpeech() {}
            override fun onPartialResults(partialResults: Bundle?) {
                // Ignore partials — only use final results to avoid repetition
            }
            override fun onEvent(eventType: Int, params: Bundle?) {}
        }
        recognizer.setRecognitionListener(listener)
        onDispose { recognizer.destroy() }
    }

    val hasMicPermission = ContextCompat.checkSelfPermission(
        context, Manifest.permission.RECORD_AUDIO
    ) == PackageManager.PERMISSION_GRANTED

    Button(
        onClick = {
            if (!hasMicPermission) return@Button
            if (listening) {
                recognizer.stopListening()
                listening = false
            } else {
                val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
                    putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                    putExtra(RecognizerIntent.EXTRA_LANGUAGE, Locale.getDefault())
                    putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
                    putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
                }
                recognizer.startListening(intent)
                listening = true
            }
        },
        modifier = Modifier.size(48.dp),
        shape = CircleShape,
        colors = ButtonDefaults.buttonColors(
            containerColor = if (listening) DaemonRed else DarkSurface,
        ),
        contentPadding = PaddingValues(0.dp),
    ) {
        Text(if (listening) "●" else "◉", color = if (listening) Color.White else Color(0xFF555555), fontSize = 18.sp)
    }
}

@Composable
fun ChatBubble(message: ChatMessage) {
    val isUser = message.role == "user"
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = if (isUser) Arrangement.End else Arrangement.Start,
    ) {
        Box(
            modifier = Modifier
                .widthIn(max = 300.dp)
                .clip(RoundedCornerShape(16.dp))
                .background(if (isUser) DaemonRed else DarkSurface)
                .padding(horizontal = 14.dp, vertical = 10.dp)
        ) {
            Text(
                message.content,
                color = Color.White,
                fontSize = 14.sp,
                lineHeight = 20.sp,
            )
        }
    }
}
