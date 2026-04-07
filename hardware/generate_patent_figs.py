#!/usr/bin/env python3
"""
Generate professional patent drawings for the privacy LED interlock invention.
Output: clean A4 SVGs ready for UIBM filing.
"""

import schemdraw
import schemdraw.elements as elm
import re
from pathlib import Path

OUTDIR = Path('/home/arthur/daemon/hardware')


def wrap_in_a4(content_svg_path: Path, fig_label: str, output_path: Path):
    """Wrap a schemdraw SVG in an A4 page with margins and Fig label."""
    inner = content_svg_path.read_text()

    vb_match = re.search(r'viewBox="([^"]+)"', inner)
    if not vb_match:
        raise ValueError("No viewBox in schemdraw output")
    vb = [float(x) for x in vb_match.group(1).split()]
    content_w, content_h = vb[2], vb[3]

    body_match = re.search(r'<svg[^>]*>(.*)</svg>', inner, re.DOTALL)
    body = body_match.group(1)

    # A4 = 210 x 297 mm. Reserve top 50mm for fig label, sides 25mm.
    avail_w = 160
    avail_h = 200
    scale = min(avail_w / content_w, avail_h / content_h)
    scaled_w = content_w * scale
    scaled_h = content_h * scale

    tx = (210 - scaled_w) / 2 - vb[0] * scale
    ty = 60 + (avail_h - scaled_h) / 2 - vb[1] * scale

    a4_svg = f'''<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="210mm" height="297mm" viewBox="0 0 210 297">
  <style>
    text {{ font-family: Arial, Helvetica, sans-serif; }}
  </style>
  <text x="105" y="35" text-anchor="middle" font-size="8" font-weight="bold">{fig_label}</text>
  <g transform="translate({tx},{ty}) scale({scale})">
{body}
  </g>
</svg>
'''
    output_path.write_text(a4_svg)
    print(f"Wrote {output_path.name}")


# Figure 1A: Series
TMP1A = OUTDIR / '_tmp_fig1a.svg'
with schemdraw.Drawing(file=str(TMP1A), show=False) as d:
    d += elm.SourceV().up().label('110')
    d += elm.Line().right().length(2)
    d += elm.Line().down().length(0.3)
    d += elm.Resistor().down().label('R')
    d += elm.LED().down().label('140').fill('white')
    d += elm.Line().down().length(0.3)
    d += elm.RBox(w=2.5, h=1.5).down().label('150')
    d += elm.Ground()
wrap_in_a4(TMP1A, 'Fig. 1A', OUTDIR / 'patent_fig1a.svg')


# Figure 1B: Parallel
TMP1B = OUTDIR / '_tmp_fig1b.svg'
with schemdraw.Drawing(file=str(TMP1B), show=False) as d:
    d += elm.SourceV().up().label('110')
    d += elm.Line().right().length(3)
    d += elm.Dot()
    d.push()
    d += elm.Resistor().down().label('R')
    d += elm.LED().down().label('140').fill('white')
    d += elm.Ground()
    d.pop()
    d += elm.Line().right().length(3)
    d += elm.RBox(w=2.5, h=1.5).down().label('150')
    d += elm.Ground()
wrap_in_a4(TMP1B, 'Fig. 1B', OUTDIR / 'patent_fig1b.svg')


# Cleanup tmp files
TMP1A.unlink(missing_ok=True)
TMP1B.unlink(missing_ok=True)

print("Done.")
