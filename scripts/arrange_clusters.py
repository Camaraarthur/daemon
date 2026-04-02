#!/usr/bin/env python3
"""Add cluster annotation text to the staging area in daemon_v0.kicad_pcb.

Run after import_netlist.py to add labeled zone markers showing which
components belong to which functional island. Labels appear on Cmts_User
layer at the top of each staging cluster row.

Usage:
  PYTHONPATH=/usr/lib/python3/dist-packages python3 scripts/arrange_clusters.py
"""

from __future__ import annotations
import sys
from pathlib import Path

try:
    import pcbnew
except ImportError:
    sys.exit("pcbnew not found. Run with PYTHONPATH=/usr/lib/python3/dist-packages")

REPO = Path(__file__).resolve().parent.parent
BOARD_PATH = REPO / "daemon_v0.kicad_pcb"

# Cluster definitions: (label, list of ref prefixes or exact refs)
# These match the island layout in the physical PCB plan.
CLUSTERS = [
    ("★ POWER ISLAND — near U1 (IP5328P)",
     ["U1", "L1", "J1", "J2", "BAT1", "TP1", "TP2", "TP3", "TP4"]),
    ("★ 3V3 CLEAN LDO — near U2 (AP2112K)",
     ["U2"]),
    ("★ USB HUB CHAIN — near U3 Hub1, U14 Hub2",
     ["U3", "U14", "Y1", "Y2"]),
    ("★ STINGER PORTS — near J3 Radxa header",
     ["U4", "U5", "U6", "U15", "U22"]),
    ("★ RF ISLAND — near ANT1 (CC1101 915MHz)",
     ["U8", "ANT1"]),
    ("★ ETHERNET — near RJ45 MagJack",
     ["U9", "Y3"]),
    ("★ HEARTBEAT TIMER — near U7 (NE555)",
     ["U7", "Q1"]),
    ("★ AUDIO — near U10 (MAX98357A) + mics",
     ["U10", "U13", "U23"]),
    ("★ DISPLAY + NAV — near J6 screen connector",
     ["J6", "SW1", "SW2", "U21"]),
    ("★ INDUSTRIAL ISO — near WAGO connector",
     ["U11", "J7"]),
    ("★ POWER UX — buttons, LEDs, kill switch",
     ["Q2", "Q3", "SW3"]),
    ("★ GOOBAY BRIDGE — charging input only",
     ["J13"]),
    ("★ RADXA HEADER — J3 40-pin",
     ["J3"]),
    ("★ AUX GPIO HEADER — J4",
     ["J4"]),
]

# Staging area starts at (200, 100) mm as set in import_netlist.py
STAGING_X = 200.0
STAGING_Y = 80.0   # label row above the Tier1 components

def main():
    board = pcbnew.LoadBoard(str(BOARD_PATH))

    # Remove any existing cluster text labels on Cmts_User
    to_remove = []
    for item in board.GetDrawings():
        if hasattr(item, 'GetLayer') and item.GetLayer() == pcbnew.Cmts_User:
            if hasattr(item, 'GetText') and item.GetText().startswith("★"):
                to_remove.append(item)
    for item in to_remove:
        board.Remove(item)
    print(f"  Removed {len(to_remove)} stale cluster labels")

    # Build ref→position map from current footprints
    ref_pos = {}
    for fp in board.GetFootprints():
        ref_pos[fp.GetReference()] = fp.GetPosition()

    # Add cluster label text near the first component of each cluster
    labels_added = 0
    for label, refs in CLUSTERS:
        # Find the first ref in this cluster that is placed
        anchor = None
        for ref in refs:
            if ref in ref_pos:
                anchor = ref_pos[ref]
                break
        if anchor is None:
            print(f"  Skipped (no anchor found): {label}")
            continue

        text = pcbnew.PCB_TEXT(board)
        text.SetText(label)
        text.SetLayer(pcbnew.Cmts_User)
        text.SetTextSize(pcbnew.VECTOR2I(pcbnew.FromMM(2.5), pcbnew.FromMM(2.5)))
        text.SetTextThickness(pcbnew.FromMM(0.3))
        # Place label 8mm above the anchor component
        label_pos = pcbnew.VECTOR2I(anchor.x, anchor.y - pcbnew.FromMM(8))
        text.SetPosition(label_pos)
        board.Add(text)
        labels_added += 1

    print(f"  Added {labels_added} cluster labels on Cmts_User layer")
    pcbnew.SaveBoard(str(BOARD_PATH), board)
    print(f"Board saved → {BOARD_PATH}")
    print("\nOpen KiCad PCB editor → press F (fit) to see all clusters")

if __name__ == "__main__":
    main()
