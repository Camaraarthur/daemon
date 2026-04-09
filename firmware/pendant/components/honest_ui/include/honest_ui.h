/*
 * Honest Puck v3.2 — user interface (4 side buttons + 4 WS2812C red LEDs).
 * Original to Honest Puck. MIT.
 *
 * Note: the LED ring IS NOT software-controlled brightness or colour in
 * any meaningful sense — the LEDs are wired downstream of the Si2301BDS
 * gate and are red-only hardware. Calling honest_leds_set() writes to the
 * WS2812C controller, but if honest_gate_is_mic_powered() is false, the
 * LEDs will physically not light regardless of what we write.
 */
#pragma once

#include "esp_err.h"
#include <stdbool.h>
#include <stdint.h>

typedef void (*honest_btn_cb_t)(bool pressed);

/* Registers callback for BTN_MAIN presses (debounced).
 * Other buttons are read-only via honest_ui_button_level(). */
esp_err_t honest_ui_init(honest_btn_cb_t main_button_cb);

/* 1 = pressed (pin driven low by user), 0 = released. */
int honest_ui_button_level(int which /* 0=main 1=prog1 2=batt 3=prog2 */);

/* Program the 4 WS2812C pixels (R, G, B each 0..255).
 * Typical use: honest_leds_set(255, 0, 0) for "I am recording".
 * When the rail is dead this call is a no-op visually. */
void honest_leds_set(uint8_t r, uint8_t g, uint8_t b);
