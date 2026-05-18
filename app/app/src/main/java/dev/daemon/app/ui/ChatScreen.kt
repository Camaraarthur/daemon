package dev.daemon.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.daemon.app.llm.LlmProvider
import dev.daemon.app.llm.ProviderRegistry
import dev.daemon.app.llm.Router
import dev.daemon.app.share.SharedPayload
import dev.daemon.app.share.humanSize
import dev.daemon.app.vault.VaultSession
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

@Composable
fun ChatScreen(
    registry: ProviderRegistry,
    onSettings: () -> Unit,
    initialShare: SharedPayload? = null,
    modifier: Modifier = Modifier,
) {
    val scope = rememberCoroutineScope()
    val messages = remember { mutableStateListOf<ChatMessage>() }
    var isThinking by remember { mutableStateOf(false) }
    var providerLabel by remember { mutableStateOf(registry.selected().displayName) }
    val vault = VaultSession.vault

    LaunchedEffect(Unit) { providerLabel = registry.selected().displayName }

    LaunchedEffect(vault) {
        if (vault != null && messages.isEmpty()) {
            val rows = withContext(Dispatchers.IO) { vault.listMessages() }
            messages.addAll(
                rows.map { r ->
                    ChatMessage(
                        role = when (r.role) {
                            "user" -> ChatMessage.Role.USER
                            "assistant" -> ChatMessage.Role.ASSISTANT
                            else -> ChatMessage.Role.SYSTEM
                        },
                        text = r.text,
                    )
                },
            )
        }
    }

    LaunchedEffect(initialShare) {
        if (initialShare != null) {
            val msg = when (initialShare) {
                is SharedPayload.Text ->
                    ChatMessage(ChatMessage.Role.USER, initialShare.text)
                is SharedPayload.Files -> {
                    val lines = initialShare.items.joinToString("\n") { f ->
                        val nm = f.name ?: "unnamed"
                        val mt = f.mimeType ?: "?"
                        "📎 ${nm}  ·  ${mt}  ·  ${f.humanSize()}"
                    }
                    ChatMessage(
                        ChatMessage.Role.SYSTEM,
                        "shared with daemon\n$lines\n\n(file-bytes import lands in v0.2 — " +
                            "for now this is the metadata reference only.)",
                    )
                }
            }
            messages.add(msg)
            vault?.let {
                withContext(Dispatchers.IO) { it.appendMessage(msg.role.dbName(), msg.text) }
            }
        }
    }

    Column(
        modifier = modifier
            .fillMaxSize()
            .background(Color.Black)
            .systemBarsPadding(),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 12.dp, vertical = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                text = providerLabel,
                color = Color.White.copy(alpha = 0.5f),
                fontSize = 12.sp,
                modifier = Modifier.padding(start = 4.dp),
            )
            Row(modifier = Modifier.fillMaxWidth().padding(end = 0.dp)) {
                Column(modifier = Modifier.weight(1f)) {}
                IconButton(
                    onClick = onSettings,
                    modifier = Modifier.size(40.dp),
                ) {
                    Icon(
                        imageVector = Icons.Filled.Settings,
                        contentDescription = "Settings",
                        tint = Color.White.copy(alpha = 0.6f),
                    )
                }
            }
        }

        ChatShell(
            messages = messages,
            isThinking = isThinking,
            onSend = { text ->
                if (text.isBlank() || isThinking) return@ChatShell
                val userMsg = ChatMessage(ChatMessage.Role.USER, text.trim())
                messages.add(userMsg)
                vault?.let {
                    scope.launch(Dispatchers.IO) { it.appendMessage("user", userMsg.text) }
                }
                isThinking = true
                scope.launch {
                    // Pick provider+model via the on-device router across all
                    // providers that report ready. If the user explicitly
                    // selected something non-Echo, treat that as a pin and skip
                    // routing — pins beat heuristics.
                    val pinned = registry.selected().takeIf { it.id != "echo" && it.isAvailable() }
                    val available: List<LlmProvider> = registry.list().filter { it.isAvailable() }
                    val choice = if (pinned != null && pinned.id != "openrouter") {
                        // Strong pin (Anthropic / Mistral / Gemini Nano): honour it.
                        Router.RoutingChoice(pinned, null, "pinned → ${pinned.id}")
                    } else {
                        Router.pick(text.trim(), available)
                    }

                    val replyMsg: ChatMessage = try {
                        if (choice == null) {
                            ChatMessage(
                                ChatMessage.Role.ASSISTANT,
                                "No provider available. Open Settings → pick Echo (debug) or " +
                                    "paste an Anthropic / Mistral / OpenRouter API key.",
                            )
                        } else {
                            val result = choice.provider.generate(text.trim(), choice.modelOverride)
                            ChatMessage(
                                role = ChatMessage.Role.ASSISTANT,
                                text = result.text,
                                meter = CostMeter(
                                    modelLabel = result.modelLabel,
                                    inputTokens = result.inputTokens,
                                    outputTokens = result.outputTokens,
                                    costUsd = result.costUsd,
                                    trainsOnData = result.trainsOnData,
                                    routedReason = choice.reason,
                                ),
                            )
                        }
                    } catch (t: Throwable) {
                        ChatMessage(
                            ChatMessage.Role.ASSISTANT,
                            "Error: ${t.message ?: t.javaClass.simpleName}",
                        )
                    }
                    messages.add(replyMsg)
                    vault?.let {
                        withContext(Dispatchers.IO) { it.appendMessage("assistant", replyMsg.text) }
                    }
                    isThinking = false
                }
            },
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 12.dp)
                .weight(1f),
        )
    }
}

private fun ChatMessage.Role.dbName(): String = when (this) {
    ChatMessage.Role.USER -> "user"
    ChatMessage.Role.ASSISTANT -> "assistant"
    ChatMessage.Role.SYSTEM -> "system"
}
