"""
Phase 4b – FreeRouting Specctra DSN: Differential Pair Directive Injection
Daemon V0 Layout Automation

FreeRouting reads design rules from a Specctra Design Language (.dsn) file
exported by KiCad.  While basic clearance and width constraints are
forwarded automatically, differential pair grouping requires explicit
(pair (nets ...)) Lisp-syntax directives in the (network ...) section.

This script:
  1. Parses the .dsn file to locate the (network ...) block.
  2. Appends class definitions and pair directives for USB and Ethernet nets.
  3. Writes the patched .dsn back to disk (in-place, with a .bak backup).

The patched .dsn is consumed by FreeRouting, which is then launched via:
    java -jar FreeRouting.jar -de <board.dsn> -do <board.ses> -mp 100

Usage:
    python -m layout.freerouting_dsn <board.dsn>
"""

from __future__ import annotations

import math
import re
import shutil
import sys
from dataclasses import dataclass
from pathlib import Path


# ── SI-USB-02: propagation constants ─────────────────────────────────────────
# FR4 signal propagation speed for the JLC04161H-3313 stackup.
# v = c / sqrt(εr_eff)  where εr_eff ≈ 4.1 for microstrip on this laminate.
# Must stay in sync with configure_constraints.FR4_PROPAGATION_MM_PER_NS.
FR4_PROPAGATION_MM_PER_NS: float = 299.792 / (4.1 ** 0.5)   # ≈ 148.06 mm/ns
FR4_PROPAGATION_MM_PER_PS: float = FR4_PROPAGATION_MM_PER_NS * 1e-3  # ≈ 0.14806 mm/ps

# SI-USB-02: 480 Mbps USB 2.0 HS intra-pair skew budget
USB_SKEW_LIMIT_PS: float = 100.0                             # picoseconds
USB_MAX_DELTA_MM: float = USB_SKEW_LIMIT_PS * FR4_PROPAGATION_MM_PER_PS  # ≈ 14.81 mm


# ── DSN pair-directive model ──────────────────────────────────────────────────


@dataclass(frozen=True)
class DsnDiffPairClass:
    class_name: str
    net_p: str           # positive net name (must match schematic exactly)
    net_n: str           # negative net name
    trace_width_mm: float
    diff_gap_mm: float   # intra-pair edge-to-edge spacing
    skew_limit_ps: float = 0.0  # max intra-pair skew in ps (0 = no constraint)


USB_DSN = DsnDiffPairClass(
    class_name="DIFF_USB_90",
    net_p="USB_D_P",
    net_n="USB_D_N",
    trace_width_mm=0.15,
    diff_gap_mm=0.15,
    skew_limit_ps=100.0,   # SI-USB-02: 480 Mbps HS requires ≤ 100ps intra-pair skew
)

ETH_DSN = DsnDiffPairClass(
    class_name="DIFF_ETH_100",
    net_p="ENET_TRD0_P",
    net_n="ENET_TRD0_N",
    trace_width_mm=0.15,
    diff_gap_mm=0.20,
    skew_limit_ps=0.0,     # 10/100 Mbps Ethernet: no strict skew spec from this audit
)

ALL_DSN_CLASSES: list[DsnDiffPairClass] = [USB_DSN, ETH_DSN]


# ── DSN directive generation ──────────────────────────────────────────────────


def _build_class_directive(dp: DsnDiffPairClass) -> str:
    """
    Emit a Specctra DSN (class ...) directive that names the two nets,
    assigns trace width and differential-gap rules, and groups the pair.

    The (pair (nets P N)) stanza is what instructs FreeRouting to treat
    the two traces as a tightly coupled differential pair throughout routing.
    """
    width_um = int(dp.trace_width_mm * 1000)  # DSN units: µm as integer
    gap_um = int(dp.diff_gap_mm * 1000)

    return (
        f"  (class {dp.class_name} {dp.net_p} {dp.net_n}\n"
        f"    (circuit\n"
        f"      (use_layer F.Cu B.Cu)\n"
        f"    )\n"
        f"    (rule\n"
        f"      (width {width_um})\n"
        f"      (clearance {gap_um} (type diff_pair_gap))\n"
        f"    )\n"
        f"  )\n"
        f"  (pair (nets {dp.net_p} {dp.net_n}))\n"
    )


def _build_network_addendum(classes: list[DsnDiffPairClass]) -> str:
    """Build all class directives to be injected before the closing ')' of (network ...)."""
    lines = ["\n  ; === Daemon V0 CI/CD: differential pair directives (auto-generated) ==="]
    for dp in classes:
        lines.append(_build_class_directive(dp))
    return "\n".join(lines)


