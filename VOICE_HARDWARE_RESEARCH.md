# Daemon — Voice & Hardware Integration Research
*April 2026 — State of the art, practical options, and architecture recommendations*

---

## Current Daemon State

What already exists:
- **Deepgram Nova-3 streaming STT** in both server (`server/voice.py`) and browser (`web/src/lib/voice-client.ts`)
- WebSocket direct connection from browser to Deepgram (no proxy needed)
- `espeak-ng` / Piper fallback for local TTS
- ElevenLabs TTS stub (not implemented)
- ESP32 DevKitV1 with ST7789 display, HC-SR04 distance sensor, WiFi TCP servers
- Android app with chat + WebSocket device registration
- Qdrant knowledge graph, multi-device SSH mesh (arturito/MSI/Pixel)

---

## 1. Voice Pipeline — State of the Art

### Speech-to-Text (STT)

| Provider | Model | Latency | WER (English) | Streaming | Price | Notes |
|----------|-------|---------|---------------|-----------|-------|-------|
| **Deepgram** | Nova-3 | <300ms | 8.1% | Yes, WebSocket | $0.0043/min | Already integrated. Best latency. |
| AssemblyAI | Universal | ~400ms | 6.6% | Yes, WebSocket | $0.0065/min | Better accuracy, higher cost. 30% fewer hallucinations than Whisper. |
| OpenAI | Whisper Large-v3 | ~500ms | 6.5% | No native streaming | $0.006/min (API) or free (local) | Best accuracy but no real-time API. Self-hosted streaming requires custom endpointing logic. |
| Speechmatics | Ursa 2 | <1s | ~7% | Yes | Custom pricing | Best for on-prem/edge. Supports 50+ languages. |
| Google | Chirp 2 | ~300ms | ~7% | Yes | $0.006/min | Good for multilingual. |

**Recommendation:** Stay with Deepgram Nova-3 for real-time. It is already integrated, has the best latency for conversational AI, and the cost is lowest. If accuracy becomes critical (e.g., medical/legal transcription), consider AssemblyAI as a drop-in swap — same WebSocket pattern.

### Text-to-Speech (TTS)

| Provider | Model | TTFA | Quality | Voice Clone | Price | Self-Host |
|----------|-------|------|---------|-------------|-------|-----------|
| **Cartesia** | Sonic-3 / Sonic Turbo | 40-90ms | Excellent | Yes | $0.03/min, free tier 20K credits | No |
| ElevenLabs | Flash v2.5 | 75ms | Best-in-class | Yes (3s ref) | $5-99/mo tiers | No |
| **Voxtral** (Mistral) | 4B-TTS | 90ms TTFA | Beats ElevenLabs in human eval | Yes (3s ref) | Free, Apache 2.0 | **Yes — 4B params, runs on GPU** |
| OpenAI | gpt-4o-mini-tts | ~100ms | Very good | Steerable via prompt | $0.015/1K chars | No |
| Piper | Various | <50ms | Acceptable | No | Free | **Yes — runs on RPi** |
| Bark | Suno/Bark | ~2s | Good + emotion | Yes | Free | Yes — needs GPU |
| Coqui | XTTS v2.5 | ~500ms | Excellent clone | Yes (6s ref) | Free | Yes — needs GPU |

**Recommendation for Daemon personality voice:**
1. **Production (now):** Cartesia Sonic Turbo for 40ms TTFA — fastest real-time TTS available. Or ElevenLabs Flash for best quality.
2. **Self-hosted (soon):** Voxtral 4B just dropped (March 26, 2026). Apache 2.0, 3-second voice clone, beats ElevenLabs in human evals, 90ms TTFA. Run it on arturito's GPU or MSI. This is the daemon's own voice — no dependency on external services.
3. **Edge/fallback:** Piper for offline/low-latency on devices without GPU. Already in the codebase as fallback.

### Speech-to-Speech (End-to-End)

