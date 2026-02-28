#!/usr/bin/env python3
"""
Daemon V0 — Main Entry Point

Usage:
  python -m daemon_core.main           # Run the full agent daemon
  python -m daemon_core.main scan      # Hardware scan only (no agent loop)
  python -m daemon_core.main status    # Print hardware status JSON

This is the top-level process that:
  1. Configures logging (systemd journal or file)
  2. Loads hardware specs from specs/ YAML database
  3. Initializes all HAL drivers via probe cascade
  4. Runs the OODA agent loop until SIGTERM/SIGINT

Designed to run as a systemd service (see systemd/daemon-v0.service).
Can also be run interactively for bringup and debugging.

The daemon keeps CPU utilization below 60% sustained to avoid DVFS
throttling in the pocket environment (ARCHITECTURE.md §3.5).
"""

from __future__ import annotations

import json
import logging
import sys

log = logging.getLogger("daemon")


def setup_logging(level: str = "INFO") -> None:
    """Configure structured logging for systemd journal compatibility."""
    fmt = "%(asctime)s [%(levelname)-8s] %(name)-25s %(message)s"
    logging.basicConfig(
        level=getattr(logging, level.upper(), logging.INFO),
        format=fmt,
        handlers=[
            logging.StreamHandler(sys.stdout),
        ],
    )
    # Reduce noise from libraries
    logging.getLogger("urllib3").setLevel(logging.WARNING)
    logging.getLogger("spidev").setLevel(logging.WARNING)


def cmd_run() -> None:
    """Run the full agent daemon."""
    from daemon_core.agent import AgentLoop

    agent = AgentLoop()
    agent.setup()
    agent.run()


def cmd_scan() -> None:
    """Run hardware scan only (no agent loop)."""
    from daemon_core.scanner import scan_hardware

    result = scan_hardware()
    print()
    print("═══ Scan Summary ═══")
    print(f"  GPIO chips:    {len(result.gpio_chips)}")
    print(f"  I2C devices:   {len(result.i2c_devices)}")
    print(f"  I2C missing:   {len(result.i2c_missing)}")
    print(f"  SPI devices:   {len(result.spi_devices)}")
    print(f"  USB devices:   {len(result.usb_devices)}")
    print(f"  ALSA cards:    {len(result.alsa_cards)}")
    print(f"  Warnings:      {len(result.warnings)}")
    if result.warnings:
        print()
        print("Warnings:")
        for w in result.warnings:
            print(f"  - {w}")


def cmd_status() -> None:
    """Initialize hardware and print full status as JSON."""
    from daemon_core.agent import AgentLoop

    agent = AgentLoop()
    agent.setup()
    status = agent.get_full_status()
    print(json.dumps(status, indent=2, default=str))


def main() -> None:
    setup_logging()

    if len(sys.argv) > 1:
        command = sys.argv[1]
        if command == "scan":
            cmd_scan()
        elif command == "status":
            cmd_status()
        elif command in ("run", "start"):
            cmd_run()
        elif command in ("-h", "--help", "help"):
            print("Usage: python -m daemon_core.main [scan|status|run]")
            print()
            print("Commands:")
            print("  run      Start the full agent daemon (default)")
            print("  scan     Hardware scan only, print results")
            print("  status   Initialize hardware, print JSON status")
        else:
            print(f"Unknown command: {command}", file=sys.stderr)
            sys.exit(1)
    else:
        cmd_run()


if __name__ == "__main__":
    main()
