#!/usr/bin/env python3
"""Fast sensor streaming: reads ESP32 via Pixel SSH, pushes to web SSE + ESP32 display."""
import subprocess, json, time, sys, threading, urllib.request, sqlite3

ESP32_IP = "10.27.241.196"
PIXEL_SSH = ["ssh", "-o", "ConnectTimeout=3", "-o", "StrictHostKeyChecking=no",
             "-i", "/home/arthur/.ssh/id_ed25519", "-p", "8022", "arthur@100.126.71.26"]

def get_token():
    conn = sqlite3.connect("/home/arthur/daemon/data/users.db")
    t = conn.execute("SELECT token FROM sessions LIMIT 1").fetchone()[0]
    conn.close()
    return t

TOKEN = get_token()

def read_sensor():
    try:
        r = subprocess.run(
            PIXEL_SSH + ["python3", "-c",
                f"import socket,json;s=socket.socket();s.settimeout(2);s.connect(('{ESP32_IP}',8268));"
                f"s.send(b'GET / HTTP/1.0\\r\\n\\r\\n');import time;time.sleep(0.3);"
                f"r=s.recv(4096).decode();s.close();d=json.loads(r.split('\\r\\n\\r\\n',1)[1]);"
                f"print(d.get('distance',-1))"],
            capture_output=True, text=True, timeout=6)
        return float(r.stdout.strip())
    except:
        return -1

def push_web(distance):
    try:
        data = json.dumps({"type":"sensor","distance":distance,"timestamp":int(time.time()*1000)}).encode()
        req = urllib.request.Request("http://localhost:4800/api/stream-push", data=data,
            headers={"Content-Type":"application/json","Cookie":f"daemon_token={TOKEN}"}, method="POST")
        urllib.request.urlopen(req, timeout=2)
    except: pass

def update_esp32(distance):
    try:
        subprocess.run(PIXEL_SSH + ["python3", "-c",
            f"import socket,time\n"
            f"def e(c):\n"
            f" s=socket.socket();s.settimeout(3);s.connect(('{ESP32_IP}',8266))\n"
            f" s.send((c+chr(10)).encode());time.sleep(0.4);s.recv(1024);s.close()\n"
            f"e('tft.fill(0)')\n"
            f"e('tft.text(font, \"{distance:.1f}\", 10, 60, st7789.RED)')\n"
            f"e('tft.text(font, \"cm\", 10, 110, st7789.color565(80,80,80))')\n"
            f"e('tft.fill_rect(260, 12, 6, 6, st7789.GREEN)')"],
            capture_output=True, text=True, timeout=10)
    except: pass

def clear_web():
    try:
        data = json.dumps({"type":"clear"}).encode()
        req = urllib.request.Request("http://localhost:4800/api/stream-push", data=data,
            headers={"Content-Type":"application/json","Cookie":f"daemon_token={TOKEN}"}, method="POST")
        urllib.request.urlopen(req, timeout=2)
    except: pass

def init_esp32_font():
    try:
        subprocess.run(PIXEL_SSH + ["python3", "-c",
            f"import socket;s=socket.socket();s.settimeout(5);s.connect(('{ESP32_IP}',8266));"
            f"s.send(b'import vga1_16x32 as font; tft.rotation(1)\\n');import time;time.sleep(1);s.recv(1024);s.close()"],
            capture_output=True, text=True, timeout=8)
        print("ESP32 font initialized", flush=True)
    except Exception as ex:
        print(f"Font init failed: {ex}", flush=True)

if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "stop":
        clear_web()
        print("stopped"); sys.exit(0)

    print("Initializing ESP32 font...", flush=True)
    init_esp32_font()
    print("Streaming...", flush=True)

    esp32_thread = None
    last_esp32 = 0
    try:
        while True:
            t0 = time.time()
            d = read_sensor()
            if d > 0:
                push_web(d)
                if time.time() - last_esp32 > 3:
                    if esp32_thread is None or not esp32_thread.is_alive():
                        esp32_thread = threading.Thread(target=update_esp32, args=(d,))
                        esp32_thread.start()
                        last_esp32 = time.time()
                print(f"{d:.1f}cm ({time.time()-t0:.1f}s)", flush=True)
            elapsed = time.time() - t0
            time.sleep(max(0.5, 2.0 - elapsed))
    except KeyboardInterrupt:
        clear_web()
        print("\nstopped")