The best latency numbers in April 2026:
- **GPT-4o Realtime API:** 232ms average. Single model handles audio-in/audio-out — no STT/LLM/TTS pipeline. Responds to tone, pacing, emotion that text transcription strips out.
- **Assembled pipeline (Deepgram + Claude + Cartesia):** ~465ms end-to-end achievable with Vapi optimization.
- **Retell AI:** Targets ~200ms, sub-second consistently.

**How GPT-4o voice works:** A single neural network trained end-to-end on text, vision, and audio. No intermediate text representation. The model "hears" raw audio and produces raw audio. This means it can detect sarcasm, urgency, whispering — things lost in transcription. The Realtime API is WebSocket-based, streams bidirectionally.

**Recommendation:** For daemon personality and emotional resonance, a speech-to-speech model is ideal. But Claude/Gemini don't offer this yet. Current best approach: Deepgram STT -> Claude Opus (for reasoning) -> Voxtral/Cartesia TTS. Total ~500-700ms. Acceptable for conversation.

### Real-Time Voice Infrastructure

| Platform | What It Does | Open Source | Price | Best For |
|----------|-------------|-------------|-------|----------|
| **LiveKit** | WebRTC media server + agent framework | **Yes, fully** | Self-host free, cloud from $0.004/min | Building your own voice pipeline |
| Daily.co / PipeCat | WebRTC + AI agent framework | PipeCat is open | Cloud pricing | Browser/mobile voice apps |
| Vapi | Voice agent platform | No | $0.05/min + model costs | Quick deployment, phone agents |
| Retell AI | Voice agent platform | No | Per-minute | Phone bots, customer service |

**Recommendation:** LiveKit is the answer for daemon. It is fully open-source, self-hostable, has a Python agent framework with pluggable STT/LLM/TTS, handles WebRTC (browser + mobile), and supports both pipeline (STT->LLM->TTS) and direct speech-to-speech models.

**LiveKit Agent pipeline example:**
```python
from livekit.agents import AgentSession
from livekit.plugins import deepgram, openai, cartesia, silero

session = AgentSession(
    stt=deepgram.STT(model="nova-3"),
    llm=openai.LLM(model="claude-opus-4-20250514"),  # or via proxy
    tts=cartesia.TTS(voice="your-daemon-voice"),
    vad=silero.VAD.load(),  # Voice Activity Detection
)
```

---

## 2. Always-Listening Patterns

### How Alexa/Google Home Do It

1. A dedicated low-power DSP chip runs a tiny neural network (~100KB) that only listens for the wake word
2. Main CPU stays asleep — wake word chip draws <1mW
3. On wake word detection, DSP wakes main CPU, which starts streaming to cloud
4. Audio before the wake word is buffered (~2 seconds) so the command is captured
5. Privacy: only post-wake-word audio leaves the device

### Wake Word Engines

| Engine | Runs On | Custom Words | Open Source | Latency | Notes |
|--------|---------|-------------|-------------|---------|-------|
| **Picovoice Porcupine** | ARM Cortex-M, RPi, Android, iOS, Linux | Yes (type-to-train) | Free for personal use | <100ms | Best documented. Cortex-M focus, ESP32 support unclear. |
| **Espressif ESP-SR / WakeNet** | ESP32, ESP32-S3 | Yes ("Hi Lexin", "Hi ESP" free, custom available) | Yes | <200ms | **Native ESP32 support. Best option for daemon hardware.** |
| **microWakeWord** | ESP32-S3 | Yes | Yes | <200ms | Lightweight Inception-based. Built for Home Assistant. Runs on S3-BOX. |
| openWakeWord | Linux, RPi | Yes (text-to-train via Piper) | Yes, Apache 2.0 | ~200ms | **Too heavy for ESP32** (seconds per frame on S3). Great for server/phone. |
| Snowboy (archived) | RPi, Linux | Yes | Yes | N/A | Dead project, still works. |

### Battery Impact of Always-Listening on Mobile

