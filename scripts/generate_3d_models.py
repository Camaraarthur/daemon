#!/usr/bin/env python3
"""Generate simple STEP 3D models for components missing them.

Uses CadQuery to create parametric box/body models for:
- WAGO 2060-404 4-pole SMD terminal block
- Johanson 0915AT43A0026 chip antenna
- Alps SKRTLAE010 side-push tact switch
- TestPoint pads (D1.0mm, D1.5mm)
"""
from pathlib import Path
import cadquery as cq

OUT = Path(__file__).resolve().parent.parent / "3dmodels"
OUT.mkdir(exist_ok=True)


def wago_2060_404():
    """WAGO 2060-404/998-404: 4-pole SMD terminal block, 4mm pitch.
    Body: ~16.0 x 8.0 x 9.0mm (LxWxH)
    """
    body = (
        cq.Workplane("XY")
        .box(16.0, 8.0, 9.0)
        .translate((0, 0, 4.5))  # sit on Z=0
    )
    # Wire entry slots (4 holes on top)
    for i in range(4):
        x = -6.0 + i * 4.0
        body = body.cut(
            cq.Workplane("XY")
            .transformed(offset=(x, 0, 9.0))
            .circle(1.0)
            .extrude(-3.0)
        )
    cq.exporters.export(body, str(OUT / "WAGO_2060-404.step"))
    print(f"  WAGO_2060-404.step")


def johanson_antenna():
    """Johanson 0915AT43A0026: 915MHz chip antenna.
    Body: 7.0 x 3.0 x 1.2mm ceramic chip
    """
    body = (
        cq.Workplane("XY")
        .box(7.0, 3.0, 1.2)
        .translate((0, 0, 0.6))
    )
    cq.exporters.export(body, str(OUT / "Antenna_Johanson_0915AT43A0026.step"))
    print(f"  Antenna_Johanson_0915AT43A0026.step")


def alps_skrtlae010():
    """Alps SKRTLAE010: side-push tact switch.
    Body: 4.5 x 3.4 x 2.55mm with side actuator nub
    """
    body = (
        cq.Workplane("XY")
        .box(4.5, 3.4, 2.55)
        .translate((0, 0, 1.275))
    )
    # Side actuator nub
    nub = (
        cq.Workplane("XY")
        .transformed(offset=(2.25, 0, 1.275))
        .box(1.0, 1.5, 1.5)
    )
    body = body.union(nub)
    cq.exporters.export(body, str(OUT / "SW_Alps_SKRTLAE010.step"))
    print(f"  SW_Alps_SKRTLAE010.step (power button)")


def testpoint_d15():
    """Test point pad D1.5mm — simple cylinder."""
    body = (
        cq.Workplane("XY")
        .circle(0.75)
        .extrude(0.5)
    )
    cq.exporters.export(body, str(OUT / "TestPoint_Pad_D1.5mm.step"))
    print(f"  TestPoint_Pad_D1.5mm.step")


def testpoint_d10():
    """Test point pad D1.0mm — simple cylinder."""
    body = (
        cq.Workplane("XY")
        .circle(0.5)
        .extrude(0.5)
    )
    cq.exporters.export(body, str(OUT / "TestPoint_Pad_D1.0mm.step"))
    print(f"  TestPoint_Pad_D1.0mm.step")


if __name__ == "__main__":
    print("Generating 3D models...")
    wago_2060_404()
    johanson_antenna()
    alps_skrtlae010()
    testpoint_d15()
    testpoint_d10()
    print("Done.")
