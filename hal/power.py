"""
Daemon V0 — IP5328P PMIC Telemetry Driver
Subsystem A — Core Power Management

The IP5328P sits on I2C1 at address 0x75, behind 470Ω series protection
resistors (ECO #2026-03-F/H).  It provides:

  - Battery voltage (14-bit ADC, ~0.26855 mV/LSB)
  - Battery current (signed: positive = charging, negative = discharging)
  - VBUS input voltage (USB charger present?)
  - Charge state (charging / standby / discharging / fault)
  - System control (boost enable/disable, charger control)

The NE555 heartbeat circuit (Subsystem G) fires a 61mA dummy-load pulse
every ~15s to prevent the IP5328P's auto-shutdown feature from killing
the 5V rail when the board is idle.  This is hardware-only; no software
interaction needed for the heartbeat.

Software-triggered shutdown: drive PMIC_KILL GPIO high → 2N7002 NMOS
pulls PMIC_KEY low → IP5328P interprets as sustained button hold → shutdown.

Community keywords: "IP5306 successor", "power bank PMIC", "boost not starting",
"auto-shutdown workaround", "MFB double-tap", "battery gauge I2C"
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any

from hal.base import BusError, Peripheral
from hal.i2c import I2CBus

log = logging.getLogger("daemon.hal.power")

# IP5328P I2C register addresses (from datasheet + community RE)
REG_SYS_CTL0          = 0x01
REG_SYS_CTL1          = 0x02
REG_SYS_CTL2          = 0x0C
REG_CHG_DIG_CTL0      = 0x24
REG_MFB_CTL           = 0x07
REG_TYPE_C_CTL        = 0x08
REG_READ_BAT_VOLT_H   = 0x64
REG_READ_BAT_VOLT_L   = 0x65
REG_READ_VBUS_VOLT_H  = 0x62
REG_READ_VBUS_VOLT_L  = 0x63
REG_READ_BAT_CUR_H    = 0x66
REG_READ_BAT_CUR_L    = 0x67

# ADC scaling
BAT_VOLTAGE_SCALE = 0.00026855   # V per LSB (14-bit ADC)
VBUS_VOLTAGE_SCALE = 0.00026855
BAT_CURRENT_SCALE = 0.000745     # A per LSB (approximate)

# Battery thresholds
BAT_FULL_V     = 4.20
BAT_NOMINAL_V  = 3.70
BAT_LOW_V      = 3.40
BAT_CRITICAL_V = 3.20
BAT_CUTOFF_V   = 3.00


@dataclass
class PowerState:
    """Snapshot of the power system state."""
    battery_voltage: float
    battery_current: float
    battery_percent: int
    vbus_voltage: float
    vbus_present: bool
    charging: bool
    boost_enabled: bool
    level: str                 # "full" | "nominal" | "low" | "critical" | "cutoff"
    raw: dict[str, int]


class IP5328P(Peripheral):
    """
    IP5328P PMIC driver — reads battery state and controls power.

    I2C address: 0x75 on bus 1
    Protection: 470Ω series resistors on SDA/SCL (anti-latch-up)
    Thermal: 10kΩ NTC on IP5328P_NTC pin → hardware throttle at ~120°C
    """

    I2C_ADDR = 0x75

    def __init__(self, bus: I2CBus) -> None:
        super().__init__(name="IP5328P", subsystem="A")
        self._bus = bus

    def probe(self) -> bool:
        try:
            val = self._bus.read_byte(self.I2C_ADDR, REG_SYS_CTL0)
            self._alive = True
            self.log.info("IP5328P probed OK at 0x%02x (SYS_CTL0=0x%02x)",
                          self.I2C_ADDR, val)
            return True
        except BusError as exc:
            self._alive = False
            self.log.error(
                "IP5328P NOT found at 0x%02x: %s\n"
                "  Troubleshooting:\n"
                "    1. modprobe i2c-dev\n"
                "    2. i2cdetect -y 1 (should show 75)\n"
                "    3. Check 470Ω series resistors (R_I2C_SDA, R_I2C_SCL)\n"
                "    4. ADVISORY A-21: probe VCCIO on GPIO0 bank — if 1.8V,\n"
                "       need TXS0102 level shifter\n"
                "    5. Battery completely dead → PMIC not powered",
                self.I2C_ADDR, exc,
            )
            return False

    def init(self) -> None:
        if not self._alive:
            return
        self.log.info("IP5328P init: reading current configuration")
        try:
            ctl0 = self.safe_call(self._bus.read_byte, self.I2C_ADDR, REG_SYS_CTL0)
            self.log.info("  SYS_CTL0 = 0x%02x (boost_en=%d, charger_en=%d)",
                          ctl0, (ctl0 >> 5) & 1, (ctl0 >> 4) & 1)
        except BusError:
            self.log.warning("Could not read IP5328P config")

    def read_state(self) -> PowerState:
        raw: dict[str, int] = {}

        def _read_14bit(reg_h: int, reg_l: int) -> int:
            h = self.safe_call(self._bus.read_byte, self.I2C_ADDR, reg_h)
            l = self.safe_call(self._bus.read_byte, self.I2C_ADDR, reg_l)
            raw[f"0x{reg_h:02x}"] = h
            raw[f"0x{reg_l:02x}"] = l
            return (h << 8) | l

        bat_raw = _read_14bit(REG_READ_BAT_VOLT_H, REG_READ_BAT_VOLT_L)
        bat_v = bat_raw * BAT_VOLTAGE_SCALE

        vbus_raw = _read_14bit(REG_READ_VBUS_VOLT_H, REG_READ_VBUS_VOLT_L)
        vbus_v = vbus_raw * VBUS_VOLTAGE_SCALE

        cur_raw = _read_14bit(REG_READ_BAT_CUR_H, REG_READ_BAT_CUR_L)
        if cur_raw & 0x2000:
            cur_raw -= 0x4000
        bat_a = cur_raw * BAT_CURRENT_SCALE

        ctl0 = self.safe_call(self._bus.read_byte, self.I2C_ADDR, REG_SYS_CTL0)
        raw["SYS_CTL0"] = ctl0

        if bat_v >= BAT_FULL_V:
            level = "full"
        elif bat_v >= BAT_NOMINAL_V:
            level = "nominal"
        elif bat_v >= BAT_LOW_V:
            level = "low"
        elif bat_v >= BAT_CRITICAL_V:
            level = "critical"
        else:
            level = "cutoff"

        pct = _voltage_to_percent(bat_v)

        return PowerState(
            battery_voltage=round(bat_v, 3),
            battery_current=round(bat_a, 3),
            battery_percent=pct,
            vbus_voltage=round(vbus_v, 3),
            vbus_present=vbus_v > 4.0,
            charging=bat_a > 0.05,
            boost_enabled=bool(ctl0 & (1 << 5)),
            level=level,
            raw=raw,
        )

    def status(self) -> dict[str, Any]:
        base = super().status()
        if self.alive:
            try:
                ps = self.read_state()
                base["power"] = {
                    "battery_v": ps.battery_voltage,
                    "battery_pct": ps.battery_percent,
                    "battery_a": ps.battery_current,
                    "vbus_v": ps.vbus_voltage,
                    "charging": ps.charging,
                    "level": ps.level,
                }
            except BusError:
                base["power"] = {"error": "read failed"}
        return base


def _voltage_to_percent(v: float) -> int:
    """Piecewise-linear Li-ion SoC estimate from OCV."""
    if v >= 4.20: return 100
    if v >= 4.06: return 90 + int((v - 4.06) / 0.14 * 10)
    if v >= 3.98: return 80 + int((v - 3.98) / 0.08 * 10)
    if v >= 3.92: return 70 + int((v - 3.92) / 0.06 * 10)
    if v >= 3.87: return 60 + int((v - 3.87) / 0.05 * 10)
    if v >= 3.82: return 50 + int((v - 3.82) / 0.05 * 10)
    if v >= 3.79: return 40 + int((v - 3.79) / 0.03 * 10)
    if v >= 3.77: return 30 + int((v - 3.77) / 0.02 * 10)
    if v >= 3.74: return 20 + int((v - 3.74) / 0.03 * 10)
    if v >= 3.68: return 10 + int((v - 3.68) / 0.06 * 10)
    if v >= 3.45: return int((v - 3.45) / 0.23 * 10)
    return 0
