package dev.daemon.app.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import dev.daemon.app.llm.ProviderRegistry
import dev.daemon.app.share.SharedPayload

/**
 * In-memory chat message. The vault stores role + text only; cost metadata
 * is recomputed at call-time and survives only the current process. (v0.2:
 * add a metering table in the vault so monthly totals survive restart.)
 */
data class ChatMessage(
    val role: Role,
    val text: String,
    val meter: CostMeter? = null,
) {
    enum class Role { USER, ASSISTANT, SYSTEM }
}

/** What we surface under each assistant bubble. Null for user/system. */
data class CostMeter(
    val modelLabel: String,
    val inputTokens: Int,
    val outputTokens: Int,
    val costUsd: Double,
    val trainsOnData: String?, // "no" | "opt_out" | "yes" | "unknown" | null
    val routedReason: String? = null, // "code → claude-sonnet-4.6" etc. — null when user pinned a provider
    val via: String = "", // "on-device" | "daemon relay" | "your openrouter key" | …
)

private enum class Screen { Chat, Settings, EgressAudit }

@Composable
fun DaemonApp(initialShare: SharedPayload? = null) {
    val context = LocalContext.current
    val registry = remember { ProviderRegistry(context.applicationContext) }
    var screen by remember { mutableStateOf(Screen.Chat) }

    when (screen) {
        Screen.Chat -> ChatScreen(
            registry = registry,
            initialShare = initialShare,
            onSettings = { screen = Screen.Settings },
        )
        Screen.Settings -> SettingsScreen(
            registry = registry,
            onClose = { screen = Screen.Chat },
            onOpenEgressAudit = { screen = Screen.EgressAudit },
        )
        Screen.EgressAudit -> EgressAuditScreen(
            onClose = { screen = Screen.Settings },
        )
    }
}
