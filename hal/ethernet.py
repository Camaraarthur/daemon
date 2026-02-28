"""
Daemon V0 — RTL8152B Ethernet (Subsystem B2)
USB-to-100Base-TX on SL2.1A port 4, 3V3_CLEAN rail
"""

from __future__ import annotations

import logging
import os
import re
import subprocess
from dataclasses import dataclass
from typing import Any

from hal.base import Peripheral

log = logging.getLogger("daemon.hal.ethernet")


@dataclass
class EthernetState:
    interface: str | None; link_up: bool; speed: str | None
    ip_address: str | None; mac_address: str | None; driver: str | None


class EthernetManager(Peripheral):
    def __init__(self):
        super().__init__(name="RTL8152B", subsystem="B2")
        self._iface: str | None = None

    def probe(self) -> bool:
        self._iface = self._find_iface()
        if self._iface:
            self._alive = True
            self.log.info("RTL8152B: %s", self._iface)
            return True
        self.log.warning("RTL8152B not found — check 3V3_CLEAN, MagJack center taps")
        return False

    def init(self) -> None:
        if self._iface:
            subprocess.run(["ip", "link", "set", self._iface, "up"],
                           timeout=5, capture_output=True)

    def has_internet(self) -> bool:
        try:
            subprocess.run(["ping", "-c", "1", "-W", "3", "1.1.1.1"],
                           timeout=5, capture_output=True, check=True)
            return True
        except Exception:
            return False

    def get_state(self) -> EthernetState:
        if not self._iface:
            return EthernetState(None, False, None, None, None, None)
        link_up = False; ip_addr = None; mac = None; speed = None; driver = None
        try:
            out = subprocess.check_output(
                ["ip", "-o", "link", "show", self._iface], timeout=5, text=True)
            link_up = "state UP" in out
            m = re.search(r"link/ether\s+(\S+)", out)
            if m: mac = m.group(1)
        except Exception: pass
        try:
            out = subprocess.check_output(
                ["ip", "-4", "-o", "addr", "show", self._iface], timeout=5, text=True)
            m = re.search(r"inet\s+(\S+)", out)
            if m: ip_addr = m.group(1)
        except Exception: pass
        try:
            out = subprocess.check_output(
                ["ethtool", "-i", self._iface], timeout=5, text=True,
                stderr=subprocess.DEVNULL)
            for l in out.split("\n"):
                if "driver:" in l: driver = l.split("driver:")[1].strip()
        except Exception: pass
        return EthernetState(self._iface, link_up, speed, ip_addr, mac, driver)

    def status(self) -> dict[str, Any]:
        base = super().status()
        if self._iface:
            s = self.get_state()
            base["ethernet"] = {"interface": s.interface, "link_up": s.link_up,
                                "ip": s.ip_address, "driver": s.driver}
        return base

    def _find_iface(self) -> str | None:
        net = "/sys/class/net"
        try:
            for iface in os.listdir(net):
                drv = os.path.join(net, iface, "device/driver")
                if os.path.islink(drv):
                    name = os.path.basename(os.readlink(drv))
                    if name in ("r8152", "cdc_ether"):
                        return iface
        except Exception: pass
        # Fallback: look for eth* interfaces
        try:
            for iface in os.listdir(net):
                if iface.startswith("eth") or iface.startswith("en"):
                    return iface
        except Exception: pass
        return None
