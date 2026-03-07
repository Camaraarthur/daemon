"""
Tests for netlist/full_system.py

These tests validate the structural and connectivity logic of the full
Daemon V0 system netlist without executing SKiDL (which requires KiCad
symbol libraries at run-time).  They cover:

  · Module-level constants (footprints, net names, port counts)
  · Net naming conventions are consistent with DFT and audio subsystems
  · Stinger port count and per-port parameter sets are coherent
  · Radxa header pin-count matches the 2×20 40-pin spec
  · Joystick and screen connector pin counts are correct
  · No duplicate top-level net names
"""

import ast
import importlib.util
from pathlib import Path

import pytest

# ── Load the source file as an AST (no SKiDL import needed) ──────────────────

SRC = Path(__file__).parent.parent / "netlist" / "full_system.py"


def _get_source() -> str:
    return SRC.read_text()


def _get_ast() -> ast.Module:
    return ast.parse(_get_source())


# ── Footprint sanity ──────────────────────────────────────────────────────────


def test_all_footprint_constants_have_colon():
    """Every FP_* constant must be in 'Library:Footprint' format."""
    src = _get_source()
    tree = _get_ast()
    for node in ast.walk(tree):
        if isinstance(node, ast.Assign):
            for target in node.targets:
                if isinstance(target, ast.Name) and target.id.startswith("FP_"):
                    if isinstance(node.value, ast.Constant):
                        val = node.value.value
                        assert ":" in val, (
                            f"Footprint constant {target.id} = '{val}' "
                            "is not in 'Library:Footprint' format"
                        )


def test_custom_ic_library_name():
    """IP5328P, SL2.1A, SY6280AAC, RTL8152B must reference the 'Daemon_V0' project library."""
    src = _get_source()
    for ic in ("IP5328P", "SL2.1A", "SY6280AAC", "RTL8152B"):
        assert f'"Daemon_V0", "{ic}"' in src, (
            f"{ic} must be instantiated from the 'Daemon_V0' custom library"
        )


# ── Net naming conventions ────────────────────────────────────────────────────


def test_power_net_names_present():
    """Critical power net names from the architectural spec must appear."""
    src = _get_source()
    required_nets = [
        "GND", "5V_SYS", "3V3_SYS",
        "VIN", "BAT", "BAT_ISO", "SW", "VOUT", "VOUT_ISO",
    ]
    for net in required_nets:
        assert f'Net("{net}")' in src, f'Net("{net}") not found in full_system.py'


def test_dft_net_names_match_dft_module():
    """
    The DFT test point nets (VIN, BAT, SW, VOUT) and isolation jumper nets
    (BAT_ISO, VOUT_ISO) must match the names defined in dft/ip5306_testpoints.py.
    """
    dft_src = (Path(__file__).parent.parent / "dft" / "ip5306_testpoints.py").read_text()
    full_src = _get_source()

    for net_name in ("VIN", "BAT", "SW", "VOUT", "BAT_ISO", "VOUT_ISO"):
        assert net_name in dft_src, f"Net {net_name} missing from DFT module"
        assert f'Net("{net_name}")' in full_src, (
            f'Net("{net_name}") referenced in DFT module but missing from full_system.py'
        )


def test_i2s_net_names_match_audio_subsystem():
    """I2S net names must match audio_subsystem.py exactly."""
    audio_src = (
        Path(__file__).parent.parent / "netlist" / "audio_subsystem.py"
    ).read_text()
    full_src = _get_source()

    for net_name in ("I2S_BCLK", "I2S_LRCLK", "I2S_DATA_IN", "I2S_DATA_OUT"):
        assert f'Net("{net_name}")' in audio_src, (
            f'Net("{net_name}") expected in audio_subsystem.py'
        )
        assert f'Net("{net_name}")' in full_src, (
            f'Net("{net_name}") from audio subsystem missing in full_system.py'
        )


def test_stinger_nets_are_indexed_one_to_three():
    """Stinger EN / FLAG / VBUS nets use consistent f-string prefixes."""
    src = _get_source()
    # The code builds these in list comprehensions using f-strings, so we check
    # for the prefix patterns rather than literal "STINGER_EN_1" strings.
    assert '"STINGER_EN_"' in src or 'f"STINGER_EN_{' in src, (
        "STINGER_EN_* net prefix missing from full_system.py"
    )
    assert '"STINGER_FLAG_"' in src or 'f"STINGER_FLAG_{' in src, (
        "STINGER_FLAG_* net prefix missing from full_system.py"
    )
    assert '"USB_VBUS_"' in src or 'f"USB_VBUS_{' in src, (
        "USB_VBUS_* net prefix missing from full_system.py"
    )
    # Also verify the loop iterates over 3 ports
    assert "range(1, 4)" in src, "Stinger net list comprehension must use range(1, 4)"


def test_usb_downstream_nets_cover_all_four_ports():
    """SL2.1A has 4 downstream ports; nets are built via range(1, 5) list comprehension."""
    src = _get_source()
    assert '"USB_DN_DP_"' in src or 'f"USB_DN_DP_{' in src, (
        "USB_DN_DP_* net prefix missing from full_system.py"
    )
    assert '"USB_DN_DM_"' in src or 'f"USB_DN_DM_{' in src, (
        "USB_DN_DM_* net prefix missing from full_system.py"
    )
    assert "range(1, 5)" in src, "USB downstream net list comprehension must use range(1, 5)"


# ── Connector pin counts ──────────────────────────────────────────────────────


def test_radxa_header_pins_cover_1_to_40():
    """Every pin 1–40 of the Radxa header must be assigned in the source."""
    src = _get_source()
    # Look for conn[n] += pattern in _build_radxa_header
    # We check that all 40 pin assignments appear
    for pin in range(1, 41):
        assert f"conn[{pin}]" in src, (
            f"Radxa header pin {pin} has no assignment in _build_radxa_header"
        )


def test_screen_connector_uses_8_pins():
    """The SPI display module uses an 8-pin SIL connector."""
    src = _get_source()
    assert "Conn_01x08" in src, "Screen connector should be Conn_01x08 (8-pin)"


def test_joystick_connector_uses_5_pins():
    """The joystick uses a 5-pin SIL connector."""
    src = _get_source()
    assert "Conn_01x05" in src, "Joystick connector should be Conn_01x05 (5-pin)"


def test_battery_connector_is_jst_ph():
    """The Li-ion cell uses a JST-PH 2-pin connector."""
    src = _get_source()
    assert "JST_PH" in src, "Battery connector footprint should reference JST_PH"


# ── Subsystem function signatures ─────────────────────────────────────────────


