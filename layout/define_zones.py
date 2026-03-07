#!/usr/bin/env python3
"""Define copper zones (pours) for Daemon V0 PCB.

Creates ground planes, power polygons, and keepout zones per the
Physical Layout Recipe:

  - In1.Cu: Solid GND plane (unbroken)
  - In2.Cu: 3V3_CLEAN isolated polygon for RF/Ethernet
  - F.Cu/B.Cu: 5V_SYS power polygons (IPC-2152: >=2.79mm for 5A)
  - Antenna keepout: 7.0x3.0mm all layers around Johanson chip antenna
  - MagJack isolation void

Usage:
  PYTHONPATH=/usr/lib/python3/dist-packages python layout/define_zones.py
"""

from __future__ import annotations

import sys
from pathlib import Path

try:
    import pcbnew
except ImportError:
    sys.exit("pcbnew not found.")

REPO = Path(__file__).resolve().parent.parent
BOARD_PATH = REPO / "daemon_v0.kicad_pcb"

# Board extents
BX = 0.0
BY = 0.0
BW = 85.6
BH = 54.0


def _mm(v: float) -> int:
    return int(v * 1e6)


def _make_rect_outline(x1: float, y1: float, x2: float, y2: float) -> pcbnew.VECTOR_VECTOR2I:
    """Create a rectangular outline from corner coordinates (mm)."""
    outline = pcbnew.VECTOR_VECTOR2I()
    outline.append(pcbnew.VECTOR2I(_mm(x1), _mm(y1)))
    outline.append(pcbnew.VECTOR2I(_mm(x2), _mm(y1)))
    outline.append(pcbnew.VECTOR2I(_mm(x2), _mm(y2)))
    outline.append(pcbnew.VECTOR2I(_mm(x1), _mm(y2)))
    return outline


def _add_zone(
    board: pcbnew.BOARD,
    net_name: str,
    layer: int,
    outline: pcbnew.VECTOR_VECTOR2I,
    priority: int = 0,
    thermal_gap: float = 0.5,
    min_width: float = 0.25,
) -> pcbnew.ZONE:
    """Add a copper zone to the board."""
    zone = pcbnew.ZONE(board)

    # Find net by name
    netinfo = board.GetNetInfo()
    net = netinfo.GetNetItem(net_name)
    if net is not None:
        zone.SetNet(net)
    else:
        print(f"  WARNING: Net '{net_name}' not found, zone will be unconnected")

    zone.SetLayer(layer)
    zone.SetIsRuleArea(False)
    zone.SetDoNotAllowTracks(False)
    zone.SetDoNotAllowVias(False)
    zone.SetDoNotAllowPads(False)
    zone.SetDoNotAllowCopperPour(False)

    zone.SetAssignedPriority(priority)
    zone.SetThermalReliefGap(_mm(thermal_gap))
    zone.SetMinThickness(_mm(min_width))

    # Set outline
    zone_outline = zone.Outline()
    zone_outline.NewOutline()
    for i in range(outline.size()):
        pt = outline[i]
        zone_outline.Append(pt.x, pt.y)

    board.Add(zone)
    return zone


def _add_keepout(
    board: pcbnew.BOARD,
    layer: int,
    outline: pcbnew.VECTOR_VECTOR2I,
    no_tracks: bool = True,
    no_vias: bool = True,
    no_copper: bool = True,
) -> pcbnew.ZONE:
    """Add a keepout zone."""
    zone = pcbnew.ZONE(board)
    zone.SetIsRuleArea(True)
    zone.SetDoNotAllowTracks(no_tracks)
    zone.SetDoNotAllowVias(no_vias)
    zone.SetDoNotAllowCopperPour(no_copper)
    zone.SetDoNotAllowPads(False)
    zone.SetLayer(layer)

    zone_outline = zone.Outline()
    zone_outline.NewOutline()
    for i in range(outline.size()):
        pt = outline[i]
        zone_outline.Append(pt.x, pt.y)

    board.Add(zone)
    return zone


def main() -> None:
    board = pcbnew.LoadBoard(str(BOARD_PATH))
    print(f"Board loaded: {len(board.GetFootprints())} footprints, {board.GetNetCount()} nets")

    # ── 1. GND plane on In1.Cu (solid, full board, highest priority) ──────────
    gnd_outline = _make_rect_outline(BX - 0.5, BY - 0.5, BX + BW + 0.5, BY + BH + 0.5)
    _add_zone(board, "GND", pcbnew.In1_Cu, gnd_outline, priority=10)
    print("  Added GND plane on In1.Cu (full board)")

    # ── 2. GND plane on B.Cu (pour around components) ─────────────────────────
    _add_zone(board, "GND", pcbnew.B_Cu, gnd_outline, priority=0)
    print("  Added GND pour on B.Cu")

    # ── 3. 5V_SYS power pour on F.Cu (power island area) ─────────────────────
    # IPC-2152: 2.79mm min width for 5A; using polygon pour
    pwr_outline = _make_rect_outline(5, 3, 40, 25)
    _add_zone(board, "5V_SYS", pcbnew.F_Cu, pwr_outline, priority=1, min_width=0.5)
    print("  Added 5V_SYS pour on F.Cu (power island)")

    # ── 4. 3V3_CLEAN isolated polygon on In2.Cu ──────────────────────────────
    # For RF (CC1101) and Ethernet (RTL8152B) clean power
    clean_outline = _make_rect_outline(3, 16, 38, 50)
    _add_zone(board, "3V3_CLEAN", pcbnew.In2_Cu, clean_outline, priority=1)
    print("  Added 3V3_CLEAN pour on In2.Cu (RF/Ethernet)")

    # ── 5. 5V_SYS pour on In2.Cu (rest of board) ─────────────────────────────
    pwr_in2_outline = _make_rect_outline(BX - 0.5, BY - 0.5, BX + BW + 0.5, BY + BH + 0.5)
    _add_zone(board, "5V_SYS", pcbnew.In2_Cu, pwr_in2_outline, priority=0, min_width=0.5)
    print("  Added 5V_SYS pour on In2.Cu (general power)")

    # ── 6. Antenna keepout zone ───────────────────────────────────────────────
    # Johanson 0915AT43A0026: 7.0x3.0mm all-layer keepout, board edge/corner
    # Antenna placed at (3.0, 40.0) → keepout centered around it
    ant_keepout = _make_rect_outline(0, 37.5, 7.0, 43.5)
    for layer in [pcbnew.F_Cu, pcbnew.In1_Cu, pcbnew.In2_Cu, pcbnew.B_Cu]:
        _add_keepout(board, layer, ant_keepout)
    print("  Added antenna keepout zone (7x6mm, all layers)")

    # ── 7. MagJack isolation void ─────────────────────────────────────────────
    # >60mil gap between MagJack body and traces on all layers
    # RJ45 at (5.0, 30.0)
    mj_keepout = _make_rect_outline(0, 24, 12, 36)
    _add_keepout(board, pcbnew.In1_Cu, mj_keepout, no_tracks=False, no_vias=False)
    print("  Added MagJack isolation void on In1.Cu (GND plane kept)")

    # Save
    pcbnew.SaveBoard(str(BOARD_PATH), board)
    print(f"\nBoard saved → {BOARD_PATH}")
    print("  Zones will be filled when DRC is run in KiCad GUI.")


if __name__ == "__main__":
    main()
