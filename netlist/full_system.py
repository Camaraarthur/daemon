"""
netlist/full_system.py
ECO #2026-02-V2 – Final Release SKiDL Netlist: Daemon V0

Instantiates and wires every subsystem in the Daemon V0 architecture:

  Subsystem A  – IP5328P Power Management
    · IP5328P (QFN-40): high-current boost converter + Li-ion charger + I2C telemetry
    · 4.7µH high-current boost inductor (Isat > 5A) on the SW node
    · DFT test points TP1–TP4 and 0Ω isolation jumpers J1/J2
    · KEY pin wired to PMIC_KEY net (shared with A6 power UX circuit)
    · LED1/LED2/LED3 REMOVED (ECO #2026-03-E: I2C bus clamping conflict)

  Subsystem A5 – Goobay 74446 USB-C Mechanical Bridge
    · USB-C receptacle (B.Cu placement; 8.4mm vertical pitch to Radxa)
    · Upstream D+/D− feed SL2.1A hub directly

  Subsystem B  – SL2.1A 4-Port USB 2.0 Hub
    · SL2.1A (QFN-28): full-speed / high-speed USB 2.0 hub controller
    · 12 MHz crystal + 22 pF load caps; 12 kΩ RBIAS
    · Ports 1–3 → Stinger ports; Port 4 → RTL8152B Ethernet

  Subsystem B2 – RTL8152B USB–Ethernet (NEW)
    · RTL8152B: USB 2.0 to 100Base-TX; PSELF=Low (bus-power), XTALDET=High
    · 25 MHz crystal reference
    · HanRun HR911105A MagJack; MDI TX+/TX−/RX+/RX− → RJ45 pins 1/2/3/6

  Subsystem A6 – Advanced Power UX (ECO #2026-03-D)
    · BSS84 PMOS wake-blocker: JOY_SW wakes when 5V OFF; isolated when ON
    · 2N7002 NMOS software kill: Radxa PMIC_KILL GPIO simulates double-tap
    · SW_PWR tactile button: always-on hard wake/sleep; SW_PWR_GPIO for long-press
    · 3-pin Power Management Header: PMIC_KILL / SW_PWR_GPIO / GND

  Subsystem C  – Stinger Ports (3 × SY6280AAC power-distribution switch)
    · One SY6280AAC (SOT-23-5) per user-accessible USB-A port
    · 5V_SYS → SY6280 IN → USB_VBUS_x; 13 kΩ ISET (~500 mA OC limit, ECO #2026-03-H)

  Subsystem D  – 1.69″ SPI Display
    · 8-pin SIL connector for ST7789V2-based display module
    · SCK / MOSI / CS from Radxa SPI3 bus (pins 19/21/23/24); BL → GPIO4 / pin 7 (hardware PWM)

  Subsystem E  – Analog Joystick + ADS1015 ADC
    · VRX / VRY → ADS1015 I2C ADC (I2C1 bus)
    · SW → Radxa GPIO (digital input, 10 kΩ pull-up)

  Subsystem E2 – WS2812B Smart RGB LEDs × 4 (NEW)
    · Daisy-chained; data-in on LED_DIN (Radxa header pin 36)
    · 100 nF bypass per LED; 5V_SYS supply

  Subsystem E3 – Stealth IR Blaster (NEW)
    · VSMB294008 side-view SMD IR LED; front-edge placement
    · AO3400A N-MOSFET driver (Gate = IR_GPIO, Drain = LED−, Source = GND; ECO #2026-03-F)

  Subsystem F  – 40-Pin Radxa Expansion Header
    · 2×20 P2.54 mm connector; Raspberry Pi HAT / Radxa pinout
    · All 40 pins named: power rails, SPI3 (display), SoftSPI (CC1101),
      I2C1 (pins 3/5), I2S/PCM, screen BL/DC/RST, Stinger EN/FLAG, LED_DIN

  Subsystem G  – NE555 Heartbeat / Dummy-Load (SM-PWR-02)

  Subsystem H  – CC1101 Sub-GHz RF Transceiver
    · SoftSPI bus; 26 MHz crystal
    · Johanson 0915AT43A0026 chip antenna; Pi-network (C=0.5pF, L=10nH, C=4.7pF)
    · NOTE: SMA connector removed per ECO #2026-02-V2

  Subsystem J  – ISO1212 Industrial 24V Isolation + WAGO 2060-404
    · WAGO 2060-404 4-pos terminal block replaces pin-header field connector
    · Full IND-SAF-01 protection chain maintained (PTC/TVS/R/R/C per channel)

  Subsystem K  – MAX98357A Audio Amplifier (audio_subsystem.py)
    · ESD9B5.0ST5G bidirectional TVS diodes on AMP_OUT_P / AMP_OUT_N
      (SM-AUD-01; confirmed present in audio_subsystem.py)

  NOTE: CAN Bus (MCP2515 / MCP2551) REMOVED per ECO #2026-02-V2.
  NOTE: Hardware Reset Switch (A4) REMOVED per ECO #2026-03-D; replaced by A6 power UX.

Power topology:
    Li-ion cell ──► IP5328P BAT ──► SW / inductor ──► VOUT
    VOUT ──[J2 0Ω]──► 5V_SYS ──► SL2.1A VCC, SY6280×3 IN, WS2812B, Radxa 5V
    5V_SYS ──► AP2112K-3.3 ──► 3V3_CLEAN ──► CC1101, RTL8152B, ISO1212 logic side
    Radxa header 3.3V ──► 3V3_SYS ──► screen VCC, joystick, pull-ups

Custom KiCad symbol library required (add to ./lib/Daemon_V0.kicad_sym):
    IP5328P, SL2.1A, SY6280AAC, RTL8152B, ISO1212

Usage:
    python -m netlist.full_system
    # → writes daemon_v0_full_system.net
"""

from __future__ import annotations

import sys
from pathlib import Path

try:
    import skidl
    from skidl import ERC, Net, Part, generate_netlist
    from skidl import TEMPLATE
except ModuleNotFoundError as exc:
    sys.exit(f"SKiDL not installed. Run: pip install skidl\n{exc}")

# ── KiCad 8 library setup ─────────────────────────────────────────────────────
# Add the project's custom symbol library directory so SKiDL can find
# Daemon_V0.kicad_sym (IP5328P, SL2.1A, SY6280AAC, RTL8152B, ISO1212, etc.)
_REPO = Path(__file__).resolve().parent.parent
_tool = skidl.get_default_tool()
_custom_lib = str(_REPO / "lib")
if _custom_lib not in skidl.lib_search_paths[_tool]:
    skidl.lib_search_paths[_tool].append(_custom_lib)

# ── Output ────────────────────────────────────────────────────────────────────

NETLIST_OUTPUT = "daemon_v0_full_system.net"

# ── Footprints ────────────────────────────────────────────────────────────────

# Power management
FP_IP5328P     = "Package_DFN_QFN:QFN-40-1EP_6x6mm_P0.5mm_EP4.6x4.6mm"
FP_INDUCTOR_5A = "Inductor_SMD:L_Bourns_SRR1260"  # 12.5×11.5mm package
# INDUCTOR MPN REQUIREMENT: must be TDK VLF12560T-4R7M7R9 (Isat=7.9A) or equiv.
# Peak inductor current: I_avg(3V→5V/2.46A,η=90%) + ΔI/2 = 4.56 + 0.34 = 4.90A
# Standard Bourns SRR1260-4R7Y has Isat≈4.3A — WILL SATURATE. Use VLF12560T only.
FP_LDO_SOT223  = "Package_TO_SOT_SMD:SOT-223-3_TabPin2"   # LM1117 (legacy; kept for reference)
FP_LDO_SOT23_5 = "Package_TO_SOT_SMD:SOT-23-5"            # AP2112K-3.3 (ECO #2026-03-GOLD)

# USB hub
FP_SL2_1A       = "Package_DFN_QFN:QFN-28-1EP_5x5mm_P0.5mm_EP3.35x3.35mm"
FP_XTAL_12M     = "Crystal:Crystal_SMD_3225-4Pin_3.2x2.5mm"
FP_USB_A_FEMALE = "Connector_USB:USB_A_Molex_67643_Horizontal"
FP_USB_A_MALE   = "Connector_USB:USB_A_CNCTech_1001-011-01101_Horizontal"

# Stinger switches
FP_SY6280       = "Package_TO_SOT_SMD:SOT-23-5"

# Connectors
# ECO #2026-03-HWR: Changed to female socket — mates with Radxa's male header pins
FP_RADXA_HDR    = "Connector_PinSocket_2.54mm:PinSocket_2x20_P2.54mm_Vertical"
FP_SCREEN_CONN  = "Connector_PinHeader_2.54mm:PinHeader_1x08_P2.54mm_Vertical"
FP_JOY_CONN     = "Connector_PinHeader_2.54mm:PinHeader_1x05_P2.54mm_Vertical"
FP_BAT_CONN     = "Connector_JST:JST_PH_S2B-PH-K_1x02_P2.00mm_Horizontal"

# DFT
FP_TP_D15       = "TestPoint:TestPoint_Pad_D1.5mm"
FP_TP_D10       = "TestPoint:TestPoint_Pad_D1.0mm"

# Passives
FP_R0402        = "Resistor_SMD:R_0402_1005Metric"
FP_C0402        = "Capacitor_SMD:C_0402_1005Metric"
FP_C0805        = "Capacitor_SMD:C_0805_2012Metric"
# SM-AUD-01: ESD9B5.0ST5G bidirectional TVS (ON Semi, SC-70-3 package)
FP_TVS_SC70     = "Package_TO_SOT_SMD:SOT-323_SC-70"
# IND-SAF-01: Vishay VCAN26A2 bidirectional TVS (SMB / DO-214AA)
FP_TVS_SMB      = "Diode_SMD:D_SMB"
# IND-SAF-01: Littelfuse 60R series resettable PTC fuse (1206)
FP_PTC_1206     = "Fuse:Fuse_1206_3216Metric"
# PDN-USB-01: SS14 Schottky diode (DO-214AC / SMA) for VBUS anti-backfeed
FP_SCHOTTKY_SMA = "Diode_SMD:D_SMA"
# HW-RST-01: Right-angle tactile switch, flush with board edge for ergonomics
# ECO #2026-03-HWR: Changed from top-press PTS645 to horizontal Alps SKRTLAE010
FP_SW_PUSH      = "Button_Switch_SMD:SW_Push_1P1T-MP_NO_Horizontal_Alps_SKRTLAE010"
# PDN-JMP-04: 1225 wide-terminal reverse-geometry shunt (≥3.5A rated)
FP_JUMPER_1225  = "Resistor_SMD:R_1210_3225Metric"
# SM-PWR-02: heartbeat keepalive components
# ECO #2026-03-HWR-B1: NE555 changed from DIP-8 to SOIC-8 (NE555DR) for
# turnkey SMT assembly. Electrolytic 100uF changed to tantalum SMD (Case-D)
# to eliminate through-hole deps and Z-height collision with Radxa stack.
FP_TIMER_NE555  = "Package_SO:SOIC-8_3.9x4.9mm_P1.27mm"
FP_BJT_SOT23    = "Package_TO_SOT_SMD:SOT-23"
FP_C_TMR_TANT   = "Capacitor_Tantalum_SMD:CP_EIA-7343-31_Kemet-D"

# Protocol analyzers and bus interfaces (Subsystems H–J)
FP_CC1101        = "Package_DFN_QFN:QFN-20-1EP_4x4mm_P0.5mm_EP2.6x2.6mm"
FP_ISO1212       = "Package_SO:SOIC-16W_7.5x10.3mm_P1.27mm"
FP_CONN_1X02_254 = "Connector_PinHeader_2.54mm:PinHeader_1x02_P2.54mm_Vertical"
FP_CONN_1X03_254 = "Connector_PinHeader_2.54mm:PinHeader_1x03_P2.54mm_Vertical"
FP_CONN_1X04_254 = "Connector_PinHeader_2.54mm:PinHeader_1x04_P2.54mm_Vertical"

