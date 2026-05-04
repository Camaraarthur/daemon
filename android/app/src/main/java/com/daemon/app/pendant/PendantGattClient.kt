package com.daemon.app.pendant

import android.bluetooth.*
import android.content.Context
import android.util.Log
import kotlinx.coroutines.*
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow

/**
 * Core BLE GATT client for the DaemonPendant.
 *
 * Connects, discovers services, subscribes to notifications on
 * control events, audio stream, and battery level. Provides write
 * methods for LED and mic control.
 */
class PendantGattClient(private val context: Context) {

    companion object {
        private const val TAG = "PendantGatt"
    }

    // ── Public event flows ──────────────────────────────────────────

    sealed class PendantEvent {
        data class ButtonEvent(val code: Int) : PendantEvent()
        data class AudioChunk(val data: ByteArray) : PendantEvent()
        data class BatteryLevel(val percent: Int) : PendantEvent()
        data class ConnectionState(val connected: Boolean, val status: Int = 0) : PendantEvent()
    }

    private val _events = MutableSharedFlow<PendantEvent>(extraBufferCapacity = 64)
    val events: SharedFlow<PendantEvent> = _events

    // ── State ───────────────────────────────────────────────────────

    private var gatt: BluetoothGatt? = null
    @Volatile var isConnected = false
        private set
    @Volatile var batteryPercent = -1
        private set

    private val pendingNotifyQueue = ArrayDeque<BluetoothGattCharacteristic>()
    private var notifyInProgress = false

    // OTA state — coordinates write acks + MTU
    @Volatile private var mtu = 23
    @Volatile var subscribeOnConnect = true  // v0.8+ firmware has working NOTIFY + CCC
    @Volatile private var cacheRefreshed = false
    private val writeAckChannel = Channel<Int>(Channel.UNLIMITED)
    private val mtuChannel = Channel<Int>(Channel.UNLIMITED)
    private val servicesDiscoveredChannel = Channel<Unit>(Channel.CONFLATED)

    // ── GATT Callbacks ──────────────────────────────────────────────

