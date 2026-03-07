#!/usr/bin/env python3
"""Clean up the Daemon V0 PCB display for usability.

- Gives important components human-readable labels
- Hides reference/value text on passives and clutter
- Sizes text appropriately for the board scale

Usage:
  PYTHONPATH=/usr/lib/python3/dist-packages python scripts/cleanup_board_display.py
"""

from __future__ import annotations

import sys
from pathlib import Path

try:
    import pcbnew
except ImportError:
    sys.exit("pcbnew not found.")

REPO = Path(__file__).resolve().parent.parent
BOARD_PATH = REPO / "daemon_v0.kicad_pcb"

# ── Human-readable labels for important components ────────────────────────────
# ref → display name (shown as Value field on silkscreen)
LABELS = {
    # Power
    "U1":  "PMIC\nIP5328P",
    "L1":  "4.7µH BOOST",
    "U2":  "LDO 3.3V\nAP2112K",

    # USB Hub
    "U4":  "USB HUB\nSL2.1A",
    "Y1":  "12MHz",

    # Stinger switches
    "U5":  "STINGER 1\nSY6280",
    "U6":  "STINGER 2\nSY6280",
    "U7":  "STINGER 3\nSY6280",

    # Connectors
    "J12": "RADXA 40-PIN\nHEADER",
    "J8":  "USB-C\nGOOBAY",
    "J2":  "USB-A ①\n(MALE)",
    "J3":  "USB-A ②",
    "J4":  "USB-A ③",
    "J9":  "RJ45\nETHERNET",
    "J10": "WAGO\n24V I/O",
    "J13": "TRRS\nAUDIO",
    "J14": "SPEAKER",
    "J5":  "SCREEN\n8-PIN",
    "J6":  "JOYSTICK\n5-PIN",
    "J1":  "BATTERY\nJST",
    "J7":  "PWR HDR",
    "J11": "AUX GPIO",

    # RF
    "U9":  "RF\nCC1101",
    "AE1": "915MHz\nANTENNA",
    "Y2":  "26MHz",

    # Ethernet
    "U10": "ETH\nRTL8152B",
    "Y3":  "25MHz",

    # Audio
    "U12": "AMP\nMAX98357A",
    "U13": "MIC\nINMP441",

    # Industrial
    "U11": "ISO\nISO1212",

    # Heartbeat
    "U3":  "HEARTBEAT\nNE555",

    # Joystick ADC
    "U8":  "ADC\nADS1015",

    # Power UX
    "SW1": "POWER\nBUTTON",
    "Q1":  "PNP\nBC857",
    "Q2":  "PMOS\nBSS84",
    "Q3":  "NMOS\n2N7002",
    "Q4":  "IR DRIVE\nAO3400A",

    # LEDs
    "D3":  "LED①",
    "D4":  "LED②",
    "D5":  "LED③",
    "D6":  "LED④",
    "D7":  "IR LED",

    # Test points
    "TP1": "TP VIN",
    "TP2": "TP BAT",
    "TP3": "TP SW",
    "TP4": "TP VOUT",
}

# Components to HIDE all text on (passives, generic parts)
HIDE_PREFIXES = {"C", "R", "F", "FB", "TH", "D8", "D9", "D10", "D11", "L2"}


def main() -> None:
    board = pcbnew.LoadBoard(str(BOARD_PATH))
    fps = {fp.GetReference(): fp for fp in board.GetFootprints()}

    labeled = 0
    hidden = 0

    for ref, fp in fps.items():
        ref_field = fp.Reference()
        val_field = fp.Value()

        # Determine if this is a "hide" component
        should_hide = False
        for prefix in HIDE_PREFIXES:
            if ref == prefix or ref.startswith(prefix) and (
                len(ref) == len(prefix) or ref[len(prefix):].isdigit()
            ):
                should_hide = True
                break

        if ref in LABELS:
            # Show a nice label as the Value text
            val_field.SetText(LABELS[ref])
            val_field.SetVisible(True)
            val_field.SetTextSize(pcbnew.VECTOR2I(pcbnew.FromMM(1.0), pcbnew.FromMM(1.0)))
            val_field.SetTextThickness(pcbnew.FromMM(0.15))

            # Hide the raw ref designator (U1, J2 etc.) — the label is enough
            ref_field.SetVisible(False)
            labeled += 1

        elif should_hide:
            # Hide everything on passives
            ref_field.SetVisible(False)
            val_field.SetVisible(False)
            hidden += 1

        else:
            # Unknown component — show ref, small text
            ref_field.SetVisible(True)
            ref_field.SetTextSize(pcbnew.VECTOR2I(pcbnew.FromMM(0.8), pcbnew.FromMM(0.8)))
            val_field.SetVisible(False)

    pcbnew.SaveBoard(str(BOARD_PATH), board)
    print(f"Display cleanup complete:")
    print(f"  Labeled:  {labeled} components (readable names)")
    print(f"  Hidden:   {hidden} components (passives/clutter)")
    print(f"  Visible:  {len(fps) - labeled - hidden} (ref only)")


if __name__ == "__main__":
    main()
