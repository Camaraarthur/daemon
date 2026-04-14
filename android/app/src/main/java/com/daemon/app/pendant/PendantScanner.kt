package com.daemon.app.pendant

import android.Manifest
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothManager
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanFilter
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.content.Context
import android.content.pm.PackageManager
import android.os.ParcelUuid
import android.util.Log
import androidx.core.content.ContextCompat
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withTimeout
import org.json.JSONArray
import org.json.JSONObject
import kotlin.coroutines.resume

/**
 * A discovered pendant device.
 */
data class PendantDevice(
    val name: String,
    val address: String,
    val rssi: Int,
)

/**
 * Scans for DaemonPendant BLE peripherals advertising the HonestPuck service.
 */
object PendantScanner {

    private const val TAG = "PendantScanner"

    /**
     * Returns true if the required BLE permissions are granted.
     */
    fun hasPermissions(context: Context): Boolean {
        val perms = listOf(
            Manifest.permission.BLUETOOTH_SCAN,
            Manifest.permission.BLUETOOTH_CONNECT,
        )
        return perms.all {
            ContextCompat.checkSelfPermission(context, it) == PackageManager.PERMISSION_GRANTED
        }
    }

    /**
     * Scan for pendant devices. Returns a list of discovered pendants.
     *
     * @param timeoutMs how long to scan (default 10s)
     */
    suspend fun scan(context: Context, timeoutMs: Long = 10_000): List<PendantDevice> {
        if (!hasPermissions(context)) {
            Log.w(TAG, "Missing BLE permissions")
            return emptyList()
        }

        val btManager = context.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
        val adapter = btManager?.adapter
        if (adapter == null || !adapter.isEnabled) {
            Log.w(TAG, "Bluetooth not available or disabled")
            return emptyList()
        }

        val scanner = adapter.bluetoothLeScanner ?: run {
            Log.w(TAG, "BLE scanner not available")
            return emptyList()
        }

        return withTimeout(timeoutMs + 1000) {
            suspendCancellableCoroutine { cont ->
                val found = mutableMapOf<String, PendantDevice>()

                // Filter by OTA service UUID — pendant firmware advertises the OTA
                // service on the adv packet; HonestPuck service is only in the GATT DB.
                val filter = ScanFilter.Builder()
                    .setServiceUuid(ParcelUuid(PendantUuids.OTA_SERVICE))
                    .build()

                val settings = ScanSettings.Builder()
                    .setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY)
                    .setReportDelay(0)
                    .build()

                val callback = object : ScanCallback() {
                    override fun onScanResult(callbackType: Int, result: ScanResult) {
                        val device = result.device
                        @Suppress("MissingPermission")
                        val name = device.name ?: return
                        if (name.startsWith(PendantUuids.DEVICE_NAME_PREFIX)) {
                            found[device.address] = PendantDevice(
                                name = name,
                                address = device.address,
                                rssi = result.rssi,
                            )
                            Log.d(TAG, "Found pendant: $name (${device.address}) RSSI=${result.rssi}")
                        }
                    }

                    override fun onScanFailed(errorCode: Int) {
                        Log.e(TAG, "Scan failed: errorCode=$errorCode")
                        if (cont.isActive) cont.resume(emptyList())
                    }
                }

                @Suppress("MissingPermission")
                scanner.startScan(listOf(filter), settings, callback)
                Log.d(TAG, "BLE scan started (${timeoutMs}ms)")

                // Schedule stop
                val handler = android.os.Handler(android.os.Looper.getMainLooper())
                handler.postDelayed({
                    try {
                        @Suppress("MissingPermission")
                        scanner.stopScan(callback)
                    } catch (_: Exception) {}
                    Log.d(TAG, "BLE scan finished: ${found.size} pendant(s)")
                    if (cont.isActive) cont.resume(found.values.toList())
                }, timeoutMs)

                cont.invokeOnCancellation {
                    try {
                        @Suppress("MissingPermission")
                        scanner.stopScan(callback)
                    } catch (_: Exception) {}
                }
            }
        }
    }

    /**
     * Convert scan results to JSON for the WebSocket/JS bridge.
     */
    fun toJson(devices: List<PendantDevice>): JSONArray {
        return JSONArray().apply {
            for (d in devices) {
                put(JSONObject().apply {
                    put("name", d.name)
                    put("address", d.address)
                    put("rssi", d.rssi)
                })
            }
        }
    }
}