    private val gattCallback = object : BluetoothGattCallback() {

        override fun onConnectionStateChange(g: BluetoothGatt, status: Int, newState: Int) {
            if (newState == BluetoothProfile.STATE_CONNECTED) {
                Log.d(TAG, "Connected to pendant (status=$status)")
                isConnected = true
                _events.tryEmit(PendantEvent.ConnectionState(true, status))
                // Refresh GATT cache on first connect to drop phantom chars from
                // stale firmware generations (e.g. leftover 4f7e1f04 audio_stream).
                // Android's auto-read of cached characteristics triggers auth
                // failures on the pendant → status=5 disconnect loop.
                if (!cacheRefreshed) {
                    cacheRefreshed = true
                    try {
                        val m = g.javaClass.getMethod("refresh")
                        val ok = m.invoke(g) as Boolean
                        Log.d(TAG, "GATT cache refresh=$ok (expect disconnect + reconnect)")
                    } catch (e: Exception) {
                        Log.w(TAG, "refresh() failed: ${e.message}")
                    }
                }
                @Suppress("MissingPermission")
                g.discoverServices()
            } else if (newState == BluetoothProfile.STATE_DISCONNECTED) {
                Log.d(TAG, "Disconnected from pendant (status=$status)")
                isConnected = false
                _events.tryEmit(PendantEvent.ConnectionState(false, status))
                // Pendant reboots after OTA — service handles shift. Reset
                // cacheRefreshed so the next connect re-refreshes and rediscovers.
                cacheRefreshed = false
                gatt = null
            }
        }

        override fun onServicesDiscovered(g: BluetoothGatt, status: Int) {
            if (status != BluetoothGatt.GATT_SUCCESS) {
                Log.e(TAG, "Service discovery failed: $status")
                return
            }
            Log.d(TAG, "Services discovered (${g.services.size} services)")
            servicesDiscoveredChannel.trySend(Unit)
            if (subscribeOnConnect) subscribeToNotifications(g)
        }

        override fun onCharacteristicChanged(
            g: BluetoothGatt,
            characteristic: BluetoothGattCharacteristic,
            value: ByteArray,
        ) {
            when (characteristic.uuid) {
                PendantUuids.CONTROL_EVENTS -> {
                    if (value.isNotEmpty()) {
                        val code = value[0].toInt() and 0xFF
                        Log.d(TAG, "Button event: 0x${code.toString(16)}")
                        _events.tryEmit(PendantEvent.ButtonEvent(code))
                    }
                }
                PendantUuids.AUDIO_STREAM -> {
                    _events.tryEmit(PendantEvent.AudioChunk(value.copyOf()))
                }
                PendantUuids.BATTERY_LEVEL -> {
                    if (value.isNotEmpty()) {
                        batteryPercent = value[0].toInt() and 0xFF
                        Log.d(TAG, "Battery: $batteryPercent%")
                        _events.tryEmit(PendantEvent.BatteryLevel(batteryPercent))
                    }
                }
                else -> {
                    Log.d(TAG, "Notification from unknown char: ${characteristic.uuid}")
                }
            }
        }

        // Legacy callback for API < 33
        @Suppress("DEPRECATION")
        @Deprecated("Deprecated in API 33")
        override fun onCharacteristicChanged(
            g: BluetoothGatt,
            characteristic: BluetoothGattCharacteristic,
        ) {
            val value = characteristic.value ?: return
            onCharacteristicChanged(g, characteristic, value)
        }

        override fun onDescriptorWrite(
            g: BluetoothGatt,
            descriptor: BluetoothGattDescriptor,
            status: Int,
        ) {
            if (status != BluetoothGatt.GATT_SUCCESS) {
                Log.e(TAG, "Descriptor write failed for ${descriptor.characteristic.uuid}: $status")
            }
            notifyInProgress = false
            processNotifyQueue(g)
        }

        override fun onMtuChanged(g: BluetoothGatt, mtuValue: Int, status: Int) {
            Log.d(TAG, "MTU changed to $mtuValue (status=$status)")
            if (status == BluetoothGatt.GATT_SUCCESS) mtu = mtuValue
            mtuChannel.trySend(mtuValue)
        }

        override fun onCharacteristicWrite(
            g: BluetoothGatt,
            characteristic: BluetoothGattCharacteristic,
            status: Int,
        ) {
            writeAckChannel.trySend(status)
        }
    }

    // ── Public API ──────────────────────────────────────────────────

    @Suppress("MissingPermission")
    fun connect(address: String) {
        val adapter = (context.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager).adapter
        val device = adapter.getRemoteDevice(address)
        // If Android has a stale bond key but the pendant firmware has no
        // pairing, every connect ends in "Key missing" disconnect. Nuke the
        // bond via reflection before connecting.
        if (device.bondState == BluetoothDevice.BOND_BONDED || device.bondState == BluetoothDevice.BOND_BONDING) {
            try {
                val m = device.javaClass.getMethod("removeBond")
                val ok = m.invoke(device) as Boolean
                Log.d(TAG, "removeBond()=$ok (bondState was ${device.bondState})")
            } catch (e: Exception) {
                Log.w(TAG, "removeBond failed: ${e.message}")
            }
        }
        Log.d(TAG, "Connecting to $address...")
        gatt = device.connectGatt(context, true, gattCallback, BluetoothDevice.TRANSPORT_LE)
    }

    @Suppress("MissingPermission")
    fun disconnect() {
        Log.d(TAG, "Disconnect requested")
        gatt?.let {
            it.disconnect()
            it.close()
        }
        gatt = null
        isConnected = false
        _events.tryEmit(PendantEvent.ConnectionState(false))
    }

