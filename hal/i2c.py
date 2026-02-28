"""
Daemon V0 — I2C Bus Driver
Wraps smbus2 for I2C1 (pins 3/5).

Devices on I2C1:
  0x48 — ADS1015 (joystick ADC)
  0x75 — IP5328P (PMIC, via 470 ohm series protection)
"""

from __future__ import annotations

import logging
from typing import Any

from hal.base import BusError

log = logging.getLogger("daemon.hal.i2c")

_smbus2 = None
try:
    import smbus2
    _smbus2 = smbus2
except ImportError:
    log.warning("smbus2 not installed — I2C will use raw ioctl fallback")


class I2CBus:
    def __init__(self, bus_id: int = 1) -> None:
        self.bus_id = bus_id
        self._bus = None
        if _smbus2:
            try:
                self._bus = _smbus2.SMBus(bus_id)
                log.info("Opened /dev/i2c-%d via smbus2", bus_id)
            except FileNotFoundError:
                log.error("/dev/i2c-%d not found — modprobe i2c-dev", bus_id)
            except PermissionError:
                log.error("Permission denied on /dev/i2c-%d", bus_id)

    @property
    def available(self) -> bool:
        return self._bus is not None

    def scan(self) -> dict[int, str]:
        """Scan 7-bit I2C addresses.  Equivalent to: i2cdetect -y 1"""
        results = {}
        if not self._bus:
            return results
        for addr in range(0x03, 0x78):
            try:
                self._bus.read_byte(addr)
                results[addr] = "ACK"
            except OSError:
                pass
        return results

    def read_byte(self, addr: int, reg: int) -> int:
        if not self._bus:
            raise BusError("I2C bus not available")
        try:
            return self._bus.read_byte_data(addr, reg)
        except OSError as exc:
            raise BusError(f"I2C read 0x{addr:02x} reg 0x{reg:02x}: {exc}") from exc

    def write_byte(self, addr: int, reg: int, value: int) -> None:
        if not self._bus:
            raise BusError("I2C bus not available")
        try:
            self._bus.write_byte_data(addr, reg, value)
        except OSError as exc:
            raise BusError(f"I2C write 0x{addr:02x} reg 0x{reg:02x}: {exc}") from exc

    def read_word(self, addr: int, reg: int) -> int:
        """Read 16-bit word big-endian (TI convention)."""
        if not self._bus:
            raise BusError("I2C bus not available")
        try:
            raw = self._bus.read_word_data(addr, reg)
            return ((raw & 0xFF) << 8) | ((raw >> 8) & 0xFF)
        except OSError as exc:
            raise BusError(f"I2C read_word 0x{addr:02x}: {exc}") from exc

    def write_word(self, addr: int, reg: int, value: int) -> None:
        if not self._bus:
            raise BusError("I2C bus not available")
        try:
            swapped = ((value & 0xFF) << 8) | ((value >> 8) & 0xFF)
            self._bus.write_word_data(addr, reg, swapped)
        except OSError as exc:
            raise BusError(f"I2C write_word 0x{addr:02x}: {exc}") from exc

    def read_block(self, addr: int, reg: int, length: int) -> list[int]:
        if not self._bus:
            raise BusError("I2C bus not available")
        try:
            return self._bus.read_i2c_block_data(addr, reg, length)
        except OSError as exc:
            raise BusError(f"I2C read_block 0x{addr:02x}: {exc}") from exc

    def close(self) -> None:
        if self._bus:
            self._bus.close()
            self._bus = None
