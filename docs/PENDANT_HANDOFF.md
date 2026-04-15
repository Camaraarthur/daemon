# Pendant — Voice-Native Architecture & Handoff

> Audience: firmware engineer / hardware person. Also the source of truth
> for Android and relay teams on the BLE contract and button semantics.
> This doc supersedes any earlier pendant handoff notes.

## Role in the system

Pendant is a **BLE peripheral**. It never touches Wi-Fi or LTE. The
phone is the gateway to the internet. Pendant does two things:

1. Senses button presses (capture intent) and reports them over BLE.
2. Captures microphone audio and streams it over BLE when recording.

The pendant **cannot** talk back. No speaker, no TTS. Feedback to the
user is via LED colour + vibration (vibration future).

## Two recording modes — the core UX

There are two distinct recording modes, both physically reachable from
the same single button:

| Gesture | Mode | Purpose | LED |
|---------|------|---------|-----|
| Press and **hold** | **Command** | Direct instruction to the daemon. Acted on when released. | Red while held |
| **Double-click** | **Conversation** | Passive, continuous listening. Saved to memory / Qdrant / personal knowledge. | Green while recording |
| Single click while in conversation | — | Stops conversation recording. | off |

### Interrupt semantics (important)

While a **conversation** is recording (green), the user can **hold the
button** to issue a command *without* stopping the conversation. The
conversation audio keeps streaming. The hold window is marked as a
command slice. On release, the LED returns to green and conversation
recording continues uninterrupted.

Conceptually the audio stream is one long capture; the firmware simply
emits markers so the relay knows "from this timestamp to this timestamp
was a command, treat it separately."

Commands issued mid-conversation can reference the conversation:
"export what we just discussed", "stream this to X", "summarise and
email it to Y". The conversation itself is always also flowing to
memory as a background task.

### Everything is an MCP tool

The agent receiving the command is lean. The heavy lifting lives in
MCP tools it calls: memory writes, Qdrant search, publishing to
`<daemon_name>.daemon.page`, sending WhatsApp/email, opening apps,
streaming audio to a sink, etc. Commands compile down to tool calls.

## BLE GATT contract

UUIDs are **locked**. Defined in
`android/app/src/main/java/com/daemon/app/pendant/PendantUuids.kt` —
that file is the contract. Do not change without coordinating all three
sides.

**HonestPuck service** `4f7e1f00-7e3d-4f5a-9c1a-8e1b3a5b7d00`

| Char UUID suffix | Name | Props | Direction | Payload |
|------------------|------|-------|-----------|---------|
| `4f7e1f01` | CONTROL_EVENTS | READ + NOTIFY | pendant → phone | 1 byte event code (see below) |
| `4f7e1f02` | LED_CONTROL | WRITE + WRITE_NR | phone → pendant | 1 byte pattern |
| `4f7e1f03` | MIC_CONTROL | WRITE + WRITE_NR | phone → pendant | 1 byte 0/1 = off/on (force override) |
| `4f7e1f04` | AUDIO_STREAM | NOTIFY | pendant → phone | Opus 16 kHz mono @ 24 kbps, ≤ (MTU-3) byte frames |

**Battery service** (SIG standard) — `180F` / `2A19`, NOTIFY on change
(firmware pushes every 10 s).

**Device Info** (SIG standard) — `180A` / `2A26` firmware revision
string, `2A24` model number.

**OTA service** `8e400001-f315-4f60-9fb8-838830daea50`

| Char UUID suffix | Name | Props | Protocol |
|------------------|------|-------|----------|
| `8e400002` | OTA_CONTROL | READ + WRITE + NOTIFY | Write `0x01` to start (ack `0x10 0xF0 0x00` notify). Write `0x03` to finish (ack `0x10` notify, pendant reboots). |
| `8e400003` | OTA_DATA | WRITE + WRITE_NR | Stream firmware bytes in ≤ (MTU-3) byte chunks. |

Working reference implementation in
`android/app/src/main/java/com/daemon/app/pendant/PendantGattClient.kt:uploadFirmware`.

## Event codes on CONTROL_EVENTS

| Code | Name | When |
|------|------|------|
| `0x01` | MAIN_DOWN | Main button goes LOW (reserved; not currently emitted) |
| `0x02` | MAIN_UP | Main button goes HIGH (reserved; not currently emitted) |
| `0x03` | HOLD_START | Hold crossed HOLD_MS. Command mode begins. |
| `0x04` | DOUBLE | Second press within DOUBLE_MS detected. Conversation mode begins. |
| `0x05` | (reserved — was RECORDING; do not reuse) | — |
| `0x06` | STOPPED | Any recording stopped — conversation ended or command aborted. |
| `0x07` | CMD_IN_CONVO_BEGIN | Hold crossed HOLD_MS while conversation already active. Command interrupt begins. Audio keeps flowing. |
| `0x08` | CMD_IN_CONVO_END | Hold released. Conversation continues. |

