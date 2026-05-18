package dev.daemon.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.wrapContentWidth
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

@Composable
fun ChatShell(
    messages: List<ChatMessage>,
    isThinking: Boolean,
    onSend: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    var draft by remember { mutableStateOf("") }
    val listState = rememberLazyListState()

    LaunchedEffect(messages.size) {
        if (messages.isNotEmpty()) {
            listState.animateScrollToItem(messages.size - 1)
        }
    }

    Column(modifier = modifier.fillMaxSize().background(Color.Black)) {
        LazyColumn(
            state = listState,
            modifier = Modifier.fillMaxWidth().weight(1f),
            contentPadding = PaddingValues(vertical = 4.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            items(messages) { msg -> MessageRow(msg) }
            if (isThinking) {
                item {
                    Text(
                        text = "thinking…",
                        color = Color.White.copy(alpha = 0.5f),
                        fontSize = 13.sp,
                        modifier = Modifier.fillMaxWidth().padding(horizontal = 8.dp),
                    )
                }
            }
        }

        Row(
            modifier = Modifier.fillMaxWidth().padding(top = 6.dp, bottom = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            OutlinedTextField(
                value = draft,
                onValueChange = { draft = it },
                modifier = Modifier.weight(1f),
                placeholder = {
                    Text("ask daemon…", color = Color.White.copy(alpha = 0.4f))
                },
                singleLine = false,
                maxLines = 4,
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Send),
                shape = RoundedCornerShape(20.dp),
                colors = OutlinedTextFieldDefaults.colors(
                    focusedTextColor = Color.White,
                    unfocusedTextColor = Color.White,
                    cursorColor = Color.White,
                    focusedBorderColor = Color.White.copy(alpha = 0.5f),
                    unfocusedBorderColor = Color.White.copy(alpha = 0.25f),
                    focusedContainerColor = Color.Black,
                    unfocusedContainerColor = Color.Black,
                ),
            )
            IconButton(
                onClick = {
                    val text = draft
                    if (text.isNotBlank() && !isThinking) {
                        draft = ""
                        onSend(text)
                    }
                },
                modifier = Modifier.size(48.dp).padding(start = 6.dp),
                enabled = !isThinking && draft.isNotBlank(),
            ) {
                Icon(
                    imageVector = Icons.AutoMirrored.Filled.Send,
                    contentDescription = "Send",
                    tint = if (isThinking || draft.isBlank())
                        Color.White.copy(alpha = 0.3f)
                    else Color.White,
                )
            }
        }
    }
}

@Composable
private fun MessageRow(msg: ChatMessage) {
    val isUser = msg.role == ChatMessage.Role.USER
    Column(
        modifier = Modifier.fillMaxWidth().padding(horizontal = 4.dp),
        horizontalAlignment = if (isUser) Alignment.End else Alignment.Start,
    ) {
        Box(
            modifier = Modifier
                .widthIn(max = 320.dp)
                .wrapContentWidth()
                .background(
                    color = if (isUser) Color.White.copy(alpha = 0.10f)
                    else Color.White.copy(alpha = 0.04f),
                    shape = RoundedCornerShape(14.dp),
                )
                .padding(horizontal = 12.dp, vertical = 8.dp),
        ) {
            Text(
                text = msg.text,
                color = Color.White,
                fontSize = 14.sp,
                textAlign = TextAlign.Start,
            )
        }
        msg.meter?.let { CostMeterLine(it) }
    }
}

@Composable
private fun CostMeterLine(meter: CostMeter) {
    val tint = Color.White.copy(alpha = 0.45f)
    val badge = when (meter.trainsOnData) {
        "no" -> "🟢 no training"
        "opt_out" -> "🟡 opt-out"
        "yes" -> "🔴 trains on data"
        null -> ""
        else -> "⚪ unverified"
    }
    val priceText = if (meter.costUsd > 0) "$${"%.4f".format(meter.costUsd)}" else "$0"
    val viaText = meter.via.takeIf { it.isNotBlank() }
    Column(
        modifier = Modifier.padding(top = 2.dp, start = 6.dp, end = 6.dp, bottom = 2.dp),
    ) {
        meter.routedReason?.let {
            Text(text = "✦ $it", color = tint, fontSize = 10.sp)
        }
        Text(
            text = listOf(
                meter.modelLabel,
                viaText?.let { "via $it" },
                priceText,
                "${meter.inputTokens} in / ${meter.outputTokens} out",
                badge,
            ).filterNotNull().filter { it.isNotBlank() }.joinToString("  ·  "),
            color = tint,
            fontSize = 10.sp,
        )
    }
}
