"""
Daemon V0 — ADS1015 Joystick ADC (Subsystem E)
AIN0=VRX, AIN1=VRY on I2C1 (0x48), button on GPIO pin 37
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass
from typing import Any

from hal.base import BusError, Peripheral
from hal.gpio import GpioManager
from hal.i2c import I2CBus

log = logging.getLogger("daemon.hal.joystick")

REG_CONVERSION = 0x00; REG_CONFIG = 0x01
CFG_OS = 0x8000; CFG_PGA_4096 = 0x0200; CFG_SINGLE = 0x0100
CFG_DR_1600 = 0x0080; CFG_COMP_DIS = 0x0003
MUX = {0: 0x4000, 1: 0x5000, 2: 0x6000, 3: 0x7000}


@dataclass
class JoystickState:
    x: float; y: float; x_raw: int; y_raw: int; button: bool


class ADS1015Joystick(Peripheral):
    I2C_ADDR = 0x48

    def __init__(self, bus: I2CBus, gpio: GpioManager):
        super().__init__(name="ADS1015", subsystem="E")
        self._bus = bus; self._gpio = gpio

    def probe(self) -> bool:
        try:
            self._bus.read_word(self.I2C_ADDR, REG_CONFIG)
            self._alive = True
            self.log.info("ADS1015 probed at 0x%02x", self.I2C_ADDR)
            return True
        except BusError as exc:
            self.log.error("ADS1015 not found: %s", exc)
            return False

    def init(self) -> None:
        pass

    def read_channel(self, ch: int) -> int:
        config = CFG_OS | MUX[ch] | CFG_PGA_4096 | CFG_SINGLE | CFG_DR_1600 | CFG_COMP_DIS
        self.safe_call(self._bus.write_word, self.I2C_ADDR, REG_CONFIG, config)
        time.sleep(0.002)
        raw = self.safe_call(self._bus.read_word, self.I2C_ADDR, REG_CONVERSION)
        return (raw >> 4) & 0x0FFF

    def read(self) -> JoystickState:
        x_raw = self.read_channel(0); y_raw = self.read_channel(1)
        btn = self._gpio.read("JOY_SW")
        return JoystickState(
            x=round(x_raw / 4095.0, 3), y=round(y_raw / 4095.0, 3),
            x_raw=x_raw, y_raw=y_raw, button=bool(btn),
        )

    def status(self) -> dict[str, Any]:
        base = super().status()
        if self.alive:
            try:
                s = self.read()
                base["joystick"] = {"x": s.x, "y": s.y, "button": s.button}
            except BusError:
                pass
        return base