    @Suppress("MissingPermission")
    fun setLed(pattern: Int) {
        val g = gatt ?: return
        val service = g.getService(PendantUuids.HONESTPUCK_SERVICE) ?: return
        val char = service.getCharacteristic(PendantUuids.LED_CONTROL) ?: return
        g.writeCharacteristic(char, byteArrayOf(pattern.toByte()), BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT)
        Log.d(TAG, "LED set to pattern $pattern")
    }

    @Suppress("MissingPermission")
    fun setMic(on: Boolean) {
        val g = gatt ?: return
        val service = g.getService(PendantUuids.HONESTPUCK_SERVICE) ?: return
        val char = service.getCharacteristic(PendantUuids.MIC_CONTROL) ?: return
        val value = if (on) 0x01.toByte() else 0x00.toByte()
        g.writeCharacteristic(char, byteArrayOf(value), BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT)
        Log.d(TAG, "Mic set to ${if (on) "ON" else "OFF"}")
    }

    // ── Notification Subscription ───────────────────────────────────

    private fun subscribeToNotifications(g: BluetoothGatt) {
        pendingNotifyQueue.clear()
        notifyInProgress = false

        // HonestPuck notifications — only subscribe to chars that actually
        // support NOTIFY in the running firmware (avoid phantoms from stale cache).
        g.getService(PendantUuids.HONESTPUCK_SERVICE)?.let { svc ->
            listOf(PendantUuids.CONTROL_EVENTS, PendantUuids.AUDIO_STREAM).forEach { uuid ->
                svc.getCharacteristic(uuid)?.let { char ->
                    val hasNotify = (char.properties and BluetoothGattCharacteristic.PROPERTY_NOTIFY) != 0
                    if (hasNotify) pendingNotifyQueue.addLast(char)
                    else Log.d(TAG, "Skipping $uuid — no NOTIFY property")
                }
            }
        }
        // Battery
        g.getService(PendantUuids.BATTERY_SERVICE)?.let { svc ->
            svc.getCharacteristic(PendantUuids.BATTERY_LEVEL)?.let { pendingNotifyQueue.addLast(it) }
        }

        Log.d(TAG, "Subscribing to ${pendingNotifyQueue.size} notification chars")
        processNotifyQueue(g)
    }

    @Suppress("MissingPermission")
    private fun processNotifyQueue(g: BluetoothGatt) {
        if (notifyInProgress) return
        val char = pendingNotifyQueue.removeFirstOrNull() ?: run {
            Log.d(TAG, "All notifications subscribed")
            // Read initial battery level
            readBattery(g)
            return
        }
        notifyInProgress = true

        g.setCharacteristicNotification(char, true)
        val descriptor = char.getDescriptor(PendantUuids.CCC_DESCRIPTOR)
        if (descriptor != null) {
            g.writeDescriptor(descriptor, BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE)
            Log.d(TAG, "Enabling notifications for ${char.uuid}")
        } else {
            Log.w(TAG, "No CCC descriptor for ${char.uuid}")
            notifyInProgress = false
            processNotifyQueue(g)
        }
    }

    @Suppress("MissingPermission")
    private fun readBattery(g: BluetoothGatt) {
        g.getService(PendantUuids.BATTERY_SERVICE)
            ?.getCharacteristic(PendantUuids.BATTERY_LEVEL)
            ?.let { g.readCharacteristic(it) }
    }

    // ── OTA firmware upload ─────────────────────────────────────────
    //
    // Protocol (matches firmware in /tmp/pendant_test/src/main.cpp):
    //   1. Write 0x01 to OTA_CONTROL → firmware calls Update.begin()
    //   2. Stream firmware bytes to OTA_DATA in <= (mtu-3) byte chunks
    //   3. Write 0x03 to OTA_CONTROL → firmware calls Update.end() + reboots
    //
    // Uses WRITE_TYPE_NO_RESPONSE on OTA_DATA for throughput (firmware
    // declares WRITE | WRITE_NR). Drains writeAckChannel between chunks
    // so the Android BT stack's internal queue doesn't overrun.

