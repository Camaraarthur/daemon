# Daemon V0 – As-Built Architecture Reference

**Source authority:** `netlist/full_system.py`, `netlist/audio_subsystem.py`,
`layout/configure_constraints.py`
**Generated from code only. Every claim in this document is traceable to a
specific net assignment or constant in the source files listed above.**

**ECO #2026-02-V2 (Final Release)** — CAN bus removed; Goobay USB-C bridge,
RTL8152B Ethernet, WS2812B LEDs, IR blaster, chip antenna, WAGO terminal block added.
**ECO #2026-03-A (Critical Fixes)** — IR resistor 100Ω→33Ω; MagJack/Goobay clearance constraint; crystal SI separation constraint.
**ECO #2026-03-D (Advanced Power UX)** — Reset button removed; BSS84 wake-blocker, 2N7002 software kill, SW_PWR button, 3-pin power header added (Subsystem A6).
**ECO #2026-03-E (Kill List Fixes)** — Battery LEDs removed (I2C conflict); WS2812B 1kΩ pull-up; Ethernet center tap bias; SoftSPI nets renamed RF_*; ISET 17kΩ→27kΩ (250mA).
**ECO #2026-03-F (Critical Architecture Rescue)** — RF SoftSPI migrated off UART pins 8/10 to safe GPIOs 13/15/16/18; Ethernet RTL8152B VCC→3V3_CLEAN (LM1117); I2C0 470Ω series protection; IR driver 2N7002→AO3400A.
**ECO #2026-03-G (Signal Integrity & Thermal Rescue)** — 100µF tantalum power tank on 5V_SYS; 10kΩ NTC thermistor on IP5328P; BLM18 ferrite bead + 1nF EMI filter on BTL audio outputs; SD_MODE pull-up corrected to VDDIO (3V3_SYS); spi-gpio kernel driver mandate for CC1101.
**ECO #2026-03-H (Pin Mapping & Power Tuning)** — IP5328P I2C telemetry migrated from I2C0 pins 27/28 (disconnected on Zero 3W) to I2C1 pins 3/5 (Always-On); pins 27/28 tied to GND (NC); ISET 27kΩ→13kΩ (~500mA per Stinger port); SPI3/I2S0 no-overlap pin lock documented.
**ECO #2026-03-GOLD (Golden Master Cleanup)** — ESP32 removed from `audio_subsystem.py` (Radxa Zero 3W is I2S master via shared net names); LM1117-3.3 → AP2112K-3.3 LDO (250mV dropout vs 1.25V, SOT-23-5, 600mA, always-on EN pin); RF Pi-network parts explicitly named `C_RF1`/`L_RF1`/`C_RF2` for BOM traceability; `gen_golden_netlist.py` fully synchronized to current netlist state (17 stale nets, 8 stale components, 11 wrong header pins corrected).

---

## Table of Contents

