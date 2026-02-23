# Daemon V0 – As-Built Architecture Reference

**Source authority:** `netlist/full_system.py`, `netlist/audio_subsystem.py`,
`layout/configure_constraints.py`
**Generated from code only. Every claim in this document is traceable to a
specific net assignment or constant in the source files listed above.**

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

**Source:** `_build_radxa_header()` in `netlist/full_system.py`, lines 606–738
(post Subsystem H/I/J expansion).

The connector is a standard 2×20 P2.54mm right-angle header, Raspberry-Pi
HAT-compatible. The table below is authoritative for the _netlist_; SoC
pin-mux is not modelled (see §6 Advisory A-1).

```
╔════╦═══════════════════════════════════════╦════════════════════════════════════════╦════╗
║ #  ║  Net (odd column / left)              ║  Net (even column / right)             ║ #  ║
╠════╬═══════════════════════════════════════╬════════════════════════════════════════╬════╣
║  1 ║  3V3_SYS   (power out from Radxa)     ║  5V_SYS    (IP5306 VOUT via J2)        ║  2 ║
║  3 ║  I2C1_SDA  (general I2C bus)          ║  5V_SYS    (second 5V supply pin)      ║  4 ║
║  5 ║  I2C1_SCL  (general I2C bus)          ║  GND                                   ║  6 ║
║  7 ║  JOY_VRX   (ADC – joystick X axis)    ║  UART_TX   (spare)                     ║  8 ║
║  9 ║  GND                                  ║  UART_RX   (spare)                     ║ 10 ║
║ 11 ║  STINGER_FLAG_1  (SY6280 port 1 FLAG) ║  I2S_BCLK  (audio bit clock)           ║ 12 ║
║ 13 ║  STINGER_FLAG_2  (SY6280 port 2 FLAG) ║  GND                                   ║ 14 ║
║ 15 ║  STINGER_FLAG_3  (SY6280 port 3 FLAG) ║  RF_GDO0   → CC1101 packet interrupt   ║ 16 ║
║ 17 ║  3V3_SYS   (second 3.3V supply pin)   ║  SCREEN_DC → ST7789V2 D/C control      ║ 18 ║
║ 19 ║  SPI0_MOSI → Screen / CC1101 / MCP2515║  GND                                   ║ 20 ║
║ 21 ║  SPI0_MISO ← CC1101 SO / MCP2515 SO   ║  SCREEN_RST → ST7789V2 reset           ║ 22 ║
║ 23 ║  SPI0_SCK  → Screen / CC1101 / MCP2515║  SCREEN_CS → ST7789V2 chip select      ║ 24 ║
║ 25 ║  GND                                  ║  RF_CS_N   → CC1101 chip select (CSN)  ║ 26 ║
║ 27 ║  I2C0_SDA  → IP5328P telemetry SDA    ║  I2C0_SCL  → IP5328P telemetry SCL     ║ 28 ║
║ 29 ║  STINGER_EN_1 → SY6280 port 1 EN      ║  GND                                   ║ 30 ║
║ 31 ║  STINGER_EN_2 → SY6280 port 2 EN      ║  SCREEN_BL → ST7789V2 backlight PWM    ║ 32 ║
║ 33 ║  STINGER_EN_3 → SY6280 port 3 EN      ║  GND                                   ║ 34 ║
║ 35 ║  JOY_VRY   (ADC – joystick Y axis)    ║  CAN_CS_N  → MCP2515 chip select       ║ 36 ║
║ 37 ║  JOY_SW    (GPIO – joystick button)   ║  I2S_DATA_IN  ← INMP441 mic output     ║ 38 ║
║ 39 ║  GND                                  ║  I2S_DATA_OUT → MAX98357A amp input     ║ 40 ║
╚════╩═══════════════════════════════════════╩════════════════════════════════════════╩════╝
```

### Pin Function Summary