- **Dedicated DSP (Google/Apple):** Both Android and iOS use dedicated low-power audio coprocessors for "OK Google" / "Hey Siri". Battery impact: ~2-5% per day.
- **App-level always-listening:** Running the microphone continuously from an app uses the main CPU. Battery impact: 10-20% per day. Not viable for all-day use.
- **Android foreground service + wake word:** Can use Porcupine/openWakeWord in a foreground service. The wake word model itself is light (~5% battery), but keeping the mic active is the real cost. Android 12+ shows a green dot when mic is active — users will notice.
- **Practical approach:** Don't always-listen on the phone. Use push-to-talk on mobile, and dedicate the ESP32 (always plugged in) as the always-listening node.

### ESP32 as Wake Word Listener

This is the strongest play for daemon hardware:

1. **ESP32-S3** (not the original ESP32) runs Espressif's WakeNet natively
2. Always powered (plugged in or battery with charging)
3. Draws ~100mA while listening — negligible on wall power, ~20 hours on 2000mAh battery
4. On wake word detection: sends signal over WiFi/BLE to phone/server
5. Server starts Deepgram streaming, ESP32 forwards audio
6. Privacy: no audio leaves ESP32 until wake word triggers

**Architecture:**
```
ESP32-S3 (always listening, WakeNet)
    |-- wake word detected -->
    |-- streams audio via WiFi TCP to -->
Server (Deepgram STT -> Claude -> Voxtral TTS)
    |-- audio response via WiFi TCP to -->
ESP32-S3 (plays through I2S speaker)
```

**Hardware needed on ESP32-S3:**
- INMP441 MEMS microphone (I2S, ~$2)
- MAX98357A I2S amplifier + small speaker (~$5)
- Already have: ST7789 display, WiFi

---

## 3. Hardware Form Factors — Lessons from the Graveyard

### What Failed and Why

| Device | Price | What Happened | Lesson |
|--------|-------|--------------|--------|
| **Humane AI Pin** | $699 + $24/mo | Dead. Projector unusable in daylight, overheating, terrible battery, laser projector a gimmick. | Don't invent new interaction paradigms. |
| **Rabbit R1** | $199 | Near-dead. Launched broken. RabbitOS 2 (Sep 2025) was decent but too late. LAM concept was ahead of execution. | Software must work on day 1. |
| **Friend Pendant** | $129 | 1,000 shipped of 3,000 sold. Always-listening pendant that sends "friendly" texts. Creepy. | "Always recording" without clear utility = rejection. |
| **Tab** | $49/mo | Meeting recorder pendant. Records and summarizes. | Single-purpose recorders work when the purpose is clear. |

### What Succeeded

| Device | Price | Why It Worked |
|--------|-------|--------------|
| **Ray-Ban Meta Gen 2** | $379 | Looks like normal glasses. Camera, mic, speakers. All-day battery. People actually wear them. |
| **AirPods** | $179-249 | Already in everyone's ears. Siri integration. Low friction. |
| **Apple Watch** | $399+ | Already on wrists. Siri, health sensors, haptics. |
| **Smart speakers** (Echo, etc.) | $30-100 | Stationary. Always powered. Clear utility (music, timers, smart home). |

### What This Means for Daemon

The failed devices share a pattern: they tried to be a **new thing you carry**. The successful ones are either **things you already carry** (glasses, earbuds, watch) or **things that sit in a room** (speakers).

**Daemon form factor options, ranked by viability:**

1. **Stationary daemon node (ESP32 + mic + speaker + display)** — Like a smart speaker but it is YOUR daemon. Always powered, always listening. Best for home/office. This is the "daemon key" from the business model canvas.

2. **Phone as primary mobile interface** — The Pixel already has mic, camera, GPS, accelerometer. The Android app already exists. Push-to-talk or "Hey Daemon" via software wake word.

3. **Existing wearables as endpoints** — AirPods/earbuds for audio I/O, smartwatch for haptic notifications. The daemon routes to whatever device you are using.

4. **Pendant/wearable (later, maybe)** — Only if there is a clear use case that phone + earbuds cannot serve. A small BLE pendant with a mic could do always-listening if the phone is the compute node. But this is Rabbit R1/Friend territory — proceed with extreme caution.

---

## 4. ESP32 / Microcontroller AI Integration

### What Can Run On-Device (TinyML)