# ECO #2026-02-V2: New subsystems
# A5: Goobay 74446 USB-C bridge (B.Cu; 8.85mm vertical pitch to Radxa)
FP_USB_C_RCPT   = "Connector_USB:USB_C_Receptacle_HRO_TYPE-C-31-M-12"
# B2: RTL8152B USB-to-Ethernet (QFN-32)
FP_RTL8152B     = "Package_DFN_QFN:QFN-32-1EP_5x5mm_P0.5mm_EP3.1x3.1mm"
# B2: HanRun HR911105A integrated-magnetics RJ45 MagJack
FP_MAGJACK      = "Connector_RJ:RJ45_Hanrun_HR911105A_Horizontal"
# B2: 25 MHz crystal for RTL8152B (same 3225-4Pin SMD package class)
FP_XTAL_25M     = "Crystal:Crystal_SMD_3225-4Pin_3.2x2.5mm"
# E2: WS2812B addressable RGB LED (PLCC4 5×5 mm)
FP_WS2812B      = "LED_SMD:LED_WS2812B_PLCC4_5.0x5.0mm_P3.2mm"
# E3: VSMB294008 side-view IR LED (SMD; front-edge placement)
FP_IR_LED       = "LED_SMD:LED_0603_1608Metric_Pad1.05x0.95mm_HandSolder"
# E3: AO3400A N-channel MOSFET (SOT-23; ECO #2026-03-F: replaced 2N7002)
FP_NFET_SOT23   = "Package_TO_SOT_SMD:SOT-23"
# A6: BSS84 P-channel MOSFET (SOT-23) for wake-blocker circuit
FP_PMOS_SOT23   = "Package_TO_SOT_SMD:SOT-23"
# J: WAGO 2060-404 4-position 3.5mm-pitch terminal block
FP_WAGO_4P      = "Daemon_V0:TerminalBlock_WAGO_2060-404_1x04_P4.00mm_Horizontal"
# H: Johanson 0915AT43A0026E4E chip antenna (915 MHz)
FP_CHIP_ANT_915 = "Daemon_V0:Antenna_Chip_Johanson_0915AT43A0026"
# ECO #2026-03-G: Power tank + thermal protection
FP_TANT_CASEB  = "Capacitor_Tantalum_SMD:CP_EIA-3528-21_Kemet-B"  # Case-B 3.5×2.8mm, 100µF 6.3V
FP_NTC_0402    = "Resistor_SMD:R_0402_1005Metric"                  # NTC thermistor (0402)

# ── SM-LOG-03: SD_MODE pull-up formula (mirrors netlist/audio_subsystem.py) ──
# MAX98357A datasheet: R_LARGE (kΩ) = 222.2 × V_DDIO − 100
# Keep in sync with audio_subsystem.py; any VDDIO domain change must update
# both files and regenerate the netlist.
VDDIO_V: float = 3.3
SD_MODE_PULLUP_KOHM: int = round(222.2 * VDDIO_V - 100)   # → 633 kΩ
SD_MODE_PULLUP_VALUE: str = f"{SD_MODE_PULLUP_KOHM}k"      # → "633k"


# ── Subsystem A: IP5328P Power Management ────────────────────────────────────


def _build_power_system(
    gnd: Net,
    vcc_5v: Net,
    i2c1_sda: Net,   # Radxa pin 3 – IP5328P SDA telemetry (I2C1, Always-On)
    i2c1_scl: Net,   # Radxa pin 5 – IP5328P SCL telemetry (I2C1, Always-On)
    key_net: Net,    # PMIC_KEY: shared with A6 power UX (PMOS/NMOS/SW_PWR)
) -> dict[str, Net]:
    """
    Instantiate the IP5328P boost converter / Li-ion charger subsystem.

    DFT nodes match dft/ip5306_testpoints.py exactly:
      TP1 → VIN     TP2 → BAT     TP3 → SW     TP4 → VOUT
      J1  → BAT_ISO (series on BAT line)
      J2  → VOUT_ISO (series on VOUT line; far side feeds 5V_SYS)

    Returns a dict of critical nets for use by the PySpice simulation phase.
    """
    Resistor  = Part("Device", "R", dest=TEMPLATE, footprint=FP_R0402)
    Capacitor = Part("Device", "C", dest=TEMPLATE, footprint=FP_C0402)
    Capacitor_bulk = Part("Device", "C", dest=TEMPLATE, footprint=FP_C0805)
    # PDN-JMP-04: 1225 wide-terminal package for primary-path isolation jumpers.
    # The 0402 package is rated 1.5A max; 1225 handles ≥3.5A without vaporising.
    HiCurrJumper = Part("Device", "R", dest=TEMPLATE, footprint=FP_JUMPER_1225)

    # ── IC ────────────────────────────────────────────────────────────────────
    ic = Part(
        "Daemon_V0", "IP5328P",
        footprint=FP_IP5328P,
        value="IP5328P",
    )

    # ── Boost inductor (SW node) ──────────────────────────────────────────────
    # BRINGUP-CRITICAL: inductor MPN must be TDK VLF12560T-4R7M7R9 (Isat=7.9A).
    # Peak current at worst-case load (3V battery, 2.46A out, 375kHz) = 4.90A.
    # Bourns SRR1260-4R7Y (Isat≈4.3A) WILL saturate → OCP loop or PMIC destruction.
    L1 = Part(
        "Device", "L",
        footprint=FP_INDUCTOR_5A,
        value="4u7",  # 4.7µH; MPN: TDK VLF12560T-4R7M7R9 (Isat=7.9A, Idc=5.0A)
    )

    # ── Battery connector (JST-PH 2-pin, Li-ion cell) ─────────────────────────
    bat_conn = Part(
        "Connector_Generic", "Conn_01x02",
        footprint=FP_BAT_CONN,
    )

    # ── DFT: test points ──────────────────────────────────────────────────────
    TP1 = Part("Connector", "TestPoint", footprint=FP_TP_D15, value="TP_VIN")
    TP2 = Part("Connector", "TestPoint", footprint=FP_TP_D15, value="TP_BAT")
    TP3 = Part("Connector", "TestPoint", footprint=FP_TP_D10, value="TP_SW")
    TP4 = Part("Connector", "TestPoint", footprint=FP_TP_D15, value="TP_VOUT")

    # ── DFT: 0Ω isolation jumpers ────────────────────────────────────────────
    J1 = HiCurrJumper(value="0")   # BAT  → BAT_ISO  (PDN-JMP-04: 1225 wide-terminal)
    J2 = HiCurrJumper(value="0")   # VOUT → VOUT_ISO (far side = 5V_SYS)

    # ── Passives ──────────────────────────────────────────────────────────────
    # MFB: 100 kΩ pull-up to VIN keeps the multi-function button inactive
    mfb_pullup = Resistor(value="100k")
    # ECO #2026-03-E: LED1/LED2/LED3 resistors REMOVED – IP5328P LED pins share
    # the same ball pads as I2C SDA/SCL on some package revisions; direct LED
    # loads clamp the bus below V_IH, blocking Radxa I2C telemetry reads.
    # Input decoupling: 10µF bulk + 100nF bypass on VIN
    cin_bulk = Capacitor_bulk(value="10u")
    cin_bypass = Capacitor(value="100n")
    # BAT decoupling
    cbat_bulk = Capacitor_bulk(value="10u")
    cbat_bypass = Capacitor(value="100n")
    # Output decoupling: 22µF bulk + 100nF bypass on VOUT (matches PySpice model)
    cout_bulk = Capacitor_bulk(value="22u")
    cout_bypass = Capacitor(value="100n")
    # SM-PDN-01: 100µF 6.3V tantalum power tank on 5V_SYS (ECO #2026-03-G)
    # Absorbs 4A transients during simultaneous SBC + RF + Ethernet + Stinger load steps,
    # preventing IP5328P OCP trip.  Case-B footprint (3.5×2.8mm) on back of boost node.
    tant_5v = Part("Device", "C_Polarized", footprint=FP_TANT_CASEB, value="100u")
    # SM-THM-01: 10kΩ NTC thermistor on IP5328P NTC pin (ECO #2026-03-G)
    # IC measures V_NTC = V_REF × R_NTC/(R_PULLUP + R_NTC) to derive junction temperature.
    # Hardware throttles the boost converter to prevent thermal runaway above Tj = 120°C.
    ntc = Part("Device", "Thermistor_NTC", footprint=FP_NTC_0402, value="10k")

    # ── Internal nets ─────────────────────────────────────────────────────────
    vin      = Net("VIN")        # 5V USB charge input
    bat      = Net("BAT")        # battery cell + terminal (raw)
    bat_iso  = Net("BAT_ISO")    # battery cell + terminal (isolated for ATE)
    sw       = Net("SW")         # 500 kHz DC-DC switch node
    vout     = Net("VOUT")       # raw boost output
    vout_iso = Net("VOUT_ISO")   # isolated boost output (far side of J2)
    mfb_net  = Net("MFB")

    # J2 far side feeds the system 5V bus
    vout_iso += vcc_5v

    # ── IC power ──────────────────────────────────────────────────────────────
    ic["VIN"]  += vin
    ic["BAT"]  += bat_iso         # BAT pin sits behind J1 isolation jumper
    ic["SW"]   += sw
    ic["VOUT"] += vout
    ic["MFB"]  += mfb_net
    ic["KEY"]  += key_net         # PMIC_KEY: A6 wake-blocker / kill / button

    # ECO #2026-03-F: 470Ω series protection prevents IP5328P from back-driving
    # the I2C1 bus when the CPU is unpowered (latch-up mitigation).
    # ECO #2026-03-H: Moved from I2C0 (pins 27/28, disconnected on Zero 3W) to
    # I2C1 (pins 3/5, Always-On bus shared with ADS1015 joystick ADC).
    # Thermal note: the QFN-40 exposed pad requires ≥ 16 thermal vias (0.3mm drill,
    # 0.6mm pad) to the inner GND plane to keep Tj < 85°C at 2.4A continuous.
    r_i2c_sda      = Resistor(value="470")
    r_i2c_scl      = Resistor(value="470")
    i2c1_pmic_sda  = Net("I2C1_PMIC_SDA")   # IP5328P SDA (protected side of series resistor)
    i2c1_pmic_scl  = Net("I2C1_PMIC_SCL")   # IP5328P SCL (protected side of series resistor)
    r_i2c_sda[1] += i2c1_sda          # Radxa header side (pin 3)
    r_i2c_sda[2] += i2c1_pmic_sda     # IP5328P side
    r_i2c_scl[1] += i2c1_scl          # Radxa header side (pin 5)
    r_i2c_scl[2] += i2c1_pmic_scl     # IP5328P side
    ic["SDA"]  += i2c1_pmic_sda        # IP5328P I2C telemetry (via 470Ω protection)
    ic["SCL"]  += i2c1_pmic_scl        # IP5328P I2C telemetry (via 470Ω protection)

    # ── Boost inductor: between SW node and VOUT ──────────────────────────────
    L1[1] += sw
    L1[2] += vout

    # ── Battery connector ─────────────────────────────────────────────────────
    bat_conn[1] += bat      # cell positive → BAT (before J1)
    bat_conn[2] += gnd      # cell negative

    # ── Isolation jumpers ────────────────────────────────────────────────────
    J1[1] += bat            # BAT (raw) → J1 → BAT_ISO → IC pin 6
    J1[2] += bat_iso
    J2[1] += vout           # VOUT (raw) → J2 → VOUT_ISO → 5V_SYS
    J2[2] += vout_iso

    # ── DFT test point connections ────────────────────────────────────────────
    TP1["1"] += vin
    TP2["1"] += bat         # probe raw BAT for charge-curve analysis
    TP3["1"] += sw
    TP4["1"] += vout

    # ── MFB pull-up ──────────────────────────────────────────────────────────
    mfb_pullup[1] += vin
    mfb_pullup[2] += mfb_net

    # ── VIN decoupling ────────────────────────────────────────────────────────
    cin_bulk[1]   += vin;  cin_bulk[2]   += gnd
    cin_bypass[1] += vin;  cin_bypass[2] += gnd

    # ── BAT decoupling ────────────────────────────────────────────────────────
    cbat_bulk[1]   += bat;  cbat_bulk[2]   += gnd
    cbat_bypass[1] += bat;  cbat_bypass[2] += gnd

    # ── VOUT decoupling ───────────────────────────────────────────────────────
    cout_bulk[1]   += vout;  cout_bulk[2]   += gnd
    cout_bypass[1] += vout;  cout_bypass[2] += gnd

    # SM-PDN-01: 100µF tantalum power tank across 5V_SYS (ECO #2026-03-G)
    tant_5v[1] += vcc_5v
    tant_5v[2] += gnd

    # SM-THM-01: NTC thermistor on IP5328P NTC pin (ECO #2026-03-G)
    ntc_net = Net("IP5328P_NTC")
    ic["NTC"] += ntc_net
    ntc[1]    += ntc_net   # hot end: junction of NTC sense node
    ntc[2]    += gnd       # cold end: GND reference

    return {"VIN": vin, "BAT": bat, "SW": sw, "VOUT": vout, "VOUT_ISO": vout_iso}


# ── Subsystem B: SL2.1A 4-Port USB 2.0 Hub ───────────────────────────────────