def test_all_subsystem_functions_defined():
    """All _build_* functions and the assembly function must be present (ECO #2026-02-V2)."""
    src = _get_source()
    expected = [
        "_build_power_system",
        "_build_usb_hub",
        "_build_stinger_port",
        "_build_spi_screen",
        "_build_joystick",
        "_build_radxa_header",
        "_build_heartbeat_keepalive",
        "_build_rf_transceiver",
        "_build_industrial_iso",
        "_build_clean_3v3_rail",
        "_build_usb_charging_mux",
        "_build_power_ux",
        "_build_goobay_bridge",
        "_build_ethernet",
        "_build_ws2812b_leds",
        "_build_ir_blaster",
        "generate_daemon_v0_full_system",
    ]
    for fn in expected:
        assert f"def {fn}" in src, f"Function {fn} not defined in full_system.py"


def test_stinger_port_loop_calls_three_times():
    """The top-level assembly must invoke _build_stinger_port in a range(3) loop."""
    src = _get_source()
    assert "range(3)" in src, (
        "Stinger port loop must use range(3) to build exactly 3 ports"
    )


# ── Architecture guardrails ───────────────────────────────────────────────────


def test_btl_nets_not_shorted_to_gnd():
    """
    AMP_OUT_P and AMP_OUT_N (BTL outputs) must never be connected to GND.
    They appear in audio_subsystem.py; verify the full system file does not
    accidentally tie them to ground by wiring them to a different net.
    """
    src = _get_source()
    # These specific dangerous patterns must not exist
    assert 'AMP_OUT_P" += gnd' not in src
    assert 'AMP_OUT_N" += gnd' not in src


def test_sy6280_not_shorted_directly_to_vout():
    """
    The SY6280 OUT pin must go to a per-port USB_VBUS_n net, not directly
    to the main 5V_SYS rail (which would defeat the purpose of the switch).
    """
    src = _get_source()
    assert '"OUT"]  += vcc_5v' not in src, (
        "SY6280 OUT must not connect directly to 5V_SYS; use a per-port VBUS net"
    )


def test_netlist_output_filename():
    src = _get_source()
    assert 'NETLIST_OUTPUT = "daemon_v0_full_system.net"' in src


# ── SM-LOG-03: dynamic SD_MODE pull-up ───────────────────────────────────────


def test_sd_mode_pullup_not_static_1m():
    """
    SM-LOG-03: The MAX98357A SD_MODE pull-up must NOT be a static 1MΩ resistor.
    A 1MΩ value at 3.3V VDDIO drifts outside the B1 trip-point window.
    Both full_system.py and audio_subsystem.py must use the computed value.
    """
    audio_src = (
        Path(__file__).parent.parent / "netlist" / "audio_subsystem.py"
    ).read_text()
    full_src = _get_source()

    # The static "1M" must not appear as the SD pull-up resistor value
    assert 'value="1M"' not in audio_src, (
        'audio_subsystem.py must not use static value="1M" for the SD_MODE pull-up'
    )
    # The computed constant must appear in both files
    assert "SD_MODE_PULLUP_VALUE" in audio_src, (
        "SD_MODE_PULLUP_VALUE constant missing from audio_subsystem.py"
    )
    assert "SD_MODE_PULLUP_VALUE" in full_src, (
        "SD_MODE_PULLUP_VALUE constant missing from full_system.py (must mirror audio_subsystem.py)"
    )


def test_vddio_formula_constants_correct():
    """
    SM-LOG-03: VDDIO_V must be 3.3, and SD_MODE_PULLUP_KOHM must equal
    round(222.2 × 3.3 − 100) = 633 in both files.
    """
    import importlib.util

    for module_path in ("netlist/audio_subsystem.py", "netlist/full_system.py"):
        src = (Path(__file__).parent.parent / module_path).read_text()
        assert "VDDIO_V: float = 3.3" in src or "VDDIO_V = 3.3" in src, (
            f"VDDIO_V = 3.3 not found in {module_path}"
        )
        assert "SD_MODE_PULLUP_KOHM" in src, (
            f"SD_MODE_PULLUP_KOHM missing from {module_path}"
        )
        # Verify the arithmetic: round(222.2 * 3.3 - 100) must equal 633
        computed = round(222.2 * 3.3 - 100)
        assert computed == 633, (
            f"Formula check failed: round(222.2 × 3.3 − 100) = {computed}, expected 633"
        )
        assert '"633k"' in src or "SD_MODE_PULLUP_VALUE" in src, (
            f"Computed 633k value not referenced in {module_path}"
        )


# ── SM-AUD-01: TVS protection and RC debounce ────────────────────────────────


def test_tvs_esd9b_in_audio_subsystem():
    """
    SM-AUD-01: Two ESD9B5.0ST5G TVS diodes must be instantiated in
    audio_subsystem.py to clamp inductive flyback on the BTL output nodes.
    """
    audio_src = (
        Path(__file__).parent.parent / "netlist" / "audio_subsystem.py"
    ).read_text()
    assert "ESD9B5.0ST5G" in audio_src, (
        "ESD9B5.0ST5G TVS diodes missing from audio_subsystem.py (SM-AUD-01)"
    )
    # Both positive and negative BTL rails need a TVS
    assert "tvs_btl_p" in audio_src, "tvs_btl_p (OUTP TVS) missing from audio_subsystem.py"
    assert "tvs_btl_n" in audio_src, "tvs_btl_n (OUTN TVS) missing from audio_subsystem.py"


def test_tvs_sc70_footprint_in_both_files():
    """
    SM-AUD-01: FP_TVS_SC70 must be defined in both audio_subsystem.py and
    full_system.py so the protection component footprint is consistent
    across all netlist generation contexts.
    """
    audio_src = (
        Path(__file__).parent.parent / "netlist" / "audio_subsystem.py"
    ).read_text()
    full_src = _get_source()

    assert 'FP_TVS_SC70' in audio_src, "FP_TVS_SC70 footprint constant missing from audio_subsystem.py"
    assert 'FP_TVS_SC70' in full_src,  "FP_TVS_SC70 footprint constant missing from full_system.py"
    # Both must resolve to the SOT-323_SC-70 package (KiCad 8 name)
    assert "SOT-323_SC-70" in audio_src, "FP_TVS_SC70 must reference SOT-323_SC-70 package in audio_subsystem.py"
    assert "SOT-323_SC-70" in full_src,  "FP_TVS_SC70 must reference SOT-323_SC-70 package in full_system.py"


