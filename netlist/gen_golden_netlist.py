"""
netlist/gen_golden_netlist.py
Phase 4 – Golden Netlist Generator (CI artifact; no KiCad runtime required)

Generates a KiCad-format .net file (S-expression, compatible with KiCad 5/6/7)
without requiring KiCad symbol libraries or a live SKiDL environment.

This script is the CI fallback for machines where the full SKiDL + KiCad
toolchain is not installed.  The component list and net connectivity are
derived directly from the architecture defined in full_system.py; the output
is a deterministic, diff-able artifact suitable for:

  · Regression detection (git diff daemon_v0_full_system.net)
  · Import into KiCad PCB editor once symbol libraries are available
  · BOM extraction by downstream tooling

Usage:
    python -m netlist.gen_golden_netlist
    # → writes daemon_v0_full_system.net to the repo root
"""

from __future__ import annotations

import datetime
import sys
import textwrap
from pathlib import Path

OUTPUT_FILE = Path(__file__).parent.parent / "daemon_v0_full_system.net"

# ── Net definitions ───────────────────────────────────────────────────────────
# All named nets in the Daemon V0 system. Used for the (nets ...) section.

NETS: list[str] = [
    "GND",
    "5V_SYS",
    "3V3_SYS",
    "3V3_CLEAN",
    # Power management (A) – IP5328P
    "BAT_P",
    "IP5328P_SW",
    # I2C buses – ECO #2026-03-H: I2C0 removed (pins 27/28 NC on Zero 3W)
    "I2C1_SDA", "I2C1_SCL",
    "I2C1_PMIC_SDA", "I2C1_PMIC_SCL",   # protected side of 470Ω series resistors
    # SPI0 bus (display only – ST7789V2)
    "SPI0_SCK", "SPI0_MOSI", "SPI0_MISO",
    # RF SoftSPI bus (CC1101; ECO #2026-03-E: renamed RF_*; ECO #2026-03-F: safe GPIOs)
    "RF_CLK", "RF_MOSI", "RF_MISO",
    "RF_CS_N", "RF_GDO1", "RF_GDO2",
    "RF_XI", "RF_XO", "RF_RBIAS",
    "RF_ANT_P", "RF_ANT_N", "RF_ANT",
    # Screen control
    "SCREEN_CS", "SCREEN_DC", "SCREEN_RST", "SCREEN_BL",
    # Joystick + ADS1015 ADC
    "JOY_VRX", "JOY_VRY", "JOY_SW", "ADC_ALERT",
    # Stinger ports
    "STINGER_EN_1", "STINGER_EN_2", "STINGER_EN_3",
    "STINGER_FLAG_1", "STINGER_FLAG_2", "STINGER_FLAG_3",
    "STINGER_ISET_1", "STINGER_ISET_2", "STINGER_ISET_3",
    "USB_VBUS_1", "USB_VBUS_2", "USB_VBUS_3",
    # Hub USB data pairs
    "USB_DP_1", "USB_DM_1",
    "USB_DP_2", "USB_DM_2",
    "USB_DP_3", "USB_DM_3",
    "USB_DP_4", "USB_DM_4",
    "USB_DP_UP", "USB_DM_UP",
    # I2S / audio
    "I2S_BCLK", "I2S_LRCLK", "I2S_DATA_IN", "I2S_DATA_OUT",
    # ECO #2026-02-V2: WS2812B + IR blaster
    "LED_DIN",
    "IR_GPIO",
    # ECO #2026-03-D: Advanced Power UX (A6)
    "PMIC_KEY", "PMIC_KILL", "SW_PWR_GPIO",
    # ISO1212 (J)
    "ISO_IN1_RAW", "ISO_IN2_RAW",
    "ISO_IN1_PROT", "ISO_IN2_PROT",
    "ISO_DO1", "ISO_DO2",
    "ISO_GND1",
    "ISO_ISET_1", "ISO_ISET_2",
    # USB MUX hardening (A3)
    "VBUS_A", "VBUS_C", "MUX_VIN", "MUX_SEL",
    # Heartbeat timer (G)
    "NE555_OUT", "NE555_THRESH", "NE555_CTRL",
    "BJT_BASE", "BJT_COLLECTOR",
    # DFT test points
    "TP_VBAT", "TP_VOUT", "TP_SW", "TP_GND",
]

