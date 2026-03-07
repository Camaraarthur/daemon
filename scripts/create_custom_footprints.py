#!/usr/bin/env python3
"""Generate custom KiCad footprints missing from KiCad 8 default libraries.

Missing footprints:
  1. Johanson 0915AT43A0026 — 915 MHz ceramic chip antenna (3.2x1.6mm)
  2. WAGO 2060-404 — 4-pos SMD push-in terminal block (4.0mm pitch)
  3. SJ2-2531X-SMT — 3.5mm TRRS audio jack (SMD)

Generated into lib/Daemon_V0.pretty/
"""

from __future__ import annotations

from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
FP_DIR = REPO / "lib" / "Daemon_V0.pretty"

_uuid_counter = 0
def _uuid() -> str:
    global _uuid_counter
    _uuid_counter += 1
    return f"10000000-0000-0000-0000-{_uuid_counter:012d}"


def _johanson_0915at43a0026() -> str:
    """Johanson 0915AT43A0026 ceramic chip antenna.

    Datasheet dimensions:
    - Body: 3.2mm x 1.6mm x 0.5mm
    - Two pads: 0.7mm x 1.6mm
    - Pad spacing: center-to-center 2.5mm
    - Pad 1: feed (left), Pad 2: mount/GND (right)
    - Requires 7.0 x 3.0mm all-layer copper keep-out around element
    """
    return f"""\
(footprint "Antenna_Chip_Johanson_0915AT43A0026"
  (version 20240108)
  (generator "daemon_v0_custom_footprints")
  (layer "F.Cu")
  (descr "Johanson 0915AT43A0026 915MHz ceramic chip antenna, 3.2x1.6mm")
  (tags "antenna chip 915MHz ISM sub-GHz")
  (attr smd)
  (fp_text reference "REF**" (at 0 -2.5) (layer "F.SilkS")
    (effects (font (size 1 1) (thickness 0.15)))
    (uuid "{_uuid()}")
  )
  (fp_text value "0915AT43A0026" (at 0 2.5) (layer "F.Fab")
    (effects (font (size 1 1) (thickness 0.15)))
    (uuid "{_uuid()}")
  )
  (fp_line (start -1.8 -1.0) (end 1.8 -1.0) (stroke (width 0.12) (type default)) (layer "F.SilkS") (uuid "{_uuid()}"))
  (fp_line (start -1.8 1.0) (end 1.8 1.0) (stroke (width 0.12) (type default)) (layer "F.SilkS") (uuid "{_uuid()}"))
  (fp_line (start -2.2 -1.4) (end 2.2 -1.4) (stroke (width 0.05) (type default)) (layer "F.CrtYd") (uuid "{_uuid()}"))
  (fp_line (start -2.2 1.4) (end 2.2 1.4) (stroke (width 0.05) (type default)) (layer "F.CrtYd") (uuid "{_uuid()}"))
  (fp_line (start -2.2 -1.4) (end -2.2 1.4) (stroke (width 0.05) (type default)) (layer "F.CrtYd") (uuid "{_uuid()}"))
  (fp_line (start 2.2 -1.4) (end 2.2 1.4) (stroke (width 0.05) (type default)) (layer "F.CrtYd") (uuid "{_uuid()}"))
  (fp_line (start -1.6 -0.8) (end 1.6 -0.8) (stroke (width 0.1) (type default)) (layer "F.Fab") (uuid "{_uuid()}"))
  (fp_line (start -1.6 0.8) (end 1.6 0.8) (stroke (width 0.1) (type default)) (layer "F.Fab") (uuid "{_uuid()}"))
  (fp_line (start -1.6 -0.8) (end -1.6 0.8) (stroke (width 0.1) (type default)) (layer "F.Fab") (uuid "{_uuid()}"))
  (fp_line (start 1.6 -0.8) (end 1.6 0.8) (stroke (width 0.1) (type default)) (layer "F.Fab") (uuid "{_uuid()}"))
  (fp_line (start -1.6 -0.3) (end -1.1 -0.8) (stroke (width 0.1) (type default)) (layer "F.Fab") (uuid "{_uuid()}"))
  (pad "1" smd rect (at -1.25 0) (size 0.7 1.6) (layers "F.Cu" "F.Paste" "F.Mask")
    (uuid "{_uuid()}")
  )
  (pad "2" smd rect (at 1.25 0) (size 0.7 1.6) (layers "F.Cu" "F.Paste" "F.Mask")
    (uuid "{_uuid()}")
  )
  (model "${{KICAD8_3DMODEL_DIR}}/RF_Antenna.3dshapes/Johanson_0915AT43A0026.wrl"
    (offset (xyz 0 0 0))
    (scale (xyz 1 1 1))
    (rotate (xyz 0 0 0))
  )
)
"""


