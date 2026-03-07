"""
Phase 4 – Automated SPICE Testing via PySpice
Daemon V0 Power Subsystem Transient Assertions

Two automated CI assertions:

  1. IP5328P 2.4A load-step transient  [PDN-BUDGET-01 full-load stress test]
     Models the boost converter output with realistic ESR and bulk
     capacitance.  Asserts that VOUT never droops below 4.70V during
     an abrupt 0.1A → 2.4A load step in 10 µs (e.g., all three Stinger
     ports activating simultaneously plus SBC peak draw).  The IP5328P
     is rated ≥ 3A continuous so this represents a realistic worst-case
     load, not a derated limit.

  2. SY6280 ghost-unplug discharge assertion  [PDN-DCB-03 MLCC derating]
     Models the 150-Ohm internal discharge path against the DC-bias
     derated effective capacitance (3.0µF, not nameplate 10µF).  At 5V
     bias, an X5R 0402 MLCC loses 60–80% of its nameplate capacitance.
     τ_true = 150Ω × 3.0µF = 0.45ms (not the ideal 1.5ms).  Asserting
     against 10µF would constitute a test that can never reflect reality.

Both assertions raise AssertionError on failure, causing the CI
pipeline job to exit non-zero and block the layout phase.

Requirements:
    pip install PySpice numpy
    sudo apt-get install ngspice   # or brew install ngspice on macOS
"""

from __future__ import annotations

import math
import sys

import numpy as np

try:
    from PySpice.Spice.Netlist import Circuit
    from PySpice.Unit import u_A, u_ms, u_MOhm, u_Ohm, u_uF, u_us, u_V
except ModuleNotFoundError as exc:
    sys.exit(f"PySpice not installed. Run: pip install PySpice\n{exc}")

# ── Simulation parameters ─────────────────────────────────────────────────────

# IP5328P model parameters (replaces IP5306; rated ≥ 3A continuous)
IP5306_VOUT_NOMINAL = 5.0          # V   – boost converter nominal output
IP5306_ESR_OHMS = 0.05             # Ω   – ESR of the bulk output capacitor bank
# ECO #2026-03-G: 22µF MLCC + 100µF tantalum power tank on 5V_SYS
IP5306_COUT_UF = 122.0             # µF  – total output decoupling (22µF MLCC + 100µF tantalum)
IP5306_LOAD_IDLE_A = 0.1           # A   – quiescent draw before load event
IP5306_LOAD_MAX_A = 2.4            # A   – PDN-BUDGET-01: full-load stress (3× Stinger + SBC)
IP5306_LOAD_RISE_US = 10.0         # µs  – load ramp time (simultaneous port activation)
IP5306_VOUT_DROOP_FLOOR = 4.70     # V   – CI assertion lower bound (300mV droop budget)

# SY6280 model parameters
SY6280_VOUT_INITIAL = 5.0          # V
SY6280_RDIS_OHMS = 150.0           # Ω  – internal discharge resistance (datasheet typical)
SY6280_COUT_UF = 10.0              # µF – nameplate value (documentation reference only)
# PDN-DCB-03: X5R/X7R MLCCs lose 60–80% capacitance at rated DC bias voltage.
# A 10µF 0402 X5R rated 6.3V operating at 5V bias retains ≈ 2.0–4.0µF.
# We assert against the conservative mid-point effective value of 3.0µF.
SY6280_COUT_EFF_UF = 3.0           # µF – DC-bias derated effective capacitance for SPICE
SY6280_EN_FALL_TIME_US = 800.0     # µs – EN pin pulled low at this simulation time
SY6280_DISCHARGE_TAU_MS = (        # ms – expected time constant (PDN-DCB-03 derated)
    SY6280_RDIS_OHMS * SY6280_COUT_EFF_UF * 1e-6 * 1e3
)
SY6280_TOLERANCE = 0.10            # ± 10% tolerance on the discharge voltage

# Simulation grid
SIM_STEP_US = 1                    # µs
SIM_END_MS = 2.5                   # ms


# ── Helper ────────────────────────────────────────────────────────────────────


def _nearest_idx(time_array: np.ndarray, target_s: float) -> int:
    """Return the index in time_array closest to target_s seconds."""
    return int(np.abs(time_array - target_s).argmin())


# ── Simulation builders ───────────────────────────────────────────────────────


