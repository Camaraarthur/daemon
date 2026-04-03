#!/bin/bash
# Start both the Next.js app (port 4802 internal) and WebSocket server (port 4801)
# A lightweight proxy on port 4800 routes WS upgrades to 4801, HTTP to 4802

cd "$(dirname "$0")"

# Start WS server
node ws-server.js &
WS_PID=$!
echo "[start] WS server started on :4801 (PID $WS_PID)"

# Start Next.js on internal port
PORT=4802 npx next start -p 4802 &
NEXT_PID=$!
echo "[start] Next.js started on :4802 (PID $NEXT_PID)"

# Start proxy
node proxy.js &
PROXY_PID=$!
echo "[start] Proxy started on :4800 (PID $PROXY_PID)"

# If any dies, kill all and exit
trap "kill $WS_PID $NEXT_PID $PROXY_PID 2>/dev/null; exit" SIGTERM SIGINT

wait -n
echo "[start] A process exited, shutting down..."
kill $WS_PID $NEXT_PID $PROXY_PID 2>/dev/null
wait
exit 1
