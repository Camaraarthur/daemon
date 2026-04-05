#!/bin/bash
# Read ESP32 distance sensor via Pixel SSH → HTTP. Prints distance in cm or nothing on failure.
timeout 6 ssh -o ConnectTimeout=2 -o StrictHostKeyChecking=no -i /home/arthur/.ssh/id_ed25519 -p 8022 arthur@100.126.71.26 \
  "python3 -c 'import socket,json;s=socket.socket();s.settimeout(2);s.connect((\"10.27.241.196\",8268));s.send(b\"GET / HTTP/1.0\r\n\r\n\");import time;time.sleep(0.3);r=s.recv(4096).decode();s.close();d=json.loads(r.split(\"\r\n\r\n\",1)[1]);v=d.get(\"distance\",-1);print(v) if v>0 else None'" 2>/dev/null