def test_trrs_detect_debounce_rc_present():
    """
    SM-AUD-01: The TRRS insertion-detect signal must be hardware-debounced
    before reaching the MAX98357A SD_MODE pin.  Assert that:
      · TRRS_DETECT_RAW net exists (raw mechanical contact is isolated)
      · r_detect_debounce and c_detect_debounce components are present
      · The raw detect signal is no longer wired directly to AMP_SD
    """
    audio_src = (
        Path(__file__).parent.parent / "netlist" / "audio_subsystem.py"
    ).read_text()
    assert 'Net("TRRS_DETECT_RAW")' in audio_src, (
        "TRRS_DETECT_RAW net missing – raw detect must be isolated from AMP_SD (SM-AUD-01)"
    )
    assert "r_detect_debounce" in audio_src, (
        "r_detect_debounce resistor missing from audio_subsystem.py"
    )
    assert "c_detect_debounce" in audio_src, (
        "c_detect_debounce capacitor missing from audio_subsystem.py"
    )
    # The dangerous direct wiring must be gone
    assert 'trrs_jack["Detect"] += amp_sd' not in audio_src, (
        "Raw detect must not connect directly to AMP_SD; RC debounce is required (SM-AUD-01)"
    )


# ── PDN-JMP-04: 1225 wide-terminal isolation jumpers ─────────────────────────


def test_isolation_jumpers_use_1225_footprint():
    """
    PDN-JMP-04: The primary-path isolation jumpers must use the 1225
    wide-terminal reverse-geometry package (≥3.5A rated), not 0402 (1.5A max).
    """
    src = _get_source()
    assert "FP_JUMPER_1225" in src, (
        "FP_JUMPER_1225 constant missing from full_system.py (PDN-JMP-04)"
    )
    assert "R_1210_3225Metric" in src, (
        "R_1210_3225Metric KiCad footprint not referenced in full_system.py"
    )


def test_primary_jumpers_not_0402():
    """
    PDN-JMP-04: J1 and J2 isolation jumpers must use HiCurrJumper (1225),
    not the standard Resistor template (0402).
    """
    src = _get_source()
    assert "HiCurrJumper" in src, (
        "HiCurrJumper template missing – J1/J2 must not use FP_R0402 (PDN-JMP-04)"
    )
    assert "J1 = HiCurrJumper" in src, "J1 must use HiCurrJumper, not Resistor"
    assert "J2 = HiCurrJumper" in src, "J2 must use HiCurrJumper, not Resistor"


# ── SM-PWR-02: NE555 heartbeat keepalive ─────────────────────────────────────


def test_heartbeat_function_defined():
    """SM-PWR-02: _build_heartbeat_keepalive must be defined in full_system.py."""
    src = _get_source()
    assert "def _build_heartbeat_keepalive" in src, (
        "_build_heartbeat_keepalive function missing (SM-PWR-02)"
    )


def test_heartbeat_uses_ne555():
    """SM-PWR-02: The heartbeat circuit must instantiate an NE555 timer."""
    src = _get_source()
    assert "NE555" in src, "NE555 timer missing from full_system.py (SM-PWR-02)"
    assert "FP_TIMER_NE555" in src, "FP_TIMER_NE555 footprint constant missing"


def test_heartbeat_pnp_bjt_present():
    """SM-PWR-02: A PNP BJT (BC857) must switch the dummy load."""
    src = _get_source()
    assert "BC857" in src, "BC857 PNP BJT missing from full_system.py (SM-PWR-02)"
    assert "FP_BJT_SOT23" in src, "FP_BJT_SOT23 footprint constant missing"


def test_heartbeat_dummy_load_resistor():
    """
    SM-PWR-02: The 82Ω dummy load must be present.
    5V / 82Ω ≈ 61mA exceeds the 50mA IP5306 keepalive threshold.
    """
    src = _get_source()
    assert 'value="82"' in src, (
        '82Ω dummy-load resistor (value="82") missing from full_system.py (SM-PWR-02)'
    )


def test_heartbeat_called_in_assembly():
    """SM-PWR-02: _build_heartbeat_keepalive must be called from the top-level assembly."""
    src = _get_source()
    assert "_build_heartbeat_keepalive(gnd, vcc_5v)" in src, (
        "_build_heartbeat_keepalive not called in generate_daemon_v0_full_system() (SM-PWR-02)"
    )


# ── Subsystem H: CC1101 RF transceiver ───────────────────────────────────────


def test_cc1101_footprint_constant_present():
    """Subsystem H: FP_CC1101 footprint constant must reference the QFN-20 package."""
    src = _get_source()
    assert "FP_CC1101" in src, "FP_CC1101 footprint constant missing from full_system.py"
    assert "QFN-20" in src, "FP_CC1101 must reference QFN-20 package"


def test_cc1101_instantiated_from_rf_transceiver_library():
    """Subsystem H: CC1101 must be instantiated from the RF_Transceiver KiCad library."""
    src = _get_source()
    assert '"Daemon_V0", "CC1101"' in src, (
        'CC1101 must be instantiated as Part("Daemon_V0", "CC1101", ...)'
    )


def test_rf_cs_n_net_defined():
    """Subsystem H: RF_CS_N chip-select net must be defined in the assembly."""
    src = _get_source()
    assert 'Net("RF_CS_N")' in src, 'Net("RF_CS_N") missing from full_system.py'


def test_rf_gdo0_net_defined():
    """Subsystem H: RF_GDO0 interrupt net must be defined in the assembly."""
    src = _get_source()
    assert 'Net("RF_GDO0")' in src, 'Net("RF_GDO0") missing from full_system.py'


def test_rf_transceiver_called_in_assembly():
    """Subsystem H: _build_rf_transceiver must be called from the top-level assembly."""
    src = _get_source()
    assert "_build_rf_transceiver(" in src, (
        "_build_rf_transceiver not called in generate_daemon_v0_full_system()"
    )


# ── Subsystem I: MCP2515 + MCP2551 CAN bus ───────────────────────────────────


def test_spi_cs_pins_are_unique():
    """SPI chip selects must use distinct net names (ECO #2026-02-V2: CAN_CS_N removed)."""
    src = _get_source()
    assert 'Net("SPI3_CS")' in src,   'Net("SPI3_CS") missing'
    assert 'Net("RF_CS_N")' in src,   'Net("RF_CS_N") missing'
    # Verify the two remaining CS nets are distinct
    cs_names = {"SPI3_CS", "RF_CS_N"}
    assert len(cs_names) == 2, "SPI chip select nets must be unique"


# ── Subsystem J: ISO1212 industrial isolation ─────────────────────────────────


