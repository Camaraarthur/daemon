# Daemon Display UI — runs on ESP32 with ST7789 240x280 screen
# The daemon sends text commands, this renders them beautifully
#
# Commands (sent as strings via TCP or serial eval):
#   ui.text("Hello world")          — display text
#   ui.alert("Warning!")            — red alert banner
#   ui.status(wifi=1, bat=30)       — update status bar
#   ui.listening()                  — show listening animation
#   ui.thinking()                   — show thinking animation
#   ui.idle()                       — return to idle screen
#   ui.clear()                      — clear screen

from font5x7 import FONT, char_width, char_height
import time

class DaemonUI:
    # Colors
    RED = 0xF800
    BLUE = 0x001F
    WHITE = 0xFFFF
    GREY = 0x7BEF
    DARK = 0x18E3
    BLACK = 0x0000
    GREEN = 0x07E0

    def __init__(self, lcd, name="My"):
        self.lcd = lcd
        self.name = name
        self.w = 240
        self.h = 280
        self.state = "idle"
        self.lines = []  # text buffer
        self.idle()

    def _draw_char(self, x, y, ch, color, scale=1):
        """Draw a single character at (x,y) with given color and scale."""
        data = FONT.get(ord(ch))
        if not data:
            return
        for col in range(5):
            byte = data[col]
            for row in range(7):
                if byte & (1 << row):
                    # Always use fill_rect (pixel() not in our ST7789 driver)
                    self.lcd.fill_rect(x + col*scale, y + row*scale, scale, scale, color)

    def _draw_text(self, x, y, text, color=None, scale=1):
        """Draw text string. Returns final x position."""
        if color is None:
            color = self.WHITE
        cx = x
        for ch in text:
            if ch == '\n':
                y += char_height() * scale
                cx = x
                continue
            if cx + char_width() * scale > self.w:
                y += char_height() * scale
                cx = x
            self._draw_char(cx, y, ch, color, scale)
            cx += char_width() * scale
        return cx, y

    def _draw_status_bar(self):
        """Draw top status bar."""
        self.lcd.fill_rect(0, 0, self.w, 16, self.BLACK)
        # Red dot
        self.lcd.fill_rect(4, 4, 8, 8, self.RED)
        # Daemon name
        self._draw_text(16, 5, self.name, self.WHITE, 1)
        # State indicator on right
        state_colors = {
            "idle": self.GREY,
            "listening": self.GREEN,
            "thinking": self.BLUE,
            "speaking": self.RED,
        }
        c = state_colors.get(self.state, self.GREY)
        self.lcd.fill_rect(self.w - 12, 4, 8, 8, c)

    def clear(self):
        """Clear screen."""
        self.lcd.fill(self.BLACK)
        self._draw_status_bar()
        self.lines = []

    def idle(self):
        """Show idle screen."""
        self.state = "idle"
        self.clear()
        # Center: daemon name big
        self._draw_text(60, 100, self.name, self.RED, 4)
        self._draw_text(60, 140, "daemon", self.DARK, 2)
        # Bottom: hint
        self._draw_text(50, 250, "tap to talk", self.DARK, 1)

    def text(self, msg, color=None):
        """Display text message from daemon."""
        if color is None:
            color = self.WHITE
        self.state = "speaking"
        self._draw_status_bar()
        # Word wrap and display
        self.lcd.fill_rect(0, 20, self.w, self.h - 40, self.BLACK)
        words = msg.split(' ')
        line = ""
        y = 24
        max_chars = self.w // (char_width() * 2)
        for word in words:
            if len(line) + len(word) + 1 > max_chars:
                self._draw_text(8, y, line.strip(), color, 2)
                y += char_height() * 2 + 2
                line = word + " "
                if y > self.h - 40:
                    break
            else:
                line += word + " "
        if line.strip() and y <= self.h - 40:
            self._draw_text(8, y, line.strip(), color, 2)

    def alert(self, msg):
        """Show alert banner."""
        self.lcd.fill_rect(0, 80, self.w, 60, self.RED)
        self._draw_text(10, 90, msg[:30], self.WHITE, 2)
        self.lcd.fill_rect(0, 140, self.w, 2, self.RED)

    def listening(self):
        """Show listening state."""
        self.state = "listening"
        self.clear()
        # Mic icon (simple rectangle)
        self.lcd.fill_rect(110, 80, 20, 40, self.RED)
        self.lcd.fill_rect(100, 120, 40, 4, self.RED)
        self._draw_text(60, 150, "listening...", self.GREEN, 2)

    def thinking(self):
        """Show thinking state."""
        self.state = "thinking"
        self.clear()
        # Animated dots
        for i in range(3):
            self.lcd.fill_rect(90 + i*25, 130, 12, 12, self.BLUE)
        self._draw_text(55, 160, "thinking...", self.DARK, 2)

    def status(self, wifi=0, bat=0, devices=0):
        """Update status info at bottom."""
        self.lcd.fill_rect(0, self.h - 20, self.w, 20, self.BLACK)
        x = 4
        if wifi:
            self._draw_text(x, self.h - 16, "WiFi", self.GREEN, 1)
            x += 30
        if bat:
            self._draw_text(x, self.h - 16, str(bat) + "%", self.WHITE, 1)
            x += 30
        if devices:
            self._draw_text(x, self.h - 16, str(devices) + " dev", self.GREY, 1)

    def show_image_line(self, y, data):
        """Write one line of RGB565 data to display (for streaming images)."""
        self.lcd.set_window(0, y, self.w - 1, y)
        self.lcd.cs.value(0)
        self.lcd.dc.value(1)
        self.lcd.spi.write(data)
        self.lcd.cs.value(1)
