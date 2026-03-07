#!/usr/bin/env python3
"""Merge audio subsystem netlist into the full system netlist.

The audio subsystem (daemon_v0_audio.net) uses independent ref designators
that conflict with the main system (daemon_v0_full_system.net). This script
re-prefixes audio refs to avoid collision, then appends audio components
and nets to the main netlist for import into the PCB.

Output: daemon_v0_merged.net
"""

from __future__ import annotations

import re
from collections import Counter
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
MAIN_NET = REPO / "daemon_v0_full_system.net"
AUDIO_NET = REPO / "daemon_v0_audio.net"
OUT_NET = REPO / "daemon_v0_merged.net"


def _parse_components(text: str) -> list[dict]:
    """Extract all (comp ...) blocks with ref, value, footprint."""
    comps = []
    for m in re.finditer(r'\(comp\s*\n?\s*\(ref\s+"([^"]+)"\)', text):
        ref = m.group(1)
        block = text[m.start():m.start() + 500]
        fp_m = re.search(r'\(footprint\s+"([^"]+)"\)', block)
        val_m = re.search(r'\(value\s+"([^"]*)"', block)
        if fp_m:
            comps.append({
                "ref": ref,
                "value": val_m.group(1) if val_m else ref,
                "footprint": fp_m.group(1),
            })
    return comps


def _parse_nets(text: str) -> list[dict]:
    """Extract nets with code, name."""
    nets = []
    for m in re.finditer(
        r'\(net\s*\n?\s*\(code\s+"?(\d+)"?\)\s*\n?\s*\(name\s+"([^"]+)"\)',
        text,
    ):
        nets.append({"code": int(m.group(1)), "name": m.group(2)})
    return nets


def _remap_refs(comps: list[dict], existing_refs: set[str]) -> dict[str, str]:
    """Build a ref remapping dict to avoid collisions."""
    remap = {}
    # Count existing refs by prefix
    prefix_counts: Counter = Counter()
    for ref in existing_refs:
        prefix = re.match(r'^([A-Z]+)', ref)
        if prefix:
            num = re.search(r'(\d+)$', ref)
            if num:
                prefix_counts[prefix.group(1)] = max(
                    prefix_counts[prefix.group(1)], int(num.group(1))
                )

    for comp in comps:
        old_ref = comp["ref"]
        prefix_m = re.match(r'^([A-Z]+)(\d+)$', old_ref)
        if prefix_m:
            p, _n = prefix_m.group(1), int(prefix_m.group(2))
            prefix_counts[p] += 1
            new_ref = f"{p}{prefix_counts[p]}"
            remap[old_ref] = new_ref
        else:
            remap[old_ref] = old_ref
    return remap


def main() -> None:
    main_text = MAIN_NET.read_text(encoding="utf-8")
    audio_text = AUDIO_NET.read_text(encoding="utf-8")

    main_comps = _parse_components(main_text)
    audio_comps = _parse_components(audio_text)
    main_nets = _parse_nets(main_text)
    audio_nets = _parse_nets(audio_text)

    main_refs = {c["ref"] for c in main_comps}
    remap = _remap_refs(audio_comps, main_refs)

    # Apply remapping to audio components
    for comp in audio_comps:
        comp["ref"] = remap[comp["ref"]]

    # Merge net lists — keep main net codes, offset audio net codes
    max_main_code = max((n["code"] for n in main_nets), default=0)
    main_net_names = {n["name"] for n in main_nets}

    merged_nets = list(main_nets)
    audio_net_code_offset = max_main_code + 1
    for an in audio_nets:
        if an["name"] in main_net_names:
            continue  # shared net (e.g., GND, I2S_BCLK) — already in main
        merged_nets.append({
            "code": audio_net_code_offset,
            "name": an["name"],
        })
        audio_net_code_offset += 1

    # Write merged netlist in simplified format for import_netlist.py
    all_comps = main_comps + audio_comps
    lines = [
        '(export',
        '  (version "D")',
        '  (components',
    ]
    for c in all_comps:
        lines.append(f'    (comp (ref "{c["ref"]}") (value "{c["value"]}") (footprint "{c["footprint"]}"))')
    lines.append('  )')
    lines.append('  (nets')
    for n in merged_nets:
        lines.append(f'    (net (code {n["code"]}) (name "{n["name"]}"))')
    lines.append('  )')
    lines.append(')')

    OUT_NET.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"Merged netlist → {OUT_NET}")
    print(f"  Main components:  {len(main_comps)}")
    print(f"  Audio components: {len(audio_comps)} (remapped: {sum(1 for k, v in remap.items() if k != v)})")
    print(f"  Total components: {len(all_comps)}")
    print(f"  Total nets:       {len(merged_nets)}")
    print(f"\nRef remapping (audio):")
    for old, new in sorted(remap.items()):
        print(f"  {old} → {new}")


if __name__ == "__main__":
    main()
