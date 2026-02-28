"""
Daemon V0 — Configuration
Loads hardware specs from YAML and provides system config.
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

log = logging.getLogger("daemon.config")
PROJECT_ROOT = Path(__file__).parent.parent
SPECS_DIR = PROJECT_ROOT / "specs"


@dataclass
class DaemonConfig:
    i2c_bus: int = 1
    display_spi_bus: int = 3
    display_spi_cs: int = 0
    rf_spi_bus: int = 0
    rf_spi_cs: int = 0
    gpio_chip: str = "/dev/gpiochip3"
    led_gpio_num: int = 18
    thermal_throttle_cpu_pct: int = 60
    thermal_zone_path: str = "/sys/class/thermal/thermal_zone0/temp"
    poll_interval_s: float = 1.0
    power_poll_interval_s: float = 5.0
    watchdog_timeout_s: int = 30
    log_level: str = "INFO"

    @classmethod
    def from_env(cls) -> DaemonConfig:
        cfg = cls()
        cfg.i2c_bus = int(os.environ.get("DAEMON_I2C_BUS", cfg.i2c_bus))
        cfg.rf_spi_bus = int(os.environ.get("DAEMON_RF_SPI_BUS", cfg.rf_spi_bus))
        cfg.log_level = os.environ.get("DAEMON_LOG_LEVEL", cfg.log_level)
        return cfg


def load_spec(name: str) -> dict[str, Any]:
    path = SPECS_DIR / f"{name}.yaml"
    if not path.exists(): return {}
    try:
        import yaml
        with open(path) as f: return yaml.safe_load(f) or {}
    except ImportError: return {}
    except Exception as exc:
        log.error("Failed to load spec %s: %s", path, exc); return {}


def load_all_specs() -> dict[str, Any]:
    specs = {}
    if not SPECS_DIR.exists(): return specs
    for path in sorted(SPECS_DIR.glob("*.yaml")):
        specs[path.stem] = load_spec(path.stem)
    return specs
