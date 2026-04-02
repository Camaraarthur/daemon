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

# Radxa mounting holes — from official DXF (radxa_zero_3w_v1110_top.dxf)
# Radxa coords: (3.55, 3.60), (3.60, 26.45), (61.40, 3.60), (61.40, 26.50)
# Translated to Daemon coords by adding (RADXA_X_OFF, RADXA_Y_OFF)
MOUNTING_HOLES = [
    (10.3 + 3.55,  12.0 + 3.60),   # (13.85, 15.60) — bottom-left
    (10.3 + 3.60,  12.0 + 26.45),   # (13.90, 38.45) — top-left
    (10.3 + 61.40, 12.0 + 3.60),    # (71.70, 15.60) — bottom-right
    (10.3 + 61.40, 12.0 + 26.50),   # (71.70, 38.50) — top-right
]

# ── Component categories ──────────────────────────────────────────────────────
#
# TIER 1 — "PLACE FIRST"
#   Physical connectors, UI elements, big parts that define the board edges.
#   These lock down the mechanical layout. Place them on the board first.
#
# TIER 2 — "PLACE CAREFULLY"
#   ICs and components with noise/signal/thermal sensitivity rules.
#   After Tier 1 is set, place these respecting the separation constraints.
#
# Everything else (passives, small support parts) is hidden below the board.
# Those follow their parent ICs and will be placed in a later step.

TIER1_GROUPS = [
    ("PORTS — USB", [
        ("J7",  "USB-C\nSTINGER 1"),
        ("J8",  "USB-A\nSTINGER 2"),
        ("J9",  "USB-A\nSTINGER 3"),
        ("J10", "USB-A\nSTINGER 4"),
        ("J12", "USB-C\nGOOBAY BRIDGE\n(B.Cu, under Radxa OTG)"),
        ("J13", "RJ45\nMAGJACK\n(tall! 13.5mm)"),
    ]),
    ("PORTS — INDUSTRIAL + POWER", [
        ("J11", "WAGO 4-pos\n24V I/O\n(tall! edge-mount)"),
        ("BAT1","BATTERY\nJST-PH 2-pin"),
        ("J4",  "AUX GPIO\n2x4 FEMALE\n(breadboard-friendly)"),
    ]),
    ("PORTS — AUDIO", [
        ("J14", "TRRS 3.5mm\nAUDIO JACK"),
        ("J15", "SPEAKER\nJST-SH 2-pin"),
    ]),
    ("DISPLAY + UI", [
        ("J6",  "SCREEN\n8-pin THRU-HOLE\n(pins pass through board)"),
        ("SW2", "NAV SWITCH\nSKRHABE010\n(5-way joystick)"),
        ("SW1", "POWER BTN\n(user-accessible)"),
    ]),
    ("RADXA HEADER", [
        ("J3",  "RADXA 40-PIN\n2x20 female\n(must align w/ Radxa GPIO)"),
    ]),
    ("RF + ANTENNA", [
        ("ANT1","915MHz ANTENNA\nchip antenna\n(needs 5mm keepout)"),
    ]),
    ("RGB LEDs (WS2812B-2020 2mm)", [
        ("LED1","WS2812B-2020 #1\n(chain: DIN→DOUT)"),
        ("LED2","WS2812B-2020 #2"),
        ("LED3","WS2812B-2020 #3"),
        ("LED4","WS2812B-2020 #4"),
    ]),
    ("IR + INDICATOR LEDs", [
        ("LED5","IR LED 0603\n(edge, needs\nline-of-sight)"),
        ("LED6","MIC ACTIVE #1\nRED 0402"),
        ("LED7","MIC ACTIVE #2\nRED 0402"),
        ("LED8","POWER ON\nGREEN 0402"),
    ]),
    ("MICROPHONE", [
        ("U13", "INMP441 MIC\ntop-port MEMS\n(place away from\nspeaker + noise!)"),
    ]),
    ("BIG PASSIVES", [
        ("C7",  "100µF TANT\nPOWER TANK\n(Case-D, near U1)"),
        ("C38", "100µF TANT\nTIMER CAP\n(Case-D)"),
        ("L1",  "4.7µH INDUCTOR\nSRR1260\n(12.5mm! keep away from RF)"),
    ]),
    ("TEST POINTS", [
        ("TP1", "VIN"),
        ("TP2", "BAT"),
        ("TP3", "SW node"),
        ("TP4", "VOUT"),
    ]),
]

