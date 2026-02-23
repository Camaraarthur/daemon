"""
Phase 1 – Design for Testability (DFT)
IP5306 Power Management IC: Test Point and Isolation Jumper Definitions

Emits a structured report of every DFT node required for the automated
SPICE engine to inject stimuli and for bed-of-nails ATE on the
manufacturing floor to physically validate the Daemon V0 power subsystem.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

from rich.console import Console
from rich.table import Table

console = Console()

# ── Data model ────────────────────────────────────────────────────────────────

ComponentKind = Literal["test_point", "isolation_jumper"]


@dataclass
class DFTComponent:
    ref: str                  # e.g. "TP1", "J1"
    kind: ComponentKind
    net: str                  # logical net name in the schematic
    ic_pin: str               # associated IC pin label
    footprint: str
    validation_purpose: str
    # SPICE stimulus used when this TP is the injection point
    spice_stimulus: str = ""
    # For isolation jumpers: net names on each side of the break
    iso_nets: list[str] = field(default_factory=list)


# ── IP5306 DFT definitions ────────────────────────────────────────────────────

IP5306_DFT_COMPONENTS: list[DFTComponent] = [
    DFTComponent(
        ref="TP1",
        kind="test_point",
        net="VIN",
        ic_pin="Pin 1",
        footprint="TestPoint:TestPoint_Pad_D1.5mm",
        validation_purpose=(
            "Inject transient over-voltage (OVP) and under-voltage lockout (UVLO) "
            "conditions; verify that the IC safely disables charging during input anomalies."
        ),
        spice_stimulus="PulseVoltageSource: 5V → 6.5V step, 1µs rise, 500µs pulse",
    ),
    DFTComponent(
        ref="TP2",
        kind="test_point",
        net="BAT",
        ic_pin="Pin 6",
        footprint="TestPoint:TestPoint_Pad_D1.5mm",
        validation_purpose=(
            "Monitor the charge curve; assert 4.2V over-charge cutoff and "
            "over-discharge safety floor (~2.8V)."
        ),
        spice_stimulus="PWL current source: 0→2.1A charge ramp, monitor V(BAT)",
    ),
    DFTComponent(
        ref="TP3",
        kind="test_point",
        net="SW",
        ic_pin="Pin 7",
        footprint="TestPoint:TestPoint_Pad_D1.0mm",
        validation_purpose=(
            "Monitor the 500kHz DC-DC switch node for parasitic ringing amplitude "
            "and frequency deviation; informs inductor selection (1µH SPM70701R0)."
        ),
        spice_stimulus="Observe only – no injection; FFT of V(SW) vs 500kHz fundamental",
    ),
    DFTComponent(
        ref="TP4",
        kind="test_point",
        net="VOUT",
        ic_pin="Pin 8",
        footprint="TestPoint:TestPoint_Pad_D1.5mm",
        validation_purpose=(
            "Evaluate 5V boost stability under the full 2.4A continuous load; "
            "verify ripple remains strictly below 50mV peak-to-peak."
        ),
        spice_stimulus="PulseCurrentSource: 0.1A → 2.4A step load, assert V ≥ 4.80V",
    ),
    DFTComponent(
        ref="J1",
        kind="isolation_jumper",
        net="BAT_ISO",
        ic_pin="Series with Pin 6",
        footprint="Resistor_SMD:R_0402_1005Metric",
        validation_purpose=(
            "Isolate the battery chemistry model from the internal charge circuitry "
            "during CI simulation; prevents Li-ion cell parasitics from skewing "
            "boost converter SPICE accuracy."
        ),
        iso_nets=["BAT", "BAT_ISO"],
    ),
    DFTComponent(
        ref="J2",
        kind="isolation_jumper",
        net="VOUT_ISO",
        ic_pin="Series with Pin 8",
        footprint="Resistor_SMD:R_0402_1005Metric",
        validation_purpose=(
            "Verify <100µA standby current in isolation from downstream loads "
            "(MAX98357A, RTL8152B, SL2.1A); allows ATE to inject precise step-loads "
            "directly into the PDN."
        ),
        iso_nets=["VOUT", "VOUT_ISO"],
    ),
]

# ── Reporting ─────────────────────────────────────────────────────────────────


def emit_dft_report(components: list[DFTComponent]) -> None:
    console.rule("[bold cyan]Daemon V0 – Phase 1: IP5306 DFT Component Report")

    tp_table = Table(title="Test Points", show_lines=True)
    tp_table.add_column("Ref", style="bold yellow", no_wrap=True)
    tp_table.add_column("Net", style="cyan")
    tp_table.add_column("IC Pin")
    tp_table.add_column("Footprint")
    tp_table.add_column("CI/CD Validation Purpose", max_width=50)
    tp_table.add_column("SPICE Stimulus", style="dim", max_width=40)

    iso_table = Table(title="Isolation Jumpers (0Ω)", show_lines=True)
    iso_table.add_column("Ref", style="bold magenta", no_wrap=True)
    iso_table.add_column("Net", style="cyan")
    iso_table.add_column("Breaks", style="dim")
    iso_table.add_column("IC Pin")
    iso_table.add_column("Footprint")
    iso_table.add_column("CI/CD Validation Purpose", max_width=60)

    for c in components:
        if c.kind == "test_point":
            tp_table.add_row(
                c.ref,
                c.net,
                c.ic_pin,
                c.footprint,
                c.validation_purpose,
                c.spice_stimulus,
            )
        else:
            iso_table.add_row(
                c.ref,
                c.net,
                " → ".join(c.iso_nets),
                c.ic_pin,
                c.footprint,
                c.validation_purpose,
            )

    console.print(tp_table)
    console.print(iso_table)
    console.print(
        f"\n[green]DFT report complete.[/green] "
        f"{sum(1 for c in components if c.kind == 'test_point')} test points, "
        f"{sum(1 for c in components if c.kind == 'isolation_jumper')} isolation jumpers defined."
    )


def validate_dft_coverage(components: list[DFTComponent]) -> None:
    """
    Assert that every critical IP5306 pin has at least one DFT component.
    Raises RuntimeError if coverage is missing – fails the CI build.
    """
    required_pins = {"Pin 1", "Pin 6", "Pin 7", "Pin 8"}
    covered_pins: set[str] = set()

    for c in components:
        for pin in required_pins:
            if pin in c.ic_pin:
                covered_pins.add(pin)

    missing = required_pins - covered_pins
    if missing:
        raise RuntimeError(
            f"DFT coverage gap: IP5306 pins {missing} have no test point or isolation jumper. "
            "Update IP5306_DFT_COMPONENTS before advancing to layout."
        )
    console.print("[green]DFT coverage validated:[/green] all critical IP5306 pins covered.")


# ── Entry point ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    validate_dft_coverage(IP5306_DFT_COMPONENTS)
    emit_dft_report(IP5306_DFT_COMPONENTS)
