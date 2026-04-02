package com.daemon.watch

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.wear.compose.material.*
import com.daemon.watch.network.DaemonApiClient
import com.daemon.watch.ui.theme.DaemonRed
import com.daemon.watch.ui.theme.DarkBg
import com.daemon.watch.ui.theme.TextDim
import kotlinx.coroutines.launch
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers

class LoginActivity : ComponentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Auto-login with default credentials
        autoLogin()
    }

    private fun autoLogin() {
        CoroutineScope(Dispatchers.IO).launch {
            try {
                val token = DaemonApiClient.login("my", "daemon")
                if (token != null) {
                    getSharedPreferences("daemon", MODE_PRIVATE)
                        .edit()
                        .putString("daemon_token", token)
                        .putString("daemon_name", "my")
                        .apply()
                    runOnUiThread {
                        startActivity(Intent(this@LoginActivity, MainActivity::class.java))
                        finish()
                    }
                }
            } catch (_: Exception) {}
        }

        setContent {
            var daemonName by remember { mutableStateOf("my") }
            var password by remember { mutableStateOf("") }
            var error by remember { mutableStateOf("") }
            var isLoading by remember { mutableStateOf(false) }
            val coroutineScope = rememberCoroutineScope()

            Scaffold(
                timeText = { TimeText() },
            ) {
                Column(
                    modifier = Modifier
                        .fillMaxSize()
                        .background(DarkBg)
                        .padding(horizontal = 16.dp, vertical = 8.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.Center,
                ) {
                    Text(
                        "daemon",
                        color = DaemonRed,
                        fontSize = 16.sp,
                    )

                    Spacer(Modifier.height(8.dp))

                    // Daemon name input
                    androidx.compose.foundation.text.BasicTextField(
                        value = daemonName,
                        onValueChange = { daemonName = it },
                        modifier = Modifier
                            .fillMaxWidth()
                            .background(Color(0xFF1a1a1a))
                            .padding(8.dp),
                        textStyle = androidx.compose.ui.text.TextStyle(
                            color = Color.White,
                            fontSize = 14.sp,
                        ),
                        singleLine = true,
                        decorationBox = { inner ->
                            if (daemonName.isEmpty()) {
                                Text("name", color = TextDim, fontSize = 14.sp)
                            }
                            inner()
                        }
                    )

                    Spacer(Modifier.height(6.dp))

                    // Password input
                    androidx.compose.foundation.text.BasicTextField(
                        value = password,
                        onValueChange = { password = it },
                        modifier = Modifier
                            .fillMaxWidth()
                            .background(Color(0xFF1a1a1a))
                            .padding(8.dp),
                        textStyle = androidx.compose.ui.text.TextStyle(
                            color = Color.White,
                            fontSize = 14.sp,
                        ),
                        singleLine = true,
                        visualTransformation = PasswordVisualTransformation(),
                        decorationBox = { inner ->
                            if (password.isEmpty()) {
                                Text("password", color = TextDim, fontSize = 14.sp)
                            }
                            inner()
                        }
                    )

                    Spacer(Modifier.height(8.dp))

                    if (error.isNotEmpty()) {
                        Text(
                            error,
                            color = DaemonRed,
                            fontSize = 11.sp,
                            textAlign = TextAlign.Center,
                        )
                        Spacer(Modifier.height(4.dp))
                    }

                    Button(
                        onClick = {
                            if (daemonName.isBlank() || password.isBlank()) {
                                error = "Enter name and password"
                                return@Button
                            }
                            isLoading = true
                            error = ""
                            coroutineScope.launch {
                                try {
                                    val token = DaemonApiClient.login(daemonName, password)
                                    if (token != null) {
                                        getSharedPreferences("daemon", MODE_PRIVATE)
                                            .edit()
                                            .putString("daemon_token", token)
                                            .putString("daemon_name", daemonName)
                                            .apply()
                                        startActivity(
                                            Intent(this@LoginActivity, MainActivity::class.java)
                                        )
                                        finish()
                                    } else {
                                        error = "Login failed"
                                    }
                                } catch (e: Exception) {
                                    error = e.message ?: "Error"
                                }
                                isLoading = false
                            }
                        },
                        enabled = !isLoading,
                        colors = ButtonDefaults.buttonColors(
                            backgroundColor = DaemonRed,
                        ),
                        modifier = Modifier.size(width = 100.dp, height = 36.dp),
                    ) {
                        if (isLoading) {
                            CircularProgressIndicator(
                                modifier = Modifier.size(16.dp),
                                indicatorColor = Color.White,
                                strokeWidth = 2.dp,
                            )
                        } else {
                            Text("connect", fontSize = 13.sp, color = Color.White)
                        }
                    }
                }
            }
        }
    }
}
