package com.daemon.app.service

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.Log

class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == Intent.ACTION_BOOT_COMPLETED ||
            intent.action == "android.intent.action.QUICKBOOT_POWERON") {
            Log.d("BootReceiver", "Boot completed, starting DaemonService")

            val prefs = context.getSharedPreferences("daemon_prefs", Context.MODE_PRIVATE)
            val token = prefs.getString("auth_token", "") ?: ""
            if (token.isNotEmpty()) {
                val serviceIntent = Intent(context, DaemonService::class.java).apply {
                    action = DaemonService.ACTION_START
                    putExtra(DaemonService.EXTRA_SERVER_URL, "wss://my.daemon.page/ws/device")
                }
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    context.startForegroundService(serviceIntent)
                } else {
                    context.startService(serviceIntent)
                }
            }
        }
    }
}
