"""
Daemon V0 — GPIO Manager
Wraps libgpiod for all GPIO on the 40-pin Radxa header.

Uses modern chardev API (/dev/gpiochipN), NOT deprecated sysfs.

  OUTPUTS: pin 7 SCREEN_BL, pin 22 SCREEN_RST, pin 29/31/33 STINGER_EN,
           pin 32 SCREEN_DC, pin 36 LED_DIN
  INPUTS:  pin 8/10/11 STINGER_FLAG (edge-triggered for overcurrent),
           pin 37 JOY_SW

Edge detection: STINGER_FLAG lines use BOTH-edge detection for microsecond-level
overcurrent detection instead of polling.  Events are buffered by the kernel and
drained by the agent loop via drain_edge_events().
"""

from __future__ import annotations

import logging
import subprocess
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

log = logging.getLogger("daemon.hal.gpio")

OUTPUT_PINS = {
    "SCREEN_BL":    {"pin": 7,  "active_high": True,  "default": 0},
    "SCREEN_RST":   {"pin": 22, "active_high": False, "default": 1},
    "SCREEN_DC":    {"pin": 32, "active_high": True,  "default": 0},
    "STINGER_EN_1": {"pin": 29, "active_high": True,  "default": 1},
    "STINGER_EN_2": {"pin": 31, "active_high": True,  "default": 1},
    "STINGER_EN_3": {"pin": 33, "active_high": True,  "default": 1},
}

INPUT_PINS = {
    "STINGER_FLAG_1": {"pin": 11, "active_low": True},
    "STINGER_FLAG_2": {"pin": 8,  "active_low": True},
    "STINGER_FLAG_3": {"pin": 10, "active_low": True},
    "JOY_SW":         {"pin": 37, "active_low": True},
}

# Lines that should use edge detection for safety-critical monitoring.
# SY6280 FLAG is open-drain active-low: asserted = overcurrent fault.
EDGE_DETECT_LINES = {"STINGER_FLAG_1", "STINGER_FLAG_2", "STINGER_FLAG_3"}


@dataclass
class GpioLine:
    name: str
    chip: str
    line: int
    direction: str
    active_low: bool
    edge: bool = False
    _handle: Any = None


