# Daemon V0 — Component Placement Guide

**Open `daemon_v0.kicad_pcb` in KiCad.** You'll see:
- **The board** (85.6 × 54mm outline) with the Radxa Zero 3W drawn underneath
- **55 key components** in a labeled grid to the RIGHT — drag them onto the board
- **109 passives** hidden BELOW the board — they'll follow their parent ICs later

---

## 🎯 The Game

Place components in this order. Each level unlocks the next.

### Level 1: The Skeleton (connectors)

These MUST go at board edges. Place them first — they define the shape.

| Component | What | Where | Why |
|-----------|------|-------|-----|
| **J12** | Radxa 40-pin header | Aligns with Radxa GPIO (see outline) | Mechanical — must mate with Radxa |
| **J8** | USB-C Goobay bridge | **B.Cu** (bottom layer!), under Radxa USB-C OTG | 8.85mm vertical pitch to mate |
| **J2** | USB-A Male (Stinger 1) | Board edge, plug facing out | User access |
| **J3** | USB-A Female (Stinger 2) | Same edge as J2 | User access |
| **J4** | USB-A Female (Stinger 3) | Same edge as J2 | User access |
| **J9** | RJ45 MagJack | Board edge, **≥15mm from J8** | Tall part (13.5mm), mechanical clearance |
| **J10** | WAGO terminal block | Board edge | Field wire access |
| **J13** | TRRS audio jack | Board edge | 3.5mm plug access |
| **J1** | Battery JST | Board edge | Cable access |
| **J14** | Speaker JST | Board edge | Cable access |
| **J5** | Screen 8-pin header | Board edge | Ribbon cable |
| **J6** | Joystick 5-pin header | Board edge | Ribbon cable |
| **J7** | Power header | Accessible | Debug |
| **J11** | Aux GPIO header | Accessible | Debug |
| **SW1** | Power button | Board edge | User-pressable |

**Check**: Do all connectors have their openings flush with or sticking out from the board edge?

---

### Level 2: The Power Plant

Place the power ICs. They're noisy — keep them in ONE corner, away from RF.

| Component | What | Rule |
|-----------|------|------|
| **U1** | IP5328P PMIC | Pick a corner. This is your "power corner" |
| **L1** | 4.7µH boost inductor | **Right next to U1** (< 5mm). BIGGEST component (12.5×11.5mm) |
| **TH1** | NTC thermistor | **Touching U1** (< 3mm from QFN pad). Temperature sensor |
| **C7** | 100µF tantalum | Near U1 VOUT, on 5V_SYS rail |
| **C12** | 100µF tantalum (SMD Case-D) | Near U3 (NE555). SMD — no height issue |
| **U2** | AP2112K 3.3V LDO | Between power corner and RF/Ethernet. ≥10mm from L1 |

**Check**: Is L1 ≥ 25mm from where you'll put the antenna? ≥ 15mm from where crystals will go?

---

### Level 3: The RF Island

Place in the **opposite corner** from power. This area needs to be quiet.

| Component | What | Rule |
|-----------|------|------|
| **AE1** | 915MHz chip antenna | **Board EDGE or CORNER**. 5mm keepout — no copper, no parts within 5mm on any layer |
| **U9** | CC1101 RF transceiver | Near antenna. **≥ 20mm from U1**, **≥ 25mm from L1** |
| **Y2** | 26MHz crystal | **< 5mm from U9**. Also **≥ 10mm from Y3** (25MHz) |

**Check**: Measure U1↔U9 distance. Is it ≥ 20mm? Measure L1↔AE1. Is it ≥ 25mm?

---

### Level 4: The USB Hub

Central position — it connects to everything.

| Component | What | Rule |
|-----------|------|------|
| **U4** | SL2.1A USB hub | Roughly central. Short paths to J8 (upstream) AND J2-J4 (downstream) |
| **Y1** | 12MHz crystal | **< 5mm from U4** |

**Check**: Can you draw short straight lines from U4 to J8, J2, J3, J4, and U10?

---

### Level 5: Ethernet

Between the USB hub and the RJ45 jack.

| Component | What | Rule |
|-----------|------|------|
| **U10** | RTL8152B Ethernet | **< 15mm from J9** (MagJack) AND **< 20mm from U4** (hub) |
| **Y3** | 25MHz crystal | **< 5mm from U10**. **≥ 10mm from Y2** (26MHz)! |

**Check**: Y2↔Y3 distance ≥ 10mm? U10 between U4 and J9?

---

### Level 6: Stinger Switches

Each switch goes next to its USB-A port.

| Component | What | Rule |
|-----------|------|------|
| **U5** | SY6280 switch #1 | **< 10mm from J2** |
| **U6** | SY6280 switch #2 | **< 10mm from J3** |
| **U7** | SY6280 switch #3 | **< 10mm from J4** |

