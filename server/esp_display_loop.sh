#!/bin/bash
while true; do
    DIST=$(/home/arthur/daemon/server/read_sensor.sh 2>/dev/null)
    if [ -n "$DIST" ] && [ "$DIST" != "-1" ]; then
        ssh -o ConnectTimeout=3 -p 8022 arthur@100.126.71.26 "python3 -c '
import socket, time
def e(c):
    s=socket.socket();s.settimeout(3);s.connect((\"10.27.241.196\",8266))
    s.send((c+chr(10)).encode());time.sleep(0.4);s.recv(1024);s.close()
e(\"tft.fill(0)\")
e(\"tft.text(font, \\\"${DIST}\\\", 20, 40, st7789.RED)\")
e(\"tft.text(font, \\\"cm\\\", 20, 90, st7789.color565(80,80,80))\")
e(\"tft.fill_rect(260, 12, 6, 6, st7789.GREEN)\")
'" 2>/dev/null
    fi
    sleep 3
done
