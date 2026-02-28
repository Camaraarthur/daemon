"""
Daemon V0 — Agent Loop
The core autonomous loop that monitors hardware, reacts to events,
diagnoses faults, and takes corrective action.

Design principles (from the user's requirements):
  1. DEEPLY AWARE of hardware — every subsystem has a driver + spec file
  2. TRY SOMETHING, TRY AGAIN — circuit breaker + exponential backoff
  3. PROACTIVE RESEARCH — uses Ethernet to search for solutions online
  4. PRE-INSTALLED TOOLS — knows what's on the SD card and what can be apt-get'd
  5. EXACT JARGON — error messages use community terminology
  6. THERMAL AWARE — respects the 60% CPU budget in pocket environment

The agent runs an observe → orient → decide → act (OODA) loop:
  OBSERVE:  Read all sensors (power, temp, I2C scan, USB, network, GPIO)
  ORIENT:   Compare against specs, detect anomalies
  DECIDE:   Pick the highest-priority action (fix fault, respond to input, idle)
  ACT:      Execute the action (toggle GPIO, send RF, power-cycle port, etc.)
"""

from __future__ import annotations

import logging
import signal
import time
from dataclasses import dataclass, field
from enum import Enum, auto
from typing import Any

log = logging.getLogger("daemon.agent")


class Priority(Enum):
    """Event priority levels — higher number = more urgent."""
    IDLE = 0
    INFO = 10
    INPUT = 20        # Joystick, button press
    NETWORK = 30      # Link up/down, IP change
    THERMAL = 40      # CPU temperature warning
    POWER_LOW = 50    # Battery below 20%
    OVERCURRENT = 60  # Stinger port OC flag
    POWER_CRIT = 70   # Battery below 10%
    FAULT = 80        # Hardware fault (device disappeared, bus error)
    SHUTDOWN = 90     # Graceful shutdown requested


@dataclass
class Event:
    """A hardware event to process."""
    priority: Priority
    source: str          # Subsystem name (e.g. "IP5328P", "Stinger:2")
    message: str
    data: dict[str, Any] = field(default_factory=dict)
    timestamp: float = field(default_factory=time.monotonic)


