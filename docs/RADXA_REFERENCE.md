# Radxa Zero 3W Physical Layout Reference for Daemon V0 PCB Design

Generated 2026-03-07 from `/home/arthur/daemon/netlist/full_system.py` analysis.

## 1. Board Dimensions

| Parameter       | Radxa Zero 3W    | Daemon V0        |
|-----------------|------------------|------------------|
| Length (X)      | 65.0 mm          | 85.6 mm          |
| Width (Y)       | 30.0 mm          | 54.0 mm          |
| Corner radii    | ~2.5 mm          | TBD              |
| Mounting holes  | M2.5 x 4         | Must match        |

The Daemon board is 20.6 mm wider and 24.0 mm longer than the Radxa.
The Radxa sits UNDERNEATH the Daemon board (Daemon stacks on top).

---

## 2. Radxa Alignment Under the Daemon Board

### 2.1 Coordinate System

All coordinates use **bottom-left origin** for each board.

### 2.2 Recommended Alignment

The Radxa is centered horizontally and positioned so the 40-pin header
aligns near the top edge of the Daemon board. The Radxa USB-C ports
(bottom edge of Radxa) face the **same direction as one of the Daemon's
short edges** (the "south" edge).

**Offset calculation (Radxa origin relative to Daemon origin):**

```
X offset = (85.6 - 65.0) / 2 = 10.3 mm
Y offset = (54.0 - 30.0) / 2 = 12.0 mm  (centered vertically)
```

Centering vertically places the GPIO header pins at Daemon-board Y coordinates
of ~37.4 to ~40.0 mm, which is well within the board outline and leaves room
for edge-mount connectors on the Daemon board's north edge.

> **Alternative**: If the GPIO header must be closer to the Daemon board's top
> edge, shift the Radxa upward. With Y offset = 19.0 mm, the header row sits
> at Y ~44.4-47.0 mm on the Daemon board (only 7-10 mm from the top edge).
> Choose based on where other Daemon connectors (RJ45, USB-A, WAGO) are placed.

### 2.3 ASCII Art - Top-Down View (Daemon board F.Cu facing up)

Looking DOWN through the Daemon board at the Radxa underneath:

```
    Daemon V0 board outline (85.6 x 54.0 mm)
    ┌─────────────────────────────────────────────────────────────────────────────────┐
    │                                                                                 │ Y=54
    │   ┌─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┐   │
    │   :                   Radxa Zero 3W (underneath)                          :   │
    │   :                      65.0 x 30.0 mm                                   :   │
    │   :                                                                       :   │
    │   :  (M)─────────── 40-pin GPIO header (2x20) ────────────(M)            :   │ Y≈38-40
    │   :   ●  1  2  3  4  5  ...                    ... 37 38 39 40  ●        :   │
    │   :                                                                       :   │
    │   :              [WiFi U.FL]                                              :   │
    │   :                                                                       :   │
    │   :  (M)                                                       (M)        :   │
    │   : [SD]                                                                  :   │
    │   :        [USB-C OTG]     [micro HDMI]     [USB-C Host]                  :   │
    │   └─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┘   │
    │                                                                                 │
    │                         (Daemon board continues)                                │ Y=0
    └─────────────────────────────────────────────────────────────────────────────────┘
   X=0                                                                              X=85.6

    (M) = M2.5 mounting hole / standoff
    [SD] = MicroSD card slot (protrudes from left edge of Radxa)
```

### 2.4 Radxa Component Positions (Translated to Daemon Board Coordinates)

Using the centered alignment (X_off=10.3, Y_off=12.0):

| Radxa Feature          | Radxa Coords (mm)   | Daemon Coords (mm)    | Notes                           |
|------------------------|----------------------|-----------------------|---------------------------------|
| **USB-C OTG/Power**    | X=12.4, Y=0 (edge)  | X=22.7, Y=12.0        | Bottom edge of Radxa            |
| **USB-C Host**         | X=51.9, Y=0 (edge)  | X=62.2, Y=12.0        | Bottom edge of Radxa            |
| **Micro HDMI**         | X=31.3, Y=0 (edge)  | X=41.6, Y=12.0        | Bottom edge of Radxa            |
| **MicroSD slot**       | X=0 (edge), Y=15    | X=10.3, Y=27.0        | Protrudes left ~2-3mm           |
| **WiFi U.FL**          | X=63.5, Y=19.7      | X=73.8, Y=31.7        | Antenna connector               |
| **GPIO Pin 1**         | X=8.32, Y=25.41     | X=18.62, Y=37.41      | 3V3_SYS                         |
| **GPIO Pin 2**         | X=8.32, Y=27.95     | X=18.62, Y=39.95      | 5V_SYS                          |
| **GPIO Pin 39**        | X=56.58, Y=25.41    | X=66.88, Y=37.41      | GND                             |
| **GPIO Pin 40**        | X=56.58, Y=27.95    | X=66.88, Y=39.95      | I2S_DATA_OUT                    |
| **Mounting hole 1**    | (3.5, 3.6)          | (13.8, 15.6)          | Near USB-C OTG                  |
| **Mounting hole 2**    | (3.6, 26.5)          | (13.9, 38.5)          | Near GPIO pin 1                 |
| **Mounting hole 3**    | (61.4, 3.6)          | (71.7, 15.6)          | Near USB-C Host                 |
| **Mounting hole 4**    | (61.4, 26.5)         | (71.7, 38.5)          | Near GPIO pin 40                |

