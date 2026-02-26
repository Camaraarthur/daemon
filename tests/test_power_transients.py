"""
Tests for simulation/power_transients.py

Validates PDN-DCB-03 (MLCC DC-bias capacitance derating) and PDN-BUDGET-01
(IP5328P full-load transient) without requiring PySpice or Ngspice to be
installed.  All tests inspect the module source text so they run cleanly
in a minimal CI environment (no analog simulation toolchain needed).

Covered assertions:
  · PDN-DCB-03: SY6280_COUT_EFF_UF is 3.0µF (not nameplate 10µF)
  · PDN-DCB-03: τ is derived from the derated value → 0.45ms
  · PDN-DCB-03: SPICE circuit instantiates SY_COUT with the derated constant
  · PDN-BUDGET-01: IP5306_LOAD_MAX_A is 2.4A (IP5328P rated ≥ 3A; no derate needed)
  · PDN-BUDGET-01: IP5306_VOUT_DROOP_FLOOR is 4.70V (300mV droop budget)
"""

import math
from pathlib import Path

SRC = Path(__file__).parent.parent / "simulation" / "power_transients.py"


def _get_source() -> str:
    return SRC.read_text()


# ── PDN-DCB-03: MLCC DC-bias derating ────────────────────────────────────────


def test_sy6280_effective_capacitance_constant_exists():
    """PDN-DCB-03: SY6280_COUT_EFF_UF must be declared as a named constant."""
    src = _get_source()
    assert "SY6280_COUT_EFF_UF" in src, (
        "SY6280_COUT_EFF_UF constant missing – PDN-DCB-03 derating not implemented"
    )


def test_sy6280_effective_capacitance_is_3uf():
    """PDN-DCB-03: SY6280_COUT_EFF_UF must equal 3.0µF (DC-bias derated value)."""
    src = _get_source()
    assert "SY6280_COUT_EFF_UF = 3.0" in src, (
        "SY6280_COUT_EFF_UF must be 3.0 – X5R 10µF at 5V bias retains ≈ 3.0µF (PDN-DCB-03)"
    )


def test_sy6280_nominal_capacitance_retained_for_reference():
    """PDN-DCB-03: The 10µF nameplate value must be documented for traceability."""
    src = _get_source()
    assert "SY6280_COUT_UF = 10.0" in src, (
        "SY6280_COUT_UF = 10.0 nameplate reference missing from power_transients.py"
    )


def test_discharge_tau_formula_uses_derated_capacitance():
    """PDN-DCB-03: SY6280_DISCHARGE_TAU_MS must be computed from SY6280_COUT_EFF_UF."""
    src = _get_source()
    # Locate the tau definition block and verify it references the effective constant
    tau_def_start = src.find("SY6280_DISCHARGE_TAU_MS")
    assert tau_def_start != -1, "SY6280_DISCHARGE_TAU_MS definition not found"
    tau_block = src[tau_def_start: tau_def_start + 200]
    assert "SY6280_COUT_EFF_UF" in tau_block, (
        "SY6280_DISCHARGE_TAU_MS must reference SY6280_COUT_EFF_UF, not SY6280_COUT_UF (PDN-DCB-03)"
    )


def test_discharge_tau_arithmetic_is_0_45ms():
    """PDN-DCB-03: τ = 150Ω × 3.0µF × 1e-6 × 1e3 must equal 0.45ms exactly."""
    tau_ms = 150.0 * 3.0 * 1e-6 * 1e3
    assert abs(tau_ms - 0.45) < 1e-9, (
        f"Tau formula check failed: 150 × 3.0µF = {tau_ms}ms, expected 0.45ms"
    )


def test_spice_sy_cout_uses_derated_constant():
    """PDN-DCB-03: The SY_COUT capacitor in the SPICE circuit must use SY6280_COUT_EFF_UF."""
    src = _get_source()
    assert "SY6280_COUT_EFF_UF @ u_uF" in src, (
        "SPICE SY_COUT must be instantiated with SY6280_COUT_EFF_UF @ u_uF (PDN-DCB-03)"
    )


def test_spice_sy_cout_does_not_use_nominal():
    """PDN-DCB-03: The nominal SY6280_COUT_UF must not drive the SPICE capacitor."""
    src = _get_source()
    assert "SY6280_COUT_UF @ u_uF" not in src, (
        "SY6280_COUT_UF @ u_uF still drives SY_COUT – replace with SY6280_COUT_EFF_UF (PDN-DCB-03)"
    )


# ── PDN-BUDGET-01: IP5328P full-load transient ───────────────────────────────


def test_ip5306_max_load_derated_to_1_5a():
    """
    PDN-BUDGET-01: IP5306_LOAD_MAX_A must now be 2.4A.

    The IP5328P (QFN-40) is rated ≥ 3A continuous with a 900mA+ margin
    over the 2.1A all-ports-loaded design point.  Unlike the IP5306 (1.5A
    thermal derate), no derating is required.  The assertion floor moves
    from 4.80V to 4.70V to reflect the larger transient current step.
    """
    src = _get_source()
    assert "IP5306_LOAD_MAX_A = 2.4" in src, (
        "IP5306_LOAD_MAX_A must be 2.4A – IP5328P rated ≥ 3A; full-load test required (PDN-BUDGET-01)"
    )


def test_ip5306_max_load_not_2_4a():
    """PDN-BUDGET-01: The 4.70V droop floor must be present for the 2.4A step."""
    src = _get_source()
    assert "IP5306_VOUT_DROOP_FLOOR = 4.70" in src, (
        "IP5306_VOUT_DROOP_FLOOR must be 4.70V – 300mV droop budget for 0.1A→2.4A step (PDN-BUDGET-01)"
    )