# ── SI-USB-02: SES post-route skew validation ────────────────────────────────


def skew_ps_from_delta_mm(delta_mm: float) -> float:
    """Convert a physical trace-length mismatch (mm) to timing skew (ps) in FR4."""
    return delta_mm / FR4_PROPAGATION_MM_PER_PS


def _parse_ses_resolution(content: str) -> float:
    """
    Extract the DSN/SES coordinate resolution in mm-per-unit.

    Specctra SES files declare their coordinate system as:
      (resolution UNIT DIVISOR)
    meaning 1 DSN unit = (1/DIVISOR) of UNIT.

    Returns mm per DSN coordinate unit.  Defaults to 1e-4 mm (0.1µm per unit),
    which is the typical KiCad → FreeRouting export resolution.
    """
    m = re.search(r'\(resolution\s+(\w+)\s+(\d+)\)', content)
    if not m:
        return 1e-4
    unit_name = m.group(1).lower()
    divisor = int(m.group(2))
    if unit_name == "um":
        return 1e-3 / divisor    # µm → mm:  1µm = 0.001mm
    if unit_name == "mil":
        return 0.0254 / divisor  # mil → mm: 1mil = 0.0254mm
    if unit_name == "mm":
        return 1.0 / divisor
    return 1e-4  # fallback


def _extract_net_length_mm(content: str, net_name: str, mm_per_unit: float) -> float:
    """
    Sum all routed wire-segment lengths for `net_name` in a Specctra SES file.

    Locates the (net <name> ...) block using balanced-parenthesis tracking, then
    extracts every (path LAYER WIDTH x1 y1 x2 y2 ...) coordinate sequence and
    accumulates the Euclidean length of each consecutive waypoint pair.

    Returns total copper length in millimetres, or 0.0 if the net is absent.
    """
    marker = f"(net {net_name}"
    start = content.find(marker)
    if start == -1:
        return 0.0

    # Walk forward to find the closing ')' of this net block
    depth, end = 0, start
    for i, ch in enumerate(content[start:], start=start):
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
            if depth == 0:
                end = i + 1
                break
    net_block = content[start:end]

    # Extract coordinate sequences from every (path LAYER WIDTH x1 y1 x2 y2 ...) stanza
    path_re = re.compile(
        r'\(path\s+\S+\s+[\d.]+\s+((?:[-\d.]+\s*)+)\s*\)',
        re.DOTALL,
    )
    total = 0.0
    for pm in path_re.finditer(net_block):
        try:
            coords = [float(v) for v in pm.group(1).split()]
        except ValueError:
            continue
        for i in range(0, len(coords) - 2, 2):
            dx = coords[i + 2] - coords[i]
            dy = coords[i + 3] - coords[i + 1]
            total += math.sqrt(dx * dx + dy * dy)
    return total * mm_per_unit


def validate_ses_intra_pair_skew(
    ses_path: str,
    net_p: str = "USB_D_P",
    net_n: str = "USB_D_N",
) -> None:
    """
    SI-USB-02 CI gate: parse a FreeRouting output SES file and assert that the
    intra-pair skew between `net_p` and `net_n` is ≤ USB_SKEW_LIMIT_PS (100ps).

    FreeRouting cannot natively inject length-matching meanders; this function
    is the deterministic post-route check that blocks the layout phase if the
    autorouter left an excessive length delta.  A failing result means the shorter
    trace must be manually tuned with trombone serpentines until Δ < USB_MAX_DELTA_MM.

    Raises:
        FileNotFoundError  – SES file missing (FreeRouting not yet run).
        RuntimeError       – one or both nets have zero routed length (open route).
        AssertionError     – skew exceeds 100ps budget (SI-USB-02 violation).
    """
    path = Path(ses_path)
    if not path.exists():
        raise FileNotFoundError(
            f"SES file not found: {ses_path}\n"
            "Run FreeRouting first:\n"
            "  java -jar FreeRouting.jar -de <board.dsn> -do <board.ses> -mp 100"
        )

    content = path.read_text(encoding="utf-8")
    mm_per_unit = _parse_ses_resolution(content)

    len_p = _extract_net_length_mm(content, net_p, mm_per_unit)
    len_n = _extract_net_length_mm(content, net_n, mm_per_unit)

    if len_p == 0.0 or len_n == 0.0:
        raise RuntimeError(
            f"Could not extract routed length for '{net_p}' or '{net_n}' from {ses_path}.\n"
            "Verify the SES file contains fully-routed copper for both nets."
        )

    delta_mm = abs(len_p - len_n)
    skew_ps = skew_ps_from_delta_mm(delta_mm)
    shorter = net_p if len_p < len_n else net_n

    print(
        f"  SI-USB-02 skew check: {net_p}={len_p:.3f}mm  {net_n}={len_n:.3f}mm  "
        f"Δ={delta_mm:.3f}mm  skew={skew_ps:.1f}ps  limit={USB_SKEW_LIMIT_PS:.0f}ps"
    )

    if skew_ps > USB_SKEW_LIMIT_PS:
        raise AssertionError(
            f"[FAIL] SI-USB-02 intra-pair skew violation: {net_p}/{net_n} "
            f"skew = {skew_ps:.1f}ps (limit = {USB_SKEW_LIMIT_PS:.0f}ps, "
            f"Δ_max = {USB_MAX_DELTA_MM:.2f}mm).\n"
            "FreeRouting did not generate compensating meander serpentines.\n"
            f"Add trombone length-tuning to '{shorter}' until Δ < {USB_MAX_DELTA_MM:.2f}mm."
        )

    print(
        f"  [PASS] SI-USB-02: intra-pair skew = {skew_ps:.1f}ps "
        f"≤ {USB_SKEW_LIMIT_PS:.0f}ps"
    )


