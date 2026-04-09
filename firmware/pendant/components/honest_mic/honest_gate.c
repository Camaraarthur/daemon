/*
 * Honest Puck v3.2 — honest_gate.c
 * See include/honest_gate.h for the WARNING block.
 *
 * Original to Honest Puck. MIT.
 */
#include "honest_gate.h"
#include "honest_puck_pins.h"

#include "driver/gpio.h"
#include "esp_log.h"
#include "esp_rom_sys.h"

static const char *TAG = "honest_gate";
static bool s_mic_on = false;

esp_err_t honest_gate_init(void)
{
    gpio_config_t io = {
        .pin_bit_mask = 1ULL << HP_PIN_MIC_ENABLE_N,
        .mode = GPIO_MODE_OUTPUT,
        .pull_up_en = GPIO_PULLUP_ENABLE,   /* belt-and-braces: rail off if pin floats */
        .pull_down_en = GPIO_PULLDOWN_DISABLE,
        .intr_type = GPIO_INTR_DISABLE,
    };
    esp_err_t err = gpio_config(&io);
    if (err != ESP_OK) return err;

    /* Drive HIGH *before* we ever say the pin is an output, by doing the
     * level set in a tight pair with the config above. */
    gpio_set_level(HP_PIN_MIC_ENABLE_N, 1);
    s_mic_on = false;

    ESP_LOGI(TAG, "Privacy interlock armed: IO%d driven HIGH (rail OFF)",
             HP_PIN_MIC_ENABLE_N);
    return ESP_OK;
}

void honest_gate_set_mic_power(bool on)
{
    gpio_set_level(HP_PIN_MIC_ENABLE_N, on ? 0 : 1);
    s_mic_on = on;
    /* Si2301BDS turn-on is ~100 ns; give the rail a few µs to settle
     * before anyone reads the mic. */
    esp_rom_delay_us(50);
    ESP_LOGI(TAG, "HONEST_MIC_PWR = %s", on ? "ON (recording)" : "OFF");
}

bool honest_gate_is_mic_powered(void) { return s_mic_on; }

void honest_gate_assert_off(void)
{
    int level = gpio_get_level(HP_PIN_MIC_ENABLE_N);
    if (level != 1) {
        ESP_LOGE(TAG, "INTERLOCK VIOLATION: IO%d=%d at assert_off()",
                 HP_PIN_MIC_ENABLE_N, level);
        abort();
    }
}
