"""
Daemon V0 — Audio Subsystem
MAX98357A (I2S playback) + INMP441 (I2S capture)
I2S pins: BCLK=12, LRCLK=35, DATA_OUT=40, DATA_IN=38
"""

from __future__ import annotations

import logging
import subprocess
from typing import Any

from hal.base import Peripheral

log = logging.getLogger("daemon.hal.audio")


class AudioSubsystem(Peripheral):
    def __init__(self):
        super().__init__(name="Audio", subsystem="Audio")

    def probe(self) -> bool:
        try:
            out = subprocess.check_output(["aplay", "-l"], timeout=5,
                                          text=True, stderr=subprocess.DEVNULL)
            if "card" in out.lower():
                self._alive = True; return True
        except Exception:
            pass
        self.log.warning("No ALSA devices — load I2S overlay")
        return False

    def init(self) -> None:
        try:
            subprocess.run(["amixer", "set", "Master", "80%", "unmute"],
                           timeout=5, capture_output=True)
        except Exception:
            pass

    def play_wav(self, path: str, device: str = "default") -> bool:
        try:
            subprocess.run(["aplay", "-D", device, path],
                           timeout=30, check=True, capture_output=True)
            return True
        except Exception:
            return False

    def record_wav(self, path: str, duration_s: int = 5,
                   rate: int = 44100, device: str = "default") -> bool:
        try:
            subprocess.run(["arecord", "-D", device, "-f", "S32_LE",
                            "-r", str(rate), "-c", "1", "-d", str(duration_s), path],
                           timeout=duration_s + 10, check=True, capture_output=True)
            return True
        except Exception:
            return False

    def status(self) -> dict[str, Any]:
        base = super().status()
        return base