| Capability | On ESP32? | Model Size | Accuracy | Tool |
|-----------|-----------|-----------|----------|------|
| Wake word detection | **Yes (ESP32-S3)** | ~100KB | 95%+ | ESP-SR WakeNet |
| Simple voice commands (up to 200) | **Yes (ESP32-S3)** | ~500KB | 90%+ | ESP-SR MultiNet |
| Keyword spotting | **Yes** | ~50KB | 90% | Edge Impulse + TFLite Micro |
| Sound classification | **Yes** | ~200KB | 85% | Edge Impulse |
| Person detection (camera) | Barely | ~300KB | 70% | TFLite Micro |
| LLM inference | **No** | Too large | N/A | Must use server |

**Edge Impulse** is the practical tool for training custom TinyML models. Upload audio samples, train a CNN, deploy as a C++ library for ESP32. The EON Compiler reduces RAM usage by 37%.

### Current ESP32 Setup + Expansion Path

**What you have now:**
- ESP32 DevKitV1 (not S3 — this matters)
- ST7789 240x240 display (SPI: SCK=27, MOSI=26, DC=33, CS=32)
- HC-SR04 distance sensor (trig=12, echo=13)
- WiFi connected to Pixel hotspot
- MicroPython firmware (russhughes st7789_mpy)
- TCP servers on :8266 (command), :8267 (frame), :8268 (HTTP)

**What to add, in priority order:**

1. **INMP441 MEMS microphone** ($2) — I2S digital mic. Required for voice input. Wiring: SCK=GPIO14, WS=GPIO15, SD=GPIO32 (reassign display CS).
2. **MAX98357A I2S amplifier** ($3) + small 8ohm speaker — Audio output for daemon voice.
3. **BME280 sensor** ($3) — Temperature, humidity, barometric pressure. I2C bus.
4. **IR LED + TSOP38238** ($1) — Send and receive infrared. Control TVs, ACs, any IR device.
5. **WS2812B NeoPixel ring** ($3) — Status indicator, "daemon is thinking" animation.
6. **BLE beacon mode** — Already built into ESP32. Can broadcast presence, trigger automations when you walk near.

**Important: upgrade to ESP32-S3** for voice features. The original ESP32 cannot run WakeNet/MultiNet. The S3 has a dedicated vector instruction set for neural network inference. ESP32-S3-DevKitC-1 is ~$8.

### ESP32 Sensor Mesh

Multiple ESP32s can form a mesh network using ESP-BLE-MESH or ESP-MESH (WiFi):

```
[Living Room ESP32-S3]     [Bedroom ESP32]      [Kitchen ESP32]
  - Mic + Speaker           - Temp/Humidity       - Temp/Humidity
  - Display                 - Motion (PIR)        - IR blaster (AC/TV)
  - Wake word               - Light sensor         - Smoke detector
  - BLE beacon              - BLE beacon           - BLE beacon
         \                       |                    /
          --------- WiFi mesh / BLE mesh ----------
                         |
                   [arturito server]
                   - Deepgram STT
                   - Claude reasoning
                   - Voxtral TTS
                   - Knowledge graph
```

Each node costs $15-25 in parts. They report to the daemon server, which has the intelligence. Nodes are sensors + actuators; the server is the brain.

---

## 5. Multimodal Interaction Patterns

### When to Use Which Modality

| Context | Input | Output | Why |
|---------|-------|--------|-----|
| Hands busy (cooking, driving) | Voice | Voice | No screen interaction possible |
| Quick fact/reminder | Voice | Voice + brief screen flash | Confirm without demanding attention |
| Complex info (schedule, data) | Voice or text | Screen (phone/laptop) | Voice cannot convey tables/lists well |
| Private/public place | Text | Text or haptic | Don't want to talk out loud |
| Ambient awareness | Sensors (motion, presence) | Ambient display, gentle sound | Calm technology — inform without demanding |
| Emergency/urgent | Any | Voice + haptic + visual | All channels for high-priority |

### Calm Technology Principles for Daemon

From the IDEO ambient revolution research and Mark Weiser's original principles:

