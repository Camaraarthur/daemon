"""
Daemon V0 — HAL Base Classes
Circuit breaker + retry logic for all hardware peripherals.

Every peripheral driver inherits from Peripheral and gets automatic:
  - Exponential backoff with jitter on bus errors
  - Circuit breaker (3 strikes -> open -> adaptive recovery probe)
  - HALF_OPEN: single probe attempt (not full retry loop)
  - Adaptive recovery timeout: 5s -> 10s -> 20s -> 40s -> 60s cap on repeated failures
  - Escalating recovery: re-init -> hard reset -> alert
  - Structured status reporting
  - Init / probe / teardown lifecycle
"""

from __future__ import annotations

import logging
import random
import time
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Callable, TypeVar

log = logging.getLogger("daemon.hal")

T = TypeVar("T")


class CircuitState(Enum):
    CLOSED = "closed"
    OPEN = "open"
    HALF_OPEN = "half_open"


class BusError(Exception):
    """Any bus-level fault: NACK, timeout, CRC, FIFO under/overflow."""


class DeviceNotFound(BusError):
    """Device did not respond to probe."""


class DeviceUnavailable(BusError):
    """Circuit breaker is OPEN."""


@dataclass
class CircuitBreaker:
    """Hardware bus circuit breaker.  I2C NACK ~ HTTP 503.

    Improvements over textbook pattern:
      - HALF_OPEN allows exactly 1 probe (not max_retries)
      - Adaptive recovery timeout doubles on repeated open/half-open cycles
        (5s -> 10s -> 20s -> 40s -> 60s cap), resets on success
    """

    device_name: str
    failure_threshold: int = 3
    recovery_timeout_s: float = 5.0
    max_recovery_timeout_s: float = 60.0
    max_retries: int = 3
    base_backoff_s: float = 0.010
    max_backoff_s: float = 1.0
    jitter: bool = True

    state: CircuitState = field(default=CircuitState.CLOSED, init=False)
    failure_count: int = field(default=0, init=False)
    last_failure_time: float = field(default=0.0, init=False)
    total_successes: int = field(default=0, init=False)
    total_failures: int = field(default=0, init=False)
    _consecutive_opens: int = field(default=0, init=False)

    @property
    def effective_recovery_timeout(self) -> float:
        """Adaptive timeout: doubles on repeated failures, capped at max."""
        if self._consecutive_opens <= 1:
            return self.recovery_timeout_s
        return min(
            self.recovery_timeout_s * (2 ** (self._consecutive_opens - 1)),
            self.max_recovery_timeout_s,
        )

    def execute(self, operation: Callable[..., T], *args: Any, **kwargs: Any) -> T:
        timeout = self.effective_recovery_timeout

        if self.state is CircuitState.OPEN:
            elapsed = time.monotonic() - self.last_failure_time
            if elapsed >= timeout:
                log.info("%s: circuit half-open, probing (timeout was %.0fs)...",
                         self.device_name, timeout)
                self.state = CircuitState.HALF_OPEN
            else:
                raise DeviceUnavailable(
                    f"{self.device_name}: circuit OPEN "
                    f"({timeout - elapsed:.1f}s until probe)"
                )

        # HALF_OPEN: single probe attempt, not full retry loop
        retries = 1 if self.state is CircuitState.HALF_OPEN else self.max_retries

        last_exc: Exception | None = None
        for attempt in range(retries):
            try:
                result = operation(*args, **kwargs)
                self._on_success()
                return result
            except (OSError, BusError) as exc:
                last_exc = exc
                self._on_failure()
                if attempt < retries - 1:
                    backoff = min(
                        self.base_backoff_s * (2 ** attempt),
                        self.max_backoff_s,
                    )
                    if self.jitter:
                        backoff *= 0.5 + random.random()
                    log.warning(
                        "%s: attempt %d/%d failed (%s), retrying in %.0fms...",
                        self.device_name, attempt + 1, retries,
                        exc, backoff * 1000,
                    )
                    time.sleep(backoff)

        raise BusError(
            f"{self.device_name}: exhausted {retries} retries"
        ) from last_exc

    def _on_success(self) -> None:
        if self.state is not CircuitState.CLOSED:
            log.info("%s: circuit CLOSED (device recovered after %d open cycles)",
                     self.device_name, self._consecutive_opens)
        self.failure_count = 0
        self._consecutive_opens = 0
        self.state = CircuitState.CLOSED
        self.total_successes += 1

    def _on_failure(self) -> None:
        self.failure_count += 1
        self.total_failures += 1
        self.last_failure_time = time.monotonic()
        if self.failure_count >= self.failure_threshold:
            self._consecutive_opens += 1
            self.state = CircuitState.OPEN
            log.error(
                "%s: circuit OPEN after %d consecutive failures "
                "(recovery in %.0fs, open cycle #%d)",
                self.device_name, self.failure_count,
                self.effective_recovery_timeout, self._consecutive_opens,
            )

    @property
    def healthy(self) -> bool:
        return self.state is CircuitState.CLOSED


