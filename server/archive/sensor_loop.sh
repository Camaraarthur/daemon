#!/bin/bash
# Continuous sensor reading: ESP32 → display on ESP32 screen + push to web SSE
# Usage: sensor_loop.sh [start|stop]

PIDFILE="/tmp/daemon-sensor-loop.pid"
TOKEN=$(python3 -c "import sqlite3; c=sqlite3.connect('/home/arthur/daemon/data/users.db'); print(c.execute('SELECT token FROM sessions LIMIT 1').fetchone()[0])")

if [ "$1" = "stop" ]; then
    [ -f "$PIDFILE" ] && kill $(cat "$PIDFILE") 2>/dev/null && rm "$PIDFILE"
    # Clear web canvas
    curl -s -X POST http://localhost:4800/api/stream-push -H 'Content-Type: application/json' -b "daemon_token=$TOKEN" -d '{"type":"clear"}' > /dev/null
    echo "stopped"
    exit 0
fi

# Kill any existing loop
[ -f "$PIDFILE" ] && kill $(cat "$PIDFILE") 2>/dev/null

# Import font on ESP32 first
ssh -o ConnectTimeout=3 -p 8022 arthur@100.126.71.26 "python3 -c '
import socket
s=socket.socket(); s.settimeout(5); s.connect((\"10.27.241.196\",8266))
s.send(b\"import vga1_16x32 as font\n\"); import time; time.sleep(1); s.recv(1024); s.close()
'" 2>/dev/null

echo $$ > "$PIDFILE"

while true; do
    # Read sensor via HTTP (more reliable)
    DIST=$(/home/arthur/daemon/server/read_sensor.sh 2>/dev/null)

    if [ -n "$DIST" ] && [ "$DIST" != "-1" ]; then
        # Update ESP32 display
        ssh -o ConnectTimeout=3 -p 8022 arthur@100.126.71.26 "python3 -c '
import socket, time
def esp(cmd):
    s=socket.socket(); s.settimeout(5); s.connect((\"10.27.241.196\",8266))
    s.send((cmd+chr(10)).encode()); time.sleep(0.5); s.recv(1024); s.close()
esp(\"tft.fill(0)\")
time.sleep(0.1)
esp(\"tft.text(font, \\\"${DIST}\\\", 10, 60, st7789.RED)\")
time.sleep(0.1)
esp(\"tft.text(font, \\\"cm\\\", 10, 110, st7789.color565(80,80,80))\")
time.sleep(0.1)
esp(\"tft.fill_rect(218, 12, 6, 6, st7789.GREEN)\")
'" 2>/dev/null &

        # Push to web SSE
        curl -s -X POST http://localhost:4800/api/stream-push \
            -H 'Content-Type: application/json' \
            -b "daemon_token=$TOKEN" \
            -d "{\"type\":\"sensor\",\"distance\":${DIST},\"timestamp\":$(date +%s%3N)}" > /dev/null &

        wait
    fi

    sleep 2
done