1. **Technology should require the smallest possible amount of attention.** The daemon display shows a subtle animation when idle — not a notification count.
2. **Technology should inform and create calm.** A gentle pulse on the ESP32 NeoPixel ring when a meeting is in 5 minutes. Not a loud alarm.
3. **Technology should make use of the periphery.** The distance sensor already detects when you approach — the display can wake up and show relevant info only when you are near.
4. **Technology should amplify the best of technology and the best of humanity.** The daemon remembers context so YOU don't have to. It tracks what you were doing across devices so you can resume without friction.

### Practical Multimodal Flow

```
You walk into the room
  -> ESP32 BLE beacon / distance sensor detects presence
  -> Display wakes, shows today's key info (weather, next meeting, pending task)
  -> You say "Hey Daemon"
  -> ESP32 WakeNet triggers, starts streaming audio to server
  -> Deepgram transcribes: "What's on my schedule?"
  -> Claude checks calendar, responds
  -> Voxtral speaks: "You have a call with Luca at 3pm and a grant deadline tomorrow"
  -> Display shows the calendar view
  -> You leave the room
  -> Display dims back to ambient clock/weather
```

---

## 6. Camera as AI Input

### Real-Time Visual Understanding

| Capability | Best Tool | Runs On | Latency | Notes |
|-----------|-----------|---------|---------|-------|
| Object detection | **YOLO26-N** | Phone, ESP32-S3 (barely), any GPU | 5-30ms on GPU | 43% faster CPU inference than YOLO11. Nano variant for edge. |
| OCR (text from camera) | Google ML Kit | Android/iOS on-device | <100ms | Free, on-device. Already available on Pixel. |
| Scene understanding | Gemini 3 Flash | Cloud API | ~500ms | "Describe what you see." Send a frame, get a description. |
| Face detection | MediaPipe | Android/iOS on-device | <50ms | Free, on-device. Can detect but not identify (privacy). |
| Document scanning | Google ML Kit | Android/iOS | <200ms | Receipts, whiteboards, business cards. |

### Privacy Guidelines for Camera

1. **Never always-on camera.** Camera activates only on explicit request ("Daemon, what am I looking at?") or specific trigger (e.g., "scan this receipt").
2. **Visual indicator mandatory.** LED on ESP32, screen indicator on phone. User must always know when camera is active.
3. **Process locally when possible.** YOLO26-N and ML Kit run on-device. Only send to cloud when local models cannot answer.
4. **No persistent storage of camera data** unless user explicitly requests it (e.g., "save this photo").
5. **ESP32-CAM module** (OV2640, $5) could be added for a stationary daemon node, but camera on a desk device is less creepy than camera on a wearable.

### Practical Camera Integration

The Pixel 8 Pro camera is the primary camera input. The Android app can:
1. Capture a frame on voice command
2. Run ML Kit OCR/object detection locally
3. Send to Gemini 3 Flash for complex scene understanding
4. Return results via voice or screen

No need for camera on ESP32 initially. Phone camera is better quality and already exists.

---

## 7. Physical World Integration

### Smart Home Control

| Protocol | What It Controls | Daemon Integration | Notes |
|----------|-----------------|-------------------|-------|
| **Matter** (via Home Assistant) | 750+ certified devices (lights, locks, thermostats, sensors) | REST API to Home Assistant | The standard. Thread/WiFi/BLE transport. |
| **Zigbee** (via Home Assistant + Zigbee2MQTT) | Thousands of devices | Same REST API | Cheap sensors, light bulbs. Needs USB dongle ($15). |
| **IR** (via ESP32) | TVs, ACs, sound systems, projectors | ESP32 IR blaster | Any device with an IR remote. Universal remote. |
| **RF 433MHz** (via ESP32) | Garage doors, older switches, weather stations | ESP32 + RF module | Legacy devices. |
| **WiFi** (direct) | Smart plugs, cameras, newer devices | HTTP/MQTT | Many cheap devices use Tuya protocol — flashable with Tasmota. |
| **BLE** (via ESP32/phone) | Wearables, beacons, some locks | ESP32 or phone BLE | Short range but low power. |
| **RS-485** (via ESP32) | Solar inverters, industrial equipment, stage lighting | ESP32 + MAX485 module | Industrial protocol. Mentioned in daemon canvas. |