TIER2_GROUPS = [
    ("POWER (keep L1 away from RF!)", [
        ("U1",  "IP5328P PMIC\nQFN-40 6x6mm\n(L1, C7, R2 nearby)"),
        ("U2",  "AP2112K LDO\nSOT-23-5\n(3V3_SYS rail)"),
        ("R2",  "NTC 10K\ntemp sense\n(must touch U1)"),
    ]),
    ("RF (>20mm from power, >25mm from L1)", [
        ("U8",  "CC1101 RF\nQFN-20 4x4mm\n(Y3, ANT1 <5mm)"),
        ("Y3",  "26MHz XTAL\n(right next to U8)"),
    ]),
    ("USB HUBS (each needs its XTAL <5mm)", [
        ("U3",  "SL2.1A HUB 1\nQFN-28 5x5mm\n(upstream from Radxa)"),
        ("Y1",  "12MHz XTAL\n(right next to U3)"),
        ("U14", "SL2.1A HUB 2\nQFN-28 5x5mm\n(cascaded from Hub 1)"),
        ("Y2",  "12MHz XTAL\n(right next to U14)"),
    ]),
    ("STINGER POWER SWITCHES (near their port!)", [
        ("U4",  "SY6280 #1\n(near J7)"),
        ("U5",  "SY6280 #2\n(near J8)"),
        ("U6",  "SY6280 #3\n(near J9)"),
        ("U15", "SY6280 #4\n(near J10)"),
    ]),
    ("ETHERNET (XTAL <5mm, away from audio)", [
        ("U9",  "RTL8152B\nQFN-32 5x5mm"),
        ("Y4",  "25MHz XTAL\n(right next to U9)"),
    ]),
    ("AUDIO (away from digital noise!)", [
        ("U10", "MAX98357A AMP\nQFN-16 3x3mm\n(near J15 speaker)"),
    ]),
    ("INDUSTRIAL ISO (near WAGO)", [
        ("U11", "ISO1212\nSOIC-16W\n(near J11 WAGO)"),
        ("D1",  "TVS VCAN26A2\n(near J11)"),
        ("D2",  "TVS VCAN26A2\n(near J11)"),
        ("F1",  "PTC FUSE\n(near J11)"),
        ("F2",  "PTC FUSE\n(near J11)"),
    ]),
    ("CONTROL + WAKE CIRCUIT", [
        ("U7",  "NE555 HEARTBEAT\nSOIC-8\n(drives wake timer)"),
        ("U21", "PCF8574 GPIO EXP\nSOIC-16\n(nav switch I2C\naddr 0x20)"),
        ("Q1",  "BC857 PNP"),
        ("Q2",  "BSS84 PMOS\n(wake blocker)"),
        ("Q3",  "2N7002 NMOS\n(PMIC kill via J3.37)"),
        ("Q4",  "AO3400A NMOS\n(IR LED driver)"),
    ]),
    ("ESD PROTECTION (near their port)", [
        ("U12", "USBLC6-2SC6\n(near J7 stinger 1)"),
        ("U16", "USBLC6-2SC6\n(near upstream USB)"),
        ("U17", "USBLC6-2SC6\n(near Hub 2)"),
        ("U18", "USBLC6-2SC6\n(near J13 RJ45)"),
        ("U19", "ESD9B5.0\n(near J14 TRRS)"),
        ("U20", "ESD9B5.0\n(near J14 TRRS)"),
    ]),
]

