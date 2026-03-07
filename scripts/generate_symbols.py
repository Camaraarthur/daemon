#!/usr/bin/env python3
"""Generate the Daemon_V0 custom KiCad symbol library.

Produces lib/Daemon_V0.kicad_sym with 6 symbols whose pin names
exactly match the SKiDL ic["PIN"] accesses in netlist/full_system.py
and netlist/audio_subsystem.py.

Pin numbers are assigned sequentially (schematic-only symbols);
actual physical pad mapping lives in the footprint.
"""

from __future__ import annotations

import textwrap
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
OUT = REPO / "lib" / "Daemon_V0.kicad_sym"

# ── Symbol definitions ───────────────────────────────────────────────────────
# Each entry: (name, reference_prefix, footprint, pins)
# pins: list of (name, type, side)
#   type: "power_in", "passive", "input", "output", "bidirectional", "tri_state"
#   side: "left", "right", "top", "bottom"

SYMBOLS: list[dict] = [
    {
        "name": "IP5328P",
        "ref": "U",
        "fp": "Package_DFN_QFN:QFN-40-1EP_6x6mm_P0.5mm_EP4.6x4.6mm",
        "desc": "Injoinic IP5328P bidirectional buck/boost PMIC, QFN-40",
        "pins": [
            ("VIN",  "power_in",     "left"),
            ("BAT",  "power_in",     "left"),
            ("SW",   "passive",      "left"),
            ("VOUT", "power_out",    "right"),
            ("MFB",  "input",        "left"),
            ("KEY",  "input",        "left"),
            ("SDA",  "bidirectional","right"),
            ("SCL",  "input",        "right"),
            ("NTC",  "input",        "left"),
            ("GND",  "power_in",     "bottom"),
            ("EP",   "passive",      "bottom"),
        ],
    },
    {
        "name": "SL2.1A",
        "ref": "U",
        "fp": "Package_DFN_QFN:QFN-28-1EP_5x5mm_P0.5mm_EP3.35x3.35mm",
        "desc": "Terminus SL2.1A 4-port USB 2.0 hub, QFN-28",
        "pins": [
            ("VDD33",  "power_in",     "left"),
            ("GND",    "power_in",     "bottom"),
            ("DP_U",   "bidirectional","left"),
            ("DM_U",   "bidirectional","left"),
            ("DP1",    "bidirectional","right"),
            ("DM1",    "bidirectional","right"),
            ("DP2",    "bidirectional","right"),
            ("DM2",    "bidirectional","right"),
            ("DP3",    "bidirectional","right"),
            ("DM3",    "bidirectional","right"),
            ("DP4",    "bidirectional","right"),
            ("DM4",    "bidirectional","right"),
            ("XI",     "input",        "left"),
            ("XO",     "output",       "left"),
            ("RBIAS",  "passive",      "left"),
            ("RST_N",  "input",        "left"),
            ("SUSP_N", "input",        "left"),
            ("OC_N1",  "input",        "left"),
            ("OC_N2",  "input",        "left"),
            ("OC_N3",  "input",        "left"),
            ("OC_N4",  "input",        "left"),
            ("CFG0",   "input",        "bottom"),
            ("CFG1",   "input",        "bottom"),
            ("CFG2",   "input",        "bottom"),
            ("EP",     "passive",      "bottom"),
        ],
    },
    {
        "name": "SY6280AAC",
        "ref": "U",
        "fp": "Package_TO_SOT_SMD:SOT-23-5",
        "desc": "Silergy SY6280AAC programmable current-limit USB switch, SOT-23-5",
        "pins": [
            ("IN",   "power_in",  "left"),
            ("GND",  "power_in",  "bottom"),
            ("EN",   "input",     "left"),
            ("FLAG", "output",    "right"),
            ("OUT",  "power_out", "right"),
            ("ISET", "passive",   "right"),
        ],
    },
    {
        "name": "RTL8152B",
        "ref": "U",
        "fp": "Package_DFN_QFN:QFN-32-1EP_5x5mm_P0.5mm_EP3.1x3.1mm",
        "desc": "Realtek RTL8152B USB 2.0 to 100Base-TX Ethernet, QFN-32",
        "pins": [
            ("USB_DP",  "bidirectional","left"),
            ("USB_DM",  "bidirectional","left"),
            ("VDD",     "power_in",     "left"),
            ("GND",     "power_in",     "bottom"),
            ("XI",      "input",        "left"),
            ("XO",      "output",       "left"),
            ("MDI_TXP", "output",       "right"),
            ("MDI_TXN", "output",       "right"),
            ("MDI_RXP", "input",        "right"),
            ("MDI_RXN", "input",        "right"),
            ("PSELF",   "input",        "left"),
            ("XTALDET", "input",        "left"),
            ("EP",      "passive",      "bottom"),
        ],
    },
    {
        "name": "ISO1212",
        "ref": "U",
        "fp": "Package_SO:SOIC-16W_7.5x10.3mm_P1.27mm",
        "desc": "TI ISO1212 dual digital isolator, SOIC-16W",
        "pins": [
            ("VCC1", "power_in",  "left"),
            ("GND1", "power_in",  "left"),
            ("IN1",  "input",     "left"),
            ("IN2",  "input",     "left"),
            ("VCC2", "power_in",  "right"),
            ("GND2", "power_in",  "right"),
            ("OUT1", "output",    "right"),
            ("OUT2", "output",    "right"),
        ],
    },
    {
        "name": "ESD9B5.0ST5G",
        "ref": "D",
        "fp": "Package_TO_SOT_SMD:SOT-323_SC-70",
        "desc": "ON Semi ESD9B5.0ST5G bidirectional TVS diode, SC-70-3",
        "pins": [
            ("A", "passive", "left"),
            ("K", "passive", "right"),
        ],
    },
    {
        "name": "AudioJack4_Switch",
        "ref": "J",
        "fp": "Daemon_V0:Jack_3.5mm_SJ2-2531X-SMT",
        "desc": "3.5mm TRRS audio jack with detect and NC switches (SJ2-2531X-SMT)",
        "pins": [
            ("Tip",         "passive", "right"),
            ("TipSwitch",   "passive", "right"),
            ("Ring1",       "passive", "right"),
            ("Ring1Switch", "passive", "right"),
            ("Sleeve",      "passive", "left"),
            ("Detect",      "passive", "left"),
        ],
    },
    {
        "name": "INMP441",
        "ref": "U",
        "fp": "Sensor_Audio:InvenSense_INMP441_BottomPort",
        "desc": "InvenSense INMP441 omnidirectional MEMS I2S microphone",
        "pins": [
            ("VDD",  "power_in",      "left"),
            ("GND",  "power_in",      "bottom"),
            ("SCK",  "input",         "left"),
            ("WS",   "input",         "left"),
            ("SD",   "output",        "right"),
            ("L/R",  "input",         "left"),
        ],
    },
    {
        "name": "CC1101",
        "ref": "U",
        "fp": "Package_DFN_QFN:QFN-20-1EP_4x4mm_P0.5mm_EP2.6x2.6mm",
        "desc": "TI CC1101 sub-GHz RF transceiver, QFN-20",
        "pins": [
            ("VDD",   "power_in",      "left"),
            ("GND",   "power_in",      "bottom"),
            ("SCLK",  "input",         "left"),
            ("SI",    "input",         "left"),
            ("SO",    "tri_state",     "right"),
            ("CSN",   "input",         "left"),
            ("GDO0",  "output",        "right"),
            ("GDO1",  "output",        "right"),
            ("GDO2",  "output",        "right"),
            ("RF_P",  "passive",       "right"),
            ("RF_N",  "passive",       "right"),
            ("XI",    "input",         "left"),
            ("XO",    "output",        "left"),
            ("RBIAS", "passive",       "left"),
            ("EP",    "passive",       "bottom"),
        ],
    },
]


