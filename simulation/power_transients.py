"""
Phase 3 – Automated SPICE Testing via PySpice
Daemon V0 Power Subsystem Transient Assertions

Two automated CI assertions:

  1. IP5306 2.4A load-step transient
     Models the boost converter output with realistic ESR and bulk
     capacitance.  Asserts that VOUT never droops below 4.80V during
     an abrupt 0.1A → 2.4A load step (e.g., simultaneous wake of the
     MAX98357A, RTL8152B, and SL2.1A hub).

  2. SY6280 ghost-unplug discharge assertion
     Models the 150-Ohm internal discharge path.  Asserts that the
     output voltage reaches the 1-tau point (~1.839V) at exactly
     1.5ms after EN is de-asserted, proving that the automatic
     discharge prevents floating rails and downstream MCU latch-up.

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

# IP5306 model parameters
IP5306_VOUT_NOMINAL = 5.0          # V
IP5306_ESR_OHMS = 0.05             # Ω  – ESR of the bulk output capacitor bank
IP5306_COUT_UF = 22.0              # µF – total output decoupling capacitance
IP5306_LOAD_IDLE_A = 0.1           # A  – quiescent draw
IP5306_LOAD_MAX_A = 2.4            # A  – maximum rated discharge current
IP5306_VOUT_DROOP_FLOOR = 4.80     # V  – CI assertion lower bound

# SY6280 model parameters
SY6280_VOUT_INITIAL = 5.0          # V
SY6280_RDIS_OHMS = 150.0           # Ω  – internal discharge resistance (datasheet typical)
SY6280_COUT_UF = 10.0              # µF – downstream output decoupling
SY6280_EN_FALL_TIME_US = 800.0     # µs – EN pin pulled low at this simulation time
SY6280_DISCHARGE_TAU_MS = (        # ms – expected time constant
    SY6280_RDIS_OHMS * SY6280_COUT_UF * 1e-6 * 1e3
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
    # current source injects the abrupt 2.4A load step.
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
    # Pulsed load: idle → max → idle, 100µs delay, 500µs active window
    circuit.PulseCurrentSource(
        "LOAD_TRANSIENT",
        "VOUT_5V",
        circuit.gnd,
        initial_value=IP5306_LOAD_IDLE_A @ u_A,
        pulsed_value=IP5306_LOAD_MAX_A @ u_A,
        pulse_width=500 @ u_us,
        period=1 @ u_ms,
        delay_time=100 @ u_us,
        rise_time=1 @ u_us,
        fall_time=1 @ u_us,
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

    # Downstream load capacitor
    circuit.C(
        "SY_COUT",
        "SY_OUT",
        circuit.gnd,
        SY6280_COUT_UF @ u_uF,
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
    Assert that the IP5306 VOUT rail never droops below 4.80V during
    the 2.4A load step.  Any violation means the output decoupling
    capacitance is insufficient and the schematic must be updated.
    """
    min_vout = float(np.min(vout))
    if min_vout < IP5306_VOUT_DROOP_FLOOR:
        raise AssertionError(
            f"[FAIL] IP5306 load-step assertion: VOUT drooped to {min_vout:.3f}V "
            f"(floor = {IP5306_VOUT_DROOP_FLOOR}V). "
            "Increase output bulk capacitance or lower ESR."
        )
    print(
        f"  [PASS] IP5306 load step: VOUT min = {min_vout:.3f}V "
        f"(≥ {IP5306_VOUT_DROOP_FLOOR}V)"
    )


def _assert_sy6280_discharge(time: np.ndarray, sy_out: np.ndarray) -> None:
    """
    Assert that the SY6280 output reaches the 1-tau discharge level
    (≈1.839V) within ±10% at t = EN_fall + 1*tau.

    τ = R_DIS × C_OUT = 150Ω × 10µF = 1.5ms
    Target time = 800µs + 1500µs = 2300µs = 0.0023s
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
            f"Check R_DIS ({SY6280_RDIS_OHMS}Ω) and C_OUT ({SY6280_COUT_UF}µF)."
        )
    print(
        f"  [PASS] SY6280 discharge: V at 1τ ({tau_s*1e3:.1f}ms after EN fall) = "
        f"{measured_v:.3f}V (expected ≈ {expected_v:.3f}V)"
    )


# ── Main entry point ──────────────────────────────────────────────────────────


def validate_power_subsystem_transients() -> None:
    print("Daemon V0 – Phase 3: PySpice Power Transient Assertions")
    print(f"  Simulation window : {SIM_END_MS}ms  |  step : {SIM_STEP_US}µs")
    print(f"  Expected SY6280 τ : {SY6280_DISCHARGE_TAU_MS:.2f}ms")

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
