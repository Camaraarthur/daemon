idf_component_register(
    SRCS
        "honest_buttons.c"
        "honest_leds.c"
        "honest_ui.c"
    INCLUDE_DIRS "include"
    REQUIRES honest_common
    PRIV_REQUIRES driver esp_driver_rmt esp_timer log
)