# ── Component definitions ─────────────────────────────────────────────────────
# Each entry: (ref, value, footprint, libsource_lib, libsource_part, pins)
# pins: list of (pin_name, net_name)

COMPONENTS: list[dict] = [
    # ── A: IP5328P Power Management ──────────────────────────────────────────
    # ECO #2026-03-H: I2C moved to I2C1 (via 470Ω, simplified here as I2C1_PMIC_SDA/SCL)
    # ECO #2026-03-E: LED1/LED2/LED3 REMOVED (I2C bus clamping conflict)
    dict(ref="U1",  value="IP5328P",     fp="Package_DFN_QFN:QFN-40-1EP_6x6mm_P0.5mm_EP4.6x4.6mm", lib="Daemon_V0",         part="IP5328P",
         pins=[("BAT","BAT_P"),("SW","IP5328P_SW"),("VIN","5V_SYS"),("VOUT","5V_SYS"),
               ("SDA","I2C1_PMIC_SDA"),("SCL","I2C1_PMIC_SCL"),("GND","GND")]),
    dict(ref="L1",  value="4u7",         fp="Inductor_SMD:L_Bourns_SRR1260",                         lib="Device",           part="L",
         pins=[("~","IP5328P_SW"),("~","5V_SYS")]),
    dict(ref="J1",  value="0R",          fp="Resistor_SMD:R_1210_3225Metric",                         lib="Device",           part="R",
         pins=[("~","GND"),("~","GND")]),
    dict(ref="J2",  value="0R",          fp="Resistor_SMD:R_1210_3225Metric",                         lib="Device",           part="R",
         pins=[("~","5V_SYS"),("~","5V_SYS")]),
    dict(ref="BAT1",value="Li-ion",      fp="Connector_JST:JST_PH_S2B-PH-K_1x02_P2.00mm_Horizontal", lib="Connector_JST",    part="JST_PH_2",
         pins=[("1","BAT_P"),("2","GND")]),
    dict(ref="TP1", value="TP_VBAT",     fp="TestPoint:TestPoint_Pad_D1.5mm",                         lib="TestPoint",        part="TestPoint",
         pins=[("1","BAT_P")]),
    dict(ref="TP2", value="TP_VOUT",     fp="TestPoint:TestPoint_Pad_D1.5mm",                         lib="TestPoint",        part="TestPoint",
         pins=[("1","5V_SYS")]),
    dict(ref="TP3", value="TP_SW",       fp="TestPoint:TestPoint_Pad_D1.0mm",                         lib="TestPoint",        part="TestPoint",
         pins=[("1","IP5328P_SW")]),
    dict(ref="TP4", value="TP_GND",      fp="TestPoint:TestPoint_Pad_D1.0mm",                         lib="TestPoint",        part="TestPoint",
         pins=[("1","GND")]),

    # ── A2: AP2112K-3.3 Clean 3.3V Rail ─────────────────────────────────────
    # ECO #2026-03-GOLD: LM1117-3.3 → AP2112K-3.3 (250mV dropout; keeps RF alive during 5V sag)
    dict(ref="U2",  value="AP2112K-3.3", fp="Package_TO_SOT_SMD:SOT-23-5",                             lib="Regulator_Linear", part="AP2112K-3.3",
         pins=[("VIN","5V_SYS"),("VOUT","3V3_CLEAN"),("GND","GND"),("EN","5V_SYS")]),

    # ── A3: USB MUX Hardening ─────────────────────────────────────────────────
    dict(ref="D1",  value="SS14",        fp="Diode_SMD:D_SMA",                                         lib="Device",           part="D_Schottky",
         pins=[("A","VBUS_A"),("K","MUX_VIN")]),
    dict(ref="D2",  value="SS14",        fp="Diode_SMD:D_SMA",                                         lib="Device",           part="D_Schottky",
         pins=[("A","VBUS_C"),("K","MUX_VIN")]),
    dict(ref="R1",  value="430k",        fp="Resistor_SMD:R_0402_1005Metric",                          lib="Device",           part="R",
         pins=[("~","5V_SYS"),("~","MUX_SEL")]),
    dict(ref="R2",  value="620k",        fp="Resistor_SMD:R_0402_1005Metric",                          lib="Device",           part="R",
         pins=[("~","MUX_SEL"),("~","GND")]),

    # A4 (hardware reset switch) REMOVED per ECO #2026-03-D; replaced by A6 power UX.

    # ── B: SL2.1A USB 2.0 Hub ────────────────────────────────────────────────
    dict(ref="U3",  value="SL2.1A",      fp="Package_DFN_QFN:QFN-28-1EP_5x5mm_P0.5mm_EP3.35x3.35mm", lib="Daemon_V0",        part="SL2.1A",
         pins=[("VDD","5V_SYS"),("GND","GND"),
               ("DP_UP","USB_DP_UP"),("DM_UP","USB_DM_UP"),
               ("DP1","USB_DP_1"),("DM1","USB_DM_1"),
               ("DP2","USB_DP_2"),("DM2","USB_DM_2"),
               ("DP3","USB_DP_3"),("DM3","USB_DM_3"),
               ("DP4","USB_DP_4"),("DM4","USB_DM_4")]),
    dict(ref="X1",  value="12MHz",       fp="Crystal:Crystal_SMD_3225-4Pin_3.2x2.5mm",                lib="Device",           part="Crystal",
         pins=[("1","GND"),("2","GND"),("3","GND"),("4","GND")]),

    # ── C: Stinger Ports (3× SY6280AAC) ──────────────────────────────────────
    dict(ref="U4",  value="SY6280AAC",   fp="Package_TO_SOT_SMD:SOT-23-5",                             lib="Daemon_V0",        part="SY6280AAC",
         pins=[("IN","5V_SYS"),("OUT","USB_VBUS_1"),("EN","STINGER_EN_1"),("FLAG","STINGER_FLAG_1"),("GND","GND"),("ISET","STINGER_ISET_1")]),
    dict(ref="U5",  value="SY6280AAC",   fp="Package_TO_SOT_SMD:SOT-23-5",                             lib="Daemon_V0",        part="SY6280AAC",
         pins=[("IN","5V_SYS"),("OUT","USB_VBUS_2"),("EN","STINGER_EN_2"),("FLAG","STINGER_FLAG_2"),("GND","GND"),("ISET","STINGER_ISET_2")]),
    dict(ref="U6",  value="SY6280AAC",   fp="Package_TO_SOT_SMD:SOT-23-5",                             lib="Daemon_V0",        part="SY6280AAC",
         pins=[("IN","5V_SYS"),("OUT","USB_VBUS_3"),("EN","STINGER_EN_3"),("FLAG","STINGER_FLAG_3"),("GND","GND"),("ISET","STINGER_ISET_3")]),

    # ── G: NE555 Heartbeat ────────────────────────────────────────────────────
    dict(ref="U7",  value="NE555",       fp="Package_DIP:DIP-8_W7.62mm",                               lib="Timer",            part="NE555",
         pins=[("GND","GND"),("VCC","5V_SYS"),("OUT","NE555_OUT"),("THR","NE555_THRESH"),("CV","NE555_CTRL"),("TR","NE555_THRESH"),("DIS","NE555_THRESH"),("RST","5V_SYS")]),
    dict(ref="Q1",  value="BC857",       fp="Package_TO_SOT_SMD:SOT-23",                               lib="Device",           part="Q_PNP_EBC",
         pins=[("E","5V_SYS"),("B","BJT_BASE"),("C","BJT_COLLECTOR")]),

    # ── H: CC1101 RF Transceiver ──────────────────────────────────────────────
    dict(ref="U8",  value="CC1101",      fp="Package_DFN_QFN:QFN-20-1EP_4x4mm_P0.5mm_EP2.6x2.6mm",    lib="RF_Transceiver",   part="CC1101",
         pins=[("VDD","3V3_CLEAN"),("GND","GND"),
               ("SCLK","SOFT_SPI_SCK"),("SI","SOFT_SPI_MOSI"),("SO","SOFT_SPI_MISO"),
               ("CSN","RF_CS_N"),("GDO0","RF_GDO0"),("GDO1","RF_GDO1"),("GDO2","RF_GDO2"),
               ("XI","RF_XI"),("XO","RF_XO"),("RBIAS","RF_RBIAS"),
               ("RF_P","RF_ANT_P"),("RF_N","RF_ANT_N")]),
    dict(ref="X2",  value="26MHz",       fp="Crystal:Crystal_SMD_3225-4Pin_3.2x2.5mm",                lib="Device",           part="Crystal",
         pins=[("1","RF_XI"),("2","RF_XO"),("3","GND"),("4","GND")]),

    # CAN bus (MCP2515 + MCP2551) REMOVED per ECO #2026-02-V2.

    # ── J: ISO1212 Industrial Isolation ──────────────────────────────────────
    dict(ref="U11", value="ISO1212",     fp="Package_SO:SOIC-16W_7.5x10.3mm_P1.27mm",                 lib="Interface_Isolation",part="ISO1212",
         pins=[("VCC","3V3_SYS"),("GND","GND"),("GND1","ISO_GND1"),
               ("IN1","ISO_IN1_PROT"),("IN2","ISO_IN2_PROT"),
               ("DO1","ISO_DO1"),("DO2","ISO_DO2")]),

    # ── F: 40-Pin Radxa Expansion Header ─────────────────────────────────────
    # Updated per ECO #2026-03-F (RF migration), ECO #2026-03-H (I2C migration)
    dict(ref="J3",  value="Radxa-40Pin", fp="Connector_PinHeader_2.54mm:PinHeader_2x20_P2.54mm_Vertical", lib="Connector_Generic", part="Conn_02x20_Odd_Even",
         pins=[("1","3V3_SYS"),  ("2","5V_SYS"),
               ("3","I2C1_SDA"), ("4","5V_SYS"),
               ("5","I2C1_SCL"), ("6","GND"),
               ("7","SCREEN_BL"),("8","STINGER_FLAG_2"),     # ECO-F: FLAGS→8/10; RF_MOSI→13
               ("9","GND"),      ("10","STINGER_FLAG_3"),
               ("11","STINGER_FLAG_1"),("12","I2S_BCLK"),
               ("13","RF_MOSI"), ("14","GND"),               # ECO-F: RF_MOSI on safe GPIO
               ("15","RF_MISO"), ("16","RF_CLK"),            # ECO-F: RF_MISO/CLK safe GPIOs
               ("17","3V3_SYS"), ("18","RF_CS_N"),           # ECO-F: RF_CS_N→18
               ("19","SPI0_MOSI"),("20","GND"),
               ("21","SPI0_MISO"),("22","SCREEN_RST"),
               ("23","SPI0_SCK"),("24","SCREEN_CS"),
               ("25","GND"),     ("26","GND"),               # ECO-F: pin 26 NC/GND
               ("27","GND"),     ("28","GND"),               # ECO-H: pins 27/28 NC/GND
               ("29","STINGER_EN_1"),("30","GND"),
               ("31","STINGER_EN_2"),("32","SCREEN_DC"),     # ECO-F: SCREEN_DC→32
               ("33","STINGER_EN_3"),("34","GND"),
               ("35","I2S_LRCLK"),("36","LED_DIN"),          # ECO-02-V2: LED_DIN (WS2812B)
               ("37","JOY_SW"),  ("38","I2S_DATA_IN"),
               ("39","GND"),     ("40","I2S_DATA_OUT")]),

    # ── Auxiliary 4-pin GPIO header ───────────────────────────────────────────
    # ECO #2026-02-V2: pin 1 ISO_DO1, pin 2 ISO_DO2, pin 3 IR_GPIO (CAN_INT_N removed)
    dict(ref="J4",  value="AUX-GPIO",    fp="Connector_PinHeader_2.54mm:PinHeader_1x04_P2.54mm_Vertical", lib="Connector_Generic", part="Conn_01x04",
         pins=[("1","ISO_DO1"),("2","ISO_DO2"),("3","IR_GPIO"),("4","GND")]),

    # ── E: Joystick + ADS1015 ────────────────────────────────────────────────
    dict(ref="J5",  value="Joystick",    fp="Connector_PinHeader_2.54mm:PinHeader_1x05_P2.54mm_Vertical", lib="Connector_Generic", part="Conn_01x05",
         pins=[("1","GND"),("2","3V3_SYS"),("3","JOY_VRX"),("4","JOY_VRY"),("5","JOY_SW")]),
    dict(ref="U12", value="ADS1015",     fp="Package_SO:VSSOP-10_3x3mm_P0.5mm",                       lib="Analog_ADC",       part="ADS1015IDGS",
         pins=[("VDD","3V3_SYS"),("GND","GND"),("SDA","I2C1_SDA"),("SCL","I2C1_SCL"),
               ("ADDR","GND"),("AIN0","JOY_VRX"),("AIN1","JOY_VRY"),
               ("AIN2","GND"),("AIN3","GND"),("ALERT/RDY","ADC_ALERT")]),

    # ── D: SPI Display connector ──────────────────────────────────────────────
    dict(ref="J6",  value="ST7789V2",    fp="Connector_PinHeader_2.54mm:PinHeader_1x08_P2.54mm_Vertical", lib="Connector_Generic", part="Conn_01x08",
         pins=[("1","3V3_SYS"),("2","GND"),("3","SPI0_SCK"),("4","SPI0_MOSI"),
               ("5","SCREEN_CS"),("6","SCREEN_DC"),("7","SCREEN_RST"),("8","SCREEN_BL")]),
]


