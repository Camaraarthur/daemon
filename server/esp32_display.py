#!/usr/bin/env python3
"""
ESP32 Display Controller — Reliable, reusable.

Connects to the ESP32 display over WiFi (preferred) or serial (fallback).
Can send commands, display images, and stream frames.

Usage:
    display = DaemonDisplay()
    display.fill(255, 0, 0)                    # red screen
    display.show_image("logo.png")             # display PNG
    display.stream_frame(rgb565_bytes)          # raw frame
    display.text("Hello", 10, 10)              # draw text (if firmware supports)
    display.command("tft.fill(st7789.GREEN)")  # raw MicroPython
"""

import socket
import os
from pathlib import Path

DISPLAY_WIDTH = 240
DISPLAY_HEIGHT = 280
FRAME_SIZE = DISPLAY_WIDTH * DISPLAY_HEIGHT * 2  # RGB565

# ESP32 connection config
ESP32_WIFI_IP = "192.168.1.191"  # Update when WiFi works
ESP32_CMD_PORT = 8266
ESP32_FRAME_PORT = 8267


class DaemonDisplay:
    def __init__(self, host=None, serial_host="msi"):
        """Connect to ESP32 display. Tries WiFi first, falls back to serial via SSH."""
        self.host = host or ESP32_WIFI_IP
        self.serial_host = serial_host
        self.mode = None
        self._detect_connection()

    def _detect_connection(self):
        """Try WiFi, fall back to serial."""
        try:
            s = socket.socket()
            s.settimeout(3)
            s.connect((self.host, ESP32_CMD_PORT))
            s.send(b"1+1")
            r = s.recv(64)
            s.close()
            if b"2" in r:
                self.mode = "wifi"
                print(f"[display] Connected via WiFi ({self.host})")
                return
        except:
            pass

        # Try serial via SSH to MSI
        import subprocess
        try:
            r = subprocess.run(
                ["ssh", self.serial_host, "python", "C:\\Users\\tutuc\\esp_cmd_v2.py", "print('OK')"],
                capture_output=True, text=True, timeout=15,
            )
            if "OK" in (r.stdout + open_remote("esp_out.txt")):
                self.mode = "serial"
                print(f"[display] Connected via serial ({self.serial_host})")
                return
        except:
            pass

        self.mode = None
        print("[display] No connection to ESP32")

    def command(self, cmd, timeout=10):
        """Send a MicroPython command to the ESP32."""
        if self.mode == "wifi":
            return self._wifi_cmd(cmd, timeout)
        elif self.mode == "serial":
            return self._serial_cmd(cmd)
        return "Not connected"

    def _wifi_cmd(self, cmd, timeout=10):
        s = socket.socket()
        s.settimeout(timeout)
        s.connect((self.host, ESP32_CMD_PORT))
        s.send(cmd.encode())
        import time; time.sleep(min(timeout - 1, 3))
        try:
            r = s.recv(4096).decode()
        except:
            r = "timeout"
        s.close()
        return r

    def _serial_cmd(self, cmd):
        import subprocess
        escaped = cmd.replace('"', '\\"')
        r = subprocess.run(
            ["ssh", self.serial_host, "python", "C:\\Users\\tutuc\\esp_cmd_v2.py", f'"{escaped}"'],
            capture_output=True, text=True, timeout=20,
        )
        return r.stdout.strip()

    def fill(self, r, g, b):
        """Fill screen with a color."""
        rgb565 = ((r & 0xF8) << 8) | ((g & 0xFC) << 3) | (b >> 3)
        return self.command(f"tft.fill({rgb565})")

    def rect(self, x, y, w, h, r, g, b):
        """Draw a filled rectangle."""
        rgb565 = ((r & 0xF8) << 8) | ((g & 0xFC) << 3) | (b >> 3)
        return self.command(f"tft.fill_rect({x},{y},{w},{h},{rgb565})")

    def clear(self):
        """Clear screen to black."""
        return self.command("tft.fill(0)")

    def show_image(self, png_path):
        """Convert a PNG and display it on the ESP32."""
        rgb565 = self._png_to_rgb565(png_path)
        return self.stream_frame(rgb565)

    def stream_frame(self, rgb565_data):
        """Send a raw RGB565 frame to the display. 134400 bytes."""
        if len(rgb565_data) != FRAME_SIZE:
            raise ValueError(f"Frame must be {FRAME_SIZE} bytes, got {len(rgb565_data)}")

        if self.mode == "wifi":
            return self._wifi_stream(rgb565_data)
        else:
            return "Streaming requires WiFi connection"

    def _wifi_stream(self, data):
        """Stream frame over WiFi to port 8267."""
        s = socket.socket()
        s.settimeout(10)
        s.connect((self.host, ESP32_FRAME_PORT))
        sent = 0
        while sent < len(data):
            n = s.send(data[sent:sent + 4096])
            sent += n
        import time; time.sleep(0.5)
        try:
            r = s.recv(64).decode()
        except:
            r = "timeout"
        s.close()
        return r

    def _png_to_rgb565(self, png_path):
        """Convert PNG to RGB565 bytes for the display."""
        from PIL import Image

        img = Image.open(png_path).convert("RGB")

        # Fit to display
        img_w, img_h = img.size
        # For landscape viewing in portrait mode, rotate
        if img_w > img_h:
            # Landscape image → rotate to fit portrait display
            target_w, target_h = 280, 240
            img = img.resize((target_w, target_h))
            img = img.transpose(Image.ROTATE_270)
        else:
            img = img.resize((DISPLAY_WIDTH, DISPLAY_HEIGHT))

        # Ensure correct size
        frame = Image.new("RGB", (DISPLAY_WIDTH, DISPLAY_HEIGHT), (0, 0, 0))
        paste_x = (DISPLAY_WIDTH - img.width) // 2
        paste_y = (DISPLAY_HEIGHT - img.height) // 2
        frame.paste(img, (paste_x, paste_y))

        # Convert to RGB565
        raw = bytearray()
        for y in range(DISPLAY_HEIGHT):
            for x in range(DISPLAY_WIDTH):
                r, g, b = frame.getpixel((x, y))
                rgb565 = ((r & 0xF8) << 8) | ((g & 0xFC) << 3) | (b >> 3)
                raw.append(rgb565 >> 8)
                raw.append(rgb565 & 0xFF)

        return bytes(raw)

    def show_boot_screen(self):
        """Show the default boot screen from file."""
        return self.command("""
tft.fill(st7789.BLACK)
with open('screen.raw','rb') as f:
 for y in range(280):
  tft.blit_buffer(f.read(480),0,y,240,1)
""")


if __name__ == "__main__":
    import sys
    d = DaemonDisplay()
    if len(sys.argv) < 2:
        print("Usage: python esp32_display.py [fill R G B | image path.png | clear | boot]")
    elif sys.argv[1] == "fill":
        d.fill(int(sys.argv[2]), int(sys.argv[3]), int(sys.argv[4]))
    elif sys.argv[1] == "image":
        d.show_image(sys.argv[2])
    elif sys.argv[1] == "clear":
        d.clear()
    elif sys.argv[1] == "boot":
        d.show_boot_screen()
