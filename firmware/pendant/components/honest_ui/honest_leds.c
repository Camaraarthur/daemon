/*
 * Honest Puck v3.2 — WS2812C-2020 ring driver.
 *
 * 4 pixels on IO8. Uses the esp-idf RMT peripheral directly so we don't
 * pull in a third-party component. WS2812C timing: T0H=350ns, T1H=700ns,
 * period=1.25us (800 kbps). Values here are tuned for an 80 MHz RMT clock.
 *
 * See WARNING in honest_gate.h — this data line is only visible to the
 * outside world while HONEST_MIC_PWR is hot. That is intentional.
 *
 * Original to Honest Puck. MIT.
 */
#include "honest_ui.h"
#include "honest_puck_pins.h"

#include <string.h>
#include "driver/rmt_tx.h"
#include "esp_log.h"

#define WS_RES_HZ        (10 * 1000 * 1000)  /* 10 MHz -> 100 ns per tick */
#define WS_T0H_TICKS     3   /* ~300 ns */
#define WS_T0L_TICKS     9   /* ~900 ns */
#define WS_T1H_TICKS     9   /* ~900 ns */
#define WS_T1L_TICKS     3   /* ~300 ns */

static const char *TAG = "honest_led";
static rmt_channel_handle_t s_chan = NULL;
static rmt_encoder_handle_t s_encoder = NULL;

/* --- minimal bytes encoder for WS2812 --- */
typedef struct {
    rmt_encoder_t base;
    rmt_encoder_t *bytes_encoder;
    rmt_encoder_t *copy_encoder;
    rmt_symbol_word_t reset;
    int state;
} ws_encoder_t;

static size_t ws_encode(rmt_encoder_t *encoder, rmt_channel_handle_t chan,
                        const void *primary_data, size_t data_size,
                        rmt_encode_state_t *ret_state)
{
    ws_encoder_t *e = __containerof(encoder, ws_encoder_t, base);
    rmt_encode_state_t session_state = 0;
    rmt_encode_state_t state = 0;
    size_t encoded = 0;

    if (e->state == 0) {
        encoded += e->bytes_encoder->encode(e->bytes_encoder, chan,
                                            primary_data, data_size, &session_state);
        if (session_state & RMT_ENCODING_COMPLETE) e->state = 1;
        if (session_state & RMT_ENCODING_MEM_FULL) {
            state |= RMT_ENCODING_MEM_FULL;
            goto out;
        }
    }
    if (e->state == 1) {
        encoded += e->copy_encoder->encode(e->copy_encoder, chan,
                                           &e->reset, sizeof(e->reset), &session_state);
        if (session_state & RMT_ENCODING_COMPLETE) {
            e->state = 0;
            state |= RMT_ENCODING_COMPLETE;
        }
        if (session_state & RMT_ENCODING_MEM_FULL) state |= RMT_ENCODING_MEM_FULL;
    }
out:
    *ret_state = state;
    return encoded;
}

static esp_err_t ws_del(rmt_encoder_t *encoder)
{
    ws_encoder_t *e = __containerof(encoder, ws_encoder_t, base);
    rmt_del_encoder(e->bytes_encoder);
    rmt_del_encoder(e->copy_encoder);
    free(e);
    return ESP_OK;
}

static esp_err_t ws_reset(rmt_encoder_t *encoder)
{
    ws_encoder_t *e = __containerof(encoder, ws_encoder_t, base);
    rmt_encoder_reset(e->bytes_encoder);
    rmt_encoder_reset(e->copy_encoder);
    e->state = 0;
    return ESP_OK;
}

static esp_err_t ws_encoder_new(rmt_encoder_handle_t *out)
{
    ws_encoder_t *e = calloc(1, sizeof(*e));
    if (!e) return ESP_ERR_NO_MEM;

    e->base.encode = ws_encode;
    e->base.del    = ws_del;
    e->base.reset  = ws_reset;

    rmt_bytes_encoder_config_t bytes_cfg = {
        .bit0 = { .level0 = 1, .duration0 = WS_T0H_TICKS, .level1 = 0, .duration1 = WS_T0L_TICKS },
        .bit1 = { .level0 = 1, .duration0 = WS_T1H_TICKS, .level1 = 0, .duration1 = WS_T1L_TICKS },
        .flags.msb_first = 1,
    };
    ESP_ERROR_CHECK(rmt_new_bytes_encoder(&bytes_cfg, &e->bytes_encoder));

    rmt_copy_encoder_config_t copy_cfg = {};
    ESP_ERROR_CHECK(rmt_new_copy_encoder(&copy_cfg, &e->copy_encoder));

    e->reset = (rmt_symbol_word_t){ .level0 = 0, .duration0 = 250,
                                    .level1 = 0, .duration1 = 250 };
    *out = &e->base;
    return ESP_OK;
}

esp_err_t honest_leds_init(void)
{
    rmt_tx_channel_config_t tx = {
        .clk_src = RMT_CLK_SRC_DEFAULT,
        .gpio_num = HP_PIN_WS2812_DATA,
        .mem_block_symbols = 64,
        .resolution_hz = WS_RES_HZ,
        .trans_queue_depth = 4,
    };
    ESP_ERROR_CHECK(rmt_new_tx_channel(&tx, &s_chan));
    ESP_ERROR_CHECK(ws_encoder_new(&s_encoder));
    ESP_ERROR_CHECK(rmt_enable(s_chan));

    /* Start with all pixels off. */
    honest_leds_set(0, 0, 0);
    ESP_LOGI(TAG, "WS2812C ring ready on IO%d (%d pixels)",
             HP_PIN_WS2812_DATA, HP_LED_RING_COUNT);
    return ESP_OK;
}

void honest_leds_set(uint8_t r, uint8_t g, uint8_t b)
{
    if (!s_chan || !s_encoder) return;
    uint8_t frame[HP_LED_RING_COUNT * 3];
    for (int i = 0; i < HP_LED_RING_COUNT; i++) {
        /* WS2812 order is G,R,B */
        frame[i * 3 + 0] = g;
        frame[i * 3 + 1] = r;
        frame[i * 3 + 2] = b;
    }
    rmt_transmit_config_t tx = { .loop_count = 0 };
    rmt_transmit(s_chan, s_encoder, frame, sizeof(frame), &tx);
    rmt_tx_wait_all_done(s_chan, 100);
}
