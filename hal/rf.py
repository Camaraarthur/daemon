"""
Daemon V0 — CC1101 Sub-GHz RF Transceiver Driver
Subsystem H — 915 MHz ISM band via spi-gpio kernel driver

ECO #2026-03-G: MUST use spi-gpio, NOT userspace bitbang (>10us jitter).
Pins (ECO #2026-03-F): SCK=16, MOSI=13, MISO=15, CS=18
Power: 3V3_CLEAN (AP2112K LDO)
Antenna: Johanson 0915AT43A0026 chip + Pi-network match
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass
from typing import Any

from hal.base import BusError, Peripheral

log = logging.getLogger("daemon.hal.rf")

_READ = 0x80
_WRITE = 0x00
_BURST = 0x40

# Command Strobes
SRES = 0x30; SRX = 0x34; STX = 0x35; SIDLE = 0x36
SFRX = 0x3A; SFTX = 0x3B; SPWD = 0x39; SCAL = 0x33; SNOP = 0x3D

# Key registers
IOCFG2 = 0x00; IOCFG0 = 0x02; FIFOTHR = 0x03
PKTCTRL0 = 0x08; FSCTRL1 = 0x0B
FREQ2 = 0x0D; FREQ1 = 0x0E; FREQ0 = 0x0F
MDMCFG4 = 0x10; MDMCFG3 = 0x11; MDMCFG2 = 0x12; MDMCFG1 = 0x13
DEVIATN = 0x15; MCSM0 = 0x18; FOCCFG = 0x19; BSCFG = 0x1A
AGCCTRL2 = 0x1B; AGCCTRL1 = 0x1C; AGCCTRL0 = 0x1D
FREND1 = 0x21; FREND0 = 0x22
FSCAL3 = 0x23; FSCAL2 = 0x24; FSCAL1 = 0x25; FSCAL0 = 0x26
TEST2 = 0x2C; TEST1 = 0x2D; TEST0 = 0x2E

# Status registers
PARTNUM = 0x30; VERSION = 0x31; RSSI = 0x34; MARCSTATE = 0x35
TXBYTES = 0x3A; RXBYTES = 0x3B; FIFO = 0x3F; PATABLE = 0x3E

MARC_STATES = {
    0x00: "SLEEP", 0x01: "IDLE", 0x0D: "RX", 0x13: "TX",
    0x11: "RXFIFO_OVERFLOW", 0x16: "TXFIFO_UNDERFLOW",
}

# SmartRF Studio: 915 MHz, 250 kbps, 2-GFSK
PRESET_915_250K = {
    IOCFG2: 0x29, IOCFG0: 0x06, FIFOTHR: 0x47, PKTCTRL0: 0x05,
    FSCTRL1: 0x0C, FREQ2: 0x23, FREQ1: 0x31, FREQ0: 0x3B,
    MDMCFG4: 0x2D, MDMCFG3: 0x3B, MDMCFG2: 0x13, MDMCFG1: 0x22,
    DEVIATN: 0x62, MCSM0: 0x18, FOCCFG: 0x1D, BSCFG: 0x1C,
    AGCCTRL2: 0xC7, AGCCTRL1: 0x00, AGCCTRL0: 0xB0,
    FREND1: 0xB6, FREND0: 0x10,
    FSCAL3: 0xEA, FSCAL2: 0x2A, FSCAL1: 0x00, FSCAL0: 0x1F,
    TEST2: 0x88, TEST1: 0x31, TEST0: 0x09,
}

PATABLE_10DBM = [0xC0, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]


@dataclass
class RxPacket:
    data: bytes
    rssi_dbm: float
    lqi: int
    crc_ok: bool


class CC1101(Peripheral):
    EXPECTED_PARTNUM = 0x00
    EXPECTED_VERSION = 0x14

    def __init__(self, spi_bus: int = 0, spi_cs: int = 0) -> None:
        super().__init__(name="CC1101", subsystem="H")
        self._spi_bus = spi_bus
        self._spi_cs = spi_cs
        self._spi = None

    def probe(self) -> bool:
        try:
            import spidev
            self._spi = spidev.SpiDev()
            self._spi.open(self._spi_bus, self._spi_cs)
            self._spi.max_speed_hz = 1_000_000
            self._spi.mode = 0
        except FileNotFoundError:
            self.log.error("SPI /dev/spidev%d.%d not found — load spi-gpio overlay",
                           self._spi_bus, self._spi_cs)
            return False
        except ImportError:
            self.log.error("spidev not installed: pip install spidev")
            return False

        self._strobe(SRES)
        time.sleep(0.005)

        partnum = self._read_status(PARTNUM)
        version = self._read_status(VERSION)

        if partnum == self.EXPECTED_PARTNUM and version == self.EXPECTED_VERSION:
            self._alive = True
            self.log.info("CC1101 probed: PARTNUM=0x%02x VERSION=0x%02x", partnum, version)
            return True
        self._alive = False
        self.log.error("CC1101 identity mismatch: 0x%02x/0x%02x (expect 0x00/0x14)",
                       partnum, version)
        return False

    def init(self, preset: dict[int, int] | None = None) -> None:
        if not self._alive:
            return
        cfg = preset or PRESET_915_250K
        for reg, val in cfg.items():
            self.safe_call(self._write_reg, reg, val)
        self.safe_call(self._write_patable, PATABLE_10DBM)
        self._strobe(SCAL)
        time.sleep(0.001)
        self.log.info("CC1101 configured: 915 MHz, 250 kbps, 2-GFSK, +10 dBm")

    def get_marc_state(self) -> str:
        val = self.safe_call(self._read_status, MARCSTATE) & 0x1F
        return MARC_STATES.get(val, f"0x{val:02x}")

    def get_rssi_dbm(self) -> float:
        raw = self.safe_call(self._read_status, RSSI)
        rssi_dec = raw - 256 if raw >= 128 else raw
        return (rssi_dec / 2.0) - 74.0

    def enter_rx(self) -> None:
        self._strobe(SIDLE); time.sleep(0.001)
        self._strobe(SFRX); self._strobe(SRX)

    def enter_idle(self) -> None:
        self._strobe(SIDLE)

    def transmit(self, data: bytes) -> bool:
        if len(data) > 61:
            return False
        self.enter_idle()
        self._strobe(SFTX)
        self._write_fifo(bytes([len(data)]) + data)
        self._strobe(STX)
        for _ in range(100):
            state = self.get_marc_state()
            if state == "IDLE":
                return True
            if state == "TXFIFO_UNDERFLOW":
                self._strobe(SFTX)
                return False
            time.sleep(0.001)
        self.enter_idle()
        return False

    def receive(self, timeout_s: float = 1.0) -> RxPacket | None:
        self.enter_rx()
        deadline = time.monotonic() + timeout_s
        while time.monotonic() < deadline:
            rxbytes = self._read_status(RXBYTES)
            if rxbytes & 0x80:
                self._strobe(SFRX); self.enter_rx(); continue
            if (rxbytes & 0x7F) > 0:
                length = self._read_fifo(1)[0]
                if length > 64:
                    self._strobe(SFRX); continue
                raw = self._read_fifo(length + 2)
                rssi_raw = raw[length]
                rssi_dec = rssi_raw - 256 if rssi_raw >= 128 else rssi_raw
                return RxPacket(
                    data=bytes(raw[:length]),
                    rssi_dbm=(rssi_dec / 2.0) - 74.0,
                    lqi=raw[length + 1] & 0x7F,
                    crc_ok=bool(raw[length + 1] & 0x80),
                )
            time.sleep(0.005)
        return None

    def status(self) -> dict[str, Any]:
        base = super().status()
        if self.alive:
            try:
                base["marc_state"] = self.get_marc_state()
                base["rssi_dbm"] = self.get_rssi_dbm()
            except BusError:
                pass
        return base

    def _hard_reset(self) -> None:
        """CC1101 hard reset via SRES strobe — clears all registers to defaults."""
        if self._spi:
            try:
                self._strobe(SRES)
                import time
                time.sleep(0.005)
                self.log.info("CC1101 SRES issued (hard reset)")
            except Exception as exc:
                self.log.warning("CC1101 SRES failed: %s", exc)

    def teardown(self) -> None:
        if self._spi:
            try:
                self._strobe(SIDLE); self._strobe(SPWD)
            except Exception:
                pass
            self._spi.close()
            self._spi = None

    def _strobe(self, addr: int) -> int:
        return self._spi.xfer2([addr])[0]

    def _read_reg(self, addr: int) -> int:
        return self._spi.xfer2([_READ | addr, 0x00])[1]

    def _write_reg(self, addr: int, value: int) -> None:
        self._spi.xfer2([_WRITE | addr, value])

    def _read_status(self, addr: int) -> int:
        return self._spi.xfer2([_READ | _BURST | addr, 0x00])[1]

    def _write_patable(self, table: list[int]) -> None:
        self._spi.xfer2([_WRITE | _BURST | PATABLE] + table)

    def _write_fifo(self, data: bytes) -> None:
        self._spi.xfer2([_WRITE | _BURST | FIFO] + list(data))

    def _read_fifo(self, count: int) -> list[int]:
        return self._spi.xfer2([_READ | _BURST | FIFO] + [0x00] * count)[1:]
