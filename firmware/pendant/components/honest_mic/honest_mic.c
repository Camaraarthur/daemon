/*
 * Honest Puck v3.2 — honest_mic.c
 *
 * Ported from: omiGlass/firmware/src/mic.cpp
 *   Copyright (c) 2024 Based Hardware Contributors, MIT.
 * Port target: ESP-IDF v5.2 new I2S driver.
 *
 * Key differences from upstream:
 *   - Uses driver/i2s_pdm.h (new driver), not legacy driver/i2s.h.
 *   - Runs capture in a dedicated FreeRTOS task so the callback is never
 *     called from app_main.
 *   - PSRAM buffer allocation uses heap_caps_malloc (Arduino has ps_malloc).
 */

#include "honest_mic.h"
#include "honest_puck_pins.h"

#include <string.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "driver/i2s_pdm.h"
#include "esp_heap_caps.h"
#include "esp_log.h"

#define MIC_SAMPLE_RATE_HZ      16000
#define MIC_BUFFER_SAMPLES      1600    /* 100 ms @ 16 kHz */
#define MIC_GAIN_Q0             2       /* integer gain — same default as upstream */

static const char *TAG = "honest_mic";

static i2s_chan_handle_t s_rx_chan = NULL;
static TaskHandle_t      s_task = NULL;
static volatile bool     s_running = false;
static honest_mic_cb_t   s_cb = NULL;
static int16_t          *s_buf = NULL;

static void mic_task(void *arg)
{
    while (s_running) {
        size_t bytes_read = 0;
        esp_err_t err = i2s_channel_read(s_rx_chan, s_buf,
                                         MIC_BUFFER_SAMPLES * sizeof(int16_t),
                                         &bytes_read, pdMS_TO_TICKS(40));
        if (err == ESP_OK && bytes_read > 0) {
            size_t samples = bytes_read / sizeof(int16_t);
            /* Optional integer gain — clamp to int16. */
            if (MIC_GAIN_Q0 != 1) {
                for (size_t i = 0; i < samples; i++) {
                    int32_t s = (int32_t)s_buf[i] * MIC_GAIN_Q0;
                    if (s > 32767)  s = 32767;
                    if (s < -32768) s = -32768;
                    s_buf[i] = (int16_t)s;
                }
            }
            if (s_cb) s_cb(s_buf, samples);
        }
    }
    vTaskDelete(NULL);
}

esp_err_t honest_mic_start(honest_mic_cb_t cb)
{
    if (s_running) return ESP_OK;

    s_cb = cb;
    if (!s_buf) {
        s_buf = heap_caps_malloc(MIC_BUFFER_SAMPLES * sizeof(int16_t),
                                 MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
        if (!s_buf) s_buf = malloc(MIC_BUFFER_SAMPLES * sizeof(int16_t));
        if (!s_buf) return ESP_ERR_NO_MEM;
    }

    i2s_chan_config_t chan_cfg = I2S_CHANNEL_DEFAULT_CONFIG(I2S_NUM_0,
                                                            I2S_ROLE_MASTER);
    chan_cfg.dma_desc_num  = 8;
    chan_cfg.dma_frame_num = 256;
    ESP_ERROR_CHECK(i2s_new_channel(&chan_cfg, NULL, &s_rx_chan));

    i2s_pdm_rx_config_t pdm_cfg = {
        .clk_cfg  = I2S_PDM_RX_CLK_DEFAULT_CONFIG(MIC_SAMPLE_RATE_HZ),
        .slot_cfg = I2S_PDM_RX_SLOT_DEFAULT_CONFIG(I2S_DATA_BIT_WIDTH_16BIT,
                                                   I2S_SLOT_MODE_MONO),
        .gpio_cfg = {
            .clk = HP_PIN_PDM_CLK,
            .din = HP_PIN_PDM_DATA,
            .invert_flags = {
                .clk_inv = false,
            },
        },
    };
    ESP_ERROR_CHECK(i2s_channel_init_pdm_rx_mode(s_rx_chan, &pdm_cfg));
    ESP_ERROR_CHECK(i2s_channel_enable(s_rx_chan));

    s_running = true;
    BaseType_t ok = xTaskCreatePinnedToCore(mic_task, "honest_mic", 4096, NULL,
                                            5, &s_task, 1);
    if (ok != pdPASS) {
        honest_mic_stop();
        return ESP_ERR_NO_MEM;
    }

    ESP_LOGI(TAG, "PDM mic up @ %d Hz on CLK=IO%d DATA=IO%d",
             MIC_SAMPLE_RATE_HZ, HP_PIN_PDM_CLK, HP_PIN_PDM_DATA);
    return ESP_OK;
}

void honest_mic_stop(void)
{
    if (!s_running) return;
    s_running = false;
    /* Task self-deletes on next loop iteration. */
    if (s_rx_chan) {
        i2s_channel_disable(s_rx_chan);
        i2s_del_channel(s_rx_chan);
        s_rx_chan = NULL;
    }
    ESP_LOGI(TAG, "PDM mic stopped");
}

bool honest_mic_is_running(void) { return s_running; }
