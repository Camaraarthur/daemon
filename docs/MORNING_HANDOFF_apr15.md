# Morning handoff — pendant demo prep (April 15, 2026)

## Current state (committed on `develop`)

Firmware on pendant: **v0.8.3** (flashed via OTA overnight). Includes:
- Working BLE + OTA, stable reconnect
- Event codes: `0x03` HOLD_START (command), `0x04` DOUBLE (conversation),
  `0x06` STOPPED, `0x07` CMD_IN_CONVO_BEGIN, `0x08` CMD_IN_CONVO_END
- Battery NOTIFY every 10 s
- LED colour by mode: red = command, green = conversation

Android app: committed in `a3152df`. Changes:
- **HOLD path**: 0x03 → phone-mic record → Deepgram → POST
  `/api/voice/command` with `{transcript, source:"pendant", device_id,
  hold_started_at, hold_ended_at}`. Release via 0x06.
- **Conversation path**: 0x04 → 15 s rolling chunks → POST
  `/api/voice/context` per chunk with `{session_id, chunk_index,
  started_at, ended_at, transcript, source, device_id}`. 5-min hard cap.
- Phone-mic used since pendant audio streaming isn't in firmware yet.
- `setMic()` removed from start/stop recording — pendant mic path is
  noise until firmware v0.9 streams audio.
- `PendantGattClient.cacheRefreshed` now resets on disconnect so
  repeated OTA pushes don't need an app restart.

## Test harnesses

```bash
# OTA push helper (build + serve + fire + wait)
./scripts/pendant_ota_push.sh [--no-build] [--no-restart]

# HOLD stress test (N iterations, default 20)
./scripts/pendant_hold_stress.sh [20]
```

Both require `adb -s 100.126.71.26:46879` reachable. **Pair code rotates
every wireless-debug session.** Before running, reconnect adb from a
fresh pair code.

## Debug broadcasts added (adb-triggered, no UI needed)

```bash
# Set Deepgram key
adb shell "am broadcast -a com.daemon.app.PENDANT_CMD \
  --es type pendant.set_deepgram_key --es key $DG_KEY"

# Simulate a button event (bypasses physical press)
adb shell "am broadcast -a com.daemon.app.PENDANT_SIM_BUTTON --ei code 3"  # HOLD
adb shell "am broadcast -a com.daemon.app.PENDANT_SIM_BUTTON --ei code 6"  # STOP
adb shell "am broadcast -a com.daemon.app.PENDANT_SIM_BUTTON --ei code 4"  # DOUBLE

# Fire an OTA
adb shell "am broadcast -a com.daemon.app.PENDANT_OTA \
  --es url 'http://100.124.245.114:7777/firmware.bin'"
```

## Verified working overnight

1. HOLD end-to-end: SIM 0x03 → record start → SIM 0x06 → stop → WAV
   saved → Deepgram call → POST to `/api/voice/command` (skipped on
   empty transcript because I was stress-testing silence).
2. OTA pipeline: 3 consecutive pushes worked with app restart between
   each. First-time fresh connection reliably working.
3. Pendant reconnect after OTA reboot: ≤ 5 s consistently.
4. Battery NOTIFY every 10 s while connected.
5. Firmware event emission (0x03, 0x04, 0x06) — confirmed via logcat
   when physical button was pressed earlier in the session.

## Known gaps for demo

1. **`/api/voice/context` endpoint does not exist yet** — other agent
   (daemons-main) is supposed to build it. My chunk-POST will 404 until
   they land it. My code handles the 404 gracefully (log + continue).
2. **Empty transcript when nobody speaks** — Deepgram returns no text
   on silence, and I skip the POST. During demo, speak normally.
3. **Pixel wireless-debug port rotates per session** — you'll need to
   re-pair adb. See the wireless debugging screen on the Pixel.
4. **Pendant is still v0.8.3** — the CMD_IN_CONVO events (0x07/0x08)
   are in firmware but the Android bridge currently just ignores them
   (else branch). That's fine for demo since it's a nice-to-have.
5. **Pendant audio streaming is not implemented in firmware** — phone
   mic is the audio source. Works fine when pendant is near the phone.

## Things I could NOT test autonomously

- Actual voice commands flowing through: need you to physically speak
  while pressing the pendant button. All machinery is wired.
- `/api/voice/context` integration: endpoint doesn't exist yet.
- Full stress run of 20 iterations with real Pixel: was going to run
  but Pixel adb dropped before I could (pair port rotated).

## If something is broken in the morning, check in order

1. `adb connect 100.126.71.26:<NEW_PORT>` — pair fresh
2. Daemon app running: `adb shell pidof com.daemon.app`
3. Service up: `adb shell dumpsys activity services com.daemon.app |
   grep running`
4. If not: `adb shell am start -n com.daemon.app/.MainActivity`
5. Deepgram key still set: `adb shell "am broadcast -a
   com.daemon.app.PENDANT_CMD --es type pendant.status"` and look at
   logcat. Re-set via PENDANT_CMD if not.
6. Pendant still reachable: look for `PendantGatt: Battery: NN%` in
   logcat — should appear every 10 s.

## Demo commands mapping (per Arthur's prompt)

- "Write X on your page" → relay `canvas.text` tool (W2)
- "Email Luca…" → relay gmail MCP (W4)
- "WhatsApp mom…" → device dispatch → Android `send_whatsapp` tool
  (W3). My changes don't touch this; confirmed existing path is intact.
- "Take a picture and put it on the page" → device dispatch → Android
  `take_photo` + `canvas.card` (W2). Same — I didn't touch `take_photo`.

All four paths enter at `/api/voice/command`. The agent loop resolves
which tool to call.