| Pin | Net Name | Function | Connected To |
|-----|----------|----------|-------------|
| 1 | 3V3_SYS | Power | Radxa 3.3V output; feeds all 3.3V on-board devices |
| 2 | 5V_SYS | Power | IP5306 VOUT (via J2); feeds SY6280 IN, USB hub VBUS |
| 3 | I2C1_SDA | I2C1 data | Broken out; no on-board I2C slaves in this netlist |
| 4 | 5V_SYS | Power | Second 5V supply pin |
| 5 | I2C1_SCL | I2C1 clock | Broken out; no on-board I2C slaves in this netlist |
| 6 | GND | Ground | — |
| 7 | JOY_VRX | Analog in | Joystick X axis → Radxa ADC |
| 8 | UART_TX | UART | Spare; no on-board connection |
| 9 | GND | Ground | — |
| 10 | UART_RX | UART | Spare; no on-board connection |
| 11 | STINGER_FLAG_1 | GPIO input | SY6280 port 1 FLAG (open-drain, active-low) |
| 12 | I2S_BCLK | I2S clock | MAX98357A BCLK, INMP441 SCK |
| 13 | STINGER_FLAG_2 | GPIO input | SY6280 port 2 FLAG |
| 14 | GND | Ground | — |
| 15 | STINGER_FLAG_3 | GPIO input | SY6280 port 3 FLAG |
| 16 | RF_GDO0 | GPIO input | CC1101 GDO0 (configurable: packet-received interrupt) |
| 17 | 3V3_SYS | Power | Second 3.3V supply pin |
| 18 | SCREEN_DC | GPIO output | ST7789V2 Data/Command select |
| 19 | SPI0_MOSI | SPI MOSI | ST7789V2 SDA, CC1101 SI, MCP2515 SI |
| 20 | GND | Ground | — |
| 21 | SPI0_MISO | SPI MISO | CC1101 SO, MCP2515 SO (ST7789V2 is write-only) |
| 22 | SCREEN_RST | GPIO output | ST7789V2 hardware reset (active-low) |
| 23 | SPI0_SCK | SPI clock | ST7789V2 SCL, CC1101 SCLK, MCP2515 SCK |
| 24 | SCREEN_CS | SPI CS | ST7789V2 chip select (active-low) |
| 25 | GND | Ground | — |
| 26 | RF_CS_N | SPI CS | CC1101 CSN chip select (active-low) |
| 27 | I2C0_SDA | I2C0 data | IP5328P SDA telemetry (PMIC power/charge state over I2C) |
| 28 | I2C0_SCL | I2C0 clock | IP5328P SCL telemetry |
| 29 | STINGER_EN_1 | GPIO output | SY6280 port 1 EN (high=on; 10kΩ pull-up to 3V3) |
| 30 | GND | Ground | — |
| 31 | STINGER_EN_2 | GPIO output | SY6280 port 2 EN |
| 32 | SCREEN_BL | PWM output | ST7789V2 backlight (GPIO12 / PWM0) |
| 33 | STINGER_EN_3 | GPIO output | SY6280 port 3 EN |
| 34 | GND | Ground | — |
| 35 | JOY_VRY | Analog in | Joystick Y axis → Radxa ADC (⚠ mux: see §6 A-1) |
| 36 | CAN_CS_N | SPI CS | MCP2515 chip select (active-low) |
| 37 | JOY_SW | GPIO input | Joystick button (10kΩ pull-up to 3V3; active-low) |
| 38 | I2S_DATA_IN | I2S data | INMP441 microphone serial data output → Radxa |
| 39 | GND | Ground | — |
| 40 | I2S_DATA_OUT | I2S data | MAX98357A amplifier serial data input ← Radxa |

---

## 2. Bus Topology

### 2.1 SPI Bus (SPI0)

All three SPI peripherals share a single 3-wire SPI bus (SCK/MOSI/MISO) on
header pins 23/19/21. Each device has a unique, dedicated chip select.

