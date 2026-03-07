# Daemon V0 -- PCB Placement Constraints Analysis

**Board:** 85.6 x 54 mm (credit-card form factor), 4-layer FR4 (JLC04161H-3313 stackup)
**Stacking:** Mounts beneath a Radxa Zero 3W SBC via 40-pin right-angle header
**Source authority:** `netlist/full_system.py`, `netlist/audio_subsystem.py`, `layout/configure_constraints.py`, `ARCHITECTURE.md`, `BOM.md`
**ECO revision:** #2026-03-GOLD

---

## Table of Contents

1. [Board Orientation and Reference Frame](#1-board-orientation-and-reference-frame)
2. [Category A -- Fixed Position Components](#2-category-a----fixed-position-components)
3. [Category B -- Constrained Position Components](#3-category-b----constrained-position-components)
4. [Category C -- Secondary Components](#4-category-c----secondary-components)
5. [Inter-Component Relationship Map](#5-inter-component-relationship-map)
6. [Layer Assignment Summary](#6-layer-assignment-summary)
7. [Critical Separation Rules Summary Table](#7-critical-separation-rules-summary-table)

---

## 1. Board Orientation and Reference Frame

The board is oriented with the Radxa SBC stacked on top. The 40-pin header runs along one long edge. Connectors that face outward (USB-A, RJ45, WAGO, TRRS, battery) are placed at board edges. The Goobay USB-C bridge sits on B.Cu (bottom layer) directly under the Radxa's USB-C port.

Assumed edge assignments (to be finalized during floorplanning):
- **North edge (long, 85.6 mm):** 40-pin Radxa header (must span full length)
- **East edge (short, 54 mm):** RJ45 MagJack, WAGO terminal block
- **South edge (long, 85.6 mm):** 3x USB-A Stinger ports
- **West edge (short, 54 mm):** TRRS audio jack, battery connector, IR LED

---

## 2. Category A -- Fixed Position Components

These components MUST be placed at specific physical locations. There is no flexibility.

### A-1. J_RADXA -- 40-Pin Expansion Header (2x20, 2.54 mm right-angle)

- **Footprint:** `PinHeader_2x20_P2.54mm_Vertical` (right-angle variant)
- **Constraint:** Must align with the Radxa Zero 3W 40-pin header. The Radxa board dimensions define the exact X/Y position. Header runs along one long edge of the PCB.
- **Layer:** F.Cu (top)
- **Mechanical:** Right-angle header pins mate vertically with the Radxa sitting on top. Pin 1 location must match the Radxa pin 1 position exactly.

### A-2. USB_C -- Goobay 74446 USB-C Bridge

- **Footprint:** `USB_C_Receptacle_HRO_TYPE-C-31-M-12`
- **Constraint:** MUST be placed on **B.Cu (bottom layer)** directly beneath the Radxa Zero 3W's USB-C port, with **8.85 mm vertical pitch** to mate with the Radxa connector. Misplacement by even 1 mm will prevent the U-shaped bridge from engaging.
- **Layer:** B.Cu exclusively
- **Reference:** ARCHITECTURE.md Note N-3; `FP_USB_C_RCPT` in full_system.py

### A-3. USB_A1--USB_A3 -- Stinger Port USB-A Receptacles (x3)

- **Footprint:** `USB_A_Molex_67643_Horizontal`
- **Constraint:** Must be placed at a board edge with the receptacle opening flush with or protruding from the PCB edge to accept USB-A plugs. All three should be along the same edge for a clean user-facing layout.
- **Layer:** F.Cu (through-hole)
- **Spacing:** Each USB-A receptacle is approximately 14 mm wide. Three side-by-side require ~42 mm minimum plus clearance -- fits along the 85.6 mm south edge with room to spare.

### A-4. RJ45 -- HanRun HR911105A MagJack

- **Footprint:** `RJ45_Hanrun_HR911105A_Horizontal` (through-hole)
- **Constraint:** Must be at a board edge with the RJ45 socket opening flush with the edge. Has significant Z-height (~13.5 mm above PCB).
- **Layer:** F.Cu (through-hole)
- **Mechanical clearance:** Must be placed **>15 mm away from the Goobay USB-C bridge** to prevent Z-axis collision with the Radxa SBC stack (Advisory A-4, ECO #2026-03-A).

### A-5. J_FIELD -- WAGO 2060-404 Terminal Block (4-position)

- **Footprint:** `TerminalBlock_WAGO_2060-404_1x04_P4.00mm_Horizontal`
- **Constraint:** Must be at a board edge for field-wire access. Push-in terminals require access from above or from the edge.
- **Layer:** F.Cu (through-hole/SMD hybrid)

### A-6. J_TRRS -- 3.5 mm TRRS Audio Jack (SJ2-2531X-SMT)

- **Footprint:** `Jack_3.5mm_SJ2-2531X-SMT` (SMD)
- **Constraint:** Must be at a board edge with the 3.5 mm barrel protruding for plug insertion.
- **Layer:** F.Cu

### A-7. J_BAT -- JST-PH 2-Pin Battery Connector

- **Footprint:** `JST_PH_S2B-PH-K_1x02_P2.00mm_Horizontal`
- **Constraint:** Must be at a board edge or accessible location for battery cable insertion/removal.
- **Layer:** F.Cu

### A-8. D_IR -- VSMB294008 Side-View IR LED

- **Footprint:** `LED_0603_1608Metric` (side-view emission)
- **Constraint:** Must be at a PCB edge with the side-view emitter facing outward for forward IR emission. The "west" or "south" edge is typical.
- **Layer:** F.Cu

### A-9. ANT -- Johanson 0915AT43A0026 Chip Antenna (915 MHz)

- **Footprint:** `Antenna_Chip_Johanson_0915AT43A0026` (0402-size)
- **Constraint:** Must be at a board edge or corner. See Category B for detailed clearance requirements.
- **Layer:** F.Cu

### A-10. SW_PWR -- Tactile Power Button (6 mm)

- **Footprint:** `SW_SPST_PTS645` (6x6 mm SMD)
- **Constraint:** Must be user-accessible -- at a board edge or on the top surface where it can be pressed through an enclosure opening.
- **Layer:** F.Cu

### A-11. J_SCREEN -- 8-Pin Display Connector

- **Footprint:** `PinHeader_1x08_P2.54mm_Vertical`
- **Constraint:** Must be accessible for ribbon cable connection to the external ST7789V2 display module. Typically at a board edge.
- **Layer:** F.Cu

### A-12. J_JOY -- 5-Pin Joystick Connector

- **Footprint:** `PinHeader_1x05_P2.54mm_Vertical`
- **Constraint:** Must be accessible for ribbon cable to external joystick module.
- **Layer:** F.Cu

### A-13. J_SPK -- JST-SH 2-Pin Speaker Connector

- **Footprint:** `JST_SH_SM02B-SRSS-TB_1x02-1MP_P1.00mm_Horizontal`
- **Constraint:** Edge-accessible for speaker wire harness.
- **Layer:** F.Cu

### A-14. HDR_PWR -- 3-Pin Power Management Header

- **Footprint:** `PinHeader_1x03_P2.54mm_Vertical`
- **Constraint:** Accessible for debug/development wiring.
- **Layer:** F.Cu

### A-15. J_AUX -- 4-Pin Auxiliary GPIO Header

- **Footprint:** `PinHeader_1x04_P2.54mm_Vertical`
- **Constraint:** Accessible for external wiring (ISO outputs, IR).
- **Layer:** F.Cu

---

## 3. Category B -- Constrained Position Components

These components have electrical, thermal, or signal-integrity constraints that dictate WHERE they can be placed relative to other components. Exact board coordinates are flexible, but the constraints below MUST be respected.

---

### B-1. U1 -- IP5328P Power Management IC (QFN-40, 6x6 mm)

**Why placement matters:** This is a high-current (3A continuous) switching boost converter operating at 375-500 kHz. It is the single largest source of conducted and radiated EMI on the board. Its thermal dissipation at full load requires careful thermal management.

**Constraints:**

1. **Thermal vias:** The QFN-40 exposed pad requires **at least 16 thermal vias** (0.3 mm drill, 0.6 mm pad) connecting the exposed pad to an inner ground plane. This keeps Tj < 85 C at 2.4A continuous. Place on a region of the board with maximum ground-plane copper underneath.

2. **Keep away from RF:** Place the IP5328P as far as possible from the CC1101 RF transceiver (U_RF) and the chip antenna (ANT). **Minimum separation: 20 mm** from the CC1101, ideally on the opposite side of the board. The 375 kHz switching frequency and its harmonics (750 kHz, 1.125 MHz, etc.) will couple into the CC1101 receiver if placed nearby.

3. **Keep away from audio:** The BTL audio amplifier (MAX98357A) is powered from 5V_SYS. Switching noise on the supply couples through the amplifier output. Place IP5328P at least **15 mm from U_AMP** to reduce direct magnetic coupling from the boost inductor.

4. **Keep close to:** L1 boost inductor (adjacent, <5 mm trace from SW pin), J_BAT battery connector (short high-current path), input/output bulk capacitors.

5. **High-current loop:** The SW node (pin) to L1 to VOUT loop carries the full switching current. This loop must be as small as possible -- L1 should be immediately adjacent to the IP5328P with trace width >= 1 mm (preferably a copper pour).

6. **NTC thermistor (R_NTC, 10k 0402):** Must be placed **on the exposed pad copper** or within 3 mm of the QFN-40 package body to accurately sense junction temperature. Placing it far away defeats the thermal protection function.

---

### B-2. L1 -- 4.7 uH Boost Inductor (TDK VLF12560T-4R7M7R9, 12.5x11.5 mm)

**Why placement matters:** This is the largest single component on the board (12.5 x 11.5 mm footprint). It carries the full boost converter switching current (peak 4.9A) and is a significant source of radiated EMI from its magnetic field.

**Constraints:**

1. **Adjacent to IP5328P:** Must be within 5 mm of the IP5328P SW pin. The trace between them carries high-frequency, high-current switching pulses. Long traces increase parasitic inductance and ringing.

2. **Keep away from RF/antenna:** Minimum **25 mm from the chip antenna** and **20 mm from the CC1101**. The inductor's fringing magnetic field is the strongest EMI source on the board.

3. **Keep away from crystals:** At least **15 mm from all three crystals** (12 MHz, 25 MHz, 26 MHz). Magnetic coupling from the inductor can injection-lock or frequency-modulate crystal oscillators.

4. **Orientation:** Orient the inductor so its magnetic axis does not point toward the CC1101 or any crystal. If the inductor is a shielded drum type, this is less critical but still recommended.

5. **Ground plane:** Ensure a continuous ground plane on the layer immediately below the inductor (no splits or slots under the footprint).

---

### B-3. C_TANT -- 100 uF Tantalum Power Tank (Case-B, 3.5x2.8 mm)

**Why placement matters:** This capacitor absorbs 4A transients that occur faster than the boost converter can respond. It must be on the 5V_SYS rail as close as possible to the load.

**Constraints:**

1. **On the VOUT_ISO / 5V_SYS net:** Place within **10 mm of the J2 isolation jumper** output (the point where VOUT becomes 5V_SYS).
2. **Polarity:** This is a polarized tantalum capacitor. Mark polarity clearly in silkscreen.
3. **Keep close to high-current branch point:** Where 5V_SYS fans out to the SY6280 Stinger switches, the SL2.1A hub, and the Radxa header 5V pins.

---

### B-4. U_LDO -- AP2112K-3.3 Clean LDO (SOT-23-5)

**Why placement matters:** This LDO provides isolated, low-noise 3.3V to the CC1101 RF transceiver and RTL8152B Ethernet. Noise on this rail directly degrades RF receiver sensitivity.

**Constraints:**

1. **Place between IP5328P and the RF/Ethernet section** of the board. It should be close to U_RF (CC1101) and U_ETH (RTL8152B) -- within **15 mm of both**.
2. **Input caps (C_LDO_IN_BULK 10uF, C_LDO_IN_BYP 100nF):** Within 3 mm of the VIN pin.
3. **Output caps (C_LDO_OUT_BULK 10uF, C_LDO_OUT_BYP 100nF):** Within 3 mm of the VOUT pin.
4. **Keep away from the boost inductor L1:** At least **10 mm separation** to prevent switching noise from coupling into the LDO input before filtering.

---

### B-5. U_RF -- CC1101 Sub-GHz RF Transceiver (QFN-20, 4x4 mm)

**Why placement matters:** This is a 915 MHz RF transceiver with a receiver sensitivity of approximately -110 dBm. Any noise source within a few centimeters can raise the noise floor and degrade range. The CC1101 datasheet specifies strict layout requirements for the RF front-end.

**Constraints:**

1. **Board corner or edge placement:** Place the CC1101 in a corner of the PCB, near the chip antenna, isolated from all other subsystems. The RF section (CC1101 + Pi-network + antenna) should occupy its own "island" of board real estate.

2. **Distance from switching regulators:**
   - IP5328P: **>= 20 mm**
   - Boost inductor L1: **>= 25 mm**
   - Any other switching converter noise source: >= 15 mm

3. **Distance from crystals (heterodyne constraint):**
   - XTAL_ETH (25 MHz, RTL8152B): **>= 10 mm** from XTAL_RF (26 MHz). The 1 MHz beat frequency can couple into the RF front-end and degrade receiver sensitivity. Surround each crystal with ground-via stitching at 2-3 mm pitch. (Advisory A-5, ECO #2026-03-A)
   - XTAL_HUB (12 MHz, SL2.1A): >= 8 mm from XTAL_RF

4. **Ground plane:** MANDATORY continuous ground plane on Layer 2 (first inner layer) under the entire CC1101 + Pi-network + antenna area. **No traces, no splits, no vias** in this ground island except dedicated ground-stitching vias around the perimeter.

5. **Pi-network matching components (C_RF1 0.5pF, L_RF1 10nH, C_RF2 4.7pF):** Must be placed immediately adjacent to the CC1101 RF_P pin and the antenna feedpoint, with the shortest possible traces. These are 0402 components operating at 915 MHz -- every 0.1 mm of extra trace length changes the impedance match.
   - C_RF1 (0.5pF shunt): Within **1 mm** of RF_P pin
   - L_RF1 (10nH series): Between C_RF1 and C_RF2, in-line
   - C_RF2 (4.7pF shunt): Within **1 mm** of the antenna feedpoint

6. **C_RFN (1pF):** Must be within **1 mm** of the CC1101 RF_N pin. This terminates the unused differential output to ground.

7. **R_RBIAS_RF (10k):** Within 3 mm of the CC1101 RBIAS pin.

8. **VDD bypass caps (C_VDD_RF_A/B/C, 100nF x3):** Place as close as possible to the CC1101 VDD pins -- within **2 mm**. Use multiple vias to ground plane for each cap.

---

### B-6. ANT -- Johanson 0915AT43A0026 Chip Antenna (915 MHz, 0402)

**Why placement matters:** The chip antenna requires a specific ground-plane clearance zone to radiate efficiently. Violating the keep-out zone dramatically reduces antenna gain and shifts the resonant frequency.

**Constraints:**

1. **Board edge or corner:** The antenna MUST be at the PCB edge. The Johanson 0915AT43A0026 datasheet specifies the antenna element extends to the board edge with no ground plane under or adjacent to the antenna for a distance defined by the application note.

2. **Ground-plane keep-out:** No copper (ground or signal) within **5 mm** on all sides of the antenna element on any layer, EXCEPT the feedpoint trace. This is non-negotiable -- copper in this zone detunes the antenna.

3. **No components in keep-out zone:** No components of any type within 5 mm of the antenna on any layer.

4. **Feedpoint trace:** 50-ohm microstrip from the Pi-network output (C_RF2) to the antenna pad. Keep this trace as short as possible (ideally <3 mm). Trace width for 50-ohm microstrip on JLC04161H-3313: approximately 0.30 mm on the outer layer.

5. **Distance from MagJack:** The RJ45 MagJack has internal magnetics that can couple at sub-GHz frequencies. Keep the antenna **>= 20 mm from the MagJack**.

---

### B-7. XTAL_RF -- 26 MHz Crystal (CC1101 reference, 3225 package)

**Why placement matters:** This is the CC1101's PLL reference. Phase noise on this crystal directly degrades RF performance. It also has a 1 MHz beat frequency risk with the 25 MHz Ethernet crystal.

**Constraints:**

1. **Within 5 mm of CC1101 XI/XO pins.** Crystal traces should be as short as possible and surrounded by ground.
2. **>= 10 mm from XTAL_ETH** (25 MHz RTL8152B crystal) to prevent heterodyne coupling.
3. **>= 15 mm from L1** (boost inductor) to prevent magnetic field injection into the crystal.
4. **Crystal load caps (C_XTAL_RF_A/B, 22pF):** Within **2 mm** of the crystal pads, with short ground vias.
5. **Ground-via stitching:** Ring of ground vias around the crystal at 2-3 mm pitch to contain radiation.

---

### B-8. U_ETH -- RTL8152B USB-Ethernet (QFN-32, 5x5 mm)

**Why placement matters:** The RTL8152B drives 100Base-TX differential pairs to the MagJack and receives USB 2.0 high-speed differential pairs from the hub. Both are impedance-controlled signals. The chip also generates 25 MHz oscillator harmonics.

**Constraints:**

1. **Between the SL2.1A hub and the RJ45 MagJack:** Place U_ETH on the routing path between the hub's port 4 D+/D- and the MagJack's MDI pins. This minimizes differential pair trace length for both USB and Ethernet.
2. **Ethernet differential pairs (ETH_MDI_TXP/TXN, ETH_MDI_RXP/RXN):** 100-ohm differential impedance. Place U_ETH within **15 mm of the MagJack** to keep MDI traces short.
3. **USB differential pairs (USB_DN_DP_4/USB_DN_DM_4):** 90-ohm differential impedance. Place U_ETH within **20 mm of the SL2.1A hub**.
4. **Crystal (XTAL_ETH, 25 MHz):** Within **5 mm** of the RTL8152B XI/XO pins.
5. **Ground plane:** Continuous ground on Layer 2 under the RTL8152B and all its differential pairs. No splits or signal traces crossing under differential pairs.
6. **Power (3V3_CLEAN):** Short, wide traces from the AP2112K-3.3 LDO output. Bypass caps within 2 mm of VDD pins.

---

### B-9. XTAL_ETH -- 25 MHz Crystal (RTL8152B reference, 3225 package)

**Constraints:**

1. **Within 5 mm of RTL8152B XI/XO pins.**
2. **>= 10 mm from XTAL_RF** (26 MHz) -- critical heterodyne separation rule (Advisory A-5).
3. **>= 15 mm from L1** (boost inductor).
4. **Crystal load caps (C_XTAL_ETH_A/B, 22pF):** Within 2 mm of crystal pads.
5. **Ground-via stitching** around crystal perimeter.

---

### B-10. U_HUB -- SL2.1A USB 2.0 Hub Controller (QFN-28, 5x5 mm)

**Why placement matters:** This IC handles all USB 2.0 high-speed (480 Mbps) signaling. Upstream D+/D- pair comes from the Goobay USB-C bridge; four downstream pairs fan out to three Stinger ports and the RTL8152B. All USB pairs require 90-ohm differential impedance control.

**Constraints:**

1. **Central to USB topology:** Place U_HUB roughly equidistant from the Goobay USB-C bridge (upstream) and the three USB-A Stinger connectors + RTL8152B (downstream). This balances trace lengths.
2. **Upstream USB pair (USB_UP_DP/DM):** From Goobay bridge to SL2.1A. Intra-pair skew <= 100 ps (14.81 mm length delta max). Keep traces matched and short.
3. **Downstream USB pairs:** Fan out from hub to USB-A connectors and RTL8152B. Each pair must maintain 90-ohm impedance (0.15 mm trace, 0.15 mm gap on JLC04161H-3313).
4. **Crystal (XTAL_HUB, 12 MHz):** Within **5 mm** of XI/XO pins. Load caps (22pF) within 2 mm.
5. **RBIAS resistor (12k):** Within **3 mm** of RBIAS pin. Stray capacitance on this node affects USB signaling bias current.
6. **Bypass caps (C_VDD_BULK 10uF, C_VDD_BYP_A/B 100nF x2):** Within 2 mm of VDD33 pins.

---

### B-11. RJ45 MagJack -- HR911105A (through-hole)

**Why placement matters:** Large through-hole component with significant Z-height. Contains isolation transformers. Ethernet differential pairs must maintain impedance from RTL8152B to the MagJack pins.

**Constraints:**

1. **Board edge:** Jack opening must be flush with or protruding from the PCB edge.
2. **>= 15 mm from Goobay USB-C bridge** to prevent Z-axis collision (Advisory A-4).
3. **>= 20 mm from chip antenna** to prevent magnetic coupling from internal transformers.
4. **Close to RTL8152B:** Within 15 mm for short 100-ohm differential pair traces.
5. **Through-hole pins:** Will consume space on both F.Cu and B.Cu. Plan via-free zones around the through-hole pins.

---

### B-12. U_AMP -- MAX98357A I2S Class-D Amplifier (TQFN-16, 3x3 mm)

**Why placement matters:** Class-D amplifier with internal switching at ~300 kHz. The BTL output drives speaker current through external wiring which can act as an antenna. EMI from the switching output and the IP5328P supply coupling are both concerns.

**Constraints:**

1. **Near the TRRS jack and speaker connector:** Keep BTL output traces (AMP_OUT_P/N) short to minimize antenna effect. Place within **10 mm of J_TRRS**.
2. **EMI filter components (FB_P, FB_N ferrite beads + C_FILT_P/N 1nF caps):** Must be in-line between the amplifier outputs and the TRRS jack. Place ferrite beads within 5 mm of the amp outputs; place filter caps within 2 mm of the ferrite bead output pads.
3. **TVS diodes (D_TVS_P, D_TVS_N, ESD9B5.0ST5G):** Place on the AMP_OUT_P/N nets (amplifier side of the ferrite beads), within 3 mm of the amp output pins.
4. **Keep away from CC1101:** >= **15 mm from U_RF**. Speaker cable EMI at 300 kHz and harmonics can couple into the RF front-end.
5. **I2S bus traces (BCLK, LRCLK, DATA_OUT):** These are ~1-3 MHz digital signals. Route away from the RF section.
6. **Bypass caps (C_AMP_BYP_A/B, 100nF x2):** Within 2 mm of VDD pins.

---

### B-13. U_MIC -- INMP441 MEMS Microphone (LGA-6, bottom-port)

**Why placement matters:** Bottom-port MEMS microphone requires an acoustic port hole in the PCB. Placement determines audio pickup direction and noise susceptibility.

**Constraints:**

1. **Acoustic port:** The PCB must have a **drill hole (typically 1 mm diameter)** directly under the INMP441 sound port. This hole must be unobstructed on the bottom of the board.
2. **Keep away from switching noise sources:** >= **10 mm from IP5328P and L1**. Mechanical vibration from the inductor's magnetostriction can couple into the MEMS element.
3. **Keep away from the speaker output path** to minimize acoustic feedback.
4. **Near the TRRS jack / audio section** for short I2S bus traces shared with U_AMP.
5. **Bypass caps (C_MIC_BYP_A/B, 100nF x2):** Within 2 mm of VDD pin.

---

### B-14. U_ISO -- ISO1212 Isolated Digital Input (SOIC-16W, 7.5x10.3 mm)

**Why placement matters:** This IC provides galvanic isolation (>= 2.5 kV) between field-side and board-side. The isolation barrier integrity depends on PCB layout -- creepage and clearance distances must be maintained.

**Constraints:**

1. **Near the WAGO terminal block (J_FIELD):** Place within **15 mm** to keep field-side high-voltage traces short.
2. **Isolation gap:** Maintain a **minimum 2.5 mm clearance** (no copper on any layer) between field-side nets (ISO_GND1, ISO_VCC1, ISO_IN1_RAW, ISO_IN2_RAW) and board-side nets (GND, 3V3_CLEAN). This includes a routed slot in the PCB under the IC package if the SOIC-16W straddles the isolation boundary.
3. **Protection chain components (F_PTC1/2, D_TVS1/2, R_SER1/2, R_THR1/2, C_FLT1/2):** Place between J_FIELD and U_ISO, all on the field side of the isolation gap. Keep these components within **10 mm of the WAGO connector**.
4. **TVS diodes (VCAN26A2, DO-214AA/SMB):** These are relatively large (4.6 x 3.6 mm). Place immediately after the PTC fuses, as close to the connector as possible for best surge protection.
5. **Field-side ground pour:** Use a dedicated ISO_GND1 copper pour on the field side of the isolation gap. Do NOT connect to system GND.

---

### B-15. U_SW1--U_SW3 -- SY6280AAC Stinger Power Switches (SOT-23-5, x3)

**Why placement matters:** These switches carry up to 500 mA each from 5V_SYS to the USB-A connectors. Short, wide power traces reduce voltage drop.

**Constraints:**

1. **Adjacent to their respective USB-A connectors:** Each U_SW should be within **10 mm of its USB-A port**. The SY6280 OUT to USB-A VBUS trace carries the full port current.
2. **Close to 5V_SYS distribution:** The SY6280 IN pins connect to 5V_SYS. Route these as wide traces (>= 0.5 mm) from the main 5V_SYS bus.
3. **ISET resistors (R_ISET1-3, 13k 0402):** Within 3 mm of each SY6280 ISET pin. Stray capacitance on this node affects current-limit accuracy.
4. **Input/output bulk caps (10uF 0805 each):** Within 5 mm of the SY6280 IN and OUT pins respectively.

---

### B-16. NE555 Heartbeat Circuit (DIP-8 + BC857 SOT-23)

**Why placement matters:** DIP-8 is a large through-hole package. The circuit pulses 61 mA through a load resistor, creating a current spike on 5V_SYS.

**Constraints:**

1. **Away from RF and audio:** >= **15 mm from CC1101** and >= 10 mm from MAX98357A. The 61 mA current pulse creates a transient on 5V_SYS.
2. **Near IP5328P output:** The dummy load needs a short path to 5V_SYS and GND to function as intended.
3. **Electrolytic capacitor (C_TMR, 100uF, 6 mm radial):** This is a through-hole component with significant Z-height (~8 mm). Verify it does not collide with the Radxa SBC above. Place in a region with adequate vertical clearance.

---

### B-17. USB Differential Pairs -- Routing Implications on Placement

The USB 2.0 high-speed differential pairs impose placement constraints on the components they connect:

**Net class DIFF_USB_90:**
- Trace width: 0.15 mm, gap: 0.15 mm (90-ohm Zdiff on JLC04161H-3313)
- Max intra-pair skew: 100 ps (14.81 mm length delta)
- Clearance to adjacent nets: 0.15 mm minimum

**Pairs that must be routed:**
1. USB_UP_DP/DM: Goobay bridge to SL2.1A (upstream) -- keep short, ideally < 30 mm
2. USB_DN_DP_1/DM_1 through _3: SL2.1A to USB-A ports -- can be longer but must maintain impedance
3. USB_DN_DP_4/DM_4: SL2.1A to RTL8152B -- keep short, < 20 mm ideally

**Placement implication:** The SL2.1A hub should be roughly central to all its downstream connections. Placing it too far from any downstream port increases trace length and routing complexity for controlled-impedance pairs.

**Net class DIFF_ETH_100:**
- Trace width: 0.15 mm, gap: 0.20 mm (100-ohm Zdiff)
- ETH_MDI_TXP/TXN and ETH_MDI_RXP/RXN: RTL8152B to MagJack

**Placement implication:** RTL8152B must be adjacent to MagJack.

---

### B-18. WS2812B RGB LEDs (x4, PLCC4 5x5 mm each)

**Why placement matters:** These LEDs are daisy-chained with a single-wire protocol at 800 kbit/s. The signal integrity degrades with long inter-LED traces. They also draw up to 60 mA each (240 mA total) from 5V_SYS.

**Constraints:**

1. **Daisy-chain order:** LED1 DIN from the Radxa header (pin 36), LED1 DOUT to LED2 DIN, etc. Place LEDs in a line or arc with **<= 30 mm between consecutive LEDs** for reliable data transmission.
2. **Keep data traces away from RF section:** WS2812B data is a 800 kHz signal with fast edges. Route data chain away from CC1101 area.
3. **R_DIN_PU (1k pull-up to 5V_SYS):** Within 5 mm of LED1 DIN pad.
4. **Per-LED bypass caps (C_LED1-4, 100nF 0402):** Within **3 mm** of each LED VDD pin. WS2812B draws current in sharp pulses -- the bypass cap prevents supply dips from corrupting data in neighboring LEDs.

---

### B-19. Power UX Circuit (BSS84 + 2N7002 + SW_PWR)

**Constraints:**

1. **Q_WAKE (BSS84 PMOS) and Q_KILL (2N7002 NMOS):** Place within **10 mm of the IP5328P KEY pin** to keep the PMIC_KEY net short and low-impedance.
2. **R_GATE (100k pull-down):** Within 3 mm of BSS84 gate pin.
3. **SW_PWR button:** At board edge (Category A constraint already covers this).
4. **HDR_PWR header:** Accessible but can be away from the power section.

---

### B-20. Charging MUX -- OR-Diode Circuit (Subsystem A3)

**Constraints:**

1. **D_VBUS_A and D_VBUS_C (SS14 Schottky, DO-214AC/SMA):** These carry charging current (up to 1A+). Place between the USB-C bridge / external USB-A input and the IP5328P VIN pin.
2. **Short, wide traces:** Schottky diode anode-to-cathode paths carry high current. Use >= 0.5 mm traces.
3. **R_MUX_SER (430k) and R_MUX_SHN (620k):** Near the diode junction, within 5 mm.

---

## 4. Category C -- Secondary Components

These components should be placed near their parent IC but exact position is flexible. General rule: **bypass caps within 3 mm of the power pin they decouple; pull-up/pull-down resistors within 5 mm of the signal pin they bias.**

### IP5328P neighborhood
- C_IN_BULK (10uF 0805), C_IN_BYP (100nF 0402) -- near VIN pin
- C_BAT_BULK (10uF 0805), C_BAT_BYP (100nF 0402) -- near BAT pin
- C_OUT_BULK (22uF 0805), C_OUT_BYP (100nF 0402) -- near VOUT pin
- R_MFB (100k) -- near MFB pin
- R_I2C_SDA, R_I2C_SCL (470 ohm) -- between header and IC, on the I2C path
- J1, J2 (0-ohm 1225 jumpers) -- in series on BAT and VOUT paths
- TP_VIN, TP_BAT, TP_SW, TP_VOUT -- near their respective nets, accessible for probing

### AP2112K-3.3 LDO neighborhood
- C_LDO_IN_BULK (10uF), C_LDO_IN_BYP (100nF) -- near VIN pin
- C_LDO_OUT_BULK (10uF), C_LDO_OUT_BYP (100nF) -- near VOUT pin

### SL2.1A Hub neighborhood
- C_VDD_BULK (10uF), C_VDD_BYP_A/B (100nF x2) -- near VDD33 pins
- R_RST (10k), R_CFG0/1/2 (10k x3) -- near respective pins
- R_OC1-3 (10k x3) -- near OC_N pins

### RTL8152B neighborhood
- C_VDD_ETH_A/B (100nF x2), C_VDD_ETH_BULK (10uF) -- near VDD pins
- R_PSELF (0 ohm), R_XTALDET (0 ohm) -- near strap pins
- C_XTAL_ETH_A/B (22pF) -- near crystal pads

### CC1101 neighborhood
- C_VDD_RF_A/B/C (100nF x3) -- near VDD pins, multiple locations
- C_XTAL_RF_A/B (22pF) -- near crystal pads
- R_RBIAS_RF (10k) -- near RBIAS pin

### SY6280 x3 neighborhoods (each identical)
- C_SW_IN_BULK (10uF), C_SW_IN_BYP (100nF) -- near IN pin
- C_SW_OUT_BULK (10uF), C_SW_OUT_BYP (100nF) -- near OUT pin
- R_EN (10k) -- near EN pin
- R_FLAG (10k) -- near FLAG pin
- R_ISET (13k) -- near ISET pin

### MAX98357A neighborhood
- C_AMP_BYP_A/B (100nF x2) -- near VDD pins
- R_SD_MODE (633k) -- near SD_MODE pin
- D_TVS_P, D_TVS_N (ESD9B5.0ST5G) -- near OUTP/OUTN pins
- FB_P, FB_N (BLM18AG601SN1) -- in-line on output path
- C_FILT_P, C_FILT_N (1nF) -- after ferrite beads

### INMP441 neighborhood
- C_MIC_BYP_A/B (100nF x2) -- near VDD pin
- R_MIC_LR (10k) -- near L/R pin

### Audio jack neighborhood
- R_DET_DEBOUNCE (10k), C_DET_DEBOUNCE (100nF) -- near detect pin

### NE555 neighborhood
- R1_TMR (220k), R2_TMR (150 ohm) -- near timer pins
- C_TMR (100uF electrolytic) -- near threshold/trigger
- C_BYP_555 (10nF) -- near pin 5 (CV)
- R_BASE (10k) -- between 555 output and BC857 base
- R_DUMMY (82 ohm) -- BC857 collector to GND

### ISO1212 neighborhood
- F_PTC1/2 (60R PTC 1206) -- between connector and TVS
- D_TVS1/2 (VCAN26A2 SMB) -- after PTC, shunt to ISO_GND1
- R_SER1/2 (562 ohm), R_THR1/2 (1k) -- in signal path to IC
- C_FLT1/2 (10nF 100V) -- at IC input pins
- C_VCC1_BULK (10uF), C_VCC1_BYP (100nF) -- field-side VCC
- C_VCC2_BYP (100nF) -- logic-side VCC

### WS2812B neighborhoods (x4)
- C_LED1-4 (100nF 0402) -- within 3 mm of each LED VDD pin

### IR Blaster neighborhood
- Q_IR (AO3400A SOT-23) -- near D_IR (IR LED)
- R_IR (33 ohm) -- in series between 5V_SYS and LED anode

### Joystick/ADC neighborhood
- U_ADC (ADS1015 VSSOP-10) -- near J_JOY connector
- C_ADC_BYP (100nF), C_JOY_BYP (100nF) -- near respective VDD pins
- R_SW_PU (10k) -- near JOY_SW net

---

## 5. Inter-Component Relationship Map

These are mandatory spatial relationships between components that must be respected during placement.

| Relationship | Rule | Reason |
|---|---|---|
| IP5328P <-> L1 | Adjacent, < 5 mm | High-current switching loop; parasitic inductance |
| IP5328P <-> R_NTC | On exposed pad or < 3 mm | Thermal sensing accuracy |
| CC1101 <-> Pi-network <-> ANT | Linear chain, each < 2 mm | 915 MHz impedance matching |
| CC1101 <-> XTAL_RF | < 5 mm | PLL reference oscillator |
| RTL8152B <-> XTAL_ETH | < 5 mm | PHY clock reference |
| SL2.1A <-> XTAL_HUB | < 5 mm | USB PLL reference |
| XTAL_RF <-> XTAL_ETH | >= 10 mm | 1 MHz heterodyne prevention |
| L1 <-> all crystals | >= 15 mm | Magnetic field injection prevention |
| L1 <-> ANT | >= 25 mm | EMI from inductor into RF front-end |
| IP5328P <-> CC1101 | >= 20 mm | Switching noise coupling |
| IP5328P <-> ANT | >= 25 mm | Switching noise radiation into antenna |
| MagJack <-> Goobay bridge | >= 15 mm | Z-axis mechanical collision |
| MagJack <-> ANT | >= 20 mm | Transformer magnetic coupling |
| MAX98357A <-> J_TRRS | < 10 mm | Short BTL output path |
| MAX98357A <-> CC1101 | >= 15 mm | Class-D switching EMI |
| INMP441 <-> L1 | >= 10 mm | Magnetostriction acoustic coupling |
| ISO1212 field side <-> board GND | >= 2.5 mm gap | Galvanic isolation creepage |
| SY6280 <-> its USB-A port | < 10 mm | High-current power path |
| Q_WAKE/Q_KILL <-> IP5328P KEY | < 10 mm | PMIC_KEY signal integrity |
| NE555 + C_TMR <-> Radxa stack | Check Z-height | Through-hole vertical clearance |

---

## 6. Layer Assignment Summary

| Layer | Primary Use |
|---|---|
| F.Cu (Layer 1) | Signal routing, component placement (most components) |
| In1.Cu (Layer 2) | **Continuous ground plane** -- critical for USB/Ethernet impedance control and RF ground reference. Minimize cuts/splits. |
| In2.Cu (Layer 3) | Power planes (5V_SYS, 3V3_CLEAN, 3V3_SYS copper pours). Some signal routing if needed. |
| B.Cu (Layer 4) | Goobay USB-C bridge placement. Additional signal routing. Some component placement for space-constrained areas. |

**Layer 2 ground plane rules:**
- No signal traces on Layer 2 under the CC1101, ANT, or Pi-network area
- No splits under USB differential pairs
- No splits under Ethernet differential pairs
- Ground-via stitching around crystal oscillators (2-3 mm pitch)
- Thermal vias under IP5328P exposed pad connecting to Layer 2 ground

---

## 7. Critical Separation Rules Summary Table

| Component A | Component B | Min. Distance (mm) | Reason |
|---|---|---|---|
| IP5328P | CC1101 | 20 | Switching noise into RF receiver |
| IP5328P | ANT (antenna) | 25 | Switching noise radiation |
| L1 (inductor) | CC1101 | 25 | Magnetic field EMI |
| L1 (inductor) | ANT | 25 | Magnetic field EMI |
| L1 (inductor) | Any crystal | 15 | Magnetic field frequency pulling |
| XTAL_RF (26 MHz) | XTAL_ETH (25 MHz) | 10 | 1 MHz heterodyne beat coupling |
| MagJack (RJ45) | Goobay USB-C | 15 | Z-axis mechanical collision |
| MagJack (RJ45) | ANT | 20 | Transformer magnetic coupling |
| MAX98357A | CC1101 | 15 | Class-D EMI into RF |
| NE555 circuit | CC1101 | 15 | Current pulse transient noise |
| INMP441 | L1 | 10 | Magnetostriction acoustic coupling |
| ANT keep-out zone | Any copper/component | 5 | Antenna detuning |
| ISO1212 field nets | Board GND nets | 2.5 | Galvanic isolation creepage |
| All bypass caps | Their parent IC VDD pin | 3 (max) | Effective decoupling |
| Crystal | Its parent IC XI/XO pin | 5 (max) | Oscillator loop area |
| Pi-network elements | CC1101 RF_P / ANT | 1-2 (max) | 915 MHz impedance match |

---

*Generated from netlist/full_system.py, netlist/audio_subsystem.py, layout/configure_constraints.py, ARCHITECTURE.md, and BOM.md -- ECO #2026-03-GOLD.*