### Can Daemon Replace Google Home / Alexa?

**Yes, with Home Assistant as the backbone.**

Home Assistant in 2026:
- 750,000+ active installations
- Fully local voice assistant (Whisper STT + Piper TTS + local LLM)
- Matter/Thread native support
- Wyoming protocol for satellite devices (ESP32-S3-BOX, RPi)
- Android voice client launched March 2026

**Daemon + Home Assistant architecture:**
```
User voice -> ESP32 (wake word) -> arturito server
  -> Claude (intent understanding, reasoning, personality)
  -> Home Assistant REST API (device control)
  -> Response via Voxtral TTS -> ESP32 speaker
```

The daemon is smarter than Alexa/Google Home because:
1. It uses Claude for reasoning, not a simple intent parser
2. It has persistent memory (Qdrant knowledge graph)
3. It knows YOUR context (schedule, preferences, history)
4. It can do multi-step reasoning ("if it's going to rain and the windows are open, close them")

**Willow** is an ESP32-S3-BOX based voice assistant specifically designed as an Alexa/Google Home replacement, working with Home Assistant. Its architecture aligns with daemon's approach.

### Controlling Non-Smart Devices

The ESP32 can control virtually anything:

1. **IR blaster** — Control any TV, AC, sound system. Learn the remote codes, replay them. Projects like OMOTE (open-source universal remote) and ESP 360 Remote show this works.
2. **RF 433/315 MHz** — Garage doors, older light switches, weather stations. Transmit and receive.
3. **Relay modules** — Direct electrical switching. 4-8 channel relay boards ($5) can control lamps, fans, appliances. Wire through ESP32 GPIO.
4. **Servo/motor** — Physically push buttons, turn knobs. Unusual but possible for truly dumb devices.

The ESP 360 Remote ($35, open source) combines IR + RF + temp/humidity/light sensors in one ESP32 board. Worth studying as a reference design.

---

## 8. Recommended Architecture

### Phase 1: Voice-First Daemon (Now - Weeks 1-4)

**Goal:** Natural voice conversation with daemon personality.

Components:
- **STT:** Deepgram Nova-3 (already integrated)
- **LLM:** Claude Opus (already integrated)
- **TTS:** Cartesia Sonic Turbo (40ms TTFA) or ElevenLabs Flash (75ms TTFA)
- **Transport:** Direct WebSocket (already working in browser)
- **Voice Activity Detection:** Silero VAD (open source, runs anywhere)

**Estimated end-to-end latency:** ~500ms (Deepgram 300ms + Claude ~150ms first token + Cartesia 40ms TTFA)

Implementation:
1. Add Cartesia or ElevenLabs TTS to `server/voice.py` (replace the espeak-ng stub)
2. Add TTS streaming endpoint to web API
3. Browser plays TTS audio as it streams in (AudioContext API)
4. Wire voice client to send transcript -> get chat response -> play TTS

### Phase 2: Self-Hosted Voice (Weeks 4-8)

**Goal:** Run voice pipeline without external API dependencies.

Components:
- **STT:** Whisper Large-v3 on arturito GPU (free, offline)
- **TTS:** Voxtral 4B on arturito GPU (free, Apache 2.0, voice clone)
- **Infrastructure:** LiveKit self-hosted (open source, handles WebRTC)

This eliminates per-minute costs and gives full control over the daemon's voice. Clone a voice sample to create the daemon's unique voice identity.

### Phase 3: Hardware Node (Weeks 8-16)

**Goal:** ESP32-S3 daemon node with voice I/O.

Hardware BOM:
| Part | Price |
|------|-------|
| ESP32-S3-DevKitC-1 | $8 |
| INMP441 MEMS mic | $2 |
| MAX98357A I2S amp + speaker | $5 |
| ST7789 1.3" display (reuse existing) | $0 |
| BME280 temp/humidity/pressure | $3 |
| IR LED + receiver | $1 |
| NeoPixel ring (12 LED) | $3 |
| **Total** | **~$22** |