# ── KiCad pin electrical type mapping ────────────────────────────────────────
_PIN_TYPE = {
    "power_in":      "power_in",
    "power_out":     "power_out",
    "passive":       "passive",
    "input":         "input",
    "output":        "output",
    "bidirectional": "bidirectional",
    "tri_state":     "tri_state",
}


def _pin_sexp(name: str, pin_type: str, number: int, x: float, y: float, angle: int) -> str:
    ktype = _PIN_TYPE[pin_type]
    return textwrap.dedent(f"""\
        (pin {ktype} line
          (at {x:.2f} {y:.2f} {angle})
          (length 2.54)
          (name "{name}"
            (effects (font (size 1.27 1.27)))
          )
          (number "{number}"
            (effects (font (size 1.27 1.27)))
          )
        )""")


def _symbol_sexp(sym: dict) -> str:
    name = sym["name"]
    ref = sym["ref"]
    fp = sym["fp"]
    desc = sym["desc"]
    pins = sym["pins"]

    # Layout: left pins on left side, right pins on right side
    left_pins = [(n, t, s) for n, t, s in pins if s in ("left", "bottom")]
    right_pins = [(n, t, s) for n, t, s in pins if s == "right"]

    # Compute box size
    max_pins = max(len(left_pins), len(right_pins), 1)
    box_h = max_pins * 2.54 + 2.54
    box_w = 10.16
    box_top = box_h / 2
    box_left = -box_w / 2
    box_right = box_w / 2
    box_bottom = -box_h / 2

    lines = []
    lines.append(f'    (symbol "{name}"')
    lines.append(f'      (pin_names (offset 1.016))')
    lines.append(f'      (exclude_from_sim no)')
    lines.append(f'      (in_bom yes)')
    lines.append(f'      (on_board yes)')

    # Properties
    lines.append(f'      (property "Reference" "{ref}"')
    lines.append(f'        (at 0 {box_top + 2.54:.2f} 0)')
    lines.append(f'        (effects (font (size 1.27 1.27)))')
    lines.append(f'      )')
    lines.append(f'      (property "Value" "{name}"')
    lines.append(f'        (at 0 {box_bottom - 2.54:.2f} 0)')
    lines.append(f'        (effects (font (size 1.27 1.27)))')
    lines.append(f'      )')
    lines.append(f'      (property "Footprint" "{fp}"')
    lines.append(f'        (at 0 {box_bottom - 5.08:.2f} 0)')
    lines.append(f'        (effects (font (size 1.27 1.27)) hide)')
    lines.append(f'      )')
    lines.append(f'      (property "Datasheet" ""')
    lines.append(f'        (at 0 0 0)')
    lines.append(f'        (effects (font (size 1.27 1.27)) hide)')
    lines.append(f'      )')
    lines.append(f'      (property "Description" "{desc}"')
    lines.append(f'        (at 0 0 0)')
    lines.append(f'        (effects (font (size 1.27 1.27)) hide)')
    lines.append(f'      )')

    # Sub-symbol with rectangle + pins
    lines.append(f'      (symbol "{name}_0_1"')
    lines.append(f'        (rectangle')
    lines.append(f'          (start {box_left:.2f} {box_top:.2f})')
    lines.append(f'          (end {box_right:.2f} {box_bottom:.2f})')
    lines.append(f'          (stroke (width 0.254) (type default))')
    lines.append(f'          (fill (type background))')
    lines.append(f'        )')
    lines.append(f'      )')

    lines.append(f'      (symbol "{name}_1_1"')

    # Place left/bottom pins
    pin_num = 1
    for i, (pname, ptype, _side) in enumerate(left_pins):
        y = box_top - 2.54 - i * 2.54
        x = box_left - 2.54
        lines.append("        " + _pin_sexp(pname, ptype, pin_num, x, y, 0))
        pin_num += 1

    # Place right pins
    for i, (pname, ptype, _side) in enumerate(right_pins):
        y = box_top - 2.54 - i * 2.54
        x = box_right + 2.54
        lines.append("        " + _pin_sexp(pname, ptype, pin_num, x, y, 180))
        pin_num += 1

    lines.append(f'      )')
    lines.append(f'    )')
    return "\n".join(lines)


def generate() -> None:
    OUT.parent.mkdir(parents=True, exist_ok=True)

    header = textwrap.dedent("""\
        (kicad_symbol_lib
          (version 20231120)
          (generator "daemon_v0_generate_symbols")
          (generator_version "1.0")
        """)

    body = "\n".join(_symbol_sexp(s) for s in SYMBOLS)

    OUT.write_text(header + body + "\n)\n", encoding="utf-8")
    print(f"Symbol library written → {OUT}")
    print(f"  Symbols: {len(SYMBOLS)}")
    for s in SYMBOLS:
        print(f"    {s['name']:20s} {len(s['pins']):2d} pins  [{s['fp']}]")


if __name__ == "__main__":
    generate()
