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
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshots.SnapshotStateList
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.daemon.app.llm.LlmProvider
import dev.daemon.app.llm.ProviderRegistry
import dev.daemon.app.llm.Router
import dev.daemon.app.share.SharedPayload
import dev.daemon.app.vault.FileStore
import dev.daemon.app.vault.Vault
import dev.daemon.app.vault.VaultSession
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** Files this size or larger trigger an "are you sure?" confirm before ingest. */
private const val HUGE_THRESHOLD_BYTES = 200L * 1024 * 1024  // 200 MB

@Composable
fun ChatScreen(
    registry: ProviderRegistry,
    onSettings: () -> Unit,
    initialShare: SharedPayload? = null,
    modifier: Modifier = Modifier,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val messages = remember { mutableStateListOf<ChatMessage>() }
    var isThinking by remember { mutableStateOf(false) }
    var providerLabel by remember { mutableStateOf(registry.selected().displayName) }
    val vault = VaultSession.vault
    val fileStore = remember(vault) { vault?.let { FileStore(context, it) } }
    var pendingHuge by remember { mutableStateOf<SharedPayload.Files?>(null) }

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
        when (initialShare) {
            null -> { /* no-op */ }
            is SharedPayload.Text -> {
                val msg = ChatMessage(ChatMessage.Role.USER, initialShare.text)
                messages.add(msg)
                vault?.let {
                    withContext(Dispatchers.IO) { it.appendMessage(msg.role.dbName(), msg.text) }
                }
            }
            is SharedPayload.Files -> {
                val totalBytes = initialShare.items.sumOf { it.sizeBytes ?: 0L }
                if (totalBytes >= HUGE_THRESHOLD_BYTES) {
                    pendingHuge = initialShare
                } else {
                    ingestFiles(initialShare, fileStore, vault, messages, scope)
                }
            }
        }
    }

    pendingHuge?.let { p ->
        HugeFilesConfirmDialog(
            payload = p,
            onConfirm = {
                pendingHuge = null
                ingestFiles(p, fileStore, vault, messages, scope)
            },
            onDismiss = {
                pendingHuge = null
                val total = p.items.sumOf { it.sizeBytes ?: 0L }
                val msg = ChatMessage(
                    ChatMessage.Role.SYSTEM,
                    "skipped large share (${humanSizeOf(total)}) — not imported.",
                )
                messages.add(msg)
                vault?.let {
                    scope.launch(Dispatchers.IO) { it.appendMessage(msg.role.dbName(), msg.text) }
                }
            },
        )
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
                    val pinned = registry.selected().takeIf { it.id != "echo" && it.isAvailable() }
                    val available: List<LlmProvider> = registry.list().filter { it.isAvailable() }
                    val choice = if (pinned != null && pinned.id != "openrouter") {
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

/**
 * Stream every URI in [payload] into the encrypted vault, then render a
 * single chat-summary message and attach the imported files to it via
 * `message_files`. Vault locked → emit a "locked — couldn't store" note.
 */
private fun ingestFiles(
    payload: SharedPayload.Files,
    fileStore: FileStore?,
    vault: Vault?,
    messages: SnapshotStateList<ChatMessage>,
    scope: CoroutineScope,
) {
    if (fileStore == null || vault == null) {
        messages.add(
            ChatMessage(
                ChatMessage.Role.SYSTEM,
                "vault locked — couldn't store ${payload.items.size} file(s). " +
                    "unlock and re-share to ingest.",
            ),
        )
        return
    }

    scope.launch {
        val outcomes: List<IngestOutcome> = withContext(Dispatchers.IO) {
            payload.items.map { f ->
                try {
                    val result = fileStore.import(f.uri, f.name, f.mimeType)
                    IngestOutcome.Ok(result, f.name, f.mimeType)
                } catch (t: Throwable) {
                    IngestOutcome.Err(
                        name = f.name,
                        mime = f.mimeType,
                        message = t.message ?: t.javaClass.simpleName,
                    )
                }
            }
        }

        val lines = outcomes.joinToString("\n") { o ->
            when (o) {
                is IngestOutcome.Ok -> {
                    val nm = o.name ?: o.result.file.name ?: "unnamed"
                    val mt = o.mime ?: o.result.file.mime ?: "?"
                    val sz = humanSizeOf(o.result.file.sizeBytes)
                    val tag = if (o.result.deduplicated) "✓ already in vault" else "✓ in vault"
                    "📎 $nm  ·  $mt  ·  $sz  ·  $tag"
                }
                is IngestOutcome.Err -> {
                    val nm = o.name ?: "unnamed"
                    val mt = o.mime ?: "?"
                    "⚠ $nm  ·  $mt  ·  failed: ${o.message}"
                }
            }
        }
        val text = "shared with daemon\n$lines"
        val msg = ChatMessage(ChatMessage.Role.SYSTEM, text)
        messages.add(msg)

        withContext(Dispatchers.IO) {
            val row = vault.appendMessage(msg.role.dbName(), msg.text)
            outcomes.forEachIndexed { i, o ->
                if (o is IngestOutcome.Ok) {
                    vault.attachFileToMessage(row.id, o.result.file.id, i)
                }
            }
        }
    }
}

private sealed class IngestOutcome {
    data class Ok(
        val result: FileStore.ImportResult,
        val name: String?,
        val mime: String?,
    ) : IngestOutcome()
    data class Err(val name: String?, val mime: String?, val message: String) : IngestOutcome()
}

@Composable
private fun HugeFilesConfirmDialog(
    payload: SharedPayload.Files,
    onConfirm: () -> Unit,
    onDismiss: () -> Unit,
) {
    val total = payload.items.sumOf { it.sizeBytes ?: 0L }
    val count = payload.items.size
    val preview = payload.items.take(3).joinToString("\n") { f ->
        "  • ${f.name ?: "unnamed"} (${humanSizeOf(f.sizeBytes ?: 0L)})"
    }
    val more = if (count > 3) "\n  …and ${count - 3} more" else ""

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("import ${humanSizeOf(total)} into daemon?", color = Color.White) },
        text = {
            Text(
                "this share is big. daemon will encrypt and store every byte locally.\n\n" +
                    "$preview$more",
                color = Color.White.copy(alpha = 0.85f),
            )
        },
        confirmButton = {
            TextButton(onClick = onConfirm) {
                Text("import anyway", color = Color.White)
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text("cancel", color = Color.White.copy(alpha = 0.6f))
            }
        },
        containerColor = Color(0xFF111111),
    )
}

private fun humanSizeOf(b: Long): String = when {
    b < 1024 -> "$b B"
    b < 1024L * 1024 -> "${b / 1024} KB"
    b < 1024L * 1024 * 1024 -> "${b / (1024 * 1024)} MB"
    else -> {
        val gb = b.toDouble() / (1024.0 * 1024.0 * 1024.0)
        String.format("%.1f GB", gb)
    }
}

private fun ChatMessage.Role.dbName(): String = when (this) {
    ChatMessage.Role.USER -> "user"
    ChatMessage.Role.ASSISTANT -> "assistant"
    ChatMessage.Role.SYSTEM -> "system"
}