Software stack:
1. ESP-IDF (not MicroPython — need ESP-SR which requires IDF)
2. WakeNet for custom wake word ("Hey Daemon")
3. MultiNet for offline commands (up to 200: "lights on", "what's the temperature", etc.)
4. WiFi TCP streaming to arturito for full AI conversations
5. I2S audio output for TTS playback
6. BLE beacon for presence detection

### Phase 4: Sensor Mesh + Smart Home (Months 4-6)

**Goal:** Multiple daemon nodes throughout a space, unified smart home control.

- Deploy 3-5 ESP32 nodes (mix of S3 for voice, regular for sensors)
- ESP-BLE-MESH or WiFi mesh interconnection
- Home Assistant integration for Matter/Zigbee device control
- IR blasters in rooms with TVs/ACs
- Environmental monitoring (temp, humidity, air quality, light, motion)
- BLE presence tracking (which room is Arthur in?)
- All nodes report to arturito, Claude reasons about the full sensor picture

---

## 9. Key Decisions and Trade-offs

### Build vs. Buy Voice Pipeline

| Approach | Latency | Cost/mo (est.) | Control | Effort |
|----------|---------|----------------|---------|--------|
| Deepgram + Claude + Cartesia (APIs) | ~500ms | $20-50 | Low | Low |
| LiveKit + Whisper + Claude + Voxtral (self-hosted) | ~600ms | $0 (compute only) | Full | Medium |
| LiveKit + Gemini 3 Flash speech-to-speech (when available) | ~300ms | Low | Medium | Low |

**Recommendation:** Start with APIs (Phase 1), migrate to self-hosted (Phase 2). The API approach gets you conversational voice in days. Self-hosted gives you independence and a unique daemon voice.

### ESP32 vs. ESP32-S3

The original ESP32 cannot run WakeNet or MultiNet. For voice features, you must upgrade to ESP32-S3. The S3 has:
- Vector instructions for neural network inference
- More RAM (512KB vs 320KB)
- USB-OTG (no FTDI needed)
- Same price ($8 for dev board)

**Recommendation:** Keep the current ESP32 as a sensor/display node. Get an ESP32-S3 for the voice-enabled daemon node.

### MicroPython vs. ESP-IDF

- **MicroPython** (current): Easy to iterate, good for display/sensor prototyping. Cannot run ESP-SR.
- **ESP-IDF** (C): Required for WakeNet/MultiNet. Better performance. Harder to iterate.
- **Arduino framework**: Middle ground. Some ESP-SR support, easier than raw IDF.

**Recommendation:** Move to ESP-IDF for the S3 voice node. Keep MicroPython on the original ESP32 for display/sensor duties.

---

## 10. Sources

