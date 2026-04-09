idf_component_register(
    SRCS
        "honest_gate.c"
        "honest_mic.c"
    INCLUDE_DIRS "include"
    REQUIRES honest_common
    PRIV_REQUIRES driver esp_driver_i2s log
)
