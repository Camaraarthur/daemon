# Daemon ESP32 — main.py
# Boots into WiFi + display UI + TCP command server + button handler

import network, socket, time, machine, _thread
from machine import Pin, SPI

# === WiFi ===
sta = network.WLAN(network.STA_IF)
sta.active(False)
time.sleep(1)
sta.active(True)
time.sleep(2)

try:
    from wifi_config import SSID, PASS
    nets = sta.scan()
    print("Scan:", len(nets), "nets")
    sta.connect(SSID, PASS)
    for _ in range(15):
        if sta.isconnected():
            break
        time.sleep(1)
except Exception as e:
    print("WiFi err:", e)

ip = sta.ifconfig()[0] if sta.isconnected() else "0.0.0.0"
print("IP:", ip)

# === Display ===
lcd = None
ui = None
try:
    spi = SPI(2, baudrate=10000000, sck=Pin(26), mosi=Pin(27))
    from st7789 import ST7789
    lcd = ST7789(spi, dc=33, cs=25, rst=32, bl=32)
    from daemon_ui import DaemonUI
    from font5x7 import FONT
    ui = DaemonUI(lcd, name="My")
    ui.status(wifi=1 if sta.isconnected() else 0)
    print("Display: OK")
except Exception as e:
    print("Display:", e)

# === Button (GPIO 18) ===
button = Pin(18, Pin.IN, Pin.PULL_UP)
button_pressed = False

def button_isr(pin):
    global button_pressed
    button_pressed = True

button.irq(trigger=Pin.IRQ_FALLING, handler=button_isr)

# === Mic D0 (GPIO 22 — digital threshold, HIGH when sound detected) ===
mic_d0 = Pin(22, Pin.IN)

def is_sound():
    """Check if mic detects sound (digital threshold)."""
    return mic_d0.value() == 0  # Most modules go LOW on sound

# === TCP Server ===
g = globals()
s = socket.socket()
s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
s.bind(("0.0.0.0", 8266))
s.listen(1)
print("READY", ip + ":8266")

if ui:
    ui.text("Ready at " + ip)
    time.sleep(2)
    ui.idle()

# === Button handler thread ===
def button_loop():
    global button_pressed
    while True:
        if button_pressed:
            button_pressed = False
            if ui:
                ui.listening()
            # TODO: notify daemon via HTTP that button was pressed
            # For now just show listening state for 3 seconds
            time.sleep(3)
            if ui:
                ui.idle()
        time.sleep(0.1)

_thread.start_new_thread(button_loop, ())

# === Main server loop ===
while True:
    cl, addr = s.accept()
    try:
        data = cl.recv(4096).decode().strip()
        if data:
            try:
                result = str(eval(data, g))
            except SyntaxError:
                try:
                    exec(data, g)
                    result = "OK"
                except Exception as e:
                    result = "ERR:" + str(e)
            except Exception as e:
                result = "ERR:" + str(e)
            cl.send(result.encode())
    except:
        pass
    finally:
        cl.close()