def _build_usb_hub(
    gnd: Net,
    vcc_5v: Net,
    vcc_3v3: Net,
) -> dict[str, list[Net]]:
    """
    Instantiate the SL2.1A USB 2.0 hub controller.

    Upstream D+/D− are returned for the Goobay USB-C bridge to connect.
    The USB-B connector is removed; the Goobay 74446 USB-C receptacle
    (B.Cu) provides the physical upstream port instead.

    Returns a dict with upstream pair and four downstream D+/D− net pairs:
        {"up": (UP_DP, UP_DM),
         "dn": [(DP1, DM1), (DP2, DM2), (DP3, DM3), (DP4, DM4)],
         "oc_n": [OC_N1, OC_N2, OC_N3]}
    """
    Resistor  = Part("Device", "R", dest=TEMPLATE, footprint=FP_R0402)
    Capacitor = Part("Device", "C", dest=TEMPLATE, footprint=FP_C0402)
    Capacitor_bulk = Part("Device", "C", dest=TEMPLATE, footprint=FP_C0805)

    # ── ICs ───────────────────────────────────────────────────────────────────
    hub = Part(
        "Daemon_V0", "SL2.1A",
        footprint=FP_SL2_1A,
        value="SL2.1A",
    )

    # 12 MHz crystal – SL2.1A requires external clock reference
    xtal = Part(
        "Device", "Crystal",
        footprint=FP_XTAL_12M,
        value="12MHz",
    )

    # NOTE: USB-B connector removed; upstream pair connects to Goobay
    # USB-C bridge (_build_goobay_bridge) which provides the physical port.

    # ── Passives ──────────────────────────────────────────────────────────────
    # Crystal load capacitors (22 pF each)
    cxtal_a, cxtal_b = Capacitor(num_copies=2, value="22p")

    # RBIAS: 12 kΩ from RBIAS pin to GND – sets USB signalling bias current
    rbias_res = Resistor(value="12k")

    # RST_N pull-up: 10 kΩ to 3V3_SYS keeps hub out of reset at power-on
    rst_pullup = Resistor(value="10k")

    # CFG strap resistors: pulled to GND (CFG0) and 3V3 (CFG1, CFG2) for
    # default 4-port, self-powered, no-gang-power configuration
    cfg0_pulldown = Resistor(value="10k")
    cfg1_pullup   = Resistor(value="10k")
    cfg2_pullup   = Resistor(value="10k")

    # OC_N pull-ups: 10 kΩ to 3V3 for each SY6280 FLAG line
    oc_pullup_1, oc_pullup_2, oc_pullup_3 = Resistor(num_copies=3, value="10k")

    # Power decoupling
    vdd_bulk   = Capacitor_bulk(value="10u")
    vdd_byp_a, vdd_byp_b = Capacitor(num_copies=2, value="100n")

    # ── Nets ──────────────────────────────────────────────────────────────────
    # Upstream USB pair (to Radxa host via USB-B connector)
    usb_up_dp = Net("USB_UP_DP")
    usb_up_dm = Net("USB_UP_DM")

    # Downstream pairs for the three Stinger ports + one for RTL8152B
    usb_dn_dp = [Net(f"USB_DN_DP_{i}") for i in range(1, 5)]
    usb_dn_dm = [Net(f"USB_DN_DM_{i}") for i in range(1, 5)]

    # Control nets
    rst_n  = Net("HUB_RST_N")
    susp_n = Net("HUB_SUSP_N")

    # OC_N / FLAG lines for the three Stinger ports
    oc_n = [Net(f"STINGER_FLAG_{i}") for i in range(1, 4)]

    # CFG nets
    cfg0 = Net("HUB_CFG0")
    cfg1 = Net("HUB_CFG1")
    cfg2 = Net("HUB_CFG2")

    # ── Hub IC connections ────────────────────────────────────────────────────
    hub["VDD33"]  += vcc_3v3
    hub["GND"]    += gnd

    # Upstream port
    hub["DP_U"]   += usb_up_dp
    hub["DM_U"]   += usb_up_dm

    # Downstream ports
    for i, (dp, dm) in enumerate(zip(usb_dn_dp, usb_dn_dm), start=1):
        hub[f"DP{i}"] += dp
        hub[f"DM{i}"] += dm

    # Crystal
    hub["XI"]     += Net("HUB_XI")
    hub["XO"]     += Net("HUB_XO")

    # Bias and control
    hub["RBIAS"]  += Net("HUB_RBIAS")
    hub["RST_N"]  += rst_n
    hub["SUSP_N"] += susp_n

    # Overcurrent inputs (active-low, from SY6280 FLAG open-drain)
    hub["OC_N1"]  += oc_n[0]
    hub["OC_N2"]  += oc_n[1]
    hub["OC_N3"]  += oc_n[2]
    hub["OC_N4"]  += vcc_3v3      # port 4 (RTL8152B) – no power switch needed

    # CFG straps
    hub["CFG0"]   += cfg0
    hub["CFG1"]   += cfg1
    hub["CFG2"]   += cfg2

    # SUSP_N – tie high; host-driven suspend not used in this design
    susp_n += vcc_3v3

    # ── Crystal + load capacitors ─────────────────────────────────────────────
    xtal[1]       += hub["XI"].net    # KiCad pin 1 = one terminal
    xtal[2]       += hub["XO"].net
    cxtal_a[1]    += hub["XI"].net;  cxtal_a[2] += gnd
    cxtal_b[1]    += hub["XO"].net;  cxtal_b[2] += gnd

    # ── RBIAS ────────────────────────────────────────────────────────────────
    rbias_res[1]  += hub["RBIAS"].net
    rbias_res[2]  += gnd

    # ── RST_N pull-up ─────────────────────────────────────────────────────────
    rst_pullup[1] += vcc_3v3
    rst_pullup[2] += rst_n

    # ── CFG straps ────────────────────────────────────────────────────────────
    cfg0_pulldown[1] += cfg0;  cfg0_pulldown[2] += gnd
    cfg1_pullup[1]   += vcc_3v3;  cfg1_pullup[2] += cfg1
    cfg2_pullup[1]   += vcc_3v3;  cfg2_pullup[2] += cfg2

    # ── OC_N pull-ups (FLAG lines are open-drain; need external pull-up) ──────
    oc_pullup_1[1] += vcc_3v3;  oc_pullup_1[2] += oc_n[0]
    oc_pullup_2[1] += vcc_3v3;  oc_pullup_2[2] += oc_n[1]
    oc_pullup_3[1] += vcc_3v3;  oc_pullup_3[2] += oc_n[2]

    # ── VDD33 decoupling ─────────────────────────────────────────────────────
    vdd_bulk[1]   += vcc_3v3;  vdd_bulk[2]   += gnd
    vdd_byp_a[1]  += vcc_3v3;  vdd_byp_a[2]  += gnd
    vdd_byp_b[1]  += vcc_3v3;  vdd_byp_b[2]  += gnd

    return {
        "up": (usb_up_dp, usb_up_dm),
        "dn": list(zip(usb_dn_dp, usb_dn_dm)),
        "oc_n": oc_n,
    }


# ── Subsystem C: Stinger Port (one SY6280AAC + USB-A) ────────────────────────


def _build_stinger_port(
    port_num: int,
    gnd: Net,
    vcc_5v: Net,
    vcc_3v3: Net,
    dp_net: Net,
    dm_net: Net,
    en_net: Net,
    flag_net: Net,
    usb_footprint: str = FP_USB_A_FEMALE,
) -> Net:
    """
    Instantiate one Stinger port: SY6280AAC power-distribution switch + USB-A.

    Power path:  5V_SYS → SY6280 IN → SY6280 OUT → USB_VBUS_<n>
    Data path:   dp_net / dm_net from SL2.1A downstream → USB-A connector

    The SY6280's automatic 150 Ω internal discharge path bleeds OUT
    capacitance on shutdown, preventing ghost-unplug events in downstream
    microcontrollers (proven by the PySpice τ assertion in Phase 3).

    EN  is driven HIGH by a Radxa GPIO to enable power (default ON via
        10 kΩ pull-up so the port stays live if the GPIO is tristated).
    FLAG is open-drain active-low; pulled to 3V3 via the hub OC pull-ups
        defined in _build_usb_hub.  Signals overcurrent / overtemperature.

    Returns the USB_VBUS_<n> net (the switched VBUS output).
    """
    Resistor  = Part("Device", "R", dest=TEMPLATE, footprint=FP_R0402)
    Capacitor = Part("Device", "C", dest=TEMPLATE, footprint=FP_C0402)
    Capacitor_bulk = Part("Device", "C", dest=TEMPLATE, footprint=FP_C0805)

    n = port_num

    # ── SY6280AAC power-distribution switch ───────────────────────────────────
    sw = Part(
        "Daemon_V0", "SY6280AAC",
        footprint=FP_SY6280,
        value="SY6280AAC",
    )

    # ── USB Type-A downstream connector ──────────────────────────────────────
    usb_a = Part(
        "Connector", "USB_A",
        footprint=usb_footprint,
    )

    # ── Passives ──────────────────────────────────────────────────────────────
    # EN pull-up: keeps port powered if Radxa GPIO is tristated at boot
    en_pullup = Resistor(value="10k")
    # FLAG pull-up: 10kΩ to 3V3_SYS keeps FLAG high (no fault) when GPIO tristated
    flag_pullup = Resistor(value="10k")
    # Input and output decoupling (10µF bulk + 100nF bypass each side)
    cin_bulk    = Capacitor_bulk(value="10u")
    cin_bypass  = Capacitor(value="100n")
    cout_bulk   = Capacitor_bulk(value="10u")     # matches PySpice SY_COUT model
    cout_bypass = Capacitor(value="100n")
    # ISET: 13 kΩ sets SY6280 over-current threshold to ~500mA (ECO #2026-03-H)
    # Formula: R_ISET = 6800 / I_OC → 6800 / 0.5 = 13600 Ω ≈ 13kΩ (E96 std)
    iset_res = Resistor(value="13k")

    # ── Nets ──────────────────────────────────────────────────────────────────
    vbus_out = Net(f"USB_VBUS_{n}")     # switched VBUS to the USB-A receptacle
    iset_net = Net(f"STINGER_ISET_{n}")  # ISET current-sense node

    # ── SY6280 connections ────────────────────────────────────────────────────
    sw["IN"]   += vcc_5v
    sw["GND"]  += gnd
    sw["EN"]   += en_net
    sw["FLAG"] += flag_net
    sw["OUT"]  += vbus_out
    sw["ISET"] += iset_net

    # ── ISET resistor: ISET pin → 13kΩ → GND (limits I_OC to ~500mA) ────────
    iset_res[1] += iset_net
    iset_res[2] += gnd

    # ── EN pull-up ────────────────────────────────────────────────────────────
    en_pullup[1] += vcc_3v3
    en_pullup[2] += en_net

    # ── FLAG pull-up ─────────────────────────────────────────────────────────
    flag_pullup[1] += vcc_3v3
    flag_pullup[2] += flag_net

    # ── USB-A connector ───────────────────────────────────────────────────────
    usb_a["VBUS"]   += vbus_out
    usb_a["D-"]     += dm_net
    usb_a["D+"]     += dp_net
    usb_a["GND"]    += gnd
    usb_a["Shield"] += gnd

    # ── Decoupling ────────────────────────────────────────────────────────────
    cin_bulk[1]    += vcc_5v;   cin_bulk[2]    += gnd
    cin_bypass[1]  += vcc_5v;   cin_bypass[2]  += gnd
    cout_bulk[1]   += vbus_out; cout_bulk[2]   += gnd
    cout_bypass[1] += vbus_out; cout_bypass[2] += gnd

    return vbus_out


# ── Subsystem D: 1.47″ SPI Display ───────────────────────────────────────────


def _build_spi_screen(
    gnd: Net,
    vcc_3v3: Net,
    spi_sck: Net,
    spi_mosi: Net,
    screen_cs: Net,
    screen_dc: Net,
    screen_rst: Net,
    screen_bl: Net,
) -> None:
    """
    Instantiate the 8-pin connector for the 1.69″ ST7789V2 SPI display module.

    Pin assignment (SIL-8, left to right on the module header):
      1: VCC   2: GND   3: SCL   4: SDA   5: RES   6: DC   7: CS   8: BLK

    SCL / SDA here are the SPI clock and MOSI lines (the ST7789 is
    write-only; no MISO is needed).  BLK accepts PWM from GPIO4 / pin 7
    (hardware PWM) for flicker-free brightness control.
    """
    Capacitor = Part("Device", "C", dest=TEMPLATE, footprint=FP_C0402)

    conn = Part(
        "Connector_Generic", "Conn_01x08",
        footprint=FP_SCREEN_CONN,
    )
    bypass = Capacitor(value="100n")

    # ── Connector wiring ─────────────────────────────────────────────────────
    conn[1] += vcc_3v3    # VCC
    conn[2] += gnd        # GND
    conn[3] += spi_sck    # SCL (SPI clock)
    conn[4] += spi_mosi   # SDA (SPI MOSI – write-only display)
    conn[5] += screen_rst # RES (reset, active low)
    conn[6] += screen_dc  # DC  (data/command select)
    conn[7] += screen_cs  # CS  (chip select, active low)
    conn[8] += screen_bl  # BLK (backlight PWM)

    # ── Power bypass ─────────────────────────────────────────────────────────
    bypass[1] += vcc_3v3
    bypass[2] += gnd


