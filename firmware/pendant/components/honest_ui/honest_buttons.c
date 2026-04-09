/*
 * Honest Puck v3.2 — button debouncer.
 *
 * 4 active-low side-mount tactile switches with external 10k pull-ups.
 * BTN_MAIN is on IO0 (strapping pin) so we don't touch it until AFTER boot.
 *
 * Debounce strategy: GPIO ISR -> task notification -> 25 ms settle -> read.
 * Original to Honest Puck. MIT.
 */
#include "honest_ui.h"
#include "honest_puck_pins.h"

#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "driver/gpio.h"
#include "esp_log.h"

static const char *TAG = "honest_btn";
static honest_btn_cb_t s_main_cb = NULL;
static TaskHandle_t s_task = NULL;

static const gpio_num_t s_pins[4] = {
    HP_PIN_BTN_MAIN, HP_PIN_BTN_PROG1, HP_PIN_BTN_BATT, HP_PIN_BTN_PROG2
};

static void IRAM_ATTR btn_isr(void *arg)
{
    BaseType_t hpw = pdFALSE;
    vTaskNotifyGiveFromISR(s_task, &hpw);
    if (hpw) portYIELD_FROM_ISR();
}

static void btn_task(void *arg)
{
    int last_main = 1;
    while (1) {
        ulTaskNotifyTake(pdTRUE, portMAX_DELAY);
        vTaskDelay(pdMS_TO_TICKS(25));  /* debounce */
        int m = gpio_get_level(HP_PIN_BTN_MAIN);
        if (m != last_main) {
            last_main = m;
            /* active-low: pressed = 0 */
            if (s_main_cb) s_main_cb(m == 0);
        }
    }
}

esp_err_t honest_buttons_init(honest_btn_cb_t cb)
{
    s_main_cb = cb;

    gpio_config_t in = {
        .pin_bit_mask =
            (1ULL << HP_PIN_BTN_MAIN)  |
            (1ULL << HP_PIN_BTN_PROG1) |
            (1ULL << HP_PIN_BTN_BATT)  |
            (1ULL << HP_PIN_BTN_PROG2),
        .mode = GPIO_MODE_INPUT,
        .pull_up_en = GPIO_PULLUP_ENABLE,   /* backup to external 10k */
        .pull_down_en = GPIO_PULLDOWN_DISABLE,
        .intr_type = GPIO_INTR_ANYEDGE,
    };
    esp_err_t err = gpio_config(&in);
    if (err != ESP_OK) return err;

    xTaskCreate(btn_task, "honest_btn", 3072, NULL, 6, &s_task);

    gpio_install_isr_service(0);
    for (int i = 0; i < 4; i++) {
        gpio_isr_handler_add(s_pins[i], btn_isr, NULL);
    }
    ESP_LOGI(TAG, "Buttons armed on IO0/IO1/IO9/IO14");
    return ESP_OK;
}

int honest_ui_button_level(int which)
{
    if (which < 0 || which > 3) return -1;
    return gpio_get_level(s_pins[which]) == 0 ? 1 : 0;
}
