#!/usr/bin/env python3
"""
Generate REAL KiCad schematic files for the patent drawings.
Uses actual KiCad standard symbols (Device:Battery, Device:R, Device:LED, Sensor_Audio:ICS-43434).
Output: .kicad_sch files openable in KiCad 10 on the MSI for clean PDF export.
"""

import re
import uuid
from pathlib import Path

OUTDIR = Path('/home/arthur/daemon/hardware/patent_kicad')

def extract_symbol_def(kicad_sym_path: Path, lib_prefix: str) -> str:
    """Read a .kicad_sym file and extract the inner (symbol ...) block,
    renaming it to use the library prefix (e.g. 'Device:Battery')."""
    content = kicad_sym_path.read_text()
    # Find the (symbol "Name" ... ) block
    # The file has (kicad_symbol_lib (version ...) (generator ...) (symbol "Name" ...))
    # We want just the (symbol ...) part with the name prefixed

    # Find the symbol name
    name_match = re.search(r'\(symbol\s+"([^"]+)"', content)
    if not name_match:
        raise ValueError(f"No symbol name in {kicad_sym_path}")
    name = name_match.group(1)

    # Find the symbol block — it starts at "(symbol \"Name\"" and we need balanced parens
    start = content.find(f'(symbol "{name}"')
    if start < 0:
        raise ValueError(f"Symbol block not found in {kicad_sym_path}")

    depth = 0
    end = start
    for i in range(start, len(content)):
        c = content[i]
        if c == '(':
            depth += 1
        elif c == ')':
            depth -= 1
            if depth == 0:
                end = i + 1
                break

    block = content[start:end]
    # Rename: (symbol "Name" → (symbol "lib_prefix:Name"
    block = block.replace(f'(symbol "{name}"', f'(symbol "{lib_prefix}:{name}"', 1)
    return block


def gen_uuid() -> str:
    return str(uuid.uuid4())


# Read all symbols we need
battery_sym = extract_symbol_def(OUTDIR / 'Battery.kicad_sym', 'Device')
r_sym = extract_symbol_def(OUTDIR / 'R.kicad_sym', 'Device')
led_sym = extract_symbol_def(OUTDIR / 'LED.kicad_sym', 'Device')
mic_sym = extract_symbol_def(OUTDIR / 'ICS-43434.kicad_sym', 'Sensor_Audio')

# Indent the symbols
def indent(text: str, n: int = 2) -> str:
    pad = '\t' * n
    return '\n'.join(pad + line if line.strip() else line for line in text.split('\n'))


# ============================================================
# FIG 1A: Series configuration
# ============================================================
# Layout (mm coordinates):
# - Battery at (100, 50)        — pins: + at (100, 44.92), - at (100, 55.08)
# - R at (100, 67)              — pins: top (100, 63.19), bottom (100, 70.81)
# - LED at (100, 80) rot 90     — anode now at top, cathode at bottom
#   LED default: K at (-3.81,0), A at (3.81,0). After rot 90 (CCW):
#   K → (0, -3.81)? Need to check. Use rot 270 for safety.
#   With rot 270: pin K (-3.81,0) → (0, 3.81) [TOP], pin A (3.81,0) → (0, -3.81) [BOT]
#   We want anode at TOP for current flow, so rotation 90.
#   With rot 90: K (-3.81,0) → (0, -3.81) [BOT], A (3.81,0) → (0, 3.81) [TOP].
# - Mic at (100, 100)           — VDD pin 5 at (100, 92.38), GND pin 3 at (100, 107.62)

uuid_battery = gen_uuid()
uuid_r = gen_uuid()
uuid_led = gen_uuid()
uuid_mic = gen_uuid()
uuid_sheet = gen_uuid()

# Wires
wires_1a = [
    # Battery (-) to R (top)
    ((100, 55.08), (100, 63.19)),
    # R (bottom) to LED (top, which is the anode after rot 90)
    # LED at (100, 80) rot 90 → anode pin 2 at (100, 80-3.81) = (100, 76.19)
    ((100, 70.81), (100, 76.19)),
    # LED (bottom = cathode) at (100, 83.81) to mic VDD at (100, 92.38)
    ((100, 83.81), (100, 92.38)),
    # Battery (+) at (100, 44.92) — connect to power flag (we'll add a junction or just leave open)
]

# Generate wire blocks
def wire_block(p1, p2):
    return f'''\t(wire
\t\t(pts (xy {p1[0]} {p1[1]}) (xy {p2[0]} {p2[1]}))
\t\t(stroke (width 0) (type default))
\t\t(uuid "{gen_uuid()}")
\t)'''

wires_1a_text = '\n'.join(wire_block(*w) for w in wires_1a)


# Symbol instance helper
def symbol_instance(lib_id: str, x: float, y: float, rot: int,
                    ref: str, value: str, instance_uuid: str,
                    sheet_path: str = "/" ) -> str:
    return f'''\t(symbol
\t\t(lib_id "{lib_id}")
\t\t(at {x} {y} {rot})
\t\t(unit 1)
\t\t(exclude_from_sim no)
\t\t(in_bom yes)
\t\t(on_board yes)
\t\t(dnp no)
\t\t(uuid "{instance_uuid}")
\t\t(property "Reference" "{ref}"
\t\t\t(at {x + 4} {y - 1.27} 0)
\t\t\t(effects (font (size 1.27 1.27)) (justify left))
\t\t)
\t\t(property "Value" "{value}"
\t\t\t(at {x + 4} {y + 1.27} 0)
\t\t\t(effects (font (size 1.27 1.27)) (justify left))
\t\t)
\t\t(property "Footprint" ""
\t\t\t(at {x} {y} 0)
\t\t\t(effects (font (size 1.27 1.27)) (hide yes))
\t\t)
\t\t(property "Datasheet" ""
\t\t\t(at {x} {y} 0)
\t\t\t(effects (font (size 1.27 1.27)) (hide yes))
\t\t)
\t\t(instances
\t\t\t(project ""
\t\t\t\t(path "/{uuid_sheet}"
\t\t\t\t\t(reference "{ref}") (unit 1)
\t\t\t\t)
\t\t\t)
\t\t)
\t)'''


symbols_1a = [
    symbol_instance("Device:Battery", 100, 50, 0, "BT1", "110", uuid_battery),
    symbol_instance("Device:R", 100, 67, 0, "R1", "R", uuid_r),
    symbol_instance("Device:LED", 100, 80, 90, "D1", "140", uuid_led),
    symbol_instance("Sensor_Audio:ICS-43434", 100, 100, 0, "MK1", "150", uuid_mic),
]
symbols_1a_text = '\n'.join(symbols_1a)


sch_1a = f'''(kicad_sch
\t(version 20231120)
\t(generator "eeschema")
\t(generator_version "10.0")
\t(uuid "{uuid_sheet}")
\t(paper "A4")
\t(title_block
\t\t(title "Patent Figure 1A — Series Configuration")
\t\t(date "2026-04-07")
\t\t(rev "1.0")
\t\t(company "Arthur Camara")
\t\t(comment 1 "Privacy LED Interlock — series configuration")
\t)
\t(lib_symbols
{indent(battery_sym, 2)}
{indent(r_sym, 2)}
{indent(led_sym, 2)}
{indent(mic_sym, 2)}
\t)
{wires_1a_text}
{symbols_1a_text}
\t(sheet_instances
\t\t(path "/" (page "1"))
\t)
\t(embedded_fonts no)
)
'''

(OUTDIR / 'patent_fig1a.kicad_sch').write_text(sch_1a)
print("Wrote patent_fig1a.kicad_sch")