# ── DSN file patching ─────────────────────────────────────────────────────────


def _find_network_block_end(content: str) -> int:
    """
    Locate the closing parenthesis of the top-level (network ...) block.

    The DSN format uses balanced parentheses.  We find '(network' and then
    walk forward counting depth until the block closes.

    Returns the index of the closing ')' character, or -1 if not found.
    """
    start = content.find("(network")
    if start == -1:
        return -1

    depth = 0
    for i, ch in enumerate(content[start:], start=start):
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
            if depth == 0:
                return i
    return -1


def patch_dsn_for_freerouting(dsn_path: str) -> None:
    """
    Back up the original .dsn file, inject differential pair directives
    into the (network ...) block, and overwrite the file.
    """
    path = Path(dsn_path)
    if not path.exists():
        sys.exit(f"DSN file not found: {dsn_path}")

    # Create a backup before modifying
    backup = path.with_suffix(".dsn.bak")
    shutil.copy2(path, backup)
    print(f"Backup written → {backup}")

    content = path.read_text(encoding="utf-8")

    # Verify the guard-net directives already exist in the network block.
    # If the nets are absent, FreeRouting cannot assign the pair grouping.
    for dp in ALL_DSN_CLASSES:
        if dp.net_p not in content or dp.net_n not in content:
            print(
                f"  WARNING: net '{dp.net_p}' or '{dp.net_n}' not found in {dsn_path}. "
                "Pair directive injected but FreeRouting may not find the net. "
                "Verify net names match the KiCad schematic."
            )

    # Locate the end of the (network ...) block
    close_idx = _find_network_block_end(content)
    if close_idx == -1:
        sys.exit(
            "Could not locate (network ...) block in DSN file. "
            "Ensure KiCad exported a valid Specctra DSN before running this script."
        )

    # Inject directives immediately before the closing ')'
    addendum = _build_network_addendum(ALL_DSN_CLASSES)
    patched = content[:close_idx] + addendum + "\n" + content[close_idx:]

    path.write_text(patched, encoding="utf-8")
    print(f"DSN patched with {len(ALL_DSN_CLASSES)} differential pair class(es) → {dsn_path}")

    # Print a summary of what was injected
    for dp in ALL_DSN_CLASSES:
        print(
            f"  {dp.class_name}: {dp.net_p} / {dp.net_n}  "
            f"w={dp.trace_width_mm}mm  gap={dp.diff_gap_mm}mm"
        )

    print(
        "\nNext steps:\n"
        "  1. Route: java -jar FreeRouting.jar -de <board.dsn> -do <board.ses> -mp 100\n"
        f"  2. Validate SI-USB-02 skew (≤ {USB_SKEW_LIMIT_PS:.0f}ps / Δ ≤ {USB_MAX_DELTA_MM:.2f}mm):\n"
        "       python -m layout.freerouting_dsn --validate-skew <board.ses>"
    )


# ── Entry point ───────────────────────────────────────────────────────────────


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit("Usage: python -m layout.freerouting_dsn <board.dsn>")

    patch_dsn_for_freerouting(sys.argv[1])
