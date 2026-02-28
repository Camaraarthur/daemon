"""
Daemon V0 — HAL Base Classes
Circuit breaker + retry logic for all hardware peripherals.

Every peripheral driver inherits from Peripheral and gets automatic:
  - Exponential backoff with jitter on bus errors
  - Circuit breaker (3 strikes -> open -> 5s recovery probe)
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
    """Hardware bus circuit breaker.  I2C NACK ~ HTTP 503."""

    device_name: str
    failure_threshold: int = 3
    recovery_timeout_s: float = 5.0
    max_retries: int = 3
    base_backoff_s: float = 0.010
    max_backoff_s: float = 1.0
    jitter: bool = True

    state: CircuitState = field(default=CircuitState.CLOSED, init=False)
    failure_count: int = field(default=0, init=False)
    last_failure_time: float = field(default=0.0, init=False)
    total_successes: int = field(default=0, init=False)
    total_failures: int = field(default=0, init=False)

    def execute(self, operation: Callable[..., T], *args: Any, **kwargs: Any) -> T:
        if self.state is CircuitState.OPEN:
            elapsed = time.monotonic() - self.last_failure_time
            if elapsed >= self.recovery_timeout_s:
                log.info("%s: circuit half-open, probing...", self.device_name)
                self.state = CircuitState.HALF_OPEN
            else:
                raise DeviceUnavailable(
                    f"{self.device_name}: circuit OPEN "
                    f"({self.recovery_timeout_s - elapsed:.1f}s until probe)"
                )

        last_exc: Exception | None = None
        for attempt in range(self.max_retries):
            try:
                result = operation(*args, **kwargs)
                self._on_success()
                return result
            except (OSError, BusError) as exc:
                last_exc = exc
                self._on_failure()
                if attempt < self.max_retries - 1:
                    backoff = min(
                        self.base_backoff_s * (2 ** attempt),
                        self.max_backoff_s,
                    )
                    if self.jitter:
                        backoff *= 0.5 + random.random()
                    log.warning(
                        "%s: attempt %d/%d failed (%s), retrying in %.0fms...",
                        self.device_name, attempt + 1, self.max_retries,
                        exc, backoff * 1000,
                    )
                    time.sleep(backoff)

        raise BusError(
            f"{self.device_name}: exhausted {self.max_retries} retries"
        ) from last_exc

    def _on_success(self) -> None:
        if self.state is not CircuitState.CLOSED:
            log.info("%s: circuit CLOSED (device recovered)", self.device_name)
        self.failure_count = 0
        self.state = CircuitState.CLOSED
        self.total_successes += 1

    def _on_failure(self) -> None:
        self.failure_count += 1
        self.total_failures += 1
        self.last_failure_time = time.monotonic()
        if self.failure_count >= self.failure_threshold:
            self.state = CircuitState.OPEN
            log.error(
                "%s: circuit OPEN after %d consecutive failures",
                self.device_name, self.failure_count,
            )

    @property
    def healthy(self) -> bool:
        return self.state is CircuitState.CLOSED


class Peripheral(ABC):
    """
    Base class for every hardware peripheral on the Daemon V0 board.

    Lifecycle: __init__ -> probe() -> init() -> read/write -> teardown()
    """

    def __init__(self, name: str, subsystem: str):
        self.name = name
        self.subsystem = subsystem
        self._breaker = CircuitBreaker(device_name=f"{subsystem}:{name}")
        self._alive = False
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
            "successes": self._breaker.total_successes,
            "failures": self._breaker.total_failures,
        }

    def safe_call(self, fn: Callable[..., T], *args: Any, **kwargs: Any) -> T:
        return self._breaker.execute(fn, *args, **kwargs)