# ── Subsystem E: Analog Joystick ──────────────────────────────────────────────


def _build_joystick(
    gnd: Net,
    vcc_3v3: Net,
    joy_vrx: Net,
    joy_vry: Net,
    joy_sw: Net,
    i2c1_sda: Net,
    i2c1_scl: Net,
) -> None:
    """
    Instantiate the 5-pin connector for the analog thumbstick module.

    Pin assignment (SIL-5):
      1: GND   2: VCC   3: VRX   4: VRY   5: SW

    VRX / VRY are mid-rail (~1.65 V at rest) analog voltages routed to
    ADC-capable pins on the Radxa header (pins 35 and 40 on Radxa boards
    that expose the SoC ADC on the 40-pin header; otherwise an external
    ADS1015 I2C ADC should be added to the I2C1 bus).

    SW is active-low; a 10 kΩ pull-up to 3V3_SYS is added on-board so the
    Radxa GPIO reads logic-1 at rest and logic-0 when the stick is pressed.
    """
    Resistor  = Part("Device", "R", dest=TEMPLATE, footprint=FP_R0402)
    Capacitor = Part("Device", "C", dest=TEMPLATE, footprint=FP_C0402)

    conn      = Part("Connector_Generic", "Conn_01x05", footprint=FP_JOY_CONN)
    sw_pullup = Resistor(value="10k")
    vcc_bypass = Capacitor(value="100n")

    # ── TI ADS1015 I2C ADC ────────────────────────────────────────────────────
    adc = Part(
        "Analog_ADC", "ADS1015IDGS",
        footprint="Package_SO:VSSOP-10_3x3mm_P0.5mm",
        value="ADS1015",
    )
    adc_bypass = Capacitor(value="100n")

    # ── Connector wiring ─────────────────────────────────────────────────────
    conn[1] += gnd
    conn[2] += vcc_3v3
    conn[3] += joy_vrx
    conn[4] += joy_vry
    conn[5] += joy_sw

    # ── ADC wiring ───────────────────────────────────────────────────────────
    adc["VDD"] += vcc_3v3
    adc["GND"] += gnd
    adc["SDA"] += i2c1_sda
    adc["SCL"] += i2c1_scl
    adc["ADDR"] += gnd         # I2C Address = 0x48
    adc["AIN0"] += joy_vrx
    adc["AIN1"] += joy_vry
    adc["AIN2"] += gnd         # Unused
    adc["AIN3"] += gnd         # Unused
    adc["ALERT/RDY"] += Net("ADC_ALERT")

    adc_bypass[1] += vcc_3v3
    adc_bypass[2] += gnd

    # ── SW pull-up ───────────────────────────────────────────────────────────
    sw_pullup[1] += vcc_3v3
    sw_pullup[2] += joy_sw

    # ── VCC bypass ───────────────────────────────────────────────────────────
    vcc_bypass[1] += vcc_3v3
    vcc_bypass[2] += gnd


# ── Subsystem F: 40-Pin Radxa Expansion Header ────────────────────────────────


def _build_radxa_header(
    gnd:        Net,
    vcc_5v:     Net,
    vcc_3v3:    Net,
    # I2S / PCM (audio subsystem shared bus)
    i2s_bclk:   Net,
    i2s_lrclk:  Net,
    i2s_din:    Net,
    i2s_dout:   Net,
    # SPI0 bus (screen)
    spi_sck:    Net,
    spi_mosi:   Net,
    spi_miso:   Net,
    screen_cs:  Net,
    # Screen control GPIOs
    screen_dc:  Net,
    screen_rst: Net,
    screen_bl:  Net,
    # Joystick button (VRX/VRY are handled by ADS1015 on I2C1; only SW on header)
    joy_sw:     Net,
    # SoftSPI bus (bit-banged; CC1101 on free GPIOs to avoid SPI0 collision)
    soft_spi_sck:  Net,   # SOFT_SPI_SCK  → pin 32 (GPIO12)
    soft_spi_mosi: Net,   # SOFT_SPI_MOSI → pin 8  (GPIO14)
    soft_spi_miso: Net,   # SOFT_SPI_MISO → pin 10 (GPIO15)
    # Stinger port enable / flag GPIOs
    stinger_en:   list[Net],   # len == 3
    stinger_flag: list[Net],   # len == 3
    # I2C1 bus (general peripherals + IP5328P telemetry – pins 3/5)
    i2c1_sda:   Net,
    i2c1_scl:   Net,
    # SPI chip selects / interrupts for protocol analyzer subsystems (H, J)
    rf_cs_n:    Net,    # CC1101 SPI chip select      (pin 26)
    rf_gdo0:    Net,    # CC1101 GDO0 packet interrupt (pin 16)
    # ECO #2026-02-V2: CAN bus removed; pin 36 → WS2812B LED data chain
    led_din:    Net,    # WS2812B data chain DIN       (pin 36)
) -> None:
    """
    Instantiate the 2×20 Radxa expansion header and name every pin.

    Physical layout (Raspberry Pi / Radxa compatible):
    ┌────┬─────────────────────────────────┬────┐
    │  1 │ 3V3_SYS              5V_SYS     │  2 │
    │  3 │ I2C1_SDA (GPIO2)     5V_SYS     │  4 │
    │  5 │ I2C1_SCL (GPIO3)     GND        │  6 │
    │  7 │ SCREEN_BL (GPIO4)    STINGER_FLAG_2│  8 │
    │  9 │ GND                  STINGER_FLAG_3│ 10 │
    │ 11 │ STINGER_FLAG_1       I2S_BCLK   │ 12 │
    │ 13 │ RF_MOSI (SoftSPI)    GND        │ 14 │
    │ 15 │ RF_MISO (SoftSPI)    RF_CLK     │ 16 │
    │ 17 │ 3V3_SYS              RF_CS_N    │ 18 │
    │ 19 │ SPI3_MOSI            GND        │ 20 │
    │ 21 │ SPI3_MISO            SCREEN_RST │ 22 │
    │ 23 │ SPI3_CLK             SPI3_CS    │ 24 │
    │ 25 │ GND                  NC/GND     │ 26 │
    │ 27 │ NC/GND               NC/GND     │ 28 │
    │ 29 │ STINGER_EN_1         GND        │ 30 │
    │ 31 │ STINGER_EN_2         SCREEN_DC  │ 32 │
    │ 33 │ STINGER_EN_3         GND        │ 34 │
    │ 35 │ I2S_LRCLK (I2S excl.) LED_DIN  │ 36 │
    │ 37 │ JOY_SW   (GPIO26)    I2S_DATA_IN│ 38 │
    │ 39 │ GND                  I2S_DATA_OUT│ 40 │
    └────┴─────────────────────────────────┴────┘

    Notes:
    · Pin 7  (GPIO4): hardware-PWM-capable; SCREEN_BL for flicker-free backlight.
    · Pins 13/15/16/18 (ECO #2026-03-F): RF SoftSPI on safe GPIOs, away from UART
      pins 8/10. Separating from SPI3 (pins 19/21/23) eliminates CS conflicts.
      RF_GDO0 is NOT on any header pin (CC1101 polling mode).
    · Pin 36 (GPIO16): LED_DIN – WS2812B addressable LED data chain (ECO #2026-02-V2).
    · Pin 35 (I2S3_LRCK_M0): exclusively I2S_LRCLK; joystick VRX/VRY offloaded
      to ADS1015 on I2C1 so audio and ADC run concurrently.
    · Pins 8/10/11 carry open-drain SY6280 FLAG signals (10 kΩ pull-ups in _build_stinger_port).
    · ECO #2026-03-H: Pins 27/28 (I2C0) are NC/GND — disconnected on Zero 3W.
      IP5328P I2C telemetry on pins 3/5 (I2C1, Always-On, 470Ω protection).
    · PIN LOCK — NO OVERLAP CONFIRMED:
        Screen  = SPI3  (pins 19/21/23/24 — SPI3_MOSI/MISO/CLK/CS)
        Audio   = I2S0  (pins 12/35/38/40 — PCM_CLK/LRCK/DIN/DOUT)
        RF      = SoftSPI (pins 13/15/16 + CS on 18)
        I2C1    = pins 3/5 (ADS1015 + IP5328P; shared bus, different addresses)
    """

    conn = Part(
        "Connector_Generic", "Conn_02x20_Odd_Even",
        footprint=FP_RADXA_HDR,
    )

    # ── Odd column (pins 1, 3, 5 … 39) ───────────────────────────────────────
    conn[1]  += vcc_3v3
    # BRINGUP-CRITICAL: GPIO0_B3/B4 (I2C1 SDA/SCL) are on the RK3566 GPIO0 bank.
    # Probe pin 3 and pin 5 under power to confirm VCCIO voltage.
    # If VCCIO = 1.8V: ADS1015 V_IH(min) = 2.31V will never be met → bus dead.
    # Fix: insert TXS0102 bidirectional level shifter between header and I2C bus.
    # If VCCIO = 3.3V: no action required.
    # Additionally: disable Radxa internal pull-ups in device tree (i2c1 node);
    # rely solely on IP5328P internal 4.7kΩ pull-ups to avoid over-driving the bus.
    conn[3]  += i2c1_sda
    conn[5]  += i2c1_scl
    conn[7]  += screen_bl         # SCREEN_BL → GPIO4 (hardware PWM)
    conn[9]  += gnd
    conn[11] += stinger_flag[0]   # STINGER_FLAG_1 (SY6280 port 1 FLAG)
    conn[13] += soft_spi_mosi     # RF_MOSI (ECO #2026-03-F: safe GPIO; was pin 8 UART TX)
    conn[15] += soft_spi_miso     # RF_MISO (ECO #2026-03-F: safe GPIO; was pin 10 UART RX)
    conn[17] += vcc_3v3
    conn[19] += spi_mosi          # SPI3_MOSI → screen SDA
    conn[21] += spi_miso          # SPI3_MISO (unused by screen; available)
    conn[23] += spi_sck           # SPI3_CLK  → screen SCL
    conn[25] += gnd
    conn[27] += gnd               # NC/GND (ECO #2026-03-H: was I2C0_SDA; pin disconnected on Zero 3W)
    conn[29] += stinger_en[0]     # STINGER_EN_1 → SY6280 port 1 EN
    conn[31] += stinger_en[1]     # STINGER_EN_2
    conn[33] += stinger_en[2]     # STINGER_EN_3
    conn[35] += i2s_lrclk         # I2S3_LRCK_M0 exclusively
    conn[37] += joy_sw            # JOY_SW (GPIO26)
    conn[39] += gnd

    # ── Even column (pins 2, 4, 6 … 40) ──────────────────────────────────────
    conn[2]  += vcc_5v
    conn[4]  += vcc_5v
    conn[6]  += gnd
    conn[8]  += stinger_flag[1]   # STINGER_FLAG_2 (ECO #2026-03-F: displaced from pin 13)
    conn[10] += stinger_flag[2]   # STINGER_FLAG_3 (ECO #2026-03-F: displaced from pin 15)
    conn[12] += i2s_bclk          # PCM_CLK / I2S BCLK
    conn[14] += gnd
    conn[16] += soft_spi_sck      # RF_CLK (ECO #2026-03-F: moved from pin 32; RF_GDO0 removed)
    conn[18] += rf_cs_n           # RF_CS_N (ECO #2026-03-F: moved from pin 26 to safe GPIO)
    conn[20] += gnd
    conn[22] += screen_rst        # SCREEN_RST (GPIO25)
    conn[24] += screen_cs         # SPI3_CS0 → screen CS
    conn[26] += gnd               # NC/GND (ECO #2026-03-F: was RF_CS_N; Radxa SoC pin NC)
    conn[28] += gnd               # NC/GND (ECO #2026-03-H: was I2C0_SCL; pin disconnected on Zero 3W)
    conn[30] += gnd
    conn[32] += screen_dc         # SCREEN_DC (ECO #2026-03-F: moved from pin 18; pin 32 freed)
    conn[34] += gnd
    conn[36] += led_din           # LED_DIN – WS2812B data chain (Subsystem E2)
    conn[38] += i2s_din           # PCM_DIN / I2S data in (microphone)
    conn[40] += i2s_dout          # PCM_DOUT / I2S data out (amplifier)


# ── Subsystem G: NE555 heartbeat / dummy-load (SM-PWR-02) ────────────────────


