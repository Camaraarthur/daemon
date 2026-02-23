"""
Phase 2 – Programmatic Netlist Generation via SKiDL
Daemon V0 I2S Audio Subsystem

Generates a pure-Python KiCad netlist (.net) for:
  - MAX98357A I2S Class-D BTL amplifier
  - INMP441 omnidirectional MEMS microphone
  - Switched 3.5mm TRRS jack (NC mechanical interrupt logic)
  - JST-SH 2-pin connector for the 1W / 8-Ohm internal micro speaker
  - ESP32-WROOM-32 acting as I2S master

The TRRS jack's normally-closed (NC) tip and ring switches route the
BTL outputs exclusively to the JST-SH speaker connector.  An isolated
insertion-detect switch pulls the MAX98357A SD pin low on plug insertion,
forcing the amplifier into micropower shutdown before the external
ground-referenced load can create a destructive BTL short.

Usage:
    python -m netlist.audio_subsystem
    # → writes daemon_v0_audio.net to the current working directory
"""

from __future__ import annotations

import sys

# SKiDL import – the library must be installed via pip.
# If it is absent (e.g. during a dry-run in a minimal CI environment),
# a clear error is raised rather than a silent import failure.
try:
    import skidl
    from skidl import Bus, ERC, Net, Part, generate_netlist  # noqa: F401
    from skidl import TEMPLATE
except ModuleNotFoundError as exc:
    sys.exit(f"SKiDL not installed. Run: pip install skidl\n{exc}")


# ── Constants ─────────────────────────────────────────────────────────────────

NETLIST_OUTPUT = "daemon_v0_audio.net"

# Footprint strings – these map to KiCad library references and must match
# the symbol library paths configured in your KiCad environment.
FP_QFN16 = "Package_DFN_QFN:QFN-16-1EP_3x3mm_P0.5mm_EP1.8x1.8mm"
FP_INMP441 = "Sensor_Audio:InvenSense_INMP441_BottomPort"
FP_TRRS = "Connector_Audio:Jack_3.5mm_SJ2-2531X-SMT"
FP_JST_SH2 = "Connector_JST:JST_SH_SM02B-SRSS-TB_1x02-1MP_P1.00mm_Horizontal"
FP_ESP32 = "RF_Module:ESP32-WROOM-32"
FP_R0402 = "Resistor_SMD:R_0402_1005Metric"
FP_C0402 = "Capacitor_SMD:C_0402_1005Metric"


# ── Netlist generation ────────────────────────────────────────────────────────


def generate_daemon_audio_subsystem() -> None:
    """Instantiate components, wire nets, run ERC, and emit the netlist."""

    # ------------------------------------------------------------------
    # Component instantiation
    # ------------------------------------------------------------------

    # MAX98357A – filterless, BTL, I2S Class-D amplifier.
    # SD/GAIN pin determines channel mix (floating → L/2+R/2 via pull-up).
    amp = Part(
        "audio",
        "MAX98357A",
        footprint=FP_QFN16,
    )

    # INMP441 – omnidirectional MEMS I2S microphone.
    # Shares BCLK and LRCLK with the amplifier (parallel clock topology).
    mic = Part(
        "audio",
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
        "Connector_Audio",
        "AudioJack4_Switch",
        footprint=FP_TRRS,
    )

    # JST-SH 2-pin – wiring harness for 1W / 8-Ohm internal micro speaker.
    speaker_conn = Part(
        "Connector_Generic",
        "Conn_01x02",
        footprint=FP_JST_SH2,
    )

    # ESP32-WROOM-32 – I2S bus master (mocked for netlist purposes).
    i2s_master = Part(
        "MCU_Espressif",
        "ESP32-WROOM-32",
        footprint=FP_ESP32,
    )

    # Passive templates – copied on demand.
    Resistor = Part("Device", "R", dest=TEMPLATE, footprint=FP_R0402)
    Capacitor = Part("Device", "C", dest=TEMPLATE, footprint=FP_C0402)

    # 1MΩ pull-up for the MAX98357A SD pin: sets default L/2+R/2 mix mode.
    pullup_sd = Resistor(value="1M")

    # 10kΩ pull-down for INMP441 L/R pin → selects left-channel output.
    mic_lr_pulldown = Resistor(value="10k")

    # Bulk decoupling caps: one per power rail per IC (best practice).
    amp_decap_a, amp_decap_b = Capacitor(num_copies=2, value="0.1uF")
    mic_decap_a, mic_decap_b = Capacitor(num_copies=2, value="0.1uF")

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

    # MCU I2S master outputs (GPIO assignments per the report spec)
    i2s_master["IO25"] += i2s_bclk
    i2s_master["IO26"] += i2s_lrclk
    i2s_master["IO22"] += i2s_dout
    i2s_master["IO21"] += i2s_din

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

    # Route BTL signals into the NC switch input side of the TRRS jack.
    trrs_jack["TipSwitch"] += btl_out_p    # pin 10 on SJ2-2531X-SMT
    trrs_jack["Ring1Switch"] += btl_out_n  # pin 11

    # The output side of the NC switches drives the JST-SH speaker connector.
    # When the plug is absent the path is: AMP_OUT_P → NC switch → speaker pin 1
    #                                      AMP_OUT_N → NC switch → speaker pin 2
    speaker_conn[1] += trrs_jack["Tip"]    # pin 2 (wiper) – speaker positive
    speaker_conn[2] += trrs_jack["Ring1"]  # pin 3 (wiper) – speaker negative

    # ------------------------------------------------------------------
    # Amplifier shutdown via insertion-detect switch
    #
    # The SD pin is pulled high (1MΩ to 5V) by default, enabling L/2+R/2
    # channel mix mode.  On plug insertion, the detect switch (pin 12 on
    # the SJ2-2531X-SMT) closes, sinking the 1MΩ pull-up directly to GND
    # and asserting the MAX98357A into micropower shutdown (<1µA).
    # ------------------------------------------------------------------
    amp_sd = Net("AMP_SD")
    amp["SD"] += amp_sd

    # Default pull-up: 5V → 1MΩ → AMP_SD  (sets L/2+R/2 mix, amplifier active)
    pullup_sd[1] += vcc_5v
    pullup_sd[2] += amp_sd

    # Detect switch: AMP_SD → switch → GND  (forces shutdown on plug insertion)
    trrs_jack["Detect"] += amp_sd   # detect switch active terminal (pin 12)
    trrs_jack["Sleeve"] += gnd      # sleeve / common GND on the jack body

    # ------------------------------------------------------------------
    # Electrical Rules Check + netlist export
    # ------------------------------------------------------------------
    ERC()
    generate_netlist(file_=NETLIST_OUTPUT)
    print(f"Netlist written → {NETLIST_OUTPUT}")


# ── Entry point ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    generate_daemon_audio_subsystem()
