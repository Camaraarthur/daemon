/*
 * Honest Puck v3.2 — hardware privacy interlock.
 *
 * ============================================================================
 *  WARNING — SAFETY-CRITICAL
 * ============================================================================
 *  The IM73D122 PDM microphone AND the four WS2812C red privacy LEDs share
 *  ONE copper net, HONEST_MIC_PWR, which is the drain of a Si2301BDS PMOS
 *  load switch whose gate is IO4 (HP_PIN_MIC_ENABLE_N).
 *
 *    IO4 HIGH  ->  PMOS off  ->  HONEST_MIC_PWR = 0 V
 *                                 mic VDD = 0 V  (no clock can toggle)
 *                                 LED anodes = 0 V  (cannot light)
 *
 *    IO4 LOW   ->  PMOS on   ->  HONEST_MIC_PWR = ~3.296 V
 *                                 mic is recording
 *                                 LEDs are lit (hardware-forced)
 *
 *  There is NO software path that can power the microphone without also
 *  powering the red LEDs. The interlock is routed in copper on the PCB and
 *  verified by boot self-test (see honest_puck_main.c -> "LED self-test").
 *
 *  Because the LEDs are on the switched rail, the WS2812C data line (IO8)
 *  is meaningless while the rail is dead — any code that writes to the
 *  RMT driver in that window is a no-op from the outside world's view.
 *
 *  DO NOT:
 *    - Add a second path to mic VDD.
 *    - Power the LEDs from 3V3_SYS instead of HONEST_MIC_PWR.
 *    - Skip honest_gate_assert_off() after boot.
 *    - Flip IO4 low except from honest_gate_set_mic_power(true).
 * ============================================================================
 */
#pragma once

#include "esp_err.h"
#include <stdbool.h>

/* Configure IO4 as a push-pull output driven HIGH (mic off).
 * Must be the first hardware call in app_main(). */
esp_err_t honest_gate_init(void);

/* true  -> gate LOW, rail hot, mic recording, red LEDs lit
 * false -> gate HIGH, rail dead, mic silent, red LEDs dark */
void honest_gate_set_mic_power(bool on);

/* Returns whether the rail is currently commanded on. */
bool honest_gate_is_mic_powered(void);

/* Panic if the gate is not HIGH. Called right after init as a sanity check. */
void honest_gate_assert_off(void);
