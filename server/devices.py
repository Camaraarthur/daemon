#!/usr/bin/env python3
"""
Device Auto-Detection — USB hotplug monitoring.
Watches for USB device plug/unplug events, classifies them,
and notifies the daemon process.
"""

import asyncio
import json
import os
from pathlib import Path
from datetime import datetime, timezone
from typing import Callable, Optional

CONFIG_DIR = Path(__file__).parent.parent / "config"
DEVICES_PATH = CONFIG_DIR / "devices.json"

# USB device class codes
USB_CLASS_MAP = {
    "01": "audio",
    "02": "comms",
    "03": "hid",
    "06": "imaging",
    "07": "printer",
    "08": "storage",
    "0e": "video",
    "e0": "wireless",
    "ff": "vendor_specific",
}

# Known vendor IDs for common device types
KNOWN_VENDORS = {
    "2341": ("Arduino SA", "microcontroller"),
    "2a03": ("Arduino.org", "microcontroller"),
    "303a": ("Espressif", "microcontroller"),
    "10c4": ("Silicon Labs CP2102", "microcontroller"),
    "1a86": ("QinHeng CH340", "microcontroller"),
    "0403": ("FTDI", "serial_adapter"),
    "0d8c": ("C-Media", "audio"),
    "046d": ("Logitech", "hid"),
    "0a12": ("CSR Bluetooth", "bluetooth"),
    "8087": ("Intel Bluetooth", "bluetooth"),
    "1d6b": ("Linux Foundation", "hub"),
}


def load_device_inventory() -> dict:
    """Load known device inventory."""
    if DEVICES_PATH.exists():
        with open(DEVICES_PATH) as f:
            return json.load(f)
    return {"devices": [], "last_updated": None}


def save_device_inventory(inventory: dict):
    """Save device inventory."""
    inventory["last_updated"] = datetime.now(timezone.utc).isoformat()
    with open(DEVICES_PATH, "w") as f:
        json.dump(inventory, f, indent=2)


def classify_device(vid: str, pid: str, interfaces: str = "", usb_class: str = "") -> dict:
    """Classify a USB device by VID:PID and interface classes."""
    vendor_info = KNOWN_VENDORS.get(vid.lower())
    vendor_name = vendor_info[0] if vendor_info else f"Unknown ({vid})"
    device_type = vendor_info[1] if vendor_info else "unknown"

    # Override by interface class if we have it
    if interfaces and device_type == "unknown":
        for cls_code, cls_name in USB_CLASS_MAP.items():
            if f":{cls_code}" in interfaces.lower():
                device_type = cls_name
                break

    return {
        "vid": vid,
        "pid": pid,
        "vendor": vendor_name,
        "type": device_type,
    }


