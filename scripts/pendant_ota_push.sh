#!/usr/bin/env bash
# Pendant OTA push helper.
# Builds firmware, serves it on :7777, fires the OTA broadcast on the Pixel,
# tails pendant_debug.log until complete or timeout.
#
# Usage: ./pendant_ota_push.sh [--no-build] [--no-restart]
#
# Assumes:
#   - /tmp/pendant_test/ has the firmware sources
#   - Pixel reachable via adb at 100.126.71.26:46879
#   - arturito has a Tailscale IP of 100.124.245.114
#
set -euo pipefail

NO_BUILD=0
NO_RESTART=0
for arg in "$@"; do
  case "$arg" in
    --no-build) NO_BUILD=1 ;;
    --no-restart) NO_RESTART=1 ;;
  esac
done

FW_DIR=/tmp/pendant_test
BIN=$FW_DIR/.pio/build/esp32-s3-devkitc-1/firmware.bin
PIXEL=100.126.71.26:46879
HOST_IP=100.124.245.114
HTTP_PORT=7777
ADB="adb -s $PIXEL"

if [[ $NO_BUILD -eq 0 ]]; then
  echo "[1/5] Building firmware..."
  (cd $FW_DIR && pio run) | tail -3
fi

[[ -f $BIN ]] || { echo "ERROR: no firmware.bin at $BIN"; exit 1; }
echo "[2/5] firmware size: $(stat -c%s $BIN) bytes"

if ! pgrep -f "http.server $HTTP_PORT" >/dev/null; then
  echo "[3/5] Starting HTTP server on $HTTP_PORT..."
  (cd $(dirname $BIN) && nohup python3 -m http.server $HTTP_PORT >/tmp/pendant_http.log 2>&1 &)
  sleep 1
else
  echo "[3/5] HTTP server already running on $HTTP_PORT"
fi

if [[ $NO_RESTART -eq 0 ]]; then
  echo "[4/5] Restarting daemon app on Pixel..."
  $ADB shell 'am force-stop com.daemon.app; rm /storage/emulated/0/Download/pendant_debug.log 2>/dev/null; am start -n com.daemon.app/.MainActivity' >/dev/null
  sleep 12
fi

echo "[5/5] Firing OTA broadcast..."
$ADB shell "am broadcast -a com.daemon.app.PENDANT_OTA --es url 'http://$HOST_IP:$HTTP_PORT/firmware.bin'" | tail -1

# Tail the log until we see "complete" or "failed" or timeout
START=$(date +%s)
TIMEOUT=120
while true; do
  LINE=$($ADB shell 'tail -1 /storage/emulated/0/Download/pendant_debug.log 2>/dev/null' | tr -d '\r')
  echo "  $LINE"
  if [[ "$LINE" == *"OTA upload complete"* ]]; then
    echo "✓ OTA SUCCESS"
    exit 0
  fi
  if [[ "$LINE" == *"OTA upload failed"* ]]; then
    echo "✗ OTA FAILED"
    exit 1
  fi
  if [[ $(($(date +%s) - START)) -gt $TIMEOUT ]]; then
    echo "✗ TIMEOUT after ${TIMEOUT}s"
    exit 2
  fi
  sleep 3
done