def _build_heartbeat_keepalive(gnd: Net, vcc_5v: Net) -> None:
    """
    SM-PWR-02 – Hardware keepalive to defeat the IP5328P auto-shutdown feature.

    The IP5328P enters standby when the average load is <45mA for 32 seconds.
    This astable 555 circuit periodically asserts a 61mA dummy load for ~10ms
    every ~15 seconds, keeping the converter active without draining the battery.

    Timing (astable mode):
      R1  = 220kΩ, R2 = 150Ω, C_tmr = 100µF
      t_HIGH = 0.693 × (R1 + R2) × C  ≈ 15.24 s  (555 OUT high, PNP OFF = no load)
      t_LOW  = 0.693 × R2 × C         ≈  10.4 ms  (555 OUT low,  PNP ON  = 61mA)

    Dummy-load path (PNP BJT, BC857 SOT-23):
      5V_SYS → Emitter
             → Base: 10kΩ base resistor driven by 555 OUT (active-low, PNP)
             → Collector: 82Ω → GND   (5V / 82Ω ≈ 61mA > 50mA requirement)
    """
    Resistor       = Part("Device", "R", dest=TEMPLATE, footprint=FP_R0402)
    Capacitor      = Part("Device", "C", dest=TEMPLATE, footprint=FP_C0402)
    Capacitor_tant = Part("Device", "C_Polarized", dest=TEMPLATE, footprint=FP_C_TMR_TANT)

    # ── NE555 timer IC ────────────────────────────────────────────────────────
    timer = Part(
        "Timer", "NE555D",
        footprint=FP_TIMER_NE555,
        value="NE555DR",
    )

    # ── PNP BJT dummy-load switch (BC857 SOT-23) ──────────────────────────────
    pnp = Part(
        "Device", "Q_PNP_EBC",
        footprint=FP_BJT_SOT23,
        value="BC857",
    )

    # ── Timing resistors ──────────────────────────────────────────────────────
    r1_tmr = Resistor(value="220k")   # R1: sets discharge interval (~15.24 s)
    r2_tmr = Resistor(value="150")    # R2: sets pulse width (~10.4 ms)

    # ── Dummy-load resistors ──────────────────────────────────────────────────
    r_base  = Resistor(value="10k")   # base drive; limits I_B from 555 OUT
    r_dummy = Resistor(value="82")    # collector load: 5V / 82Ω ≈ 61mA

    # ── Timing capacitor ─────────────────────────────────────────────────────
    c_tmr = Capacitor_tant(value="100u")   # 100µF SMD tantalum timing cap (Case-D)
    c_byp = Capacitor(value="10n")         # control-voltage bypass (pin 5)

    # ── Internal nets ─────────────────────────────────────────────────────────
    tmr_out  = Net("HB_TMR_OUT")    # 555 output (pin 3)
    tmr_ctrl = Net("HB_TMR_CTRL")  # 555 control voltage (pin 5 bypass to GND)
    tmr_thr  = Net("HB_TMR_THR")   # threshold / trigger / discharge junction

    # ── 555 power ─────────────────────────────────────────────────────────────
    timer["VCC"]  += vcc_5v
    timer["GND"]  += gnd
    timer["R"]    += vcc_5v   # active-low RESET tied high → free-running

    # ── Astable RC network ────────────────────────────────────────────────────
    # 5V_SYS → R1 → junction(THR/TRG/DIS) → R2 → C_tmr → GND
    r1_tmr[1] += vcc_5v
    r1_tmr[2] += tmr_thr
    r2_tmr[1] += tmr_thr
    r2_tmr[2] += tmr_thr   # DIS open-drain also pulls this node

    timer["THR"]  += tmr_thr
    timer["TR"]   += tmr_thr
    timer["DIS"]  += tmr_thr
    c_tmr[1] += tmr_thr
    c_tmr[2] += gnd

    # ── Control-voltage bypass ────────────────────────────────────────────────
    timer["CV"]  += tmr_ctrl
    c_byp[1]     += tmr_ctrl
    c_byp[2]     += gnd

    # ── 555 output → PNP base ─────────────────────────────────────────────────
    timer["Q"]   += tmr_out
    r_base[1]    += tmr_out
    r_base[2]    += pnp["B"]

    # ── PNP BJT dummy-load path ───────────────────────────────────────────────
    pnp["E"]   += vcc_5v       # emitter sourced from 5V_SYS
    pnp["C"]   += r_dummy[1]   # collector drives dummy resistor
    r_dummy[2] += gnd          # 5V / 82Ω ≈ 61mA > 50mA IP5306 keepalive threshold


# ── Subsystem A2: LM1117-3.3 Clean 3.3V Rail (RF/CAN isolation) ──────────────


def _build_clean_3v3_rail(gnd: Net, vcc_5v: Net) -> Net:
    """
    LDO regulator: 5V_SYS → 3V3_CLEAN.

    Isolates CC1101 and RTL8152B from the Radxa SBC's noisy switching-regulator
    output (3V3_SYS).

    ECO #2026-03-GOLD: Upgraded from LM1117-3.3 (SOT-223, 1.25V dropout) to
    AP2112K-3.3 (SOT-23-5, 250mV dropout, 600mA).  The low-dropout design keeps
    3V3_CLEAN stable when 5V_SYS sags to 3.55V during Stinger + RF transient
    load spikes — the LM1117 would drop out at 5V − 1.25V = 3.75V minimum,
    risking CC1101 brownout.  EN pin tied to VIN for always-on operation.
    """
    Capacitor      = Part("Device", "C", dest=TEMPLATE, footprint=FP_C0402)
    Capacitor_bulk = Part("Device", "C", dest=TEMPLATE, footprint=FP_C0805)

    ldo = Part(
        "Regulator_Linear", "AP2112K-3.3",
        footprint=FP_LDO_SOT23_5,
        value="AP2112K-3.3",
    )

    cin_bulk    = Capacitor_bulk(value="10u")
    cin_bypass  = Capacitor(value="100n")
    cout_bulk   = Capacitor_bulk(value="10u")
    cout_bypass = Capacitor(value="100n")

    vcc_clean = Net("3V3_CLEAN")

    ldo["VIN"]  += vcc_5v
    ldo["VOUT"] += vcc_clean
    ldo["GND"]  += gnd
    ldo["EN"]   += vcc_5v    # EN high → always-on (tie to VIN)

    cin_bulk[1]    += vcc_5v;    cin_bulk[2]    += gnd
    cin_bypass[1]  += vcc_5v;    cin_bypass[2]  += gnd
    cout_bulk[1]   += vcc_clean; cout_bulk[2]   += gnd
    cout_bypass[1] += vcc_clean; cout_bypass[2] += gnd

    return vcc_clean


# ── Subsystem A3: USB Charging MUX Hardening (PDN-USB-01) ────────────────────


def _build_usb_charging_mux(gnd: Net, vcc_5v: Net) -> Net:
    """
    PDN-USB-01 – Harden the USB charging MUX against host-to-host backfeeding.

    Two SS14 Schottky diodes (DO-214AC / SMA) form an OR-diode from VBUS_A and
    VBUS_C into MUX_VIN, preventing a powered host on one port from backfeeding
    through the MUX body diode into a host on the other port.

    A resistor voltage divider sets the MUX_SEL logic level to ~2.95 V from the
    5 V_SYS rail, satisfying the USB MUX IC's VIH threshold without requiring a
    separate LDO:
        V_SEL = 5 V × 620k / (430k + 620k) ≈ 2.952 V
    """
    Resistor = Part("Device", "R", dest=TEMPLATE, footprint=FP_R0402)
    Diode    = Part("Device", "D_Schottky", dest=TEMPLATE, footprint=FP_SCHOTTKY_SMA)

    # ── SS14 Schottky anti-backfeed diodes ────────────────────────────────────
    d_vbus_a = Diode(value="SS14")   # VBUS_A → MUX_VIN
    d_vbus_c = Diode(value="SS14")   # VBUS_C → MUX_VIN

    # ── MUX_SEL voltage divider (5V → ~2.95V) ────────────────────────────────
    r_series = Resistor(value="430k")   # series arm
    r_shunt  = Resistor(value="620k")   # shunt arm

    # ── Nets ──────────────────────────────────────────────────────────────────
    vbus_a  = Net("VBUS_A")    # upstream VBUS from host port A
    vbus_c  = Net("VBUS_C")    # upstream VBUS from host port C
    mux_vin = Net("MUX_VIN")   # OR-diode output into MUX common input
    mux_sel = Net("MUX_SEL")   # logic-level select: ~2.95 V

    # ── Schottky OR-diode connections ─────────────────────────────────────────
    d_vbus_a["A"] += vbus_a;  d_vbus_a["K"] += mux_vin
    d_vbus_c["A"] += vbus_c;  d_vbus_c["K"] += mux_vin

    # ── Voltage divider: 5V_SYS → 430kΩ → MUX_SEL → 620kΩ → GND ────────────
    r_series[1] += vcc_5v;   r_series[2] += mux_sel
    r_shunt[1]  += mux_sel;  r_shunt[2]  += gnd

    return mux_sel


# ── Subsystem A6: Advanced Power UX (ECO #2026-03-D) ─────────────────────────


def _build_power_ux(
    gnd: Net,
    vcc_5v: Net,
    joy_sw: Net,         # joystick button net → PMOS drain (wake source)
    pmic_kill: Net,      # Radxa GPIO → 2N7002 gate (software kill)
    sw_pwr_gpio: Net,    # Radxa GPIO → long-press detect (monitors KEY)
    key_net: Net,        # PMIC_KEY shared with _build_power_system ic["KEY"]
) -> None:
    """
    Subsystem A6 – Advanced Power UX (ECO #2026-03-D)

    Three-circuit power management front-end for the IP5328P KEY pin:

    1. BSS84 PMOS Wake-Blocker:
       When 5V_SYS is OFF (board sleeping), Gate=0V → Vgs<Vth → PMOS ON.
       Joystick button press pulls KEY to GND → wakes the PMIC.
       When 5V_SYS is ON, Gate=5V → Vgs≈0V → PMOS OFF. Joystick isolated.
       100kΩ gate pull-down ensures Gate=0V when 5V rail collapses.

    2. 2N7002 NMOS Software Kill:
       Radxa GPIO (PMIC_KILL, active-high) pulls KEY to GND via NMOS Drain,
       simulating a double-tap on KEY for software-initiated shutdown.

    3. Physical Power Button (SW_PWR):
       Momentary SPST switch shorts KEY to GND (always works for wake/sleep).
       SW_PWR_GPIO taps KEY so Radxa can detect long-press → graceful shutdown.

    3-pin Power Management Header exposes PMIC_KILL / SW_PWR_GPIO / GND.
    """
    Resistor = Part("Device", "R", dest=TEMPLATE, footprint=FP_R0402)
    Pfet     = Part("Device", "Q_PMOS_GSD", dest=TEMPLATE, footprint=FP_PMOS_SOT23)
    Nfet     = Part("Device", "Q_NMOS_GDS", dest=TEMPLATE, footprint=FP_NFET_SOT23)

    # ── Passives ──────────────────────────────────────────────────────────────
    gate_pulldown = Resistor(value="100k")   # BSS84 Gate pull-down → GND

    # ── Components ────────────────────────────────────────────────────────────
    pmos = Pfet(value="BSS84")     # P-channel wake-blocker (SOT-23)
    nmos = Nfet(value="2N7002")    # N-channel software kill (SOT-23)
    sw_pwr = Part(
        "Switch", "SW_Push",
        footprint=FP_SW_PUSH,
        value="SW_PWR",
    )

    # ── 3-pin Power Management Header ─────────────────────────────────────────
    pwr_hdr = Part(
        "Connector_Generic", "Conn_01x03",
        footprint=FP_CONN_1X03_254,
    )

    # ── BSS84 wake-blocker connections ────────────────────────────────────────
    # Gate=5V_SYS: PMOS OFF when board is on; Gate=0V via pull-down when board off
    pmos["S"] += key_net       # Source: PMIC_KEY (shared with IC KEY pin)
    pmos["D"] += joy_sw        # Drain: joystick switch (wake trigger)
    pmos["G"] += vcc_5v        # Gate: 5V_SYS (holds PMOS off during operation)
    gate_pulldown[1] += vcc_5v # pull-down top: connects to Gate node (5V_SYS)
    gate_pulldown[2] += gnd    # pull-down bottom: GND (acts when 5V collapses)

    # ── 2N7002 software kill connections ──────────────────────────────────────
    nmos["G"] += pmic_kill     # Gate: PMIC_KILL GPIO (active-high pulls KEY low)
    nmos["D"] += key_net       # Drain: KEY net → simulates double-tap
    nmos["S"] += gnd           # Source: GND

    # ── Physical power button ──────────────────────────────────────────────────
    sw_pwr[1] += key_net       # one terminal: KEY (grounds KEY when pressed)
    sw_pwr[2] += gnd           # other terminal: GND
    sw_pwr_gpio += key_net     # SW_PWR_GPIO taps KEY for long-press detection

    # ── Power Management Header ────────────────────────────────────────────────
    pwr_hdr[1] += pmic_kill    # Pin 1: PMIC_KILL – software shutdown GPIO
    pwr_hdr[2] += sw_pwr_gpio  # Pin 2: SW_PWR_GPIO – long-press detect GPIO
    pwr_hdr[3] += gnd          # Pin 3: GND


