/*
 * Honest Puck v3.2 — BLE GATT (NimBLE).
 *
 * Ported from omiGlass/firmware/src/app.cpp (MIT, BasedHardware/omi).
 * The 128-bit service UUID and characteristic UUIDs are preserved byte-
 * for-byte so existing Omi-compatible clients pair without any changes.
 *
 *   Service:       19B10000-E8F2-537E-4F6C-D104768A1214
 *   AudioData:     19B10001-...      (notify)  2-byte idx + 1-byte sub + payload
 *   AudioCodec:    19B10002-...      (read)    1 byte = codec id (0=PCM16, 21=Opus)
 *   Control:       19B10006-...      (write)   0x01=start, 0x00=stop
 *
 * This is a proper subset of the Omi protocol: we implement audio + control,
 * not photo and not OTA (see README's "NOT done" list).
 */
#pragma once

#include "esp_err.h"
#include <stddef.h>
#include <stdint.h>

typedef void (*honest_ble_control_cb_t)(uint8_t cmd);

esp_err_t honest_ble_init(honest_ble_control_cb_t cb);

/* Encode (or pass through as PCM16 right now) a block of samples and push
 * it over the audio_data characteristic in Omi framing. */
void honest_ble_send_audio_pcm(const int16_t *pcm, size_t samples);

bool honest_ble_is_connected(void);
