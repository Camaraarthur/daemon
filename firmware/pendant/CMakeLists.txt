# Honest Puck v3.2 — ESP-IDF top-level project file
# Target: ESP-IDF v5.2, ESP32-S3-WROOM-1
#
# Forked from BasedHardware/omi (MIT) — see NOTICE.
cmake_minimum_required(VERSION 3.16)

set(EXTRA_COMPONENT_DIRS "components")

include($ENV{IDF_PATH}/tools/cmake/project.cmake)
project(honest_puck)