def _build_circuit() -> Circuit:
    """
    Construct a single PySpice circuit that contains both sub-circuits
    sharing a common GND node.
    """
    circuit = Circuit("Daemon V0 Power Subsystem Validation")

    # ------------------------------------------------------------------
    # Sub-circuit 1: IP5306 5V boost converter output model
    #
    # The converter is approximated as an ideal voltage source behind a
    # finite output impedance (ESR) feeding a bulk capacitor.  A pulse
    # current source injects the abrupt 1.5A load step (PDN-THM-02 derated).
    # ------------------------------------------------------------------
    circuit.V(
        "IP5306_IN",
        "VOUT_INTERNAL",
        circuit.gnd,
        IP5306_VOUT_NOMINAL @ u_V,
    )
    circuit.R(
        "IP5306_ESR",
        "VOUT_INTERNAL",
        "VOUT_5V",
        IP5306_ESR_OHMS @ u_Ohm,
    )
    circuit.C(
        "IP5306_COUT",
        "VOUT_5V",
        circuit.gnd,
        IP5306_COUT_UF @ u_uF,
    )
    # Pulsed load: idle → 2.4A full-load in 10µs, 500µs active window
    # rise_time=10µs models simultaneous activation of all three Stinger ports
    circuit.PulseCurrentSource(
        "LOAD_TRANSIENT",
        "VOUT_5V",
        circuit.gnd,
        initial_value=IP5306_LOAD_IDLE_A @ u_A,
        pulsed_value=IP5306_LOAD_MAX_A @ u_A,
        pulse_width=500 @ u_us,
        period=1 @ u_ms,
        delay_time=100 @ u_us,
        rise_time=IP5306_LOAD_RISE_US @ u_us,
        fall_time=IP5306_LOAD_RISE_US @ u_us,
    )

    # ------------------------------------------------------------------
    # Sub-circuit 2: SY6280 power distribution switch + discharge model
    #
    # The pass transistor is modelled as a voltage-controlled switch.
    # The automatic 150-Ohm discharge path is activated by an inverted
    # replica of the EN signal, also via a controlled switch.
    # ------------------------------------------------------------------

    # EN control source: high (5V) until t=800µs, then falls to 0V
    circuit.PulseVoltageSource(
        "EN_CONTROL",
        "EN_NODE",
        circuit.gnd,
        initial_value=SY6280_VOUT_INITIAL @ u_V,
        pulsed_value=0.0 @ u_V,
        pulse_width=1 @ u_ms,
        period=2 @ u_ms,
        delay_time=SY6280_EN_FALL_TIME_US @ u_us,
        rise_time=1 @ u_us,
        fall_time=1 @ u_us,
    )

    # Pass switch: conducts when EN_NODE is high
    circuit.VoltageControlledSwitch(
        "SY_PASS",
        "VOUT_5V",
        "SY_OUT",
        "EN_NODE",
        circuit.gnd,
        model="SW_PASS",
    )
    circuit.model("SW_PASS", "SW", Ron=0.05 @ u_Ohm, Roff=1 @ u_MOhm, Vt=2.5, Vh=0.5)

    # Downstream load capacitor – PDN-DCB-03: use DC-bias derated effective value
    circuit.C(
        "SY_COUT",
        "SY_OUT",
        circuit.gnd,
        SY6280_COUT_EFF_UF @ u_uF,
    )

    # Inverted EN signal drives the discharge switch
    circuit.BehavioralSource(
        "EN_INV",
        "EN_INV_NODE",
        circuit.gnd,
        voltage_expression=f"({SY6280_VOUT_INITIAL} - V(EN_NODE))",
    )

    # Discharge switch: active when EN is LOW (inverted EN is HIGH)
    circuit.VoltageControlledSwitch(
        "SY_DIS_SW",
        "SY_OUT",
        "DIS_NODE",
        "EN_INV_NODE",
        circuit.gnd,
        model="SW_DIS",
    )
    circuit.model("SW_DIS", "SW", Ron=0.01 @ u_Ohm, Roff=10 @ u_MOhm, Vt=2.5, Vh=0.5)

    # Internal 150-Ohm discharge resistor
    circuit.R("SY_RDIS", "DIS_NODE", circuit.gnd, SY6280_RDIS_OHMS @ u_Ohm)

    return circuit


# ── Assertion logic ───────────────────────────────────────────────────────────