```
Radxa SPI0 Master
      │
      ├── SCK  (pin 23 / SPI0_SCK)  ──────────────────────────────┐
      │                                                             │
      ├── MOSI (pin 19 / SPI0_MOSI) ──────────────────────────────┤
      │                                                             │
      └── MISO (pin 21 / SPI0_MISO) ──────────────────────────────┤
                                                                    │
          ┌─────────────────────────────────────────────┐          │
          │         SPI Device          │  CS Net        │  CS Pin  │
          ├─────────────────────────────┼────────────────┼──────────┤
          │  ST7789V2  (SPI display)    │  SCREEN_CS     │  pin 24  │
          │  CC1101    (Sub-GHz RF)     │  RF_CS_N       │  pin 26  │
          │  MCP2515   (CAN controller) │  CAN_CS_N      │  pin 36  │
          └─────────────────────────────┴────────────────┴──────────┘

COLLISION CHECK: 3 unique CS nets, 3 unique header pins. NO COLLISIONS.

MISO NOTE: ST7789V2 is write-only (no SDO pin). MISO is driven only by
CC1101 (pin SO) and MCP2515 (pin SO) when their respective CS is asserted
low. Standard SPI tristating applies; no bus contention at rest.
```

**Voltage domains on SPI bus:**
- ST7789V2 — 3.3V logic (SPI0 native; VDD = 3V3_SYS)
- CC1101    — **3V3_CLEAN** (VDD = vcc_clean; LM1117-3.3 LDO isolated rail) ✓
- MCP2515   — **3V3_CLEAN** (VDD = vcc_clean; same LDO isolated rail) ✓
- MCP2551   — 5V supply (VDD = 5V_SYS), but its SPI-facing signals do NOT
  touch the SPI bus (MCP2551 is a CAN transceiver behind MCP2515) ✓

**Phase 1 change:** CC1101 and MCP2515 were moved from 3V3_SYS (Radxa noisy
switching output) to 3V3_CLEAN (LM1117-3.3 LDO; `_build_clean_3v3_rail()`).
This isolates RF receiver sensitivity and CAN bus timing from SBC switching noise.

### 2.2 I2C Buses

```
  I2C0  ──  SDA (pin 27), SCL (pin 28)  → IP5328P telemetry (addr 0x75 typical)
  I2C1  ──  SDA (pin 3),  SCL (pin 5)   [general peripherals; currently no other slaves]
```

**Phase 1 change:** I2C0 is now occupied. Pins 27/28 connect to the IP5328P's
SDA/SCL pins for PMIC telemetry (charge state, battery voltage, output current).
The `_build_power_system()` function was updated to accept and connect these nets.

No I2C1 slave devices are instantiated in the current netlist. The code comment
in `_build_joystick()` mentions an optional ADS1015 on I2C1 when joystick ADC
and audio coexist (Advisory A-1).

### 2.3 I2S Bus

Source: `audio_subsystem.py` (separate netlist, `daemon_v0_audio.net`).
The four I2S nets are also broken out on the Radxa header in `full_system.py`.

```
  Radxa I2S Master
        │
        ├── I2S_BCLK     (pin 12)  ──►  MAX98357A BCLK,  INMP441 SCK
        ├── I2S_LRCLK    (⚠ see §6 A-1 — not wired to header pin in netlist)
        ├── I2S_DATA_OUT (pin 40)  ──►  MAX98357A DIN
        └── I2S_DATA_IN  (pin 38)  ◄──  INMP441 SD

  Topology: parallel clock (MAX98357A and INMP441 share BCLK and LRCLK).
  MAX98357A does not require MCLK.
  INMP441 L/R pin pulled low → left-channel output selected.
```

---

## 3. Power Budget

**Architecture (Phase 1 updated):** IP5328P (QFN-40) boost converter supplies
5V_SYS. The Radxa SBC consumes 5V from the header (pins 2 and 4) and generates
3V3_SYS internally. A new LM1117-3.3 LDO (`_build_clean_3v3_rail`) derives
3V3_CLEAN from 5V_SYS for RF/CAN isolation. 3× SY6280 Stinger ports are now
hardware-limited to **400 mA each** via 17kΩ ISET resistors.

