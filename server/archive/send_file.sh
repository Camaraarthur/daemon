#!/bin/bash
# Send a file to the Pixel's Downloads folder via the daemon app
# Usage: send_file.sh <filepath> [custom_filename]
# The file appears in the phone's Downloads app immediately

FILE="$1"
NAME="${2:-$(basename "$FILE")}"

if [ ! -f "$FILE" ]; then
    echo "File not found: $FILE"
    exit 1
fi

# Base64 encode the file
B64=$(base64 -w0 "$FILE")

# Send via WebSocket command to the daemon app
curl -s -X POST http://localhost:4801/command \
    -H 'Content-Type: application/json' \
    -d "{\"device_id\": \"Pixel 8 Pro\", \"command\": {\"type\": \"receive_file\", \"filename\": \"$NAME\", \"data\": \"$B64\"}}" 2>&1
