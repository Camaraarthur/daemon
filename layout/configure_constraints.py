"""
Phase 4a – KiCad pcbnew API: Differential Pair Constraint Injection
Daemon V0 Layout Automation

Programmatically injects two net-class definitions into a .kicad_pcb file:

  DIFF_USB_90   – 90Ω differential impedance for SL2.1A USB 2.0 HS signals
  DIFF_ETH_100  – 100Ω differential impedance for RTL8152B Ethernet MDI signals

Trace width and intra-pair gap values are pre-calculated for the standard
JLC04161H-3313 FR4 4-layer PCB stackup used by JLCPCB.

Usage:
    python -m layout.configure_constraints <path_to_board.kicad_pcb>

Requires:
    KiCad ≥ 7 installed; the pcbnew Python module must be on PYTHONPATH.
    On Linux: export PYTHONPATH=/usr/lib/kicad/lib/python3/dist-packages
    On macOS: export PYTHONPATH=/Applications/KiCad/KiCad.app/Contents/Frameworks/Python.framework/Versions/Current/lib/python3.9/site-packages
"""

from __future__ import annotations

import sys
from dataclasses import dataclass
from pathlib import Path


# ── Physical constants ─────────────────────────────────────────────────────────

# FR4 signal propagation speed for the JLC04161H-3313 stackup.
# v = c / sqrt(εr_eff)  where εr_eff ≈ 4.1 for microstrip on this laminate.
# Used to convert intra-pair skew limits (ps) to max physical length deltas (mm).
FR4_PROPAGATION_MM_PER_NS: float = 299.792 / (4.1 ** 0.5)  # ≈ 148.06 mm/ns


# pcbnew ships with KiCad – not a pip package.
# The import is deferred so that pure-Python helpers (_write_kicad_dru, constants,
# dataclasses) remain importable in CI environments without KiCad installed.
# Functions that actually call the pcbnew API use _require_pcbnew() to obtain it.
try:
    import pcbnew as _pcbnew_module  # type: ignore[import]
    _PCBNEW_AVAILABLE = True
except ModuleNotFoundError:
    _pcbnew_module = None  # type: ignore[assignment]
    _PCBNEW_AVAILABLE = False


def _require_pcbnew():
    """Return the pcbnew module; exit with a helpful message if KiCad is absent."""
    if not _PCBNEW_AVAILABLE:
        sys.exit(
            "pcbnew Python module not found.\n"
            "Set PYTHONPATH to the KiCad Python library directory.\n"
            "  Linux : /usr/lib/kicad/lib/python3/dist-packages\n"
            "  macOS : /Applications/KiCad/KiCad.app/Contents/Frameworks/"
            "Python.framework/Versions/Current/lib/python3.9/site-packages"
        )
    return _pcbnew_module


# ── Net-class definitions ─────────────────────────────────────────────────────


@dataclass(frozen=True)
class DiffPairNetClass:
    name: str
    description: str
    trace_width_mm: float     # width of each individual trace in the pair
    clearance_mm: float       # min clearance to adjacent nets / copper
    diff_pair_gap_mm: float   # intra-pair edge-to-edge gap
    nets: list[str]           # logical net names to assign to this class
    skew_limit_ps: float = 0.0  # max intra-pair skew in ps (0 = no constraint)


USB_90_CLASS = DiffPairNetClass(
    name="DIFF_USB_90",
    description="90-Ohm Differential Impedance – USB 2.0 High-Speed (SL2.1A hub)",
    # Values calculated for JLC04161H-3313 FR4 4-layer stackup (εr ≈ 4.6, h ≈ 0.21mm)
    # Tightly coupled coplanar waveguide: w=0.15mm, gap=0.15mm → Zdiff ≈ 90Ω
    trace_width_mm=0.15,
    clearance_mm=0.15,
    diff_pair_gap_mm=0.15,
    nets=["USB_D_P", "USB_D_N"],
    # SI-USB-02: 480 Mbps HS requires intra-pair skew ≤ 100ps
    # Δ_max = 100ps × v_FR4 ≈ 100 × 0.14806 = 14.81mm at εr_eff=4.1
    skew_limit_ps=100.0,
)

ETH_100_CLASS = DiffPairNetClass(
    name="DIFF_ETH_100",
    description="100-Ohm Differential Impedance – Ethernet MDI (RTL8152B)",
    # Looser coupling for 100Ω: w=0.15mm, gap=0.20mm → Zdiff ≈ 100Ω
    trace_width_mm=0.15,
    clearance_mm=0.20,
    diff_pair_gap_mm=0.20,
    nets=["ENET_TRD0_P", "ENET_TRD0_N"],
    skew_limit_ps=0.0,  # 10/100 Mbps Ethernet: no strict skew spec from this audit
)

ALL_CLASSES: list[DiffPairNetClass] = [USB_90_CLASS, ETH_100_CLASS]


# ── Board manipulation ────────────────────────────────────────────────────────


def _mm(millimetres: float) -> int:
    """Convert millimetres to KiCad internal units (nanometres in KiCad 7+)."""
    return _require_pcbnew().FromMM(millimetres)