**IP5328P capability:**
- Continuous output: ≥3A (vs. IP5306 derated 1.5A)
- Boost inductor: 4.7µH, Isat > 5A (vs. IP5306 1µH)
- I2C telemetry on I2C0 (pins 27/28) for runtime PMIC monitoring

### 3.1 5V_SYS Direct Consumers

| Consumer | Typical (mA) | Peak (mA) | Source |
|----------|-------------|-----------|--------|
| Radxa SBC (CPU + memory + I/O) | 500 | 900 | typical SBC @ moderate load |
| MCP2551 CAN transceiver (VDD = vcc_5v) | 75 | 100 | MCP2551 datasheet |
| LM1117-3.3 LDO (3V3_CLEAN rail load) | 60 | 90 | RF+CAN consumers below |
| 3× SY6280 (quiescent, no USB load) | 0.3 | 1 | SOT-23-5 quiescent |
| MAX98357A audio amp (5V_AUDIO, if integrated) | 75 | 150 | 1W/8Ω load |
| NE555 heartbeat dummy load (61mA × 0.07% duty) | 4 avg | 61 (pulse) | `r_dummy = "82"`, 5V/82Ω |
| IP5328P internal quiescent | 5 | 10 | datasheet |
| **5V subtotal (no USB devices on Stinger ports)** | **~720** | **~1310** | |

### 3.2 3V3_CLEAN Consumers (LM1117-3.3 LDO rail — RF/CAN only)

| Consumer | Typical (mA @ 3.3V) | Source |
|----------|---------------------|--------|
| CC1101 (RX mode) | 16 | CC1101 datasheet Rev. E |
| CC1101 (TX mode, +10 dBm) | 30 | CC1101 datasheet |
| MCP2515 CAN controller | 5 | MCP2515 datasheet |
| **3V3_CLEAN subtotal** | **~21 (RX) / ~35 (TX)** | |

### 3.3 3V3_SYS Consumers (indirect 5V load via Radxa regulator)

Assume Radxa DC-DC efficiency η = 0.88 (conservative).
Reflected 5V current = (I_3V3 × 3.3V) / (5.0V × η).

| Consumer | Typical (mA @ 3.3V) | Source |
|----------|---------------------|--------|
| SL2.1A USB hub (VDD33 = vcc_3v3) | 30 | SL2.1A datasheet |
| ST7789V2 display core | 10 | ST7789V2 datasheet |
| ST7789V2 backlight (LED) | 60 | typical 1.47″ module |
| ISO1212 logic side (VCC2 = vcc_3v3) | 5 | ISO1212 datasheet |
| INMP441 microphone | 1.4 | INMP441 datasheet |
| Pull-up resistors + misc passives | 5 | estimated |
| **3.3V subtotal** | **~111** | |
| **Reflected to 5V_SYS** | **~83** | via Radxa reg |

### 3.4 Total 5V_SYS Budget

**Stinger ports now hardware-limited to 400 mA each (ISET = 17kΩ, R_ISET = 6800/I_OC).**

```
Scenario                                  5V Current   Margin vs. IP5328P 3A limit
──────────────────────────────────────────────────────────────────────────────────
Idle (Radxa at rest, no USB devices)        ~420 mA     2580 mA headroom  ✓
Active (Radxa loaded, RF RX, audio)         ~900 mA     2100 mA headroom  ✓
Active + 1 USB device at 400 mA (ISET)    ~1300 mA     1700 mA headroom  ✓
Active + 2 USB devices at 400 mA ea       ~1700 mA     1300 mA headroom  ✓
Active + 3 USB devices at 400 mA ea       ~2100 mA      900 mA headroom  ✓
```

> ✅ **PDN-BUDGET-01 RESOLVED** — IP5328P + 17kΩ ISET limiting eliminates the
> overload condition. All populated-port scenarios remain within the 3A continuous
> output capability of the IP5328P with >900 mA headroom at full load.

---

## 4. Hacker Block – External Connector Pinouts

