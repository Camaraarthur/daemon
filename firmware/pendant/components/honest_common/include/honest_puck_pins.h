/*
 * Honest Puck v3.2 — pin map.
 *
 * Source of truth: /media/arthur/CA2247E02247D05D/projects/pendant/ARCHITECTURE.md
 * Do not change numbers here without also changing the KiCad netlist.
 */
#pragma once

#include "driver/gpio.h"

/* ---- Buttons (all active-low, external 10k pull-ups on the board) ---- */
#define HP_PIN_BTN_MAIN      GPIO_NUM_0   /* strapping — normal boot needs HIGH */
#define HP_PIN_BTN_PROG1     GPIO_NUM_1
#define HP_PIN_BTN_BATT      GPIO_NUM_9
#define HP_PIN_BTN_PROG2     GPIO_NUM_14

/* ---- Privacy interlock: Si2301BDS PMOS gate (ACTIVE LOW) ----
 * HIGH = mic VDD off + red LEDs off (rail dead).
 * LOW  = mic VDD on  + red LEDs lit (user is being recorded).
 * MUST be HIGH at boot. See components/honest_mic/honest_gate.c. */
#define HP_PIN_MIC_ENABLE_N  GPIO_NUM_4

/* ---- PDM microphone (IM73D122) ---- */
#define HP_PIN_PDM_CLK       GPIO_NUM_5
#define HP_PIN_PDM_DATA      GPIO_NUM_6

/* ---- LED boost enable (TPS61023) — powers WS2812C ring ----
 * Active high, 100k pull-down. */
#define HP_PIN_LED_BOOST_EN  GPIO_NUM_7

/* ---- WS2812C-2020 privacy LED ring (4 pixels, single data line) ---- */
#define HP_PIN_WS2812_DATA   GPIO_NUM_8
#define HP_LED_RING_COUNT    4

/* ---- QSPI NAND flash (W25N02KV) — handled by SPI bus driver ---- */
#define HP_PIN_FLASH_CS      GPIO_NUM_10
#define HP_PIN_SPI_MOSI      GPIO_NUM_11
#define HP_PIN_SPI_CLK       GPIO_NUM_12
#define HP_PIN_SPI_MISO      GPIO_NUM_13
#define HP_PIN_QSPI_IO2      GPIO_NUM_2
#define HP_PIN_QSPI_IO3      GPIO_NUM_3
