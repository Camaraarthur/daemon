"""
Daemon V0 — Stinger USB Port Manager (Subsystem C)
3x SY6280AAC-gated USB-A ports, ~500mA/port (13k ISET)
"""

from __future__ import annotations

import logging
import subprocess
import time
from dataclasses import dataclass
from typing import Any

from hal.base import Peripheral
from hal.gpio import GpioManager

log = logging.getLogger("daemon.hal.stinger")


@dataclass
class StingerPortState:
    port: int; enabled: bool; overcurrent: bool; usb_device: str | None


class StingerManager(Peripheral):
    PORTS = {
        1: {"en": "STINGER_EN_1", "flag": "STINGER_FLAG_1"},
        2: {"en": "STINGER_EN_2", "flag": "STINGER_FLAG_2"},
        3: {"en": "STINGER_EN_3", "flag": "STINGER_FLAG_3"},
    }

    def __init__(self, gpio: GpioManager):
        super().__init__(name="Stinger", subsystem="C")
        self._gpio = gpio

    def probe(self) -> bool:
        self._alive = True
        self.log.info("Stinger manager ready (3 ports, 500mA/port)")
        return True

    def init(self) -> None:
        pass

    def enable_port(self, port: int) -> None:
        if port in self.PORTS:
            self._gpio.write(self.PORTS[port]["en"], 1)

    def disable_port(self, port: int) -> None:
        if port in self.PORTS:
            self._gpio.write(self.PORTS[port]["en"], 0)

    def is_overcurrent(self, port: int) -> bool:
        if port not in self.PORTS: return False
        return bool(self._gpio.read(self.PORTS[port]["flag"]))

    def power_cycle_port(self, port: int, delay_s: float = 1.0) -> None:
        self.disable_port(port); time.sleep(delay_s); self.enable_port(port)

    def list_usb_devices(self) -> list[str]:
        try:
            out = subprocess.check_output(["lsusb"], timeout=5, text=True)
            return [l.strip() for l in out.strip().split("\n") if l.strip()]
        except Exception:
            return []

    def status(self) -> dict[str, Any]:
        base = super().status()
        base["ports"] = {
            f"port_{p}": {"overcurrent": self.is_overcurrent(p)} for p in (1, 2, 3)
        }
        return base