### 4.1 Auxiliary GPIO Header (4-pin, 2.54mm pitch)

**Footprint:** `FP_CONN_1X04_254` =
`Connector_PinHeader_2.54mm:PinHeader_1x04_P2.54mm_Vertical`

**Source:** `generate_daemon_v0_full_system()` in `full_system.py`:
```python
aux_hdr[1] += can_int_n   # MCP2515 INT (open-drain, active-low)
aux_hdr[2] += iso_do1     # ISO1212 OUT1 (3.3V CMOS logic)
aux_hdr[3] += iso_do2     # ISO1212 OUT2 (3.3V CMOS logic)
aux_hdr[4] += gnd
```

```
┌───────────────────────────────────────────────────────┐
│  Pin  │  Net         │  Signal Description             │
├───────┼──────────────┼─────────────────────────────────┤
│   1   │  CAN_INT_N   │  MCP2515 ~{INT} – open-drain,   │
│       │              │  active-low; asserts on CAN      │
│       │              │  RX message / TX error           │
├───────┼──────────────┼─────────────────────────────────┤
│   2   │  ISO_DO1     │  ISO1212 OUT1 – 3.3V CMOS;      │
│       │              │  logical representation of       │
│       │              │  industrial IN1 field signal     │
├───────┼──────────────┼─────────────────────────────────┤
│   3   │  ISO_DO2     │  ISO1212 OUT2 – 3.3V CMOS;      │
│       │              │  logical representation of       │
│       │              │  industrial IN2 field signal     │
├───────┼──────────────┼─────────────────────────────────┤
│   4   │  GND         │  PCB ground reference            │
└───────┴──────────────┴─────────────────────────────────┘
```

Note: CAN_INT_N is open-drain with no on-board pull-up shown in the netlist.
An external or SoC-internal pull-up (to 3V3_SYS) must be enabled in firmware.

### 4.2 CAN Bus External Connector (2-pin, 2.54mm)

**Footprint:** `FP_CONN_1X02_254` =
`Connector_PinHeader_2.54mm:PinHeader_1x02_P2.54mm_Vertical`

**Source:** `_build_can_bus()` in `full_system.py`:
```python
can_conn[1] += can_h   # CAN_H
can_conn[2] += can_l   # CAN_L
```

```
┌───────────────────────────────────────────────────┐
│  Pin  │  Net    │  Description                    │
├───────┼─────────┼─────────────────────────────────┤
│   1   │  CAN_H  │  CAN bus high (ISO 11898-1)     │
│   2   │  CAN_L  │  CAN bus low  (ISO 11898-1)     │
└───────┴─────────┴─────────────────────────────────┘
```

**Termination:** A 120Ω resistor (`cterm`) is placed between CAN_H and CAN_L
with the explicit code comment "DNP if not end node". It is loaded by default
in the netlist but must be removed if this node is not at a cable end-point.

### 4.3 ISO1212 Field-Side Connector (4-pin, 2.54mm) — Phase 3 Hardened

**Footprint:** `FP_CONN_1X04_254`

**Source:** `_build_industrial_iso()` in `full_system.py` (Phase 3 updated):
```python
field_conn[1] += gnd1     # ISO_GND1    – isolated field ground
field_conn[2] += vcc1     # ISO_VCC1    – 8–35V field supply
field_conn[3] += in1_raw  # ISO_IN1_RAW – raw input ch1 (before protection chain)
field_conn[4] += in2_raw  # ISO_IN2_RAW – raw input ch2 (before protection chain)
```