class AgentLoop:
    """
    The main daemon agent loop.

    Orchestrates all HAL drivers and runs the OODA perception-action cycle.
    """

    def __init__(self) -> None:
        from daemon_core.config import DaemonConfig, load_all_specs

        self.config = DaemonConfig.from_env()
        self.specs = load_all_specs()
        self._running = False
        self._events: list[Event] = []

        # HAL instances (initialized in setup())
        self._i2c_bus = None
        self._gpio = None
        self._pmic = None
        self._joystick = None
        self._display = None
        self._rf = None
        self._leds = None
        self._audio = None
        self._stinger = None
        self._ethernet = None
        self._ir = None

        # Timing
        self._last_power_poll = 0.0
        self._last_thermal_check = 0.0
        self._tick_count = 0

        # State
        self._power_state = None
        self._cpu_temp = None

    def setup(self) -> None:
        """
        Initialize all hardware subsystems.
        Probe cascade: power → buses → peripherals → network → UI.
        """
        log.info("╔══════════════════════════════════════════╗")
        log.info("║   Daemon V0 — Hardware Agent Starting    ║")
        log.info("║   ECO #2026-03-GOLD                      ║")
        log.info("╚══════════════════════════════════════════╝")

        # Load specs for agent context
        log.info("Loaded %d hardware spec files", len(self.specs))

        # Phase 1: Bus infrastructure
        log.info("─── Phase 1: Bus Infrastructure ───")
        from hal.i2c import I2CBus
        from hal.gpio import GpioManager

        self._i2c_bus = I2CBus(bus_id=self.config.i2c_bus)
        self._gpio = GpioManager()

        # Discover GPIO chips
        chips = self._gpio.discover_chips()
        log.info("Found %d GPIO chips", len(chips))

        # Phase 2: Power system (highest priority — need to know battery state)
        log.info("─── Phase 2: Power System ───")
        from hal.power import IP5328P

        self._pmic = IP5328P(bus=self._i2c_bus)
        if self._pmic.probe():
            self._pmic.init()
            try:
                self._power_state = self._pmic.read_state()
                log.info("Battery: %.2fV (%d%%) %s",
                         self._power_state.battery_voltage,
                         self._power_state.battery_percent,
                         self._power_state.level)
            except Exception as exc:
                log.warning("Initial power read failed: %s", exc)

        # Phase 3: Bus scan (discover all I2C devices)
        log.info("─── Phase 3: Bus Scan ───")
        from daemon_core.scanner import scan_hardware
        scan = scan_hardware()
        for w in scan.warnings:
            self._events.append(Event(
                priority=Priority.INFO, source="scanner", message=w,
            ))

        # Phase 4: Peripherals
        log.info("─── Phase 4: Peripherals ───")

        from hal.joystick import ADS1015Joystick
        self._joystick = ADS1015Joystick(bus=self._i2c_bus, gpio=self._gpio)
        if self._joystick.probe():
            self._joystick.init()

        from hal.stinger import StingerManager
        self._stinger = StingerManager(gpio=self._gpio)
        self._stinger.probe()
        self._stinger.init()

        from hal.leds import WS2812B
        self._leds = WS2812B(gpio_pin=self.config.led_gpio_num)
        if self._leds.probe():
            self._leds.init()

        from hal.audio import AudioSubsystem
        self._audio = AudioSubsystem()
        self._audio.probe()

        from hal.ir import IRBlaster
        self._ir = IRBlaster()
        self._ir.probe()

        # Phase 5: RF (CC1101 on spi-gpio)
        log.info("─── Phase 5: RF Subsystem ───")
        from hal.rf import CC1101
        self._rf = CC1101(spi_bus=self.config.rf_spi_bus,
                          spi_cs=self.config.rf_spi_cs)
        if self._rf.probe():
            self._rf.init()

        # Phase 6: Display (ST7789V2 on SPI3)
        log.info("─── Phase 6: Display ───")
        from hal.display import ST7789
        self._display = ST7789(gpio=self._gpio,
                               spi_bus=self.config.display_spi_bus,
                               spi_cs=self.config.display_spi_cs)
        if self._display.probe():
            self._display.init()

        # Phase 7: Network
        log.info("─── Phase 7: Network ───")
        from hal.ethernet import EthernetManager
        self._ethernet = EthernetManager()
        if self._ethernet.probe():
            self._ethernet.init()
            if self._ethernet.has_internet():
                log.info("Internet connectivity confirmed")
            else:
                log.warning("Ethernet link up but no internet — check cable/DHCP")

        # Show boot status on LEDs
        if self._leds:
            from hal.leds import STATUS_READY, STATUS_WARNING
            color = STATUS_READY if not scan.warnings else STATUS_WARNING
            self._leds.set_status(color)

        log.info("═══ Hardware agent setup complete ═══")

    def run(self) -> None:
        """
        Main agent loop.  Runs until SIGTERM/SIGINT.

        Each tick:
          1. Read sensors (power, thermal, GPIO inputs)
          2. Check for events (overcurrent, button press, etc.)
          3. Process events by priority
          4. Update display / LEDs
          5. Sleep until next tick
        """
        self._running = True
        signal.signal(signal.SIGTERM, self._handle_signal)
        signal.signal(signal.SIGINT, self._handle_signal)

        log.info("Agent loop started (poll_interval=%.1fs)", self.config.poll_interval_s)

        while self._running:
            tick_start = time.monotonic()
            self._tick_count += 1

            try:
                self._observe()
                self._orient()
                self._decide_and_act()
            except Exception as exc:
                log.error("Agent tick %d failed: %s", self._tick_count, exc,
                          exc_info=True)

            # Sleep for remainder of poll interval
            elapsed = time.monotonic() - tick_start
            sleep_time = max(0, self.config.poll_interval_s - elapsed)
            if sleep_time > 0:
                time.sleep(sleep_time)

        self._shutdown()

    def _observe(self) -> None:
        """Read all sensors and build perception snapshot."""
        now = time.monotonic()

        # Power state (every 5 seconds to avoid I2C bus load)
        if self._pmic and self._pmic.alive:
            if now - self._last_power_poll >= self.config.power_poll_interval_s:
                try:
                    self._power_state = self._pmic.read_state()
                    self._last_power_poll = now
                except Exception:
                    pass

        # Thermal (every 5 seconds)
        if now - self._last_thermal_check >= 5.0:
            self._cpu_temp = self._read_cpu_temp()
            self._last_thermal_check = now

        # Stinger overcurrent check (every tick)
        if self._stinger and self._stinger.alive:
            flags = self._gpio.read_stinger_flags()
            for port, oc in flags.items():
                if oc:
                    self._events.append(Event(
                        priority=Priority.OVERCURRENT,
                        source=f"Stinger:{port}",
                        message=f"Stinger port {port} overcurrent (FLAG asserted)",
                        data={"port": port},
                    ))

        # Joystick button (every tick)
        if self._joystick and self._joystick.alive:
            try:
                joy = self._joystick.read()
                if joy.button:
                    self._events.append(Event(
                        priority=Priority.INPUT,
                        source="JOY_SW",
                        message="Joystick button pressed",
                    ))
            except Exception:
                pass

    def _orient(self) -> None:
        """Analyze observations and generate events for anomalies."""
        # Power level events
        if self._power_state:
            ps = self._power_state
            if ps.level == "critical":
                self._events.append(Event(
                    priority=Priority.POWER_CRIT,
                    source="IP5328P",
                    message=f"CRITICAL: Battery at {ps.battery_voltage:.2f}V "
                            f"({ps.battery_percent}%) — initiate graceful shutdown",
                ))
            elif ps.level == "low":
                self._events.append(Event(
                    priority=Priority.POWER_LOW,
                    source="IP5328P",
                    message=f"Low battery: {ps.battery_voltage:.2f}V ({ps.battery_percent}%)",
                ))

        # Thermal events
        if self._cpu_temp is not None:
            if self._cpu_temp >= 85.0:
                self._events.append(Event(
                    priority=Priority.THERMAL,
                    source="RK3566",
                    message=f"CPU thermal critical: {self._cpu_temp:.1f}°C — "
                            f"DVFS throttling active (pocket environment limit: "
                            f"{self.config.thermal_throttle_cpu_pct}% sustained)",
                ))
            elif self._cpu_temp >= 75.0:
                self._events.append(Event(
                    priority=Priority.THERMAL,
                    source="RK3566",
                    message=f"CPU thermal warning: {self._cpu_temp:.1f}°C",
                ))

    def _decide_and_act(self) -> None:
        """Process events by priority, highest first."""
        if not self._events:
            return

        # Sort by priority (highest first)
        self._events.sort(key=lambda e: e.priority.value, reverse=True)

        for event in self._events:
            self._handle_event(event)

        self._events.clear()

    def _handle_event(self, event: Event) -> None:
        """Handle a single event."""
        log.info("[%s] %s: %s", event.priority.name, event.source, event.message)

        if event.priority == Priority.OVERCURRENT:
            port = event.data.get("port")
            if port and self._stinger:
                log.warning("Auto-disabling Stinger port %d due to overcurrent", port)
                self._stinger.disable_port(port)
                # Set LED to red
                if self._leds:
                    from hal.leds import STATUS_ERROR
                    self._leds.set_pixel(port - 1, *STATUS_ERROR)
                    self._leds.show()

        elif event.priority == Priority.POWER_CRIT:
            log.critical("CRITICAL BATTERY — preparing graceful shutdown")
            if self._leds:
                from hal.leds import STATUS_ERROR
                self._leds.set_status(STATUS_ERROR)
            # In a production system, this would trigger PMIC_KILL
            # via the 2N7002 NMOS gate after saving state

        elif event.priority == Priority.THERMAL:
            # Reduce activity to let the RK3566 cool down
            if self._display:
                self._display.set_backlight(0)  # Turn off backlight to reduce heat
            if self._leds:
                from hal.leds import STATUS_WARNING
                self._leds.set_status(STATUS_WARNING)

    def get_full_status(self) -> dict[str, Any]:
        """
        Build complete system status for agent inspection.
        This is what an LLM agent would consume to understand the hardware state.
        """
        status: dict[str, Any] = {
            "tick": self._tick_count,
            "cpu_temp_c": self._cpu_temp,
            "subsystems": {},
        }

        for name, driver in [
            ("power", self._pmic),
            ("joystick", self._joystick),
            ("rf", self._rf),
            ("display", self._display),
            ("leds", self._leds),
            ("stinger", self._stinger),
            ("audio", self._audio),
            ("ethernet", self._ethernet),
            ("ir", self._ir),
        ]:
            if driver:
                try:
                    status["subsystems"][name] = driver.status()
                except Exception as exc:
                    status["subsystems"][name] = {"error": str(exc)}

        return status

    def _read_cpu_temp(self) -> float | None:
        """Read RK3566 CPU temperature from sysfs."""
        try:
            raw = open(self.config.thermal_zone_path).read().strip()
            return int(raw) / 1000.0
        except Exception:
            return None

    def _handle_signal(self, signum: int, frame: Any) -> None:
        log.info("Received signal %d — initiating shutdown", signum)
        self._running = False

    def _shutdown(self) -> None:
        """Graceful shutdown — release all hardware resources."""
        log.info("Shutting down agent…")

        # LEDs off
        if self._leds:
            self._leds.teardown()

        # Display off
        if self._display:
            self._display.teardown()

        # RF to power-down
        if self._rf:
            self._rf.teardown()

        # GPIO release
        if self._gpio:
            self._gpio.teardown()

        # I2C close
        if self._i2c_bus:
            self._i2c_bus.close()

        log.info("Agent shutdown complete")
