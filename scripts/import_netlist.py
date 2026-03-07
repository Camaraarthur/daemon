#!/usr/bin/env python3
"""Import the golden netlist into the Daemon V0 KiCad PCB.

Parses daemon_v0_full_system.net (KiCad S-expression format) and
creates footprints + nets in the daemon_v0.kicad_pcb board file
using the pcbnew Python API.

Must be run with PYTHONPATH pointing to the KiCad pcbnew module:
  PYTHONPATH=/usr/lib/python3/dist-packages python3 scripts/import_netlist.py
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

try:
    import pcbnew
except ImportError:
    sys.exit(
        "pcbnew not found. Run with:\n"
        "  PYTHONPATH=/usr/lib/python3/dist-packages python3 scripts/import_netlist.py"
    )

REPO = Path(__file__).resolve().parent.parent
BOARD_PATH = REPO / "daemon_v0.kicad_pcb"
NETLIST_PATH = REPO / "daemon_v0_merged.net"

# Default placement area — components will be initially placed in a grid
# outside the board outline for later manual/automated placement.
STAGING_X = 200.0  # mm — staging area to the right of the board
STAGING_Y = 100.0  # mm
GRID_PITCH = 15.0  # mm — spacing between staged components


def _parse_netlist(path: Path) -> tuple[list[dict], list[dict]]:
    """Parse KiCad .net file and extract components and nets.

    Handles both the golden (gen_golden_netlist.py) and full SKiDL-generated
    netlist formats, where comp fields may span multiple lines.
    """
    text = path.read_text(encoding="utf-8")

    # Extract components — multiline tolerant
    components = []
    for m in re.finditer(
        r'\(comp\s*\n?\s*\(ref\s+"([^"]+)"\)',
        text,
    ):
        ref = m.group(1)
        # Find footprint within this comp block (search forward up to 500 chars)
        block = text[m.start():m.start() + 500]
        fp_m = re.search(r'\(footprint\s+"([^"]+)"\)', block)
        val_m = re.search(r'\(value\s+"([^"]*)"', block)
        if fp_m:
            components.append({
                "ref": ref,
                "value": val_m.group(1) if val_m else ref,
                "footprint": fp_m.group(1),
            })

    # Extract nets — both quoted and unquoted code formats
    nets = []
    for m in re.finditer(r'\(net\s*\n?\s*\(code\s+"?(\d+)"?\)\s*\n?\s*\(name\s+"([^"]+)"\)', text):
        nets.append({"code": int(m.group(1)), "name": m.group(2)})

    return components, nets


def main() -> None:
    if not NETLIST_PATH.exists():
        sys.exit(f"Netlist not found: {NETLIST_PATH}\nRun: python -m netlist.gen_golden_netlist")

    if not BOARD_PATH.exists():
        sys.exit(f"Board not found: {BOARD_PATH}\nRun: python scripts/create_kicad_project.py")

    components, nets = _parse_netlist(NETLIST_PATH)
    print(f"Parsed netlist: {len(components)} components, {len(nets)} nets")

    board = pcbnew.LoadBoard(str(BOARD_PATH))

    # Add nets to the board
    netinfo = board.GetNetInfo()
    for net in nets:
        new_net = pcbnew.NETINFO_ITEM(board, net["name"])
        board.Add(new_net)
    print(f"  Added {len(nets)} nets to board")

    # Use the KiCad IO plugin to load footprints
    io = pcbnew.PCB_IO_KICAD_SEXPR()

    def load_fp(fp_str: str) -> pcbnew.FOOTPRINT | None:
        """Try loading a footprint from KiCad default libs then custom lib."""
        lib_name, fp_name = fp_str.split(":", 1)
        # KiCad default library
        kicad_lib = Path("/usr/share/kicad/footprints") / (lib_name + ".pretty")
        if kicad_lib.is_dir():
            kicad_mod = kicad_lib / (fp_name + ".kicad_mod")
            if kicad_mod.exists():
                try:
                    return io.FootprintLoad(str(kicad_lib), fp_name)
                except Exception:
                    pass
        # Custom library
        custom_lib = REPO / "lib" / "Daemon_V0.pretty"
        kicad_mod = custom_lib / (fp_name + ".kicad_mod")
        if kicad_mod.exists():
            try:
                return io.FootprintLoad(str(custom_lib), fp_name)
            except Exception:
                pass
        return None

    # Place components in a staging grid
    cols = 6
    placed = 0
    skipped = []

    for i, comp in enumerate(components):
        ref = comp["ref"]
        fp_str = comp["footprint"]
        value = comp["value"]

        fp = load_fp(fp_str)
        if fp is None:
            skipped.append(f"{ref} ({fp_str})")
            continue

        fp.SetReference(ref)
        fp.SetValue(value)

        # Place in staging grid
        row = i // cols
        col = i % cols
        x = STAGING_X + col * GRID_PITCH
        y = STAGING_Y + row * GRID_PITCH
        fp.SetPosition(pcbnew.VECTOR2I(pcbnew.FromMM(x), pcbnew.FromMM(y)))

        board.Add(fp)
        placed += 1

    print(f"  Placed {placed} footprints in staging area")
    if skipped:
        print(f"  Skipped {len(skipped)} (footprint not found):")
        for s in skipped:
            print(f"    - {s}")

    pcbnew.SaveBoard(str(BOARD_PATH), board)
    print(f"\nBoard saved → {BOARD_PATH}")
    print(f"  Total footprints: {placed}")
    print(f"  Total nets: {board.GetNetCount()}")
    print(f"\nNext step: Open in KiCad GUI for anchor placement, then run placement automation.")


if __name__ == "__main__":
    main()
