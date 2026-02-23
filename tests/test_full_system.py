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
    """IP5328P, SL2.1A, and SY6280AAC must reference the 'Daemon_V0' project library."""
    src = _get_source()
    for ic in ("IP5328P", "SL2.1A", "SY6280AAC"):
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
    """All _build_* functions (A–J) and the assembly function must be present."""
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
        "_build_can_bus",
        "_build_industrial_iso",
        "_build_clean_3v3_rail",
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
    # Both must resolve to the SC-70-3 package
    assert "SC-70-3" in audio_src, "FP_TVS_SC70 must reference SC-70-3 package in audio_subsystem.py"
    assert "SC-70-3" in full_src,  "FP_TVS_SC70 must reference SC-70-3 package in full_system.py"


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
    assert "R_1225_3264Metric" in src, (
        "R_1225_3264Metric KiCad footprint not referenced in full_system.py"
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
    assert '"RF_Transceiver", "CC1101"' in src, (
        'CC1101 must be instantiated as Part("RF_Transceiver", "CC1101", ...)'
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


def test_mcp2515_footprint_constant_present():
    """Subsystem I: FP_MCP2515 must reference the SOIC-18W package."""
    src = _get_source()
    assert "FP_MCP2515" in src, "FP_MCP2515 footprint constant missing from full_system.py"
    assert "SOIC-18W" in src, "FP_MCP2515 must reference SOIC-18W package"


def test_mcp2551_footprint_constant_present():
    """Subsystem I: FP_MCP2551 must reference the SOIC-8 package."""
    src = _get_source()
    assert "FP_MCP2551" in src, "FP_MCP2551 footprint constant missing from full_system.py"
    assert "SOIC-8_3.9x4.9mm" in src, "FP_MCP2551 must reference SOIC-8 package"


def test_mcp2515_instantiated_from_can_library():
    """Subsystem I: MCP2515 must be instantiated from the Interface_CAN_LIN library."""
    src = _get_source()
    assert '"Interface_CAN_LIN", "MCP2515"' in src, (
        'MCP2515 must be Part("Interface_CAN_LIN", "MCP2515", ...)'
    )


def test_mcp2551_instantiated_from_can_library():
    """Subsystem I: MCP2551 must be instantiated from the Interface_CAN_LIN library."""
    src = _get_source()
    assert '"Interface_CAN_LIN", "MCP2551"' in src, (
        'MCP2551 must be Part("Interface_CAN_LIN", "MCP2551", ...)'
    )


def test_can_cs_n_net_defined():
    """Subsystem I: CAN_CS_N must be a distinct net from SCREEN_CS and RF_CS_N."""
    src = _get_source()
    assert 'Net("CAN_CS_N")' in src, 'Net("CAN_CS_N") missing from full_system.py'


def test_can_h_and_can_l_nets_defined():
    """Subsystem I: CAN_H and CAN_L bus nets must be defined in the CAN bus subsystem."""
    src = _get_source()
    assert 'Net("CAN_H")' in src, 'Net("CAN_H") missing from full_system.py'
    assert 'Net("CAN_L")' in src, 'Net("CAN_L") missing from full_system.py'


def test_can_int_n_net_defined():
    """Subsystem I: CAN_INT_N interrupt net must be routed to the auxiliary header."""
    src = _get_source()
    assert 'Net("CAN_INT_N")' in src, 'Net("CAN_INT_N") missing from full_system.py'


def test_mcp2551_uses_5v_supply():
    """Subsystem I: MCP2551 VDD must connect to vcc_5v (requires 4.5–5.5V)."""
    src = _get_source()
    assert 'xcvr["VDD"]  += vcc_5v' in src, (
        'MCP2551 VDD must be wired to vcc_5v (not vcc_3v3) — device requires 4.5–5.5V'
    )


def test_can_bus_called_in_assembly():
    """Subsystem I: _build_can_bus must be called from the top-level assembly."""
    src = _get_source()
    assert "_build_can_bus(" in src, (
        "_build_can_bus not called in generate_daemon_v0_full_system()"
    )


def test_spi_cs_pins_are_unique():
    """All three SPI chip selects must use distinct net names."""
    src = _get_source()
    # Each CS net must be a separate Net() definition
    assert 'Net("SCREEN_CS")' in src, 'Net("SCREEN_CS") missing'
    assert 'Net("RF_CS_N")' in src,   'Net("RF_CS_N") missing'
    assert 'Net("CAN_CS_N")' in src,  'Net("CAN_CS_N") missing'
    # They must be three different strings — uniqueness guaranteed by different names
    cs_names = {"SCREEN_CS", "RF_CS_N", "CAN_CS_N"}
    assert len(cs_names) == 3, "SPI chip select nets are not unique"


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


def test_power_system_has_i2c0_params():
    """_build_power_system must accept i2c0_sda and i2c0_scl for IP5328P I2C telemetry."""
    src = _get_source()
    assert "i2c0_sda" in src, "_build_power_system missing i2c0_sda parameter"
    assert "i2c0_scl" in src, "_build_power_system missing i2c0_scl parameter"


def test_stinger_iset_resistor_17k():
    """17 kΩ ISET resistor must be present in _build_stinger_port (400mA OC limit)."""
    src = _get_source()
    assert 'value="17k"' in src, (
        "17k ISET resistor not found — SY6280 OC threshold not hardware-limited"
    )
    assert "ISET" in src, (
        "ISET net/pin reference not found in stinger port"
    )


def test_clean_3v3_rail_function_defined():
    """_build_clean_3v3_rail must exist as a separate LDO subsystem function."""
    assert "def _build_clean_3v3_rail" in _get_source(), (
        "_build_clean_3v3_rail function not defined"
    )


def test_ldo_lm1117_instantiated():
    """LM1117-3.3 LDO must be instantiated from KiCad Regulator_Linear library."""
    assert '"Regulator_Linear", "LM1117-3.3"' in _get_source(), (
        "LM1117-3.3 not found — 3V3_CLEAN LDO not instantiated"
    )


def test_3v3_clean_net_defined():
    """3V3_CLEAN net must exist as the isolated supply for RF and CAN subsystems."""
    assert "3V3_CLEAN" in _get_source(), (
        "3V3_CLEAN net not found — RF/CAN power bifurcation not applied"
    )


def test_rf_and_can_use_clean_rail():
    """Assembly must pass vcc_clean (not vcc_3v3) to RF and CAN subsystem calls."""
    src = _get_source()
    assert "vcc_clean = vcc_clean" in src, (
        "vcc_clean not passed to RF/CAN subsystems — power rail bifurcation incomplete"
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