def _assert_ip5306_load_step(time: np.ndarray, vout: np.ndarray) -> None:
    """
    Assert that the IP5328P VOUT rail never droops below 4.70V during
    the 0.1A → 2.4A / 10µs load step.

    300mV droop budget: USB spec requires VBUS ≥ 4.75V for downstream
    devices; the SY6280 adds ≈ 50mV Vds(on), so the PMIC output floor
    is set at 4.70V to keep USB_VBUS_x ≥ 4.70V - 0.05V = 4.65V (within
    the USB BC 1.2 ±5% tolerance for charging ports).
    """
    min_vout = float(np.min(vout))
    if min_vout < IP5306_VOUT_DROOP_FLOOR:
        raise AssertionError(
            f"[FAIL] IP5328P load-step assertion: VOUT drooped to {min_vout:.3f}V "
            f"(floor = {IP5306_VOUT_DROOP_FLOOR}V). "
            "Increase output bulk capacitance or lower ESR."
        )
    print(
        f"  [PASS] IP5328P load step (0.1A→2.4A in {IP5306_LOAD_RISE_US:.0f}µs): "
        f"VOUT min = {min_vout:.3f}V (≥ {IP5306_VOUT_DROOP_FLOOR}V)"
    )


def _assert_sy6280_discharge(time: np.ndarray, sy_out: np.ndarray) -> None:
    """
    Assert that the SY6280 output reaches the 1-tau discharge level
    (≈1.839V) within ±10% at t = EN_fall + 1*tau.

    PDN-DCB-03: τ = R_DIS × C_eff = 150Ω × 3.0µF = 0.45ms
    (C_eff is the DC-bias derated value; nameplate 10µF X5R at 5V bias ≈ 3.0µF)
    Target time = 800µs + 450µs = 1250µs = 0.00125s
    """
    tau_s = SY6280_DISCHARGE_TAU_MS * 1e-3
    en_fall_s = SY6280_EN_FALL_TIME_US * 1e-6
    target_s = en_fall_s + tau_s                     # 0.0023s

    idx = _nearest_idx(time, target_s)
    measured_v = float(sy_out[idx])
    expected_v = SY6280_VOUT_INITIAL * math.exp(-1)  # ≈ 1.839V

    lo = expected_v * (1 - SY6280_TOLERANCE)
    hi = expected_v * (1 + SY6280_TOLERANCE)

    if not (lo <= measured_v <= hi):
        raise AssertionError(
            f"[FAIL] SY6280 discharge assertion: voltage at 1τ = {measured_v:.3f}V "
            f"(expected {expected_v:.3f}V ± {SY6280_TOLERANCE*100:.0f}%). "
            f"Check R_DIS ({SY6280_RDIS_OHMS}Ω) and C_eff ({SY6280_COUT_EFF_UF}µF derated)."
        )
    print(
        f"  [PASS] SY6280 discharge: V at 1τ ({tau_s*1e3:.1f}ms after EN fall) = "
        f"{measured_v:.3f}V (expected ≈ {expected_v:.3f}V)"
    )


# ── Main entry point ──────────────────────────────────────────────────────────


def validate_power_subsystem_transients() -> None:
    print("Daemon V0 – Phase 4: PySpice Power Transient Assertions")
    print(f"  Simulation window : {SIM_END_MS}ms  |  step : {SIM_STEP_US}µs")
    print(f"  Expected SY6280 τ : {SY6280_DISCHARGE_TAU_MS:.2f}ms  (C_eff={SY6280_COUT_EFF_UF}µF derated from {SY6280_COUT_UF}µF)")

    circuit = _build_circuit()

    try:
        simulator = circuit.simulator(temperature=25, nominal_temperature=25)
        analysis = simulator.transient(
            step_time=SIM_STEP_US @ u_us,
            end_time=SIM_END_MS @ u_ms,
        )
    except Exception as exc:
        sys.exit(
            f"SPICE simulation failed: {exc}\n"
            "Ensure Ngspice is installed: apt-get install ngspice  /  brew install ngspice"
        )

    time = np.array(analysis.time)
    vout = np.array(analysis["VOUT_5V"])
    sy_out = np.array(analysis["SY_OUT"])

    _assert_ip5306_load_step(time, vout)
    _assert_sy6280_discharge(time, sy_out)

    print("\nAll PySpice transient assertions passed. Pipeline may advance to layout.")


if __name__ == "__main__":
    validate_power_subsystem_transients()
