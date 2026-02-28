"""
Daemon V0 — WS2812B LEDs (Subsystem E2)
4x RGB LEDs on pin 36 (LED_DIN), DMA/PWM driver required.
"""

from __future__ import annotations

import logging
from typing import Any

from hal.base import Peripheral

log = logging.getLogger("daemon.hal.leds")

STATUS_READY = (0, 255, 0); STATUS_WARNING = (255, 255, 0)
STATUS_ERROR = (255, 0, 0); STATUS_BOOT = (0, 0, 255)


class WS2812B(Peripheral):
    LED_COUNT = 4

    def __init__(self, gpio_pin: int = 18):
        super().__init__(name="WS2812B", subsystem="E2")
        self._gpio_pin = gpio_pin; self._strip = None
        self._pixels = [(0, 0, 0)] * self.LED_COUNT; self._brightness = 50

    def probe(self) -> bool:
        try:
            from rpi_ws281x import PixelStrip  # noqa: F401
            self.log.info("rpi_ws281x available")
        except ImportError:
            self.log.warning("rpi_ws281x not installed — stub mode")
        self._alive = True
        return True

    def init(self) -> None:
        try:
            from rpi_ws281x import PixelStrip
            self._strip = PixelStrip(self.LED_COUNT, self._gpio_pin,
                                     800000, 10, False, self._brightness, 0)
            self._strip.begin()
        except Exception as exc:
            self.log.warning("LED hw init failed: %s (stub)", exc)

    def set_pixel(self, i: int, r: int, g: int, b: int) -> None:
        if 0 <= i < self.LED_COUNT:
            self._pixels[i] = (r, g, b)
            if self._strip:
                from rpi_ws281x import Color
                self._strip.setPixelColor(i, Color(r, g, b))

    def set_all(self, r: int, g: int, b: int) -> None:
        for i in range(self.LED_COUNT): self.set_pixel(i, r, g, b)

    def show(self) -> None:
        if self._strip: self._strip.show()

    def set_status(self, color: tuple[int, int, int]) -> None:
        self.set_all(*color); self.show()

    def clear(self) -> None:
        self.set_all(0, 0, 0); self.show()

    def teardown(self) -> None:
        self.clear()

    def status(self) -> dict[str, Any]:
        base = super().status()
        base["pixels"] = self._pixels; base["hw_driver"] = self._strip is not None
        return base
