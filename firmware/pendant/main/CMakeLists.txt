idf_component_register(
    SRCS "honest_puck_main.c"
    INCLUDE_DIRS "."
    REQUIRES honest_common honest_mic honest_ble honest_ui esp_timer nvs_flash
)