class Peripheral(ABC):
    """
    Base class for every hardware peripheral on the Daemon V0 board.

    Lifecycle: __init__ -> probe() -> init() -> read/write -> teardown()

    Escalating recovery (called by agent loop when circuit breaker is OPEN):
      Level 1: re-init (re-run init() sequence)
      Level 2: hard reset (subclass implements _hard_reset())
      Level 3: alert (device declared unrecoverable)
    """

    def __init__(self, name: str, subsystem: str):
        self.name = name
        self.subsystem = subsystem
        self._breaker = CircuitBreaker(device_name=f"{subsystem}:{name}")
        self._alive = False
        self._recovery_level = 0
        self.log = logging.getLogger(f"daemon.hal.{name}")

    @abstractmethod
    def probe(self) -> bool:
        """Return True if the device responds with the expected identity."""

    @abstractmethod
    def init(self) -> None:
        """Push configuration to hardware."""

    def teardown(self) -> None:
        """Release file descriptors, unexport GPIO lines, etc."""

    @property
    def alive(self) -> bool:
        return self._alive and self._breaker.healthy

    def status(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "subsystem": self.subsystem,
            "alive": self.alive,
            "circuit": self._breaker.state.value,
            "recovery_level": self._recovery_level,
            "successes": self._breaker.total_successes,
            "failures": self._breaker.total_failures,
        }

    def safe_call(self, fn: Callable[..., T], *args: Any, **kwargs: Any) -> T:
        return self._breaker.execute(fn, *args, **kwargs)

    def attempt_recovery(self) -> bool:
        """Escalating recovery: re-init -> hard reset -> alert.

        Called by the agent loop when the circuit breaker is OPEN.
        Returns True if device recovered.
        """
        self._recovery_level += 1

        if self._recovery_level == 1:
            self.log.warning("Recovery level 1: re-init %s", self.name)
            try:
                self.init()
                if self.probe():
                    self._recovery_level = 0
                    return True
            except Exception as exc:
                self.log.warning("Re-init failed: %s", exc)

        elif self._recovery_level == 2:
            self.log.warning("Recovery level 2: hard reset %s", self.name)
            try:
                self._hard_reset()
                if self.probe():
                    self._recovery_level = 0
                    return True
            except Exception as exc:
                self.log.warning("Hard reset failed: %s", exc)

        elif self._recovery_level >= 3:
            self.log.critical(
                "Recovery level 3: %s unrecoverable after re-init + hard reset",
                self.name,
            )

        return False

    def _hard_reset(self) -> None:
        """Override in subclasses with hardware reset capability.

        Examples: CC1101 SRES strobe, ST7789 RST pin toggle,
        Stinger SY6280 power cycle.
        """
        pass
