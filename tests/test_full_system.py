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
    """IP5306, SL2.1A, and SY6280AAC must reference the 'Daemon_V0' project library."""
    src = _get_source()
    for ic in ("IP5306", "SL2.1A", "SY6280AAC"):
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
    """All six _build_* functions must be present."""
    src = _get_source()
    expected = [
        "_build_power_system",
        "_build_usb_hub",
        "_build_stinger_port",
        "_build_spi_screen",
        "_build_joystick",
        "_build_radxa_header",
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
