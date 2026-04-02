#!/usr/bin/env python3
"""Rebuild the KiCad board from the golden netlist.

Reads daemon_v0_full_system.net, creates a fresh board with all 193 components,
assigns nets to pads, and saves. Then runs prepare_layout_board.py logic to
stage components in a grid.

Usage:
  PYTHONPATH=/usr/lib/python3/dist-packages python scripts/rebuild_board_from_netlist.py
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

try:
    import pcbnew
except ImportError:
    sys.exit("pcbnew not found. Run with PYTHONPATH=/usr/lib/python3/dist-packages")

REPO = Path(__file__).resolve().parent.parent
NETLIST_PATH = REPO / "daemon_v0_full_system.net"
BOARD_PATH = REPO / "daemon_v0.kicad_pcb"
PROJECT_PATH = REPO / "daemon_v0.kicad_pro"

# KiCad footprint library search paths
SYSTEM_FP_DIR = Path("/usr/share/kicad/footprints")
CUSTOM_FP_DIR = REPO / "lib"

# Board dimensions
BOARD_W = 85.6
BOARD_H = 54.0
ORIGIN_X = 100.0
ORIGIN_Y = 100.0


def _mm(mm: float) -> int:
    return int(mm * 1e6)


def _board_pos(x_mm: float, y_mm: float) -> pcbnew.VECTOR2I:
    return pcbnew.VECTOR2I(_mm(ORIGIN_X + x_mm), _mm(ORIGIN_Y + y_mm))


def parse_netlist(path: Path) -> tuple[list[dict], dict[str, list[tuple[str, str]]]]:
    """Parse the golden netlist S-expression.

    Returns:
        components: [{"ref", "value", "fp", "lib", "part"}, ...]
        nets: {"net_name": [(ref, pin), ...], ...}
    """
    content = path.read_text()

    # Parse components
    components = []
    comp_pattern = re.compile(
        r'\(comp \(ref "([^"]+)"\)\s*'
        r'\(value "([^"]+)"\)\s*'
        r'\(footprint "([^"]+)"\)\s*'
        r'\(libsource \(lib "([^"]+)"\) \(part "([^"]+)"\)\)',
        re.DOTALL
    )
    for m in comp_pattern.finditer(content):
        components.append({
            "ref": m.group(1),
            "value": m.group(2),
            "fp": m.group(3),
            "lib": m.group(4),
            "part": m.group(5),
        })

    # Parse nets
    nets: dict[str, list[tuple[str, str]]] = {}
    # Find each net block
    net_block_re = re.compile(
        r'\(net \(code "[^"]+"\) \(name "([^"]+)"\)(.*?)\)',
        re.DOTALL
    )
    node_re = re.compile(r'\(node \(ref "([^"]+)"\) \(pin "([^"]+)"\)\)')

    for m in net_block_re.finditer(content):
        net_name = m.group(1)
        body = m.group(2)
        nodes = node_re.findall(body)
        nets[net_name] = [(ref, pin) for ref, pin in nodes]

    return components, nets


def resolve_fp_path(fp_str: str) -> tuple[str, str]:
    """Resolve 'Library:Footprint' to (library_path, footprint_name).

    Examples:
        'Resistor_SMD:R_0402_1005Metric' -> ('/usr/share/kicad/footprints/Resistor_SMD.pretty', 'R_0402_1005Metric')
        'Daemon_V0:SW_Alps_SKRHABE010' -> ('/home/.../lib/Daemon_V0.pretty', 'SW_Alps_SKRHABE010')
    """
    lib_name, fp_name = fp_str.split(":", 1)

    # Check custom library first
    custom_path = CUSTOM_FP_DIR / f"{lib_name}.pretty"
    if custom_path.is_dir():
        return str(custom_path), fp_name

    # Check system library
    system_path = SYSTEM_FP_DIR / f"{lib_name}.pretty"
    if system_path.is_dir():
        return str(system_path), fp_name

    # Try partial match (e.g., "Connector_RJ" might be "Connector_RJ45" in system)
    for d in SYSTEM_FP_DIR.iterdir():
        if d.is_dir() and d.name.startswith(lib_name):
            return str(d), fp_name

    return "", fp_name


def load_footprint(fp_str: str) -> pcbnew.FOOTPRINT | None:
    """Load a footprint from KiCad libraries."""
    lib_path, fp_name = resolve_fp_path(fp_str)
    if not lib_path:
        return None

    try:
        fp = pcbnew.FootprintLoad(lib_path, fp_name)
        return fp
    except Exception:
        return None


def create_board_outline(board: pcbnew.BOARD) -> None:
    """Draw the board outline on Edge.Cuts."""
    layer_id = board.GetLayerID("Edge.Cuts")
    corners = [
        (0, 0), (BOARD_W, 0), (BOARD_W, BOARD_H), (0, BOARD_H)
    ]
    for i in range(4):
        x1, y1 = corners[i]
        x2, y2 = corners[(i + 1) % 4]
        line = pcbnew.PCB_SHAPE(board)
        line.SetShape(pcbnew.SHAPE_T_SEGMENT)
        line.SetStart(_board_pos(x1, y1))
        line.SetEnd(_board_pos(x2, y2))
        line.SetLayer(layer_id)
        line.SetWidth(_mm(0.05))
        board.Add(line)


def setup_stackup(board: pcbnew.BOARD) -> None:
    """Configure 4-layer stackup."""
    settings = board.GetDesignSettings()
    settings.SetCopperLayerCount(4)
    # Set track/via minimums for JLCPCB
    settings.m_TrackMinWidth = _mm(0.1)
    settings.m_ViasMinSize = _mm(0.6)
    settings.m_ViasMinDrill = _mm(0.3)
    settings.m_MinClearance = _mm(0.1)


def main():
    if not NETLIST_PATH.exists():
        sys.exit(f"Netlist not found: {NETLIST_PATH}\nRun: python -m netlist.gen_golden_netlist")

    print(f"Parsing netlist: {NETLIST_PATH}")
    components, nets = parse_netlist(NETLIST_PATH)
    print(f"  Components: {len(components)}")
    print(f"  Nets: {len(nets)}")

    # Create a new board
    board = pcbnew.BOARD()
    setup_stackup(board)
    create_board_outline(board)
    print("  Created board with 4-layer stackup and outline")

    # Add nets to board
    netinfo = board.GetNetInfo()
    net_codes: dict[str, int] = {}
    for i, net_name in enumerate(nets.keys(), start=1):
        net = pcbnew.NETINFO_ITEM(board, net_name, i)
        board.Add(net)
        net_codes[net_name] = i

    # Build pad-to-net mapping: (ref, pad_name) -> net_code
    pad_nets: dict[tuple[str, str], int] = {}
    for net_name, nodes in nets.items():
        code = net_codes.get(net_name, 0)
        for ref, pin in nodes:
            pad_nets[(ref, pin)] = code

    # Load and add footprints
    loaded = 0
    failed = []

    # Staging grid for placing components
    grid_x = BOARD_W + 30
    grid_y = 0
    col_width = 15.0
    row_height = 12.0
    cols_per_row = 15
    col = 0
    row = 0

    for comp in components:
        fp = load_footprint(comp["fp"])
        if fp is None:
            failed.append((comp["ref"], comp["fp"]))
            continue

        # Set reference and value
        fp.SetReference(comp["ref"])
        fp.Value().SetText(comp["value"])

        # Position in staging grid
        x = grid_x + col * col_width
        y = grid_y + row * row_height
        fp.SetPosition(_board_pos(x, y))

        # Assign nets to pads
        for pad in fp.Pads():
            pad_name = pad.GetName()
            key = (comp["ref"], pad_name)
            if key in pad_nets:
                net_code = pad_nets[key]
                net_name = list(nets.keys())[net_code - 1]
                ni = board.FindNet(net_name)
                if ni:
                    pad.SetNet(ni)

        board.Add(fp)
        loaded += 1

        col += 1
        if col >= cols_per_row:
            col = 0
            row += 1

    print(f"  Loaded {loaded}/{len(components)} footprints")
    if failed:
        print(f"  FAILED to load {len(failed)} footprints:")
        for ref, fp_str in failed:
            print(f"    {ref}: {fp_str}")

    # Save
    pcbnew.SaveBoard(str(BOARD_PATH), board)
    print(f"\nBoard saved → {BOARD_PATH}")
    print(f"  {loaded} components placed in staging grid")
    print(f"\nNext: run prepare_layout_board.py to organize the staging grid")

    return 0 if not failed else 1


if __name__ == "__main__":
    sys.exit(main())
