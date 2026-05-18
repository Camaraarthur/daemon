package dev.daemon.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.daemon.app.privacy.EgressLog
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * "What this app sends" screen. Renders [EgressLog] entries — the persistent
 * record of every HTTPS call made by daemon. In Local mode this list should
 * be **empty**. After BYOK use, you'll see only the provider's host.
 *
 * Trust verification UX: the user can see for themselves that daemon doesn't
 * phone home. No marketing claim, just the data.
 */
@Composable
fun EgressAuditScreen(
    onClose: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val context = LocalContext.current
    val log = remember { EgressLog(context.applicationContext) }
    var entries by remember { mutableStateOf<List<EgressLog.Entry>>(emptyList()) }
    var refreshTick by remember { mutableStateOf(0) }

    LaunchedEffect(refreshTick) { entries = log.list() }

    Column(
        modifier = modifier
            .fillMaxSize()
            .background(Color.Black)
            .systemBarsPadding(),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 8.dp, vertical = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconButton(onClick = onClose, modifier = Modifier.size(40.dp)) {
                Icon(
                    imageVector = Icons.AutoMirrored.Filled.ArrowBack,
                    contentDescription = "Back",
                    tint = Color.White.copy(alpha = 0.8f),
                )
            }
            Text(
                text = "what this app sends",
                color = Color.White,
                fontSize = 18.sp,
                modifier = Modifier.padding(start = 4.dp),
            )
            Column(modifier = Modifier.weight(1f)) {}
            if (entries.isNotEmpty()) {
                TextButton(onClick = { log.clear(); refreshTick++ }) {
                    Text(text = "clear", color = Color.White.copy(alpha = 0.6f), fontSize = 12.sp)
                }
            }
        }

        if (entries.isEmpty()) {
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(24.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Text(
                    text = "no outbound traffic recorded.",
                    color = Color.White.copy(alpha = 0.7f),
                    fontSize = 14.sp,
                )
                Text(
                    text = "Daemons-the-company is not in the network path of " +
                        "this app — by architecture, not policy.\n\n" +
                        "When you switch to a BYOK provider (Claude / Mistral / Gemini), " +
                        "this screen will show the host you've authorized — and only that host.",
                    color = Color.White.copy(alpha = 0.45f),
                    fontSize = 12.sp,
                    modifier = Modifier.padding(top = 20.dp),
                )
            }
        } else {
            // Group + count entries per host for the headline.
            val byHost = entries.groupBy { it.host }
            Text(
                text = byHost.entries.joinToString("  ·  ") { (h, l) -> "$h ${l.size}×" },
                color = Color.White.copy(alpha = 0.6f),
                fontSize = 11.sp,
                modifier = Modifier.padding(horizontal = 20.dp, vertical = 8.dp),
            )

            LazyColumn(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(horizontal = 12.dp),
            ) {
                items(entries) { e -> EntryRow(e) }
            }
        }
    }
}

@Composable
private fun EntryRow(e: EgressLog.Entry) {
    val fmt = remember { SimpleDateFormat("MMM d HH:mm:ss", Locale.getDefault()) }
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 6.dp)
            .background(
                color = Color.White.copy(alpha = 0.04f),
                shape = RoundedCornerShape(10.dp),
            )
            .clickable { /* future: details */ }
            .padding(12.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                text = e.host,
                color = Color.White,
                fontSize = 13.sp,
            )
            Column(modifier = Modifier.weight(1f)) {}
            Text(
                text = fmt.format(Date(e.tsEpochMs)),
                color = Color.White.copy(alpha = 0.4f),
                fontSize = 11.sp,
            )
        }
        Text(
            text = "${e.method} ${e.path}",
            color = Color.White.copy(alpha = 0.5f),
            fontSize = 11.sp,
        )
        Text(
            text = "${e.statusCode} · sent ${e.bytesSent}B · recv ${e.bytesReceived}B · " +
                "${e.piiRedactionsCount} PII tokens redacted",
            color = Color.White.copy(alpha = 0.4f),
            fontSize = 10.sp,
        )
    }
}