# ── Subsystem H: CC1101 Sub-GHz RF Transceiver ───────────────────────────────


def _build_rf_transceiver(
    gnd: Net,
    vcc_clean: Net,
    spi_sck: Net,
    spi_mosi: Net,
    spi_miso: Net,
    rf_cs_n: Net,
    rf_gdo0: Net,
) -> None:
    """
    Subsystem H – CC1101 Sub-GHz RF Transceiver (IoT Protocol Analysis)

    Enables monitoring and authorized active interaction with 433/868/915 MHz
    ISM-band devices (ZigBee, Z-Wave, proprietary RF protocols) over SPI.

    SPI bus  : SoftSPI pins 13/15/16/18 (ECO #2026-03-F); CS on RF_CS_N (pin 18).
    GDO0     : not connected to header; CC1101 runs in polling mode (ECO #2026-03-F).
    Crystal  : 26 MHz reference oscillator (required by CC1101 internal PLL).
    RBIAS    : 10 kΩ to GND (sets RF bias current per CC1101 datasheet §10.4).

    FIRMWARE NOTE (ECO #2026-03-G): Use the Linux kernel 'spi-gpio' driver for
    microsecond-precision bit-banging, NOT userspace spidev or manual GPIO toggling.
    Userspace round-trips through the kernel scheduler introduce >10µs of jitter,
    which violates the CC1101 SPI timing spec (t_SCLK_min = 50ns, burst gap ≤ 500ns).
    Recommended device-tree overlay: spi-gpio with sck=GPIO16, mosi=GPIO13, miso=GPIO15.
    """
    Resistor  = Part("Device", "R", dest=TEMPLATE, footprint=FP_R0402)
    Capacitor = Part("Device", "C", dest=TEMPLATE, footprint=FP_C0402)

    # ── CC1101 RF transceiver IC ──────────────────────────────────────────────
    ic = Part(
        "Daemon_V0", "CC1101",
        footprint=FP_CC1101,
        value="CC1101",
    )

    # ── 26 MHz crystal (CC1101 PLL reference; reuse 3225-4Pin SMD footprint) ──
    # SI CRITICAL (ECO #2026-03-A): Place this 26 MHz crystal at least 10mm away
    # from other clock sources (especially RTL8152B 25 MHz crystal). Heterodyning
    # of 25 MHz and 26 MHz produces a 1 MHz beat that degrades CC1101 receiver
    # sensitivity. Encircle with ground via stitching.
    xtal = Part(
        "Device", "Crystal",
        footprint=FP_XTAL_12M,    # Crystal_SMD_3225-4Pin – same package class
        value="26MHz",
    )

    # ── Passives ──────────────────────────────────────────────────────────────
    cxtal_a, cxtal_b = Capacitor(num_copies=2, value="22p")   # crystal load caps
    rbias_res         = Resistor(value="10k")                  # RBIAS → GND
    # VDD decoupling: 100 nF on each VDD supply group
    cvdd_a, cvdd_b, cvdd_c = Capacitor(num_copies=3, value="100n")

    # ── Internal nets ─────────────────────────────────────────────────────────
    xi_net    = Net("RF_XI")
    xo_net    = Net("RF_XO")
    rbias_net = Net("RF_RBIAS")

    # ── IC connections ────────────────────────────────────────────────────────
    ic["VDD"]   += vcc_clean
    ic["GND"]   += gnd
    ic["SCLK"]  += spi_sck
    ic["SI"]    += spi_mosi
    ic["SO"]    += spi_miso
    ic["CSN"]   += rf_cs_n
    ic["GDO0"]  += rf_gdo0
    ic["GDO1"]  += Net("RF_GDO1")    # optional; configurable output / MISO alt
    ic["GDO2"]  += Net("RF_GDO2")    # optional; leave as named net
    ic["RF_P"]  += Net("RF_ANT_P")   # → Pi-network matching → chip antenna
    ic["RF_N"]  += Net("RF_ANT_N")   # differential RF port (negative)
    ic["XI"]    += xi_net
    ic["XO"]    += xo_net
    ic["RBIAS"] += rbias_net

    # ── Pi-Network Matching + Johanson 0915AT43A0026 Chip Antenna (915 MHz) ──
    # ECO #2026-02-V2: SMA connector removed; chip antenna replaces SMA + balun.
    # Pi-network (single-ended, RF_P drive): C1 shunt → L1 series → C2 shunt.
    #   C1 = 0.5 pF: shunt from RF_P to GND (impedance transformation)
    #   L1 = 10 nH:  series element (resonant boost)
    #   C2 = 4.7 pF: output shunt to GND (harmonic filtering)
    # RF_N terminated with 1 pF to GND (standard single-ended CC1101 config).
    Inductor = Part("Device", "L", dest=TEMPLATE, footprint="Inductor_SMD:L_0402_1005Metric")

    # ECO #2026-03-GOLD: Pi-network parts explicitly named for BOM traceability.
    C_RF1    = Capacitor(value="0.5p")   # C1: shunt from RF_P to GND
    L_RF1    = Inductor(value="10n")     # L1: series matching element
    C_RF2    = Capacitor(value="4.7p")   # C2: output shunt to GND
    c_rfn    = Capacitor(value="1p")     # RF_N single-ended termination cap

    chip_ant = Part(
        "Device", "Antenna_Chip",
        footprint=FP_CHIP_ANT_915,
        value="0915AT43A0026",
    )

    rf_ant = Net("RF_ANT")   # Pi-network output → chip antenna feedpoint

    # Pi-network wiring (C_RF1 / L_RF1 / C_RF2 per BOM)
    C_RF1[1] += ic["RF_P"].net;  C_RF1[2] += gnd       # C1 shunt
    L_RF1[1] += ic["RF_P"].net;  L_RF1[2] += rf_ant    # L1 series
    C_RF2[1] += rf_ant;          C_RF2[2] += gnd       # C2 shunt

    # Chip antenna: feedpoint to Pi output, reference to GND
    chip_ant[1] += rf_ant
    chip_ant[2] += gnd

    # RF_N termination
    c_rfn[1] += ic["RF_N"].net;  c_rfn[2] += gnd

    # ── Crystal reference oscillator ──────────────────────────────────────────
    xtal[1]    += xi_net
    xtal[2]    += xo_net
    cxtal_a[1] += xi_net;   cxtal_a[2] += gnd
    cxtal_b[1] += xo_net;   cxtal_b[2] += gnd

    # ── RBIAS: 10 kΩ sets internal RF bias current ────────────────────────────
    rbias_res[1] += rbias_net
    rbias_res[2] += gnd

    # ── VDD decoupling ────────────────────────────────────────────────────────
    cvdd_a[1] += vcc_clean;  cvdd_a[2] += gnd
    cvdd_b[1] += vcc_clean;  cvdd_b[2] += gnd
    cvdd_c[1] += vcc_clean;  cvdd_c[2] += gnd


# ── Subsystem J: ISO1212 Industrial 24V Logic Isolation ──────────────────────


def _build_industrial_iso(
    gnd: Net,
    vcc_3v3: Net,
    iso_do1: Net,
    iso_do2: Net,
) -> None:
    """
    Subsystem J – ISO1212 Dual-Channel Industrial 24V Logic Isolator (PLC Integration)

    Provides galvanically isolated digital inputs compatible with IEC 61131-2
    Type 1/3 field signals (8–35V DC PLC outputs).  The ISO1212 converts
    high-voltage field logic to 3.3V CMOS for safe Radxa SBC GPIO input.

    Field side : external 8–35V PLC supply (ISO_VCC1) and isolated ground (ISO_GND1)
    Logic side : VCC2 = 3V3_SYS; OUT1 → ISO_DO1, OUT2 → ISO_DO2
    Outputs    : ISO_DO1 / ISO_DO2 routed to the 4-pin auxiliary GPIO header
    Isolation  : ≥2.5 kV (see ISO1212 datasheet for full isolation voltage rating)

    IND-SAF-01: Per-channel transient hardening chain (IEC 61131-2 compliant):
      Connector IN → [Littelfuse 60R PTC] → A → [Vishay VCAN26A2 TVS → ISO_GND1]
                                              → [562Ω 1% series] → B
                                                                  → [1kΩ 1% → ISO_GND1]
                                                                  → [10nF 100V X7R → ISO_GND1]
                                                                  → ISO1212 INx

    ISO_GND1 remains strictly isolated from PCB GND throughout the entire path.
    """
    Resistor       = Part("Device", "R",        dest=TEMPLATE, footprint=FP_R0402)
    PtcFuse        = Part("Device", "Polyfuse", dest=TEMPLATE, footprint=FP_PTC_1206)
    TvsDiode       = Part("Device", "D_TVS",    dest=TEMPLATE, footprint=FP_TVS_SMB)
    Capacitor      = Part("Device", "C",        dest=TEMPLATE, footprint=FP_C0402)
    Capacitor_bulk = Part("Device", "C",        dest=TEMPLATE, footprint=FP_C0805)

    # ── ISO1212 dual-channel isolated digital input IC ────────────────────────
    ic = Part(
        "Daemon_V0", "ISO1212",
        footprint=FP_ISO1212,
        value="ISO1212",
    )

    # ── Field-side 4-pin connector: GND1 / VCC1 / IN1_RAW / IN2_RAW ──────────
    # ECO #2026-02-V2: WAGO 2060-404 4-position 3.5mm pitch terminal block
    field_conn = Part(
        "Connector_Generic", "Conn_01x04",
        footprint=FP_WAGO_4P,
        value="WAGO-2060-404",
    )

    # ── Per-channel protection passives ───────────────────────────────────────
    # Littelfuse 60R series resettable PTC: protects against sustained fault
    # currents from 24V PLC outputs (trips at ~60mA, resets on power removal)
    ptc1, ptc2 = PtcFuse(num_copies=2, value="60R")

    # Vishay VCAN26A2: bidirectional 26V TVS clamps transient overvoltages
    # (EN 61000-4-5 Level 3 surge) at the PTC output node to field ground
    tvs1, tvs2 = TvsDiode(num_copies=2, value="VCAN26A2")

    # 562Ω 1% series current-limiting resistors (E96 value)
    r_ser1, r_ser2 = Resistor(num_copies=2, value="562")

    # 1kΩ 1% threshold resistors: shunt to ISO_GND1 to set IEC 61131-2
    # switching threshold; also bleeds static charge on open inputs
    r_thr1, r_thr2 = Resistor(num_copies=2, value="1k")

    # 10nF 100V X7R filter capacitors: suppress HF transients at IC input pin
    cflt1, cflt2 = Capacitor(num_copies=2, value="10n")

    # ── Field-side supply decoupling (referenced to ISO_GND1, not PCB GND) ────
    cvcc1_bulk = Capacitor_bulk(value="10u")
    cvcc1_byp  = Capacitor(value="100n")
    # Logic-side decoupling
    cvcc2_byp  = Capacitor(value="100n")

    # ── Internal nets ─────────────────────────────────────────────────────────
    vcc1     = Net("ISO_VCC1")    # field supply input  (8–35V PLC supply)
    gnd1     = Net("ISO_GND1")    # field ground (isolated from PCB GND)
    in1_raw  = Net("ISO_IN1_RAW") # raw connector input ch1 (before PTC)
    in2_raw  = Net("ISO_IN2_RAW") # raw connector input ch2 (before PTC)
    in1_ptc  = Net("ISO_IN1_PTCA")  # ch1 node after PTC, before TVS / series R
    in2_ptc  = Net("ISO_IN2_PTCA")  # ch2 node after PTC
    in1      = Net("ISO_IN1")     # ch1 protected node → IC IN1
    in2      = Net("ISO_IN2")     # ch2 protected node → IC IN2

    # ── ISO1212 IC connections ────────────────────────────────────────────────
    ic["VCC1"] += vcc1
    ic["GND1"] += gnd1
    ic["IN1"]  += in1
    ic["IN2"]  += in2
    ic["VCC2"] += vcc_3v3
    ic["GND2"] += gnd
    ic["OUT1"] += iso_do1
    ic["OUT2"] += iso_do2

    # ── Field connector: pin 1=GND1, 2=VCC1, 3=IN1_RAW, 4=IN2_RAW ───────────
    field_conn[1] += gnd1
    field_conn[2] += vcc1
    field_conn[3] += in1_raw
    field_conn[4] += in2_raw

    # ── Channel 1 protection chain ────────────────────────────────────────────
    ptc1[1]   += in1_raw;  ptc1[2]   += in1_ptc    # series PTC fuse
    tvs1["A1"] += gnd1;    tvs1["A2"] += in1_ptc   # TVS clamp to field GND
    r_ser1[1] += in1_ptc;  r_ser1[2] += in1         # 562Ω current limit
    r_thr1[1] += in1;      r_thr1[2] += gnd1        # 1kΩ threshold shunt
    cflt1[1]  += in1;      cflt1[2]  += gnd1        # 10nF HF filter

    # ── Channel 2 protection chain (mirrors channel 1) ────────────────────────
    ptc2[1]   += in2_raw;  ptc2[2]   += in2_ptc
    tvs2["A1"] += gnd1;    tvs2["A2"] += in2_ptc
    r_ser2[1] += in2_ptc;  r_ser2[2] += in2
    r_thr2[1] += in2;      r_thr2[2] += gnd1
    cflt2[1]  += in2;      cflt2[2]  += gnd1

    # ── Field-side decoupling (referenced to ISO_GND1) ────────────────────────
    cvcc1_bulk[1] += vcc1;  cvcc1_bulk[2] += gnd1
    cvcc1_byp[1]  += vcc1;  cvcc1_byp[2]  += gnd1

    # ── Logic-side decoupling ─────────────────────────────────────────────────
    cvcc2_byp[1] += vcc_3v3;  cvcc2_byp[2] += gnd