    @Suppress("MissingPermission")
    suspend fun uploadFirmware(
        bin: ByteArray,
        onProgress: (sent: Int, total: Int) -> Unit,
    ): Result<Unit> = withContext(Dispatchers.IO) {
        // Wait up to 30s for a connected + service-discovered state.
        // The bridge auto-reconnects on disconnect, so we just need to be patient.
        Log.d(TAG, "uploadFirmware: entry gatt=${gatt != null} isConnected=$isConnected mtu=$mtu")
        val deadline = System.currentTimeMillis() + 30_000
        var redicoverTried = false
        while (gatt?.getService(PendantUuids.OTA_SERVICE) == null) {
            val g = gatt
            if (g != null) {
                Log.d(TAG, "OTA service missing; services.size=${g.services.size} connState=isConnected=$isConnected")
                if (!redicoverTried) {
                    redicoverTried = true
                    Log.d(TAG, "Calling discoverServices() to refresh")
                    @Suppress("MissingPermission")
                    g.discoverServices()
                }
            }
            if (System.currentTimeMillis() > deadline) {
                return@withContext Result.failure(IllegalStateException("timed out waiting for OTA service"))
            }
            withTimeoutOrNull(3000) { servicesDiscoveredChannel.receive() }
        }
        val g = gatt ?: return@withContext Result.failure(IllegalStateException("not connected"))
        val service = g.getService(PendantUuids.OTA_SERVICE)
            ?: return@withContext Result.failure(IllegalStateException("OTA service missing"))
        val control = service.getCharacteristic(PendantUuids.OTA_CONTROL)
            ?: return@withContext Result.failure(IllegalStateException("OTA control char missing"))
        val data = service.getCharacteristic(PendantUuids.OTA_DATA)
            ?: return@withContext Result.failure(IllegalStateException("OTA data char missing"))

        // Request max MTU. Negotiation can take up to ~2s on some phones.
        while (writeAckChannel.tryReceive().isSuccess) { /* drain */ }
        while (mtuChannel.tryReceive().isSuccess) { /* drain */ }
        g.requestMtu(247)
        withTimeoutOrNull(3000) { mtuChannel.receive() }
        val chunkSize = (mtu - 3).coerceIn(20, 244)
        Log.d(TAG, "OTA starting: ${bin.size} bytes, chunkSize=$chunkSize")

        // Start
        g.writeCharacteristic(control, byteArrayOf(0x01), BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT)
        val startStatus = withTimeoutOrNull(3000) { writeAckChannel.receive() }
        if (startStatus != BluetoothGatt.GATT_SUCCESS) {
            return@withContext Result.failure(IllegalStateException("OTA start failed: $startStatus"))
        }
        // Give firmware a beat to call Update.begin()
        delay(250)

        // Stream data
        var offset = 0
        while (offset < bin.size) {
            val end = minOf(offset + chunkSize, bin.size)
            val chunk = bin.copyOfRange(offset, end)
            g.writeCharacteristic(data, chunk, BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE)
            // WRITE_NO_RESPONSE still fires onCharacteristicWrite once the
            // local BT stack has room for the next write (flow control).
            val ack = withTimeoutOrNull(3000) { writeAckChannel.receive() }
            if (ack == null) {
                return@withContext Result.failure(IllegalStateException("OTA data timeout at $offset/${bin.size}"))
            }
            offset = end
            onProgress(offset, bin.size)
        }

        // Finish — pendant will reboot shortly after acking
        g.writeCharacteristic(control, byteArrayOf(0x03), BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT)
        withTimeoutOrNull(5000) { writeAckChannel.receive() }
        Log.d(TAG, "OTA done, pendant rebooting")
        Result.success(Unit)
    }
}
