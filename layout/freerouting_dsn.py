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

import re
import shutil
import sys
from dataclasses import dataclass
from pathlib import Path


# ── DSN pair-directive model ──────────────────────────────────────────────────


@dataclass(frozen=True)
class DsnDiffPairClass:
    class_name: str
    net_p: str          # positive net name (must match schematic exactly)
    net_n: str          # negative net name
    trace_width_mm: float
    diff_gap_mm: float  # intra-pair edge-to-edge spacing


USB_DSN = DsnDiffPairClass(
    class_name="DIFF_USB_90",
    net_p="USB_D_P",
    net_n="USB_D_N",
    trace_width_mm=0.15,
    diff_gap_mm=0.15,
)

ETH_DSN = DsnDiffPairClass(
    class_name="DIFF_ETH_100",
    net_p="ENET_TRD0_P",
    net_n="ENET_TRD0_N",
    trace_width_mm=0.15,
    diff_gap_mm=0.20,
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
        "\nNext step: launch FreeRouting with the patched DSN:\n"
        "  java -jar FreeRouting.jar -de <board.dsn> -do <board.ses> -mp 100"
    )


# ── Entry point ───────────────────────────────────────────────────────────────


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit("Usage: python -m layout.freerouting_dsn <board.dsn>")

    patch_dsn_for_freerouting(sys.argv[1])