```
┌───────────────────────────────────────────────────────────────────────┐
│  Pin  │  Net          │  Description                                  │
├───────┼───────────────┼───────────────────────────────────────────────┤
│   1   │  ISO_GND1     │  Isolated field ground (≥2.5kV from PCB GND; │
│       │               │  do NOT connect to system GND)                │
├───────┼───────────────┼───────────────────────────────────────────────┤
│   2   │  ISO_VCC1     │  Field supply (8–35V PLC output)              │
├───────┼───────────────┼───────────────────────────────────────────────┤
│   3   │  ISO_IN1_RAW  │  PLC digital output → ch1 (enters protection │
│       │               │  chain before ISO1212 IN1)                    │
├───────┼───────────────┼───────────────────────────────────────────────┤
│   4   │  ISO_IN2_RAW  │  PLC digital output → ch2                    │
└───────┴───────────────┴───────────────────────────────────────────────┘
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

### 4.4 Stinger Port USB-A Connectors (× 3)

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

USB hub port 4 (USB_DN_DP_4 / USB_DN_DM_4) is reserved for a future RTL8152B
Ethernet module. It is not yet wired to any connector in this netlist.

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

### 5.2 DIFF_ETH_100 — Ethernet MDI (RTL8152B, future)

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

No skew constraint for 10/100 Mbps Ethernet (audit finding: no strict
intra-pair skew spec at these speeds). The `.kicad_dru` file will not emit
a `diff_pair_skew` rule for this class.

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

**Resolution (Phase 1):**
- **IP5306 → IP5328P (QFN-40):** continuous output ≥3A; 4.7µH Isat >5A inductor.
- **ISET hardware limiting:** each SY6280 Stinger port limited to 400 mA via
  `iset_res = Resistor(value="17k")` (formula: R = 6800 / 0.4A = 17kΩ).
- **Result:** worst-case all-ports-loaded current is ~2100 mA — 900 mA under the
  IP5328P 3A continuous limit. No OTP risk at any populated-port scenario.

**Source:** `_build_power_system()` and `_build_stinger_port()` in `full_system.py`.

---

### ✅ RESOLVED IND-SAF-01: ISO1212 Input Transient Hardening (Phase 3)

**Original finding:** ISO1212 field inputs had direct connector-to-IC connections
with no protection against industrial transients (24V PLC fault currents,
EN 61000-4-5 surges, static discharge).

**Resolution (Phase 3):** Per-channel protection chain inserted in
`_build_industrial_iso()`:

| Stage | Component | Purpose |
|-------|-----------|---------|
| Series PTC | Littelfuse 60R (`Polyfuse`, `FP_PTC_1206`) | Limits sustained fault current; self-resetting |
| Shunt TVS | Vishay VCAN26A2 (`D_TVS`, `FP_TVS_SMB`) | Clamps transient overvoltages to ~26V at field node |
| Series R | 562Ω 1% | Limits steady-state input current to IC |
| Threshold R | 1kΩ 1% | Sets IEC 61131-2 switching threshold; bleeds static |
| Filter C | 10nF 100V X7R | Suppresses HF transient noise at IC input pin |

ISO_GND1 remains strictly isolated from PCB GND throughout all protection stages.
Connector pins 3/4 now connect to ISO_IN1_RAW / ISO_IN2_RAW (pre-protection nodes).

---

### ⚠ ADVISORY A-1: I2S_LRCLK Not Wired to Radxa Header in full_system.py Netlist

**Location:** `_build_radxa_header()`, `full_system.py`

**Finding:** The function receives `i2s_lrclk: Net` as a parameter, but no
`conn[N] += i2s_lrclk` assignment exists in the function body. The net
`I2S_LRCLK` has **zero connections** within the `full_system.py` netlist.

Pin 35 connects only to `JOY_VRY`. The code comment acknowledges the intent:

```python
conn[35] += joy_vry    # ADC_VRY – joystick Y (shared with I2S_LRCLK)
```

The docstring states: *"Pins 35 / 40 double as I2S_LRCLK / I2S_DOUT when I2S
audio is active. When using the joystick ADC on those pins, the audio subsystem
must be disabled in firmware."*

**Root cause:** `I2S_LRCLK` and `JOY_VRY` are separate SKiDL `Net()` objects
representing two firmware modes of the same physical SoC pin. The netlist
models only one mode (ADC). The I2S mode is handled at firmware level by
reconfiguring the SoC pad mux. ERC will flag `I2S_LRCLK` as having ≤1
connection unless a `# noqa` annotation is added.