def _wago_2060_404() -> str:
    """WAGO 2060-404 4-position SMD push-in terminal block.

    Datasheet dimensions:
    - 4 positions, 4.0mm pitch
    - Body: ~16.0mm x 8.5mm x 5.5mm
    - SMD pads for soldering
    """
    return f"""\
(footprint "TerminalBlock_WAGO_2060-404_1x04_P4.00mm_Horizontal"
  (version 20240108)
  (generator "daemon_v0_custom_footprints")
  (layer "F.Cu")
  (descr "WAGO 2060-404, 4-pos SMD push-in terminal block, 4.0mm pitch")
  (tags "terminal block WAGO 2060 SMD push-in")
  (attr smd)
  (fp_text reference "REF**" (at 6.0 -6.0) (layer "F.SilkS")
    (effects (font (size 1 1) (thickness 0.15)))
    (uuid "{_uuid()}")
  )
  (fp_text value "WAGO_2060-404" (at 6.0 6.5) (layer "F.Fab")
    (effects (font (size 1 1) (thickness 0.15)))
    (uuid "{_uuid()}")
  )
  (fp_line (start -1.0 -5.0) (end 13.0 -5.0) (stroke (width 0.12) (type default)) (layer "F.SilkS") (uuid "{_uuid()}"))
  (fp_line (start -1.0 5.0) (end 13.0 5.0) (stroke (width 0.12) (type default)) (layer "F.SilkS") (uuid "{_uuid()}"))
  (fp_line (start -1.0 -5.0) (end -1.0 5.0) (stroke (width 0.12) (type default)) (layer "F.SilkS") (uuid "{_uuid()}"))
  (fp_line (start 13.0 -5.0) (end 13.0 5.0) (stroke (width 0.12) (type default)) (layer "F.SilkS") (uuid "{_uuid()}"))
  (fp_line (start -1.5 -5.5) (end 13.5 -5.5) (stroke (width 0.05) (type default)) (layer "F.CrtYd") (uuid "{_uuid()}"))
  (fp_line (start -1.5 5.5) (end 13.5 5.5) (stroke (width 0.05) (type default)) (layer "F.CrtYd") (uuid "{_uuid()}"))
  (fp_line (start -1.5 -5.5) (end -1.5 5.5) (stroke (width 0.05) (type default)) (layer "F.CrtYd") (uuid "{_uuid()}"))
  (fp_line (start 13.5 -5.5) (end 13.5 5.5) (stroke (width 0.05) (type default)) (layer "F.CrtYd") (uuid "{_uuid()}"))
  (pad "1" smd rect (at 0 0) (size 2.0 3.0) (layers "F.Cu" "F.Paste" "F.Mask")
    (uuid "{_uuid()}")
  )
  (pad "2" smd rect (at 4.0 0) (size 2.0 3.0) (layers "F.Cu" "F.Paste" "F.Mask")
    (uuid "{_uuid()}")
  )
  (pad "3" smd rect (at 8.0 0) (size 2.0 3.0) (layers "F.Cu" "F.Paste" "F.Mask")
    (uuid "{_uuid()}")
  )
  (pad "4" smd rect (at 12.0 0) (size 2.0 3.0) (layers "F.Cu" "F.Paste" "F.Mask")
    (uuid "{_uuid()}")
  )
)
"""


