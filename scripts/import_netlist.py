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
NETLIST_PATH = REPO / "daemon_v0_full_system.net"

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

    # Extract pad-to-net assignments from the (nets ...) section
    # Format: (net (code "N") (name "X")\n  (node (ref "R1") (pin "1"))\n  ...\n)
    pad_nets: dict[tuple[str, str], str] = {}  # (ref, pin) -> net_name
    # Find the (nets ...) section, then parse each net block
    nets_section = re.search(r'\(nets\s*\n(.*)\)\s*\)\s*$', text, re.DOTALL)
    if nets_section:
        nets_text = nets_section.group(1)
        # Split into individual net blocks: each starts with (net and ends before next (net or end
        net_blocks = re.split(r'(?=\(net\s+\(code)', nets_text)
        for block in net_blocks:
            block = block.strip()
            if not block:
                continue
            name_m = re.search(r'\(name\s+"([^"]+)"\)', block)
            if not name_m:
                continue
            net_name = name_m.group(1)
            for node_m in re.finditer(r'\(node\s+\(ref\s+"([^"]+)"\)\s+\(pin\s+"([^"]+)"\)\)', block):
                ref, pin = node_m.group(1), node_m.group(2)
                pad_nets[(ref, pin)] = net_name

    return components, nets, pad_nets