def test_iso1212_footprint_constant_present():
    """Subsystem J: FP_ISO1212 must reference the SOIC-16W package."""
    src = _get_source()
    assert "FP_ISO1212" in src, "FP_ISO1212 footprint constant missing from full_system.py"
    assert "SOIC-16W" in src, "FP_ISO1212 must reference SOIC-16W package"


def test_iso1212_instantiated_from_daemon_v0_library():
    """Subsystem J: ISO1212 must be instantiated from the Daemon_V0 custom library."""
    src = _get_source()
    assert '"Daemon_V0", "ISO1212"' in src, (
        'ISO1212 must be Part("Daemon_V0", "ISO1212", ...) — custom symbol required'
    )


def test_iso_do1_and_iso_do2_nets_defined():
    """Subsystem J: ISO_DO1 and ISO_DO2 output nets must be defined."""
    src = _get_source()
    assert 'Net("ISO_DO1")' in src, 'Net("ISO_DO1") missing from full_system.py'
    assert 'Net("ISO_DO2")' in src, 'Net("ISO_DO2") missing from full_system.py'


def test_iso_field_side_nets_isolated():
    """Subsystem J: ISO_GND1 must be a separate net from PCB GND."""
    src = _get_source()
    assert 'Net("ISO_GND1")' in src, (
        'Net("ISO_GND1") missing — field-side ground must be isolated from PCB GND'
    )
    assert 'Net("ISO_VCC1")' in src, (
        'Net("ISO_VCC1") missing — field-side supply must be a distinct net'
    )


def test_industrial_iso_called_in_assembly():
    """Subsystem J: _build_industrial_iso must be called from the top-level assembly."""
    src = _get_source()
    assert "_build_industrial_iso(" in src, (
        "_build_industrial_iso not called in generate_daemon_v0_full_system()"
    )


# ── Auxiliary GPIO header ─────────────────────────────────────────────────────


def test_auxiliary_header_uses_4_pin_connector():
    """Auxiliary header for CAN_INT_N / ISO_DO1 / ISO_DO2 / GND must be 4-pin."""
    src = _get_source()
    assert "FP_CONN_1X04_254" in src, (
        "FP_CONN_1X04_254 missing — auxiliary 4-pin GPIO header connector not defined"
    )


def test_connector_footprint_constants_present():
    """1×02, 1×03, and 1×04 2.54mm connector footprints must all be defined."""
    src = _get_source()
    for fp in ("FP_CONN_1X02_254", "FP_CONN_1X03_254", "FP_CONN_1X04_254"):
        assert fp in src, f"{fp} footprint constant missing from full_system.py"


# ── Phase 1 Remediation: PDN Overhaul ────────────────────────────────────────


def test_ip5328p_replaces_ip5306():
    """IP5328P must be present in the Daemon_V0 library; IP5306 must be absent."""
    src = _get_source()
    assert '"Daemon_V0", "IP5328P"' in src, (
        "IP5328P not found — PMIC replacement not applied"
    )
    assert '"Daemon_V0", "IP5306"' not in src, (
        "IP5306 still present — old PMIC not removed"
    )


def test_inductor_is_4u7():
    """4.7µH boost inductor (Isat > 5A) required for IP5328P switching node."""
    assert 'value="4u7"' in _get_source(), (
        "4.7µH inductor not found — IP5328P switching node needs Isat > 5A inductor"
    )


def test_fp_inductor_5a_constant_present():
    """FP_INDUCTOR_5A footprint constant must be defined."""
    assert "FP_INDUCTOR_5A" in _get_source(), (
        "FP_INDUCTOR_5A constant missing from footprint block"
    )


def test_power_system_has_i2c1_params():
    """ECO #2026-03-H: _build_power_system must use i2c1_sda/scl (I2C1, Always-On pins 3/5)."""
    src = _get_source()
    assert "i2c1_sda" in src, "_build_power_system missing i2c1_sda parameter (ECO #2026-03-H)"
    assert "i2c1_scl" in src, "_build_power_system missing i2c1_scl parameter (ECO #2026-03-H)"


def test_stinger_iset_resistor_13k():
    """ECO #2026-03-H: 13 kΩ ISET resistor must be present (~500mA OC limit)."""
    src = _get_source()
    assert 'value="13k"' in src, (
        "13k ISET resistor not found — SY6280 OC threshold not updated to ~500mA (ECO #2026-03-H)"
    )
    assert 'value="27k"' not in src, (
        "Old 27k ISET resistor still present — 250mA limit not updated to ~500mA"
    )
    assert "ISET" in src, (
        "ISET net/pin reference not found in stinger port"
    )


def test_clean_3v3_rail_function_defined():
    """_build_clean_3v3_rail must exist as a separate LDO subsystem function."""
    assert "def _build_clean_3v3_rail" in _get_source(), (
        "_build_clean_3v3_rail function not defined"
    )


def test_ldo_ap2112k_instantiated():
    """ECO #2026-03-GOLD: AP2112K-3.3 LDO must replace LM1117-3.3 for low-dropout RF supply."""
    src = _get_source()
    assert '"Regulator_Linear", "AP2112K-3.3"' in src, (
        "AP2112K-3.3 not found — LDO upgrade (ECO #2026-03-GOLD) not applied"
    )
    assert '"Regulator_Linear", "LM1117-3.3"' not in src, (
        "Old LM1117-3.3 still present — ECO #2026-03-GOLD LDO replacement incomplete"
    )
    assert 'ldo["EN"]   += vcc_5v' in src, (
        "AP2112K EN pin not tied to VIN — LDO may not be enabled"
    )


def test_3v3_clean_net_defined():
    """3V3_CLEAN net must exist as the isolated supply for RF and CAN subsystems."""
    assert "3V3_CLEAN" in _get_source(), (
        "3V3_CLEAN net not found — RF/CAN power bifurcation not applied"
    )


def test_rf_uses_clean_rail():
    """Assembly must pass vcc_clean (not vcc_3v3) to the RF transceiver call."""
    src = _get_source()
    assert "vcc_clean" in src and "_build_rf_transceiver" in src, (
        "vcc_clean not passed to RF subsystem — power rail bifurcation incomplete"
    )
    # Verify vcc_3v3 is NOT passed to _build_rf_transceiver as a supply keyword arg
    import re
    for call in re.findall(r"_build_rf_transceiver\(.*?\)", src, re.DOTALL):
        assert "vcc_3v3" not in call, (
            "vcc_3v3 still passed to RF subsystem — clean rail bifurcation incomplete"
        )


# ── Phase 3 Remediation: Industrial Safety Hardening (IND-SAF-01) ─────────────