class DeviceMonitor:
    """Monitors USB hotplug events via pyudev."""

    def __init__(self, on_event: Optional[Callable] = None):
        self.on_event = on_event
        self.inventory = load_device_inventory()
        self._running = False

    async def start(self):
        """Start monitoring USB events."""
        try:
            import pyudev
        except ImportError:
            print("[devices] pyudev not installed. USB monitoring disabled.")
            print("[devices] Install with: pip install pyudev")
            return

        self._running = True
        context = pyudev.Context()
        monitor = pyudev.Monitor.from_netlink(context)
        monitor.filter_by(subsystem="usb")

        print("[devices] USB monitor started. Watching for hotplug events...")

        # Run in executor to avoid blocking
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, self._poll_loop, monitor)

    def _poll_loop(self, monitor):
        """Blocking poll loop for udev events."""
        for device in iter(monitor.poll, None):
            if not self._running:
                break

            if device.device_type != "usb_device":
                continue

            vid = device.get("ID_VENDOR_ID", "")
            pid = device.get("ID_MODEL_ID", "")
            model = device.get("ID_MODEL", "Unknown")
            vendor = device.get("ID_VENDOR", "Unknown")
            interfaces = device.get("ID_USB_INTERFACES", "")
            action = device.action

            if not vid:
                continue

            classification = classify_device(vid, pid, interfaces)

            event = {
                "action": action,
                "vid": vid,
                "pid": pid,
                "model": model,
                "vendor": vendor,
                "type": classification["type"],
                "path": device.device_path,
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }

            if action == "add":
                print(f"[devices] PLUGGED: {vendor} {model} ({classification['type']}) VID:PID={vid}:{pid}")
                self._add_to_inventory(event)
            elif action == "remove":
                print(f"[devices] REMOVED: {device.device_path}")
                self._remove_from_inventory(event)

            if self.on_event:
                self.on_event(event)

    def _add_to_inventory(self, event: dict):
        """Add device to inventory."""
        entry = {
            "vid": event["vid"],
            "pid": event["pid"],
            "model": event["model"],
            "vendor": event["vendor"],
            "type": event["type"],
            "first_seen": event["timestamp"],
            "last_seen": event["timestamp"],
        }
        # Update or add
        existing = [d for d in self.inventory["devices"]
                    if d["vid"] == entry["vid"] and d["pid"] == entry["pid"]]
        if existing:
            existing[0]["last_seen"] = entry["last_seen"]
        else:
            self.inventory["devices"].append(entry)
        save_device_inventory(self.inventory)

    def _remove_from_inventory(self, event: dict):
        """Mark device as disconnected (don't remove — keep history)."""
        for d in self.inventory["devices"]:
            if d["vid"] == event["vid"] and d["pid"] == event["pid"]:
                d["last_seen"] = event["timestamp"]
                d["connected"] = False
        save_device_inventory(self.inventory)

    def stop(self):
        """Stop monitoring."""
        self._running = False

    def format_event_for_daemon(self, event: dict) -> str:
        """Format a USB event as a natural language message for the daemon."""
        if event["action"] == "add":
            msg = (
                f"[Hardware Event] A USB device was just plugged in:\n"
                f"  Vendor: {event['vendor']}\n"
                f"  Model: {event['model']}\n"
                f"  Type: {event['type']}\n"
                f"  VID:PID: {event['vid']}:{event['pid']}\n"
            )
            if event["type"] == "audio":
                msg += "  This looks like an audio device (mic or speaker). Want me to configure it?"
            elif event["type"] == "microcontroller":
                msg += "  This looks like a microcontroller (Arduino/ESP32). Want me to connect to it?"
            elif event["type"] == "bluetooth":
                msg += "  This is a Bluetooth adapter. Want me to scan for nearby devices?"
            elif event["type"] == "storage":
                msg += "  This is a storage device. Want me to mount it?"
            return msg
        elif event["action"] == "remove":
            return f"[Hardware Event] USB device disconnected: {event.get('vendor', '')} {event.get('model', '')} ({event['type']})"
        return ""


async def configure_audio_device():
    """Auto-configure a newly plugged audio device as default."""
    try:
        import pulsectl
        with pulsectl.Pulse("daemon-devices") as pulse:
            for source in pulse.source_list():
                if "usb" in source.name.lower():
                    pulse.source_default_set(source.name)
                    print(f"[devices] Set default mic: {source.description}")
                    return source.description
            for sink in pulse.sink_list():
                if "usb" in sink.name.lower():
                    pulse.sink_default_set(sink.name)
                    print(f"[devices] Set default speaker: {sink.description}")
                    return sink.description
    except ImportError:
        print("[devices] pulsectl not installed. Audio auto-config disabled.")
    except Exception as e:
        print(f"[devices] Audio config error: {e}")
    return None


if __name__ == "__main__":
    """Test USB monitoring standalone."""
    def on_event(event):
        print(json.dumps(event, indent=2))

    monitor = DeviceMonitor(on_event=on_event)
    asyncio.run(monitor.start())
