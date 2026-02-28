"""
Daemon V0 — ST7789V2 SPI Display (Subsystem D)
240x280 px, SPI3 (pins 19/21/23/24), GPIO DC/RST/BL (pins 32/22/7)
"""

from __future__ import annotations

import logging
import struct
import time
from typing import Any

from hal.base import Peripheral
from hal.gpio import GpioManager

log = logging.getLogger("daemon.hal.display")

CMD_SWRESET = 0x01; CMD_SLPOUT = 0x11; CMD_INVON = 0x21
CMD_DISPON = 0x29; CMD_CASET = 0x2A; CMD_RASET = 0x2B
CMD_RAMWR = 0x2C; CMD_COLMOD = 0x3A; CMD_MADCTL = 0x36; CMD_SLPIN = 0x10

MADCTL_BGR = 0x08; MADCTL_MV = 0x20; MADCTL_MX = 0x40; MADCTL_MY = 0x80


class ST7789(Peripheral):
    WIDTH = 240; HEIGHT = 280

    def __init__(self, gpio: GpioManager, spi_bus: int = 3, spi_cs: int = 0):
        super().__init__(name="ST7789V2", subsystem="D")
        self._gpio = gpio
        self._spi_bus = spi_bus; self._spi_cs = spi_cs; self._spi = None

    def probe(self) -> bool:
        try:
            import spidev
            self._spi = spidev.SpiDev()
            self._spi.open(self._spi_bus, self._spi_cs)
            self._spi.max_speed_hz = 40_000_000; self._spi.mode = 0
            self._alive = True
            self.log.info("ST7789V2 SPI opened @ 40MHz")
            return True
        except (FileNotFoundError, ImportError) as exc:
            self.log.error("ST7789V2 SPI probe failed: %s", exc)
            return False

    def init(self, rotation: int = 0) -> None:
        if not self._alive: return
        self._gpio.pulse_reset("SCREEN_RST", 0.020); time.sleep(0.150)
        self._cmd(CMD_SWRESET); time.sleep(0.150)
        self._cmd(CMD_SLPOUT); time.sleep(0.120)
        self._cmd(CMD_COLMOD, [0x55])  # RGB565
        self._cmd(CMD_MADCTL, [rotation | MADCTL_BGR])
        self._cmd(CMD_INVON)
        self._cmd(CMD_DISPON); time.sleep(0.050)
        self._gpio.write("SCREEN_BL", 1)
        self.log.info("ST7789V2 initialized: 240x280 RGB565")

    def fill(self, color_rgb565: int) -> None:
        self._set_window(0, 0, self.WIDTH - 1, self.HEIGHT - 1)
        pixel = struct.pack(">H", color_rgb565)
        self._cmd(CMD_RAMWR)
        buf = pixel * min(4096, self.WIDTH * self.HEIGHT)
        remaining = self.WIDTH * self.HEIGHT * 2
        while remaining > 0:
            n = min(len(buf), remaining)
            self._data(buf[:n]); remaining -= n

    def blit(self, x: int, y: int, w: int, h: int, data: bytes) -> None:
        self._set_window(x, y, x + w - 1, y + h - 1)
        self._cmd(CMD_RAMWR)
        off = 0
        while off < len(data):
            self._data(data[off:off + 4096]); off += 4096

    def set_backlight(self, on: int) -> None:
        self._gpio.write("SCREEN_BL", 1 if on else 0)

    def teardown(self) -> None:
        self.set_backlight(0)
        if self._spi: self._spi.close(); self._spi = None

    @staticmethod
    def rgb_to_565(r: int, g: int, b: int) -> int:
        return ((r & 0xF8) << 8) | ((g & 0xFC) << 3) | (b >> 3)

    def _set_window(self, x0: int, y0: int, x1: int, y1: int) -> None:
        self._cmd(CMD_CASET, [(x0 >> 8), x0 & 0xFF, (x1 >> 8), x1 & 0xFF])
        self._cmd(CMD_RASET, [(y0 >> 8), y0 & 0xFF, (y1 >> 8), y1 & 0xFF])

    def _cmd(self, cmd: int, args: list[int] | None = None) -> None:
        self._gpio.write("SCREEN_DC", 0); self._spi.xfer2([cmd])
        if args:
            self._gpio.write("SCREEN_DC", 1); self._spi.xfer2(args)

    def _data(self, data: bytes | list[int]) -> None:
        self._gpio.write("SCREEN_DC", 1)
        self._spi.xfer2(list(data) if isinstance(data, bytes) else data)
