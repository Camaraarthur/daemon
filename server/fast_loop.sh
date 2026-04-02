#!/bin/bash
TOKEN=$(python3 -c "import sqlite3; c=sqlite3.connect('/home/arthur/daemon/data/users.db'); print(c.execute('SELECT token FROM sessions LIMIT 1').fetchone()[0])")
while true; do
    DIST=$(/home/arthur/daemon/server/read_sensor.sh 2>/dev/null)
    if [ -n "$DIST" ] && [ "$DIST" != "-1" ]; then
        curl -s -X POST http://localhost:4800/api/stream-push -H 'Content-Type: application/json' -b "daemon_token=$TOKEN" -d "{\"type\":\"sensor\",\"distance\":${DIST},\"timestamp\":$(date +%s%3N)}" > /dev/null &
        echo "$DIST"
    fi
    sleep 1
done
