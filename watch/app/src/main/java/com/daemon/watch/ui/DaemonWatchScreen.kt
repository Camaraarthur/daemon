package com.daemon.watch.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.wear.compose.material.*
import com.daemon.watch.DeviceInfo
import com.daemon.watch.ui.theme.*

@Composable
fun DaemonWatchScreen(
    isRecording: Boolean,
    isProcessing: Boolean,
    responseText: String,
    devices: List<DeviceInfo>,
    onMicTap: () -> Unit,
) {
    Scaffold(
        timeText = { TimeText() },
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .background(DarkBg)
                .padding(8.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
        ) {
            // Device status dots at top
            if (devices.isNotEmpty()) {
                DeviceStatusRow(devices)
                Spacer(Modifier.height(6.dp))
            }

            // Mic button — large, center
            Box(
                modifier = Modifier
                    .size(64.dp)
                    .clip(CircleShape)
                    .background(
                        if (isRecording) DaemonRed
                        else Color(0xFF1a1a1a)
                    )
                    .clickable { onMicTap() },
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    text = if (isRecording) "\u25CF" else "\uD83C\uDF99",
                    fontSize = if (isRecording) 28.sp else 24.sp,
                    color = if (isRecording) Color.White else DaemonRed,
                )
            }

            Spacer(Modifier.height(8.dp))

            // Status / Response area
            when {
                isRecording -> {
                    Text(
                        "listening...",
                        color = DaemonRed,
                        fontSize = 14.sp,
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
                        modifier = Modifier.size(20.dp),
                        indicatorColor = DaemonRed,
                        strokeWidth = 2.dp,
                    )
                }
                responseText.isNotEmpty() -> {
                    Text(
                        text = responseText,
                        color = Color.White,
                        fontSize = 12.sp,
                        lineHeight = 16.sp,
                        textAlign = TextAlign.Center,
                        modifier = Modifier
                            .fillMaxWidth()
                            .weight(1f)
                            .verticalScroll(rememberScrollState()),
                    )
                }
                else -> {
                    Text(
                        "tap mic or hold button",
                        color = TextDim,
                        fontSize = 12.sp,
                        textAlign = TextAlign.Center,
                    )
                }
            }
        }
    }
}

@Composable
fun DeviceStatusRow(devices: List<DeviceInfo>) {
    Row(
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        devices.take(4).forEach { device ->
            Box(
                modifier = Modifier
                    .size(8.dp)
                    .clip(CircleShape)
                    .background(
                        if (device.connected) OnlineGreen else OfflineGrey
                    )
            )
        }
    }
}
