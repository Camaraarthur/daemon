# Daemon V0 — Bill of Materials

**Board revision:** ECO #2026-03-GOLD
**Source netlists:** `netlist/full_system.py`, `netlist/audio_subsystem.py`
**164/164 CI tests passing**

Components are grouped by subsystem. Quantities marked (×N) reflect loop-instantiated parts.

---

## Table of Contents

1. [Subsystem A — IP5328P Power Management](#subsystem-a--ip5328p-power-management)
2. [Subsystem A2 — AP2112K-3.3 Clean 3.3V LDO Rail](#subsystem-a2--ap2112k-33-clean-33v-ldo-rail)
3. [Subsystem A3 — USB Charging MUX (PDN-USB-01)](#subsystem-a3--usb-charging-mux-pdn-usb-01)
4. [Subsystem A5 — Goobay 74446 USB-C Bridge](#subsystem-a5--goobay-74446-usb-c-bridge)
5. [Subsystem A6 — Advanced Power UX](#subsystem-a6--advanced-power-ux)
6. [Subsystem B — SL2.1A USB 2.0 Hub](#subsystem-b--sl21a-usb-20-hub)
7. [Subsystem B2 — RTL8152B USB–Ethernet](#subsystem-b2--rtl8152b-usbethernet)
8. [Subsystem C — SY6280AAC Stinger Ports × 3](#subsystem-c--sy6280aac-stinger-ports--3)
9. [Subsystem D — ST7789V2 SPI Display](#subsystem-d--st7789v2-spi-display)
10. [Subsystem E — Analog Joystick + ADS1015 ADC](#subsystem-e--analog-joystick--ads1015-adc)
11. [Subsystem E2 — WS2812B RGB LEDs × 4](#subsystem-e2--ws2812b-rgb-leds--4)
12. [Subsystem E3 — IR Blaster](#subsystem-e3--ir-blaster)
13. [Subsystem F — 40-Pin Radxa Expansion Header](#subsystem-f--40-pin-radxa-expansion-header)
14. [Subsystem G — NE555 Heartbeat / Dummy-Load](#subsystem-g--ne555-heartbeat--dummy-load)
15. [Subsystem H — CC1101 Sub-GHz RF Transceiver](#subsystem-h--cc1101-sub-ghz-rf-transceiver)
16. [Subsystem J — ISO1212 Industrial 24V Isolation](#subsystem-j--iso1212-industrial-24v-isolation)
17. [Audio Subsystem — MAX98357A + INMP441](#audio-subsystem--max98357a--inmp441)
18. [Top-Level Assembly](#top-level-assembly)

---

## Subsystem A — IP5328P Power Management

The core power system. The IP5328P is a boost converter that charges a Li-ion cell from USB-C input and outputs a regulated 5V rail to power the entire board. Everything downstream of this IC runs on 5V_SYS or rails derived from it.

| Ref | Part | Value / MPN | Package | Qty | What it does |
|-----|------|-------------|---------|-----|--------------|
| U1 | IP5328P | IP5328P | QFN-40 (6×6mm) | 1 | Main PMIC: synchronous boost converter, Li-ion charger (up to 3A continuous output), I2C telemetry on I2C1 (pins 3/5) for runtime monitoring of battery state and charge current |
| L1 | Inductor | 4.7µH | Bourns SRR1260 | 1 | Boost converter switching inductor. 4.7µH with Isat > 5A handles the full 3A continuous output without core saturation |
| J1 | Jumper (0Ω) | 0Ω | R_1225_3264 | 1 | BAT_ISO: battery isolation jumper. Lift to disconnect the Li-ion cell from the boost stage during bench testing (PDN-JMP-04) |
| J2 | Jumper (0Ω) | 0Ω | R_1225_3264 | 1 | VOUT_ISO: output isolation jumper. Lift to disconnect 5V_SYS from the board during PMIC bring-up (PDN-JMP-04) |
| J_BAT | Battery connector | — | JST-PH 2-pin | 1 | 2-pin JST-PH connector for the Li-ion cell. Positive on pin 1, negative on pin 2 |
| C_IN_BULK | Capacitor | 10µF | 0805 | 1 | Bulk input decoupling on VIN. Stabilises the supply from the USB charger during transient load steps |
| C_IN_BYP | Capacitor | 100nF | 0402 | 1 | High-frequency bypass on VIN. Filters switching noise above the bulk cap's self-resonance |
| C_BAT_BULK | Capacitor | 10µF | 0805 | 1 | Bulk decoupling on the BAT rail. Reduces impedance seen by the boost stage during load transients |
| C_BAT_BYP | Capacitor | 100nF | 0402 | 1 | High-frequency bypass on BAT rail |
| C_OUT_BULK | Capacitor | 22µF | 0805 | 1 | Bulk output decoupling on 5V_SYS. Sized to match the PySpice PDN-DCB-03 transient model |
| C_OUT_BYP | Capacitor | 100nF | 0402 | 1 | High-frequency bypass on 5V_SYS output |
| C_TANT | Tantalum capacitor | 100µF 6.3V | Case-B (3.5×2.8mm) | 1 | SM-PDN-01: 100µF power tank on 5V_SYS. Absorbs simultaneous load steps (SBC resume + RF TX + Ethernet link-up + Stinger enumeration) that can reach 4A in under 100µs — faster than the boost converter can respond. Low ESR (~100mΩ) of tantalum is key here; MLCC equivalents would need multiple 22µF in parallel (ECO #2026-03-G) |
| R_NTC | NTC thermistor | 10kΩ | 0402 | 1 | SM-THM-01: 10kΩ NTC connected to IP5328P NTC pin. The IC computes junction temperature via a voltage divider and throttles/shuts down the boost stage above Tj ≈ 120°C, preventing thermal runaway (ECO #2026-03-G) |
| R_MFB | Resistor | 100kΩ | 0402 | 1 | Pull-up on the MFB (multi-function button) pin to 3V3. Keeps the PMIC in normal operating mode when no button is pressed |
| R_I2C_SDA | Resistor | 470Ω | 0402 | 1 | Series protection on I2C1 SDA between Radxa pin 3 and IP5328P SDA pin. When the Radxa is powered off but the PMIC battery supply is live, the IP5328P's internal I2C pull-up (4.7kΩ) would back-drive the SoC I/O clamp. 470Ω limits this to ~7mA — below latch-up threshold (ECO #2026-03-F/H) |
| R_I2C_SCL | Resistor | 470Ω | 0402 | 1 | Same protection on I2C1 SCL (Radxa pin 5 → IP5328P SCL pin) |
| TP_VIN | Test point | TP_VIN | D1.5mm pad | 1 | DFT: probe point for VIN (USB charger input voltage) |
| TP_BAT | Test point | TP_BAT | D1.5mm pad | 1 | DFT: probe point for BAT (Li-ion cell voltage) |
| TP_SW | Test point | TP_SW | D1.0mm pad | 1 | DFT: probe point for SW switching node (oscilloscope capture of boost waveform) |
| TP_VOUT | Test point | TP_VOUT | D1.5mm pad | 1 | DFT: probe point for VOUT (5V_SYS rail) |

---

## Subsystem A2 — AP2112K-3.3 Clean 3.3V LDO Rail

Derives a low-noise 3.3V supply (3V3_CLEAN) from 5V_SYS specifically for the RF and Ethernet subsystems. Keeps them isolated from the Radxa SBC's internal switching regulator, which would inject switching noise into the CC1101 receiver and RTL8152B.

| Ref | Part | Value / MPN | Package | Qty | What it does |
|-----|------|-------------|---------|-----|--------------|
| U_LDO | AP2112K-3.3 | AP2112K-3.3 | SOT-23-5 | 1 | Low-dropout linear regulator: 5V_SYS → 3V3_CLEAN. 250mV dropout keeps 3V3_CLEAN stable until 5V_SYS sags to 3.35V (vs. 3.75V minimum for the old LM1117-3.3 with its 1.25V dropout). EN pin tied to VIN for always-on operation. 600mA rated; actual peak load is ~110mA (CC1101 TX + RTL8152B), leaving 490mA headroom (ECO #2026-03-GOLD) |
| C_LDO_IN_BULK | Capacitor | 10µF | 0805 | 1 | Bulk input decoupling on 5V_SYS side of the LDO. Prevents load transients on 3V3_CLEAN from coupling back into 5V_SYS |
| C_LDO_IN_BYP | Capacitor | 100nF | 0402 | 1 | High-frequency input bypass on the LDO |
| C_LDO_OUT_BULK | Capacitor | 10µF | 0805 | 1 | Bulk output decoupling on 3V3_CLEAN. Stabilises the rail during CC1101 RX↔TX mode transitions (Icc step ~14mA) |
| C_LDO_OUT_BYP | Capacitor | 100nF | 0402 | 1 | High-frequency output bypass on 3V3_CLEAN |

---

## Subsystem A3 — USB Charging MUX (PDN-USB-01)

OR-diode circuit that accepts power from either a USB-A port (VBUS_A) or the USB-C bridge (VBUS_C), forwarding whichever is higher to the IP5328P charger input. A resistor divider sets the MUX_SEL voltage to ~2.95V.

| Ref | Part | Value / MPN | Package | Qty | What it does |
|-----|------|-------------|---------|-----|--------------|
| D_VBUS_A | Schottky diode | SS14 | DO-214AC (SMA) | 1 | OR-diode on VBUS_A input. Forward-biased when USB-A charger is connected, reverse-biased otherwise. SMA package (DO-214AC) handles the 1A+ charging current without thermal stress |
| D_VBUS_C | Schottky diode | SS14 | DO-214AC (SMA) | 1 | Same OR-diode on VBUS_C input from the Goobay USB-C bridge |
| R_MUX_SER | Resistor | 430kΩ | 0402 | 1 | Series arm of the MUX_SEL voltage divider. Together with R_MUX_SHN, sets MUX_SEL ≈ 2.95V to correctly signal the IP5328P which input is active |
| R_MUX_SHN | Resistor | 620kΩ | 0402 | 1 | Shunt arm of the MUX_SEL voltage divider to GND |

---

## Subsystem A5 — Goobay 74446 USB-C Bridge

A passive mechanical bridge connector that mates with the Radxa Zero 3W's USB-C port on the board underside (B.Cu), presenting the SBC's USB bus upstream to the SL2.1A hub.

| Ref | Part | Value / MPN | Package | Qty | What it does |
|-----|------|-------------|---------|-----|--------------|
| USB_C | USB-C receptacle | Goobay 74446 | U-shaped bridge, 8.85mm pitch | 1 | Mechanical USB-C bridge mounted on B.Cu directly beneath the Radxa SBC's USB-C port. Routes the Radxa USB 2.0 D+/D− lines to the SL2.1A hub upstream port. No active components — purely a passive signal path |
| R_CC1 | Resistor | 5.1kΩ | 0402 | 1 | Pull-down on CC1 pin. Identifies this port as a UFP (Upstream Facing Port / device) to the USB-C charger, enabling correct VBUS negotiation |
| R_CC2 | Resistor | 5.1kΩ | 0402 | 1 | Pull-down on CC2 pin. Same function as R_CC1 for the second CC line (handles cable orientation detection) |

---

## Subsystem A6 — Advanced Power UX

Three-circuit power management front-end: a PMOS wake-blocker isolates the joystick button from the PMIC during normal operation, an NMOS performs software-triggered shutdown, and a physical button provides always-available manual control. Replaces the removed hardware reset button (ECO #2026-03-D).

| Ref | Part | Value / MPN | Package | Qty | What it does |
|-----|------|-------------|---------|-----|--------------|
| Q_WAKE | BSS84 PMOS | BSS84 | SOT-23 | 1 | Wake-blocker P-channel MOSFET. When 5V_SYS is OFF, its source is at 0V, the gate pull-down holds G low, and the FET conducts — routing a JOY_SW button press to PMIC_KEY to wake the board. When 5V_SYS is ON, the source rises to 5V, turning the PMOS OFF and blocking JOY_SW from inadvertently triggering the PMIC |
| Q_KILL | 2N7002 NMOS | 2N7002 | SOT-23 | 1 | Software kill N-channel MOSFET. Radxa drives PMIC_KILL high → N-FET conducts → drains PMIC_KEY to GND → simulates a sustained button hold → IP5328P enters shutdown. Used for graceful OS-triggered power-off |
| R_GATE | Resistor | 100kΩ | 0402 | 1 | Pull-down on BSS84 gate to GND. Ensures the PMOS gate is at a defined low potential when 5V_SYS is absent, holding the FET ON for wake detection |
| SW_PWR | Tactile switch | SW_PWR | SPST, 6mm | 1 | Physical power button. Directly shorts PMIC_KEY to GND when pressed — always functional regardless of SoC state. Used for initial power-on and emergency shutdown |
| HDR_PWR | 3-pin header | — | 2.54mm 1×3 | 1 | Power management header exposing: pin 1 PMIC_KILL (Radxa GPIO → software shutdown), pin 2 SW_PWR_GPIO (Radxa GPIO → taps PMIC_KEY for long-press detection), pin 3 GND |

---

## Subsystem B — SL2.1A USB 2.0 Hub

4-port USB 2.0 hub that multiplies the single upstream USB port (from the Radxa via the Goobay bridge) into three downstream Stinger ports (via SY6280 power switches) and one port dedicated to the RTL8152B Ethernet chip.

| Ref | Part | Value / MPN | Package | Qty | What it does |
|-----|------|-------------|---------|-----|--------------|
| U_HUB | SL2.1A | SL2.1A | QFN-28 | 1 | USB 2.0 hub controller supporting one upstream and four downstream ports at up to 480 Mbps. Ports 1–3 feed the SY6280-gated Stinger USB-A receptacles; port 4 feeds the RTL8152B Ethernet adapter |
| XTAL_HUB | Crystal | 12 MHz | 3225 package | 1 | Reference oscillator for the SL2.1A's PLL. 12 MHz is required by the SL2.1A; the hub generates its own 480 MHz HS clock internally |
| C_XTAL_A | Capacitor | 22pF | 0402 | 1 | Crystal load capacitor (XI pin). Together with C_XTAL_B and board parasitic capacitance, sets the crystal's effective load capacitance |
| C_XTAL_B | Capacitor | 22pF | 0402 | 1 | Crystal load capacitor (XO pin) |
| R_RBIAS | Resistor | 12kΩ | 0402 | 1 | RBIAS: sets the USB FS/HS differential driver bias current per the USB 2.0 specification |
| R_RST | Resistor | 10kΩ | 0402 | 1 | Pull-up on RST_N to 3V3_SYS. Keeps the hub out of reset during normal operation; a logic-low on this line would reset all four ports |
| R_CFG0 | Resistor | 10kΩ | 0402 | 1 | CFG0 configuration strap pulled to GND. Sets hub operating mode per the SL2.1A datasheet strap table |
| R_CFG1 | Resistor | 10kΩ | 0402 | 1 | CFG1 configuration strap pulled to 3V3 |
| R_CFG2 | Resistor | 10kΩ | 0402 | 1 | CFG2 configuration strap pulled to 3V3 |
| R_OC1–R_OC3 | Resistors | 10kΩ | 0402 | 3 | Over-current (OC_N) pull-ups for SY6280 FLAG lines. The SY6280 FLAG is open-drain; without these pull-ups the SL2.1A OC_N inputs would float and might assert spuriously |
| C_VDD_BULK | Capacitor | 10µF | 0805 | 1 | Bulk decoupling on VDD33 (the hub's 3.3V core supply) |
| C_VDD_BYP_A/B | Capacitors | 100nF | 0402 | 2 | High-frequency bypass decoupling on VDD33 (two caps at different locations for broadband noise rejection) |

---

## Subsystem B2 — RTL8152B USB–Ethernet

USB 2.0 to 100Base-TX Ethernet adapter integrated directly on-board. Connects from SL2.1A hub port 4 upstream, and drives the RJ45 MagJack downstream.

| Ref | Part | Value / MPN | Package | Qty | What it does |
|-----|------|-------------|---------|-----|--------------|
| U_ETH | RTL8152B | RTL8152B | QFN-32 | 1 | USB-to-Ethernet controller. Presents as a USB CDC Ethernet device to the Radxa SoC (no special driver required on Linux; uses cdc_ether or r8152). Drives 10/100Base-TX PHY signalling to the MagJack. VCC sourced from 3V3_CLEAN (LDO rail) to isolate it from Radxa SBC switching noise (ECO #2026-03-F) |
| XTAL_ETH | Crystal | 25 MHz | 3225 package | 1 | PHY clock reference for the RTL8152B. Note: 1 MHz beat frequency with the CC1101's 26 MHz crystal — place crystals >10mm apart to avoid heterodyne coupling into the RF front-end |
| C_XTAL_ETH_A/B | Capacitors | 22pF | 0402 | 2 | Crystal load capacitors |
| RJ45 | HR911105A MagJack | HR911105A | Through-hole | 1 | HanRun integrated-magnetics RJ45 jack. Contains the 100Base-TX isolation transformer and common-mode choke internally, plus dual LED indicators. Center taps (pins 4/5) are biased to 3V3_SYS to provide the DC operating point the PHY transformer requires (ECO #2026-03-E) |
| C_VDD_ETH_A/B | Capacitors | 100nF | 0402 | 2 | Bypass decoupling on RTL8152B VDD |
| C_VDD_ETH_BULK | Capacitor | 10µF | 0805 | 1 | Bulk decoupling on RTL8152B VDD |
| R_PSELF | Resistor | 0Ω | 0402 | 1 | PSELF strap to GND. Selects self-powered (vs. bus-powered) USB mode — the board supplies its own power, so PSELF must be tied low |
| R_XTALDET | Resistor | 0Ω | 0402 | 1 | XTALDET strap to VCC. Tells the RTL8152B that an external crystal is present (vs. using an external clock input) |

---

## Subsystem C — SY6280AAC Stinger Ports × 3

Three independent USB-A output ports each guarded by a SY6280 power-distribution switch. The SY6280 enforces a hardware-set current limit (ISET) and pulls FLAG low on an overcurrent event. All three ports are identical; the loop instantiates them as Port 1, 2, and 3.

| Ref | Part | Value / MPN | Package | Qty | What it does |
|-----|------|-------------|---------|-----|--------------|
| U_SW1–U_SW3 | SY6280AAC | SY6280AAC | SOT-23-5 | 3 | Power-distribution switch with adjustable current limit. Routes 5V_SYS to a USB-A VBUS pin when EN is asserted high. Asserts FLAG low (open-drain) when load current exceeds the ISET threshold. Rds_on < 90mΩ at 5V |
| USB_A1–USB_A3 | USB Type-A receptacle | — | USB-A Female | 3 | Downstream USB-A ports ("Stinger" ports). Provide 5V power and USB 2.0 data to attached peripherals |
| R_EN1–R_EN3 | Resistors | 10kΩ | 0402 | 3 | EN pull-ups to 3V3_SYS. The SY6280 EN pin is active-high; this pull-up ensures the port is ON by default and only turns off when the Radxa drives STINGER_EN_x low |
| R_FLAG1–R_FLAG3 | Resistors | 10kΩ | 0402 | 3 | FLAG pull-ups to 3V3_SYS. The FLAG output is open-drain active-low; this pull-up produces a logic-high idle state and a clean falling edge on overcurrent |
| C_SW_IN_BULK1–3 | Capacitors | 10µF | 0805 | 3 | Bulk input decoupling on each SY6280 IN pin |
| C_SW_IN_BYP1–3 | Capacitors | 100nF | 0402 | 3 | Bypass input decoupling |
| C_SW_OUT_BULK1–3 | Capacitors | 10µF | 0805 | 3 | Bulk output decoupling on each VBUS output |
| C_SW_OUT_BYP1–3 | Capacitors | 100nF | 0402 | 3 | Bypass output decoupling |
| R_ISET1–R_ISET3 | Resistors | 13kΩ | 0402 | 3 | ISET current-limit resistors. Formula: R_ISET = 6800 / I_OC → 6800 / 0.5A = 13.6kΩ → 13kΩ (E96 standard). Sets the overcurrent trip point to ~500mA per port — enough for modern USB peripherals, while keeping worst-case three-port load within the IP5328P's 3A continuous output (ECO #2026-03-H) |

---

## Subsystem D — ST7789V2 SPI Display

Connector interface for a 1.69-inch ST7789V2-based SPI display module. The display uses Radxa SPI3 (pins 19/21/23/24) for data and several GPIOs for control signals.

| Ref | Part | Value / MPN | Package | Qty | What it does |
|-----|------|-------------|---------|-----|--------------|
| J_SCREEN | 8-pin SIL connector | — | 2.54mm 1×8 | 1 | Interface connector for the ST7789V2 display module. Carries VCC (3V3_SYS), GND, SPI3_CLK, SPI3_MOSI, SPI3_CS (chip select), SCREEN_DC (data/command), SCREEN_RST (hardware reset), and SCREEN_BL (PWM backlight) |
| C_SCREEN_BYP | Capacitor | 100nF | 0402 | 1 | Bypass decoupling on the display module's VCC pin at the connector |

---

## Subsystem E — Analog Joystick + ADS1015 ADC

A 5-axis analog joystick module (two analog axes + pushbutton) with its analog outputs routed to a dedicated I2C ADC. Offloading the ADC frees the Radxa's SoC pins for I2S audio on pin 35, avoiding the I2S3_LRCK_M0 / ADC conflict.

| Ref | Part | Value / MPN | Package | Qty | What it does |
|-----|------|-------------|---------|-----|--------------|
| J_JOY | 5-pin connector | — | 2.54mm 1×5 | 1 | Joystick module connector. Carries VCC, GND, VRX (X-axis voltage 0–3.3V), VRY (Y-axis voltage 0–3.3V), and SW (digital button, active-low) |
| U_ADC | ADS1015 | ADS1015 | VSSOP-10 | 1 | TI 12-bit I2C ADC (effectively 11-bit with sign). Reads VRX and VRY from the joystick via its AIN0/AIN1 inputs. Communicates to the Radxa on I2C1 (pins 3/5). Coexists with the IP5328P telemetry on the same I2C bus (different addresses; no conflict) |
| R_SW_PU | Resistor | 10kΩ | 0402 | 1 | Pull-up on JOY_SW to 3V3_SYS. The joystick button is a simple mechanical contact to GND; this pull-up establishes a defined high level when the button is not pressed |
| C_JOY_BYP | Capacitor | 100nF | 0402 | 1 | Bypass decoupling on the joystick module's VCC pin |
| C_ADC_BYP | Capacitor | 100nF | 0402 | 1 | Bypass decoupling on ADS1015 VDD |

---

## Subsystem E2 — WS2812B RGB LEDs × 4

Four addressable RGB LEDs in a daisy-chain. The Radxa drives the chain on LED_DIN (pin 36) using a DMA-capable PWM peripheral (e.g., rpi_ws281x). Each LED requires its own local bypass capacitor.

| Ref | Part | Value / MPN | Package | Qty | What it does |
|-----|------|-------------|---------|-----|--------------|
| LED1–LED4 | WS2812B | WS2812B | PLCC4 (5×5mm) | 4 | Addressable RGB LEDs. Each LED contains a WS2811 driver IC and three colour dies in a single package. Each LED passes its data frame to the next in the chain via DOUT → DIN. Full white at 5V draws ~60mA per LED (240mA for all four) |
| C_LED1–C_LED4 | Capacitors | 100nF | 0402 | 4 | Local bypass caps on each LED's VDD pin. WS2812B draws current in sharp pulses when switching colours; a local cap prevents this from affecting neighbours in the chain |
| R_DIN_PU | Resistor | 1kΩ | 0402 | 1 | Pull-up on LED_DIN to 5V_SYS. If the Radxa GPIO is configured as open-drain by the OS driver, the idle state must reach ≥3.5V (WS2812B V_IH minimum); without this pull-up the first LED may latch into an incorrect colour on boot (ECO #2026-03-E) |

---

## Subsystem E3 — IR Blaster

Side-view 940nm IR LED with a logic-level MOSFET driver. Used for remote control transmission. The AO3400A is fully enhanced at 3.3V gate drive, unlike the 2N7002 it replaces.

| Ref | Part | Value / MPN | Package | Qty | What it does |
|-----|------|-------------|---------|-----|--------------|
| D_IR | VSMB294008 | VSMB294008 | PLCC2 (0603-equiv) | 1 | 940nm side-view SMD IR LED. Side-view package allows placement at the PCB edge for forward emission. Forward voltage Vf ≈ 1.5V at 100mA |
| Q_IR | AO3400A | AO3400A | SOT-23 | 1 | Logic-level N-channel MOSFET driver. Gate threshold Vgs_th = 0.45–1.0V → fully saturated at 3.3V GPIO drive (Rds_on < 50mΩ). The Radxa IR_GPIO output switches this FET to pulse current through the LED at carrier frequency (typically 38 kHz). Replaces the 2N7002 which required ~5V gate drive to saturate (ECO #2026-03-F) |
| R_IR | Resistor | 33Ω | 0402 | 1 | Series current-limiting resistor. Sets peak LED current: (5V − 1.5V) / 33Ω ≈ 106mA pulsed. Reduced from 100Ω (ECO #2026-03-A) for increased IR range. Firmware must keep duty cycle < 10% continuous to stay within LED average power rating |

---

## Subsystem F — 40-Pin Radxa Expansion Header

The physical interface to the Radxa Zero 3W SBC. All board subsystems connect to the SoC through this connector.

| Ref | Part | Value / MPN | Package | Qty | What it does |
|-----|------|-------------|---------|-----|--------------|
| J_RADXA | 2×20 pin header | — | 2.54mm 2×20 right-angle | 1 | Raspberry Pi HAT-compatible 40-pin expansion header. Carries 5V power (pins 2/4) to the SBC, receives 3.3V back (pins 1/17), and routes all signal interfaces: SPI3 display (pins 19/21/23/24), RF SoftSPI (pins 13/15/16/18), I2C1 (pins 3/5), I2S audio (pins 12/35/38/40), Stinger EN/FLAG GPIOs, SCREEN_BL/DC/RST, LED_DIN, JOY_SW |

---

## Subsystem G — NE555 Heartbeat / Dummy-Load

The IP5328P auto-shuts down when it detects no load for several seconds. This circuit pulses a ~61mA dummy load every ~15 seconds (SM-PWR-02), keeping the PMIC awake without wasting meaningful power.

| Ref | Part | Value / MPN | Package | Qty | What it does |
|-----|------|-------------|---------|-----|--------------|
| U_555 | NE555 | NE555 | DIP-8 | 1 | Classic astable timer IC. Configured as an astable multivibrator: R1=220kΩ, R2=150Ω, C=100µF → period ≈ 15 seconds, pulse width ≈ 100µs. The short high pulse triggers the PNP dummy load |
| Q_DUMMY | BC857 PNP BJT | BC857 | SOT-23 | 1 | PNP transistor driven by the NE555 output. When the 555 output goes high, the PNP base is pulled low via R_BASE, turning the transistor ON and routing current through R_DUMMY. Provides the heartbeat load pulse that prevents IP5328P auto-shutdown |
| R1_TMR | Resistor | 220kΩ | 0402 | 1 | 555 timing resistor (discharge path). Sets the long inter-pulse interval |
| R2_TMR | Resistor | 150Ω | 0402 | 1 | 555 timing resistor (charge path). Sets the short pulse duration |
| R_BASE | Resistor | 10kΩ | 0402 | 1 | PNP base resistor. Limits base current from the 555 output to the BC857 |
| R_DUMMY | Resistor | 82Ω | 0402 | 1 | Collector load resistor. 5V / 82Ω ≈ 61mA during the pulse — enough to register as a real load on the IP5328P VOUT measurement |
| C_TMR | Electrolytic capacitor | 100µF | 6mm diameter | 1 | 555 timing capacitor. Large value gives the ~15-second inter-pulse period |
| C_BYP_555 | Capacitor | 10nF | 0402 | 1 | Control-voltage bypass on the 555 pin 5. Prevents noise on the VCC rail from modulating the 555's internal 2/3 VCC threshold and introducing timing jitter |

---

## Subsystem H — CC1101 Sub-GHz RF Transceiver

915 MHz RF transceiver connected to the Radxa via bit-banged SoftSPI on safe GPIOs (pins 13/15/16/18). A Pi-network matching circuit transforms the CC1101 output impedance to the Johanson chip antenna input, maximising radiated power and receive sensitivity.

| Ref | Part | Value / MPN | Package | Qty | What it does |
|-----|------|-------------|---------|-----|--------------|
| U_RF | CC1101 | CC1101 | QFN-20 | 1 | Texas Instruments sub-GHz RF transceiver. Covers 300–928 MHz; configured for 915 MHz ISM band. SoftSPI interface on pins 13/15/16/18 (migrated off UART pins to prevent boot-console conflicts; ECO #2026-03-F). GDO0 is not routed to the header — firmware uses polling mode instead of interrupts. VDD sourced from 3V3_CLEAN |
| XTAL_RF | Crystal | 26 MHz | 3225 package | 1 | CC1101 PLL reference oscillator. Must be 26 MHz specifically for the internal frequency synthesiser. Note 1 MHz beat with the RTL8152B 25 MHz crystal — separate by >10mm on layout |
| C_XTAL_RF_A/B | Capacitors | 22pF | 0402 | 2 | Crystal load capacitors for the 26 MHz reference |
| R_RBIAS_RF | Resistor | 10kΩ | 0402 | 1 | RBIAS to GND. Sets the CC1101 internal bias current reference for the LNA and PA |
| C_VDD_RF_A/B/C | Capacitors | 100nF | 0402 | 3 | VDD bypass capacitors on the CC1101. Three caps at different locations on the VDD pin for broadband decoupling |
| C_RF1 | Capacitor | 0.5pF | 0402 | 1 | Pi-network C1: shunt from RF_P to GND. Provides initial impedance step-down from the CC1101 50Ω differential output toward the antenna matching point |
| L_RF1 | Inductor | 10nH | 0402 | 1 | Pi-network L1: series matching element. The series inductor resonates with the shunt capacitors at 915 MHz to maximise power transfer to the antenna |
| C_RF2 | Capacitor | 4.7pF | 0402 | 1 | Pi-network C2: output shunt from the antenna node to GND. Final harmonic filtering element; attenuates out-of-band harmonics before radiation |
| C_RFN | Capacitor | 1pF | 0402 | 1 | RF_N single-ended termination. The CC1101 uses a differential RF output; operating single-ended requires terminating RF_N with a small cap to GND per the datasheet application note |
| ANT | Johanson 0915AT43A0026 | 0915AT43A0026 | 0402 chip antenna | 1 | 915 MHz chip antenna. Integrated ceramic antenna optimised for the 915 MHz ISM band. Eliminates the need for an SMA connector and external antenna. Feedpoint connects to the Pi-network output (RF_ANT net) |

---

## Subsystem J — ISO1212 Industrial 24V Isolation

Two-channel isolated digital input circuit for reading 8–35V PLC/industrial field signals. The ISO1212 galvanically isolates the field side from the board ground. Each input has a full protection chain before reaching the IC.

| Ref | Part | Value / MPN | Package | Qty | What it does |
|-----|------|-------------|---------|-----|--------------|
| U_ISO | ISO1212 | ISO1212 | SOIC-16W | 1 | Dual-channel isolated digital input IC. Accepts 8–35V field signals, provides galvanic isolation (≥2.5kV from PCB GND to field GND), and outputs 3.3V CMOS logic levels on the board side for the Radxa GPIO to read |
| J_FIELD | WAGO 2060-404 | WAGO 2060-404 | 3.5mm pitch, 4-pos | 1 | Push-in terminal block for field wiring. Accepts solid or stranded wire up to 1.5mm². Carries ISO_GND1 (isolated field ground), ISO_VCC1 (field supply), ISO_IN1_RAW (channel 1), ISO_IN2_RAW (channel 2) |
| F_PTC1, F_PTC2 | PTC resettable fuse | 60R | 1206 | 2 | Littelfuse 60R per-channel series PTC. Holds current below 60mA at room temperature; trips (resistance rises to kΩ) on sustained fault currents. Self-resets when power is removed — no user intervention needed (IND-SAF-01) |
| D_TVS1, D_TVS2 | TVS diode | VCAN26A2 | DO-214AA (SMB) | 2 | Vishay VCAN26A2 bidirectional TVS clamping diode per channel. 26V clamp voltage per IEC 61000-4-5 surge requirements. Protects against inductive switching spikes from industrial loads (IND-SAF-01) |
| R_SER1, R_SER2 | Resistors | 562Ω 1% | 0402 | 2 | Series current-limiting resistors. In conjunction with R_THR, sets the steady-state input current and the IEC 61131-2 type 2 switching threshold |
| R_THR1, R_THR2 | Resistors | 1kΩ 1% | 0402 | 2 | Threshold shunt resistors to ISO_GND1. Sets the logic-1 / logic-0 switching threshold to comply with IEC 61131-2 type 2 input specifications. Also bleeds off static charge when the field supply is removed |
| C_FLT1, C_FLT2 | Capacitors | 10nF 100V X7R | 0402 | 2 | High-frequency noise filter capacitors to ISO_GND1. Attenuates fast transients and EMI above the signal bandwidth before the ISO1212 input pin |
| C_VCC1_BULK | Capacitor | 10µF | 0805 | 1 | Bulk decoupling on ISO_VCC1 (field-side supply) |
| C_VCC1_BYP | Capacitor | 100nF | 0402 | 1 | Bypass decoupling on ISO_VCC1 |
| C_VCC2_BYP | Capacitor | 100nF | 0402 | 1 | Bypass decoupling on ISO1212 VCC2 (logic-side 3.3V supply, sourced from 3V3_CLEAN) |

---

## Audio Subsystem — MAX98357A + INMP441

Separate netlist (`netlist/audio_subsystem.py`, generates `daemon_v0_audio.net`). Connects to the board via shared I2S net names (I2S_BCLK, I2S_LRCLK, I2S_DATA_OUT, I2S_DATA_IN) which are also broken out on the Radxa header in the main netlist. The Radxa Zero 3W is the I2S master.

### Amplifier / Microphone ICs

| Ref | Part | Value / MPN | Package | Qty | What it does |
|-----|------|-------------|---------|-----|--------------|
| U_AMP | MAX98357A | MAX98357A | TQFN-16 | 1 | Maxim/Analog I2S Class-D audio amplifier. Takes I2S digital audio from the Radxa on I2S_DATA_OUT (BCLK, LRCLK, DIN) and drives a speaker BTL (Bridge-Tied Load) with up to 3.2W into 4Ω. No separate MCLK required. SD_MODE pin sets gain / L/R mix configuration |
| U_MIC | INMP441 | INMP441 | LGA-6 | 1 | InvenSense omnidirectional MEMS I2S microphone. Outputs left-channel I2S data on I2S_DATA_IN. L/R pin pulled low → selects left-channel output. Shares BCLK and LRCLK with MAX98357A in parallel |

### Passives

| Ref | Part | Value / MPN | Package | Qty | What it does |
|-----|------|-------------|---------|-----|--------------|
| R_SD_MODE | Resistor | 633kΩ | 0402 | 1 | SM-LOG-03: SD_MODE pull-up to 3V3_SYS. The 633kΩ value is from the MAX98357A formula R = 222.2 × V_DDIO − 100 = 633kΩ at 3.3V. Must connect to 3V3 (not 5V) — a 5V pull-up with this resistor value would push SD_MODE into the wrong operating zone and lock the amplifier into channel-gain-select mode instead of the intended L/2+R/2 stereo-mix mode (ECO #2026-03-G) |
| R_MIC_LR | Resistor | 10kΩ | 0402 | 1 | INMP441 L/R channel select: pulled to GND → selects left-channel I2S output (WS low = left) |
| D_TVS_P | ESD9B5.0ST5G | ESD9B5.0ST5G | SC-70 | 1 | SM-AUD-01: TVS spike clamp on AMP_OUT_P. Protects against electrostatic discharge and inductive spikes from the speaker cable |
| D_TVS_N | ESD9B5.0ST5G | ESD9B5.0ST5G | SC-70 | 1 | SM-AUD-01: TVS spike clamp on AMP_OUT_N |
| FB_P | BLM18AG601SN1 | BLM18AG601SN1 | 0402 ferrite bead | 1 | SM-AUD-02: Ferrite bead on AMP_OUT_P. Impedance ~80Ω at 300 kHz (from Murata SimSurfing), forming an LC low-pass filter with C_FILT_P. Attenuates 300–500 kHz boost-converter switching noise that rides on the BTL output and would otherwise radiate from the speaker cable into the CC1101 RF front-end (ECO #2026-03-G) |
| FB_N | BLM18AG601SN1 | BLM18AG601SN1 | 0402 ferrite bead | 1 | SM-AUD-02: Same ferrite bead on AMP_OUT_N |
| C_FILT_P | Capacitor | 1nF | 0402 | 1 | Post-bead shunt capacitor on AMP_OUT_P_FILT to GND. Together with FB_P forms an LC filter with corner frequency f_c = 1/(2π × 80Ω × 1nF) ≈ 2 MHz — passes audio (≤20 kHz), kills switching noise |
| C_FILT_N | Capacitor | 1nF | 0402 | 1 | Same post-bead shunt on AMP_OUT_N_FILT |
| C_AMP_BYP_A/B | Capacitors | 100nF | 0402 | 2 | Bypass decoupling on MAX98357A VDD |
| C_MIC_BYP_A/B | Capacitors | 100nF | 0402 | 2 | Bypass decoupling on INMP441 VDD |
| R_DET_DEBOUNCE | Resistor | 10kΩ | 0402 | 1 | TRRS detect RC debounce resistor. Prevents headphone insertion/removal transients from registering as multiple events |
| C_DET_DEBOUNCE | Capacitor | 100nF | 0402 | 1 | TRRS detect RC debounce capacitor |

### Connectors

| Ref | Part | Value / MPN | Package | Qty | What it does |
|-----|------|-------------|---------|-----|--------------|
| J_TRRS | 3.5mm TRRS jack | SJ2-2531X-SMT | SMD 4-pole | 1 | TRRS (Tip/Ring1/Ring2/Sleeve) audio jack. Tip carries speaker positive (AMP_OUT_P_FILT); Ring1 carries speaker negative (AMP_OUT_N_FILT); Ring2 and Sleeve are GND. TipSwitch and Ring1Switch contacts switch when a plug is inserted, enabling headphone detection |
| J_SPK | Speaker connector | — | JST-SH 2-pin | 1 | 2-pin connector for a small internal speaker. Wires to the TRRS wiper contacts (Tip and Ring1) for the internal speaker path |

---

## Top-Level Assembly

| Ref | Part | Value / MPN | Package | Qty | What it does |
|-----|------|-------------|---------|-----|--------------|
| J_AUX | 4-pin header | — | 2.54mm 1×4 | 1 | Auxiliary GPIO header. Pin 1: ISO_DO1 (ISO1212 channel 1 output, 3.3V CMOS); Pin 2: ISO_DO2 (ISO1212 channel 2 output); Pin 3: IR_GPIO (IR blaster gate drive, active-high); Pin 4: GND. Provides a breakout for field interfacing and IR control from external logic |

---

## Component Count Summary

| Category | Count |
|----------|-------|
| ICs / active components | 14 |
| MOSFETs / BJTs | 4 |
| Crystals | 3 |
| Connectors / headers | 12 |
| Resistors | ~55 |
| Capacitors (ceramic) | ~55 |
| Capacitors (electrolytic / tantalum) | 2 |
| Inductors | 2 |
| Ferrite beads | 2 |
| Diodes (Schottky / TVS / IR LED) | 8 |
| Antennas | 1 |
| Test points | 4 |
| PTC fuses | 2 |
| Tactile switches / jumpers | 5 |
| **Total (approximate)** | **~173** |

---

*Generated from `netlist/full_system.py` and `netlist/audio_subsystem.py` — ECO #2026-03-GOLD.*
*All quantities are per-board. Loop-instantiated components (Stinger ports ×3, LEDs ×4) are shown at their total board count.*