---

## 3. Mounting Holes and Standoffs

The Daemon board needs **M2.5 through-holes** at these positions (centered alignment):

| Standoff | Daemon X (mm) | Daemon Y (mm) | Purpose                    |
|----------|---------------|---------------|----------------------------|
| MH1      | 13.8          | 15.6          | Radxa corner (bottom-left) |
| MH2      | 13.9          | 38.5          | Radxa corner (top-left)    |
| MH3      | 71.7          | 15.6          | Radxa corner (bottom-right)|
| MH4      | 71.7          | 38.5          | Radxa corner (top-right)   |

**Standoff height**: 8.4-8.85 mm (per ECO note on Goobay USB-C bridge vertical
pitch). This gap accommodates the tallest Radxa bottom-side components and the
Daemon bottom-side components.

**Hole diameter**: 2.75 mm (for M2.5 screw clearance).
**Keepout around holes**: 5.5 mm diameter (head clearance).

---

## 4. Clearance / Keep-Out Zones (No Tall Components on Daemon B.Cu)

The Radxa has tall components on its top side (facing the Daemon board's bottom).
The Daemon board **must not place tall components** (>1mm) on its B.Cu side in
these zones:

### 4.1 Full Radxa Footprint Zone

**Primary keep-out** (Daemon B.Cu, centered alignment):
```
X: 10.3 to 75.3 mm   (Radxa 0-65 mm + X offset)
Y: 12.0 to 42.0 mm   (Radxa 0-30 mm + Y offset)
```

Within this rectangle, Daemon B.Cu should have **no components taller than
~2 mm** (the gap minus Radxa component height). Flat SMD passives (0402, 0603)
are acceptable.

### 4.2 Critical Tall-Component Zones on Radxa (absolute no-go for Daemon B.Cu)

| Radxa Component            | Daemon B.Cu Keep-Out (mm)          | Height (approx) |
|----------------------------|------------------------------------|------------------|
| RK3566 SoC (center)       | X: 28-50, Y: 22-36                | 1.5 mm (BGA+HS)  |
| LPDDR4 RAM (near SoC)     | X: 35-55, Y: 22-36                | 1.2 mm            |
| WiFi/BT module            | X: 58-75, Y: 25-38                | 2.0 mm            |
| 40-pin header pins         | X: 18-67, Y: 37-40                | 2.5 mm (pin stubs)|
| USB-C connectors (2x)     | X: 18-28, Y: 12-16; X: 57-67     | 3.2 mm            |
| Micro HDMI                | X: 37-47, Y: 12-16                | 3.0 mm            |
| MicroSD slot               | X: 7-15, Y: 22-32                 | 2.0 mm            |
| Voltage regulators         | X: 15-25, Y: 18-28                | 1.5 mm            |

### 4.3 Daemon Board Edges (Free Zones)

These Daemon board regions are **outside** the Radxa footprint and available
for tall components, edge-mount connectors, and through-hole parts:

```
NORTH strip: Y = 42.0 to 54.0 mm  (12 mm wide, full board length)
SOUTH strip: Y = 0 to 12.0 mm     (12 mm wide, full board length)
WEST strip:  X = 0 to 10.3 mm     (10.3 mm wide, full board height)
EAST strip:  X = 75.3 to 85.6 mm  (10.3 mm wide, full board height)
```

Ideal placements:
- **RJ45 MagJack** (HR911105A): North or East edge (tall, 13.5mm)
- **USB-A ports** (Stinger): North edge
- **WAGO terminal block**: East or West edge
- **Battery JST connector**: South or West edge
- **Tactile switch (SW_PWR)**: Accessible edge

---

## 5. Complete 40-Pin GPIO Mapping (Radxa Zero 3W to Daemon V0)

Extracted from `_build_radxa_header()` in `full_system.py`.

Pin numbering follows the standard Raspberry Pi / Radxa 40-pin convention:
odd pins on left (pin 1 = 3.3V), even pins on right (pin 2 = 5V).

| Pin | Radxa GPIO Function        | Daemon Net Name     | Daemon Subsystem           | Direction |
|-----|----------------------------|---------------------|----------------------------|-----------|
|  1  | 3.3V Power                 | 3V3_SYS             | Power rail (from Radxa)    | PWR       |
|  2  | 5V Power                   | 5V_SYS              | Power rail (to Radxa)      | PWR       |
|  3  | GPIO0_B3 / I2C1_SDA       | I2C1_SDA             | A (IP5328P), E (ADS1015)  | Bidir     |
|  4  | 5V Power                   | 5V_SYS              | Power rail (to Radxa)      | PWR       |
|  5  | GPIO0_B4 / I2C1_SCL       | I2C1_SCL             | A (IP5328P), E (ADS1015)  | Bidir     |
|  6  | GND                        | GND                  | Ground                     | PWR       |
|  7  | GPIO4 / PWM                | SCREEN_BL            | D (Display backlight)      | OUT       |
|  8  | GPIO14 / UART TX           | STINGER_FLAG_2       | C (Stinger port 2 fault)   | IN (OD)   |
|  9  | GND                        | GND                  | Ground                     | PWR       |
| 10  | GPIO15 / UART RX           | STINGER_FLAG_3       | C (Stinger port 3 fault)   | IN (OD)   |
| 11  | GPIO17                     | STINGER_FLAG_1       | C (Stinger port 1 fault)   | IN (OD)   |
| 12  | GPIO18 / PCM_CLK           | I2S_BCLK             | K (MAX98357A audio)        | OUT       |
| 13  | GPIO27                     | RF_MOSI              | H (CC1101 SoftSPI SI)      | OUT       |
| 14  | GND                        | GND                  | Ground                     | PWR       |
| 15  | GPIO22                     | RF_MISO              | H (CC1101 SoftSPI SO)      | IN        |
| 16  | GPIO23                     | RF_CLK               | H (CC1101 SoftSPI SCLK)    | OUT       |
| 17  | 3.3V Power                 | 3V3_SYS              | Power rail (from Radxa)    | PWR       |
| 18  | GPIO24                     | RF_CS_N              | H (CC1101 chip select)     | OUT       |
| 19  | GPIO10 / SPI3_MOSI         | SPI3_MOSI            | D (Display SDA)            | OUT       |
| 20  | GND                        | GND                  | Ground                     | PWR       |
| 21  | GPIO9 / SPI3_MISO          | SPI3_MISO            | D (Display, unused)        | IN        |
| 22  | GPIO25                     | SCREEN_RST           | D (Display reset)          | OUT       |
| 23  | GPIO11 / SPI3_SCLK         | SPI3_CLK             | D (Display SCL)            | OUT       |
| 24  | GPIO8 / SPI3_CE0           | SPI3_CS              | D (Display chip select)    | OUT       |
| 25  | GND                        | GND                  | Ground                     | PWR       |
| 26  | GPIO7                      | GND (NC)             | Disconnected on Zero 3W    | NC        |
| 27  | GPIO0 / I2C0_SDA           | GND (NC)             | Disconnected on Zero 3W    | NC        |
| 28  | GPIO1 / I2C0_SCL           | GND (NC)             | Disconnected on Zero 3W    | NC        |
| 29  | GPIO5                      | STINGER_EN_1         | C (Stinger port 1 enable)  | OUT       |
| 30  | GND                        | GND                  | Ground                     | PWR       |
| 31  | GPIO6                      | STINGER_EN_2         | C (Stinger port 2 enable)  | OUT       |
| 32  | GPIO12                     | SCREEN_DC            | D (Display data/command)    | OUT       |
| 33  | GPIO13                     | STINGER_EN_3         | C (Stinger port 3 enable)  | OUT       |
| 34  | GND                        | GND                  | Ground                     | PWR       |
| 35  | GPIO19 / I2S3_LRCK_M0      | I2S_LRCLK           | K (MAX98357A audio)        | OUT       |
| 36  | GPIO16                     | LED_DIN              | E2 (WS2812B LED chain)     | OUT       |
| 37  | GPIO26                     | JOY_SW               | E (Joystick button)        | IN (PU)   |
| 38  | GPIO20 / PCM_DIN           | I2S_DATA_IN          | K (Audio mic input)        | IN        |
| 39  | GND                        | GND                  | Ground                     | PWR       |
| 40  | GPIO21 / PCM_DOUT          | I2S_DATA_OUT         | K (Audio amp output)       | OUT       |

**Direction key**: OUT = Radxa drives signal; IN = Radxa reads signal; Bidir = I2C;
PWR = power; OD = open-drain (pulled up on Daemon board by 10k); PU = pulled up 10k;
NC = not connected.

---

## 6. Signal Group Summary by Subsystem

### 6.1 Display (Subsystem D) -- SPI3 + GPIOs (6 pins)

| Signal      | Header Pin | Bus      |
|-------------|------------|----------|
| SPI3_MOSI   | 19         | SPI3     |
| SPI3_MISO   | 21         | SPI3     |
| SPI3_CLK    | 23         | SPI3     |
| SPI3_CS     | 24         | SPI3     |
| SCREEN_DC   | 32         | GPIO     |
| SCREEN_RST  | 22         | GPIO     |
| SCREEN_BL   | 7          | PWM      |

### 6.2 CC1101 RF Transceiver (Subsystem H) -- SoftSPI (4 pins)

| Signal      | Header Pin | Bus       |
|-------------|------------|-----------|
| RF_MOSI     | 13         | SoftSPI   |
| RF_MISO     | 15         | SoftSPI   |
| RF_CLK      | 16         | SoftSPI   |
| RF_CS_N     | 18         | SoftSPI   |

Note: RF_GDO0 is NOT on the header; CC1101 uses polling mode.

### 6.3 Audio / I2S (Subsystem K) -- 4 pins

| Signal       | Header Pin | Bus  |
|--------------|------------|------|
| I2S_BCLK     | 12         | I2S  |
| I2S_LRCLK    | 35         | I2S  |
| I2S_DATA_IN  | 38         | I2S  |
| I2S_DATA_OUT | 40         | I2S  |

### 6.4 I2C Peripherals (Subsystems A, E) -- 2 pins

| Signal    | Header Pin | Devices on Bus                |
|-----------|------------|-------------------------------|
| I2C1_SDA  | 3          | IP5328P (telemetry), ADS1015  |
| I2C1_SCL  | 5          | IP5328P (telemetry), ADS1015  |

I2C1 has 470-ohm series protection resistors (in Subsystem A).
IP5328P has internal 4.7k pull-ups. Radxa internal pull-ups should be
disabled in device tree.

### 6.5 Stinger USB Port Control (Subsystem C) -- 6 pins

| Signal          | Header Pin | Type               |
|-----------------|------------|--------------------|
| STINGER_EN_1    | 29         | Output (enable)    |
| STINGER_EN_2    | 31         | Output (enable)    |
| STINGER_EN_3    | 33         | Output (enable)    |
| STINGER_FLAG_1  | 11         | Input (OC fault)   |
| STINGER_FLAG_2  | 8          | Input (OC fault)   |
| STINGER_FLAG_3  | 10         | Input (OC fault)   |

FLAG pins are open-drain with 10k pull-ups to 3V3_SYS on the Daemon board.

### 6.6 LED + Joystick + Misc (Subsystems E, E2) -- 2 pins

| Signal   | Header Pin | Subsystem              |
|----------|------------|------------------------|
| LED_DIN  | 36         | E2 (WS2812B x4 chain)  |
| JOY_SW   | 37         | E (Joystick button)     |

### 6.7 Power Pins -- 12 pins

| Pin(s)                    | Net     | Notes                              |
|---------------------------|---------|------------------------------------|
| 2, 4                      | 5V_SYS  | Daemon supplies 5V to Radxa        |
| 1, 17                     | 3V3_SYS | Radxa supplies 3.3V to Daemon      |
| 6,9,14,20,25,26,27,28,30,34,39 | GND | Ground (includes NC pins tied GND) |

---

## 7. PCB Design Checklist

- [ ] Place M2.5 mounting holes at (13.8, 15.6), (13.9, 38.5), (71.7, 15.6), (71.7, 38.5)
- [ ] Route 40-pin header J12 footprint centered at approximately X=42.75, Y=38.68
      (midpoint between pin 1 and pin 40 in Daemon coordinates)
- [ ] Verify standoff height (8.4-8.85mm) clears Radxa top-side components
- [ ] No tall Daemon B.Cu components within Radxa footprint zone (X:10.3-75.3, Y:12.0-42.0)
- [ ] Keep Daemon B.Cu clear directly above Radxa USB-C / HDMI connectors (tallest: 3.2mm)
- [ ] MicroSD slot clearance: no Daemon components at X:7.3-15.3, Y:22-32 on B.Cu
- [ ] WiFi antenna keep-out: minimize copper pour within 10mm of (73.8, 31.7) on all layers
- [ ] SPI3 traces (display): keep short, <50mm, avoid crossing RF SoftSPI traces
- [ ] RF SoftSPI traces (CC1101): keep away from I2S bus to avoid crosstalk
- [ ] I2C1 bus: matched-length SDA/SCL; 470-ohm series resistors close to header
- [ ] Ground stitching vias around 40-pin header for signal integrity
- [ ] Goobay USB-C bridge (A5) placed on B.Cu, aligned with Radxa USB-C at 8.85mm pitch
