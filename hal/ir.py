"""
Daemon V0 — IR Blaster (Subsystem E3)
940nm LED via AO3400A N-FET, 106mA pulsed, <10% duty
GPIO: aux_hdr pin 3, uses gpio-ir-tx + ir-ctl (v4l-utils)
"""

from __future__ import annotations

import logging
import subprocess
from typing import Any

from hal.base import Peripheral

log = logging.getLogger("daemon.hal.ir")


class IRBlaster(Peripheral):
    def __init__(self, device: str = "/dev/lirc0"):
        super().__init__(name="IR_Blaster", subsystem="E3")
        self._device = device; self._has_ir_ctl = False

    def probe(self) -> bool:
        try:
            subprocess.run(["ir-ctl", "--version"], capture_output=True, timeout=5)
            self._has_ir_ctl = True
        except FileNotFoundError:
            self.log.warning("ir-ctl not found — install v4l-utils")
        self._alive = True
        return True

    def init(self) -> None:
        pass

    def send_raw(self, pulses_us: list[int]) -> bool:
        if not self._has_ir_ctl: return False
        ir_data = ""
        for i, d in enumerate(pulses_us):
            ir_data += f"{'pulse' if i % 2 == 0 else 'space'} {d}\n"
        try:
            proc = subprocess.run(
                ["ir-ctl", "--device", self._device, "--send=-"],
                input=ir_data, text=True, timeout=10, capture_output=True)
            return proc.returncode == 0
        except Exception:
            return False

    def send_nec(self, address: int, command: int) -> bool:
        pulses = [9000, 4500]
        data = (address & 0xFF) | ((~address & 0xFF) << 8) | \
               ((command & 0xFF) << 16) | ((~command & 0xFF) << 24)
        for i in range(32):
            pulses.append(562)
            pulses.append(1688 if data & (1 << i) else 562)
        pulses.append(562)
        return self.send_raw(pulses)

    def status(self) -> dict[str, Any]:
        base = super().status()
        base["ir_ctl"] = self._has_ir_ctl
        return base
