#!/usr/bin/env python3
"""Prepare a layout-ready KiCad PCB for manual component placement.

Creates a board where:
  - Radxa Zero 3W outline + connectors drawn on User.Drawings layer
  - Mounting holes placed at correct positions
  - Category A+B components (placement matters) laid out in a clean grid
    on the RIGHT side of the board, grouped by subsystem, well-labeled
  - Category C components (passives) hidden but present on the board
  - Board outline drawn with clear dimensions

The user can then drag components from the grid onto the board.

Usage:
  PYTHONPATH=/usr/lib/python3/dist-packages python scripts/prepare_layout_board.py
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

try:
    import pcbnew
except ImportError:
    sys.exit("pcbnew not found. Run with PYTHONPATH=/usr/lib/python3/dist-packages")

REPO = Path(__file__).resolve().parent.parent
BOARD_PATH = REPO / "daemon_v0.kicad_pcb"

# Board dimensions
BOARD_W = 85.6
BOARD_H = 54.0

# KiCad page origin offset (where our board outline starts)
ORIGIN_X = 100.0
ORIGIN_Y = 100.0

# Radxa alignment (centered under Daemon board)
# Radxa origin relative to Daemon origin
RADXA_X_OFF = 10.3
RADXA_Y_OFF = 12.0
RADXA_W = 65.0
RADXA_H = 30.0

# Radxa mounting holes (Daemon board coordinates)
MOUNTING_HOLES = [
    (13.8, 15.6),
    (13.9, 38.5),
    (71.7, 15.6),
    (71.7, 38.5),
]

# ── Component categories ──────────────────────────────────────────────────────

# Category A+B: components the user needs to place manually
# Grouped by subsystem for the staging grid
# Format: (group_name, [(ref, label), ...])
PLACEMENT_GROUPS = [
    ("⚡ POWER", [
        ("U1",  "IP5328P\nPMIC"),
        ("L1",  "4.7µH\nBOOST IND"),
        ("U2",  "AP2112K\n3.3V LDO"),
        ("D1",  "SS14\nDIODE A"),
        ("D2",  "SS14\nDIODE B"),
        ("C7",  "100µF TANT\nPOWER TANK"),
        ("C12", "100µF ELEC\nTIMER"),
        ("TH1", "NTC 10K\n(near U1!)"),
    ]),
    ("🔌 CONNECTORS", [
        ("J12", "RADXA\n40-PIN HDR"),
        ("J8",  "USB-C\nGOOBAY"),
        ("J2",  "USB-A ①\nMALE"),
        ("J3",  "USB-A ②"),
        ("J4",  "USB-A ③"),
        ("J9",  "RJ45\nMAGJACK"),
        ("J10", "WAGO\n24V I/O"),
        ("J13", "TRRS\nAUDIO"),
        ("J14", "SPEAKER\nJST"),
        ("J1",  "BATTERY\nJST"),
        ("J5",  "SCREEN\n8-PIN"),
        ("J6",  "JOYSTICK\n5-PIN"),
        ("J7",  "PWR HDR"),
        ("J11", "AUX GPIO"),
    ]),
    ("📡 RF (keep away from power!)", [
        ("U9",  "CC1101\nRF XCVR"),
        ("AE1", "ANTENNA\n915MHz"),
        ("Y2",  "26MHz XTAL\n(near U9)"),
    ]),
    ("🔀 USB HUB", [
        ("U4",  "SL2.1A\nUSB HUB"),
        ("Y1",  "12MHz XTAL\n(near U4)"),
    ]),
    ("🔌 STINGER SWITCHES", [
        ("U5",  "SY6280 ①\n(near J2)"),
        ("U6",  "SY6280 ②\n(near J3)"),
        ("U7",  "SY6280 ③\n(near J4)"),
    ]),
    ("🌐 ETHERNET", [
        ("U10", "RTL8152B\nETH PHY"),
        ("Y3",  "25MHz XTAL\n(near U10)"),
    ]),
    ("🔊 AUDIO", [
        ("U12", "MAX98357A\nAMP"),
        ("U13", "INMP441\nMEMS MIC"),
    ]),
    ("⚙️ INDUSTRIAL ISO", [
        ("U11", "ISO1212"),
        ("D8",  "TVS ①\nVCAN26A2"),
        ("D9",  "TVS ②\nVCAN26A2"),
        ("F1",  "PTC FUSE ①"),
        ("F2",  "PTC FUSE ②"),
    ]),
    ("💡 LEDs + IR", [
        ("D3",  "WS2812B ①"),
        ("D4",  "WS2812B ②"),
        ("D5",  "WS2812B ③"),
        ("D6",  "WS2812B ④"),
        ("D7",  "IR LED\nVSMB294008"),
    ]),
    ("🎮 CONTROL", [
        ("U8",  "ADS1015\nJOY ADC"),
        ("U3",  "NE555\nHEARTBEAT"),
        ("SW1", "POWER\nBUTTON"),
    ]),
    ("🔧 TRANSISTORS", [
        ("Q1",  "BC857\nPNP"),
        ("Q2",  "BSS84\nPMOS"),
        ("Q3",  "2N7002\nNMOS"),
        ("Q4",  "AO3400A\nIR DRIVE"),
    ]),
    ("📍 TEST POINTS", [
        ("TP1", "TP VIN"),
        ("TP2", "TP BAT"),
        ("TP3", "TP SW"),
        ("TP4", "TP VOUT"),
    ]),
]

# All refs in Category A+B (these get shown)
VISIBLE_REFS = set()
for _, items in PLACEMENT_GROUPS:
    for ref, _ in items:
        VISIBLE_REFS.add(ref)


def _mm(mm: float) -> int:
    """Convert mm to KiCad internal units (nm)."""
    return int(mm * 1e6)


def _board_pos(x_mm: float, y_mm: float) -> pcbnew.VECTOR2I:
    """Convert board-relative coords to KiCad page coords."""
    return pcbnew.VECTOR2I(_mm(ORIGIN_X + x_mm), _mm(ORIGIN_Y + y_mm))


def _draw_line(board, x1, y1, x2, y2, layer, width=0.15):
    """Draw a line on the board."""
    line = pcbnew.PCB_SHAPE(board)
    line.SetShape(pcbnew.SHAPE_T_SEGMENT)
    line.SetStart(_board_pos(x1, y1))
    line.SetEnd(_board_pos(x2, y2))
    line.SetLayer(board.GetLayerID(layer))
    line.SetWidth(_mm(width))
    board.Add(line)


def _draw_rect(board, x, y, w, h, layer, width=0.15):
    """Draw a rectangle on the board."""
    _draw_line(board, x, y, x + w, y, layer, width)
    _draw_line(board, x + w, y, x + w, y + h, layer, width)
    _draw_line(board, x + w, y + h, x, y + h, layer, width)
    _draw_line(board, x, y + h, x, y, layer, width)


def _draw_circle(board, cx, cy, radius, layer, width=0.15):
    """Draw a circle on the board."""
    circle = pcbnew.PCB_SHAPE(board)
    circle.SetShape(pcbnew.SHAPE_T_CIRCLE)
    circle.SetCenter(_board_pos(cx, cy))
    circle.SetEnd(_board_pos(cx + radius, cy))
    circle.SetLayer(board.GetLayerID(layer))
    circle.SetWidth(_mm(width))
    board.Add(circle)


def _add_text(board, x, y, text, layer, size=1.5, thickness=0.15):
    """Add text annotation on the board."""
    txt = pcbnew.PCB_TEXT(board)
    txt.SetText(text)
    txt.SetPosition(_board_pos(x, y))
    txt.SetLayer(board.GetLayerID(layer))
    txt.SetTextSize(pcbnew.VECTOR2I(_mm(size), _mm(size)))
    txt.SetTextThickness(_mm(thickness))
    board.Add(txt)


def draw_radxa_reference(board):
    """Draw the Radxa Zero 3W outline and key features on User.Drawings."""
    layer = "User.Drawings"
    rx, ry = RADXA_X_OFF, RADXA_Y_OFF

    # Radxa board outline (dashed via multiple short segments)
    _draw_rect(board, rx, ry, RADXA_W, RADXA_H, layer, 0.25)

    # Label
    _add_text(board, rx + RADXA_W / 2, ry + RADXA_H / 2,
              "RADXA ZERO 3W\n(underneath)", layer, 2.0, 0.2)

    # 40-pin GPIO header zone
    gpio_x1 = rx + 8.32  # Pin 1 X on Radxa
    gpio_x2 = rx + 56.58  # Pin 40 X on Radxa
    gpio_y1 = rx + 25.41 - RADXA_X_OFF + RADXA_Y_OFF  # pin row 1
    gpio_y2 = rx + 27.95 - RADXA_X_OFF + RADXA_Y_OFF  # pin row 2
    # Actually use Radxa coords properly
    gpio_y1 = ry + 25.41
    gpio_y2 = ry + 27.95
    _draw_rect(board, gpio_x1 - 1, gpio_y1 - 1,
               (gpio_x2 - gpio_x1) + 2, (gpio_y2 - gpio_y1) + 2,
               layer, 0.2)
    _add_text(board, (gpio_x1 + gpio_x2) / 2, gpio_y1 - 2.5,
              "40-PIN GPIO HEADER", layer, 1.2, 0.15)
    # Pin 1 marker
    _add_text(board, gpio_x1 - 1.5, gpio_y1, "1", layer, 1.0, 0.15)
    _add_text(board, gpio_x2 + 1.5, gpio_y2, "40", layer, 1.0, 0.15)

    # USB-C OTG (bottom edge of Radxa, left side)
    usbc_otg_x = rx + 12.4
    _draw_rect(board, usbc_otg_x - 4.5, ry - 1, 9.0, 4.0, layer, 0.2)
    _add_text(board, usbc_otg_x, ry + 4.5, "USB-C\nOTG/PWR", layer, 0.8, 0.1)

    # USB-C Host (bottom edge, right side)
    usbc_host_x = rx + 51.9
    _draw_rect(board, usbc_host_x - 4.5, ry - 1, 9.0, 4.0, layer, 0.2)
    _add_text(board, usbc_host_x, ry + 4.5, "USB-C\nHOST", layer, 0.8, 0.1)

    # Micro HDMI (bottom edge, center)
    hdmi_x = rx + 31.3
    _draw_rect(board, hdmi_x - 3.5, ry - 1, 7.0, 3.5, layer, 0.2)
    _add_text(board, hdmi_x, ry + 4.0, "µHDMI", layer, 0.8, 0.1)

    # MicroSD slot (left edge)
    _draw_rect(board, rx - 3, ry + 12, 6, 6, layer, 0.2)
    _add_text(board, rx + 0.5, ry + 15, "SD", layer, 0.8, 0.1)

    # WiFi antenna connector
    _draw_circle(board, rx + 63.5, ry + 19.7, 1.5, layer, 0.2)
    _add_text(board, rx + 63.5, ry + 17.5, "WiFi\nU.FL", layer, 0.7, 0.1)

    # Mounting holes
    for mx, my in MOUNTING_HOLES:
        _draw_circle(board, mx, my, 2.75, layer, 0.2)
        _add_text(board, mx, my - 3.5, "M2.5", layer, 0.7, 0.1)

    # Keep-out zone label
    _add_text(board, rx + RADXA_W / 2, ry - 3,
              "⚠ NO TALL PARTS ON B.Cu IN THIS ZONE", layer, 1.0, 0.15)


def draw_board_dimensions(board):
    """Add dimension annotations to the board."""
    layer = "User.Comments"
    # Width dimension (top)
    _add_text(board, BOARD_W / 2, -4, f"← {BOARD_W} mm →", layer, 1.5, 0.15)
    # Height dimension (right)
    _add_text(board, BOARD_W + 5, BOARD_H / 2, f"{BOARD_H} mm", layer, 1.5, 0.15)


def draw_separation_zones(board):
    """Draw key separation distance reminders on User.Eco1."""
    layer = "User.Eco1"
    # These are reminders, not actual placement
    _add_text(board, BOARD_W / 2, BOARD_H + 4,
              "RULES: Power↔RF ≥20mm | Inductor↔RF ≥25mm | XTAL_26↔XTAL_25 ≥10mm",
              layer, 1.0, 0.12)
    _add_text(board, BOARD_W / 2, BOARD_H + 7,
              "Inductor↔XTALs ≥15mm | Antenna keepout 5mm | MagJack↔USB-C ≥15mm",
              layer, 1.0, 0.12)


def place_staging_grid(board, ref_fps):
    """Place Category A+B components in a clean grid to the right of the board."""
    # Grid starts to the right of the board
    grid_x_start = BOARD_W + 25  # 25mm gap from board edge
    grid_y_start = -5
    col_width = 20.0
    row_height = 18.0
    items_per_col = 5
    group_gap = 6.0  # extra gap between groups

    current_y = grid_y_start
    current_col = 0
    items_in_col = 0

    for group_name, items in PLACEMENT_GROUPS:
        # Start new column if current one has items
        if items_in_col > 0:
            current_col += 1
            items_in_col = 0
            current_y = grid_y_start

        grid_x = grid_x_start + current_col * col_width

        # Group header
        _add_text(board, grid_x, current_y - 3, group_name,
                  "User.Comments", 1.2, 0.15)

        for ref, label in items:
            if ref not in ref_fps:
                print(f"  WARNING: {ref} not on board")
                continue

            fp = ref_fps[ref]

            # Place at grid position
            fp.SetPosition(_board_pos(grid_x, current_y))
            fp.SetOrientationDegrees(0)

            # Set nice label
            val_field = fp.Value()
            val_field.SetText(label)
            val_field.SetVisible(True)
            val_field.SetTextSize(pcbnew.VECTOR2I(_mm(0.8), _mm(0.8)))
            val_field.SetTextThickness(_mm(0.12))

            # Show ref too, smaller, above
            ref_field = fp.Reference()
            ref_field.SetVisible(True)
            ref_field.SetTextSize(pcbnew.VECTOR2I(_mm(0.7), _mm(0.7)))
            ref_field.SetTextThickness(_mm(0.1))

            current_y += row_height
            items_in_col += 1

            if items_in_col >= items_per_col:
                current_col += 1
                items_in_col = 0
                current_y = grid_y_start


def hide_secondary_components(board, ref_fps):
    """Hide Category C components — place them in a tight grid below the board."""
    secondary = []
    for ref, fp in sorted(ref_fps.items()):
        if ref not in VISIBLE_REFS:
            secondary.append((ref, fp))

    # Place in a dense grid below the board outline
    grid_x_start = 0.0
    grid_y_start = BOARD_H + 15
    col_width = 5.0
    row_height = 5.0
    cols = 20

    for i, (ref, fp) in enumerate(secondary):
        col = i % cols
        row = i // cols
        x = grid_x_start + col * col_width
        y = grid_y_start + row * row_height
        fp.SetPosition(_board_pos(x, y))
        fp.SetOrientationDegrees(0)

        # Hide text
        fp.Reference().SetVisible(False)
        fp.Value().SetVisible(False)

    # Add a label
    _add_text(board, grid_x_start + (cols * col_width) / 2, grid_y_start - 3,
              f"SECONDARY COMPONENTS ({len(secondary)} passives) — don't touch, they follow their parent IC",
              "User.Comments", 1.2, 0.15)

    return len(secondary)


def main():
    if not BOARD_PATH.exists():
        sys.exit(f"Board not found: {BOARD_PATH}")

    board = pcbnew.LoadBoard(str(BOARD_PATH))
    ref_fps = {fp.GetReference(): fp for fp in board.GetFootprints()}
    print(f"Board loaded: {len(ref_fps)} footprints")

    # 1. Draw Radxa reference
    draw_radxa_reference(board)
    print("  Drew Radxa Zero 3W reference outline (User.Drawings layer)")

    # 2. Draw board dimensions and rules
    draw_board_dimensions(board)
    draw_separation_zones(board)
    print("  Added dimension annotations and separation rules")

    # 3. Place Category A+B in staging grid
    place_staging_grid(board, ref_fps)
    visible_count = sum(1 for _, items in PLACEMENT_GROUPS for ref, _ in items if ref in ref_fps)
    print(f"  Staged {visible_count} key components in labeled grid (right of board)")

    # 4. Hide Category C
    hidden = hide_secondary_components(board, ref_fps)
    print(f"  Hidden {hidden} secondary components (below board)")

    # Save
    pcbnew.SaveBoard(str(BOARD_PATH), board)
    print(f"\nBoard saved → {BOARD_PATH}")
    print(f"\nOpen in KiCad and drag components from the grid onto the board!")
    print(f"The Radxa outline on 'User.Drawings' shows where it sits underneath.")
    print(f"Separation rules shown on 'User.Eco1' layer.")


if __name__ == "__main__":
    main()