**Impact:** Audio subsystem (in `audio_subsystem.py`) is a separate netlist
file; these netlists are not merged. No functional issue in the as-built PCB,
but firmware must switch pin 35 mode between I2S_LRCLK and ADC. Joystick Y
and I2S audio **cannot be used simultaneously.**

---

### ⚠ ADVISORY A-2: CAN Bus Termination Resistor is Populated by Default

**Location:** `_build_can_bus()`, `full_system.py`:
```python
cterm = Resistor(value="120")   # CAN bus termination (DNP if not end node)
cterm[1] += can_h
cterm[2] += can_l
```

The 120Ω termination resistor is **wired** in the SKiDL netlist (not marked
DNP at netlist generation time). It will appear on the schematic and BOM as
a populated component. Boards that are **not** at a cable end-point require
manual BOM/assembly-file modification to mark this DNP before fabrication.

If two Daemon V0 boards are connected back-to-back on the same CAN segment
and both have termination populated, the effective termination is 60Ω —
outside the ISO 11898-1 specification (120Ω ±5%).

---

### ⚠ ADVISORY A-3: CC1101 Antenna Nets Left Floating

**Location:** `_build_rf_transceiver()`, `full_system.py`:
```python
ic["RF_P"] += Net("RF_ANT_P")   # → RF matching network → antenna
ic["RF_N"] += Net("RF_ANT_N")   # differential RF port (negative)
```

`RF_ANT_P` and `RF_ANT_N` are named nets with no downstream connections in
the current netlist. A PI-network impedance matching circuit and antenna
connector (or PCB trace antenna) must be added before fabrication. Failure to
provide a 50Ω matched load will degrade RF performance and may stress the
CC1101 PA stage.

---

### ⚠ ADVISORY A-4: CAN_INT_N Has No On-Board Pull-Up

**Location:** `_build_can_bus()`, `full_system.py`

The MCP2515 `~{INT}` pin is open-drain. It drives the `CAN_INT_N` net and
is routed directly to auxiliary header pin 1, but no pull-up resistor to
3V3_SYS is instantiated in the CAN bus subsystem or the auxiliary header.

The Radxa SoC internal GPIO pull-up must be enabled in firmware before
reading `CAN_INT_N`. If firmware configures the GPIO as floating-input,
the interrupt pin will be indeterminate between events.

---

### ℹ NOTE N-1: 26 MHz and 8 MHz Crystals Reuse the 12 MHz Footprint

**Location:** `_build_rf_transceiver()` and `_build_can_bus()`:
```python
# CC1101 reference
xtal = Part("Device", "Crystal", footprint=FP_XTAL_12M, value="26MHz")

# MCP2515 reference
xtal = Part("Device", "Crystal", footprint=FP_XTAL_12M, value="8MHz")
```

`FP_XTAL_12M = "Crystal:Crystal_SMD_3225-4Pin_3.2x2.5mm"`. This footprint
is compatible with industry-standard SMD 3225 crystals at all three
frequencies. Component-specific load capacitance (18–22 pF typical) and
ESR specs must be verified against each crystal's datasheet at BOM sourcing
time; the `value=` field is used to distinguish them in the schematic.

---

### ℹ NOTE N-2: Audio Subsystem is a Separate Netlist

`netlist/audio_subsystem.py` generates `daemon_v0_audio.net` independently
from `daemon_v0_full_system.net`. The two netlists share net names
(`I2S_BCLK`, `I2S_DATA_IN`, `I2S_DATA_OUT`, `GND`, `3V3_SYS`) but are
**not automatically merged** by the build system. A KiCad hierarchical
sheet or manual net-merge step is required to produce a single board-level
schematic for DRC and layout.

---

*Document generated from code. Last source state: 91/91 CI tests passing.*
*Subsystems A–J implemented. Audit findings PDN-JMP-04, PDN-DCB-03,*
*PDN-THM-02, SM-PWR-02, SM-AUD-01, SM-LOG-03, SI-USB-02 resolved.*