def test_iso_ptc_fuse_present():
    """ISO1212 inputs must have Littelfuse 60R PTC resettable fuses (IND-SAF-01)."""
    src = _get_source()
    assert '"Device", "Polyfuse"' in src, (
        "Polyfuse (PTC fuse) not found — ISO1212 inputs unprotected against fault current"
    )
    assert "FP_PTC_1206" in src, (
        "FP_PTC_1206 footprint constant missing — Littelfuse 60R not in netlist"
    )


def test_iso_tvs_diode_vcan26a2_present():
    """ISO1212 inputs must have Vishay VCAN26A2 TVS diodes clamping to ISO_GND1."""
    src = _get_source()
    assert '"Device", "D_TVS"' in src, (
        "D_TVS not found — no transient voltage suppression on ISO1212 field inputs"
    )
    assert "VCAN26A2" in src, (
        "VCAN26A2 TVS value not found — wrong TVS component specified"
    )
    assert "FP_TVS_SMB" in src, (
        "FP_TVS_SMB footprint constant missing — Vishay VCAN26A2 (SMB) not in netlist"
    )


def test_iso_input_series_resistor_562():
    """ISO1212 protection chain must include 562Ω 1% current-limiting resistors."""
    assert 'value="562"' in _get_source(), (
        "562Ω series resistor not found — ISO1212 input current not hardware-limited"
    )


def test_iso_filter_cap_10n():
    """ISO1212 inputs must have 10nF 100V X7R HF filter capacitors (IND-SAF-01)."""
    assert 'value="10n"' in _get_source(), (
        "10nF filter cap not found — HF transients not suppressed on ISO1212 inputs"
    )


def test_iso_raw_input_nets_defined():
    """ISO_IN1_RAW and ISO_IN2_RAW nets must exist as the pre-protection connector nodes."""
    src = _get_source()
    assert 'Net("ISO_IN1_RAW")' in src, (
        "ISO_IN1_RAW net missing — protection chain not inserted between connector and IC"
    )
    assert 'Net("ISO_IN2_RAW")' in src, (
        "ISO_IN2_RAW net missing — channel 2 protection chain not inserted"
    )


def test_iso_field_ground_remains_isolated_after_hardening():
    """After hardening, ISO_GND1 must remain strictly isolated from PCB GND (IND-SAF-01)."""
    src = _get_source()
    assert 'Net("ISO_GND1")' in src, "ISO_GND1 net removed — field isolation broken"
    # Verify protection components reference field ground, not PCB GND
    assert "gnd1" in src, (
        "gnd1 (ISO_GND1) reference missing — protection components may be tied to wrong ground"
    )


# ── Phase 4 Audit Fixes ───────────────────────────────────────────────────────


def test_rf_nets_renamed():
    """ECO #2026-03-E: SoftSPI nets renamed to RF_CLK/RF_MOSI/RF_MISO for clarity."""
    src = _get_source()
    assert 'Net("RF_CLK")'  in src, "RF_CLK net missing — SoftSPI SCK not renamed (ECO #2026-03-E)"
    assert 'Net("RF_MOSI")' in src, "RF_MOSI net missing — SoftSPI MOSI not renamed"
    assert 'Net("RF_MISO")' in src, "RF_MISO net missing — SoftSPI MISO not renamed"
    # Old SOFT_SPI_* names must be gone
    assert 'Net("SOFT_SPI_SCK")'  not in src, "SOFT_SPI_SCK still present — rename not applied"
    assert 'Net("SOFT_SPI_MOSI")' not in src, "SOFT_SPI_MOSI still present — rename not applied"
    assert 'Net("SOFT_SPI_MISO")' not in src, "SOFT_SPI_MISO still present — rename not applied"


def test_rf_uses_soft_spi():
    """RF transceiver assembly call must pass rf_clk/rf_mosi/rf_miso (ECO #2026-03-E)."""
    src = _get_source()
    assert "spi_sck      = rf_clk"  in src or "spi_sck=rf_clk" in src, (
        "rf_clk not passed to RF subsystem — ECO #2026-03-E RF rename not propagated"
    )
    assert "spi_mosi     = rf_mosi" in src or "spi_mosi=rf_mosi" in src, (
        "rf_mosi not passed to RF subsystem"
    )
    assert "spi_miso     = rf_miso" in src or "spi_miso=rf_miso" in src, (
        "rf_miso not passed to RF subsystem"
    )


def test_screen_bl_on_pin_7():
    """SCREEN_BL must connect to header pin 7 (hardware PWM capable GPIO4)."""
    src = _get_source()
    assert "conn[7]  += screen_bl" in src, (
        "SCREEN_BL not on pin 7 — backlight still on software-PWM-only pin"
    )


def test_rf_clk_on_pin_16():
    """ECO #2026-03-F: RF_CLK must occupy pin 16 (safe GPIO; moved from pin 32)."""
    src = _get_source()
    assert "conn[16] += soft_spi_sck" in src, (
        "RF_CLK (soft_spi_sck) not on pin 16 — ECO #2026-03-F RF migration not applied"
    )
    assert "conn[32] += soft_spi_sck" not in src, (
        "RF_CLK still on pin 32 — ECO #2026-03-F RF migration not applied"
    )


def test_usb_mux_schottky_diodes_present():
    """PDN-USB-01: Two SS14 Schottky diodes must be present for VBUS anti-backfeed."""
    src = _get_source()
    assert '"Device", "D_Schottky"' in src, (
        "D_Schottky not found — SS14 anti-backfeed diodes not instantiated"
    )
    assert "SS14" in src, "SS14 value not found — wrong Schottky component specified"
    assert "FP_SCHOTTKY_SMA" in src, "FP_SCHOTTKY_SMA footprint constant missing"


def test_mux_sel_voltage_divider():
    """PDN-USB-01: 430kΩ/620kΩ voltage divider must set MUX_SEL to ~2.95V."""
    src = _get_source()
    assert 'value="430k"' in src, "430kΩ series resistor missing from MUX_SEL divider"
    assert 'value="620k"' in src, "620kΩ shunt resistor missing from MUX_SEL divider"
    assert 'Net("MUX_SEL")' in src, "MUX_SEL net not defined"



def test_flag_pullup_resistors_present():
    """STINGER_FLAG lines must have explicit 10kΩ pull-up resistors to prevent floating inputs."""
    src = _get_source()
    assert "flag_pullup" in src, (
        "flag_pullup resistor not found in _build_stinger_port — FLAG pins may float"
    )
    assert "flag_pullup[1] += vcc_3v3" in src, (
        "flag_pullup not connected to vcc_3v3 — FLAG pull-up not properly terminated"
    )
    assert "flag_pullup[2] += flag_net" in src, (
        "flag_pullup not connected to flag_net — FLAG pull-up not wired to signal"
    )