---

### Level 7: Audio

Near the TRRS jack, away from RF.

| Component | What | Rule |
|-----------|------|------|
| **U12** | MAX98357A amplifier | **< 10mm from J13** (TRRS). **≥ 15mm from U9** (CC1101) |
| **U13** | INMP441 MEMS mic | Near U12. **≥ 10mm from L1**. Needs acoustic port hole in PCB! |

---

### Level 8: Industrial Isolation

Near the WAGO terminal block.

| Component | What | Rule |
|-----------|------|------|
| **U11** | ISO1212 | **< 15mm from J10** (WAGO). **2.5mm gap** between field-side and board-side copper |
| **D8, D9** | TVS diodes | Between J10 and U11, close to J10 |
| **F1, F2** | PTC fuses | Between J10 and D8/D9 |

---

### Level 9: The Fun Stuff

| Component | What | Rule |
|-----------|------|------|
| **D3-D6** | WS2812B LEDs ×4 | Daisy-chained. ≤ 30mm between each. Away from RF |
| **D7** | IR LED | Board EDGE, side-view emitter facing outward |
| **SW2** | SKRHABE010 nav switch | Thumb-reachable zone, near display |
| **U3** | NE555 heartbeat timer | Near power section. ≥ 15mm from U9 |
| **Q1-Q4** | Transistors | Near their connected ICs (Q1-Q3 near U1, Q4 near D7) |
| **TP1-TP4** | Test points | Accessible, near power section |

---

## 📏 Quick Reference: Separation Distances

| Thing A | Thing B | Min Distance | Why |
|---------|---------|:------------:|-----|
| U1 (PMIC) | U9 (CC1101) | **20mm** | Switching noise kills RF |
| L1 (inductor) | AE1 (antenna) | **25mm** | Magnetic field EMI |
| L1 (inductor) | U9 (CC1101) | **25mm** | Magnetic field EMI |
| L1 (inductor) | Any crystal | **15mm** | Magnetic field pulls frequency |
| Y2 (26MHz) | Y3 (25MHz) | **10mm** | 1MHz beat frequency |
| J9 (RJ45) | J8 (USB-C) | **15mm** | Mechanical collision |
| J9 (RJ45) | AE1 (antenna) | **20mm** | Transformer coupling |
| U12 (amp) | U9 (CC1101) | **15mm** | Class-D EMI |
| AE1 (antenna) | Any copper/part | **5mm** | Antenna detuning |
| ISO1212 field↔board | — | **2.5mm** | Isolation creepage |

---

## 🗺️ Board Zones (Looking Down)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ NORTH STRIP (12mm) — tall parts OK, edge connectors                        │ Y=54
│                                                                             │
│   ┌─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┐ │
│   :                    RADXA ZONE (no tall B.Cu parts)                  : │
│   :  [MH]───── 40-pin GPIO header ─────[MH]                           : │ Y≈37-40
│   :                                                                     : │
│   :  [MH]                                                    [MH]      : │
│   :  USB-C OTG  USB-C Host                  µHDMI                     : │
│   └─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┘ │
│                                                                             │
│ SOUTH STRIP (12mm) — tall parts OK, edge connectors                        │ Y=0
└─────────────────────────────────────────────────────────────────────────────┘
X=0  WEST(10mm)                                              EAST(10mm)  X=85.6
```

Edge strips (outside Radxa footprint) are where tall connectors go:
- **North** (Y: 42-54mm): USB-A ports, RJ45, headers
- **South** (Y: 0-12mm): Battery, WAGO, TRRS, IR LED
- **West** (X: 0-10mm): Antenna corner? Joystick header?
- **East** (X: 75-85.6mm): USB-A ports?

---

## ✅ Final Checks Before Routing

- [ ] All connectors flush with board edges
- [ ] J12 (40-pin) aligns with Radxa GPIO outline
- [ ] J8 (USB-C Goobay) on B.Cu, aligned with Radxa USB-C
- [ ] U1+L1 in one corner, AE1+U9 in the opposite corner
- [ ] All "< 5mm" rules met (crystals to their ICs)
- [ ] All "≥ 10/15/20/25mm" separation rules met
- [ ] No tall parts on B.Cu inside Radxa zone
- [ ] AE1 antenna at board edge with 5mm keepout clear
- [ ] C12 (electrolytic, ~8mm tall) not under Radxa
- [ ] Each SY6280 near its USB-A port

---

*Detailed constraints: see `docs/PLACEMENT_CONSTRAINTS.md`*
*Radxa reference: see `docs/RADXA_REFERENCE.md`*
