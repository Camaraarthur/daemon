package dev.daemon.app.ui

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material.icons.filled.VisibilityOff
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.RadioButton
import androidx.compose.material3.RadioButtonDefaults
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
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
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import dev.daemon.app.ingest.IngestPrefs
import dev.daemon.app.llm.DEFAULT_OPENROUTER_MODEL
import dev.daemon.app.llm.GemmaProvider
import dev.daemon.app.llm.LlmProvider
import dev.daemon.app.llm.OPENROUTER_MODELS
import dev.daemon.app.llm.ProviderRegistry
import dev.daemon.app.llm.local.ModelDownloader
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.foundation.layout.Box
import androidx.compose.runtime.rememberCoroutineScope
import kotlinx.coroutines.launch
import kotlinx.coroutines.flow.collect

@Composable
fun SettingsScreen(
    registry: ProviderRegistry,
    onClose: () -> Unit,
    onOpenEgressAudit: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val providers: List<LlmProvider> = remember { registry.list() }
    var selectedId by remember { mutableStateOf(registry.selected().id) }
    var availabilityById by remember { mutableStateOf<Map<String, Boolean>>(emptyMap()) }
    var refreshTick by remember { mutableStateOf(0) }

    LaunchedEffect(refreshTick) {
        availabilityById = registry.list().associate { it.id to it.isAvailable() }
    }

    Column(
        modifier = modifier
            .fillMaxSize()
            .background(Color.Black)
            .systemBarsPadding()
            .verticalScroll(rememberScrollState()),
    ) {
        // Header.
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
                text = "settings",
                color = Color.White,
                fontSize = 18.sp,
                modifier = Modifier.padding(start = 4.dp),
            )
        }

        SectionLabel("model provider")
        providers.forEach { p ->
            val isOpenRouter = p.id == "openrouter"
            ProviderRow(
                provider = p,
                selected = selectedId == p.id,
                available = availabilityById[p.id] ?: false,
                hasKey = registry.keys.has(p.id),
                currentModel = if (isOpenRouter)
                    registry.getProviderModel("openrouter") ?: DEFAULT_OPENROUTER_MODEL
                else null,
                onModelChange = if (isOpenRouter) { newModel ->
                    registry.setProviderModel("openrouter", newModel)
                    refreshTick++
                } else null,
                onSelect = {
                    selectedId = p.id
                    registry.select(p.id)
                },
                onKeySaved = { newKey ->
                    if (newKey.isBlank()) registry.keys.clear(p.id)
                    else registry.keys.set(p.id, newKey)
                    registry.refresh()
                    refreshTick++
                },
            )
        }

        SectionLabel("local model")
        GemmaRow(registry = registry, onChanged = { refreshTick++ })

        SectionLabel("ingest")
        ScreenshotToggleRow()

        SectionLabel("verify")
        SettingsItem(
            label = "what this app sends",
            sublabel = "every host this app has talked to, with byte counts. " +
                "in Local mode this should be empty.",
            onClick = onOpenEgressAudit,
        )

        Text(
            text = "Daemons-the-company sees nothing. Local providers run entirely " +
                "on this phone — no bytes leave. BYOK providers go directly from " +
                "this phone to the provider you choose, with your own key. PII is " +
                "stripped before any outbound call (regex in v0.1, full Presidio " +
                "in v0.2).",
            color = Color.White.copy(alpha = 0.4f),
            fontSize = 11.sp,
            modifier = Modifier
                .padding(horizontal = 20.dp, vertical = 24.dp)
                .fillMaxWidth(),
        )
    }
}

@Composable
private fun SectionLabel(text: String) {
    Text(
        text = text,
        color = Color.White.copy(alpha = 0.5f),
        fontSize = 12.sp,
        modifier = Modifier.padding(start = 20.dp, top = 16.dp, bottom = 8.dp),
    )
}

@Composable
private fun SettingsItem(
    label: String,
    sublabel: String,
    onClick: () -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 12.dp, vertical = 4.dp)
            .background(Color.Transparent, shape = RoundedCornerShape(10.dp))
            .clickable { onClick() }
            .padding(horizontal = 16.dp, vertical = 12.dp),
    ) {
        Text(text = label, color = Color.White, fontSize = 14.sp)
        Text(
            text = sublabel,
            color = Color.White.copy(alpha = 0.45f),
            fontSize = 11.sp,
        )
    }
}

