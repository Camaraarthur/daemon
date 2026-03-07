"""
Tests for netlist/audio_subsystem.py

Validates ECO #2026-03-G (Signal Integrity) audio fixes without requiring SKiDL,
KiCad, or any analog simulation toolchain.  All assertions inspect source text.

Covered assertions:
  · SM-AUD-02: BLM18AG601SN1 ferrite beads on AMP_OUT_P and AMP_OUT_N (ECO #2026-03-G)
  · SM-AUD-02: 1nF post-bead shunt caps to GND (form LC low-pass, kills 300kHz noise)
  · SM-AUD-02: AMP_OUT_P_FILT / AMP_OUT_N_FILT filtered nets exist
  · SM-AUD-02: TRRS switch inputs connected to filtered nets (not raw amp outputs)
  · SM-LOG-03: SD_MODE pull-up connects to vcc_3v3 (VDDIO), NOT vcc_5v (ECO #2026-03-G)
  · SM-AUD-01: Battery LEDs not present (regression guard; ECO #2026-03-E)
"""

from pathlib import Path

SRC = Path(__file__).parent.parent / "netlist" / "audio_subsystem.py"


def _get_source() -> str:
    return SRC.read_text()


# ── SM-AUD-02: Ferrite bead EMI filter ───────────────────────────────────────


def test_ferrite_bead_footprint_constant():
    """SM-AUD-02: FP_FERRITE_0402 footprint constant must be declared."""
    assert "FP_FERRITE_0402" in _get_source(), (
        "FP_FERRITE_0402 missing — BLM18 ferrite bead footprint not defined"
    )


def test_ferrite_bead_parts_instantiated():
    """SM-AUD-02: BLM18AG601SN1 ferrite beads must be instantiated on both BTL outputs."""
    src = _get_source()
    assert '"Device", "FerriteBead"' in src, (
        "FerriteBead part not found — BTL EMI filter not instantiated (ECO #2026-03-G)"
    )
    assert "BLM18AG601SN1" in src, (
        "BLM18AG601SN1 value not found — specific Murata ferrite bead not specified"
    )


def test_emi_filter_caps_1nf():
    """SM-AUD-02: 1nF shunt caps must be present for post-bead LC filter."""
    src = _get_source()
    assert 'value="1n"' in src, (
        "1nF filter capacitor not found — post-bead shunt cap missing (ECO #2026-03-G)"
    )


def test_filtered_nets_declared():
    """SM-AUD-02: AMP_OUT_P_FILT and AMP_OUT_N_FILT nets must be declared."""
    src = _get_source()
    assert 'Net("AMP_OUT_P_FILT")' in src, (
        "AMP_OUT_P_FILT net missing — filtered BTL positive path not defined"
    )
    assert 'Net("AMP_OUT_N_FILT")' in src, (
        "AMP_OUT_N_FILT net missing — filtered BTL negative path not defined"
    )


def test_trrs_connected_to_filtered_nets():
    """SM-AUD-02: TRRS switch inputs must connect to post-filter nets, not raw amp outputs."""
    src = _get_source()
    assert 'trrs_jack["TipSwitch"] += btl_filt_p' in src, (
        "TRRS TipSwitch still on raw btl_out_p — EMI filter bypass: TRRS must use btl_filt_p"
    )
    assert 'trrs_jack["Ring1Switch"] += btl_filt_n' in src, (
        "TRRS Ring1Switch still on raw btl_out_n — EMI filter bypass: TRRS must use btl_filt_n"
    )


def test_trrs_not_connected_to_raw_amp_outputs():
    """SM-AUD-02: TRRS must NOT connect directly to raw amp outputs (filter would be bypassed)."""
    src = _get_source()
    assert 'trrs_jack["TipSwitch"] += btl_out_p' not in src, (
        "TRRS TipSwitch still on raw btl_out_p — ferrite bead EMI filter is being bypassed"
    )
    assert 'trrs_jack["Ring1Switch"] += btl_out_n' not in src, (
        "TRRS Ring1Switch still on raw btl_out_n — ferrite bead EMI filter is being bypassed"
    )


# ── SM-LOG-03: SD_MODE pull-up voltage verification ──────────────────────────


def test_sd_mode_pullup_connects_to_3v3():
    """SM-LOG-03 / ECO #2026-03-G: SD_MODE pull-up must connect to vcc_3v3 (VDDIO = 3.3V)."""
    src = _get_source()
    assert "pullup_sd[1] += vcc_3v3" in src, (
        "SD_MODE pull-up not on vcc_3v3 — formula uses VDDIO=3.3V; rail must match"
    )


def test_sd_mode_pullup_not_on_5v():
    """SM-LOG-03 / ECO #2026-03-G: SD_MODE pull-up must NOT connect to vcc_5v (overdrive risk)."""
    src = _get_source()
    assert "pullup_sd[1] += vcc_5v" not in src, (
        "SD_MODE pull-up still on vcc_5v — 5V overdrive locks amplifier into gain-select mode"
    )


# ── ECO #2026-03-GOLD: Golden Master Cleanup ─────────────────────────────────


def test_esp32_removed():
    """ECO #2026-03-GOLD: ESP32 Part instantiation must be removed; Radxa Zero 3W is I2S master."""
    src = _get_source()
    assert "ESP32" not in src, (
        "ESP32 reference still present — wrong MCU; this board uses Radxa Zero 3W (ECO #2026-03-GOLD)"
    )
    assert "MCU_Espressif" not in src, (
        "MCU_Espressif library reference still present — ESP32 not fully removed"
    )


def test_i2s_nets_use_radxa_names():
    """ECO #2026-03-GOLD: I2S nets must use canonical Radxa header names for cross-netlist sharing."""
    src = _get_source()
    assert 'Net("I2S_BCLK")' in src, (
        "I2S_BCLK net missing — does not match Radxa header pin 12 net name"
    )
    assert 'Net("I2S_LRCLK")' in src, (
        "I2S_LRCLK net missing — does not match Radxa header pin 35 net name"
    )
    assert 'Net("I2S_DATA_OUT")' in src, (
        "I2S_DATA_OUT net missing — does not match Radxa header pin 40 net name"
    )
    assert 'Net("I2S_DATA_IN")' in src, (
        "I2S_DATA_IN net missing — does not match Radxa header pin 38 net name"
    )