def _inject_netclass(netclasses, nc_def: DiffPairNetClass):
    """
    Create a NETCLASS object, populate physical constraints, and add it to
    the board's netclass collection.  Returns the new NETCLASS.
    """
    pcbnew = _require_pcbnew()
    nc = pcbnew.NETCLASS(nc_def.name)
    nc.SetDescription(nc_def.description)
    nc.SetTrackWidth(_mm(nc_def.trace_width_mm))
    nc.SetClearance(_mm(nc_def.clearance_mm))
    nc.SetDiffPairWidth(_mm(nc_def.trace_width_mm))
    nc.SetDiffPairGap(_mm(nc_def.diff_pair_gap_mm))
    netclasses.Add(nc)
    return nc


def _assign_nets(board, nc_def: DiffPairNetClass) -> None:
    """
    Assign each logical net in nc_def.nets to the named net class.
    Raises RuntimeError if a net does not exist in the board.
    """
    net_info = board.GetNetInfo()
    for net_name in nc_def.nets:
        net = net_info.GetNetByName(net_name)
        if net is None:
            raise RuntimeError(
                f"Net '{net_name}' not found in board. "
                "Verify the net name matches the schematic exactly."
            )
        net.SetNetClass(nc_def.name)
        print(f"  Assigned net '{net_name}' → {nc_def.name}")


def _write_kicad_dru(board_path: str, nc_defs: list[DiffPairNetClass]) -> None:
    """
    Generate a KiCad 7 custom design-rules (.kicad_dru) file alongside the board.

    For every net class with skew_limit_ps > 0, emits a diff_pair_skew constraint
    that the KiCad interactive router and DRC engine will enforce.  The CI pipeline
    also validates this independently via layout.freerouting_dsn.validate_ses_intra_pair_skew.

    The .kicad_dru file must live in the same directory as the .kicad_pcb file
    and share the same base name for KiCad to pick it up automatically.
    """
    dru_path = Path(board_path).with_suffix(".kicad_dru")
    mm_per_ps = FR4_PROPAGATION_MM_PER_NS * 1e-3  # mm/ps at εr_eff=4.1

    lines = [
        "(version 1)",
        "",
        "; Daemon V0 CI/CD – auto-generated by layout/configure_constraints.py",
        "; DO NOT EDIT MANUALLY – regenerate by running:",
        ";   python -m layout.configure_constraints <board.kicad_pcb>",
        "; Post-route CI validation:",
        ";   python -m layout.freerouting_dsn --validate-skew <board.ses>",
        "",
    ]

    constrained = [nc for nc in nc_defs if nc.skew_limit_ps > 0.0]
    if not constrained:
        dru_path.write_text("\n".join(lines), encoding="utf-8")
        return

    for nc in constrained:
        max_delta_mm = nc.skew_limit_ps * mm_per_ps
        rule_name = f"SI_USB_02_intra_pair_skew"  # extend pattern for multi-class
        lines += [
            f"; {nc.name}: skew ≤ {nc.skew_limit_ps:.0f}ps"
            f"  →  Δ_max ≈ {max_delta_mm:.2f}mm  (FR4 v_prop = {FR4_PROPAGATION_MM_PER_NS:.2f} mm/ns)",
            f'(rule "{rule_name}"',
            f'  (condition "A.NetClass == \'{nc.name}\'")',
            f"  (constraint diff_pair_skew (max {max_delta_mm:.2f}mm))",
            ")",
            "",
        ]

    dru_path.write_text("\n".join(lines), encoding="utf-8")
    print(f"KiCad DRC rules written → {dru_path}")
    for nc in constrained:
        max_delta_mm = nc.skew_limit_ps * mm_per_ps
        print(f"  {nc.name}: diff_pair_skew ≤ {max_delta_mm:.2f}mm ({nc.skew_limit_ps:.0f}ps)")


def configure_high_speed_differential_pairs(board_path: str) -> None:
    """
    Load a KiCad board, inject differential-pair net classes, and save.
    Also writes a .kicad_dru custom-rules file with SI-USB-02 skew constraints.
    """
    print(f"Loading board: {board_path}")
    board = _require_pcbnew().LoadBoard(board_path)

    design_settings = board.GetDesignSettings()
    netclasses = design_settings.GetNetClasses()

    for nc_def in ALL_CLASSES:
        print(f"\nInjecting net class: {nc_def.name}")
        print(f"  trace width  : {nc_def.trace_width_mm}mm")
        print(f"  clearance    : {nc_def.clearance_mm}mm")
        print(f"  intra-pair Δ : {nc_def.diff_pair_gap_mm}mm")
        if nc_def.skew_limit_ps > 0:
            print(f"  skew limit   : {nc_def.skew_limit_ps:.0f}ps")
        _inject_netclass(netclasses, nc_def)
        _assign_nets(board, nc_def)

    _write_kicad_dru(board_path, ALL_CLASSES)

    _require_pcbnew().SaveBoard(board_path, board)
    print(f"\nBoard saved with differential pair constraints → {board_path}")


# ── Entry point ───────────────────────────────────────────────────────────────


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit("Usage: python -m layout.configure_constraints <board.kicad_pcb>")

    configure_high_speed_differential_pairs(sys.argv[1])
