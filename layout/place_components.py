#!/usr/bin/env python3
"""Automated PCB component placement for Daemon V0.

Places all 164 components into island zones on the 85.6×54mm credit-card
board using the pcbnew Python API. The placement strategy follows the
Physical Layout Recipe:

  1. Anchor components (connectors, ICs) at fixed positions
  2. Bypass/decoupling caps placed adjacent to their parent IC
  3. Island-based grouping with >15mm Power-RF separation

Board coordinate system:
  Origin (0, 0) = top-left corner of board outline
  X increases rightward, Y increases downward
  Board: 85.6mm × 54.0mm

Usage:
  PYTHONPATH=/usr/lib/python3/dist-packages python layout/place_components.py
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
        "  PYTHONPATH=/usr/lib/python3/dist-packages python layout/place_components.py"
    )

REPO = Path(__file__).resolve().parent.parent
BOARD_PATH = REPO / "daemon_v0.kicad_pcb"

# Board dimensions (mm)
BOARD_W = 85.6
BOARD_H = 54.0

# ── Anchor positions (mm from board top-left) ─────────────────────────────────
# These define the fixed positions for key components that drive the layout.
# All other components are placed relative to their associated anchor IC.

ANCHORS = {
    # === CONNECTORS (board edges) ===
    # Radxa 40-pin header: centered on board, provides mechanical alignment
    "J12": (42.8, 27.0, 0),      # Conn_02x20 — Radxa header, centered

    # USB-C bridge (Goobay 74446): top edge, near Radxa USB-C port
    "J8": (42.8, 6.0, 0),        # Goobay-74446 USB-C receptacle

    # USB-A Stinger ports: right edge of board
    "J2": (80.0, 12.0, 90),      # USB-A male (port 1) — top-right
    "J3": (80.0, 27.0, 90),      # USB-A female (port 2) — mid-right
    "J4": (80.0, 42.0, 90),      # USB-A female (port 3) — bottom-right

    # RJ45 MagJack: left edge, away from USB-C (>15mm)
    "J9": (5.0, 30.0, 270),      # HR911105A RJ45 horizontal

    # WAGO terminal block: bottom-left corner
    "J10": (15.0, 50.0, 0),      # WAGO-2060-404, bottom edge

    # TRRS audio jack: bottom edge
    "J13": (55.0, 51.0, 0),      # 3.5mm TRRS

    # Screen connector: top edge
    "J5": (65.0, 3.0, 0),        # 1x08 screen header

    # Joystick connector: left edge
    "J6": (3.0, 15.0, 270),      # 1x05 joystick header

    # Battery connector: top-left
    "J1": (10.0, 3.0, 0),        # Conn_01x02 battery JST

    # Auxiliary header
    "J11": (3.0, 45.0, 270),     # 1x04 aux GPIO header

    # Speaker connector
    "J14": (45.0, 51.0, 0),      # JST SH 2-pin speaker

    # Power management header
    "J7": (25.0, 51.0, 0),       # 1x03 power header

    # === POWER ISLAND (top-left quadrant) ===
    "U1": (20.0, 15.0, 0),       # IP5328P PMIC
    "L1": (14.0, 12.0, 0),       # 4.7µH boost inductor

    # === CLEAN 3.3V LDO ===
    "U2": (20.0, 32.0, 0),       # AP2112K-3.3

    # === 555 TIMER (power island area) ===
    "U3": (30.0, 10.0, 0),       # NE555P heartbeat

    # === USB HUB (center) ===
    "U4": (50.0, 18.0, 0),       # SL2.1A USB hub

    # === STINGER SWITCHES (near USB-A ports) ===
    "U5": (72.0, 12.0, 0),       # SY6280 port 1
    "U6": (72.0, 27.0, 0),       # SY6280 port 2
    "U7": (72.0, 42.0, 0),       # SY6280 port 3

    # === JOYSTICK ADC ===
    "U8": (10.0, 18.0, 0),       # ADS1015

    # === RF ISLAND (bottom-left, >15mm from power) ===
    "U9": (25.0, 40.0, 0),       # CC1101 RF transceiver
    "AE1": (3.0, 40.0, 0),       # Johanson chip antenna — board edge

    # === ETHERNET (left side, near RJ45) ===
    "U10": (15.0, 25.0, 0),      # RTL8152B

    # === INDUSTRIAL ISOLATION (near WAGO) ===
    "U11": (15.0, 44.0, 0),      # ISO1212

    # === AUDIO ISLAND (bottom-center) ===
    "U12": (50.0, 44.0, 0),      # MAX98357A amplifier
    "U13": (58.0, 44.0, 0),      # INMP441 MEMS mic

    # === Power UX ===
    "SW1": (35.0, 51.0, 0),      # SW_PWR tactile button

    # === CRYSTALS ===
    "Y1": (55.0, 22.0, 0),       # 12MHz USB hub crystal
    "Y2": (22.0, 38.0, 0),       # 26MHz CC1101 crystal (>10mm from Y3)
    "Y3": (10.0, 22.0, 0),       # 25MHz RTL8152B crystal

    # === DFT TEST POINTS ===
    "TP1": (12.0, 8.0, 0),       # VIN
    "TP2": (18.0, 8.0, 0),       # BAT
    "TP3": (24.0, 8.0, 0),       # SW
    "TP4": (30.0, 8.0, 0),       # VOUT
}

# ── Island zones ──────────────────────────────────────────────────────────────
# Each zone maps an IC reference to a bounding box (x_min, y_min, x_max, y_max)
# Passives connected to that IC will be placed within this zone.

ISLANDS = {
    # Power island (IP5328P and related)
    "U1":  (8, 5, 35, 22),       # IP5328P
    "U3":  (28, 5, 38, 18),      # NE555P heartbeat area
    # USB hub
    "U4":  (42, 12, 62, 26),     # SL2.1A
    # Stinger ports
    "U5":  (66, 6, 80, 18),      # SY6280 port 1
    "U6":  (66, 21, 80, 33),     # SY6280 port 2
    "U7":  (66, 36, 80, 48),     # SY6280 port 3
    # RF island
    "U9":  (18, 34, 35, 48),     # CC1101
    # Ethernet
    "U10": (5, 18, 22, 35),      # RTL8152B
    # Audio
    "U12": (42, 38, 62, 52),     # MAX98357A
    "U13": (55, 38, 65, 48),     # INMP441
    # ISO
    "U11": (8, 38, 22, 52),      # ISO1212
    # Clean LDO
    "U2":  (15, 28, 28, 36),     # AP2112K-3.3
    # Joystick ADC
    "U8":  (3, 12, 18, 24),      # ADS1015
}


def _mm_to_nm(mm: float) -> int:
    return int(mm * 1e6)


def _place(fp: pcbnew.FOOTPRINT, x_mm: float, y_mm: float, angle_deg: float = 0) -> None:
    """Place a footprint at the given position (mm from board origin)."""
    fp.SetPosition(pcbnew.VECTOR2I(_mm_to_nm(x_mm), _mm_to_nm(y_mm)))
    if angle_deg != 0:
        fp.SetOrientationDegrees(angle_deg)


def _get_ref_to_fp(board: pcbnew.BOARD) -> dict[str, pcbnew.FOOTPRINT]:
    """Build ref → footprint mapping."""
    return {fp.GetReference(): fp for fp in board.GetFootprints()}


def _parse_netlist_connectivity() -> dict[str, list[str]]:
    """Parse both source netlists for net-to-ref connectivity.

    Reads daemon_v0_full_system.net and daemon_v0_audio.net (with ref remapping)
    to build: ref → list of refs sharing non-GND nets.
    """
    # Audio ref remapping (from merge_netlists.py output)
    audio_remap = {
        "C1": "C56", "C2": "C57", "C3": "C58", "C4": "C59",
        "C5": "C60", "C6": "C61", "C7": "C62",
        "D1": "D10", "D2": "D11",
        "FB1": "FB1", "FB2": "FB2",
        "J1": "J13", "J2": "J14",
        "R1": "R42", "R2": "R43", "R3": "R44",
        "U1": "U12", "U2": "U13",
    }

    net_to_refs: dict[str, set[str]] = {}

    def _extract_nets(text: str, remap: dict[str, str] | None = None) -> None:
        """Extract net→refs from a SKiDL netlist with multiline node entries."""
        # Find the (nets ...) section
        nets_start = text.find("(nets")
        if nets_start < 0:
            return
        nets_text = text[nets_start:]

        # Split into individual net blocks
        net_pattern = re.compile(r'\(net\s*\n\s*\(code\s+\d+\)\s*\n\s*\(name\s+"([^"]+)"\)')
        for m in net_pattern.finditer(nets_text):
            net_name = m.group(1)
            # Find end of this net block by paren matching
            depth = 0
            block_start = m.start()
            block_end = block_start
            for i, ch in enumerate(nets_text[block_start:block_start + 5000]):
                if ch == '(':
                    depth += 1
                elif ch == ')':
                    depth -= 1
                    if depth == 0:
                        block_end = block_start + i
                        break
            block = nets_text[block_start:block_end]
            refs_in_net = set()
            for ref_m in re.finditer(r'\(ref\s+"([^"]+)"\)', block):
                ref = ref_m.group(1)
                if remap:
                    ref = remap.get(ref, ref)
                refs_in_net.add(ref)
            if refs_in_net:
                if net_name in net_to_refs:
                    net_to_refs[net_name].update(refs_in_net)
                else:
                    net_to_refs[net_name] = refs_in_net

    # Parse both source netlists
    full_path = REPO / "daemon_v0_full_system.net"
    audio_path = REPO / "daemon_v0_audio.net"

    if full_path.exists():
        _extract_nets(full_path.read_text(encoding="utf-8"))
    if audio_path.exists():
        _extract_nets(audio_path.read_text(encoding="utf-8"), remap=audio_remap)

    # Build connectivity: ref → connected refs (excluding GND only)
    ignore_nets = {"GND"}
    all_refs: set[str] = set()
    for refs in net_to_refs.values():
        all_refs.update(refs)

    connections: dict[str, list[str]] = {ref: [] for ref in all_refs}
    for net_name, refs in net_to_refs.items():
        if net_name in ignore_nets:
            continue
        for ref in refs:
            for other_ref in refs:
                if other_ref != ref and other_ref not in connections[ref]:
                    connections[ref].append(other_ref)

    for ref in connections:
        connections[ref].sort()

    return connections


# Manual island overrides for components not in the main netlist (audio subsystem)
# or with ambiguous connectivity
MANUAL_ISLANDS = {
    # Audio subsystem (remapped refs from merge)
    "U12": "U12",   # MAX98357A is its own island anchor
    "U13": "U12",   # INMP441 → audio island
    "C56": "U12", "C57": "U12", "C58": "U12", "C59": "U12",  # audio caps
    "C60": "U12", "C61": "U12", "C62": "U12",
    "D10": "U12", "D11": "U12",  # audio TVS
    "FB1": "U12", "FB2": "U12",  # audio ferrite beads
    "J13": "U12",   # TRRS jack → audio island
    "J14": "U12",   # Speaker connector → audio island
    "R42": "U12", "R43": "U12", "R44": "U12",  # audio resistors
    # WS2812B LEDs - spread along bottom edge
    "D3": "U1", "D4": "U1", "D5": "U1", "D6": "U1",
    # MOSFETs and power UX
    "Q1": "U1", "Q2": "U1", "Q3": "U1", "Q4": "U1",
    "SW1": "U1",
    # Isolation jumpers
    "J1": "U1",
    # NTC thermistor
    "TH1": "U1",
    # Schottky diodes (power path)
    "D1": "U1", "D2": "U1",
}


def _find_island_for_ref(ref: str, connections: dict[str, list[str]]) -> str | None:
    """Find which island IC a component belongs to based on net connectivity."""
    # Check manual overrides first
    if ref in MANUAL_ISLANDS:
        return MANUAL_ISLANDS[ref]

    # Direct connection to an island IC
    for ic_ref in ISLANDS:
        if ic_ref in connections.get(ref, []):
            return ic_ref

    # Second-degree: connected to something connected to an island IC
    for connected_ref in connections.get(ref, []):
        for ic_ref in ISLANDS:
            if ic_ref in connections.get(connected_ref, []):
                return ic_ref

    return None


def _place_in_island(
    fp: pcbnew.FOOTPRINT,
    island_ref: str,
    occupied: list[tuple[float, float]],
    ref_fps: dict[str, pcbnew.FOOTPRINT],
) -> tuple[float, float]:
    """Place a passive component within its island zone, near the IC."""
    x_min, y_min, x_max, y_max = ISLANDS[island_ref]
    ic_fp = ref_fps.get(island_ref)
    if ic_fp:
        cx = pcbnew.ToMM(ic_fp.GetPosition().x)
        cy = pcbnew.ToMM(ic_fp.GetPosition().y)
    else:
        cx = (x_min + x_max) / 2
        cy = (y_min + y_max) / 2

    # Try placing in a spiral pattern around the IC
    step = 2.5  # mm grid spacing for passives
    for radius in range(1, 20):
        for dx in range(-radius, radius + 1):
            for dy in range(-radius, radius + 1):
                if abs(dx) != radius and abs(dy) != radius:
                    continue  # only edges of each ring
                x = cx + dx * step
                y = cy + dy * step
                if x_min <= x <= x_max and y_min <= y <= y_max:
                    # Check if position is not too close to existing
                    too_close = False
                    for ox, oy in occupied:
                        if abs(x - ox) < 1.5 and abs(y - oy) < 1.5:
                            too_close = True
                            break
                    if not too_close:
                        _place(fp, x, y)
                        return (x, y)

    # Fallback: just place in center of zone
    _place(fp, (x_min + x_max) / 2, (y_min + y_max) / 2)
    return ((x_min + x_max) / 2, (y_min + y_max) / 2)


def main() -> None:
    if not BOARD_PATH.exists():
        sys.exit(f"Board not found: {BOARD_PATH}")

    board = pcbnew.LoadBoard(str(BOARD_PATH))
    ref_fps = _get_ref_to_fp(board)

    print(f"Board loaded: {len(ref_fps)} footprints")

    # Phase 1: Place anchor components
    anchored = 0
    for ref, (x, y, angle) in ANCHORS.items():
        if ref in ref_fps:
            _place(ref_fps[ref], x, y, angle)
            anchored += 1
        else:
            print(f"  WARNING: Anchor {ref} not found on board")

    print(f"  Anchored: {anchored} components")

    # Phase 2: Place remaining components in island zones
    connections = _parse_netlist_connectivity()
    placed_refs = set(ANCHORS.keys())
    occupied: dict[str, list[tuple[float, float]]] = {
        ic: [] for ic in ISLANDS
    }

    # Record anchor positions as occupied
    for ref, (x, y, _) in ANCHORS.items():
        for ic_ref in ISLANDS:
            x_min, y_min, x_max, y_max = ISLANDS[ic_ref]
            if x_min <= x <= x_max and y_min <= y <= y_max:
                occupied[ic_ref].append((x, y))

    island_placed = 0
    orphans = []

    for ref, fp in sorted(ref_fps.items()):
        if ref in placed_refs:
            continue

        island = _find_island_for_ref(ref, connections)
        if island:
            pos = _place_in_island(fp, island, occupied[island], ref_fps)
            occupied[island].append(pos)
            placed_refs.add(ref)
            island_placed += 1
        else:
            orphans.append(ref)

    print(f"  Island-placed: {island_placed} components")

    # Phase 3: Place orphan components in remaining board space
    orphan_x = 40.0
    orphan_y = 4.0
    orphan_step = 3.0
    orphan_cols = 8
    for i, ref in enumerate(orphans):
        if ref in ref_fps:
            fp = ref_fps[ref]
            x = orphan_x + (i % orphan_cols) * orphan_step
            y = orphan_y + (i // orphan_cols) * orphan_step
            _place(fp, x, y)
            placed_refs.add(ref)

    print(f"  Orphans placed: {len(orphans)} ({', '.join(orphans[:10])}{'...' if len(orphans) > 10 else ''})")

    # Save
    pcbnew.SaveBoard(str(BOARD_PATH), board)
    print(f"\nBoard saved → {BOARD_PATH}")
    print(f"  Total placed: {len(placed_refs)}/{len(ref_fps)}")
    print(f"\nNext: Open in KiCad to review placement, then run zone/routing automation.")


if __name__ == "__main__":
    main()
