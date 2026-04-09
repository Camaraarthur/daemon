idf_component_register(
    SRCS
        "honest_ble.c"
    INCLUDE_DIRS "include"
    REQUIRES honest_common bt
    PRIV_REQUIRES nvs_flash log
)