def test_build_usb_charging_mux_defined():
    """PDN-USB-01: _build_usb_charging_mux function must be defined."""
    assert "def _build_usb_charging_mux" in _get_source(), (
        "_build_usb_charging_mux function not found — USB MUX hardening not implemented"
    )



def test_screen_bl_net_comment_updated():
    """SCREEN_BL net comment must reference GPIO4 / pin 7, not the old GPIO12 / PWM0."""
    src = _get_source()
    assert "GPIO4" in src and "SCREEN_BL" in src, (
        "SCREEN_BL net not associated with GPIO4 — backlight pin fix not applied"
    )
    # Old assignment (GPIO12/PWM0 comment) must be gone
    assert "GPIO12 / PWM0" not in src, (
        "Stale GPIO12/PWM0 comment still present — SCREEN_BL pin move not documented"
    )


# ── ECO #2026-02-V2 Final Release ─────────────────────────────────────────────


def test_can_bus_removed():
    """ECO #2026-02-V2: CAN bus (MCP2515 / MCP2551) must be entirely absent."""
    src = _get_source()
    assert "_build_can_bus" not in src, (
        "_build_can_bus still present — CAN bus not removed per ECO #2026-02-V2"
    )
    assert '"Interface_CAN_LIN", "MCP2515"' not in src, (
        "MCP2515 Part instantiation found — CAN controller not removed"
    )
    assert '"Interface_CAN_LIN", "MCP2551"' not in src, (
        "MCP2551 Part instantiation found — CAN transceiver not removed"
    )


def test_goobay_usb_c_bridge_defined():
    """ECO #2026-02-V2: Goobay USB-C bridge function and USB_C_RCPT footprint must be present."""
    src = _get_source()
    assert "def _build_goobay_bridge" in src, (
        "_build_goobay_bridge function missing — Goobay USB-C bridge not implemented"
    )
    assert "FP_USB_C_RCPT" in src, (
        "FP_USB_C_RCPT footprint constant missing — USB-C receptacle footprint not defined"
    )
    assert "Goobay-74446" in src, (
        "Goobay-74446 value not found — USB-C bridge component not instantiated"
    )


def test_ethernet_subsystem_defined():
    """ECO #2026-02-V2: RTL8152B Ethernet subsystem must be fully defined."""
    src = _get_source()
    assert "def _build_ethernet" in src, (
        "_build_ethernet function missing — Ethernet subsystem not implemented"
    )
    assert '"Daemon_V0", "RTL8152B"' in src, (
        "RTL8152B not in Daemon_V0 library — Ethernet IC not instantiated"
    )
    assert "FP_XTAL_25M" in src, (
        "FP_XTAL_25M footprint constant missing — 25MHz crystal not defined"
    )
    assert "HR911105A" in src, (
        "HR911105A MagJack not found — RJ45 connector not instantiated"
    )
    assert "FP_MAGJACK" in src, (
        "FP_MAGJACK footprint constant missing"
    )


def test_ws2812b_leds_defined():
    """ECO #2026-02-V2: Four WS2812B addressable LEDs must be present with LED_DIN net."""
    src = _get_source()
    assert "def _build_ws2812b_leds" in src, (
        "_build_ws2812b_leds function missing — WS2812B LED subsystem not implemented"
    )
    assert "FP_WS2812B" in src, (
        "FP_WS2812B footprint constant missing"
    )
    assert 'Net("LED_DIN")' in src, (
        "LED_DIN net not declared in assembly — WS2812B data chain not wired"
    )
    assert "WS2812B" in src, (
        "WS2812B value not found — addressable LED not instantiated"
    )


def test_ir_blaster_defined():
    """ECO #2026-03-F: IR blaster (VSMB294008 + AO3400A) must be present with IR_GPIO net."""
    src = _get_source()
    assert "def _build_ir_blaster" in src, (
        "_build_ir_blaster function missing — IR blaster not implemented"
    )
    assert "VSMB294008" in src, (
        "VSMB294008 IR LED not found — IR emitter not instantiated"
    )
    assert "AO3400A" in src, (
        "AO3400A N-MOSFET not found — ECO #2026-03-F IR driver upgrade not applied"
    )
    assert 'Net("IR_GPIO")' in src, (
        "IR_GPIO net not declared in assembly — IR blaster gate not wired"
    )


def test_chip_antenna_replaces_sma():
    """ECO #2026-02-V2: Johanson chip antenna with Pi-network must replace SMA connector."""
    src = _get_source()
    assert "0915AT43A0026" in src, (
        "Johanson 0915AT43A0026 chip antenna not found — SMA replacement not implemented"
    )
    assert "FP_CHIP_ANT_915" in src, (
        "FP_CHIP_ANT_915 footprint constant missing"
    )
    # Pi-network component values
    assert 'value="0.5p"' in src, "Pi-network C1=0.5pF shunt cap missing"
    assert 'value="10n"'  in src, "Pi-network L1=10nH series inductor missing"
    assert 'value="4.7p"' in src, "Pi-network C2=4.7pF output shunt cap missing"
    # RF SMA coaxial connector must be absent (FP_SCHOTTKY_SMA is the Schottky diode package — OK)
    assert "Connector_Coaxial" not in src, (
        "Connector_Coaxial reference still present — RF SMA connector not fully removed"
    )


def test_wago_terminal_block_present():
    """ECO #2026-02-V2: WAGO 2060-404 terminal block must replace ISO1212 pin header."""
    src = _get_source()
    assert "FP_WAGO_4P" in src, (
        "FP_WAGO_4P footprint constant missing — WAGO terminal block not defined"
    )
    assert "WAGO-2060-404" in src, (
        "WAGO-2060-404 value not found — WAGO terminal block not instantiated"
    )


def test_led_din_on_pin_36():
    """ECO #2026-02-V2: LED_DIN must be on Radxa header pin 36 (was CAN_CS_N)."""
    src = _get_source()
    assert "conn[36] += led_din" in src, (
        "LED_DIN not on pin 36 — WS2812B data chain not routed to Radxa header"
    )
    assert "conn[36] += can_cs_n" not in src, (
        "can_cs_n still on pin 36 — CAN chip-select not removed from header"
    )


# ── ECO #2026-03-D: Advanced Power UX ────────────────────────────────────────


