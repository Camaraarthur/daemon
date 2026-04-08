# Daemon — Vision v1

> **Status:** locked.
> **Date:** 2026-04-08
> **Read this first** before architecture.md, positioning.md, or any code change. This is the WHAT.

## 1. The thesis, in one sentence

**Daemon is the convenient core that every personal AI mesh is built on top of.**

The chat is the start, not the product. Vibe coders pick daemon because building on top is faster than not. The infrastructure underneath every "AI that does something on my stuff" is already done: secrets vault, scheduler, notifications, sub-page hosting, device map, file/app awareness, persistent memory, paths registry, semantic file search. The agent has all of these as primitives in its system prompt without the user having to set anything up.

## 2. The "what does it do" answer

For developers using Claude Code today: **"Your Claude Code, on every device you own. One memory, one agent, reaches everything."**

For everyone else (the second seduction): **"An AI that searches your computer, runs in the background, and pings you when it's done — on hardware you own, with data that never leaves you."**

The bridge between the two: most non-devs don't have an always-on machine. The pendant (codename Honest Puck) is the $80–120 wearable that solves this, and can also serve as the device that hosts the user's data and runs the always-on agent loop.

## 3. The four primitives every agent gets for free

These are NOT features. They are constraints. Every agent loop on daemon has access to these without the user having to wire anything up. The agent's system prompt enumerates them automatically.

### 3.1 Per-device daemon mesh — SHIPPED ✅

Every device the user owns runs the same daemon binary, exposes the same protocol, joins the same conversation. Tools dispatch to whichever device has the capability. Already shipped: Steps 1–8d locked the relay/device split, the streaming-into-DB → device migration, the cross-process memory unification, the daemon protocol bedrock.

### 3.2 Two-layer secrets vault — IN PROGRESS

The agent calls `get_secret(name)`. Daemon checks two stores:

1. **User vault** (device-side): per-user encrypted store at `~/.daemon/store.db`. The user adds their own API keys ("paste your OpenAI key here"). Encrypted at rest with a key derived from the user's password (Argon2id) plus an OS keychain entry on each device. Synced across the user's own devices via gossip (encrypted in transit).
2. **Platform broker** (relay-side): a small set of secrets daemon-the-company provides for free, shared across all users with per-user quota. Brave Search is the first one — every authenticated user gets unlimited search out of the box. Later: Resend free tier, Gemini key with shared quota, etc. The "API broker" model. v2 adds payment / tier-gated platform keys.

The agent can't tell the difference. It just calls `get_secret("brave_search_api_key")` and gets a value. The platform secrets are listed in the system prompt by NAME so the agent knows what's available.

The vibe coder hook: a vibe coder writing an app on top of daemon NEVER has to:
- Manage their own secrets file
- Sign up for a Brave Search account
- Implement encryption-at-rest
- Build a per-user quota system

They just call `get_secret("brave_search_api_key")` and it works.

### 3.3 Scheduler / cron primitive — NOT YET BUILT

The agent calls `schedule(name, cron, prompt)` to register a recurring task. Stored in `~/.daemon/store.db`. node-cron in `cli/daemon.mjs` fires it. When fired, the daemon device wakes the relay's agent loop with the prompt as a fresh user message in a thread tagged with the schedule name. Result lands as a notification (see 3.4) or as a chat message in the schedule's tagged thread.

Agent tools: `schedule`, `list_schedules`, `cancel_schedule`. The user can also list/cancel schedules via the chat UI.

This is the "agent that runs while you sleep" primitive. Without it, daemon is reactive only. With it, every use case from morning briefings to job-hunt scrapers to inbox copilots becomes a one-line `schedule()` call.

### 3.4 Native notification protocol — NOT YET BUILT

The agent calls `notify(title, body, target_devices?)`. Daemon routes via gossip → device receivers → web push (VAPID) on the daemon-web UI. Future: APNs for iOS, FCM for Android, native OS notifications for Tauri desktop, BLE haptic for the pendant.

v1 = web push only (works on every device with a browser). v1.5 = native iOS App Intents + APNs silent push, native Android FCM, native desktop OS notifications.

**Critical: NOT Telegram.** Telegram is an integration vibe coders can add later. Daemon owns the notification primitive natively. Notifications are curated, per-device-routable, designed by the user.

## 4. Three more primitives the agent uses without setup

### 4.1 `<username>.daemon.page` hosting — IN PROGRESS

