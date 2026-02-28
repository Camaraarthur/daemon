"""
Daemon V0 — Hardware Bus Scanner
Autonomous discovery of all hardware on boot.

Probe cascade:
  1. GPIO chips
  2. I2C1 → ADS1015 (0x48), IP5328P (0x75)
  3. SPI devices
  4. USB (SL2.1A hub, Stinger attachments)
  5. ALSA audio
  6. Thermal zones
  7. Kernel modules
"""

from __future__ import annotations

import logging
import subprocess
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

log = logging.getLogger("daemon.scanner")

EXPECTED_I2C = {0x48: "ADS1015 (joystick ADC)", 0x75: "IP5328P (PMIC telemetry)"}


@dataclass
class ScanResult:
    gpio_chips: list[dict[str, Any]] = field(default_factory=list)
    i2c_devices: dict[int, str] = field(default_factory=dict)
    i2c_missing: dict[int, str] = field(default_factory=dict)
    spi_devices: list[str] = field(default_factory=list)
    usb_devices: list[str] = field(default_factory=list)
    network_interfaces: list[str] = field(default_factory=list)
    alsa_cards: list[str] = field(default_factory=list)
    thermal_zones: dict[str, float] = field(default_factory=dict)
    kernel_modules: dict[str, bool] = field(default_factory=dict)
    warnings: list[str] = field(default_factory=list)


def scan_hardware() -> ScanResult:
    result = ScanResult()
    log.info("=== Daemon V0 Hardware Scan ===")

    # GPIO chips
    for p in sorted(Path("/dev").glob("gpiochip*")):
        result.gpio_chips.append({"path": str(p)})
    if not result.gpio_chips:
        result.warnings.append("No GPIO chips found")

    # I2C scan
    dev = Path("/dev/i2c-1")
    if dev.exists():
        try:
            import smbus2
            with smbus2.SMBus(1) as b:
                for addr in range(0x03, 0x78):
                    try:
                        b.read_byte(addr)
                        result.i2c_devices[addr] = EXPECTED_I2C.get(addr, "unknown")
                    except OSError:
                        pass
        except ImportError:
            try:
                out = subprocess.check_output(["i2cdetect", "-y", "1"],
                                              timeout=10, text=True)
                for line in out.strip().split("\n")[1:]:
                    for part in line.split()[1:]:
                        if part not in ("--", "UU"):
                            try:
                                addr = int(part, 16)
                                result.i2c_devices[addr] = EXPECTED_I2C.get(addr, "unknown")
                            except ValueError:
                                pass
            except Exception:
                pass
    else:
        result.warnings.append("/dev/i2c-1 not found — modprobe i2c-dev")

    for addr, name in EXPECTED_I2C.items():
        if addr not in result.i2c_devices:
            result.i2c_missing[addr] = name
            result.warnings.append(f"Expected {name} at 0x{addr:02x} not found")

    # SPI
    result.spi_devices = [str(p) for p in sorted(Path("/dev").glob("spidev*"))]
    if not result.spi_devices:
        result.warnings.append("No SPI devices — overlays may not be loaded")

    # USB
    try:
        out = subprocess.check_output(["lsusb"], timeout=5, text=True)
        result.usb_devices = [l.strip() for l in out.strip().split("\n") if l.strip()]
    except Exception:
        pass

    # Network
    try:
        out = subprocess.check_output(["ip", "-o", "link", "show"], timeout=5, text=True)
        for line in out.strip().split("\n"):
            parts = line.split(": ")
            if len(parts) >= 2:
                iface = parts[1].split("@")[0]
                if iface != "lo":
                    result.network_interfaces.append(iface)
    except Exception:
        pass

    # ALSA
    try:
        out = subprocess.check_output(["aplay", "-l"], timeout=5, text=True,
                                      stderr=subprocess.DEVNULL)
        for line in out.strip().split("\n"):
            if line.startswith("card"):
                result.alsa_cards.append(line.strip())
    except Exception:
        pass

    # Thermal
    thermal_dir = Path("/sys/class/thermal")
    for zone in sorted(thermal_dir.glob("thermal_zone*")) if thermal_dir.exists() else []:
        try:
            temp = int((zone / "temp").read_text().strip()) / 1000.0
            ztype = (zone / "type").read_text().strip() if (zone / "type").exists() else "?"
            result.thermal_zones[f"{zone.name}:{ztype}"] = temp
        except Exception:
            pass

    # Kernel modules
    loaded = set()
    try:
        with open("/proc/modules") as f:
            for line in f:
                loaded.add(line.split()[0].replace("-", "_"))
    except Exception:
        pass
    for mod in ["i2c_dev", "spi_dev", "spi_gpio", "spi_bitbang", "rtl8152"]:
        is_loaded = mod.replace("-", "_") in loaded
        result.kernel_modules[mod] = is_loaded
        if not is_loaded:
            result.warnings.append(f"Module {mod} not loaded")

    log.info("=== Scan complete: %d warnings ===", len(result.warnings))
    return result