### Voice Pipeline
- [AssemblyAI: Real-Time Speech Recognition APIs 2026](https://www.assemblyai.com/blog/best-api-models-for-real-time-speech-recognition-and-transcription)
- [Deepgram: Best Speech-to-Text APIs 2026](https://deepgram.com/learn/best-speech-to-text-apis-2026)
- [Cartesia Sonic-3: Real-Time TTS](https://cartesia.ai/sonic)
- [Mistral Voxtral TTS (March 2026)](https://mistral.ai/news/voxtral-tts)
- [Voxtral 4B on HuggingFace](https://huggingface.co/mistralai/Voxtral-4B-TTS-2603)
- [LiveKit Agents Framework](https://github.com/livekit/agents)
- [LiveKit Voice Pipeline Docs](https://docs.livekit.io/agents/voice-agent/voice-pipeline/)
- [GPT-4o Voice Mode Analysis](https://medium.com/@FastFedora/an-analysis-of-voice-mode-in-gpt-4o-cc0ab4c8a2c0)
- [OpenAI Audio Model Updates](https://developers.openai.com/blog/updates-audio-models)
- [Best Speech-to-Speech APIs 2026](https://inworld.ai/resources/best-speech-to-speech-apis)
- [Vapi vs LiveKit Comparison](https://modal.com/blog/livekit-vs-vapi-article)
- [Open Source TTS Models 2026](https://apatero.com/blog/open-source-text-to-speech-models-beyond-elevenlabs-2026)
- [Best Open-Source TTS Ranked](https://findskill.ai/blog/best-open-source-tts-2026/)

### Wake Word & Always-Listening
- [Picovoice Porcupine](https://picovoice.ai/platform/porcupine/)
- [openWakeWord GitHub](https://github.com/dscripka/openWakeWord)
- [Home Assistant Voice Chapter 6: On-Device Wake Word](https://www.home-assistant.io/blog/2024/02/21/voice-chapter-6/)
- [Espressif ESP-SR / ESP-Skainet](https://github.com/espressif/esp-skainet)
- [ESP32-S3 Offline Voice Recognition](https://github.com/jasin-jesin/esp32-s3-offline-voice-recognition)
- [microWakeWord for ESPHome](https://github.com/kahrendt/esphome-on-device-wake-word)

### Hardware & Wearables
- [AI Wearables Compared: R1 vs AI Pin vs Pendant](https://www.tomsguide.com/ai/rabbit-r1-vs-humane-ai-pin-vs-limitless-pendant-which-ai-wearable-could-win)
- [AI Gadget Flops of 2025](https://www.everydayaitech.com/en/articles/ai-gadgets-flop-2025)
- [AI Wearables That Actually Work 2026](https://www.humai.blog/ai-wearables-that-actually-work-in-2026-not-another-smartwatch-list/)
- [Rabbit R1 iFixit Teardown](https://www.ifixit.com/News/95474/rabbit-r1-and-humane-ai-pin-teardown-the-beginning-of-a-new-device-category)

### ESP32 & TinyML
- [Voice Command Recognition ESP32 + Edge Impulse](https://www.teachmemicro.com/voice-command-recognition-with-esp32-and-tinyml-using-edge-impulse/)
- [Offline Voice AI on ESP32](https://medium.com/@ojasvaidya17/beyond-the-cloud-how-i-built-an-offline-voice-ai-iot-mission-control-on-an-esp32-2e9d2a24a29c)
- [TinyML Voice Recognition Hardware Showdown](https://www.dfrobot.com/blog-14005.html)
- [ESP-BLE-MESH Documentation](https://docs.espressif.com/projects/esp-idf/en/stable/esp32/api-guides/esp-ble-mesh/ble-mesh-index.html)
- [ESP-MESH Getting Started](https://randomnerdtutorials.com/esp-mesh-esp32-esp8266-painlessmesh/)

### Smart Home & Physical World
- [Home Assistant Matter Integration](https://www.home-assistant.io/integrations/matter/)
- [Matter Protocol 2026 Status](https://matter-smarthome.de/en/development/the-matter-standard-in-2026-a-status-review/)
- [Replacing Alexa with Local Voice Assistant](https://www.xda-developers.com/replaced-alexa-with-local-voice-assistant-doesnt-send-to-any-cloud/)
- [Willow: Open Source Voice Assistant](https://heywillow.io/)
- [Home Assistant Voice Control](https://www.home-assistant.io/voice_control/)
- [ESP32 IR Remote Control](https://www.makerguides.com/esp32-and-ir-remote-interface/)
- [ESP 360 Remote (IR + RF)](https://www.crowdsupply.com/aaelectronics/esp-360-remote)
- [OMOTE DIY Universal Remote](https://hackaday.io/project/191752-omote-diy-universal-remote)

### Vision & Multimodal
- [YOLO26 Real-Time Object Detection](https://blog.roboflow.com/yolo26/)
- [Google ML Kit Object Detection](https://developers.google.com/ml-kit/vision/object-detection)
- [Ambient Computing Revolution (IDEO)](https://edges.ideo.com/posts/the-ambient-revolution-why-calm-technology-matters-more-in-the-age-of-ai)
- [Multimodal AI Agents Architecture 2026](https://kanerika.com/blogs/multimodal-ai-agents/)