The phone resolves higher-level semantics (command vs conversation, what
to POST where) from this sequence.

## Button timing (firmware constants)

- `HOLD_MS = 300` — time to hold before HOLD_START fires.
- `DOUBLE_MS = 400` — max gap between clicks to register double-click.

Both tunable. 300 ms hold is fast enough to feel instant, long enough
to not trigger on casual bumps.

## Audio format

- 16 kHz, mono, 16-bit signed PCM at the microphone.
- Encode to **Opus 24 kbps** on-device for streaming (4–5× smaller
  than raw PCM, fits comfortably in 240-byte BLE MTU frames).
- If Opus encoder unavailable on chosen MCU, fall back to raw PCM
  chunked to MTU — phone side decodes either way (marker byte in
  frame 0 indicates codec).
- Target end-to-end latency from press to first chunk on phone: < 200 ms.

## Power budget targets

Give these to the hardware person; they're what the rest of the UX
assumes.

| State | Current | Rationale |
|-------|---------|-----------|
| Deep sleep (button is the only wake source) | < 50 µA | Weeks of standby on a small LiPo |
| BLE advertising, no connection | < 1 mA | Reachable to the phone |
| BLE connected idle | < 2 mA | Holding link + battery notifies |
| Recording + streaming Opus | < 30 mA | Mic + BLE TX duty |

Current v0.8.x firmware does **not** implement deep sleep — it always
runs the main loop. That's intentional for bring-up. Firmware v0.9+
adds sleep and wake-on-GPIO0.

## Form factor / hardware choices

Locked:
- ESP32-S3 (octal PSRAM variant). Gives us BLE 5, PSRAM for audio
  buffers, and NimBLE + Opus via ESP-DSP.
- W25N02KV 2 Gbit SPI NAND flash — recording ring buffer (never
  lose audio if phone is out of range).
- Single tactile button on GPIO0.
- WS2812 ring (12 LEDs) on GPIO8, gated by a boost enable on GPIO7.
- I²S PDM mic (PIN_MIC_ENABLE_N active-low).
- 180F/2A19 battery service fed by ADC on GPIO9 (voltage divider).

Open for the hardware person:
- Second PDM mic for beamforming — nice-to-have.
- IPX4 housing.
- Charging: USB-C preferred. TP4056 or similar.

## Boot safety (already in v0.8.x)

- 3-slot partition table: factory (read-only recovery) + ota_0 + ota_1.
- `CONFIG_BOOTLOADER_APP_ROLLBACK_ENABLE=1`: three crashes = auto
  rollback.
- Boot counter in NVS, reset after 5 s stable run.
- Recovery combo: PROG1 + PROG2 held at boot → skip hardware init,
  BLE + OTA only. Factory partition contains a minimal BLE+OTA-only
  firmware that takes over if both OTA slots are bad.

This is deliberately conservative. The pendant should be
**unbrickable without physical hardware damage**.

## What's wired today (Apr 15 2026)

- **v0.8.1** is on the pendant. BLE advertising, OTA working, buttons
  emit HOLD_START / DOUBLE / STOPPED, battery notify every 10 s.
- Pixel daemon app (`com.daemon.app`) auto-scans, auto-connects,
  auto-reconnects, clears stale BT bonds, refreshes GATT cache. Stable.
- OTA pipeline: `adb shell am broadcast -a com.daemon.app.PENDANT_OTA
  --es url 'http://<host>:7777/firmware.bin'` pushes in ~10 s.
- Phone-mic audio capture + Deepgram transcription runs in
  `PendantAudioRecorder`.
- `/api/voice/command` POST on transcript-ready: in flight on another
  agent (W1).

Not yet wired:
- CMD_IN_CONVO_BEGIN / END (events 0x07, 0x08) — firmware v0.8.2.
- Pendant-mic audio streaming (AUDIO_STREAM char) — firmware v0.9.
- Deep sleep — firmware v0.9.
- Pendant agent persona + MCP toolkit on relay — W1/W2/W3.

## For the firmware person: start here

1. Read `PendantUuids.kt` for UUID contract.
2. Read `/tmp/pendant_test/src/main.cpp` for the current working
   reference. It's small and intentionally simple.
3. Bring up your board with the same BLE service shape. Existing
   Android app will scan, connect, and subscribe automatically —
   that's the integration test.
4. OTA protocol: match `uploadFirmware` in `PendantGattClient.kt`.
5. Audio streaming is the biggest open piece — see "Audio format"
   above.

## Open design questions

- **Conversation mode auto-stop**: should it stop after N minutes of
  silence, or only on explicit single-click? Leaning: silence-stop
  after 10 min, configurable.
- **Marker precision**: CMD_IN_CONVO events currently land within one
  main-loop tick (20 ms). Relay should round to the nearest audio
  frame boundary when slicing.
- **Simultaneous multi-command in conversation**: back-to-back holds
  should each mark their own slice — spec allows this, verify in
  firmware v0.8.2.
