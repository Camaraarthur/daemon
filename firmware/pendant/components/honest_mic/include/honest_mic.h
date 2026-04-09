/*
 * Honest Puck v3.2 — PDM microphone capture.
 *
 * Ported from omiGlass/firmware/src/mic.cpp (MIT, BasedHardware/omi)
 * to ESP-IDF v5.2 new I2S driver (driver/i2s_pdm.h).
 *
 * 16 kHz, 16-bit, mono, IM73D122 on HP_PIN_PDM_CLK / HP_PIN_PDM_DATA.
 */
#pragma once

#include "esp_err.h"
#include <stddef.h>
#include <stdint.h>

typedef void (*honest_mic_cb_t)(const int16_t *pcm, size_t samples);

/* Starts a FreeRTOS task that pulls PDM frames and invokes cb.
 * PRECONDITION: honest_gate_set_mic_power(true) has been called.
 * If the rail is dead this function still succeeds but the mic will
 * return silence (IM73D122 CLK toggles into a dead load). */
esp_err_t honest_mic_start(honest_mic_cb_t cb);

void honest_mic_stop(void);
bool honest_mic_is_running(void);