# ── Subsystem A5: Goobay 74446 USB-C Mechanical Bridge ───────────────────────


def _build_goobay_bridge(
    gnd: Net,
    vcc_5v: Net,
    usb_up_dp: Net,
    usb_up_dm: Net,
) -> None:
    """
    Subsystem A5 – Goobay 74446 USB-C Mechanical Bridge

    U-shape USB-C receptacle providing the upstream USB-C port for the Radxa SBC.
    Connects via 8.85mm vertical pitch to Radxa; mounted on B.Cu (bottom copper).
    VBUS is fused via the Goobay internal trace; D+/D- connect to SL2.1A upstream pair.
    """
    usb_c = Part(
        "Connector", "USB_C_Receptacle",
        footprint=FP_USB_C_RCPT,
        value="Goobay-74446",
    )
    # B.Cu placement note: bridge straddles Radxa USB-C header at 8.85mm pitch
    usb_c["VBUS"]  += vcc_5v
    usb_c["GND"]   += gnd
    usb_c["D+"]    += usb_up_dp
    usb_c["D-"]    += usb_up_dm
    # CC1/CC2 pull-downs: identify as UFP (device) to host / charger upstream
    cc1_pd = Part("Device", "R", dest=TEMPLATE, footprint=FP_R0402)(value="5k1")
    cc2_pd = Part("Device", "R", dest=TEMPLATE, footprint=FP_R0402)(value="5k1")
    cc1_pd[1] += usb_c["CC1"];  cc1_pd[2] += gnd
    cc2_pd[1] += usb_c["CC2"];  cc2_pd[2] += gnd


# ── Subsystem B2: RTL8152B USB–Ethernet ──────────────────────────────────────


def _build_ethernet(
    gnd: Net,
    vcc_3v3: Net,
    usb_dp: Net,
    usb_dm: Net,
) -> None:
    """
    Subsystem B2 – RTL8152B USB 2.0 to 100Base-TX Ethernet

    RTL8152B (QFN-32) connects to SL2.1A downstream port 4 (USB DP4/DM4).
    25 MHz crystal provides PHY clock reference.
    HanRun HR911105A integrated-magnetics RJ45 MagJack handles isolation.

    MDI pin mapping:  TX+ → RJ45 pin 1, TX− → RJ45 pin 2
                      RX+ → RJ45 pin 3, RX− → RJ45 pin 6
    PSELF = Low  (VCC internally self-powered from USB VBUS)
    XTALDET = High (external crystal mode, not internal oscillator)
    """
    Capacitor      = Part("Device", "C", dest=TEMPLATE, footprint=FP_C0402)
    Capacitor_bulk = Part("Device", "C", dest=TEMPLATE, footprint=FP_C0805)
    Resistor       = Part("Device", "R", dest=TEMPLATE, footprint=FP_R0402)

    ic = Part(
        "Daemon_V0", "RTL8152B",
        footprint=FP_RTL8152B,
        value="RTL8152B",
    )
    # SI CRITICAL (ECO #2026-03-A): Place this 25 MHz crystal at least 10mm away
    # from other clock sources (especially CC1101 26 MHz crystal). A 1 MHz beat
    # frequency from heterodyning of 25 MHz and 26 MHz oscillators can corrupt
    # sub-GHz RF sensitivity. Encircle with ground via stitching.
    xtal = Part(
        "Device", "Crystal",
        footprint=FP_XTAL_25M,
        value="25MHz",
    )
    # LAYOUT CRITICAL (ECO #2026-03-A): The HanRun Ethernet Jack must be placed
    # >15mm away from the USB-C Upstream Port (Goobay 74446, B.Cu) to prevent
    # Z-axis collision between the MagJack body and the Goobay bridge structure.
    rj45 = Part(
        "Connector", "RJ45_Hanrun_HR911105A_Horizontal",
        footprint=FP_MAGJACK,
        value="HR911105A",
    )

    # Internal nets
    mdi_txp  = Net("ETH_MDI_TXP")
    mdi_txn  = Net("ETH_MDI_TXN")
    mdi_rxp  = Net("ETH_MDI_RXP")
    mdi_rxn  = Net("ETH_MDI_RXN")
    xi_net   = Net("ETH_XI")
    xo_net   = Net("ETH_XO")
    usb_vbus = Net("ETH_USB_VBUS")

    # Passives
    cxtal_a, cxtal_b   = Capacitor(num_copies=2, value="22p")   # crystal load caps
    cvdd_a, cvdd_b      = Capacitor(num_copies=2, value="100n")  # VDD bypass
    cvdd_bulk           = Capacitor_bulk(value="10u")
    pself_r             = Resistor(value="0")   # PSELF tie-low strap (0Ω to GND)
    xtaldet_r           = Resistor(value="0")   # XTALDET tie-high strap (0Ω to VCC)

    # RTL8152B core connections
    ic["USB_DP"]    += usb_dp
    ic["USB_DM"]    += usb_dm
    ic["VDD"]       += vcc_3v3
    ic["GND"]       += gnd
    ic["XI"]        += xi_net
    ic["XO"]        += xo_net
    ic["MDI_TXP"]   += mdi_txp
    ic["MDI_TXN"]   += mdi_txn
    ic["MDI_RXP"]   += mdi_rxp
    ic["MDI_RXN"]   += mdi_rxn

    # PSELF=Low: self-powered from USB VBUS
    pself_r[1] += ic["PSELF"]; pself_r[2] += gnd

    # XTALDET=High: external crystal mode
    xtaldet_r[1] += ic["XTALDET"]; xtaldet_r[2] += vcc_3v3

    # 25 MHz crystal
    xtal[1] += xi_net; xtal[2] += xo_net
    cxtal_a[1] += xi_net; cxtal_a[2] += gnd
    cxtal_b[1] += xo_net; cxtal_b[2] += gnd

    # HanRun HR911105A MagJack – MDI pins 1/2/3/6 = TX+/TX−/RX+/RX−
    rj45[1] += mdi_txp
    rj45[2] += mdi_txn
    rj45[3] += mdi_rxp
    rj45[6] += mdi_rxn
    # ECO #2026-03-E: Center tap pins 4/5 biased to 3V3 (magnetics PHY requirement)
    # HR911105A center tap CT1 (TX pair) and CT2 (RX pair) must be AC-referenced
    # to the supply rail; leaving them floating prevents PHY link negotiation.
    rj45[4] += vcc_3v3    # CT1: TX pair center tap → 3V3_SYS
    rj45[5] += vcc_3v3    # CT2: RX pair center tap → 3V3_SYS

    # VDD decoupling
    cvdd_a[1]    += vcc_3v3; cvdd_a[2]    += gnd
    cvdd_b[1]    += vcc_3v3; cvdd_b[2]    += gnd
    cvdd_bulk[1] += vcc_3v3; cvdd_bulk[2] += gnd


# ── Subsystem E2: WS2812B Smart RGB LEDs × 4 ─────────────────────────────────


def _build_ws2812b_leds(
    gnd: Net,
    vcc_5v: Net,
    led_din: Net,
) -> None:
    """
    Subsystem E2 – Four daisy-chained WS2812B addressable RGB LEDs

    LEDs are daisy-chained DIN → DOUT → DIN (next) ... → DOUT (last, open).
    Each LED is decoupled with 100nF X5R close to VDD pin.
    Supply: 5V_SYS; data entry point: LED_DIN from Radxa header pin 36.

    ECO #2026-03-E: 1kΩ pull-up from LED_DIN to 5V_SYS.
    Radxa GPIO36 is open-drain; without a pull-up the logic-high level is
    undefined. The 1kΩ ensures the idle/high state reaches ≥3.5V (WS2812B
    data-high threshold) even before the first transmission.
    """
    Capacitor = Part("Device", "C", dest=TEMPLATE, footprint=FP_C0402)
    Resistor  = Part("Device", "R", dest=TEMPLATE, footprint=FP_R0402)
    LED       = Part("LED", "WS2812B", dest=TEMPLATE, footprint=FP_WS2812B)

    leds      = LED(num_copies=4, value="WS2812B")
    byp       = Capacitor(num_copies=4, value="100n")
    din_pullup = Resistor(value="1k")   # ECO #2026-03-E: open-drain pull-up

    # ── DIN pull-up: 5V_SYS → 1kΩ → LED_DIN ─────────────────────────────────
    din_pullup[1] += vcc_5v
    din_pullup[2] += led_din

    # Build daisy-chain: LED_DIN → LED[0].DIN, LED[0].DOUT → LED[1].DIN, ...
    din_chain = [led_din] + [Net(f"WS2812B_DOUT_{i}") for i in range(1, 4)]

    for i, (led, cap) in enumerate(zip(leds, byp)):
        led["VDD"]  += vcc_5v
        led["VSS"]  += gnd
        led["DIN"]  += din_chain[i]
        if i < 3:
            led["DOUT"] += din_chain[i + 1]
        # else: DOUT of last LED left as open net
        cap[1] += vcc_5v
        cap[2] += gnd


# ── Subsystem E3: Stealth IR Blaster ─────────────────────────────────────────


def _build_ir_blaster(
    gnd: Net,
    vcc_5v: Net,
    ir_gpio: Net,
) -> None:
    """
    Subsystem E3 – VSMB294008 Side-View SMD IR LED + AO3400A N-MOSFET Driver

    VSMB294008: 940nm side-view IR LED (PLCC2 SMD, forward-edge placement).
    AO3400A N-MOSFET (SOT-23, ECO #2026-03-F): Gate driven by ir_gpio (active-high),
    Vgs_th = 0.45–1.0V → fully saturated at 3.3V GPIO. Rds_on < 50mΩ.
    Drain pulls LED cathode toward GND when gate asserted.

    Current path: VCC_5V → R_LED (current limit) → IR_LED+ → IR_LED− → DRAIN(AO3400A) → GND
    R_LED = 33Ω  → (5V − 1.5V) / 33Ω ≈ 106mA pulsed (ECO #2026-03-A: long-range IR)
    """
    Resistor = Part("Device", "R", dest=TEMPLATE, footprint=FP_R0402)
    IrLed    = Part("Device", "LED", dest=TEMPLATE, footprint=FP_IR_LED)
    Nfet     = Part("Device", "Q_NMOS_GDS", dest=TEMPLATE, footprint=FP_NFET_SOT23)

    ir_led  = IrLed(value="VSMB294008")
    # ECO #2026-03-F: AO3400A replaces 2N7002 — logic-level NMOS, Rds_on < 50mΩ at
    # Vgs = 3.3V; 2N7002 requires 5V gate to fully saturate (Vgs_th up to 2.5V).
    fet     = Nfet(value="AO3400A")
    # ECO #2026-03-A: 33Ω → ~106mA pulsed (5V - 1.5Vf) / 33Ω; >100mA for long-range IR
    r_led   = Resistor(value="33")     # series current-limiting resistor

    ir_anode   = Net("IR_LED_P")
    ir_cathode = Net("IR_LED_N")

    r_led[1]    += vcc_5v
    r_led[2]    += ir_anode
    ir_led["A"] += ir_anode
    ir_led["K"] += ir_cathode

    fet["G"]    += ir_gpio    # Gate: driven by Radxa GPIO (active-high)
    fet["D"]    += ir_cathode # Drain: connected to LED cathode
    fet["S"]    += gnd        # Source: GND


# ── Top-level assembly ────────────────────────────────────────────────────────