@Composable
private fun ProviderRow(
    provider: LlmProvider,
    selected: Boolean,
    available: Boolean,
    hasKey: Boolean,
    onSelect: () -> Unit,
    onKeySaved: (String) -> Unit,
    currentModel: String? = null,
    onModelChange: ((String) -> Unit)? = null,
) {
    var keyDraft by remember(provider.id) { mutableStateOf("") }
    var revealKey by remember { mutableStateOf(false) }
    var modelMenuOpen by remember { mutableStateOf(false) }
    val canSelect = available

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 12.dp, vertical = 4.dp)
            .background(
                color = if (selected) Color.White.copy(alpha = 0.06f) else Color.Transparent,
                shape = RoundedCornerShape(10.dp),
            )
            .padding(horizontal = 8.dp, vertical = 10.dp),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .clickable(enabled = canSelect) { onSelect() },
            verticalAlignment = Alignment.CenterVertically,
        ) {
            RadioButton(
                selected = selected,
                onClick = if (canSelect) onSelect else null,
                colors = RadioButtonDefaults.colors(
                    selectedColor = Color.White,
                    unselectedColor = Color.White.copy(alpha = 0.4f),
                    disabledSelectedColor = Color.White.copy(alpha = 0.3f),
                    disabledUnselectedColor = Color.White.copy(alpha = 0.2f),
                ),
                enabled = canSelect,
            )
            Column(modifier = Modifier.padding(start = 8.dp)) {
                Text(
                    text = provider.displayName,
                    color = if (canSelect) Color.White else Color.White.copy(alpha = 0.4f),
                    fontSize = 14.sp,
                )
                Text(
                    text = providerSub(provider, canSelect, hasKey),
                    color = Color.White.copy(alpha = 0.45f),
                    fontSize = 11.sp,
                )
            }
        }

        // BYOK API-key entry, inline below the row.
        if (provider.needsKey) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(top = 10.dp, start = 40.dp, end = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                OutlinedTextField(
                    value = keyDraft,
                    onValueChange = { keyDraft = it },
                    modifier = Modifier.weight(1f),
                    placeholder = {
                        Text(
                            text = if (hasKey) "key saved — paste a new one to replace"
                            else "paste ${provider.displayName.substringBefore(" (")} API key",
                            color = Color.White.copy(alpha = 0.4f),
                            fontSize = 12.sp,
                        )
                    },
                    singleLine = true,
                    visualTransformation = if (revealKey) VisualTransformation.None
                    else PasswordVisualTransformation(),
                    keyboardOptions = KeyboardOptions(
                        keyboardType = KeyboardType.Password,
                        imeAction = ImeAction.Done,
                    ),
                    shape = RoundedCornerShape(14.dp),
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
                    onClick = { revealKey = !revealKey },
                    modifier = Modifier.size(40.dp).padding(start = 4.dp),
                ) {
                    Icon(
                        imageVector = if (revealKey) Icons.Filled.VisibilityOff
                        else Icons.Filled.Visibility,
                        contentDescription = if (revealKey) "Hide key" else "Show key",
                        tint = Color.White.copy(alpha = 0.6f),
                    )
                }
                IconButton(
                    onClick = {
                        onKeySaved(keyDraft.trim())
                        keyDraft = ""
                    },
                    modifier = Modifier.size(40.dp),
                    enabled = keyDraft.isNotBlank(),
                ) {
                    Icon(
                        imageVector = Icons.Filled.Check,
                        contentDescription = "Save key",
                        tint = if (keyDraft.isNotBlank()) Color.White
                        else Color.White.copy(alpha = 0.3f),
                    )
                }
            }
            if (hasKey) {
                TextButton(
                    onClick = {
                        onKeySaved("") // empty = clear
                    },
                    modifier = Modifier.padding(start = 40.dp, top = 2.dp),
                ) {
                    Text(
                        text = "clear key",
                        color = Color.White.copy(alpha = 0.5f),
                        fontSize = 11.sp,
                    )
                }
            }
        }

        // OpenRouter-only: model picker dropdown.
        if (currentModel != null && onModelChange != null) {
            Box(modifier = Modifier.padding(start = 40.dp, top = 6.dp)) {
                TextButton(onClick = { modelMenuOpen = true }) {
                    Text(
                        text = "model: $currentModel ▾",
                        color = Color.White.copy(alpha = 0.7f),
                        fontSize = 11.sp,
                    )
                }
                DropdownMenu(
                    expanded = modelMenuOpen,
                    onDismissRequest = { modelMenuOpen = false },
                ) {
                    OPENROUTER_MODELS.forEach { opt ->
                        DropdownMenuItem(
                            text = {
                                Column {
                                    Text(opt.label, fontSize = 13.sp)
                                    Text(
                                        text = "${opt.id}  ·  ${opt.tier}",
                                        color = Color.White.copy(alpha = 0.45f),
                                        fontSize = 10.sp,
                                    )
                                }
                            },
                            onClick = {
                                onModelChange(opt.id)
                                modelMenuOpen = false
                            },
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun GemmaRow(registry: ProviderRegistry, onChanged: () -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val gemma = remember { registry.gemmaProvider() }
    var exists by remember { mutableStateOf(GemmaProvider.modelFile(context).exists()) }
    var downloading by remember { mutableStateOf(false) }
    var progress by remember { mutableStateOf(0L to 0L) } // bytes, total
    var errorMsg by remember { mutableStateOf<String?>(null) }

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 12.dp, vertical = 4.dp)
            .padding(horizontal = 16.dp, vertical = 10.dp),
    ) {
        Text(text = "Gemma 4 E2B", color = Color.White, fontSize = 14.sp)
        Text(
            text = "Google's mobile-optimized 2B model. " +
                "Runs entirely on this phone via MediaPipe — nothing leaves the device.",
            color = Color.White.copy(alpha = 0.45f),
            fontSize = 11.sp,
        )

        Row(
            modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            val sizeGb = GemmaProvider.MODEL_SIZE_BYTES / 1_000_000_000.0
            Column(modifier = Modifier.weight(1f)) {
                when {
                    exists -> Text(
                        text = "✓ ready · ${"%.2f".format(sizeGb)} GB on disk",
                        color = Color(0xFF22C55E),
                        fontSize = 12.sp,
                    )
                    downloading -> {
                        val pct = if (progress.second > 0)
                            (progress.first * 100 / progress.second).toInt()
                        else 0
                        val mb = progress.first / 1_000_000
                        val totalMb = progress.second / 1_000_000
                        Text(
                            text = "downloading · ${mb} MB / ${totalMb} MB · ${pct}%",
                            color = Color.White.copy(alpha = 0.75f),
                            fontSize = 12.sp,
                        )
                    }
                    else -> Text(
                        text = "not downloaded · ${"%.2f".format(sizeGb)} GB",
                        color = Color.White.copy(alpha = 0.5f),
                        fontSize = 12.sp,
                    )
                }
                errorMsg?.let {
                    Text(text = it, color = Color(0xFFFF6B6B), fontSize = 11.sp)
                }
            }
            if (!exists && !downloading) {
                Button(
                    onClick = {
                        errorMsg = null
                        downloading = true
                        scope.launch {
                            gemma.download().collect { p ->
                                when (p) {
                                    is ModelDownloader.Progress.Started ->
                                        progress = 0L to p.totalBytes
                                    is ModelDownloader.Progress.Downloading ->
                                        progress = p.bytesDownloaded to p.totalBytes
                                    is ModelDownloader.Progress.Completed -> {
                                        downloading = false
                                        exists = true
                                        registry.refresh()
                                        onChanged()
                                    }
                                    is ModelDownloader.Progress.Failed -> {
                                        downloading = false
                                        errorMsg = p.error.message ?: "download failed"
                                    }
                                }
                            }
                        }
                    },
                    colors = ButtonDefaults.buttonColors(
                        containerColor = Color.White,
                        contentColor = Color.Black,
                    ),
                ) {
                    Text("download", fontSize = 12.sp)
                }
            }
            if (exists) {
                TextButton(
                    onClick = {
                        if (gemma.deleteModel()) {
                            exists = false
                            registry.refresh()
                            onChanged()
                        }
                    },
                ) {
                    Text(
                        text = "delete",
                        color = Color.White.copy(alpha = 0.5f),
                        fontSize = 11.sp,
                    )
                }
            }
        }
    }
}

@Composable
private fun ScreenshotToggleRow() {
    val context = LocalContext.current
    val ingestPrefs = remember { IngestPrefs(context.applicationContext) }
    var enabled by remember { mutableStateOf(ingestPrefs.watchScreenshots) }
    val permission = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU)
        Manifest.permission.READ_MEDIA_IMAGES
    else
        Manifest.permission.READ_EXTERNAL_STORAGE

    val launcher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { granted ->
        if (granted) {
            ingestPrefs.watchScreenshots = true
            enabled = true
        } else {
            ingestPrefs.watchScreenshots = false
            enabled = false
        }
    }

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 12.dp, vertical = 4.dp)
            .background(Color.Transparent, shape = RoundedCornerShape(10.dp))
            .padding(horizontal = 16.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Text(text = "watch screenshots", color = Color.White, fontSize = 14.sp)
            Text(
                text = "OCR every new screenshot on-device and add it to chat context. " +
                    "ML Kit Text Recognition v2 · runs entirely on this phone · " +
                    "no network egress.",
                color = Color.White.copy(alpha = 0.45f),
                fontSize = 11.sp,
            )
        }
        Switch(
            checked = enabled,
            onCheckedChange = { wantOn ->
                if (wantOn) {
                    val alreadyGranted = ContextCompat.checkSelfPermission(
                        context, permission,
                    ) == PackageManager.PERMISSION_GRANTED
                    if (alreadyGranted) {
                        ingestPrefs.watchScreenshots = true
                        enabled = true
                    } else {
                        launcher.launch(permission)
                    }
                } else {
                    ingestPrefs.watchScreenshots = false
                    enabled = false
                }
            },
            colors = SwitchDefaults.colors(
                checkedThumbColor = Color.Black,
                checkedTrackColor = Color.White,
                uncheckedThumbColor = Color.White.copy(alpha = 0.6f),
                uncheckedTrackColor = Color.White.copy(alpha = 0.18f),
                uncheckedBorderColor = Color.White.copy(alpha = 0.18f),
            ),
        )
    }
}

private fun providerSub(p: LlmProvider, available: Boolean, hasKey: Boolean): String = when {
    p.needsKey && !hasKey -> "paste your ${p.displayName.substringBefore(" (")} API key below"
    p.needsKey && hasKey && available -> "key saved · direct HTTPS · Daemons not in path"
    !available && !p.needsKey -> "not available on this device yet (Pixel 8 Pro/9 / S24+)"
    p.isLocal -> "on-device · free · nothing leaves"
    else -> "BYOK · direct HTTPS · Daemons not in path"
}
