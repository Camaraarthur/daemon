"""
Phase 2 – Programmatic Netlist Generation via SKiDL
Daemon V0 I2S Audio Subsystem

Generates a pure-Python KiCad netlist (.net) for:
  - MAX98357A I2S Class-D BTL amplifier
  - INMP441 omnidirectional MEMS microphone
  - Switched 3.5mm TRRS jack (NC mechanical interrupt logic)
  - JST-SH 2-pin connector for the 1W / 8-Ohm internal micro speaker
  - Radxa Zero 3W acting as I2S master (I2S shared nets connect to full_system.py header)

Protection topology (red-team audit fixes):

  SM-LOG-03 – SD_MODE pull-up is computed dynamically from the MAX98357A
  datasheet formula rather than using a static 1MΩ resistor.  A 1MΩ resistor
  at 3.3V VDDIO pushes the SD pin outside the B1 trip-point envelope, forcing
  the amplifier into left-channel-only or metastable mode.
    R_LARGE (kΩ) = 222.2 × V_DDIO − 100  →  633 kΩ at 3.3V

  SM-AUD-01 – Two ESD9B5.0ST5G bidirectional TVS diodes are placed directly
  on the AMP_OUT_P and AMP_OUT_N nets.  Speaker voice-coil inductance
  (28.9µH–560µH) generates V = L·di/dt flyback spikes during contact bounce
  (1–10ms); the TVS clamps any spike above the 5V VRWM before it can reach
  the MAX98357A output pins.  The TRRS insertion-detect signal is further
  hardware-debounced by a 10kΩ / 100nF RC filter (τ = 1ms) inserted between
  the raw mechanical contact and the SD_MODE pin, preventing the amplifier
  from rapidly toggling in/out of shutdown during the bounce window.

Usage:
    python -m netlist.audio_subsystem
    # → writes daemon_v0_audio.net to the current working directory
"""

from __future__ import annotations

import sys
from pathlib import Path

# SKiDL import – the library must be installed via pip.
# If it is absent (e.g. during a dry-run in a minimal CI environment),
# a clear error is raised rather than a silent import failure.
try:
    import skidl
    from skidl import Bus, ERC, Net, Part, generate_netlist  # noqa: F401
    from skidl import TEMPLATE
except ModuleNotFoundError as exc:
    sys.exit(f"SKiDL not installed. Run: pip install skidl\n{exc}")

# ── KiCad 8 library setup ─────────────────────────────────────────────────────
_REPO = Path(__file__).resolve().parent.parent
_tool = skidl.get_default_tool()
_custom_lib = str(_REPO / "lib")
if _custom_lib not in skidl.lib_search_paths[_tool]:
    skidl.lib_search_paths[_tool].append(_custom_lib)


# ── Constants ─────────────────────────────────────────────────────────────────

NETLIST_OUTPUT = "daemon_v0_audio.net"

# Footprint strings – these map to KiCad library references and must match
# the symbol library paths configured in your KiCad environment.
FP_QFN16   = "Package_DFN_QFN:QFN-16-1EP_3x3mm_P0.5mm_EP1.75x1.75mm"
FP_INMP441 = "Daemon_V0:InvenSense_INMP441_BottomPort"
FP_TRRS    = "Daemon_V0:Jack_3.5mm_SJ2-2531X-SMT"
FP_JST_SH2 = "Connector_JST:JST_SH_SM02B-SRSS-TB_1x02-1MP_P1.00mm_Horizontal"
FP_R0402   = "Resistor_SMD:R_0402_1005Metric"
FP_C0402   = "Capacitor_SMD:C_0402_1005Metric"
# SM-AUD-01: ESD9B5.0ST5G bidirectional TVS (ON Semi, SC-70-3 package)
FP_TVS_SC70 = "Package_TO_SOT_SMD:SOT-323_SC-70"
# SM-AUD-02: BLM18AG601SN1 ferrite bead (Murata, 0402; ~600Ω @ 100MHz) for BTL EMI filter
FP_FERRITE_0402 = "Inductor_SMD:L_0402_1005Metric"

# ── SM-LOG-03: SD_MODE pull-up – computed, never static ──────────────────────
# MAX98357A datasheet formula: R_LARGE (kΩ) = 222.2 × V_DDIO − 100
# A 1MΩ resistor at 3.3V VDDIO sits outside the B1 trip-point window and
# risks trapping the SD pin in a metastable comparator state.
VDDIO_V: float = 3.3
SD_MODE_PULLUP_KOHM: int = round(222.2 * VDDIO_V - 100)   # → 633 kΩ
SD_MODE_PULLUP_VALUE: str = f"{SD_MODE_PULLUP_KOHM}k"      # → "633k"