Every user gets a public-facing subdomain. The agent can deploy a static page, an iframe, a file share, a small dashboard, anything HTML/JS/JSON. The agent calls `host_publish(path, content, visibility)`. Public files served at `<user>.daemon.page/<path>` are world-readable. Private files at `<user>.daemon.page/private/<path>` are gated by Cloudflare Access (zero-config zero-trust login).

**Critical security**: hosted content is STATIC. It cannot be a backdoor into the user's devices. There is no write-path from the public internet to the user's daemon device through the hosting layer. Path traversal must be blocked via `realpath`, not `startsWith` (architecture critic finding M-4 — gets fixed in the same commit).

### 4.2 File-in-chat clickable links — NOT YET BUILT

When the agent finds the file the user asked for, the chat UI renders it as a real clickable button that opens with the OS default app. The user doesn't need to know `~/Downloads/2024-q3-budget.xlsx`; they ask for "the budget thing I downloaded last week" and click. Implementation: a per-device loopback `/open?path=` endpoint the daemon device exposes when running on the same machine as the browser.

### 4.3 Semantic file search — NOT YET BUILT (hookup only — server already exists)

The existing `file-search` MCP server (`/home/arthur/file-search/server.py`, Gemini Embedding 2 over the user's local files) becomes a daemon tool exposed via `cli/daemon.mjs`. Agent calls `semantic_search(query)` and gets ranked file paths. Cost: ~$1 to embed 100k file titles, ~$50 for full contents. Opt-in.

This is the **"way better Finder"** Arthur saw demoed online. It's the strongest hook for non-developer users — most people have a folder of stuff and no good way to search it.

## 5. The meta-primitive: the system-prompt scaffolding

Every agent turn starts with a generated block in the system prompt that enumerates EVERY primitive available to the user, with current state:

```
## Daemon environment

You are running on daemon. The user is "{username}" (project_id={N}).

### Devices online (mesh)
- arturito-linux-x64 (Linux x64, primary, currently running this conversation)
- iphone-15-pro (iOS, idle, last seen 2m ago)
- pendant-ab12cd (ESP32-S3 BLE, paired to iphone-15-pro)

### Tools available on this device (arturito-linux-x64)
- bash, read_file, write_file, edit_file, list_files, glob, grep, lint_file, device_info
- semantic_search (Gemini embeddings, 23k files indexed)

### Memory blocks (always loaded — call update_memory_block to edit)
- project (382/4000 chars): "Daemon - personal AI agent platform..."
- recent (700/4000 chars): "Last session: shipped Step 8d + memory unification..."
- paths (1897/4000 chars): see content below
- gotchas, open_threads, preferences (empty)

### Secrets (names only — call get_secret(name) to retrieve)
- User vault: openai_api_key, github_pat, gemini_key (3 secrets)
- Platform broker: brave_search_api_key (free unlimited), gemini_embedding_key (shared quota)

### Schedules (active)
- morning_briefing: cron "0 8 * * *" → "Summarize unread emails + git activity"
- pendant_battery_check: cron "*/30 * * * *" → "Check pendant battery, alert if <20%"

### Hosting (this user's public page)
- Subdomain: arthur.daemon.page
- Public files: 3 (index.html, demo.html, screenshot.png)
- Private files: 1 (private/dashboard.html)

### Primitives you can call directly without asking
- notify(title, body) — pushes to all the user's connected devices
- schedule(name, cron, prompt) — register a recurring task
- host_publish(path, content, visibility) — publish to <user>.daemon.page
- get_secret(name) / set_secret(name, value) — encrypted vault
- semantic_search(query) — search the user's files
- remember(category, content) / recall(query) — Letta-style memory
- ... and the regular bash/read_file/etc tools above

### Hard rules
1. Auto-remember important paths and resources the user mentions. Use `remember(category="path", ...)` and update the `paths` memory block. Never re-investigate a path you (or any prior session) have already found.
2. When a tool exists for the user's request, use it. Do not write a script when there's a primitive.
3. Secrets are NEVER printed back to the user, NEVER logged, NEVER committed.
4. The user's data lives on their devices. Never upload it to the relay.
```

The block has a hard token budget (≤ 2k tokens — architecture critic finding C-3). Sections that are empty (no schedules, no secrets, no devices) are omitted. Sections that are full are summarized (e.g., "23k files indexed" not the full file list).

## 6. The user's data sovereignty model — locked

| What | Where it lives | Who can read it |
|---|---|---|
| Chat messages | Device's local SQLite (`~/.daemon/store.db`) | Only the user's devices |
| Memory blocks + facts | Same | Same |
| User secrets vault | Same, encrypted at rest | Only the user's devices, only after unlock |
| Files | The user's actual file system | Only the user (the daemon device runs as the user) |
| Hosted public pages | Relay (because the public internet has to fetch them) | The world (per the user's explicit `host_publish(visibility="public")`) |
| Hosted private pages | Relay | The user, gated by Cloudflare Access |
| Auth (email + password hash) | Relay | Relay only |
| Device pubkeys + tokens | Relay | Relay only |
| Platform broker secrets | Relay env vars | Relay only |
| Per-user platform-secret usage logs | Relay | Relay (for quota), user can request export |

The relay holds **NO** application content. Period. Auditable from the source code. Verifiable via packet capture. The four-pillar privacy / security / reliability / scaling model from architecture.md §1 is the constraint, this is the data layout that satisfies it.

## 7. The hardware story — the pendant ("Honest Puck v3.2")

Production hardware (located at `/media/arthur/CA2247E02247D05D/projects/pendant` on arturito's SSD). NOT in the daemon repo. Has its own ARCHITECTURE.md and SKiDL netlist.

Spec headline:
- 28 mm round PCB inside 35 mm round case (silicone sleeve, polycarbonate shell)
- USB-C male plug as both lanyard attachment and charge port
- ESP32-S3-WROOM-1 brain
- IM73D122 PDM mic (NOT I²S — PDM via the I²S peripheral in PDM mode)
- 4× red privacy LEDs in the same `HONEST_MIC_PWR` net as the mic VDD, gated by a Si2301BDS PMOS load switch on `MIC_ENABLE_N` (IO4, active-low). When IO4 is HIGH, mic and LEDs are both off. When LOW, both are on. **There is no software path that can light the LEDs without powering the mic, or vice versa.** This is the privacy guarantee the patent is built around.
- 4 tactile side buttons: BTN_MAIN (IO0), BTN_PROG1 (IO1), BTN_BATT (IO9), BTN_PROG2 (IO14)
- SK6805 12-pixel ring (separate from the privacy LEDs) on IO8 via SN74HCT1G125 level shifter, powered by TPS61023 5V boost enabled by IO7
- W25N02KV 2 Gb QSPI NAND flash for audio buffering when offline
- TP4056 charger + TPS63031 buck-boost 3V3 regulator + 400 mAh LiPo
- BLE 5 (built into ESP32-S3) — pairs to the user's phone, the phone forwards to daemon

Two modes:
1. **Push-to-talk command**: hold BTN_MAIN → IO4 LOW → mic + LEDs on → audio streams over BLE → release → IO4 HIGH → off. Daemon parses the short command, acts.
2. **Recording mode**: long-press BTN_MAIN (>1.5s) → mic + LEDs locked on → continues until next BTN_MAIN press toggles off. Used for meeting recording, voice memo → action, the active-Plaud-Note pattern.

The walking glowing red ad on people's chests is intentional. People see it, ask, the wearer says "it's my daemon," they look it up, the privacy story sells itself.

Firmware lives at `firmware/pendant/` (renaming from `firmware/mic-necklace/`). PlatformIO + Arduino framework + NimBLE-Arduino. The state machine is small. The BLE GATT service is one custom service with two characteristics (AudioStream notify + Control write/notify). Most of the code is pinmap, debounce, and audio chunking.

## 8. The hardware story — the daemon-key (full carrier)

Separate, larger product. Not v1. Lives in the daemon repo on arturito at `daemon_v0.kicad_*` files (Orange Pi 3B carrier, full I/O — Audio + WS2812B + IR + RS-485 + CC1101 + display + joystick + ADC + GPIO expander). For the always-on home server form factor. Targets homelabbers and power users. Ships as an Armbian image + a case + a USB-C cable. v1.5 / v2 product.

## 9. Things daemon will NOT do (hard NO list)

These keep the wedge sharp. Adding any of them weakens the pitch.

- **No Telegram bandaid.** Telegram is an integration. Daemon owns notifications natively.
- **No "AI agent that runs in our cloud."** The agent runs on the user's device. Period.
- **No replacement for Cursor / Cline / Aider.** They own the IDE surface. We don't fight there.
- **No real-time low-latency voice.** Relay hop kills the latency budget.
- **No browser-operating agents like Manus.** Different tech stack, not our fight.
- **No native iOS local execution.** Apple's restrictions. iOS is a thin client to the user's other devices.
- **No enterprise multi-tenant SaaS at Snowflake scale.** Not the bet.
- **No marketing led with "privacy" or "AGPLv3."** Privacy is the closer, not the opener.
- **No marketing led with "AI agent."** Crowded category, you lose on polish. Lead with "Claude Code on every device."
- **No daemon-key Pi mentioned in v1 marketing.** Sounds like a Kickstarter. Park it until there's a real SKU.

## 10. The roadmap — what ships in what order

### v1 (next 4 weeks)

Primitives (one commit each, all this session or the next):
1. Vision + positioning docs locked ← THIS COMMIT
2. Encrypted user secrets vault (device-side, password-derived KDF, recovery phrase)
3. API broker / platform secrets (relay-side, Brave Search as first entry)
4. Scheduler primitive (node-cron in cli/daemon.mjs, agent tools)
5. Native notifications (web push first, agent tool `notify()`)
6. System-prompt scaffolding refactor (with hard token budget per arch critic finding)
7. Reverse-direction gossip (Step 7d — required for "messages on every device")
8. File-in-chat clickable links
9. Semantic file search wired as a daemon tool
10. `<username>.daemon.page` hosting primitive (with realpath() path traversal fix)
11. iOS app skeleton (already shipped via parallel agent — TestFlight-ready)
12. Pendant firmware (correct hardware target — ESP32-S3 + IM73D122 PDM + IO4 PMOS gate + 4 buttons + SK6805 ring)
13. Reproducible builds CI (already shipped via parallel agent)

Open issues from architecture critic to fix during the above:
- C-1: drop `project_memory` table seeding from the relay
- C-2: BYOK detection (the TODO in chat/route.ts)
- C-3: system prompt token budget (covered by primitive #6)
- M-4: hosting endpoint path traversal (covered by primitive #10)
- M-5: memory block append silent truncation (return `truncated:true`)
- M-7: project ownership check on memory tool dispatch
- m-11: drop `conversation_memory` table (unused)

### v1.5 (weeks 4–8)

- Tauri Linux desktop app (deferred from v1 — needs polish)
- Tauri Mac + Windows desktop app
- Native iOS app shipped to TestFlight worldwide (10k testers)
- Android app updates (notification routing, BLE pendant pairing)
- "Build me a tool" workflow (agent generates a script + cron registers it on the device)
- Daemon-key (Orange Pi 3B carrier) Armbian image as a real downloadable
- Multi-device per-tool routing rules ("filesystem tools always go to my-laptop")
- Cloudflare Access wired for `/private/*` paths

### v2 (weeks 8+)

- E2EE between user devices (Noise XX, libsodium box, sealed sender)
- Platform secrets paid tier with quota gating
- Overnight emulator-driven app building (Android emulator + iOS Sim on arturito)
- Multi-relay failover (two regions, silent fallover)
- Mac App Store / Microsoft Store distribution
- iOS native sideload via Web Distribution (EU only)
- Daemon-to-daemon messaging (cross-user with consent)

## 11. Hard rules for everything daemon ships

1. **No user data on the relay.** Ever. In any form the relay can read. (Already enforced after Steps 8a–8d.)
2. **Auto-remember important paths and resources.** Any path the user mentions that the agent had to investigate to find gets written to memory. The next session never re-investigates. Surface in the `paths` memory block, always loaded into the system prompt.
3. **Single source of truth via the system prompt scaffolding.** The agent learns about every primitive automatically. The user never has to "configure" the agent — they just use it.
4. **No Telegram, no SMS, no Twilio, no third-party comms.** Daemon owns notifications natively.
5. **No exec on the relay.** All tool execution dispatches to the user's devices.
6. **No primitive ships without an end-to-end test.** Every commit has a test command in the message + verified output.
7. **Every primitive is callable by the agent without setup, automatically discoverable via the system prompt.** A user with zero configuration should still get devices, paths, secrets, schedules, hosting, and notifications.
8. **Every primitive has a recovery story.** Lost password → BIP-39 recovery phrase. Lost device → re-pair via QR. Lost everything → encrypted backup tier (opt-in, off by default).
9. **No half-shipped primitives.** Either it's wired into the system prompt and the agent uses it, or it isn't shipped.
10. **The vibe coder rule: every primitive should make a vibe-coded app trivially easier than not using daemon.** If a vibe coder could build their thing faster against raw APIs than against daemon, the primitive isn't done.

---

This document is the source of truth. It supersedes anything in SPEC.md, architecture.md, or CLAUDE.md that contradicts it. When the contradiction is found, the doc gets updated, not the code.