class GpioManager:
    def __init__(self) -> None:
        self._lines: dict[str, GpioLine] = {}
        self._gpiod = None
        self._chip_cache: dict[str, Any] = {}
        self._edge_capable = False
        try:
            import gpiod
            self._gpiod = gpiod
            # Check if edge detection API is available (libgpiod v2+)
            self._edge_capable = hasattr(gpiod.line, "Edge")
            log.info("Using libgpiod Python bindings (edge_capable=%s)",
                     self._edge_capable)
        except ImportError:
            log.warning("gpiod not found — falling back to subprocess gpioset/gpioget")

    @property
    def has_edge_detection(self) -> bool:
        """True if any lines are configured with edge detection."""
        return any(line.edge for line in self._lines.values())

    def discover_chips(self) -> list[dict[str, Any]]:
        chips = []
        for path in sorted(Path("/dev").glob("gpiochip*")):
            info: dict[str, Any] = {"path": str(path)}
            if self._gpiod:
                try:
                    chip = self._gpiod.Chip(str(path))
                    info["name"] = chip.get_info().name
                    info["num_lines"] = chip.get_info().num_lines
                    chip.close()
                except Exception as exc:
                    info["error"] = str(exc)
            chips.append(info)
        return chips

    def setup_output(self, name: str, chip: str, line: int,
                     active_low: bool = False, initial: int = 0) -> None:
        gpio_line = GpioLine(name=name, chip=chip, line=line,
                             direction="output", active_low=active_low)
        if self._gpiod:
            try:
                chip_obj = self._get_chip(chip)
                config = self._gpiod.LineSettings(
                    direction=self._gpiod.line.Direction.OUTPUT,
                    active_low=active_low,
                    output_value=self._gpiod.line.Value(initial),
                )
                request = chip_obj.request_lines(
                    consumer=f"daemon-{name}", config={line: config})
                gpio_line._handle = request
            except Exception as exc:
                log.error("Failed to claim GPIO %s: %s", name, exc)
                return
        self._lines[name] = gpio_line
        log.info("GPIO output %s -> chip=%s line=%d", name, chip, line)

    def setup_input(self, name: str, chip: str, line: int,
                    active_low: bool = False) -> None:
        use_edge = name in EDGE_DETECT_LINES and self._edge_capable
        gpio_line = GpioLine(name=name, chip=chip, line=line,
                             direction="input", active_low=active_low,
                             edge=use_edge)
        if self._gpiod:
            try:
                chip_obj = self._get_chip(chip)
                settings_kwargs: dict[str, Any] = {
                    "direction": self._gpiod.line.Direction.INPUT,
                    "active_low": active_low,
                    "bias": self._gpiod.line.Bias.DISABLED,
                }
                if use_edge:
                    settings_kwargs["edge_detection"] = self._gpiod.line.Edge.BOTH
                    log.info("GPIO input %s -> edge detection ENABLED (overcurrent fast-path)",
                             name)
                config = self._gpiod.LineSettings(**settings_kwargs)
                request = chip_obj.request_lines(
                    consumer=f"daemon-{name}", config={line: config})
                gpio_line._handle = request
            except Exception as exc:
                log.error("Failed to claim GPIO %s: %s", name, exc)
                # Retry without edge detection if it failed
                if use_edge:
                    log.warning("Retrying %s without edge detection", name)
                    gpio_line.edge = False
                    self.setup_input(name, chip, line, active_low)
                return
        self._lines[name] = gpio_line

    def write(self, name: str, value: int) -> None:
        line = self._lines.get(name)
        if not line:
            return
        if self._gpiod and line._handle:
            val = self._gpiod.line.Value(value)
            line._handle.set_value(line.line, val)
        else:
            subprocess.run(["gpioset", line.chip, f"{line.line}={value}"],
                           check=True, timeout=5)

    def read(self, name: str) -> int | None:
        line = self._lines.get(name)
        if not line:
            return None
        if self._gpiod and line._handle:
            val = line._handle.get_value(line.line)
            return val.value if hasattr(val, "value") else int(val)
        else:
            try:
                out = subprocess.check_output(
                    ["gpioget", line.chip, str(line.line)], timeout=5, text=True)
                return int(out.strip())
            except Exception:
                return None

    def drain_edge_events(self) -> list[tuple[str, str]]:
        """Non-blocking drain of all pending GPIO edge events.

        Returns list of (line_name, edge_type) tuples.
        edge_type is "rising" or "falling".

        This is used for microsecond-level overcurrent detection on STINGER_FLAG
        lines instead of polling.  The kernel buffers edges between calls.
        """
        events: list[tuple[str, str]] = []
        if not self._gpiod or not self._edge_capable:
            return events
        for name, line in self._lines.items():
            if not line.edge or not line._handle:
                continue
            try:
                # Non-blocking check: timeout=0 returns immediately
                while line._handle.wait_edge_events(timeout=0):
                    for ev in line._handle.read_edge_events():
                        edge_type = "rising" if ev.event_type.name == "RISING_EDGE" else "falling"
                        events.append((name, edge_type))
            except Exception:
                pass
        return events

    def read_stinger_flags(self) -> dict[int, bool]:
        """Read SY6280 FLAG lines via level polling.

        True = overcurrent fault.
        Note: active_low=True in setup_input() already inverts the logic,
        so read() returning 1 means the SY6280 FLAG is asserted (OC condition).
        Prefer drain_edge_events() for faster detection.
        """
        return {
            1: bool(self.read("STINGER_FLAG_1")),
            2: bool(self.read("STINGER_FLAG_2")),
            3: bool(self.read("STINGER_FLAG_3")),
        }

    def pulse_reset(self, name: str = "SCREEN_RST", duration_s: float = 0.020) -> None:
        import time
        self.write(name, 0)
        time.sleep(duration_s)
        self.write(name, 1)
        time.sleep(duration_s)

    def _get_chip(self, path: str) -> Any:
        if path not in self._chip_cache:
            self._chip_cache[path] = self._gpiod.Chip(path)
        return self._chip_cache[path]

    def teardown(self) -> None:
        for line in self._lines.values():
            if line._handle:
                try:
                    line._handle.release()
                except Exception:
                    pass
        self._lines.clear()
        for chip in self._chip_cache.values():
            try:
                chip.close()
            except Exception:
                pass
        self._chip_cache.clear()