# Collect all visible refs
VISIBLE_REFS = set()
for _, items in TIER1_GROUPS + TIER2_GROUPS:
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


def place_radxa_footprint(board):
    """Place the Radxa Zero 3W reference footprint (from real DXF data).

    The footprint contains the actual board outline, pad positions,
    and connector geometry from the official Radxa DXF files.
    The STEP 3D model is attached for 3D viewer verification.
    """
    fp_lib = REPO / "daemon_v0.pretty"
    fp_file = fp_lib / "Radxa_Zero_3W_Reference.kicad_mod"
    if not fp_file.exists():
        print(f"  WARNING: Radxa footprint not found at {fp_file}")
        return

    # Load the footprint
    fp = pcbnew.FootprintLoad(str(fp_lib), "Radxa_Zero_3W_Reference")
    if fp is None:
        print("  WARNING: Could not load Radxa footprint")
        return

    fp.SetReference("RADXA1")
    fp.Value().SetText("Radxa_Zero_3W")
    fp.Reference().SetVisible(True)
    fp.Value().SetVisible(True)

    # Place at Radxa center on the Daemon board
    # Footprint origin = board center (32.5, 15.0 in Radxa coords)
    # Daemon coords = Radxa coords + offset
    cx = RADXA_X_OFF + RADXA_W / 2  # 10.3 + 32.5 = 42.8
    cy = RADXA_Y_OFF + RADXA_H / 2  # 12.0 + 15.0 = 27.0
    fp.SetPosition(_board_pos(cx, cy))
    fp.SetOrientationDegrees(0)

    # Keep on F.Cu — KiCad footprint layer is just for reference
    # The F.Fab/User.Drawings lines show the Radxa outline

    board.Add(fp)

    # Add keepout label on User.Drawings
    _add_text(board, cx, RADXA_Y_OFF - 3,
              "NO TALL PARTS ON B.Cu IN RADXA ZONE", "Dwgs.User", 1.0, 0.15)


def draw_antenna_keepout_guide(board):
    """Draw antenna keepout zone guide on Eco1.User layer.

    The Johanson 0915AT43A0026 chip antenna needs:
    - 5mm minimum keepout from any copper/metal on all sides
    - 7mm keepout on the radiating end (away from feed)
    - Ground plane cutout on all layers beneath the antenna
    - No traces, vias, or components in the keepout zone

    This draws a visual guide — the actual keepout zone enforcement
    must be done in the PCB design rules.
    """
    layer = "Eco1.User"

    # Draw a generic keepout template in the staging area (near Tier 1 RF group)
    # The user will move this with the antenna
    kx, ky = BOARD_W + 25 + 5 * 22.0, -5  # near RF+ANTENNA group

    # Antenna body (3.2 x 1.6mm)
    ant_w, ant_h = 3.2, 1.6
    _draw_rect(board, kx - ant_w/2, ky - ant_h/2, ant_w, ant_h, "Cmts.User", 0.2)

    # 5mm keepout zone around antenna
    keepout = 5.0
    kw = ant_w + keepout * 2
    kh = ant_h + keepout * 2
    _draw_rect(board, kx - kw/2, ky - kh/2, kw, kh, layer, 0.25)

    # 7mm extended keepout on radiating end (right side)
    ext_keepout = 7.0
    ext_x = kx + ant_w/2
    ext_w = ext_keepout
    ext_h = ant_h + keepout * 2
    _draw_rect(board, ext_x, ky - ext_h/2, ext_w, ext_h, layer, 0.25)

    # Cross-hatch pattern inside keepout (visual indicator)
    for i in range(int(kw / 2)):
        hx = kx - kw/2 + i * 2
        _draw_line(board, hx, ky - kh/2, hx + 1, ky + kh/2, layer, 0.08)

    # Labels
    _add_text(board, kx, ky - kh/2 - 2,
              "ANTENNA KEEPOUT ZONE", layer, 1.2, 0.15)
    _add_text(board, kx, ky + kh/2 + 1.5,
              "No copper/traces/vias/components", layer, 0.8, 0.10)
    _add_text(board, kx, ky + kh/2 + 3,
              "Ground plane cutout on ALL layers beneath", layer, 0.8, 0.10)
    _add_text(board, ext_x + ext_w/2, ky,
              "7mm\nRADIATING\nEND", layer, 0.7, 0.10)
    _add_text(board, kx - kw/2 - 2, ky,
              "5mm\nMIN", layer, 0.7, 0.10)


