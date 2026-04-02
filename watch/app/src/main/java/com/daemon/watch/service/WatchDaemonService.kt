package com.daemon.watch.service

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.IBinder
import android.util.Log

/**
 * Lightweight foreground service that keeps the watch app alive.
 * Re-registers on boot via BootReceiver.
 */
class WatchDaemonService : Service() {

    companion object {
        const val TAG = "WatchDaemonService"
        const val CHANNEL_ID = "daemon_watch_service"
        const val NOTIFICATION_ID = 1
    }

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        Log.d(TAG, "Service starting")
        startForeground(NOTIFICATION_ID, buildNotification("daemon active"))
        return START_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onTaskRemoved(rootIntent: Intent?) {
        Log.d(TAG, "Task removed, restarting service")
        startForegroundService(Intent(applicationContext, WatchDaemonService::class.java))
        super.onTaskRemoved(rootIntent)
    }

    private fun createNotificationChannel() {
        val channel = NotificationChannel(
            CHANNEL_ID,
            "Daemon Watch",
            NotificationManager.IMPORTANCE_LOW,
        ).apply {
            description = "Keeps daemon watch connected"
        }
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        nm.createNotificationChannel(channel)
    }

    private fun buildNotification(text: String): Notification {
        return Notification.Builder(this, CHANNEL_ID)
            .setContentTitle("daemon")
            .setContentText(text)
            .setSmallIcon(android.R.drawable.ic_menu_compass)
            .setOngoing(true)
            .build()
    }
}
