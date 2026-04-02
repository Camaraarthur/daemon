package com.daemon.app

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import com.daemon.app.service.DaemonService
import com.daemon.app.ui.chat.ChatScreen
import com.daemon.app.ui.chat.DarkBg
import com.daemon.app.ui.chat.DaemonRed
import com.daemon.app.ui.chat.DarkSurface
import android.net.Uri
import android.util.Base64
import android.webkit.MimeTypeMap
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

class MainActivity : ComponentActivity() {

    private val permissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { _ -> startDaemonService() }

    private fun requestBatteryOptimizationExemption() {
        val pm = getSystemService(android.content.Context.POWER_SERVICE) as android.os.PowerManager
        if (!pm.isIgnoringBatteryOptimizations(packageName)) {
            val intent = android.content.Intent(android.provider.Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).apply {
                data = android.net.Uri.parse("package:$packageName")
            }
            try { startActivity(intent) } catch (_: Exception) {}
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()

        // Request battery optimization exemption so the service stays alive
        requestBatteryOptimizationExemption()

        // Handle share intent
        val sharedContent = handleShareIntent(intent)

        // Check for saved token
        val prefs = getSharedPreferences("daemon", MODE_PRIVATE)
        val savedToken = prefs.getString("token", null)

        setContent {
            var token by remember { mutableStateOf(savedToken) }
            var uploadStatus by remember { mutableStateOf(sharedContent?.let { "Sending to daemon..." } ?: "") }
            val coroutineScope = rememberCoroutineScope()

            // Auto-upload shared content
            LaunchedEffect(sharedContent) {
                if (sharedContent != null && token != null) {
                    coroutineScope.launch {
                        uploadStatus = uploadToDaemon(sharedContent, token!!)
                    }
                }
            }

            if (token == null) {
                LoginScreen(onLogin = { t ->
                    token = t
                    prefs.edit().putString("token", t).apply()
                })
            } else {
                ChatScreen(
                    daemonName = "My",
                    onSendMessage = { message -> sendToServer(message, token!!) },
                )
            }
        }

        requestPermissionsAndStart()
    }

    private fun requestPermissionsAndStart() {
        val needed = mutableListOf<String>()
        for (perm in listOf(Manifest.permission.RECORD_AUDIO, Manifest.permission.CAMERA, Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.POST_NOTIFICATIONS)) {
            if (ContextCompat.checkSelfPermission(this, perm) != PackageManager.PERMISSION_GRANTED) needed.add(perm)
        }
        if (needed.isNotEmpty()) permissionLauncher.launch(needed.toTypedArray())
        else startDaemonService()
    }

    private fun startDaemonService() {
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
            startForegroundService(Intent(this, DaemonService::class.java).apply {
                action = DaemonService.ACTION_START
                putExtra(DaemonService.EXTRA_SERVER_URL, "ws://100.124.245.114:4801/ws/device")
                putExtra(DaemonService.EXTRA_USER_ID, "arthur")
            })
        }
    }

    data class SharedContent(val type: String, val text: String? = null, val uri: Uri? = null, val filename: String? = null)

    private fun handleShareIntent(intent: Intent?): SharedContent? {
        if (intent?.action != Intent.ACTION_SEND && intent?.action != Intent.ACTION_SEND_MULTIPLE) return null

        // Text share (links, copied text, etc.)
        val sharedText = intent.getStringExtra(Intent.EXTRA_TEXT)
        if (sharedText != null) {
            return SharedContent(type = "text", text = sharedText)
        }

        // File share
        val uri = intent.getParcelableExtra<Uri>(Intent.EXTRA_STREAM)
        if (uri != null) {
            val filename = getFilenameFromUri(uri) ?: "shared_file"
            return SharedContent(type = "file", uri = uri, filename = filename)
        }

        return null
    }

    private fun getFilenameFromUri(uri: Uri): String? {
        contentResolver.query(uri, null, null, null, null)?.use { cursor ->
            if (cursor.moveToFirst()) {
                val idx = cursor.getColumnIndex(android.provider.OpenableColumns.DISPLAY_NAME)
                if (idx >= 0) return cursor.getString(idx)
            }
        }
        return uri.lastPathSegment
    }

    private suspend fun uploadToDaemon(content: SharedContent, token: String): String {
        return withContext(Dispatchers.IO) {
            try {
                if (content.type == "text") {
                    // Send text as a chat message
                    return@withContext "Shared: ${content.text?.take(100)}"
                }

                // File: read bytes, base64, upload to server
                val uri = content.uri ?: return@withContext "No file"
                val bytes = contentResolver.openInputStream(uri)?.readBytes() ?: return@withContext "Can't read file"
                val b64 = Base64.encodeToString(bytes, Base64.NO_WRAP)
                val filename = content.filename ?: "shared_file"

                // Upload to daemon server
                val url = URL("https://my.daemon.page/api/share")
                val conn = url.openConnection() as HttpURLConnection
                conn.requestMethod = "POST"
                conn.setRequestProperty("Content-Type", "application/json")
                conn.setRequestProperty("Cookie", "daemon_token=$token")
                conn.doOutput = true
                conn.connectTimeout = 30000
                conn.readTimeout = 60000

                val payload = JSONObject().apply {
                    put("filename", filename)
                    put("data", b64)
                    put("size", bytes.size)
                }
                conn.outputStream.write(payload.toString().toByteArray())
                conn.outputStream.flush()

                if (conn.responseCode == 200) {
                    val resp = JSONObject(conn.inputStream.bufferedReader().readText())
                    "Sent to daemon: $filename (${bytes.size / 1024}KB)"
                } else {
                    "Upload failed: HTTP ${conn.responseCode}"
                }
            } catch (e: Exception) {
                "Share error: ${e.message}"
            }
        }
    }