# ── KiCad netlist S-expression builder ───────────────────────────────────────


def _sexp(tag: str, *children, **attrs) -> str:
    """Build a single-level S-expression string."""
    parts = [f"({tag}"]
    for k, v in attrs.items():
        parts.append(f' ({k} "{v}")')
    for child in children:
        parts.append(f" {child}")
    parts.append(")")
    return "".join(parts)


def _build_netlist() -> str:
    """
    Render the full KiCad netlist S-expression.

    Format follows KiCad 5 export (version "E").  KiCad 6/7 can import
    this format directly.
    """
    now = datetime.datetime.now().strftime("%Y-%m-%d %H:%M")
    lines: list[str] = []

    lines.append('(export (version "E")')
    lines.append("  (design")
    lines.append(f'    (source "netlist/full_system.py")')
    lines.append(f'    (date "{now}")')
    lines.append('    (tool "Daemon V0 Phase 4 — gen_golden_netlist.py")')
    lines.append("  )")

    # ── components section ────────────────────────────────────────────────────
    lines.append("  (components")
    for c in COMPONENTS:
        lines.append(f'    (comp (ref "{c["ref"]}")')
        lines.append(f'          (value "{c["value"]}")')
        lines.append(f'          (footprint "{c["fp"]}")')
        lines.append(f'          (libsource (lib "{c["lib"]}") (part "{c["part"]}"))')
        lines.append("    )")
    lines.append("  )")

    # ── nets section ─────────────────────────────────────────────────────────
    # Build reverse map: net_name → [(ref, pin_name), ...]
    net_map: dict[str, list[tuple[str, str]]] = {}
    for net in NETS:
        net_map[net] = []
    for c in COMPONENTS:
        for pin_name, net_name in c["pins"]:
            if net_name not in net_map:
                net_map[net_name] = []
            net_map[net_name].append((c["ref"], pin_name))

    lines.append("  (nets")
    for code, (net_name, nodes) in enumerate(net_map.items(), start=1):
        lines.append(f'    (net (code "{code}") (name "{net_name}")')
        for ref, pin in nodes:
            lines.append(f'      (node (ref "{ref}") (pin "{pin}"))')
        lines.append("    )")
    lines.append("  )")

    lines.append(")")
    return "\n".join(lines) + "\n"


def generate_golden_netlist() -> None:
    content = _build_netlist()
    OUTPUT_FILE.write_text(content, encoding="utf-8")
    first_lines = content.splitlines()[:20]
    print(f"Golden netlist written → {OUTPUT_FILE}")
    print(f"  Components : {len(COMPONENTS)}")
    print(f"  Nets       : {len(NETS)}")
    print()
    print("── First 20 lines ──────────────────────────────────────")
    for line in first_lines:
        print(line)
    print("────────────────────────────────────────────────────────")


if __name__ == "__main__":
    generate_golden_netlist()
