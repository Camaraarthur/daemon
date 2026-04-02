#!/bin/bash
# Daemon container entrypoint
# Starts both the web UI and the Python daemon orchestrator

set -e

echo "[daemon] Starting daemon container for user: ${DAEMON_USER:-anonymous}"
echo "[daemon] Daemon name: ${DAEMON_NAME:-unnamed}"

# Start web UI in background
PORT=4800 npx --prefix /home/daemon/web next start -p 4800 &
WEB_PID=$!

# Wait for web to be ready
for i in $(seq 1 30); do
    if curl -sf http://localhost:4800/ > /dev/null 2>&1; then
        echo "[daemon] Web UI ready on :4800"
        break
    fi
    sleep 1
done

echo "[daemon] Container ready. Waiting for connections..."

# Keep container alive — wait for web process
wait $WEB_PID
