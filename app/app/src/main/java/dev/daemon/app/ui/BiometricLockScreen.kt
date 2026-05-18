package dev.daemon.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Fingerprint
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * The cold-launch screen. Auto-triggers biometric (via [onUnlock] firing the
 * activity's BiometricPrompt) on first composition. If the user cancels,
 * shows a "Tap to unlock" button to retry.
 */
@Composable
fun BiometricLockScreen(
    error: String?,
    onUnlock: () -> Unit,
    modifier: Modifier = Modifier,
) {
    LaunchedEffect(Unit) { onUnlock() }

    Box(
        modifier = modifier
            .fillMaxSize()
            .background(Color.Black),
        contentAlignment = Alignment.Center,
    ) {
        Column(
            modifier = Modifier.fillMaxWidth().padding(32.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
        ) {
            Box(
                modifier = Modifier
                    .size(120.dp)
                    .background(Color.White.copy(alpha = 0.06f), CircleShape),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    imageVector = Icons.Filled.Fingerprint,
                    contentDescription = "Unlock daemon",
                    tint = Color.White.copy(alpha = 0.8f),
                    modifier = Modifier.size(72.dp),
                )
            }
            Text(
                text = "daemon",
                color = Color.White,
                fontSize = 20.sp,
                modifier = Modifier.padding(top = 24.dp),
            )
            Text(
                text = "unlock with your fingerprint",
                color = Color.White.copy(alpha = 0.5f),
                fontSize = 13.sp,
                modifier = Modifier.padding(top = 4.dp),
            )
            if (error != null) {
                Text(
                    text = error,
                    color = Color(0xFFFF6B6B),
                    fontSize = 12.sp,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.padding(top = 16.dp),
                )
            }
            TextButton(
                onClick = onUnlock,
                modifier = Modifier.padding(top = 20.dp),
            ) {
                Text(
                    text = "tap to unlock",
                    color = Color.White.copy(alpha = 0.7f),
                    fontSize = 13.sp,
                )
            }
        }
    }
}