def draw_board_dimensions(board):
    """Add dimension annotations to the board."""
    layer = "Cmts.User"
    # Width dimension (top)
    _add_text(board, BOARD_W / 2, -4, f"← {BOARD_W} mm →", layer, 1.5, 0.15)
    # Height dimension (right)
    _add_text(board, BOARD_W + 5, BOARD_H / 2, f"{BOARD_H} mm", layer, 1.5, 0.15)


def draw_separation_zones(board):
    """Draw key separation distance reminders on User.Eco1."""
    layer = "Eco1.User"
    # These are reminders, not actual placement
    _add_text(board, BOARD_W / 2, BOARD_H + 4,
              "RULES: Power↔RF ≥20mm | Inductor↔RF ≥25mm | XTAL_26↔XTAL_25 ≥10mm",
              layer, 1.0, 0.12)
    _add_text(board, BOARD_W / 2, BOARD_H + 7,
              "Inductor↔XTALs ≥15mm | Antenna keepout 5mm | MagJack↔USB-C ≥15mm",
              layer, 1.0, 0.12)


def _place_tier(board, ref_fps, groups, grid_x_start, grid_y_start,
                tier_label, tier_sublabel):
    """Place a tier of components in a labeled grid."""
    col_width = 22.0
    row_height = 20.0
    items_per_col = 5

    # Tier banner
    _add_text(board, grid_x_start, grid_y_start - 10, tier_label,
              "Cmts.User", 2.5, 0.25)
    _add_text(board, grid_x_start, grid_y_start - 6, tier_sublabel,
              "Cmts.User", 1.0, 0.12)

    current_col = 0
    placed = 0
    group_start_col = 0  # track where each group starts

    for group_name, items in groups:
        # Each group starts on a fresh column
        grid_x = grid_x_start + current_col * col_width

        # Group header
        _add_text(board, grid_x, grid_y_start - 3, group_name,
                  "Cmts.User", 1.0, 0.12)

        row_in_col = 0
        for ref, label in items:
            if ref not in ref_fps:
                print(f"  WARNING: {ref} not on board")
                continue

            fp = ref_fps[ref]

            grid_x = grid_x_start + current_col * col_width
            current_y = grid_y_start + row_in_col * row_height

            # Place at grid position
            fp.SetPosition(_board_pos(grid_x, current_y))
            fp.SetOrientationDegrees(0)

            # Set descriptive label
            val_field = fp.Value()
            val_field.SetText(label)
            val_field.SetVisible(True)
            val_field.SetTextSize(pcbnew.VECTOR2I(_mm(0.7), _mm(0.7)))
            val_field.SetTextThickness(_mm(0.10))

            # Show ref prominently
            ref_field = fp.Reference()
            ref_field.SetVisible(True)
            ref_field.SetTextSize(pcbnew.VECTOR2I(_mm(1.0), _mm(1.0)))
            ref_field.SetTextThickness(_mm(0.15))

            row_in_col += 1
            placed += 1

            if row_in_col >= items_per_col:
                current_col += 1
                row_in_col = 0

        # Advance to next column for next group
        if row_in_col > 0:
            current_col += 1

    return placed, current_col  # count, columns used