    private suspend fun sendToServer(message: String, token: String): String {
        return withContext(Dispatchers.IO) {
            try {
                val url = URL("https://daemon.call.partners/api/chat")
                val conn = url.openConnection() as HttpURLConnection
                conn.requestMethod = "POST"
                conn.setRequestProperty("Content-Type", "application/json")
                conn.setRequestProperty("Cookie", "daemon_token=$token")
                conn.doOutput = true
                conn.connectTimeout = 30000
                conn.readTimeout = 180000

                conn.outputStream.write(JSONObject().apply {
                    put("message", message)
                    put("threadId", "android-main")
                }.toString().toByteArray())
                conn.outputStream.flush()

                when (conn.responseCode) {
                    200 -> JSONObject(conn.inputStream.bufferedReader().readText()).optString("response", "No response")
                    401 -> {
                        // Token expired — clear and force re-login
                        getSharedPreferences("daemon", MODE_PRIVATE).edit().remove("token").apply()
                        "Session expired. Restart the app to login again."
                    }
                    else -> "Error: HTTP ${conn.responseCode}"
                }
            } catch (e: Exception) {
                "Connection error: ${e.message}"
            }
        }
    }
}

@Composable
fun LoginScreen(onLogin: (String) -> Unit) {
    var email by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var error by remember { mutableStateOf("") }
    var loading by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(DarkBg)
            .statusBarsPadding()
            .navigationBarsPadding()
            .padding(32.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text("daemon", color = DaemonRed, fontSize = 28.sp, fontWeight = FontWeight.Bold)
        Spacer(Modifier.height(4.dp))
        Text("login to your daemon", color = Color(0xFF555555), fontSize = 12.sp)
        Spacer(Modifier.height(32.dp))

        OutlinedTextField(
            value = email,
            onValueChange = { email = it },
            placeholder = { Text("email", color = Color(0xFF555555)) },
            modifier = Modifier.fillMaxWidth(),
            colors = OutlinedTextFieldDefaults.colors(
                focusedContainerColor = DarkSurface, unfocusedContainerColor = DarkSurface,
                focusedTextColor = Color.White, unfocusedTextColor = Color.White,
                focusedBorderColor = DaemonRed.copy(alpha = 0.3f), unfocusedBorderColor = Color(0xFF222222),
                cursorColor = DaemonRed,
            ),
            shape = RoundedCornerShape(16.dp),
            singleLine = true,
        )
        Spacer(Modifier.height(12.dp))

        OutlinedTextField(
            value = password,
            onValueChange = { password = it },
            placeholder = { Text("password", color = Color(0xFF555555)) },
            visualTransformation = PasswordVisualTransformation(),
            modifier = Modifier.fillMaxWidth(),
            colors = OutlinedTextFieldDefaults.colors(
                focusedContainerColor = DarkSurface, unfocusedContainerColor = DarkSurface,
                focusedTextColor = Color.White, unfocusedTextColor = Color.White,
                focusedBorderColor = DaemonRed.copy(alpha = 0.3f), unfocusedBorderColor = Color(0xFF222222),
                cursorColor = DaemonRed,
            ),
            shape = RoundedCornerShape(16.dp),
            singleLine = true,
        )

        if (error.isNotEmpty()) {
            Spacer(Modifier.height(8.dp))
            Text(error, color = DaemonRed, fontSize = 12.sp)
        }

        Spacer(Modifier.height(20.dp))

        Button(
            onClick = {
                loading = true; error = ""
                scope.launch {
                    try {
                        val token = withContext(Dispatchers.IO) {
                            val url = URL("https://daemon.call.partners/api/auth")
                            val conn = url.openConnection() as HttpURLConnection
                            conn.requestMethod = "POST"
                            conn.setRequestProperty("Content-Type", "application/json")
                            conn.doOutput = true
                            conn.connectTimeout = 10000
                            conn.readTimeout = 10000
                            conn.outputStream.write(JSONObject().apply {
                                put("action", "login")
                                put("email", email.trim())
                                put("password", password)
                            }.toString().toByteArray())
                            conn.outputStream.flush()
                            if (conn.responseCode == 200) {
                                JSONObject(conn.inputStream.bufferedReader().readText()).optString("token", "")
                            } else {
                                val err = conn.errorStream?.bufferedReader()?.readText() ?: ""
                                throw Exception(JSONObject(err).optString("error", "Login failed"))
                            }
                        }
                        if (token.isNotEmpty()) onLogin(token)
                        else error = "No token received"
                    } catch (e: Exception) {
                        error = e.message ?: "Login failed"
                    }
                    loading = false
                }
            },
            modifier = Modifier.fillMaxWidth().height(48.dp),
            colors = ButtonDefaults.buttonColors(containerColor = DaemonRed),
            shape = RoundedCornerShape(16.dp),
            enabled = !loading && email.isNotBlank() && password.isNotBlank(),
        ) {
            Text(if (loading) "logging in..." else "enter", color = Color.White)
        }
    }
}