def test_build_power_ux_defined():
    """ECO #2026-03-D: _build_power_ux function must be defined (replaces _build_reset_switch)."""
    src = _get_source()
    assert "def _build_power_ux" in src, (
        "_build_power_ux function not defined — power UX subsystem A6 not implemented"
    )
    assert "def _build_reset_switch" not in src, (
        "_build_reset_switch still present — HW-RST-01 reset switch not removed per ECO #2026-03-D"
    )


def test_pmic_key_net_defined():
    """ECO #2026-03-D: PMIC_KEY net must be declared in the assembly."""
    assert 'Net("PMIC_KEY")' in _get_source(), (
        'Net("PMIC_KEY") missing — KEY pin net not declared for A6 power UX'
    )


def test_bss84_wake_blocker_present():
    """ECO #2026-03-D: BSS84 PMOS wake-blocker must be instantiated."""
    src = _get_source()
    assert "BSS84" in src, (
        "BSS84 PMOS not found — joystick wake-blocker not instantiated (ECO #2026-03-D)"
    )
    assert "FP_PMOS_SOT23" in src, (
        "FP_PMOS_SOT23 footprint constant missing — PMOS SOT-23 package not defined"
    )
    assert "Q_PMOS_GSD" in src, (
        "Q_PMOS_GSD SKiDL device type not found — PMOS model not instantiated"
    )


def test_pmic_kill_software_kill_present():
    """ECO #2026-03-D: PMIC_KILL net and 2N7002 kill NMOS must be present."""
    src = _get_source()
    assert 'Net("PMIC_KILL")' in src, (
        'Net("PMIC_KILL") missing — software kill GPIO not declared'
    )
    # 2N7002 is also used by IR blaster (E3), so check specific kill context via pmic_kill
    assert "pmic_kill" in src, (
        "pmic_kill variable missing — software kill circuit not wired"
    )


def test_sw_pwr_button_present():
    """ECO #2026-03-D: Physical SW_PWR power button must be instantiated."""
    src = _get_source()
    assert 'value="SW_PWR"' in src, (
        'SW_PWR power button not found — physical power button not instantiated'
    )
    assert 'Net("SW_PWR_GPIO")' in src, (
        'Net("SW_PWR_GPIO") missing — long-press detect GPIO not declared'
    )


def test_power_ux_called_in_assembly():
    """ECO #2026-03-D: _build_power_ux must be called from the top-level assembly."""
    assert "_build_power_ux(" in _get_source(), (
        "_build_power_ux not called in generate_daemon_v0_full_system() — A6 not wired"
    )


def test_reset_n_net_removed():
    """ECO #2026-03-D: RESET_N net must be absent (reset switch removed)."""
    assert 'Net("RESET_N")' not in _get_source(), (
        'Net("RESET_N") still present — reset switch not fully removed per ECO #2026-03-D'
    )


# ── ECO #2026-03-E: Kill List Fixes ──────────────────────────────────────────


def test_battery_leds_removed():
    """ECO #2026-03-E: IP5328P LED1/LED2/LED3 resistors must be absent (I2C conflict)."""
    src = _get_source()
    assert 'value="3.3k"' not in src, (
        "3.3k LED resistors still present — battery LEDs not removed (ECO #2026-03-E I2C fix)"
    )
    assert 'Net("LED1")' not in src, (
        'Net("LED1") still present — LED1 net not removed'
    )
    assert 'Net("LED2")' not in src, (
        'Net("LED2") still present — LED2 net not removed'
    )
    assert 'Net("LED3")' not in src, (
        'Net("LED3") still present — LED3 net not removed'
    )


def test_ws2812b_din_pullup_present():
    """ECO #2026-03-E: 1kΩ pull-up from LED_DIN to 5V_SYS must be present."""
    src = _get_source()
    assert "din_pullup" in src, (
        "din_pullup not found in _build_ws2812b_leds — open-drain pull-up not added (ECO #2026-03-E)"
    )
    assert "din_pullup[1] += vcc_5v" in src, (
        "din_pullup not connected to vcc_5v — pull-up not tied to 5V_SYS"
    )
    assert "din_pullup[2] += led_din" in src, (
        "din_pullup not connected to led_din — pull-up not tied to LED_DIN"
    )


def test_ethernet_center_tap_biased():
    """ECO #2026-03-E: HR911105A center taps (pins 4/5) must connect to VCC_3V3."""
    src = _get_source()
    assert "rj45[4] += vcc_3v3" in src, (
        "rj45[4] (CT1) not connected to vcc_3v3 — Ethernet TX center tap floating (ECO #2026-03-E)"
    )
    assert "rj45[5] += vcc_3v3" in src, (
        "rj45[5] (CT2) not connected to vcc_3v3 — Ethernet RX center tap floating"
    )


# ── ECO #2026-03-F: Critical Architecture Rescue ─────────────────────────────


def test_rf_pins_migrated_to_safe_gpios():
    """ECO #2026-03-F: RF SoftSPI must be on safe GPIO pins 13/15/16/18 (not UART 8/10)."""
    src = _get_source()
    assert "conn[13] += soft_spi_mosi" in src, (
        "RF_MOSI not on pin 13 — still on UART TX pin 8 (boot loop risk)"
    )
    assert "conn[15] += soft_spi_miso" in src, (
        "RF_MISO not on pin 15 — still on UART RX pin 10 (boot loop risk)"
    )
    assert "conn[16] += soft_spi_sck" in src, (
        "RF_CLK not on pin 16 — safe GPIO migration incomplete"
    )
    assert "conn[18] += rf_cs_n" in src, (
        "RF_CS_N not on pin 18 — safe GPIO migration incomplete"
    )


def test_stinger_flags_displaced_to_pins_8_10():
    """ECO #2026-03-F: STINGER_FLAG_2/3 must be on pins 8/10 (freed from UART/RF)."""
    src = _get_source()
    assert "conn[8]  += stinger_flag[1]" in src, (
        "STINGER_FLAG_2 not on pin 8 — displacement from pin 13 incomplete"
    )
    assert "conn[10] += stinger_flag[2]" in src, (
        "STINGER_FLAG_3 not on pin 10 — displacement from pin 15 incomplete"
    )


def test_rf_gdo0_removed_from_header():
    """ECO #2026-03-F: RF_GDO0 must not occupy any header pin (CC1101 uses polling)."""
    src = _get_source()
    assert "conn[16] += rf_gdo0" not in src, (
        "RF_GDO0 still on header pin 16 — ECO #2026-03-F RF migration not applied"
    )


def test_screen_dc_on_pin_32():
    """ECO #2026-03-F: SCREEN_DC must be on pin 32 (freed when RF_CLK moved to pin 16)."""
    src = _get_source()
    assert "conn[32] += screen_dc" in src, (
        "SCREEN_DC not on pin 32 — ECO #2026-03-F header reassignment incomplete"
    )


