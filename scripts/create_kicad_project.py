#!/usr/bin/env python3
"""Create the Daemon V0 KiCad project skeleton.

Generates:
  daemon_v0.kicad_pro  — project file with library refs + stackup
  daemon_v0.kicad_pcb  — board file with outline, stackup, design rules, and net classes

Board dimensions: ~85.6mm x 54mm (credit-card form factor, stacked on Radxa Zero 3W).
Stackup: JLC04161H-3313 4-layer FR4 (F.Cu / In1.Cu GND / In2.Cu Power / B.Cu).
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent

# Board outline (credit card sized)
BOARD_W = 85.6   # mm
BOARD_H = 54.0   # mm
CORNER_R = 1.0   # mm corner radius
ORIGIN_X = 100.0 # mm — KiCad page origin offset
ORIGIN_Y = 100.0

# ── .kicad_pro ───────────────────────────────────────────────────────────────

def _generate_kicad_pro() -> str:
    """Generate minimal KiCad 8 project JSON."""
    pro = {
        "board": {
            "3dviewports": [],
            "design_settings": {
                "defaults": {
                    "board_outline_line_width": 0.1,
                    "copper_line_width": 0.2,
                    "copper_text_size_h": 1.5,
                    "copper_text_size_v": 1.5,
                    "copper_text_thickness": 0.3,
                    "other_line_width": 0.15,
                    "silk_line_width": 0.15,
                    "silk_text_size_h": 1.0,
                    "silk_text_size_v": 1.0,
                    "silk_text_thickness": 0.15,
                },
                "diff_pair_dimensions": [
                    {"gap": 0.15, "via_gap": 0.25, "width": 0.15},
                    {"gap": 0.20, "via_gap": 0.25, "width": 0.15},
                ],
                "drc_exclusions": [],
                "rules": {
                    "min_clearance": 0.1,
                    "min_copper_edge_clearance": 0.3,
                    "min_hole_clearance": 0.25,
                    "min_hole_to_hole": 0.25,
                    "min_microvia_diameter": 0.2,
                    "min_microvia_drill": 0.1,
                    "min_resolved_spokes": 2,
                    "min_silk_clearance": 0.0,
                    "min_text_height": 0.8,
                    "min_text_thickness": 0.08,
                    "min_through_hole_diameter": 0.3,
                    "min_track_width": 0.1,
                    "min_via_annular_width": 0.13,
                    "min_via_diameter": 0.6,
                    "solder_mask_to_copper_clearance": 0.0,
                },
            },
            "layer_presets": [],
        },
        "libraries": {
            "pinned_footprint_libs": [],
            "pinned_symbol_libs": [],
        },
        "meta": {
            "filename": "daemon_v0.kicad_pro",
            "version": 1,
        },
        "net_settings": {
            "classes": [
                {
                    "bus_width": 12,
                    "clearance": 0.15,
                    "diff_pair_gap": 0.15,
                    "diff_pair_via_gap": 0.25,
                    "diff_pair_width": 0.15,
                    "line_style": 0,
                    "microvia_diameter": 0.3,
                    "microvia_drill": 0.1,
                    "name": "Default",
                    "pcb_color": "rgba(0, 0, 0, 0.000)",
                    "schematic_color": "rgba(0, 0, 0, 0.000)",
                    "track_width": 0.2,
                    "via_diameter": 0.6,
                    "via_drill": 0.3,
                    "wire_width": 6,
                },
            ],
            "meta": {"version": 3},
            "net_colors": None,
        },
        "pcbnew": {
            "last_paths": {"gencad": "", "idf": "", "netlist": "", "specctra_dsn": "", "step": ""},
        },
        "schematic": {
            "legacy_lib_dir": "",
            "legacy_lib_list": [],
        },
        "sheets": [],
        "text_variables": {},
    }
    return json.dumps(pro, indent=2)


# ── .kicad_pcb ───────────────────────────────────────────────────────────────

def _board_outline_points() -> list[tuple[float, float]]:
    """Compute board outline with rounded corners (approximated as line segments)."""
    import math
    r = CORNER_R
    x0, y0 = ORIGIN_X, ORIGIN_Y
    w, h = BOARD_W, BOARD_H
    pts = []
    # 4 corners, each with a small arc approximation
    corners = [
        (x0 + r,     y0 + r,     180, 270),  # top-left
        (x0 + w - r, y0 + r,     270, 360),  # top-right
        (x0 + w - r, y0 + h - r, 0,   90),   # bottom-right
        (x0 + r,     y0 + h - r, 90,  180),  # bottom-left
    ]
    for cx, cy, a_start, a_end in corners:
        for a in range(a_start, a_end + 1, 15):
            rad = math.radians(a)
            pts.append((cx + r * math.cos(rad), cy + r * math.sin(rad)))
    return pts


def _generate_kicad_pcb() -> str:
    """Generate KiCad 8 PCB file with board outline and stackup."""

    pts = _board_outline_points()

    # Build edge cuts lines
    edge_lines = []
    for i in range(len(pts)):
        x1, y1 = pts[i]
        x2, y2 = pts[(i + 1) % len(pts)]
        edge_lines.append(
            f'  (gr_line (start {x1:.4f} {y1:.4f}) (end {x2:.4f} {y2:.4f})'
            f' (stroke (width 0.1) (type default)) (layer "Edge.Cuts") (uuid "{_uuid()}"))'
        )

    edges = "\n".join(edge_lines)

    pcb = f"""\