def place_staging_grid(board, ref_fps):
    """Place Tier 1 and Tier 2 components in separate labeled grids."""

    # Tier 1 starts to the right of the board
    t1_x = BOARD_W + 25
    t1_y = -5
    t1_placed, t1_cols = _place_tier(
        board, ref_fps, TIER1_GROUPS, t1_x, t1_y,
        "TIER 1 — PLACE FIRST",
        "Connectors, UI, big parts. These define your board edges."
    )

    # Tier 2 starts below Tier 1 (leave vertical gap)
    t2_x = BOARD_W + 25
    t2_y = t1_y + 5 * 20.0 + 25  # after 5 rows + gap
    t2_placed, t2_cols = _place_tier(
        board, ref_fps, TIER2_GROUPS, t2_x, t2_y,
        "TIER 2 — PLACE CAREFULLY",
        "ICs with noise/signal/thermal rules. Read the labels!"
    )

    return t1_placed + t2_placed


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
              "Cmts.User", 1.2, 0.15)

    return len(secondary)


def fix_3d_models(board, ref_fps):
    """Override 3D model paths for footprints whose built-in WRL files don't exist.

    Maps specific footprints to downloaded STEP models in the project's 3dmodels/ dir.
    """
    MODEL_OVERRIDES = {
        "J13": "RJ45_Hanrun_HR911105A.step",        # RJ45 MagJack
        "J7":  "USB_C_Receptacle_HRO_TYPE-C-31-M-12.step",  # Stinger 1
    }

    models_dir = REPO / "3dmodels"
    fixed = 0

    for ref, step_file in MODEL_OVERRIDES.items():
        if ref not in ref_fps:
            continue
        step_path = models_dir / step_file
        if not step_path.exists():
            print(f"  WARNING: 3D model not found: {step_path}")
            continue

        fp = ref_fps[ref]
        # Clear existing models and add our STEP
        models = fp.Models()
        model_list = list(models)

        # Check if model already points to our override
        proj_rel = f"${{KIPRJDIR}}/3dmodels/{step_file}"
        already_set = any(m.m_Filename == proj_rel for m in model_list)
        if already_set:
            continue

        # Add our model (keep existing as fallback)
        new_model = pcbnew.FP_3DMODEL()
        new_model.m_Filename = proj_rel
        new_model.m_Scale = pcbnew.VECTOR3D(1.0, 1.0, 1.0)
        new_model.m_Rotation = pcbnew.VECTOR3D(0.0, 0.0, 0.0)
        new_model.m_Offset = pcbnew.VECTOR3D(0.0, 0.0, 0.0)
        fp.Add3DModel(new_model)
        fixed += 1

    return fixed


def main():
    if not BOARD_PATH.exists():
        sys.exit(f"Board not found: {BOARD_PATH}")

    board = pcbnew.LoadBoard(str(BOARD_PATH))
    ref_fps = {fp.GetReference(): fp for fp in board.GetFootprints()}
    print(f"Board loaded: {len(ref_fps)} footprints")

    # 1. Place Radxa reference footprint (real DXF geometry + 3D model)
    place_radxa_footprint(board)
    print("  Placed Radxa Zero 3W reference footprint (from official DXF)")

    # 2. Draw board dimensions and rules
    draw_board_dimensions(board)
    draw_separation_zones(board)
    print("  Added dimension annotations and separation rules")

    # 3. Draw antenna keepout guide
    draw_antenna_keepout_guide(board)
    print("  Added antenna keepout zone guide")

    # 4. Fix 3D models for standard lib footprints
    model_fixes = fix_3d_models(board, ref_fps)
    if model_fixes:
        print(f"  Fixed {model_fixes} 3D model references")

    # 4. Place Tier 1 + Tier 2 in staging grids
    staged = place_staging_grid(board, ref_fps)
    print(f"  Staged {staged} key components in labeled grids (right of board)")

    # 5. Hide Category C
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