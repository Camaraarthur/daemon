package com.daemon.app.accessibility

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.graphics.Path
import android.os.Bundle
import android.util.Log
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/**
 * Daemon's eyes, hands, and voice on the phone.
 *
 * An Android AccessibilityService can dispatch touch gestures (tap,
 * swipe), set text into any focused input, press system buttons
 * (home/back/recents), and read the on-screen view hierarchy with
 * text + bounds. It's the legal, no-ADB, no-root path for phone
 * automation that apps like Tasker, Bixby Routines, and Google
 * Assistant use.
 *
 * The user has to grant it ONCE in:
 *   Settings → Accessibility → Downloaded apps → Daemon → Allow
 *
 * After that, nothing else is needed for daemon to drive the phone.
 *
 * Command surface (called from WsDispatcher via the companion static
 * accessor):
 *   tap_at(x, y)                      → click at coordinates
 *   swipe(x1, y1, x2, y2, duration_ms)→ gesture swipe
 *   type_text(text)                   → set text in the focused input
 *   global_action(action)             → home | back | recents | notifications | quick_settings | lock
 *   find_and_tap(text)                → search visible tree for text, tap its center
 *   dump_screen()                     → JSON of the visible hierarchy (text, bounds, class)
 *   take_screenshot()                 → Base64 PNG (Android 11+)
 */
class DaemonAccessibilityService : AccessibilityService() {

    override fun onServiceConnected() {
        super.onServiceConnected()
        instance = this
        Log.d(TAG, "Connected — daemon accessibility online")
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        // Track the foreground app. The pendant voice/command flow asks
        // "change the button" without naming a target — we inject the
        // foregrounded daemon-app's package name so claude can find the
        // right sources in ~/daemon/apps/<pkg>/ without guessing.
        if (event?.eventType == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) {
            val pkg = event.packageName?.toString()
            if (!pkg.isNullOrBlank()) foregroundPackage = pkg
        }
    }

    override fun onInterrupt() {}

    override fun onDestroy() {
        if (instance === this) instance = null
        super.onDestroy()
    }