def generate_daemon_v0_full_system() -> None:
    """
    Wire all Daemon V0 subsystems into a single SKiDL netlist.

    Execution order:
      1. Define all shared power and signal nets
      2. Build each subsystem (A → F), passing the relevant nets
      3. Run ERC and emit the KiCad netlist file
    """

    # ── Shared power rails ────────────────────────────────────────────────────
    gnd     = Net("GND")
    vcc_5v  = Net("5V_SYS")   # IP5328P VOUT_ISO; also feeds Radxa header 5V pins
    vcc_3v3 = Net("3V3_SYS")  # sourced from Radxa SBC 3.3V LDO (via header pin 1/17)

    # ── Shared I2S bus (bridged from audio_subsystem.py conventions) ──────────
    i2s_bclk  = Net("I2S_BCLK")
    i2s_lrclk = Net("I2S_LRCLK")
    i2s_din   = Net("I2S_DATA_IN")
    i2s_dout  = Net("I2S_DATA_OUT")

    # ── SPI3 bus (display only — ST7789V2; Radxa SPI3 on pins 19/21/23/24) ───
    spi_sck  = Net("SPI3_CLK")
    spi_mosi = Net("SPI3_MOSI")
    spi_miso = Net("SPI3_MISO")

    # ── RF SoftSPI bus (bit-banged; CC1101; ECO #2026-03-E: renamed RF_*) ────
    rf_clk  = Net("RF_CLK")     # GPIO12 / pin 16 (CC1101 SCLK; ECO #2026-03-F)
    rf_mosi = Net("RF_MOSI")    # GPIO13 / pin 13 (CC1101 SI;   ECO #2026-03-F)
    rf_miso = Net("RF_MISO")    # GPIO15 / pin 15 (CC1101 SO;   ECO #2026-03-F)

    # ── Screen control GPIOs ──────────────────────────────────────────────────
    screen_cs  = Net("SPI3_CS")      # GPIO8  / SPI3_CS0 (pin 24)
    screen_dc  = Net("SCREEN_DC")    # GPIO24
    screen_rst = Net("SCREEN_RST")   # GPIO25
    screen_bl  = Net("SCREEN_BL")    # GPIO4 / pin 7 (hardware PWM)

    # ── Joystick signals ──────────────────────────────────────────────────────
    joy_vrx = Net("JOY_VRX")    # analog X → Radxa ADC / external ADS1015
    joy_vry = Net("JOY_VRY")    # analog Y → Radxa ADC / external ADS1015
    joy_sw  = Net("JOY_SW")     # digital button → GPIO26

    # ── Stinger port control (one GPIO per port) ──────────────────────────────
    stinger_en   = [Net(f"STINGER_EN_{i}")   for i in range(1, 4)]
    stinger_flag = [Net(f"STINGER_FLAG_{i}") for i in range(1, 4)]

    # ── I2C1 bus (pins 3/5 – ADS1015 joystick ADC + IP5328P telemetry) ───────
    # ECO #2026-03-H: I2C0 (pins 27/28) removed — those lines are disconnected
    # on Zero 3W.  IP5328P telemetry moved here (shared with ADS1015 on I2C1).
    i2c1_sda = Net("I2C1_SDA")
    i2c1_scl = Net("I2C1_SCL")

    # ── Protocol analyzer chip selects and interrupt signals ──────────────────
    rf_cs_n   = Net("RF_CS_N")    # CC1101 SPI chip select  (pin 18; ECO #2026-03-F)
    rf_gdo0   = Net("RF_GDO0")    # CC1101 GDO0 – off header (polling mode; ECO #2026-03-F)
    iso_do1   = Net("ISO_DO1")    # ISO1212 channel 1 output → auxiliary header
    iso_do2   = Net("ISO_DO2")    # ISO1212 channel 2 output → auxiliary header

    # ── ECO #2026-02-V2: new signal nets ──────────────────────────────────────
    led_din   = Net("LED_DIN")    # WS2812B data chain DIN  (Radxa pin 36)
    ir_gpio   = Net("IR_GPIO")    # IR blaster gate drive   (auxiliary header)

    # ── ECO #2026-03-D: power UX nets ─────────────────────────────────────────
    key_net     = Net("PMIC_KEY")     # IP5328P KEY pin; wired by A and A6
    pmic_kill   = Net("PMIC_KILL")    # Radxa GPIO → 2N7002 gate (software kill)
    sw_pwr_gpio = Net("SW_PWR_GPIO")  # Radxa GPIO → long-press detect

    # ──────────────────────────────────────────────────────────────────────────
    # A – IP5328P power management + I2C telemetry
    # ──────────────────────────────────────────────────────────────────────────
    _build_power_system(gnd, vcc_5v, i2c1_sda, i2c1_scl, key_net)

    # ── A2 – AP2112K-3.3 clean 3.3V rail for RF + Ethernet isolation ──────────
    vcc_clean = _build_clean_3v3_rail(gnd, vcc_5v)

    # ──────────────────────────────────────────────────────────────────────────
    # G – NE555 heartbeat / dummy-load (SM-PWR-02)
    # Defeats the IP5328P auto-shutdown by pulsing >50mA every ~15s.
    # ──────────────────────────────────────────────────────────────────────────
    _build_heartbeat_keepalive(gnd, vcc_5v)

    # ──────────────────────────────────────────────────────────────────────────
    # B – SL2.1A USB hub
    # ──────────────────────────────────────────────────────────────────────────
    hub_nets          = _build_usb_hub(gnd, vcc_5v, vcc_3v3)
    dn_pairs          = hub_nets["dn"]       # [(DP1,DM1) … (DP4,DM4)]
    oc_n              = hub_nets["oc_n"]     # [OC_N1, OC_N2, OC_N3]
    up_dp, up_dm      = hub_nets["up"]       # upstream pair → Goobay USB-C bridge

    # ──────────────────────────────────────────────────────────────────────────
    # C – Three Stinger ports (SY6280 + USB-A)
    #     Port 4 on the SL2.1A (dn_pairs[3]) is reserved for the RTL8152B
    #     Ethernet module; it is left as a named net for the next subsystem file.
    # ──────────────────────────────────────────────────────────────────────────
    for i in range(3):
        footprint = FP_USB_A_MALE if i == 0 else FP_USB_A_FEMALE
        _build_stinger_port(
            port_num  = i + 1,
            gnd       = gnd,
            vcc_5v    = vcc_5v,
            vcc_3v3   = vcc_3v3,
            dp_net    = dn_pairs[i][0],
            dm_net    = dn_pairs[i][1],
            en_net    = stinger_en[i],
            flag_net  = stinger_flag[i],
            usb_footprint = footprint,
        )
        # Wire the SY6280 FLAG back to the hub OC_N line so the SL2.1A can
        # report per-port overcurrent faults to the host over USB.
        stinger_flag[i] += oc_n[i]

    # ──────────────────────────────────────────────────────────────────────────
    # D – 1.69″ SPI display (ECO #2026-02-V2)
    # ──────────────────────────────────────────────────────────────────────────
    _build_spi_screen(
        gnd       = gnd,
        vcc_3v3   = vcc_3v3,
        spi_sck   = spi_sck,
        spi_mosi  = spi_mosi,
        screen_cs = screen_cs,
        screen_dc = screen_dc,
        screen_rst= screen_rst,
        screen_bl = screen_bl,
    )

    # ──────────────────────────────────────────────────────────────────────────
    # E – Analog joystick
    # ──────────────────────────────────────────────────────────────────────────
    _build_joystick(
        gnd     = gnd,
        vcc_3v3 = vcc_3v3,
        joy_vrx = joy_vrx,
        joy_vry = joy_vry,
        joy_sw  = joy_sw,
        i2c1_sda= i2c1_sda,
        i2c1_scl= i2c1_scl,
    )

    # ──────────────────────────────────────────────────────────────────────────
    # A3 – USB charging MUX hardening (PDN-USB-01)
    # ──────────────────────────────────────────────────────────────────────────
    _build_usb_charging_mux(gnd, vcc_5v)

    # ──────────────────────────────────────────────────────────────────────────
    # A6 – Advanced power UX (BSS84 wake-blocker, 2N7002 kill, SW_PWR button)
    # ──────────────────────────────────────────────────────────────────────────
    _build_power_ux(
        gnd         = gnd,
        vcc_5v      = vcc_5v,
        joy_sw      = joy_sw,
        pmic_kill   = pmic_kill,
        sw_pwr_gpio = sw_pwr_gpio,
        key_net     = key_net,
    )

    # ──────────────────────────────────────────────────────────────────────────
    # H – CC1101 Sub-GHz RF transceiver (IoT protocol analysis)
    #     Uses SoftSPI (bit-banged) to avoid SPI0 bus collision with display.
    # ──────────────────────────────────────────────────────────────────────────
    _build_rf_transceiver(
        gnd          = gnd,
        vcc_clean    = vcc_clean,
        spi_sck      = rf_clk,
        spi_mosi     = rf_mosi,
        spi_miso     = rf_miso,
        rf_cs_n      = rf_cs_n,
        rf_gdo0      = rf_gdo0,
    )

    # ──────────────────────────────────────────────────────────────────────────
    # A5 – Goobay 74446 USB-C mechanical bridge (upstream USB-C port)
    # ──────────────────────────────────────────────────────────────────────────
    _build_goobay_bridge(gnd, vcc_5v, up_dp, up_dm)

    # ──────────────────────────────────────────────────────────────────────────
    # B2 – RTL8152B USB–Ethernet (SL2.1A downstream port 4)
    # ──────────────────────────────────────────────────────────────────────────
    _build_ethernet(
        gnd     = gnd,
        vcc_3v3 = vcc_clean,   # ECO #2026-03-F: RTL8152B VCC → 3V3_CLEAN (LM1117 800mA)
        usb_dp  = dn_pairs[3][0],
        usb_dm  = dn_pairs[3][1],
    )

    # ──────────────────────────────────────────────────────────────────────────
    # E2 – WS2812B × 4 addressable RGB LEDs (LED_DIN on Radxa pin 36)
    # ──────────────────────────────────────────────────────────────────────────
    _build_ws2812b_leds(gnd, vcc_5v, led_din)

    # ──────────────────────────────────────────────────────────────────────────
    # E3 – Stealth IR blaster (front-edge placement)
    # ──────────────────────────────────────────────────────────────────────────
    _build_ir_blaster(gnd, vcc_5v, ir_gpio)

    # ──────────────────────────────────────────────────────────────────────────
    # J – ISO1212 industrial 24V logic isolation (PLC integration)
    # ──────────────────────────────────────────────────────────────────────────
    _build_industrial_iso(
        gnd     = gnd,
        vcc_3v3 = vcc_3v3,
        iso_do1 = iso_do1,
        iso_do2 = iso_do2,
    )

    # Auxiliary 4-pin GPIO header: exposes ISO_DO1 / ISO_DO2 / IR_GPIO / GND.
    # ECO #2026-02-V2: CAN_INT_N removed (CAN bus removed); IR_GPIO added.
    aux_hdr = Part(
        "Connector_Generic", "Conn_01x04",
        footprint=FP_CONN_1X04_254,
    )
    aux_hdr[1] += iso_do1     # ISO1212 OUT1 (3.3V CMOS logic)
    aux_hdr[2] += iso_do2     # ISO1212 OUT2 (3.3V CMOS logic)
    aux_hdr[3] += ir_gpio     # IR blaster gate drive (active-high)
    aux_hdr[4] += gnd

    # ──────────────────────────────────────────────────────────────────────────
    # F – 40-pin Radxa expansion header
    # ──────────────────────────────────────────────────────────────────────────
    _build_radxa_header(
        gnd          = gnd,
        vcc_5v       = vcc_5v,
        vcc_3v3      = vcc_3v3,
        i2s_bclk     = i2s_bclk,
        i2s_lrclk    = i2s_lrclk,
        i2s_din      = i2s_din,
        i2s_dout     = i2s_dout,
        spi_sck      = spi_sck,
        spi_mosi     = spi_mosi,
        spi_miso     = spi_miso,
        screen_cs    = screen_cs,
        screen_dc    = screen_dc,
        screen_rst   = screen_rst,
        screen_bl      = screen_bl,
        joy_sw         = joy_sw,
        soft_spi_sck   = rf_clk,
        soft_spi_mosi  = rf_mosi,
        soft_spi_miso  = rf_miso,
        stinger_en   = stinger_en,
        stinger_flag = stinger_flag,
        i2c1_sda     = i2c1_sda,
        i2c1_scl     = i2c1_scl,
        rf_cs_n      = rf_cs_n,
        rf_gdo0      = rf_gdo0,
        led_din      = led_din,
    )

    # ──────────────────────────────────────────────────────────────────────────
    # ERC + netlist generation
    # ──────────────────────────────────────────────────────────────────────────
    ERC()
    generate_netlist(file_=NETLIST_OUTPUT)
    print(f"Full-system netlist written → {NETLIST_OUTPUT}")


# ── Entry point ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    generate_daemon_v0_full_system()