def _sj2_2531x_smt() -> str:
    """SJ2-2531X-SMT 3.5mm TRRS audio jack (SMD).

    CUI SJ2-2531X series, 4-conductor TRRS, horizontal SMD mount.
    5 electrical pins + 2 mechanical anchor tabs.
    """
    return f"""\
(footprint "Jack_3.5mm_SJ2-2531X-SMT"
  (version 20240108)
  (generator "daemon_v0_custom_footprints")
  (layer "F.Cu")
  (descr "CUI SJ2-2531X-SMT 3.5mm TRRS jack, SMD horizontal mount")
  (tags "audio jack TRRS 3.5mm SMD")
  (attr smd)
  (fp_text reference "REF**" (at 0 -5.5) (layer "F.SilkS")
    (effects (font (size 1 1) (thickness 0.15)))
    (uuid "{_uuid()}")
  )
  (fp_text value "SJ2-2531X-SMT" (at 0 5.5) (layer "F.Fab")
    (effects (font (size 1 1) (thickness 0.15)))
    (uuid "{_uuid()}")
  )
  (fp_line (start -6.0 -4.5) (end 6.0 -4.5) (stroke (width 0.12) (type default)) (layer "F.SilkS") (uuid "{_uuid()}"))
  (fp_line (start -6.0 4.5) (end 6.0 4.5) (stroke (width 0.12) (type default)) (layer "F.SilkS") (uuid "{_uuid()}"))
  (fp_line (start -6.0 -4.5) (end -6.0 4.5) (stroke (width 0.12) (type default)) (layer "F.SilkS") (uuid "{_uuid()}"))
  (fp_line (start 6.0 -4.5) (end 6.0 4.5) (stroke (width 0.12) (type default)) (layer "F.SilkS") (uuid "{_uuid()}"))
  (fp_line (start -6.5 -5.0) (end 6.5 -5.0) (stroke (width 0.05) (type default)) (layer "F.CrtYd") (uuid "{_uuid()}"))
  (fp_line (start -6.5 5.0) (end 6.5 5.0) (stroke (width 0.05) (type default)) (layer "F.CrtYd") (uuid "{_uuid()}"))
  (fp_line (start -6.5 -5.0) (end -6.5 5.0) (stroke (width 0.05) (type default)) (layer "F.CrtYd") (uuid "{_uuid()}"))
  (fp_line (start 6.5 -5.0) (end 6.5 5.0) (stroke (width 0.05) (type default)) (layer "F.CrtYd") (uuid "{_uuid()}"))
  (pad "T" smd rect (at -5.0 -3.5) (size 1.6 2.0) (layers "F.Cu" "F.Paste" "F.Mask")
    (uuid "{_uuid()}")
  )
  (pad "R1" smd rect (at -5.0 3.5) (size 1.6 2.0) (layers "F.Cu" "F.Paste" "F.Mask")
    (uuid "{_uuid()}")
  )
  (pad "R2" smd rect (at 5.0 -3.5) (size 1.6 2.0) (layers "F.Cu" "F.Paste" "F.Mask")
    (uuid "{_uuid()}")
  )
  (pad "S" smd rect (at 5.0 0) (size 1.6 2.0) (layers "F.Cu" "F.Paste" "F.Mask")
    (uuid "{_uuid()}")
  )
  (pad "GND" smd rect (at 5.0 3.5) (size 1.6 2.0) (layers "F.Cu" "F.Paste" "F.Mask")
    (uuid "{_uuid()}")
  )
)
"""


def main() -> None:
    FP_DIR.mkdir(parents=True, exist_ok=True)

    footprints = [
        ("Antenna_Chip_Johanson_0915AT43A0026.kicad_mod", _johanson_0915at43a0026()),
        ("TerminalBlock_WAGO_2060-404_1x04_P4.00mm_Horizontal.kicad_mod", _wago_2060_404()),
        ("Jack_3.5mm_SJ2-2531X-SMT.kicad_mod", _sj2_2531x_smt()),
    ]

    for filename, content in footprints:
        path = FP_DIR / filename
        path.write_text(content, encoding="utf-8")
        print(f"  {filename}")

    print(f"\n{len(footprints)} custom footprints written to {FP_DIR}/")


if __name__ == "__main__":
    main()