# ── Netlist generation ────────────────────────────────────────────────────────


def generate_daemon_audio_subsystem() -> None:
    """Instantiate components, wire nets, run ERC, and emit the netlist."""

    # ------------------------------------------------------------------
    # Component instantiation
    # ------------------------------------------------------------------

    # MAX98357A – filterless, BTL, I2S Class-D amplifier.
    # SD/GAIN pin determines channel mix (floating → L/2+R/2 via pull-up).
    amp = Part(
        "Audio",
        "MAX98357A",
        footprint=FP_QFN16,
    )

    # INMP441 – omnidirectional MEMS I2S microphone.
    # Shares BCLK and LRCLK with the amplifier (parallel clock topology).
    mic = Part(
        "Daemon_V0",
        "INMP441",
        footprint=FP_INMP441,
    )

    # 3.5mm TRRS jack with isolated NC tip and ring switches.
    # Key pins on the SJ2-2531X-SMT:
    #   1  → Sleeve (GND reference for external plug)
    #   2  → Tip wiper
    #   3  → Ring 1 wiper
    #   4  → Ring 2 wiper
    #   10 → Tip Switch (NC; breaks when plug inserted)
    #   11 → Ring 1 Switch (NC; breaks when plug inserted)
    #   12 → Detect / sleeve switch (NO; closes when plug inserted)
    trrs_jack = Part(
        "Daemon_V0",
        "AudioJack4_Switch",
        footprint=FP_TRRS,
    )

    # JST-SH 2-pin – wiring harness for 1W / 8-Ohm internal micro speaker.
    speaker_conn = Part(
        "Connector_Generic",
        "Conn_01x02",
        footprint=FP_JST_SH2,
    )

    # Passive templates – copied on demand.
    Resistor = Part("Device", "R", dest=TEMPLATE, footprint=FP_R0402)
    Capacitor = Part("Device", "C", dest=TEMPLATE, footprint=FP_C0402)

    # SM-LOG-03: pull-up value derived from R_LARGE = 222.2 × V_DDIO − 100.
    # At 3.3V VDDIO → 633 kΩ.  A static 1MΩ crosses the B2 trip point.
    pullup_sd = Resistor(value=SD_MODE_PULLUP_VALUE)

    # 10kΩ pull-down for INMP441 L/R pin → selects left-channel output.
    mic_lr_pulldown = Resistor(value="10k")

    # SM-AUD-01: ESD9B5.0ST5G TVS diodes on BTL output nodes.
    # Bidirectional; VRWM = 5V so they are inactive during normal BTL audio
    # swings (<4.8V) and clamp only the >5V flyback spikes from the speaker
    # voice coil during TRRS contact bounce.
    tvs_btl_p = Part(
        "Daemon_V0", "ESD9B5.0ST5G",
        footprint=FP_TVS_SC70,
        value="ESD9B5.0ST5G",
    )
    tvs_btl_n = Part(
        "Daemon_V0", "ESD9B5.0ST5G",
        footprint=FP_TVS_SC70,
        value="ESD9B5.0ST5G",
    )

    # SM-AUD-01: RC debounce for the TRRS insertion-detect signal.
    # τ = 10kΩ × 100nF = 1ms – clears the 1–10ms mechanical contact bounce
    # window before the filtered signal is allowed to assert SD_MODE low.
    r_detect_debounce = Resistor(value="10k")
    c_detect_debounce = Capacitor(value="100n")

    # Bulk decoupling caps: one per power rail per IC (best practice).
    amp_decap_a, amp_decap_b = Capacitor(num_copies=2, value="0.1uF")
    mic_decap_a, mic_decap_b = Capacitor(num_copies=2, value="0.1uF")

    # SM-AUD-02: BLM18AG601SN1 ferrite bead + 1nF cap EMI filter on BTL outputs (ECO #2026-03-G)
    # Topology: AMP_OUT_P/N → [TVS clamp] → [Ferrite Bead] → AMP_OUT_P/N_FILT → [TRRS switch]
    #           Post-bead 1nF to GND forms RC low-pass: Z_bead(300kHz)≈80Ω, f_c≈2MHz.
    # Kills IP5328P 300kHz switching noise before it reaches the speaker cable (which
    # acts as a 1m antenna and would re-radiate back into the CC1101 RF front-end).
    fb_p = Part("Device", "FerriteBead", footprint=FP_FERRITE_0402, value="BLM18AG601SN1")
    fb_n = Part("Device", "FerriteBead", footprint=FP_FERRITE_0402, value="BLM18AG601SN1")
    c_filt_p = Capacitor(value="1n")   # post-bead shunt cap, OUTP side
    c_filt_n = Capacitor(value="1n")   # post-bead shunt cap, OUTN side

    # ------------------------------------------------------------------
    # Power nets
    # ------------------------------------------------------------------
    gnd = Net("GND")
    vcc_5v = Net("5V_AUDIO")   # feeds MAX98357A (BTL, up to 5.5V)
    vcc_3v3 = Net("3V3_SYS")  # feeds INMP441 (1.8V–3.3V range)

    # Amplifier power + decoupling
    amp["VDD"] += vcc_5v
    amp["GND"] += gnd
    amp_decap_a[1] += vcc_5v
    amp_decap_a[2] += gnd
    amp_decap_b[1] += vcc_5v
    amp_decap_b[2] += gnd

    # Microphone power + decoupling
    mic["VDD"] += vcc_3v3
    mic["GND"] += gnd
    mic_decap_a[1] += vcc_3v3
    mic_decap_a[2] += gnd
    mic_decap_b[1] += vcc_3v3
    mic_decap_b[2] += gnd

    # ------------------------------------------------------------------
    # I2S bus – parallel clock topology
    # MAX98357A does not require MCLK; bus uses only BCLK, LRCLK, DATA.
    # ------------------------------------------------------------------
    i2s_bclk = Net("I2S_BCLK")
    i2s_lrclk = Net("I2S_LRCLK")
    i2s_dout = Net("I2S_DATA_OUT")  # MCU → amplifier
    i2s_din = Net("I2S_DATA_IN")    # microphone → MCU

    # I2S bus: Radxa Zero 3W is the I2S master.  These nets are shared by name
    # with full_system.py (I2S_BCLK=pin 12, I2S_LRCLK=pin 35, I2S_DATA_IN=pin 38,
    # I2S_DATA_OUT=pin 40).  No MCU Part instantiation is needed here; the Radxa
    # header in full_system.py connects the SoC's I2S3 peripheral to these nets.

    # Amplifier I2S inputs
    amp["BCLK"] += i2s_bclk
    amp["LRCLK"] += i2s_lrclk
    amp["DIN"] += i2s_dout

    # Microphone I2S outputs (shares clocks with amplifier in parallel)
    mic["SCK"] += i2s_bclk    # INMP441 serial clock
    mic["WS"] += i2s_lrclk   # INMP441 word select
    mic["SD"] += i2s_din      # INMP441 serial data out

    # L/R channel selection: pull L/R low → left channel output
    mic["L/R"] += mic_lr_pulldown[1]
    mic_lr_pulldown[2] += gnd

    # ------------------------------------------------------------------
    # BTL output routing – TRRS NC switch interrupt logic
    #
    # CRITICAL: OUTP and OUTN must NEVER connect to system GND directly.
    # Both are routed to the NC (normally-closed) switch terminals of the
    # TRRS jack.  When the jack is empty, the NC contacts are closed,
    # completing the circuit through the JST-SH speaker connector.
    # On plug insertion, the NC contacts open, disconnecting the speaker
    # harness before any external ground loop can form.
    # ------------------------------------------------------------------
    btl_out_p = Net("AMP_OUT_P")   # OUTP – positive BTL swing
    btl_out_n = Net("AMP_OUT_N")   # OUTN – negative BTL swing (anti-phase)

    amp["OUTP"] += btl_out_p
    amp["OUTN"] += btl_out_n

    # SM-AUD-01: TVS clamps on amplifier output nodes.
    # Placed here (amplifier side of the TRRS switch) so the IC is protected
    # from bounce-coupled flyback spikes before they reach the silicon.
    tvs_btl_p["A"] += btl_out_p
    tvs_btl_p["K"] += gnd
    tvs_btl_n["A"] += btl_out_n
    tvs_btl_n["K"] += gnd

    # SM-AUD-02: Ferrite bead EMI filter between raw amp output and TRRS switch (ECO #2026-03-G).
    # Order: amp → TVS (spike clamp) → ferrite bead → 1nF shunt → TRRS switch → speaker.
    # TVS stays on the raw side to catch spikes; bead kills 300kHz switching noise
    # propagating toward the speaker cable (1m wire = effective antenna at 300kHz).
    btl_filt_p = Net("AMP_OUT_P_FILT")   # post-bead filtered BTL positive
    btl_filt_n = Net("AMP_OUT_N_FILT")   # post-bead filtered BTL negative

    fb_p[1] += btl_out_p;    fb_p[2] += btl_filt_p    # bead in series, OUTP path
    c_filt_p[1] += btl_filt_p; c_filt_p[2] += gnd      # shunt cap to GND

    fb_n[1] += btl_out_n;    fb_n[2] += btl_filt_n    # bead in series, OUTN path
    c_filt_n[1] += btl_filt_n; c_filt_n[2] += gnd      # shunt cap to GND

    # Route filtered BTL signals into the NC switch input side of the TRRS jack.
    trrs_jack["TipSwitch"] += btl_filt_p    # pin 10 on SJ2-2531X-SMT (was btl_out_p)
    trrs_jack["Ring1Switch"] += btl_filt_n  # pin 11                   (was btl_out_n)

    # The output side of the NC switches drives the JST-SH speaker connector.
    # When the plug is absent the path is: AMP_OUT_P → NC switch → speaker pin 1
    #                                      AMP_OUT_N → NC switch → speaker pin 2
    speaker_conn[1] += trrs_jack["Tip"]    # pin 2 (wiper) – speaker positive
    speaker_conn[2] += trrs_jack["Ring1"]  # pin 3 (wiper) – speaker negative

    # ------------------------------------------------------------------
    # Amplifier shutdown via insertion-detect switch
    #
    # The SD pin is pulled high (633kΩ to 3V3_SYS, per SM-LOG-03 formula; ECO #2026-03-G) by
    # default, setting L/2+R/2 mono mix mode.  On plug insertion, the detect
    # switch closes and the RC-filtered signal pulls SD_MODE to GND, forcing
    # the MAX98357A into micropower shutdown (<1µA).
    #
    # SM-AUD-01: The raw TRRS detect output is NOT connected directly to
    # AMP_SD.  A 10kΩ / 100nF RC filter (τ = 1ms) is inserted between the
    # mechanical contact and the SD_MODE pin.  This eliminates the 1–10ms
    # contact-bounce chatter that would otherwise rapidly toggle the amplifier
    # in/out of shutdown while the BTL outputs are shorted to external GND.
    # ------------------------------------------------------------------
    amp_sd = Net("AMP_SD")
    amp["~{SD_MODE}"] += amp_sd

    # Default pull-up: 3V3_SYS → 633kΩ → AMP_SD  (SM-LOG-03 computed value; ECO #2026-03-G)
    # VDDIO = 3.3V → R = 222.2×3.3−100 = 633kΩ; pull-up must connect to VDDIO (3V3_SYS),
    # NOT to VDD (5V_AUDIO).  Connecting to 5V would overdrive SD above V_IH_B2 trip point,
    # locking the amplifier into gain-select mode instead of L/2+R/2 mono mix.
    pullup_sd[1] += vcc_3v3   # VDDIO reference (was incorrectly vcc_5v; ECO #2026-03-G)
    pullup_sd[2] += amp_sd

    # Debounced detect path:
    #   TRRS Detect (raw) → 10kΩ → AMP_SD
    #                                 └── 100nF → GND
    # The RC charges slowly through the 10kΩ, preventing rapid SD toggling.
    detect_raw = Net("TRRS_DETECT_RAW")
    trrs_jack["Detect"] += detect_raw       # raw mechanical contact (pin 12)
    r_detect_debounce[1] += detect_raw
    r_detect_debounce[2] += amp_sd          # filtered output joins AMP_SD net
    c_detect_debounce[1] += amp_sd          # bypass cap forms the RC filter
    c_detect_debounce[2] += gnd

    trrs_jack["Sleeve"] += gnd              # sleeve / common GND on jack body

    # ------------------------------------------------------------------
    # Electrical Rules Check + netlist export
    # ------------------------------------------------------------------
    ERC()
    generate_netlist(file_=NETLIST_OUTPUT)
    print(f"Netlist written → {NETLIST_OUTPUT}")


# ── Entry point ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    generate_daemon_audio_subsystem()
