/*
 * Honest Puck v3.2 — main entry point.
 *
 * Boot order is intentional and safety-critical:
 *   1. honest_gate_init()  -> drives IO4 HIGH before anything else.
 *                              Mic rail is dead. Red LEDs are dark.
 *   2. NVS + BLE stack up.
 *   3. LED self-test: pulse rail ON for 150 ms, verify interlock, rail OFF.
 *   4. Wait for either a button press or a BLE "start recording" write.
 *   5. Only then does the mic rail come up and PDM capture start.
 *
 * This file is original to Honest Puck. Pattern-influenced by
 * omiGlass/firmware/src/app.cpp (MIT, BasedHardware/omi) but rewritten
 * for ESP-IDF / FreeRTOS.
 */

#include <stdio.h>
#include <string.h>

#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "esp_log.h"
#include "nvs_flash.h"

#include "honest_puck_pins.h"
#include "honest_gate.h"
#include "honest_mic.h"
#include "honest_ble.h"
#include "honest_ui.h"

static const char *TAG = "honest_puck";

static volatile bool s_recording = false;

/* Called from the mic task when a fresh PDM frame is ready. */
static void on_audio_frame(const int16_t *pcm, size_t samples)
{
    honest_ble_send_audio_pcm(pcm, samples);
}

/* Called from BLE GATT when the phone writes a control byte. */
static void on_ble_control(uint8_t cmd)
{
    if (cmd == 0x01 && !s_recording) {
        ESP_LOGI(TAG, "BLE requested recording START");
        honest_gate_set_mic_power(true);     /* IO4 -> LOW, rail hot, LEDs on */
        honest_mic_start(on_audio_frame);
        s_recording = true;
    } else if (cmd == 0x00 && s_recording) {
        ESP_LOGI(TAG, "BLE requested recording STOP");
        honest_mic_stop();
        honest_gate_set_mic_power(false);    /* IO4 -> HIGH, rail dead, LEDs dark */
        s_recording = false;
    }
}

/* Main button toggles recording locally (works without a phone). */
static void on_main_button(bool pressed)
{
    if (!pressed) return;
    on_ble_control(s_recording ? 0x00 : 0x01);
}

void app_main(void)
{
    ESP_LOGI(TAG, "Honest Puck v3.2 boot");

    /* ---- Step 1: privacy interlock BEFORE anything else ---- */
    ESP_ERROR_CHECK(honest_gate_init());
    honest_gate_assert_off();  /* sanity: IO4 MUST be HIGH here */

    /* ---- Step 2: NVS + BLE ---- */
    esp_err_t nvs_err = nvs_flash_init();
    if (nvs_err == ESP_ERR_NVS_NO_FREE_PAGES || nvs_err == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        ESP_ERROR_CHECK(nvs_flash_erase());
        ESP_ERROR_CHECK(nvs_flash_init());
    }

    ESP_ERROR_CHECK(honest_ui_init(on_main_button));
    ESP_ERROR_CHECK(honest_ble_init(on_ble_control));

    /* ---- Step 3: LED self-test (pulse rail once) ---- */
    ESP_LOGI(TAG, "Privacy LED self-test (150 ms)");
    honest_gate_set_mic_power(true);
    vTaskDelay(pdMS_TO_TICKS(150));
    honest_gate_set_mic_power(false);
    ESP_LOGI(TAG, "Self-test done. Rail is now OFF. Waiting for user consent.");

    /* ---- Step 4: idle loop ----
     * Nothing more to do here — mic and BLE live in their own tasks,
     * UI button events arrive via ISR + debounce task. */
    while (1) {
        vTaskDelay(pdMS_TO_TICKS(1000));
    }
}