def main() -> None:
    if not NETLIST_PATH.exists():
        sys.exit(f"Netlist not found: {NETLIST_PATH}\nRun: python -m netlist.gen_golden_netlist")

    if not BOARD_PATH.exists():
        sys.exit(f"Board not found: {BOARD_PATH}\nRun: python scripts/create_kicad_project.py")

    components, nets, pad_nets = _parse_netlist(NETLIST_PATH)
    print(f"Parsed netlist: {len(components)} components, {len(nets)} nets, {len(pad_nets)} pad-net assignments")

    board = pcbnew.LoadBoard(str(BOARD_PATH))

    # Remove existing footprints and nets to prevent duplicates on re-import
    existing_fps = list(board.GetFootprints())
    if existing_fps:
        print(f"  Removing {len(existing_fps)} existing footprints (clean re-import)")
        for fp in existing_fps:
            board.Remove(fp)

    # Add nets to the board (pcbnew deduplicates automatically)
    netinfo = board.GetNetInfo()
    for net in nets:
        if not board.FindNet(net["name"]):
            new_net = pcbnew.NETINFO_ITEM(board, net["name"])
            board.Add(new_net)
    print(f"  Added {len(nets)} nets to board")

    # Use the KiCad IO plugin to load footprints
    io = pcbnew.PCB_IO_KICAD_SEXPR()

    def load_fp(fp_str: str) -> pcbnew.FOOTPRINT | None:
        """Load footprint — custom Daemon_V0 lib first, then KiCad standard."""
        lib_name, fp_name = fp_str.split(":", 1)
        # Always check custom library first (has correct 3D model refs)
        custom_lib = REPO / "lib" / "Daemon_V0.pretty"
        kicad_mod = custom_lib / (fp_name + ".kicad_mod")
        if kicad_mod.exists():
            try:
                return io.FootprintLoad(str(custom_lib), fp_name)
            except Exception:
                pass
        # Fall back to KiCad default library
        kicad_lib = Path("/usr/share/kicad/footprints") / (lib_name + ".pretty")
        if kicad_lib.is_dir():
            kicad_mod = kicad_lib / (fp_name + ".kicad_mod")
            if kicad_mod.exists():
                try:
                    return io.FootprintLoad(str(kicad_lib), fp_name)
                except Exception:
                    pass
        return None

    # Categorize components into tiers for organized staging layout
    # Tier 1: ICs and major connectors (top rows, wide spacing)
    # Tier 2: Discrete semiconductors, crystals, switches, LEDs, ferrites
    # Tier 3: Passives (resistors, capacitors) — bottom rows, tight grid
    def tier(comp):
        ref = comp["ref"]
        fp = comp["footprint"]
        if ref.startswith("U") or ref.startswith("J") or ref.startswith("BAT"):
            return 1  # ICs + connectors
        if ref.startswith("ANT"):
            return 1
        if (ref.startswith("Q") or ref.startswith("Y") or ref.startswith("SW")
                or ref.startswith("LED") or ref.startswith("FB")
                or ref.startswith("F") or ref.startswith("D")
                or ref.startswith("L") or ref.startswith("TP")):
            return 2  # Discrete semiconductors, crystals, switches, etc.
        return 3  # R, C passives

    tier1 = [c for c in components if tier(c) == 1]
    tier2 = [c for c in components if tier(c) == 2]
    tier3 = [c for c in components if tier(c) == 3]

    placed = 0
    skipped = []

    def place_tier(comps, start_x, start_y, cols, pitch):
        nonlocal placed
        for i, comp in enumerate(comps):
            ref = comp["ref"]
            fp_str = comp["footprint"]
            value = comp["value"]

            fp_obj = load_fp(fp_str)
            if fp_obj is None:
                skipped.append(f"{ref} ({fp_str})")
                continue

            fp_obj.SetReference(ref)
            fp_obj.SetValue(value)

            # Make both reference and value text visible and readable
            ref_text = fp_obj.Reference()
            ref_text.SetVisible(True)
            ref_text.SetTextSize(pcbnew.VECTOR2I(pcbnew.FromMM(0.8), pcbnew.FromMM(0.8)))
            ref_text.SetTextThickness(pcbnew.FromMM(0.12))

            val_text = fp_obj.Value()
            val_text.SetVisible(True)
            val_text.SetTextSize(pcbnew.VECTOR2I(pcbnew.FromMM(0.7), pcbnew.FromMM(0.7)))
            val_text.SetTextThickness(pcbnew.FromMM(0.10))
            # Offset value below reference so they don't overlap
            val_text.SetPosition(fp_obj.GetPosition() + pcbnew.VECTOR2I(0, pcbnew.FromMM(1.5)))

            row = i // cols
            col = i % cols
            x = start_x + col * pitch
            y = start_y + row * pitch
            fp_obj.SetPosition(pcbnew.VECTOR2I(pcbnew.FromMM(x), pcbnew.FromMM(y)))

            board.Add(fp_obj)
            placed += 1

        rows_used = (len(comps) + cols - 1) // cols
        return start_y + rows_used * pitch + 10.0  # next tier Y with gap

    # Tier 1: ICs + connectors — top, wide spacing (20mm), 5 cols
    next_y = place_tier(tier1, STAGING_X, STAGING_Y, cols=5, pitch=20.0)
    # Tier 2: Discrete — mid, medium spacing (12mm), 8 cols
    next_y = place_tier(tier2, STAGING_X, next_y, cols=8, pitch=12.0)
    # Tier 3: Passives — bottom, tight grid (8mm), 12 cols
    place_tier(tier3, STAGING_X, next_y, cols=12, pitch=8.0)

    print(f"  Placed {placed} footprints (Tier1:{len(tier1)} Tier2:{len(tier2)} Tier3:{len(tier3)})")
    if skipped:
        print(f"  Skipped {len(skipped)} (footprint not found):")
        for s in skipped:
            print(f"    - {s}")

    # Assign nets to pads using the pad-net mapping from the .net file.
    # The netlist now outputs KiCad pad numbers (not pin names) thanks to PIN_MAPS
    # in gen_golden_netlist.py.
    assigned = 0
    unassigned = []
    for fp in board.GetFootprints():
        ref = fp.GetReference()
        if ref.startswith("REF_"):
            continue
        pad_by_number = {pad.GetNumber(): pad for pad in fp.Pads()}
        for (pn_ref, pn_pin), pn_net in pad_nets.items():
            if pn_ref != ref:
                continue
            net_info = board.FindNet(pn_net)
            if not net_info:
                continue
            if pn_pin in pad_by_number:
                pad_by_number[pn_pin].SetNet(net_info)
                assigned += 1
            else:
                unassigned.append(f"{ref}.{pn_pin} -> {pn_net} (pad not found, have: {list(pad_by_number.keys())[:5]})")
    print(f"  Assigned {assigned} pad-net connections")
    if unassigned:
        print(f"  Unassigned ({len(unassigned)}):")
        for u in unassigned[:15]:
            print(f"    - {u}")

    # Add non-electrical reference drawings (Radxa outline, speaker outline)
    ref_lib = REPO / "daemon_v0.pretty"
    ref_footprints = [
        ("Radxa_Zero_3W_Reference", 50.0, 50.0),   # center of board area
        ("Speaker_Oval_Reference",  50.0, 120.0),
    ]
    for fp_name, rx, ry in ref_footprints:
        fp_file = ref_lib / (fp_name + ".kicad_mod")
        if fp_file.exists():
            try:
                ref_fp = io.FootprintLoad(str(ref_lib), fp_name)
                ref_fp.SetReference(f"REF_{fp_name}")
                ref_fp.SetPosition(pcbnew.VECTOR2I(pcbnew.FromMM(rx), pcbnew.FromMM(ry)))
                board.Add(ref_fp)
                print(f"  Added reference: {fp_name}")
            except Exception as e:
                print(f"  Warning: Could not load {fp_name}: {e}")

    pcbnew.SaveBoard(str(BOARD_PATH), board)
    print(f"\nBoard saved → {BOARD_PATH}")
    print(f"  Total footprints: {placed} + references")
    print(f"  Total nets: {board.GetNetCount()}")
    print(f"\nNext step: Open in KiCad GUI for anchor placement, then run placement automation.")


if __name__ == "__main__":
    main()