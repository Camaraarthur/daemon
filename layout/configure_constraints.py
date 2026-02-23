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


# pcbnew ships with KiCad – not a pip package.
try:
    import pcbnew  # type: ignore[import]
except ModuleNotFoundError:
    sys.exit(
        "pcbnew Python module not found.\n"
        "Set PYTHONPATH to the KiCad Python library directory.\n"
        "  Linux : /usr/lib/kicad/lib/python3/dist-packages\n"
        "  macOS : /Applications/KiCad/KiCad.app/Contents/Frameworks/"
        "Python.framework/Versions/Current/lib/python3.9/site-packages"
    )


# ── Net-class definitions ─────────────────────────────────────────────────────


@dataclass(frozen=True)
class DiffPairNetClass:
    name: str
    description: str
    trace_width_mm: float     # width of each individual trace in the pair
    clearance_mm: float       # min clearance to adjacent nets / copper
    diff_pair_gap_mm: float   # intra-pair edge-to-edge gap
    nets: list[str]           # logical net names to assign to this class


USB_90_CLASS = DiffPairNetClass(
    name="DIFF_USB_90",
    description="90-Ohm Differential Impedance – USB 2.0 High-Speed (SL2.1A hub)",
    # Values calculated for JLC04161H-3313 FR4 4-layer stackup (εr ≈ 4.6, h ≈ 0.21mm)
    # Tightly coupled coplanar waveguide: w=0.15mm, gap=0.15mm → Zdiff ≈ 90Ω
    trace_width_mm=0.15,
    clearance_mm=0.15,
    diff_pair_gap_mm=0.15,
    nets=["USB_D_P", "USB_D_N"],
)

ETH_100_CLASS = DiffPairNetClass(
    name="DIFF_ETH_100",
    description="100-Ohm Differential Impedance – Ethernet MDI (RTL8152B)",
    # Looser coupling for 100Ω: w=0.15mm, gap=0.20mm → Zdiff ≈ 100Ω
    trace_width_mm=0.15,
    clearance_mm=0.20,
    diff_pair_gap_mm=0.20,
    nets=["ENET_TRD0_P", "ENET_TRD0_N"],
)

ALL_CLASSES: list[DiffPairNetClass] = [USB_90_CLASS, ETH_100_CLASS]


# ── Board manipulation ────────────────────────────────────────────────────────


def _mm(millimetres: float) -> int:
    """Convert millimetres to KiCad internal units (nanometres in KiCad 7+)."""
    return pcbnew.FromMM(millimetres)


def _inject_netclass(
    netclasses: pcbnew.NETCLASSES,
    nc_def: DiffPairNetClass,
) -> pcbnew.NETCLASS:
    """
    Create a NETCLASS object, populate physical constraints, and add it to
    the board's netclass collection.  Returns the new NETCLASS.
    """
    nc = pcbnew.NETCLASS(nc_def.name)
    nc.SetDescription(nc_def.description)
    nc.SetTrackWidth(_mm(nc_def.trace_width_mm))
    nc.SetClearance(_mm(nc_def.clearance_mm))
    nc.SetDiffPairWidth(_mm(nc_def.trace_width_mm))
    nc.SetDiffPairGap(_mm(nc_def.diff_pair_gap_mm))
    netclasses.Add(nc)
    return nc


def _assign_nets(
    board: pcbnew.BOARD,
    nc_def: DiffPairNetClass,
) -> None:
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


def configure_high_speed_differential_pairs(board_path: str) -> None:
    """
    Load a KiCad board, inject differential-pair net classes, and save.
    """
    print(f"Loading board: {board_path}")
    board = pcbnew.LoadBoard(board_path)

    design_settings = board.GetDesignSettings()
    netclasses = design_settings.GetNetClasses()

    for nc_def in ALL_CLASSES:
        print(f"\nInjecting net class: {nc_def.name}")
        print(f"  trace width  : {nc_def.trace_width_mm}mm")
        print(f"  clearance    : {nc_def.clearance_mm}mm")
        print(f"  intra-pair Δ : {nc_def.diff_pair_gap_mm}mm")
        _inject_netclass(netclasses, nc_def)
        _assign_nets(board, nc_def)

    pcbnew.SaveBoard(board_path, board)
    print(f"\nBoard saved with differential pair constraints → {board_path}")


# ── Entry point ───────────────────────────────────────────────────────────────


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit("Usage: python -m layout.configure_constraints <board.kicad_pcb>")

    configure_high_speed_differential_pairs(sys.argv[1])
