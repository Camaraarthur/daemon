#include "honest_ui.h"
#include "esp_err.h"

esp_err_t honest_buttons_init(honest_btn_cb_t);
esp_err_t honest_leds_init(void);

esp_err_t honest_ui_init(honest_btn_cb_t cb)
{
    esp_err_t err = honest_leds_init();
    if (err != ESP_OK) return err;
    return honest_buttons_init(cb);
}
