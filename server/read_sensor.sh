#!/bin/bash
ssh -o ConnectTimeout=3 -o StrictHostKeyChecking=no -i /home/arthur/.ssh/id_ed25519 -p 8022 arthur@100.126.71.26 \
  "python3 -c 'import socket,json;s=socket.socket();s.settimeout(3);s.connect((\"10.27.241.196\",8268));s.send(b\"GET / HTTP/1.0\r\n\r\n\");import time;time.sleep(0.5);r=s.recv(4096).decode();s.close();d=json.loads(r.split(\"\r\n\r\n\",1)[1]);print(d.get(\"distance\",-1))'" 2>/dev/null