(kicad_pcb
  (version 20240108)
  (generator "daemon_v0_create_project")
  (generator_version "1.0")
  (general
    (thickness 1.6)
    (legacy_teardrops no)
  )
  (paper "A4")
  (layers
    (0 "F.Cu" signal)
    (1 "In1.Cu" signal "GND")
    (2 "In2.Cu" signal "Power")
    (31 "B.Cu" signal)
    (32 "B.Adhes" user "B.Adhesive")
    (33 "F.Adhes" user "F.Adhesive")
    (34 "B.Paste" user)
    (35 "F.Paste" user)
    (36 "B.SilkS" user "B.Silkscreen")
    (37 "F.SilkS" user "F.Silkscreen")
    (38 "B.Mask" user "B.Mask")
    (39 "F.Mask" user "F.Mask")
    (40 "Dwgs.User" user "User.Drawings")
    (41 "Cmts.User" user "User.Comments")
    (42 "Eco1.User" user "User.Eco1")
    (43 "Eco2.User" user "User.Eco2")
    (44 "Edge.Cuts" user)
    (45 "Margin" user)
    (46 "B.CrtYd" user "B.Courtyard")
    (47 "F.CrtYd" user "F.Courtyard")
    (48 "B.Fab" user "B.Fabrication")
    (49 "F.Fab" user "F.Fabrication")
    (50 "User.1" user)
    (51 "User.2" user)
  )
  (setup
    (stackup
      (layer "F.SilkS" (type "Top Silk Screen"))
      (layer "F.Paste" (type "Top Solder Paste"))
      (layer "F.Mask" (type "Top Solder Mask") (thickness 0.01) (material "Epoxy") (epsilon_r 3.3))
      (layer "F.Cu" (type "copper") (thickness 0.035))
      (layer "dielectric 1" (type "prepreg") (thickness 0.2104) (material "FR4") (epsilon_r 4.1) (loss_tangent 0.02))
      (layer "In1.Cu" (type "copper") (thickness 0.0175))
      (layer "dielectric 2" (type "core") (thickness 1.065) (material "FR4") (epsilon_r 4.6) (loss_tangent 0.02))
      (layer "In2.Cu" (type "copper") (thickness 0.0175))
      (layer "dielectric 3" (type "prepreg") (thickness 0.2104) (material "FR4") (epsilon_r 4.1) (loss_tangent 0.02))
      (layer "B.Cu" (type "copper") (thickness 0.035))
      (layer "B.Mask" (type "Bottom Solder Mask") (thickness 0.01) (material "Epoxy") (epsilon_r 3.3))
      (layer "B.Paste" (type "Bottom Solder Paste"))
      (layer "B.SilkS" (type "Bottom Silk Screen"))
      (copper_finish "ENIG")
      (dielectric_constraints yes)
    )
    (pad_to_mask_clearance 0)
    (allow_soldermask_bridges_in_footprints no)
    (pcbplotparams
      (layerselection 0x00010fc_ffffffff)
      (plot_on_all_layers_selection 0x0000000_00000000)
      (disableapertmacros no)
      (usegerberextensions no)
      (usegerberattributes yes)
      (usegerberadvancedattributes yes)
      (creategerberjobfile yes)
      (dashed_line_dash_ratio 12.000000)
      (dashed_line_gap_ratio 3.000000)
      (svgprecision 4)
      (plotframeref no)
      (viasonmask no)
      (mode 1)
      (useauxorigin no)
      (hpglpennumber 1)
      (hpglpenspeed 20)
      (hpglpendiameter 15.000000)
      (pdf_front_fp_property_popups yes)
      (pdf_back_fp_property_popups yes)
      (dxfpolygonmode yes)
      (dxfimperialunits yes)
      (dxfusepcbnewfont yes)
      (psnegative no)
      (psa4output no)
      (plotreference yes)
      (plotvalue yes)
      (plotfptext yes)
      (plotinvisibletext no)
      (sketchpadsonfab no)
      (subtractmaskfromsilk no)
      (outputformat 1)
      (mirror no)
      (drillshape 1)
      (scaleselection 1)
      (outputdirectory "output/gerber/")
    )
  )
  (net 0 "")

  (net_class "Default" ""
    (clearance 0.15)
    (trace_width 0.2)
    (via_dia 0.6)
    (via_drill 0.3)
    (uvia_dia 0.3)
    (uvia_drill 0.1)
  )
  (net_class "DIFF_USB_90" "90-Ohm USB 2.0 HS differential pair"
    (clearance 0.15)
    (trace_width 0.15)
    (via_dia 0.6)
    (via_drill 0.3)
    (uvia_dia 0.3)
    (uvia_drill 0.1)
    (diff_pair_width 0.15)
    (diff_pair_gap 0.15)
  )
  (net_class "DIFF_ETH_100" "100-Ohm Ethernet MDI differential pair"
    (clearance 0.2)
    (trace_width 0.15)
    (via_dia 0.6)
    (via_drill 0.3)
    (uvia_dia 0.3)
    (uvia_drill 0.1)
    (diff_pair_width 0.15)
    (diff_pair_gap 0.2)
  )
  (net_class "POWER_5A" "High-current power distribution (BAT, 5V_SYS)"
    (clearance 0.2)
    (trace_width 2.0)
    (via_dia 0.8)
    (via_drill 0.4)
    (uvia_dia 0.3)
    (uvia_drill 0.1)
  )

{edges}

)
"""
    return pcb


_uuid_counter = 0
def _uuid() -> str:
    """Generate sequential pseudo-UUIDs for KiCad S-expression."""
    global _uuid_counter
    _uuid_counter += 1
    return f"00000000-0000-0000-0000-{_uuid_counter:012d}"


# ── sym-lib-table and fp-lib-table ───────────────────────────────────────────

def _generate_sym_lib_table() -> str:
    return (
        '(sym_lib_table\n'
        '  (version 7)\n'
        '  (lib (name "Daemon_V0")\n'
        '    (type "KiCad")\n'
        '    (uri "${KIPRJMOD}/lib/Daemon_V0.kicad_sym")\n'
        '    (options "")\n'
        '    (descr "Daemon V0 custom IC symbols")\n'
        '  )\n'
        ')\n'
    )


def _generate_fp_lib_table() -> str:
    return (
        '(fp_lib_table\n'
        '  (version 7)\n'
        '  (lib (name "Daemon_V0")\n'
        '    (type "KiCad")\n'
        '    (uri "${KIPRJMOD}/lib/Daemon_V0.pretty")\n'
        '    (options "")\n'
        '    (descr "Daemon V0 custom footprints")\n'
        '  )\n'
        ')\n'
    )


def main() -> None:
    pro_path = REPO / "daemon_v0.kicad_pro"
    pcb_path = REPO / "daemon_v0.kicad_pcb"
    sym_path = REPO / "sym-lib-table"
    fp_path = REPO / "fp-lib-table"

    pro_path.write_text(_generate_kicad_pro(), encoding="utf-8")
    print(f"Project file  → {pro_path}")

    pcb_path.write_text(_generate_kicad_pcb(), encoding="utf-8")
    print(f"Board file    → {pcb_path}")
    print(f"  Outline     : {BOARD_W} x {BOARD_H} mm (credit-card, stacked on Radxa)")
    print(f"  Stackup     : JLC04161H-3313 4-layer FR4")
    print(f"  Net classes : Default, DIFF_USB_90, DIFF_ETH_100, POWER_5A")

    sym_path.write_text(_generate_sym_lib_table(), encoding="utf-8")
    print(f"Sym-lib-table → {sym_path}")

    fp_path.write_text(_generate_fp_lib_table(), encoding="utf-8")
    print(f"Fp-lib-table  → {fp_path}")


if __name__ == "__main__":
    main()
