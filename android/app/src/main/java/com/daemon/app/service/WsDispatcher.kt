package com.daemon.app.service

import android.content.Context
import android.util.Log
import org.json.JSONObject

/**
 * Phase 3 — pure routing layer that maps incoming /ws/device messages
 * to CommandExecutor handlers.
 *
 * The relay sends two flavors:
 *
 *   1. Legacy {type: <bespoke>}  — old direct command names
 *      (e.g. take_photo, get_battery, run_command). Kept for
 *      backward compat with the existing Android-only tools.
 *
 *   2. Canonical {type: "skill.invoke", name: <tool>, arguments: {...}}
 *      — the same shape cli/daemon.mjs handles. Maps tool names
 *      onto CommandExecutor functions. This is what the agent
 *      loop in agent-loop-streaming.ts dispatches.
 *
 * Tool name table (canonical → CommandExecutor):
 *   bash         → runCommand({command, timeout_ms, cwd?})
 *   read_file    → readFile({path})
 *   write_file   → writeFile({path, content})    [TODO v1.5]
 *   edit_file    → editFile({path, old, new})    [TODO v1.5]
 *   list_files   → listFiles({path})
 *   glob         → glob({pattern, path})         [TODO v1.5]
 *   grep         → grep({pattern, path})         [TODO v1.5]
 *   lint_file    → lintFile({path})              [TODO v1.5 — no linter on android stock]
 *   device_info  → getDeviceInfo()
 *
 * Android-only tools surfaced as additional skills:
 *   take_photo, get_location, read_sensors, read_sensor_data,
 *   get_battery, send_notification, bluetooth_scan, esp32_command,
 *   start_audio, stop_audio
 *
 * Memory / secrets / schedule / notify / host primitives are NOT
 * dispatched on the device — those live in the relay (memory
 * routes through device-memory.ts which talks back to this
 * service via memory.* messages — handled by a separate dispatch
 * branch in DaemonService).
 */
object WsDispatcher {

    private const val TAG = "WsDispatcher"

    /**
     * Returns null if the tool is unknown or there's no result to
     * send back (e.g. ack-only messages).
     */
    suspend fun handleSkillInvoke(
        ctx: Context,
        toolName: String,
        args: JSONObject,
    ): JSONObject {
        Log.d(TAG, "skill.invoke: $toolName(${args.toString().take(200)})")
        return when (toolName) {
            // ── Canonical 9 ─────────────────────────────────────
            "bash", "run_shell" -> {
                // The relay sends {command, timeout_ms?, cwd?}.
                // Map to the existing runCommand schema.
                val cmd = JSONObject().apply {
                    put("command", args.optString("command", ""))
                    if (args.has("timeout_ms")) put("timeout", args.optLong("timeout_ms"))
                    if (args.has("cwd")) put("cwd", args.optString("cwd"))
                }
                CommandExecutor.runCommand(cmd)
            }
            "read_file" -> CommandExecutor.readFile(args)
            "list_files", "list_directory" -> CommandExecutor.listFiles(args)
            "device_info" -> CommandExecutor.getDeviceInfo(ctx)
            "write_file" -> notImplemented(toolName, "v1.5 — Android needs SAF for arbitrary writes")
            "edit_file" -> notImplemented(toolName, "v1.5")
            "glob" -> notImplemented(toolName, "v1.5 — port the Linux glob to java.nio")
            "grep" -> notImplemented(toolName, "v1.5 — Android stock has no ripgrep")
            "lint_file" -> notImplemented(toolName, "v1.5")

            // ── Android-only extras ─────────────────────────────
            "take_photo" -> CommandExecutor.takePhoto(ctx, args)
            "get_location" -> CommandExecutor.getLocation(ctx)
            "read_sensors" -> CommandExecutor.readSensors(ctx)
            "read_sensor_data" -> CommandExecutor.readSensorData(ctx, args)
            "get_battery" -> CommandExecutor.getBatteryInfo(ctx)
            "send_notification" -> CommandExecutor.sendNotification(ctx, args)
            "receive_file" -> CommandExecutor.receiveFile(ctx, args)
            "start_audio" -> CommandExecutor.startAudioCapture(ctx)
            "stop_audio" -> CommandExecutor.stopAudioCapture()
            "bluetooth_scan" -> CommandExecutor.bluetoothScan(ctx)
            "esp32_command" -> CommandExecutor.esp32Command(args)
            "esp32_scan" -> CommandExecutor.esp32ScanAndCommand(args)
            "open_app" -> CommandExecutor.openApp(ctx, args)
            "send_whatsapp" -> CommandExecutor.sendWhatsApp(ctx, args)

            else -> JSONObject().apply {
                put("ok", false)
                put("error", "unknown tool: $toolName")
            }
        }
    }

    private fun notImplemented(name: String, reason: String): JSONObject =
        JSONObject().apply {
            put("ok", false)
            put("error", "not implemented on android: $name ($reason)")
        }

    /**
     * The list of tool names this device exposes via skill.list. The
     * relay caches this in its tool registry so the agent loop knows
     * what's available without having to probe.
     */
    fun toolList(): List<JSONObject> {
        val simple = listOf(
            "bash" to "Execute a shell command. Returns stdout, stderr, exit_code.",
            "read_file" to "Read the contents of a file under the user's storage.",
            "list_files" to "List files in a directory.",
            "device_info" to "Android device info: model, OS version, battery, network.",
            "take_photo" to "Capture a photo using the device camera.",
            "get_location" to "Current GPS location (requires permission).",
            "get_battery" to "Battery level + charging state.",
            "read_sensors" to "Read accelerometer / gyroscope / light sensors.",
            "send_notification" to "Show a system notification.",
            "bluetooth_scan" to "Scan for nearby Bluetooth LE devices.",
        )
        val simpleTools = simple.map { (name, desc) ->
            JSONObject().apply {
                put("name", name)
                put("description", desc)
                put("inputSchema", JSONObject().apply {
                    put("type", "object")
                    put("properties", JSONObject())
                })
            }
        }

        // Tools with explicit schemas
        val openAppTool = JSONObject().apply {
            put("name", "open_app")
            put("description", "Launch an installed Android app by its package name (e.g. com.android.chrome).")
            put("inputSchema", JSONObject().apply {
                put("type", "object")
                put("properties", JSONObject().apply {
                    put("package_name", JSONObject().apply {
                        put("type", "string")
                        put("description", "Android package name, e.g. com.android.chrome")
                    })
                })
                put("required", org.json.JSONArray().apply { put("package_name") })
            })
        }

        val sendWhatsAppTool = JSONObject().apply {
            put("name", "send_whatsapp")
            put("description", "Open WhatsApp with a prefilled message via wa.me deep link. User still has to tap send (autosend would require an accessibility service).")
            put("inputSchema", JSONObject().apply {
                put("type", "object")
                put("properties", JSONObject().apply {
                    put("phone", JSONObject().apply {
                        put("type", "string")
                        put("description", "Phone number in E.164 format without the leading + (e.g. 31612345678)")
                    })
                    put("message", JSONObject().apply {
                        put("type", "string")
                        put("description", "Message text to prefill into WhatsApp")
                    })
                })
                put("required", org.json.JSONArray().apply { put("phone"); put("message") })
            })
        }

        return simpleTools + listOf(openAppTool, sendWhatsAppTool)
    }
}
