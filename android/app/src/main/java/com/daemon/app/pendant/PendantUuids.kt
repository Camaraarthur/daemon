package com.daemon.app.pendant

import java.util.UUID

/**
 * BLE GATT service and characteristic UUIDs for the DaemonPendant.
 */
object PendantUuids {

    // ── HonestPuck Service ──────────────────────────────────────────
    val HONESTPUCK_SERVICE: UUID       = UUID.fromString("4f7e1f00-7e3d-4f5a-9c1a-8e1b3a5b7d00")
    val CONTROL_EVENTS: UUID           = UUID.fromString("4f7e1f01-7e3d-4f5a-9c1a-8e1b3a5b7d00")
    val LED_CONTROL: UUID              = UUID.fromString("4f7e1f02-7e3d-4f5a-9c1a-8e1b3a5b7d00")
    val MIC_CONTROL: UUID              = UUID.fromString("4f7e1f03-7e3d-4f5a-9c1a-8e1b3a5b7d00")
    val AUDIO_STREAM: UUID             = UUID.fromString("4f7e1f04-7e3d-4f5a-9c1a-8e1b3a5b7d00")
    val RECORDING_BUFFER: UUID         = UUID.fromString("4f7e1f05-7e3d-4f5a-9c1a-8e1b3a5b7d00")

    // ── OTA Service ─────────────────────────────────────────────────
    val OTA_SERVICE: UUID              = UUID.fromString("8e400001-f315-4f60-9fb8-838830daea50")
    val OTA_CONTROL: UUID              = UUID.fromString("8e400002-f315-4f60-9fb8-838830daea50")
    val OTA_DATA: UUID                 = UUID.fromString("8e400003-f315-4f60-9fb8-838830daea50")

    // ── Standard Services ───────────────────────────────────────────
    val BATTERY_SERVICE: UUID          = UUID.fromString("0000180f-0000-1000-8000-00805f9b34fb")
    val BATTERY_LEVEL: UUID            = UUID.fromString("00002a19-0000-1000-8000-00805f9b34fb")

    val DEVICE_INFO_SERVICE: UUID      = UUID.fromString("0000180a-0000-1000-8000-00805f9b34fb")
    val MANUFACTURER_NAME: UUID        = UUID.fromString("00002a29-0000-1000-8000-00805f9b34fb")
    val MODEL_NUMBER: UUID             = UUID.fromString("00002a24-0000-1000-8000-00805f9b34fb")
    val FIRMWARE_REVISION: UUID        = UUID.fromString("00002a26-0000-1000-8000-00805f9b34fb")
    val HARDWARE_REVISION: UUID        = UUID.fromString("00002a27-0000-1000-8000-00805f9b34fb")

    // ── BLE Descriptor ──────────────────────────────────────────────
    val CCC_DESCRIPTOR: UUID           = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb")

    // ── Control Event Codes ─────────────────────────────────────────
    const val EVENT_MAIN_DOWN = 0x01
    const val EVENT_MAIN_UP = 0x02
    const val EVENT_HOLD = 0x03
    const val EVENT_DOUBLE = 0x04
    const val EVENT_RECORDING = 0x05
    const val EVENT_STOPPED = 0x06

    // ── Device Name Prefix ──────────────────────────────────────────
    const val DEVICE_NAME_PREFIX = "DaemonPendant"
}