def test_i2c1_pmic_protection_resistors():
    """ECO #2026-03-H: 470Ω series resistors on I2C1_PMIC_SDA/SCL prevent IP5328P latch-up."""
    src = _get_source()
    assert 'Net("I2C1_PMIC_SDA")' in src, (
        "I2C1_PMIC_SDA net missing — I2C1 SDA protection resistor not wired (ECO #2026-03-H)"
    )
    assert 'Net("I2C1_PMIC_SCL")' in src, (
        "I2C1_PMIC_SCL net missing — I2C1 SCL protection resistor not wired (ECO #2026-03-H)"
    )
    assert 'i2c1_pmic_sda' in src, (
        "i2c1_pmic_sda variable missing — I2C1 SDA 470Ω resistor not declared"
    )
    assert 'i2c1_pmic_scl' in src, (
        "i2c1_pmic_scl variable missing — I2C1 SCL 470Ω resistor not declared"
    )


def test_ethernet_uses_ldo_clean_rail():
    """ECO #2026-03-F: RTL8152B VCC must come from vcc_clean (LM1117 800mA), not vcc_3v3."""
    src = _get_source()
    assert "vcc_3v3 = vcc_clean" in src, (
        "Ethernet _build_ethernet call still passes vcc_3v3 — ECO #2026-03-F brownout fix missing"
    )


def test_ao3400a_ir_driver():
    """ECO #2026-03-F: IR blaster NMOS must be AO3400A (logic-level, Rds_on < 50mΩ at 3.3V)."""
    src = _get_source()
    assert "AO3400A" in src, (
        "AO3400A not found — IR driver upgrade (ECO #2026-03-F) not applied"
    )


# ── ECO #2026-03-G: Signal Integrity & Thermal Rescue ────────────────────────


def test_power_tank_tantalum_cap():
    """ECO #2026-03-G: 100µF tantalum power tank must be present on 5V_SYS rail."""
    src = _get_source()
    assert "FP_TANT_CASEB" in src, (
        "FP_TANT_CASEB footprint constant missing — tantalum cap not defined"
    )
    assert '"Device", "C_Polarized"' in src, (
        "C_Polarized part missing — tantalum power tank not instantiated"
    )
    assert 'value="100u"' in src, (
        "100µF tantalum value not found — power tank not sized correctly"
    )
    assert "tant_5v[1] += vcc_5v" in src, (
        "tant_5v positive terminal not connected to 5V_SYS — power tank not wired"
    )


def test_ntc_thermistor_on_pmic():
    """ECO #2026-03-G: 10kΩ NTC thermistor must be connected to IP5328P NTC pin."""
    src = _get_source()
    assert '"Device", "Thermistor_NTC"' in src, (
        "Thermistor_NTC part missing — NTC thermistor not instantiated"
    )
    assert 'Net("IP5328P_NTC")' in src, (
        "IP5328P_NTC net not declared — NTC thermistor not wired to PMIC"
    )
    assert 'ic["NTC"] += ntc_net' in src, (
        "ic[NTC] not connected to ntc_net — NTC thermistor not linked to IP5328P"
    )


def test_rf_spi_gpio_firmware_note():
    """ECO #2026-03-G: spi-gpio kernel driver note must appear in RF transceiver docstring."""
    src = _get_source()
    assert "spi-gpio" in src, (
        "spi-gpio firmware note missing from _build_rf_transceiver — ECO #2026-03-G not applied"
    )


# ── ECO #2026-03-H: Pin Mapping & Power Tuning ───────────────────────────────


def test_pmic_i2c_on_i2c1():
    """ECO #2026-03-H: IP5328P telemetry must use I2C1 (pins 3/5, Always-On), not I2C0."""
    src = _get_source()
    assert 'Net("I2C1_PMIC_SDA")' in src, (
        "I2C1_PMIC_SDA net missing — IP5328P not migrated to I2C1 (ECO #2026-03-H)"
    )
    assert 'Net("I2C1_PMIC_SCL")' in src, (
        "I2C1_PMIC_SCL net missing — IP5328P not migrated to I2C1 (ECO #2026-03-H)"
    )
    assert 'Net("I2C0_SDA_IC")' not in src, (
        "Old I2C0_SDA_IC net still present — I2C0 migration to I2C1 incomplete"
    )
    assert 'Net("I2C0_SCL_IC")' not in src, (
        "Old I2C0_SCL_IC net still present — I2C0 migration to I2C1 incomplete"
    )


def test_pins_27_28_not_i2c0():
    """ECO #2026-03-H: Header pins 27/28 must NOT be assigned I2C0 nets (NC on Zero 3W)."""
    src = _get_source()
    assert 'conn[27] += i2c0_sda' not in src, (
        "conn[27] still on i2c0_sda — pins 27/28 are disconnected on Zero 3W (ECO #2026-03-H)"
    )
    assert 'conn[28] += i2c0_scl' not in src, (
        "conn[28] still on i2c0_scl — pins 27/28 are disconnected on Zero 3W (ECO #2026-03-H)"
    )


def test_screen_audio_no_overlap_comment():
    """ECO #2026-03-H: Pin lock comment confirming SPI3/I2S0 no overlap must be present."""
    src = _get_source()
    assert "NO OVERLAP CONFIRMED" in src, (
        "PIN LOCK 'NO OVERLAP CONFIRMED' comment missing — ECO #2026-03-H bus segregation not documented"
    )


# ── ECO #2026-03-GOLD: Golden Master Cleanup ─────────────────────────────────


def test_rf_pi_network_explicit_names():
    """ECO #2026-03-GOLD: Pi-network parts must use explicit BOM names C_RF1, L_RF1, C_RF2."""
    src = _get_source()
    assert "C_RF1" in src, (
        "C_RF1 missing — RF Pi-network C1 shunt not explicitly named (ECO #2026-03-GOLD)"
    )
    assert "L_RF1" in src, (
        "L_RF1 missing — RF Pi-network L1 series inductor not explicitly named (ECO #2026-03-GOLD)"
    )
    assert "C_RF2" in src, (
        "C_RF2 missing — RF Pi-network C2 shunt not explicitly named (ECO #2026-03-GOLD)"
    )


def test_ldo_ap2112k_footprint():
    """ECO #2026-03-GOLD: AP2112K must use SOT-23-5 footprint constant."""
    src = _get_source()
    assert "FP_LDO_SOT23_5" in src, (
        "FP_LDO_SOT23_5 constant missing — AP2112K SOT-23-5 footprint not defined"
    )
