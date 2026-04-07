# Patent Filing Guide — Privacy LED Interlock
*For Arthur. Plain English. Everything you need to know and do.*

---

## What Are We Patenting?

A circuit where the microphone's power wire goes through an LED. The LED MUST be lit for the mic to work. No software, no chip, no transistor can override this — it's physics.

In your Daemon PCB, the power from the 3.3V rail goes to a node called MIC_VDD. From that node, two things happen in parallel:
- Current flows to the INMP441 microphones (powering them)
- Current flows through a 1K resistor and a red LED to ground (lighting it)

Same wire. Same node. If the node has power, both the mic AND the LED are on. If you cut the LED, the mic still works (the LED is a parallel indicator, not truly "in series" in the strictest sense — but removing the LED doesn't cut mic power). 

**Wait — important clarification on YOUR actual circuit:**

Looking at the KiCad schematic, the LED is wired in PARALLEL with the mic off the same MIC_VDD node, not strictly in series with the mic's power path. The LED + resistor form a branch to ground. The mic has its own branch to the same node.

This means:
- When MIC_VDD is powered → LED is on AND mic is on (good)
- If someone desolders the LED → mic still works, LED is off (bad — defeats the purpose)

**For the patent claims to be accurate, and for the privacy guarantee to actually work, the LED should be IN SERIES — meaning the mic's power must physically flow THROUGH the LED.** Like this:

```
3V3_SYS → LED → mic VDD
              ↓
             GND (via resistor for current indication)
```

Not like this (your current circuit):
```
3V3_SYS → MIC_VDD node → mic VDD
                        → LED + resistor → GND
```

**This is a design decision we need to address.** The patent describes the series configuration (which is the novel, patentable one). Your current PCB has the parallel configuration. Options:

1. **Update the PCB to match the patent** — put the LED actually in series with the mic power. This means the mic's VDD gets ~1.5V less (3.3V - 1.8V LED drop = 1.5V), which is below the INMP441's 1.8V minimum. So you'd need to either:
   - Use a higher supply voltage (5V → LED → 3.2V to mic — works)
   - Use a low-Vf LED (green/IR at ~0.7V, giving mic ~2.6V — works)
   - Use a different mic that tolerates lower voltage

2. **File the patent describing the series configuration** (the ideal, novel design) and update the PCB later to match. The patent doesn't require a working prototype — it requires a description clear enough to build. This is the faster path.

3. **Patent the parallel configuration too** — "indicator on the same power node" is less novel but still distinguishable from Bose.

**My recommendation: Option 2.** File the patent now describing the series configuration. Update the PCB design to match before manufacturing. The patent establishes your priority date today; the hardware can catch up.

---

## What's in the Patent Application?

The full draft is at: `/home/arthur/daemon/PATENT_APPLICATION_IT.md`

It contains:

| Section | What it is | Language |
|---|---|---|
| **Titolo** | Technical title of the invention | Italian |
| **Descrizione** | Full technical description (~3 pages): prior art problems, your solution, how it works, example circuit | Italian |
| **Rivendicazioni (IT)** | 10 patent claims defining what's protected | Italian |
| **Claims (EN)** | Same 10 claims in English (saves €200 at filing) | English |
| **Riassunto** | 150-word abstract | Italian |
| **Abstract** | Same abstract in English | English |
| **Note per i disegni** | Instructions for the 3 technical drawings you need | Italian |

### The 10 Claims (What's Actually Protected)

Claims are the legal core — they define exactly what competitors can't copy.

**Claim 1 (broadest — the big one):**
"Any electronic device where a passive visual indicator is in series with a sensor's power supply, with no active electronic components in between."
- This covers: any LED + any mic/camera/sensor + any device type
- This excludes: Bose (uses transistors), Humane (uses a chip), software-controlled LEDs
- If this holds, anyone putting an LED in series with a sensor's power owes you a license

**Claim 2:** Specifies the indicator is an LED.
**Claim 3:** Specifies the sensor is a microphone.
**Claim 4:** Specifies it's a MEMS microphone.
**Claim 5:** Specifies everything is on one PCB.
**Claim 6:** The tamper-evidence claim — bypassing requires visible physical modification.
**Claim 7:** Specifies it's a wearable device for always-on audio.
**Claim 8:** Specifies the copper trace — removing the LED creates an open circuit.
**Claim 9:** Specifies the LED voltage drop is compatible with the sensor's operating range.
**Claim 10 (second independent claim):** A PCB assembly specifically — LED on a PCB trace between power source and microphone, no active components on the trace.

**Why this structure:** Claim 1 is the broadest net. If an examiner says "too broad," claims 2-9 progressively narrow it. Claim 10 is an independent fallback that's more specific but still commercially valuable.

---

## The 3 Technical Drawings You Need

These are required for filing. They must be:
- Black lines on white background
- A4 size (29.7 x 21 cm)
- 2.5 cm margins on all sides
- NO text except reference numbers ("110", "LED6", etc.) and "Fig. 1", "Fig. 2", "Fig. 3"
- Clean enough to photocopy

### Figure 1: Circuit Schematic

The electrical circuit showing the series connection. This should show:

```
    ┌─────────┐
    │  Power  │
    │ Source  │ (110)
    │ 3.3V   │
    └────┬────┘
         │
    ┌────┴────┐
    │ EMI     │
    │ Filter  │ (120) — FB2 ferrite bead
    └────┬────┘
         │
         │ Power Supply Conductor (130)
         │
    ┌────┴────┐
    │  LED    │ (LED6) — passive visual indicator
    │  RED    │
    └────┬────┘
         │
    ┌────┴────┐
    │  Mic    │ (U13) — INMP441 MEMS microphone
    │ INMP441 │
    └────┬────┘
         │
        GND
```

**Important: Draw it as SERIES (LED in the power path TO the mic), not parallel (which is your current PCB).** The patent describes the ideal series configuration.

Include a resistor symbol for R56 (1K) next to the LED for current limiting.

**How to make this:** You can draw it in KiCad (create a simplified schematic with just these components), or draw it by hand and scan it, or use any vector drawing tool (Inkscape, etc.). It doesn't need to be beautiful — it needs to be technically correct and clear.

### Figure 2: PCB Layout View

A top-down view of the PCB showing:
- The copper trace from the power source pad
- Through the LED footprint pads
- To the microphone footprint pads
- With reference numbers pointing to each component

This shows that the LED and mic share the same physical copper trace on the board. You can export this from KiCad:
1. Open `daemon_v0.kicad_pcb`
2. Hide all layers except the copper layer with the MIC_VDD trace
3. Screenshot/export as PDF
4. Add reference number labels (110, 120, LED6, U13)
5. Strip all text except reference numbers and "Fig. 2"

**Note:** Since the current PCB has the parallel layout, you may want to draw this one manually showing the series layout instead. A simplified diagram is better than an accurate-but-wrong export.

### Figure 3: System Block Diagram

A high-level block diagram showing where the privacy interlock sits in the whole device:

```
┌──────────────────────────────────────┐
│           Electronic Device (100)     │
│                                       │
│  ┌─────────┐   ┌──────────────────┐  │
│  │ Battery/ │   │  Privacy         │  │
│  │ Power    │──→│  Interlock       │  │
│  │ Supply   │   │  Circuit         │  │
│  │ (110)    │   │  ┌─────┐ ┌────┐ │  │
│  └─────────┘   │  │ LED │→│Mic │ │  │
│                 │  │(LED6)│ │(U13)│ │  │
│                 │  └─────┘ └────┘ │  │
│                 └──────────────────┘  │
│                                       │
│  ┌──────────┐  ┌──────────────────┐  │
│  │Processor │  │ Wireless Module  │  │
│  │ (SoC)    │  │ (WiFi/BT/LoRa)  │  │
│  └──────────┘  └──────────────────┘  │
│                                       │
└──────────────────────────────────────┘
```

This shows that the privacy interlock is a self-contained sub-circuit within the larger device, and that no processor/software component is in the path between power and microphone.

---

## Filing Checklist

### Before You Can File

- [ ] **SPID** — Do you have this? Check if you can log into https://www.agenziaentrate.gov.it
- [ ] **Firma digitale** — Ordered from Aruba, waiting for video verification + activation (1-3 days)
- [ ] **Draw Figure 1** — Circuit schematic (series configuration)
- [ ] **Draw Figure 2** — PCB trace layout (series configuration)
- [ ] **Draw Figure 3** — System block diagram
- [ ] **Review the patent text** — Read `PATENT_APPLICATION_IT.md`, flag anything unclear
- [ ] **Decide on the series vs parallel question** (see above)

### Filing Day (When Firma Digitale is Active)

1. Go to https://servizionline.uibm.gov.it (Mon-Fri, 08:00-19:00)
2. Login with SPID
3. Start new "Brevetto per Invenzione Industriale" application
4. Fill in: inventor name, address (match your Partita IVA address), title
5. Upload signed PDFs:
   - Descrizione (description)
   - Rivendicazioni in italiano (Italian claims)
   - Rivendicazioni in inglese (English claims)
   - Riassunto (abstract)
   - Disegni (drawings — all 3 figures in one PDF)
6. Pay €50 via PagoPA
7. Download receipt (verbale di deposito)
8. Done. Priority date locked.

### After Filing

- **9 months:** EPO search report arrives (tells you if prior art blocks your claims)
- **12 months:** Deadline to extend via PCT (worldwide) or EPO (Europe-wide) if you want broader coverage
- **18 months:** Application is published (becomes public)
- **~24 months:** Patent granted in Italy

---

## File Locations

| File | What | Path |
|---|---|---|
| Patent application (full draft) | Description + claims + abstract | `/home/arthur/daemon/PATENT_APPLICATION_IT.md` |
| Prior art research | Deep analysis of existing patents | `/home/arthur/daemon/hardware/patent-prior-art-deep-search.md` |
| KiCad schematic | Full PCB schematic (current design) | `/home/arthur/daemon/daemon_v0.kicad_sch` |
| KiCad PCB layout | Full board layout | `/home/arthur/daemon/daemon_v0.kicad_pcb` |
| SKiDL netlist (audio) | Python-generated netlist with the mic+LED circuit | `/home/arthur/daemon/netlist/audio_subsystem.py` |
| BOM | Bill of materials with component values | `/home/arthur/daemon/BOM.md` |
| This guide | What you're reading | `/home/arthur/daemon/PATENT_README.md` |

---

## Key Prior Art (What Exists That We Need to Avoid)

| Patent | Owner | What it does | Why we're different |
|---|---|---|---|
| **US11490248B2** (granted) | Bose | LED coupled to mic via transistors | We use NO transistors, no active components |
| **US6307479** (2001) | Harvatek | LED in series with IC power for diagnostics | We apply it to privacy, not diagnostics |
| Apple MacBook | Apple | Camera LED on same circuit | Camera not mic; implementation unclear; no patent on the series approach |
| Humane AI Pin | Humane | "Trust Light" via dedicated chip | Uses firmware-controlled chip, not passive physics |

**Our novel space:** No existing patent covers a passive visual indicator in direct series with a sensor's power path, with zero active components. 25 years of "LED in series" prior art (US6307479) and nobody applied it to privacy. That gap is our patent.

---

## The One Thing That Could Go Wrong

The EPO search report (arrives ~9 months after filing) might say: "Putting an LED in series with a power line is known (US6307479). Coupling LED state to mic power for privacy is known (Bose). Your combination is obvious."

**Our counter-argument:** Bose's approach adds complexity (transistors, control circuits). Ours removes ALL active components from the power path — going against the industry trend. In 25 years since US6307479, nobody made this obvious combination for privacy. The simplicity IS the non-obvious step. The tamper-evidence property (visible PCB modification required to bypass) is a structural consequence that no prior art achieves.

This argument is strongest if the patent description clearly explains WHY simplicity matters (harder to hack, verifiable by end users with a multimeter, no firmware attack surface). The current draft does this.

---

## Budget

| Item | Cost |
|---|---|
| Filing fee (online) | €50 |
| Firma digitale (Aruba) | ~€36 + €24.90 video verification |
| EUIPO SME Fund reimbursement (75%) | -€37.50 back |
| **Net cost** | **~€73** |

---

## Questions to Answer Before Filing

1. **Do you have SPID?** If not, set it up now (free, 1-2 days with Poste ID or Aruba).
2. **Series vs parallel:** The patent describes series. Your PCB is parallel. Are you OK filing the patent as series (the stronger, more novel design) and updating the PCB later?
3. **Inventor address:** Which address is on your Partita IVA registration? Use that one.
4. **Drawings:** Do you want to draw them yourself, or should I generate SVGs you can print?