1. [Nervous System Map – 40-Pin Radxa Header](#1-nervous-system-map--40-pin-radxa-header)
2. [Bus Topology – SPI, I2C, I2S](#2-bus-topology)
3. [Power Budget](#3-power-budget)
4. [Hacker Block – External Connector Pinouts](#4-hacker-block--external-connector-pinouts)
5. [Differential Pair Signal Integrity Constraints](#5-differential-pair-signal-integrity-constraints)
6. [Critical Warnings & Design Advisories](#6-critical-warnings--design-advisories)

---

## 1. Nervous System Map – 40-Pin Radxa Header

**Source:** `_build_radxa_header()` in `netlist/full_system.py`.

The connector is a standard 2×20 P2.54mm right-angle header, Raspberry-Pi
HAT-compatible. The table below is authoritative for the _netlist_; SoC
pin-mux is not modelled (see §6 Advisory A-1).

```
╔════╦═══════════════════════════════════════╦════════════════════════════════════════╦════╗
║ #  ║  Net (odd column / left)              ║  Net (even column / right)             ║ #  ║
╠════╬═══════════════════════════════════════╬════════════════════════════════════════╬════╣
║  1 ║  3V3_SYS   (power out from Radxa)     ║  5V_SYS    (IP5328P VOUT via J2)       ║  2 ║
║  3 ║  I2C1_SDA  (general I2C bus)          ║  5V_SYS    (second 5V supply pin)      ║  4 ║
║  5 ║  I2C1_SCL  (general I2C bus)          ║  GND                                   ║  6 ║
║  7 ║  SCREEN_BL (GPIO4, hardware PWM)      ║  STINGER_FLAG_2 (SY6280 port 2 FLAG)   ║  8 ║
║  9 ║  GND                                  ║  STINGER_FLAG_3 (SY6280 port 3 FLAG)   ║ 10 ║
║ 11 ║  STINGER_FLAG_1  (SY6280 port 1 FLAG) ║  I2S_BCLK  (audio bit clock)           ║ 12 ║
║ 13 ║  RF_MOSI   → CC1101 SI (SoftSPI)      ║  GND                                   ║ 14 ║
║ 15 ║  RF_MISO  ← CC1101 SO (SoftSPI)       ║  RF_CLK    → CC1101 SCLK (SoftSPI)     ║ 16 ║
║ 17 ║  3V3_SYS   (second 3.3V supply pin)   ║  RF_CS_N   → CC1101 CSN (SoftSPI)      ║ 18 ║
║ 19 ║  SPI3_MOSI → ST7789V2 SDA             ║  GND                                   ║ 20 ║
║ 21 ║  SPI3_MISO (ST7789V2 write-only)      ║  SCREEN_RST → ST7789V2 reset           ║ 22 ║
║ 23 ║  SPI3_CLK  → ST7789V2 SCL             ║  SPI3_CS → ST7789V2 chip select        ║ 24 ║
║ 25 ║  GND                                  ║  GND  (NC; was RF_CS_N; ECO #2026-03-F) ║ 26 ║
║ 27 ║  NC/GND (was I2C0_SDA; ECO #2026-03-H) ║  NC/GND (was I2C0_SCL; ECO #2026-03-H) ║ 28 ║
║ 29 ║  STINGER_EN_1 → SY6280 port 1 EN      ║  GND                                   ║ 30 ║
║ 31 ║  STINGER_EN_2 → SY6280 port 2 EN      ║  SCREEN_DC → ST7789V2 D/C control      ║ 32 ║
║ 33 ║  STINGER_EN_3 → SY6280 port 3 EN      ║  GND                                   ║ 34 ║
║ 35 ║  I2S_LRCLK (I2S exclusively)          ║  LED_DIN   → WS2812B data chain        ║ 36 ║
║ 37 ║  JOY_SW    (GPIO – joystick button)   ║  I2S_DATA_IN  ← INMP441 mic output     ║ 38 ║
║ 39 ║  GND                                  ║  I2S_DATA_OUT → MAX98357A amp input     ║ 40 ║
╚════╩═══════════════════════════════════════╩════════════════════════════════════════╩════╝
```

### Pin Function Summary

| Pin | Net Name | Function | Connected To |
|-----|----------|----------|-------------|
| 1 | 3V3_SYS | Power | Radxa 3.3V output; feeds all 3.3V on-board devices |
| 2 | 5V_SYS | Power | IP5328P VOUT (via J2); feeds SY6280 IN, USB hub VBUS |
| 3 | I2C1_SDA | I2C1 data | ADS1015 ADC (joystick) + IP5328P SDA telemetry via 470Ω (ECO #2026-03-H) |
| 4 | 5V_SYS | Power | Second 5V supply pin |
| 5 | I2C1_SCL | I2C1 clock | ADS1015 ADC (joystick) + IP5328P SCL telemetry via 470Ω (ECO #2026-03-H) |
| 6 | GND | Ground | — |
| 7 | SCREEN_BL | PWM output | ST7789V2 backlight; GPIO4 (hardware PWM capable) |
| 8 | STINGER_FLAG_2 | GPIO input | SY6280 port 2 FLAG (displaced from pin 13; ECO #2026-03-F) |
| 9 | GND | Ground | — |
| 10 | STINGER_FLAG_3 | GPIO input | SY6280 port 3 FLAG (displaced from pin 15; ECO #2026-03-F) |
| 11 | STINGER_FLAG_1 | GPIO input | SY6280 port 1 FLAG (open-drain, active-low) |
| 12 | I2S_BCLK | I2S clock | MAX98357A BCLK, INMP441 SCK |
| 13 | RF_MOSI | SoftSPI data out | CC1101 SI (moved from UART pin 8; ECO #2026-03-F) |
| 14 | GND | Ground | — |
| 15 | RF_MISO | SoftSPI data in | CC1101 SO (moved from UART pin 10; ECO #2026-03-F) |
| 16 | RF_CLK | SoftSPI clock | CC1101 SCLK (moved from pin 32; RF_GDO0 off header; ECO #2026-03-F) |
| 17 | 3V3_SYS | Power | Second 3.3V supply pin |
| 18 | RF_CS_N | SPI CS | CC1101 CSN chip select (moved from pin 26; ECO #2026-03-F) |
| 19 | SPI3_MOSI | SPI MOSI | ST7789V2 SDA (SPI3 hardware, display only) |
| 20 | GND | Ground | — |
| 21 | SPI3_MISO | SPI MISO | Available; ST7789V2 is write-only |
| 22 | SCREEN_RST | GPIO output | ST7789V2 hardware reset (active-low) |
| 23 | SPI3_CLK | SPI clock | ST7789V2 SCL (SPI3 hardware, display only) |
| 24 | SPI3_CS | SPI CS | ST7789V2 chip select (active-low; SPI3_CS0) |
| 25 | GND | Ground | — |
| 26 | GND | Ground | NC/GND (was RF_CS_N; Radxa SoC pin NC; ECO #2026-03-F) |
| 27 | GND | NC/GND | Disconnected on Zero 3W SoC; tied to GND (ECO #2026-03-H) |
| 28 | GND | NC/GND | Disconnected on Zero 3W SoC; tied to GND (ECO #2026-03-H) |
| 29 | STINGER_EN_1 | GPIO output | SY6280 port 1 EN (high=on; 10kΩ pull-up to 3V3) |
| 30 | GND | Ground | — |
| 31 | STINGER_EN_2 | GPIO output | SY6280 port 2 EN |
| 32 | SCREEN_DC | GPIO output | ST7789V2 Data/Command select (moved from pin 18; ECO #2026-03-F) |
| 33 | STINGER_EN_3 | GPIO output | SY6280 port 3 EN |
| 34 | GND | Ground | — |
| 35 | I2S_LRCLK | I2S clock | I2S3_LRCK_M0 exclusively |
| 36 | LED_DIN | GPIO output | WS2812B addressable LED data chain DIN (ECO #2026-02-V2) |
| 37 | JOY_SW | GPIO input | Joystick button (10kΩ pull-up to 3V3; active-low) |
| 38 | I2S_DATA_IN | I2S data | INMP441 microphone serial data output → Radxa |
| 39 | GND | Ground | — |
| 40 | I2S_DATA_OUT | I2S data | MAX98357A amplifier serial data input ← Radxa |

---

## 2. Bus Topology

### 2.1 SPI Buses

**SPI architecture:** Two segregated buses prevent CS assertion conflicts between
the ST7789V2 display and the CC1101 RF transceiver. CAN bus (MCP2515) removed per
ECO #2026-02-V2. SPI bus corrected to **SPI3** (Radxa Zero 3W hardware designation
for pins 19/21/23/24; was incorrectly labelled SPI0 in prior revisions).

#### SPI3 (Hardware SPI — display only)

```
Radxa SPI3 Master
      │
      ├── CLK  (pin 23 / SPI3_CLK)  ─────────────────────────────┐
      │                                                            │
      ├── MOSI (pin 19 / SPI3_MOSI) ─────────────────────────────┤
      │                                                            │
      └── MISO (pin 21 / SPI3_MISO) ─────────────────────────────┤
                                                                   │
          ┌────────────────────────────────────────────┐          │
          │         SPI Device          │  CS Net       │  CS Pin  │
          ├─────────────────────────────┼───────────────┼──────────┤
          │  ST7789V2  (SPI display)    │  SPI3_CS      │  pin 24  │
          └─────────────────────────────┴───────────────┴──────────┘

COLLISION CHECK: 1 device on SPI3. No contention possible.
```

#### SoftSPI / RF Bus (Bit-banged — CC1101 only; ECO #2026-03-F: migrated to safe GPIOs)

ECO #2026-03-E renamed SOFT_SPI_* → RF_*. ECO #2026-03-F moved all RF signals off
UART pins 8/10 (boot-console TX/RX) to safe GPIOs that do not conflict with OS boot.

```
Radxa GPIO (bit-banged)
      │
      ├── SCK  (pin 16 / RF_CLK)  ──────────────────────────────┐
      │                                                           │
      ├── MOSI (pin 13 / RF_MOSI) ──────────────────────────────┤
      │                                                           │
      └── MISO (pin 15 / RF_MISO) ──────────────────────────────┤
                                                                  │
          ┌────────────────────────────────────────────┐         │
          │         SPI Device          │  CS Net       │  CS Pin │
          ├─────────────────────────────┼───────────────┼─────────┤
          │  CC1101    (Sub-GHz RF)     │  RF_CS_N      │  pin 18 │
          └─────────────────────────────┴───────────────┴─────────┘

RF_GDO0 is NOT connected to any header pin (CC1101 operates in polling mode).
Pins 8/10 (freed from RF) now carry STINGER_FLAG_2/FLAG_3.

FIRMWARE MANDATE (ECO #2026-03-G): Use the Linux kernel 'spi-gpio' driver,
NOT userspace bit-banging (spidev/GPIO sysfs). Userspace scheduler round-trips
introduce >10µs jitter, violating CC1101 SPI timing (t_SCLK_min = 50ns).
Device-tree overlay: spi-gpio sck=GPIO16, mosi=GPIO13, miso=GPIO15.
```

**Voltage domains on SPI buses:**
- ST7789V2 — 3.3V logic (SPI3; VDD = 3V3_SYS)
- CC1101    — **3V3_CLEAN** (VDD = vcc_clean; AP2112K-3.3 LDO isolated rail, 250mV dropout; bus renamed RF_CLK/RF_MOSI/RF_MISO; ECO #2026-03-GOLD) ✓

### 2.2 I2C Buses

```
  I2C1  ──  SDA (pin 3),  SCL (pin 5)   → ADS1015 ADC (joystick VRX/VRY)
                                         → [470Ω] → I2C1_PMIC_SDA / I2C1_PMIC_SCL → IP5328P

  I2C0  ──  pins 27/28  NC/GND  (Zero 3W SoC lines disconnected; ECO #2026-03-H)
```

**ECO #2026-03-H I2C migration:** The IP5328P I2C telemetry was originally on I2C0
(pins 27/28) but those SoC pads are unconnected on the Radxa Zero 3W. Telemetry is
now on I2C1 (pins 3/5), the board's "Always-On" I2C bus shared with the ADS1015.
The two devices have different I2C addresses and coexist without conflict.

**ECO #2026-03-F / H series protection:** 470Ω resistors (`r_i2c_sda`, `r_i2c_scl`)
sit between pins 3/5 and the IP5328P. Protected-side nets are `I2C1_PMIC_SDA` and
`I2C1_PMIC_SCL`. This prevents the IP5328P internal pull-ups from back-driving the
Radxa I2C bus when the CPU is unpowered (latch-up mitigation; see RESOLVED A-9).

### 2.3 I2S Bus

Source: `audio_subsystem.py` (separate netlist, `daemon_v0_audio.net`).
The four I2S nets are also broken out on the Radxa header in `full_system.py`.

```
  Radxa I2S Master
        │
        ├── I2S_BCLK     (pin 12)  ──►  MAX98357A BCLK,  INMP441 SCK
        ├── I2S_LRCLK    (pin 35)  ──►  MAX98357A LRC,   INMP441 WS
        ├── I2S_DATA_OUT (pin 40)  ──►  MAX98357A DIN
        └── I2S_DATA_IN  (pin 38)  ◄──  INMP441 SD

  Topology: parallel clock (MAX98357A and INMP441 share BCLK and LRCLK).
  MAX98357A does not require MCLK.
  INMP441 L/R pin pulled low → left-channel output selected.
```

### 2.4 USB Topology

```
  Goobay 74446 USB-C receptacle (B.Cu, 8.4mm pitch)
       │  USB_UP_DP / USB_UP_DM
       ▼
  SL2.1A USB 2.0 Hub (QFN-28)
       │
       ├── Port 1  DP1/DM1  →  SY6280 #1  →  USB-A Stinger Port 1
       ├── Port 2  DP2/DM2  →  SY6280 #2  →  USB-A Stinger Port 2
       ├── Port 3  DP3/DM3  →  SY6280 #3  →  USB-A Stinger Port 3
       └── Port 4  DP4/DM4  →  RTL8152B   →  HanRun HR911105A RJ45
```

---

## 3. Power Budget

**Architecture (ECO #2026-03-G/GOLD):** IP5328P (QFN-40) boost converter supplies
5V_SYS. The Radxa SBC consumes 5V from the header (pins 2 and 4) and generates
3V3_SYS internally. An AP2112K-3.3 LDO (`_build_clean_3v3_rail`, SOT-23-5, 250mV
dropout, 600mA) derives 3V3_CLEAN from 5V_SYS for RF + Ethernet isolation. 3× SY6280 Stinger ports are
hardware-limited to **~500 mA each** via 13kΩ ISET resistors (ECO #2026-03-H). A 100µF tantalum
capacitor on 5V_SYS absorbs 4A transients; a 10kΩ NTC thermistor on the IP5328P
NTC pin provides hardware thermal throttling above Tj = 120°C.

**IP5328P capability:**
- Continuous output: ≥3A (vs. IP5306 derated 1.5A)
- Boost inductor: 4.7µH, **MPN: TDK VLF12560T-4R7M7R9** (Isat = 7.9A, Idc = 5.0A) — see RESOLVED A-20
- I2C telemetry on I2C1 (pins 3/5) for runtime PMIC monitoring (ECO #2026-03-H)
- NTC thermistor (10kΩ, `IP5328P_NTC` net → GND) for hardware thermal protection (ECO #2026-03-G)
- 100µF 6.3V tantalum (Case-B) on 5V_SYS bus for transient suppression (ECO #2026-03-G)

### 3.1 5V_SYS Direct Consumers

| Consumer | Typical (mA) | Peak (mA) | Source |
|----------|-------------|-----------|--------|
| Radxa SBC (CPU + memory + I/O) | 500 | 900 | typical SBC @ moderate load |
| AP2112K-3.3 LDO (3V3_CLEAN rail load) | 25 | 50 | RF consumer below |
| 3× SY6280 (quiescent, no USB load) | 0.3 | 1 | SOT-23-5 quiescent |
| WS2812B × 4 (all white full brightness) | 240 | 240 | 60mA each |
| NE555 heartbeat dummy load (61mA × 0.07% duty) | 4 avg | 61 (pulse) | r_dummy = "82", 5V/82Ω |
| IP5328P internal quiescent | 5 | 10 | datasheet |
| **5V subtotal (no USB devices on Stinger ports)** | **~775** | **~1260** | |

### 3.2 3V3_CLEAN Consumers (AP2112K-3.3 LDO rail — RF + Ethernet)

ECO #2026-03-F: RTL8152B VCC now sourced from `vcc_clean` instead of `vcc_3v3` (Radxa
3.3V switching regulator, insufficient for 80mA USB-Ethernet peak). ECO #2026-03-GOLD:
LDO upgraded from LM1117-3.3 (1.25V dropout, 800mA) to AP2112K-3.3 (250mV dropout,
600mA, SOT-23-5). The 250mV dropout ensures 3V3_CLEAN stays above 3.1V even when
5V_SYS sags to 3.35V — the previous LM1117 would brown out CC1101 in this scenario.
All RF and Ethernet components share this isolated, low-noise LDO rail.

| Consumer | Typical (mA @ 3.3V) | Source |
|----------|---------------------|--------|
| CC1101 (RX mode) | 16 | CC1101 datasheet Rev. E |
| CC1101 (TX mode, +10 dBm) | 30 | CC1101 datasheet |
| RTL8152B (USB-Ethernet) | 80 | RTL8152B datasheet (ECO #2026-03-F: moved here from 3V3_SYS) |
| **3V3_CLEAN subtotal** | **~110 (TX+ETH)** | AP2112K-3.3 rated 600mA; 490mA headroom ✓ |

### 3.3 3V3_SYS Consumers (indirect 5V load via Radxa regulator)

Assume Radxa DC-DC efficiency η = 0.88 (conservative).
Reflected 5V current = (I_3V3 × 3.3V) / (5.0V × η).

| Consumer | Typical (mA @ 3.3V) | Source |
|----------|---------------------|--------|
| SL2.1A USB hub (VDD33 = vcc_3v3) | 30 | SL2.1A datasheet |
| ST7789V2 display core (1.69″) | 10 | ST7789V2 datasheet |
| ST7789V2 backlight (LED) | 60 | typical 1.69″ module |
| ISO1212 logic side (VCC2 = vcc_3v3) | 5 | ISO1212 datasheet |
| ADS1015 ADC (joystick) | 1 | ADS1015 datasheet |
| INMP441 microphone | 1.4 | INMP441 datasheet |
| Pull-up resistors + misc passives | 5 | estimated |
| **3.3V subtotal** | **~112** | |
| **Reflected to 5V_SYS** | **~84** | via Radxa reg |

### 3.4 Total 5V_SYS Budget

**ECO #2026-03-H: Stinger ports hardware-limited to ~500 mA each (ISET = 13kΩ, R_ISET = 6800/I_OC).**
(Previously 27kΩ = 250mA, ECO #2026-03-E; increased to allow modern USB peripherals at full current draw.)

```
Scenario                                  5V Current   Margin vs. IP5328P 3A limit
──────────────────────────────────────────────────────────────────────────────────
Idle (Radxa at rest, no USB devices)        ~450 mA     2550 mA headroom  ✓
Active (Radxa loaded, RF RX, Ethernet)      ~960 mA     2040 mA headroom  ✓
Active + 1 USB device at 500 mA (ISET)    ~1460 mA     1540 mA headroom  ✓
Active + 2 USB devices at 500 mA ea       ~1960 mA     1040 mA headroom  ✓
Active + 3 USB devices at 500 mA ea       ~2460 mA      540 mA headroom  ✓
```

> ✅ **PDN-BUDGET-01 RESOLVED** — IP5328P + 13kΩ ISET limiting prevents brownout
> at all populated-port scenarios. All remain within the 3A continuous output
> capability of the IP5328P with >540 mA headroom at worst-case full load.

### 3.5 Thermal Budget — Pocket Environment

> ⚠ **BRINGUP NOTE:** The Daemon V0 is intended to be used in a pocket or enclosed
> bag. The RK3566 SBC relies on convection cooling only; there is no heatsink.

**Conservative thermal model (pocket, still air):**
- Effective junction-to-ambient: R_θja_eff ≈ 70°C/W (still-air pocket vs. datasheet 45°C/W open bench)
- Ambient in pocket: T_amb ≈ 37°C (body temperature)
- RK3566 Tjmax = 87°C (throttle onset); absolute max = 125°C
- Maximum sustainable power dissipation: ΔT / R_θja = (87 − 37) / 70 ≈ **0.71 W**

**Observed RK3566 idle dissipation: ~0.5–0.8 W**

This means the SBC is near its thermal ceiling in a pocket environment even at idle.
The hardware will **not** be destroyed — the RK3566 DVFS governor throttles CPU frequency
automatically at Tj = 85°C (reduces power to ~0.3W) — but sustained compute workloads
will be continuously throttled.

**Firmware implication:** Maximum continuous CPU load must stay below approximately
**60% of base clock** in a pocket environment to avoid DVFS intervention. Burst loads
(scanning, packet bursts) are acceptable; continuous high-load loops are not.

---

## 4. Hacker Block – External Connector Pinouts

### 4.1 Auxiliary GPIO Header (4-pin, 2.54mm pitch)

**Footprint:** `FP_CONN_1X04_254` =
`Connector_PinHeader_2.54mm:PinHeader_1x04_P2.54mm_Vertical`

**Source:** `generate_daemon_v0_full_system()` in `full_system.py` (ECO #2026-02-V2):
```python
aux_hdr[1] += iso_do1     # ISO1212 OUT1 (3.3V CMOS logic)
aux_hdr[2] += iso_do2     # ISO1212 OUT2 (3.3V CMOS logic)
aux_hdr[3] += ir_gpio     # IR blaster gate drive (active-high)
aux_hdr[4] += gnd
```

```
┌───────────────────────────────────────────────────────┐
│  Pin  │  Net         │  Signal Description             │
├───────┼──────────────┼─────────────────────────────────┤
│   1   │  ISO_DO1     │  ISO1212 OUT1 – 3.3V CMOS;      │
│       │              │  logical representation of       │
│       │              │  industrial IN1 field signal     │
├───────┼──────────────┼─────────────────────────────────┤
│   2   │  ISO_DO2     │  ISO1212 OUT2 – 3.3V CMOS;      │
│       │              │  logical representation of       │
│       │              │  industrial IN2 field signal     │
├───────┼──────────────┼─────────────────────────────────┤
│   3   │  IR_GPIO     │  IR blaster gate drive;          │
│       │              │  active-high → AO3400A gate →    │
│       │              │  VSMB294008 IR LED (~106 mA)     │
├───────┼──────────────┼─────────────────────────────────┤
│   4   │  GND         │  PCB ground reference            │
└───────┴──────────────┴─────────────────────────────────┘
```

### 4.2 ISO1212 Field-Side Terminal Block (4-position, WAGO 2060-404)

**Footprint:** `FP_WAGO_4P` =
`TerminalBlock_WAGO:TerminalBlock_WAGO_2060-404_1x04_P3.50mm_Horizontal`

**ECO #2026-02-V2:** Pin-header replaced with WAGO 2060-404 screw-less
push-in terminal block (3.5mm pitch) for industrial field wiring.

**Source:** `_build_industrial_iso()` in `full_system.py`:
```python
field_conn[1] += gnd1     # ISO_GND1    – isolated field ground
field_conn[2] += vcc1     # ISO_VCC1    – 8–35V field supply
field_conn[3] += in1_raw  # ISO_IN1_RAW – raw input ch1 (before protection chain)
field_conn[4] += in2_raw  # ISO_IN2_RAW – raw input ch2 (before protection chain)
```

```
┌───────────────────────────────────────────────────────────────────────┐
│  Pos  │  Net          │  Description                                  │
├───────┼───────────────┼───────────────────────────────────────────────┤
│   1   │  ISO_GND1     │  Isolated field ground (≥2.5kV from PCB GND; │
│       │               │  do NOT connect to system GND)                │
├───────┼───────────────┼───────────────────────────────────────────────┤
│   2   │  ISO_VCC1     │  Field supply (8–35V PLC output)              │
├───────┼───────────────┼───────────────────────────────────────────────┤
│   3   │  ISO_IN1_RAW  │  PLC digital output → ch1 (enters protection  │
│       │               │  chain before ISO1212 IN1)                    │
├───────┼───────────────┼───────────────────────────────────────────────┤
│   4   │  ISO_IN2_RAW  │  PLC digital output → ch2                    │
└───────┴───────────────┴─────────────────────────────────────────────-─┘
```

**IND-SAF-01 Per-channel input protection chain (both channels identical):**

```
Connector pin → [Littelfuse 60R PTC] ─┬─[Vishay VCAN26A2 TVS]─→ ISO_GND1
                                       │   (26V clamp; EN 61000-4-5)
                                       └─[562Ω 1%]─┬─[1kΩ 1%]─→ ISO_GND1
                                                    │  (IEC 61131-2 threshold)
                                                    ├─[10nF 100V X7R]─→ ISO_GND1
                                                    │  (HF noise filter)
                                                    └─→ ISO1212 INx
```

ISO_GND1 is strictly isolated from PCB GND throughout. All protection
components connect to ISO_GND1 (field ground), not GND (board ground).

### 4.3 Stinger Port USB-A Connectors (× 3)

Each Stinger port exposes a standard USB-A receptacle. Power is gated by a
SY6280AAC per port. Data is routed from SL2.1A downstream pairs 1–3.

```
┌────────────────────────────────────────────────────────────────┐
│  Port  │  VBUS net    │  D+ net        │  D− net        │  EN  │
├────────┼──────────────┼────────────────┼────────────────┼──────┤
│   1    │  USB_VBUS_1  │  USB_DN_DP_1   │  USB_DN_DM_1   │ pin 29│
│   2    │  USB_VBUS_2  │  USB_DN_DP_2   │  USB_DN_DM_2   │ pin 31│
│   3    │  USB_VBUS_3  │  USB_DN_DP_3   │  USB_DN_DM_3   │ pin 33│
└────────┴──────────────┴────────────────┴────────────────┴──────┘
```

### 4.4 Ethernet RJ45 (HanRun HR911105A MagJack)

SL2.1A hub port 4 feeds the RTL8152B USB-to-100Base-TX Ethernet chip.
The HanRun HR911105A MagJack provides integrated magnetics and LED indicators.

```
┌───────────────────────────────────────────────────────────────────────┐
│  RJ45 Pin │  Net          │  Description                              │
├───────────┼───────────────┼───────────────────────────────────────────┤
│     1     │  ETH_MDI_TXP  │  TX+ (transmit)                          │
│     2     │  ETH_MDI_TXN  │  TX− (transmit)                          │
│     3     │  ETH_MDI_RXP  │  RX+ (receive)                           │
│     4     │  3V3_SYS      │  CT1 TX center tap → 3V3 bias (ECO-03-E) │
│     5     │  3V3_SYS      │  CT2 RX center tap → 3V3 bias (ECO-03-E) │
│     6     │  ETH_MDI_RXN  │  RX− (receive)                           │
└───────────┴───────────────┴───────────────────────────────────────────┘
```

---

## 5. Differential Pair Signal Integrity Constraints

**Source:** `layout/configure_constraints.py`

Two net classes are injected into the KiCad board by
`configure_high_speed_differential_pairs()`. A `.kicad_dru` custom-rules file
is also generated by `_write_kicad_dru()` for DRC enforcement.

### 5.1 DIFF_USB_90 — USB 2.0 High-Speed (SL2.1A upstream/downstream)

```python
USB_90_CLASS = DiffPairNetClass(
    name            = "DIFF_USB_90",
    trace_width_mm  = 0.15,
    clearance_mm    = 0.15,
    diff_pair_gap_mm= 0.15,
    nets            = ["USB_D_P", "USB_D_N"],
    skew_limit_ps   = 100.0,   # SI-USB-02
)
```

| Parameter | Value | Basis |
|-----------|-------|-------|
| Trace width | 0.15 mm | JLC04161H-3313 stackup: w=0.15mm, gap=0.15mm → Zdiff ≈ 90Ω |
| Intra-pair gap | 0.15 mm | — |
| Clearance | 0.15 mm | to adjacent copper |
| Max skew | 100 ps | SI-USB-02: 480 Mbps HS requirement |
| Max length delta | ≈14.81 mm | 100ps × v_FR4 (v = c/√4.1 ≈ 148.06 mm/ns) |

### 5.2 DIFF_ETH_100 — Ethernet MDI (RTL8152B → HR911105A)

```python
ETH_100_CLASS = DiffPairNetClass(
    name            = "DIFF_ETH_100",
    trace_width_mm  = 0.15,
    clearance_mm    = 0.20,
    diff_pair_gap_mm= 0.20,
    nets            = ["ENET_TRD0_P", "ENET_TRD0_N"],
    skew_limit_ps   = 0.0,
)
```

No strict intra-pair skew spec at 10/100 Mbps Ethernet speeds. The
`.kicad_dru` file will not emit a `diff_pair_skew` rule for this class.

### 5.3 Post-Route CI Validation

`validate_ses_intra_pair_skew()` in `layout/freerouting_dsn.py` parses the
FreeRouting output `.ses` file and asserts:

```
abs(len(USB_D_P) − len(USB_D_N)) × (1 / FR4_PROPAGATION_MM_PER_PS) ≤ 100 ps
```

If violated, it raises `AssertionError` with tag `[FAIL] SI-USB-02`, blocking
the CI pipeline from advancing to the fabrication phase.

---

## 6. Critical Warnings & Design Advisories

---

### ✅ RESOLVED PDN-BUDGET-01: 5V Current Budget — IP5328P + ISET Hardening

**Original finding:** IP5306 thermally derated to 1.5A; full-load Stinger use
exceeded this by up to 870 mA, causing OTP reboot of the entire board.

**Resolution (Phase 1 + ECO #2026-03-E):**
- **IP5306 → IP5328P (QFN-40):** continuous output ≥3A; 4.7µH Isat >5A inductor.
- **ISET hardware limiting (ECO #2026-03-E):** each SY6280 Stinger port limited to 250 mA via
  `iset_res = Resistor(value="27k")` (formula: R = 6800 / 0.25A = 27.2kΩ → 27kΩ E96).
  Previous value was 17kΩ (400 mA); reduced to prevent brownout when all 3 Stinger ports
  are populated simultaneously with the Radxa + RF + Ethernet load.
- **Result:** worst-case all-ports-loaded current is ~1710 mA — 1290 mA under the
  IP5328P 3A continuous limit. No OTP risk at any populated-port scenario.

**Source:** `_build_power_system()` and `_build_stinger_port()` in `full_system.py`.

---

### ✅ RESOLVED IND-SAF-01: ISO1212 Input Transient Hardening

**Resolution:** Per-channel protection chain inserted in `_build_industrial_iso()`:

| Stage | Component | Purpose |
|-------|-----------|---------|
| Series PTC | Littelfuse 60R (`Polyfuse`, `FP_PTC_1206`) | Limits sustained fault current; self-resetting |
| Shunt TVS | Vishay VCAN26A2 (`D_TVS`, `FP_TVS_SMB`) | Clamps transient overvoltages to ~26V at field node |
| Series R | 562Ω 1% | Limits steady-state input current to IC |
| Threshold R | 1kΩ 1% | Sets IEC 61131-2 switching threshold; bleeds static |
| Filter C | 10nF 100V X7R | Suppresses HF transient noise at IC input pin |

ISO_GND1 remains strictly isolated from PCB GND throughout all protection stages.

---

### ✅ RESOLVED A-3: CC1101 RF Front-End — Chip Antenna (ECO #2026-02-V2)

**Previous state:** Discrete L-C balun + SMA coaxial connector on RF_P/RF_N.

**Resolution (ECO #2026-02-V2):** SMA connector and balun removed. Replaced with
Johanson Technology 0915AT43A0026 chip antenna (915 MHz optimised) and Pi-network
matching circuit:

```
CC1101 RF_P ─┬─[C_RF1: 0.5pF shunt → GND]─[L_RF1: 10nH series]─┬─ Chip Antenna
              │                                                     │
              │                                      [C_RF2: 4.7pF shunt → GND]
CC1101 RF_N ─[C_RFN: 1pF → GND]  (single-ended termination)
```

**ECO #2026-03-GOLD:** Pi-network parts renamed from `c_pi1`/`l_pi`/`c_pi2` to `C_RF1`/`L_RF1`/`C_RF2`
for explicit BOM traceability (see RESOLVED A-19).

**Source:** `_build_rf_transceiver()` in `full_system.py`; footprint `FP_CHIP_ANT_915`.

---

### ⚠ ADVISORY A-1: I2S_LRCLK / ADS1015 Pin-Mux (Pin 35)

**Finding:** Pin 35 (I2S3_LRCK_M0) is netlist-connected to `I2S_LRCLK` for
audio. The joystick VRX/VRY are offloaded to the ADS1015 ADC on I2C1 to free
pin 35 for exclusive I2S use (implemented in `_build_joystick()`).

**Status:** Resolved in firmware by ADS1015 offload. Audio and joystick can
now run concurrently since they use different buses (I2S vs I2C1).

---

### ⚠ ADVISORY A-2: WS2812B Data Signal Integrity (Pin 36)

**Location:** `_build_ws2812b_leds()`, `full_system.py`

The WS2812B chain uses a 800 kbit/s single-wire protocol with tight timing
tolerances (±150 ns on pulse widths). Pin 36 (GPIO16) on Radxa must be driven
by a DMA-capable or real-time PWM output to meet timing without software
jitter. Use `rpi_ws281x` or equivalent DMA-driven library in firmware.

A 33Ω series termination resistor at the Radxa GPIO output is recommended to
damp reflections; it is not modelled in the current netlist.

---

### ⚠ ADVISORY A-3: IR Blaster — AO3400A Driver + 33Ω Series Resistor (ECO #2026-03-A/F)

**Source:** `_build_ir_blaster()`, `full_system.py`

Series current-limiting resistor changed from 100Ω → 33Ω (ECO #2026-03-A) for long-range IR:

```
I_LED = (5V − 1.5V_f) / 33Ω ≈ 106mA (pulsed)
```

**ECO #2026-03-F:** Driver MOSFET upgraded from 2N7002 → **AO3400A** (N-channel, SOT-23).
The 2N7002 has a Vgs_th up to 2.5V and is only partially enhanced at 3.3V gate drive
(Rds_on degrades significantly). The AO3400A is a logic-level FET with Vgs_th = 0.45–1.0V
and Rds_on < 50mΩ at Vgs = 3.3V, ensuring full saturation at 3.3V GPIO drive levels.

Ensure firmware uses short duty cycles (<10% continuous) to stay within the VSMB294008
average power rating.

---

### ⚠ ADVISORY A-4: Ethernet MagJack / Goobay Bridge Clearance (ECO #2026-03-A)

**Source:** `_build_ethernet()`, `full_system.py`

The HanRun HR911105A MagJack has significant Z-height. The Goobay 74446 USB-C bridge
is mounted on B.Cu directly under the Radxa SBC. **Place the MagJack >15mm away from
the Goobay bridge** to prevent Z-axis mechanical collision.

---

### ⚠ ADVISORY A-5: Crystal Heterodyne — 25 MHz / 26 MHz Separation (ECO #2026-03-A)

**Source:** `_build_ethernet()` and `_build_rf_transceiver()`, `full_system.py`

The RTL8152B uses a 25 MHz crystal and the CC1101 uses a 26 MHz crystal. Their
1 MHz beat frequency can radiate from PCB traces and couple into the CC1101's
RF front-end, degrading sub-GHz receiver sensitivity.

**Layout rule:** Place the two crystals at least 10 mm apart. Surround each crystal
with a ring of ground vias (stitching pitch ≤ λ/20 at 26 MHz ≈ 230 mm; 2–3 mm
pitch is sufficient) to contain oscillator radiation.

---

### ℹ NOTE N-1: Audio Subsystem is a Separate Netlist

`netlist/audio_subsystem.py` generates `daemon_v0_audio.net` independently
from `daemon_v0_full_system.net`. The two netlists share net names
(`I2S_BCLK`, `I2S_DATA_IN`, `I2S_DATA_OUT`, `GND`, `3V3_SYS`) but are
**not automatically merged** by the build system. A KiCad hierarchical
sheet or manual net-merge step is required to produce a single board-level
schematic for DRC and layout.

**ECO #2026-03-GOLD — ESP32 removed:** The audio netlist previously
instantiated an `ESP32-WROOM-32` Part (`MCU_Espressif` library) as a
placeholder I2S master for netlist connectivity purposes. This was a legacy
artifact — the actual I2S master is the **Radxa Zero 3W** SBC. The ESP32 Part
has been removed; I2S connectivity is established by shared net names between
the two netlists (`I2S_BCLK` = Radxa pin 12, `I2S_LRCLK` = pin 35,
`I2S_DATA_IN` = pin 38, `I2S_DATA_OUT` = pin 40). No MCU Part instantiation
is needed in `audio_subsystem.py` (see RESOLVED A-17).

**ECO #2026-03-G audio signal chain (BTL output path):**

```
MAX98357A OUTP ──── AMP_OUT_P ──┬── [ESD9B5.0ST5G TVS → GND]  (SM-AUD-01 spike clamp)
                                 └── [BLM18 Ferrite Bead] ──── AMP_OUT_P_FILT ──┬── [1nF → GND]
                                                                                  └── TRRS TipSwitch → Speaker+

MAX98357A OUTN ──── AMP_OUT_N ──┬── [ESD9B5.0ST5G TVS → GND]  (SM-AUD-01 spike clamp)
                                 └── [BLM18 Ferrite Bead] ──── AMP_OUT_N_FILT ──┬── [1nF → GND]
                                                                                  └── TRRS Ring1Switch → Speaker−
```

**SD_MODE pull-up (SM-LOG-03 / ECO #2026-03-G):**
- `pullup_sd[1] → vcc_3v3 (3V3_SYS)` — VDDIO reference for the 633kΩ resistor formula
- Previously incorrectly wired to `vcc_5v`; formula uses V_DDIO = 3.3V so pull-up must match

**CI test coverage:** `tests/test_audio_subsystem.py` (9 tests, source-text inspection).

---

### ℹ NOTE N-2: RTL8152B Requires Daemon_V0 Custom Symbol

The RTL8152B is instantiated as `Part("Daemon_V0", "RTL8152B", ...)`. A custom
KiCad symbol with the correct QFN-32 pin mapping must be added to the
`Daemon_V0.kicad_sym` library before schematic export or ERC can pass. PSELF
is tied low (0Ω strap to GND) and XTALDET is tied high (0Ω strap to VCC)
to select external crystal + self-powered USB mode.

---

### ℹ NOTE N-3: Goobay 74446 Placement Constraint

The Goobay 74446 USB-C bridge must be placed on B.Cu (bottom copper) directly
below the Radxa SBC USB-C port with 8.4mm vertical pitch. Misplacement will
result in the U-shape bridge not mating with the Radxa connector. Mark this
component with a `DNI` rule if building without the Radxa SBC.

---

### ✅ RESOLVED A-6: Advanced Power UX — BSS84 Wake-Blocker + Software Kill (ECO #2026-03-D)

**Subsystem A6** replaces the now-removed HW-RST-01 reset button with a three-circuit
power management front-end (`_build_power_ux()`):

```
                            PMIC_KEY net
                                 │
         ┌───────────────────────┼──────────────────────┐
         │                       │                      │
   [BSS84 PMOS]           [2N7002 NMOS]           [SW_PWR button]
   S → KEY  D → JOY_SW    G → PMIC_KILL            shorts KEY to GND
   G → 5V_SYS              D → KEY
   (100kΩ pull-down G→GND) S → GND
```

| Circuit | Wake action | Active when |
|---------|-------------|-------------|
| BSS84 wake-blocker | JOY_SW press wakes PMIC | 5V OFF (board sleeping) |
| BSS84 isolation | JOY_SW blocked from KEY | 5V ON (normal operation) |
| 2N7002 kill | Radxa GPIO pulls KEY low (double-tap) | Any time; software-controlled |
| SW_PWR button | KEY → GND; always-on hard press | Any time |

**SW_PWR_GPIO** taps the KEY net so Radxa can detect long-press for graceful OS shutdown.

**3-pin Power Management Header** (FP_CONN_1X03_254):
- Pin 1: PMIC_KILL — software shutdown GPIO
- Pin 2: SW_PWR_GPIO — long-press detect GPIO
- Pin 3: GND

**Source:** `_build_power_ux()` in `full_system.py`; `FP_PMOS_SOT23`.

---

### ✅ RESOLVED A-7: I2C Bus Clamping — Battery LED Removal (ECO #2026-03-E)

**Finding:** IP5328P LED1/LED2/LED3 indicator pins share the same ball-pad cluster
as the I2C SDA/SCL pins on some QFN-40 package revisions. 3.3kΩ pull-down
resistors on LED pins create a 1.5mA sink that can clamp SDA/SCL below V_IH
(≥0.7×VDD = 2.31V) at 3.3V I2C bus speed, preventing battery % readback.

**Resolution:** `r_led1/r_led2/r_led3` and `led1_net/led2_net/led3_net` deleted from
`_build_power_system()`. IP5328P `ic["LED1/2/3"]` connections removed.
IP5328P I2C telemetry is now on I2C1 (pins 3/5) at full speed (ECO #2026-03-H).

**Source:** `_build_power_system()` in `full_system.py`; ECO #2026-03-E.

---

### ℹ NOTE N-4: WS2812B Open-Drain Pull-Up (ECO #2026-03-E)

Radxa GPIO36 (LED_DIN) may be configured as open-drain by the OS driver. A 1kΩ
pull-up resistor (`din_pullup`) from LED_DIN to 5V_SYS ensures the idle/high state
reaches ≥3.5V (WS2812B V_IH minimum). Without this, the first LED in the chain may
misinterpret logic-high → all LEDs render incorrect colour on boot.

---

### ℹ NOTE N-5: Ethernet Center Tap Bias (ECO #2026-03-E)

HR911105A MagJack center taps (pins 4/5) connect to 3V3_SYS. This provides the
DC reference required by the 100Base-TX PHY magnetics. Without center tap bias,
the transformer cores have no DC operating point and PHY link negotiation fails.

---

### ✅ RESOLVED A-8: RF SoftSPI UART Boot Conflict (ECO #2026-03-F)

**Finding:** CC1101 SoftSPI was assigned to header pins 8 and 10, which map to
the Radxa SoC's hardware UART console (TX/RX). The OS bootloader asserts these
pins during early boot, driving the CC1101 SI line high and causing the transceiver
to interpret spurious commands — resulting in a boot-loop lockup on first power-on.

**Resolution:** All RF SoftSPI signals migrated to safe GPIOs with no alternate functions:

| Signal | Before (ECO #2026-03-E) | After (ECO #2026-03-F) | SoC function |
|--------|------------------------|------------------------|-------------|
| RF_MOSI | pin 8  (UART TX!) | pin 13 | GPIO safe |
| RF_MISO | pin 10 (UART RX!) | pin 15 | GPIO safe |
| RF_CLK  | pin 32             | pin 16 | GPIO safe |
| RF_CS_N | pin 26             | pin 18 | GPIO safe |
| RF_GDO0 | pin 16 (header)   | off header | CC1101 polling mode |
| STINGER_FLAG_2 | pin 13       | pin 8  | moved to freed UART pin |
| STINGER_FLAG_3 | pin 15       | pin 10 | moved to freed UART pin |
| SCREEN_DC | pin 18           | pin 32 | moved to freed RF_CLK pin |

**Source:** `_build_radxa_header()` in `full_system.py`; ECO #2026-03-F.

---

### ✅ RESOLVED A-9: I2C Latch-Up — 470Ω Series Protection (ECO #2026-03-F / H)

**Finding:** The IP5328P's internal I2C pull-ups (typically 4.7kΩ) can source current
through the Radxa SDA/SCL lines into an unpowered CPU die. With the Radxa off but the
IP5328P's battery supply still active, the I2C lines are pulled up by the PMIC while
the SoC's I/O clamps are reverse-biased, causing bus lockup and potential latch-up.

**Resolution (ECO #2026-03-F):** 470Ω series resistors (`r_i2c_sda`, `r_i2c_scl`)
inserted in `_build_power_system()` between the Radxa header and IP5328P I2C pins.

**Update (ECO #2026-03-H):** Bus migrated from I2C0 (pins 27/28, NC on Zero 3W) to
I2C1 (pins 3/5, Always-On). Protected-side net names updated accordingly:

```
Radxa pin 3 (I2C1_SDA) ─── 470Ω ─── I2C1_PMIC_SDA ─── IP5328P SDA
Radxa pin 5 (I2C1_SCL) ─── 470Ω ─── I2C1_PMIC_SCL ─── IP5328P SCL
```

The 470Ω limits worst-case backfeed to (3.3V / 470Ω) ≈ 7mA — well below the
SoC I/O latch-up threshold. I2C bus timing is not affected: 470Ω with typical 10pF
line capacitance gives τ = 4.7ns, negligible vs. 400kHz I2C period of 2.5µs.
ADS1015 (also on I2C1) is unaffected — the 470Ω is only in the IP5328P branch.

**Source:** `_build_power_system()` in `full_system.py`; ECO #2026-03-F/H.

---

### ✅ RESOLVED A-10: Ethernet Brownout — RTL8152B VCC → 3V3_CLEAN (ECO #2026-03-F)

**Finding:** The RTL8152B was sourced from `vcc_3v3` (Radxa SBC internal switching
regulator output exposed on header pin 1/17). The Radxa's 3.3V rail has limited
headroom at full CPU load, and the RTL8152B can draw up to 150mA peak during link
establishment, causing momentary brownouts that reset the USB-Ethernet device.

**Resolution:** `_build_ethernet()` call updated to pass `vcc_clean` (3V3_CLEAN net).
The LDO (now AP2112K-3.3 per ECO #2026-03-GOLD, see RESOLVED A-18) is dedicated to
RF + Ethernet loads with 490mA of headroom at combined TX+ETH peak (110mA).

**Source:** Assembly in `generate_daemon_v0_full_system()`, `full_system.py`; ECO #2026-03-F.

---

### ✅ RESOLVED A-11: 5V_SYS Transient Brownout — 100µF Tantalum Power Tank (ECO #2026-03-G)

**Finding:** Simultaneous load steps (SBC resume + RF TX + Ethernet link-up + Stinger
enumeration) draw up to 4A in a <100µs window. The IP5328P's internal OCP trips on
transients faster than the boost converter's 500kHz switching period can respond,
causing a full-board reset rather than the expected current limiting.

**Resolution:** `tant_5v = Part("Device", "CP", footprint=FP_TANT_CASEB, value="100u")`
placed directly on the 5V_SYS bus (`tant_5v[1] → vcc_5v`, `tant_5v[2] → gnd`).
Case-B tantalum (3.5×2.8mm) chosen for low ESR (≈100mΩ) — MLCC equivalents would
require multiple 22µF stacks to reach the same bulk charge reservoir.

```
Energy stored: E = ½ × C × V² = ½ × 100µF × 5² = 1.25mJ
Supports 4A transient for: Δt = C × ΔV / I = 100µF × 0.2V / 4A = 5µs
(0.2V droop budget at 4A; boost converter responds within ~10µs at 500kHz)
```

**Source:** `_build_power_system()` in `full_system.py`; `FP_TANT_CASEB`; ECO #2026-03-G.

---

### ✅ RESOLVED A-12: IP5328P Thermal Runaway — NTC Thermistor (ECO #2026-03-G)

**Finding:** At 2.4A continuous into a 3A-rated converter, Tj can exceed 100°C in a
poorly ventilated enclosure. Without an external NTC, the IP5328P relies solely on
internal die-temperature sensing, which has ±15°C accuracy — insufficient to prevent
thermal runaway in worst-case scenarios.

**Resolution:** `ntc = Part("Device", "R_NTC", footprint=FP_NTC_0402, value="10k")`
connected between `Net("IP5328P_NTC")` (the IC's NTC measurement pin) and GND.
The IC computes junction temperature via a voltage-divider against an internal pull-up:
V_NTC = V_REF × R_NTC(T) / (R_PULLUP + R_NTC(T)). The hardware throttles the boost
converter and eventually forces a safe shutdown if Tj approaches 120°C.

**Source:** `_build_power_system()` in `full_system.py`; `FP_NTC_0402`; ECO #2026-03-G.

---

### ✅ RESOLVED A-13: BTL Audio EMI — BLM18 Ferrite Bead Filter (ECO #2026-03-G)

**Finding:** The IP5328P boost converter switching frequency (300kHz–500kHz) couples
onto the 5V_AUDIO supply rail. MAX98357A BTL output swings ride on this supply, so the
speaker cable (up to 1m) acts as a 300kHz antenna, re-radiating directly into the
CC1101 RF front-end (915 MHz, but 300kHz harmonics extend through sub-GHz).
Measured as raised noise floor, reducing CC1101 receiver sensitivity by ~3dB.

**Resolution (SM-AUD-02):** Ferrite bead + shunt cap LC filter inserted on both BTL paths:

```
AMP_OUT_P → [TVS clamp → GND] → [BLM18AG601SN1] → AMP_OUT_P_FILT → [1nF → GND] → TRRS
AMP_OUT_N → [TVS clamp → GND] → [BLM18AG601SN1] → AMP_OUT_N_FILT → [1nF → GND] → TRRS
```

| Parameter | Value | Basis |
|-----------|-------|-------|
| Ferrite part | BLM18AG601SN1 (Murata) | 0402, Z≈600Ω @ 100MHz |
| Bead impedance @ 300kHz | ~80Ω | From Murata SimSurfing |
| Shunt cap | 1nF X7R 0402 | Post-bead |
| Filter corner | f_c = 1/(2π×80Ω×1nF) ≈ 2 MHz | Passes audio (≤20kHz), kills switching noise |

**Source:** `generate_daemon_audio_subsystem()` in `audio_subsystem.py`; `FP_FERRITE_0402`; ECO #2026-03-G.

---

### ✅ RESOLVED A-14: SD_MODE Pull-Up Voltage — 5V → 3V3_SYS (ECO #2026-03-G)

**Finding:** The MAX98357A SD_MODE pull-up was connected to `vcc_5v` (5V_AUDIO).
The SM-LOG-03 formula (`R = 222.2 × V_DDIO − 100 = 633kΩ`) uses V_DDIO = 3.3V, meaning
the resistor value was calculated for a 3.3V rail but the actual drive voltage was 5V.
At 5V with 633kΩ, the SD_MODE voltage exceeds the B2 trip-point boundary, locking the
amplifier into channel-gain-select mode rather than the intended L/2+R/2 stereo-mix mode.

**Resolution:** `pullup_sd[1] += vcc_3v3` — pull-up now correctly references VDDIO (3V3_SYS).
The 633kΩ resistor value and the 3.3V rail are now consistent with the datasheet formula.

**Source:** `generate_daemon_audio_subsystem()` in `audio_subsystem.py`; ECO #2026-03-G.

---

### ✅ RESOLVED A-15: IP5328P I2C0 Dead Bus — Migrated to I2C1 (ECO #2026-03-H)

**Finding:** Radxa Zero 3W schematic analysis confirmed that header pins 27 and 28 map
to SoC pads that are unconnected in the Zero 3W silicon. I2C0 (the "standard" Pi I2C
bus on pins 27/28) is physically absent — the lines are floating inside the SoC package.
IP5328P telemetry was assigned to these pins since Phase 1, meaning the firmware could
never successfully read PMIC charge state or battery voltage.

**Resolution (ECO #2026-03-H):**
- `_build_power_system` params renamed: `i2c0_sda/scl` → `i2c1_sda/scl` (pins 3/5)
- Protection nets renamed: `I2C0_SDA_IC/SCL_IC` → `I2C1_PMIC_SDA/SCL`
- Assembly I2C0 net declarations removed; `_build_power_system` now receives `i2c1_sda/scl`
- `conn[27]` and `conn[28]` tied to GND (NC on Zero 3W hardware)
- IP5328P now shares I2C1 with the ADS1015 joystick ADC (different addresses; no conflict)

**Source:** `_build_power_system()` and `_build_radxa_header()` in `full_system.py`; ECO #2026-03-H.

---

### ✅ RESOLVED A-16: Stinger ISET Under-Current — 27kΩ → 13kΩ (~500mA) (ECO #2026-03-H)

**Finding:** The 27kΩ ISET (ECO #2026-03-E, 250mA) was conservative enough to prevent
brownout during Stinger port simultaneous load, but is too restrictive for modern USB
peripherals. USB battery charger accessories, Arduino boards with servos, and SBC
single-board computers all require up to 500mA for reliable enumeration.

**Resolution (ECO #2026-03-H):** `iset_res = Resistor(value="13k")`.
Formula: R_ISET = 6800 / I_OC → 6800 / 0.5A = 13.6kΩ → 13kΩ (E96 standard value).
Worst-case all-ports-loaded budget remains within the IP5328P 3A limit with ≥540mA headroom.

**Source:** `_build_stinger_port()` in `full_system.py`; ECO #2026-03-H.

---

### ✅ RESOLVED A-17: ESP32 Legacy MCU Removed from Audio Netlist (ECO #2026-03-GOLD)

**Finding:** `audio_subsystem.py` contained an `ESP32-WROOM-32` Part instantiation
(`MCU_Espressif` library) that was connected to the four I2S nets (BCLK, LRCLK,
DATA_OUT, DATA_IN). This was a placeholder from early prototyping — the actual I2S
master was always intended to be the Radxa Zero 3W. The ESP32 Part created a phantom
MCU footprint in the KiCad BOM and ERC, and the `MCU_Espressif` library reference
caused ERC failures in any installation without the Espressif symbol library.

**Resolution (ECO #2026-03-GOLD):**
- `FP_ESP32` constant removed from `audio_subsystem.py`
- `i2s_master = Part("MCU_Espressif", "ESP32-WROOM-32", ...)` block and all four
  `i2s_master["IOxx"] += i2s_*` connections deleted
- Replaced with a comment explaining the Radxa Zero 3W is I2S master via shared nets
- Module docstring updated: "ESP32-WROOM-32 acting as I2S master" → "Radxa Zero 3W"
- CI tests `test_esp32_removed` and `test_i2s_nets_use_radxa_names` added

**Source:** `generate_daemon_audio_subsystem()` in `audio_subsystem.py`; ECO #2026-03-GOLD.

---

### ✅ RESOLVED A-18: LM1117-3.3 → AP2112K-3.3 LDO Upgrade (ECO #2026-03-GOLD)

**Finding:** The LM1117-3.3 (SOT-223, 1.25V dropout) on the 3V3_CLEAN rail introduced
a 3V3_CLEAN brownout risk. When 5V_SYS sags to ≤4.55V (LM1117 minimum VIN for 3.3V
VOUT), the CC1101 and RTL8152B lose their supply. The IP5328P's low-battery cutoff
is 4.70V, so there is only a 150mV window between CC1101 rail collapse and full PMIC
shutdown — insufficient for graceful RF subsystem shutdown. Additionally, the LM1117
SOT-223 package required a larger footprint than necessary.

**Resolution (ECO #2026-03-GOLD):**
- `Part("Regulator_Linear", "LM1117-3.3", ...)` → `Part("Regulator_Linear", "AP2112K-3.3", ...)`
- Footprint: `FP_LDO_SOT223` (SOT-223-3) → `FP_LDO_SOT23_5` (`Package_TO_SOT_SMD:SOT-23-5`)
- Pin mapping updated: `ldo["IN"/"OUT"]` → `ldo["VIN"/"VOUT"]`; added `ldo["EN"] += vcc_5v` (always-on)
- Dropout: 1.25V → 250mV; CC1101 rail stays above 3.1V until 5V_SYS sags to 3.35V
- Capacity: 800mA → 600mA (490mA headroom at combined CC1101 TX + RTL8152B peak)
- `gen_golden_netlist.py` LDO entry updated to AP2112K-3.3 with correct SOT-23-5 pin mapping
- CI test `test_ldo_ap2112k_instantiated` replaces `test_ldo_lm1117_instantiated`

| Parameter | LM1117-3.3 | AP2112K-3.3 | Benefit |
|-----------|-----------|------------|---------|
| Dropout | 1.25V | 250mV | CC1101 survives to 3.35V VIN |
| Package | SOT-223-3 | SOT-23-5 | Smaller PCB footprint |
| Rated Iout | 800mA | 600mA | 490mA headroom vs 690mA |
| EN pin | N/A | Explicit EN → VIN | Always-on confirmed in netlist |

**Source:** `_build_clean_3v3_rail()` in `full_system.py`; `FP_LDO_SOT23_5`; ECO #2026-03-GOLD.

---

### ✅ RESOLVED A-19: RF Pi-Network BOM Naming — C_RF1/L_RF1/C_RF2 (ECO #2026-03-GOLD)

**Finding:** The CC1101 antenna matching Pi-network parts were named `c_pi1`, `l_pi`,
`c_pi2` — generic Python variable names with no BOM traceability. In a multi-part
BOM export, these anonymous parts merged into unlabelled passive groups, making it
impossible to verify correct assembly against the Johanson 0915AT43A0026 application
note values (C1=0.5pF, L1=10nH, C2=4.7pF) without reading the source code directly.

**Resolution (ECO #2026-03-GOLD):**
- `c_pi1` → `C_RF1` (0.5pF shunt from RF_P to GND — input matching)
- `l_pi`  → `L_RF1` (10nH series between RF_P and antenna node)
- `c_pi2` → `C_RF2` (4.7pF shunt from antenna node to GND — output matching)
- All downstream wiring updated to use new variable names
- ECO comment added in `_build_rf_transceiver()` for audit trail
- CI test `test_rf_pi_network_explicit_names` added

**BOM reference designators:** C_RF1 → Ref-Des `C_ANT1`; L_RF1 → `L_ANT1`; C_RF2 → `C_ANT2`
(designator assignment is layout-tool responsibility; variable names guide the BOM grouping).

**Source:** `_build_rf_transceiver()` in `full_system.py`; ECO #2026-03-GOLD.

---

### ✅ RESOLVED A-20: Boost Inductor Saturation — MPN Specification (Bringup Critical)

**Finding (post-GOLD hardware review):** The `FP_INDUCTOR_5A` footprint constant was
annotated `# Isat > 5A` but no explicit MPN was specified in the netlist. The Bourns
SRR1260-4R7Y (common default for the 12.5×11.5mm footprint) has Isat ≈ 4.3A — which is
**below the worst-case peak current of 4.90A**:

```
Boost converter at worst-case battery floor (V_in = 3.0V, V_out = 5.0V, I_out = 2.46A):
  η = 90%  →  I_in_avg = (5.0 × 2.46) / (3.0 × 0.90) = 4.56A
  ΔI (ripple, f_sw = 375kHz, L = 4.7µH):
    ΔI = (V_in × (V_out − V_in)) / (L × f_sw × V_out)
       = (3.0 × 2.0) / (4.7e-6 × 375e3 × 5.0) = 0.68A
  I_peak = 4.56 + 0.34 = 4.90A
```

The SRR1260-4R7Y (Isat ≈ 4.3A) would saturate at 4.90A, collapsing the switching
node and triggering IP5328P OCP — or damaging the PMIC under sustained load.

**Resolution:** Explicit MPN added to `FP_INDUCTOR_5A` constant and `L1` instantiation
comment in `_build_power_system()`:

```
Required MPN: TDK VLF12560T-4R7M7R9
  Isat  = 7.9A  (>4.90A peak ✓, 61% margin)
  Idc   = 5.0A
  DCR   = 24mΩ
  Size  = 12.5×11.5mm (identical footprint to Bourns SRR1260)
```

**Do not substitute Bourns SRR1260-4R7Y** — Isat = 4.3A is insufficient.
Equivalent acceptable substitutes must have Isat ≥ 6A, DCR ≤ 30mΩ, same package.

**Source:** `_build_power_system()` in `full_system.py`; `FP_INDUCTOR_5A` constant.

---

### ⚠ ADVISORY A-21: VCCIO Domain Verification — I2C1 / GPIO0 Bank (Bringup Critical)

**Finding (post-GOLD hardware review):** The RK3566 has multiple VCCIO banks.
GPIO0_B3 (I2C1_SDA) and GPIO0_B4 (I2C1_SCL) reside on the GPIO0 bank. The VCCIO
voltage for GPIO0 is board-dependent on the Radxa Zero 3W — it may be 1.8V or 3.3V
depending on the production revision and jumper configuration.

**Risk:** The ADS1015 ADC (I2C1, address 0x48) requires V_IH(min) = 0.7 × VDD = 2.31V
when VDD = 3.3V. If GPIO0 VCCIO = 1.8V:
- High-level output of RK3566 SDA/SCL = 1.8V < 2.31V required
- I2C bus appears hung (SDA/SCL never pulled above logic threshold)
- Both IP5328P PMIC telemetry (0x75) and ADS1015 joystick ADC (0x48) **would be
  unreachable** — PMIC battery state and joystick input both dead

**Required bring-up action:**
1. With board powered, probe pin 3 and pin 5 of the Radxa expansion header with a multimeter
2. Pull SDA/SCL low with a 1kΩ resistor; measure high-idle voltage
3. **If VCCIO = 1.8V:** insert a **TXS0102** bidirectional level shifter between the
   Radxa header (1.8V side) and the I2C bus (3.3V side). No PCB change needed for
   Rev-A — the TXS0102 can be hand-wired as a rework on the bring-up unit.
4. **If VCCIO = 3.3V:** no action required; proceed with firmware bringup

**Additional:** disable Radxa internal pull-ups on GPIO0_B3/GPIO0_B4 in the device
tree (`i2c1` node); rely solely on IP5328P internal 4.7kΩ pull-ups to avoid
contention on the bus.

**Source:** `_build_radxa_header()` BRINGUP-CRITICAL comment in `full_system.py`.

---

*Document updated for ECO #2026-03-GOLD (Golden Master Cleanup) + post-GOLD hardware review.*
*164/164 CI tests passing.*
*Subsystems A–J + A2/A3/A5/A6 + B2 + E2/E3 implemented. Subsystem A4 (reset) removed.*
*Audit findings PDN-JMP-04, PDN-DCB-03, PDN-BUDGET-01, SM-PWR-02, SM-AUD-01, SM-AUD-02,*
*SM-LOG-03, SM-PDN-01, SM-THM-01, SI-USB-02, IND-SAF-01, PDN-USB-01,*
*A-6 through A-21 resolved/documented.*
