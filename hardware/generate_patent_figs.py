#!/usr/bin/env python3
"""
Generate professional patent drawings for the privacy LED interlock invention.
Output: clean SVGs in Italian, A4, ready for UIBM filing.
"""

import schemdraw
import schemdraw.elements as elm

# ============================================================
# FIGURE 1A: Series configuration
# ============================================================
with schemdraw.Drawing(file='/home/arthur/daemon/hardware/patent_fig1a_series.svg',
                      show=False) as d:
    d.config(unit=2.5, fontsize=14)

    # Power source
    B = d.add(elm.Battery().up().label('110'))
    d.add(elm.Line().right().length(1))
    d.add(elm.Line().down().length(0.5))
    # Resistor
    d.add(elm.Resistor().down().label('R'))
    # LED
    d.add(elm.LED().down().label('140').fill('white'))
    # Wire to sensor
    d.add(elm.Line().down().length(0.5))
    # Sensor (rectangle)
    M = d.add(elm.RBox(w=2.5, h=1.5).down().label('150'))
    # GND
    d.add(elm.Line().down().length(0.5))
    d.add(elm.Ground())

    # Power conductor label 130 (along right side)
    d.add(elm.Label().label('130', loc='right').at((B.end[0]+1.5, B.end[1]-1)))

print("Fig 1A done")

# ============================================================
# FIGURE 1B: Parallel configuration
# ============================================================
with schemdraw.Drawing(file='/home/arthur/daemon/hardware/patent_fig1b_parallel.svg',
                      show=False) as d:
    d.config(unit=2.5, fontsize=14)

    B = d.add(elm.Battery().up().label('110'))
    d.add(elm.Line().right().length(1))
    d.add(elm.Line().down().length(1))
    NODE = d.add(elm.Dot())

    # Left branch: indicator
    d.push()
    d.add(elm.Line().left().length(2))
    d.add(elm.Resistor().down().label('R'))
    d.add(elm.LED().down().label('140').fill('white'))
    d.add(elm.Line().down().length(0.5))
    d.add(elm.Ground())
    d.pop()

    # Right branch: sensor
    d.add(elm.Line().right().length(2))
    d.add(elm.RBox(w=2.5, h=1.5).down().label('150'))
    d.add(elm.Line().down().length(0.5))
    d.add(elm.Ground())

print("Fig 1B done")

# ============================================================
# FIGURE 3: System block diagram
# ============================================================
with schemdraw.Drawing(file='/home/arthur/daemon/hardware/patent_fig3.svg',
                      show=False) as d:
    d.config(unit=2.5, fontsize=14)

    # Outer device box
    DEVICE = d.add(elm.Rect(w=14, h=10).label('100', loc='top'))

    # Power supply
    PWR = d.add(elm.RBox(w=2.5, h=1.5).at((-5, 2.5)).label('110'))

    # Indicator
    IND = d.add(elm.RBox(w=2.5, h=1.5).at((-1, 2.5)).label('140'))

    # Sensor
    SEN = d.add(elm.RBox(w=2.5, h=1.5).at((3, 2.5)).label('150'))

    # Power line from PWR to IND to SEN
    d.add(elm.Line().at((-3.5, 3.25)).right().length(1.5))
    d.add(elm.Line().at((0.5, 3.25)).right().length(1.5))

    # Processor below
    PROC = d.add(elm.RBox(w=2.5, h=1.5).at((-5, -1)).label('160'))

    # Wireless module
    WL = d.add(elm.RBox(w=2.5, h=1.5).at((-1, -1)).label('170'))

    # Storage
    STO = d.add(elm.RBox(w=2.5, h=1.5).at((3, -1)).label('180'))

    # Data line from sensor to processor (dashed)
    d.add(elm.Line().at((4.25, 2.5)).down().length(2).linestyle('--'))
    d.add(elm.Line().left().length(8).linestyle('--'))
    d.add(elm.Line().up().length(0.75).linestyle('--'))

print("Fig 3 done")
