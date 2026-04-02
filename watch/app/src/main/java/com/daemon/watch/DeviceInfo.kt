package com.daemon.watch

data class DeviceInfo(
    val id: String,
    val name: String,
    val platform: String,
    val connected: Boolean,
)
