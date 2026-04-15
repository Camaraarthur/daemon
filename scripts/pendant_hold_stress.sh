#!/usr/bin/env bash
# Stress-test the HOLD path by firing SIM_BUTTON broadcasts (3→6) N times.
# Verifies: recording_state cycles, transcribe call, POST attempted,
# no crashes, no stuck state.
#
# Requires: daemon app installed + running on Pixel (100.126.71.26:46879).
#
# Usage: ./pendant_hold_stress.sh [iterations=20]
set -uo pipefail  # NOT -e: grep -c returns 1 on zero matches, fine.

N=${1:-20}
PIXEL=100.126.71.26:46879
ADB="adb -s $PIXEL"
PASS=0
FAIL=0
FAILED_ITERS=()

# Ensure app is up and perms granted.
$ADB shell 'pm grant com.daemon.app android.permission.RECORD_AUDIO' 2>/dev/null || true
$ADB shell 'pidof com.daemon.app' >/dev/null || {
  echo "App not running — launching..."
  $ADB shell 'am start -n com.daemon.app/.MainActivity' >/dev/null
  sleep 8
}

echo "=== HOLD path stress test: $N iterations ==="
START_TS=$(date +%s)

DBG=/storage/emulated/0/Download/pendant_debug.log

# Line-count baseline (app owns the file; can't truncate from adb).
baseline_lines() { $ADB shell "wc -l < $DBG 2>/dev/null" | tr -d ' \r'; }

for i in $(seq 1 $N); do
  echo -n "[$i/$N] "
  BASE=$(baseline_lines)
  [[ -z "$BASE" ]] && BASE=0

  # Fire HOLD
  $ADB shell 'am broadcast -a com.daemon.app.PENDANT_SIM_BUTTON --ei code 3' >/dev/null
  sleep 1
  # Fire STOP
  $ADB shell 'am broadcast -a com.daemon.app.PENDANT_SIM_BUTTON --ei code 6' >/dev/null
  sleep 4  # let WAV + Deepgram + POST roundtrip

  # Grab only lines appended during this iteration.
  LOG=$($ADB shell "tail -n +$((BASE + 1)) $DBG 2>/dev/null")
  START=$(echo "$LOG" | grep -c "recording start mode=command")
  STOP=$(echo "$LOG" | grep -c "recording stop mode=command")
  POSTED=$(echo "$LOG" | grep -cE "voice/command POST")
  FATAL=$($ADB shell 'logcat -d -s AndroidRuntime:E 2>&1 | grep -c "FATAL EXCEPTION"')

  if [[ "$START" -ge 1 && "$STOP" -ge 1 && "$POSTED" -ge 1 && "$FATAL" == "0" ]]; then
    echo "OK (start=$START stop=$STOP post=$POSTED)"
    PASS=$((PASS + 1))
  else
    echo "FAIL (start=$START stop=$STOP post=$POSTED fatal=$FATAL)"
    FAIL=$((FAIL + 1))
    FAILED_ITERS+=("$i")
    echo "--- dbg log ---"
    echo "$LOG" | tail -10
  fi
done

ELAPSED=$(($(date +%s) - START_TS))
echo
echo "=== RESULT: $PASS/$N passed, $FAIL failed in ${ELAPSED}s ==="
if [[ ${#FAILED_ITERS[@]} -gt 0 ]]; then
  echo "Failed iterations: ${FAILED_ITERS[*]}"
fi
exit $FAIL
