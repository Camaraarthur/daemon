# Honest Puck v3.2 — firmware

Privacy-first wearable microphone pendant. ESP32-S3-WROOM-1. ESP-IDF v5.2.

This tree is a fork/rewrite of
[BasedHardware/omi](https://github.com/BasedHardware/omi) `omiGlass/firmware/`
(MIT). The upstream was Arduino + PlatformIO and assumed a Seeed XIAO
ESP32-S3 Sense board with built-in camera. We keep the BLE audio protocol
and the PDM capture pattern, strip the camera + display + all Arduino
dependencies, and target bare ESP-IDF with NimBLE. See [`NOTICE`](NOTICE) for
the per-file credit map.

## What runs on the board

```
app_main()
  |
  |-- honest_gate_init()         IO4 HIGH => mic VDD = 0 V, red LEDs dark
  |-- nvs + NimBLE stack
  |-- honest_ui_init()           buttons + WS2812C RMT driver
  |-- honest_ble_init()          GATT server: Omi audio service (19B10000-...)
  |-- boot self-test             pulse rail ON for 150 ms, then OFF
  |-- idle
        ^
        |  BTN_MAIN press OR BLE control write 0x01
        v
  honest_gate_set_mic_power(true)    IO4 LOW  => mic + LEDs hot
  honest_mic_start()                 i2s_pdm RX @ 16 kHz/16-bit/mono
    -> every 100 ms frame ->
  honest_ble_send_audio_pcm()        Omi framing, notify on AudioData char
```

## Hardware privacy interlock (the whole point)

The mic VDD and the four red WS2812C LEDs share a single copper net that
is the drain of a Si2301BDS PMOS load switch gated by IO4. There is **no**
software path that can record without lighting the ring. See the WARNING
block in
[`components/honest_mic/include/honest_gate.h`](components/honest_mic/include/honest_gate.h)
and the boot self-test in `main/honest_puck_main.c`.

## Pin map

From
[`/media/arthur/CA2247E02247D05D/projects/pendant/ARCHITECTURE.md`](../../)
— see `components/honest_common/include/honest_puck_pins.h`.

| GPIO  | Function                                 |
|-------|------------------------------------------|
| IO0   | BTN_MAIN (strapping, normal boot = HIGH) |
| IO1   | BTN_PROG1                                |
| IO4   | MIC_ENABLE_N (Si2301BDS PMOS gate)       |
| IO5   | PDM_CLK                                  |
| IO6   | PDM_DATA                                 |
| IO7   | LED_BOOST_EN (TPS61023)                  |
| IO8   | WS2812C data (4 pixels)                  |
| IO9   | BTN_BATT                                 |
| IO14  | BTN_PROG2                                |
| IO10-13, IO2, IO3 | QSPI NAND flash (W25N02KV) (driver not yet wired) |

## Build

Requires ESP-IDF **v5.2** (tested against the release/v5.2 branch).

```bash
. $IDF_PATH/export.sh
cd /home/arthur/daemon/firmware/pendant
idf.py set-target esp32s3
idf.py build
# then on the MSI box that has the serial cable:
idf.py -p /dev/ttyACM0 flash monitor
```

`sdkconfig.defaults` enables NimBLE, octal PSRAM (flip to
`CONFIG_SPIRAM_MODE_QUAD` if your WROOM-1 is the R2 variant, not R8), and
the new I2S driver. No menuconfig steps are required for a first build.

## BLE protocol (client side)

Exactly matches the Omi audio subset:

- Service UUID       `19B10000-E8F2-537E-4F6C-D104768A1214`
- Audio data (notify) `19B10001-...` — 2-byte index + 1-byte sub-index + payload
- Audio codec (read)  `19B10002-...` — one byte; **currently `0` (PCM16)**
- Control (write)     `19B10006-...` — `0x01` = start recording, `0x00` = stop

The daemon Android app (`/home/arthur/daemon/android/`) already speaks Omi
so the only thing it needs to learn is that codec id `0` means raw 16-bit
little-endian PCM at 16 kHz, mono. No changes to pairing or discovery.

## Deliberate decisions made without asking

1. **Codec is raw PCM16, not Opus.** To keep the dep graph MIT/Apache only
   and to guarantee a clean first `idf.py build`, we do not pull libopus.
   The framing and the GATT layout are unchanged, so switching is a
   one-file swap inside `honest_ble_send_audio_pcm()`. Flagged below.
2. **No photo characteristics.** omi uses `19B10005/6` for JPEG transfer.
   The pendant has no camera, so these are removed entirely (not
   advertised, not mounted).
3. **No OTA characteristics.** `19B10010/11/12` removed. The partition
   table still reserves two OTA slots so this can be added later without
   a factory reflash.
4. **No photo button, no camera pins, no OLED** — all stripped from
   omiGlass. ~3000 lines of `app.cpp` became ~150 lines of `honest_ble.c`.
5. **Integer mic gain ×2** kept from upstream as a reasonable default.
6. **Buttons wake the CPU from light sleep implicitly** via GPIO ISR. Deep
   sleep wake-on-button is NOT configured — see below.

## What is NOT done (known limits)

- **Opus encoding** — codec id is PCM16. A 32 kbps Opus path exists in
  upstream and is a straightforward port once libopus or a managed
  component is added.
- **Firmware OTA over BLE** — upstream has a full WiFi+HTTP OTA path
  (`src/ota.cpp`, 408 lines). Partition table has two OTA slots but the
  service is not implemented.
- **Deep sleep + wake-on-button** — the pendant boots straight into idle.
  No light/deep sleep entry, no RTC GPIO wake.
- **W25N02KV NAND driver** — pins are reserved but there is no SPI NAND
  init, no offline recording buffer, no wear levelling.
- **Battery monitoring** — `BTN_BATT` is polled by `honest_ui_button_level()`
  but there is no ADC-based battery voltage reading. The pendant has a
  TP4056 + TPS63031 rail so we'd need a divider added on a spare ADC pin,
  which is not in the current netlist.
- **Audio compression tuning** — no DC blocking filter, no AGC, no noise
  gate.
- **BLE pairing / encryption** — currently no bonding. Any central can
  connect. Fine for bench, not fine for shipping.
- **WS2812 self-test robustness** — the boot self-test just pulses the
  rail for 150 ms; it does not read back current draw or verify the RMT
  TX actually completed. A hardware interlock test jig is the proper fix.
- **Build has not been executed on this machine** (no ESP-IDF v5.2 in
  path). Source is believed to compile clean against release/v5.2 but has
  not been proven — see "Untested" below.

## Untested

- `idf.py build` has not been run. The code targets ESP-IDF v5.2 APIs
  (`driver/i2s_pdm.h`, `driver/rmt_tx.h`, NimBLE host on `bt` component)
  which all exist in v5.2. Most likely breakage would be a missing
  `REQUIRES` entry or an RMT encoder field rename.
- No hardware has been flashed. User will flash from MSI.

## Repo layout

```
pendant/
  CMakeLists.txt                    top-level IDF project
  sdkconfig.defaults                flash/psram/BLE/I2S defaults
  partitions.csv                    (using built-in "two_ota" table)
  LICENSE                           MIT
  NOTICE                            per-file credit to BasedHardware/omi
  README.md
  main/
    CMakeLists.txt
    honest_puck_main.c              boot order + recording FSM
  components/
    honest_common/                  shared pin map header
    honest_mic/
      honest_gate.c                 Si2301BDS IO4 interlock
      honest_mic.c                  i2s_pdm RX task
    honest_ui/
      honest_buttons.c              debounce ISR + task
      honest_leds.c                 WS2812C RMT driver
      honest_ui.c                   init glue
    honest_ble/
      honest_ble.c                  NimBLE GATT + Omi framing
```

## License

MIT. Upstream is MIT. See `LICENSE` + `NOTICE`.