    companion object {
        private const val TAG = "DaemonA11y"

        @Volatile
        private var instance: DaemonAccessibilityService? = null

        /** Last foregrounded package per onAccessibilityEvent. Null until
         *  the first window-state change after the service starts. */
        @Volatile
        var foregroundPackage: String? = null
            private set

        fun isRunning(): Boolean = instance != null

        /** Tap at absolute screen coords. Returns true on dispatch accepted. */
        fun tapAt(x: Int, y: Int, durationMs: Long = 80): JSONObject {
            val svc = instance ?: return err("accessibility service not enabled — user must enable in Settings → Accessibility → Daemon")
            val path = Path().apply { moveTo(x.toFloat(), y.toFloat()) }
            val stroke = GestureDescription.StrokeDescription(path, 0, durationMs)
            val gesture = GestureDescription.Builder().addStroke(stroke).build()
            return dispatchBlocking(svc, gesture)
        }

        fun swipe(x1: Int, y1: Int, x2: Int, y2: Int, durationMs: Long = 300): JSONObject {
            val svc = instance ?: return err("accessibility service not enabled")
            val path = Path().apply {
                moveTo(x1.toFloat(), y1.toFloat())
                lineTo(x2.toFloat(), y2.toFloat())
            }
            val stroke = GestureDescription.StrokeDescription(path, 0, durationMs)
            val gesture = GestureDescription.Builder().addStroke(stroke).build()
            return dispatchBlocking(svc, gesture)
        }

        fun typeText(text: String): JSONObject {
            val svc = instance ?: return err("accessibility service not enabled")
            val root = svc.rootInActiveWindow ?: return err("no active window")
            val focused = root.findFocus(AccessibilityNodeInfo.FOCUS_INPUT)
                ?: return err("no focused input field — tap a text field first")
            val bundle = Bundle().apply { putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, text) }
            val ok = focused.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, bundle)
            return JSONObject().apply { put("ok", ok); put("text_length", text.length) }
        }

        fun globalAction(action: String): JSONObject {
            val svc = instance ?: return err("accessibility service not enabled")
            val code = when (action.lowercase()) {
                "back" -> GLOBAL_ACTION_BACK
                "home" -> GLOBAL_ACTION_HOME
                "recents" -> GLOBAL_ACTION_RECENTS
                "notifications" -> GLOBAL_ACTION_NOTIFICATIONS
                "quick_settings" -> GLOBAL_ACTION_QUICK_SETTINGS
                "lock" -> GLOBAL_ACTION_LOCK_SCREEN
                "power" -> GLOBAL_ACTION_POWER_DIALOG
                else -> return err("unknown action: $action (valid: back, home, recents, notifications, quick_settings, lock, power)")
            }
            val ok = svc.performGlobalAction(code)
            return JSONObject().apply { put("ok", ok); put("action", action) }
        }

        fun findAndTap(text: String): JSONObject {
            val svc = instance ?: return err("accessibility service not enabled")
            val root = svc.rootInActiveWindow ?: return err("no active window")
            val hits = findNodesByText(root, text)
            if (hits.isEmpty()) return err("no visible element with text matching '$text'")
            val target = hits.first()
            // Prefer ACTION_CLICK on the node itself (fires the real semantic
            // action), fall back to geometric tap if the node doesn't accept click.
            val clicked = target.performAction(AccessibilityNodeInfo.ACTION_CLICK)
            if (clicked) return JSONObject().apply { put("ok", true); put("strategy", "action_click") }
            val bounds = android.graphics.Rect().also { target.getBoundsInScreen(it) }
            return tapAt(bounds.centerX(), bounds.centerY()).put("strategy", "geom_tap")
        }

        /** Return a JSON array describing every visible node with text or
         *  content description, plus bounds + class name. Lets the agent
         *  "see" the screen in a structured way. */
        fun dumpScreen(): JSONObject {
            val svc = instance ?: return err("accessibility service not enabled")
            val root = svc.rootInActiveWindow ?: return err("no active window")
            val arr = JSONArray()
            walk(root) { node ->
                val text = node.text?.toString()
                val desc = node.contentDescription?.toString()
                if (text.isNullOrBlank() && desc.isNullOrBlank()) return@walk
                val bounds = android.graphics.Rect().also { node.getBoundsInScreen(it) }
                arr.put(JSONObject().apply {
                    if (!text.isNullOrBlank()) put("text", text)
                    if (!desc.isNullOrBlank()) put("desc", desc)
                    put("class", node.className?.toString() ?: "")
                    put("clickable", node.isClickable)
                    put("editable", node.isEditable)
                    put("bounds", JSONArray().apply {
                        put(bounds.left); put(bounds.top); put(bounds.right); put(bounds.bottom)
                    })
                })
            }
            val pkg = root.packageName?.toString() ?: ""
            return JSONObject().apply {
                put("ok", true)
                put("package", pkg)
                put("nodes", arr)
                put("count", arr.length())
            }
        }

        // ── internals ────────────────────────────────────────────

        private fun err(msg: String) = JSONObject().apply { put("ok", false); put("error", msg) }

        private fun dispatchBlocking(svc: DaemonAccessibilityService, gesture: GestureDescription): JSONObject {
            val latch = CountDownLatch(1)
            var completed = false
            var cancelled = false
            val callback = object : GestureResultCallback() {
                override fun onCompleted(g: GestureDescription?) { completed = true; latch.countDown() }
                override fun onCancelled(g: GestureDescription?) { cancelled = true; latch.countDown() }
            }
            val accepted = svc.dispatchGesture(gesture, callback, null)
            if (!accepted) return err("gesture not accepted by dispatcher")
            latch.await(2, TimeUnit.SECONDS)
            return JSONObject().apply {
                put("ok", completed)
                put("completed", completed)
                put("cancelled", cancelled)
            }
        }

        private fun findNodesByText(root: AccessibilityNodeInfo, text: String): List<AccessibilityNodeInfo> {
            val out = mutableListOf<AccessibilityNodeInfo>()
            // Case-insensitive contains match on text or contentDescription.
            val q = text.lowercase()
            walk(root) { node ->
                val t = node.text?.toString()?.lowercase()
                val d = node.contentDescription?.toString()?.lowercase()
                if ((t != null && t.contains(q)) || (d != null && d.contains(q))) {
                    out.add(node)
                }
            }
            return out
        }

        private fun walk(node: AccessibilityNodeInfo, visit: (AccessibilityNodeInfo) -> Unit) {
            visit(node)
            for (i in 0 until node.childCount) {
                val child = node.getChild(i) ?: continue
                walk(child, visit)
            }
        }
    }
}

// Allow importing the callback type without the accessibility service prefix
private typealias GestureResultCallback = android.accessibilityservice.AccessibilityService.GestureResultCallback
