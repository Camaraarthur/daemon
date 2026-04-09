# Where we are with Daemon

Plain English. No jargon. Updated as I go.

## The big picture

Daemon is the thing every "AI on your stuff" gets built on top of. Instead of every app reinventing the basics, daemon hands the agent a starter kit out of the box: places to store keys, a way to remember things, a way to schedule itself, a way to send you a notification, a place to put a webpage, links to your files, semantic search, etc. The agent just picks them up.

We're building those basics one by one.

## What's done (shipped + committed in this sprint)

### 1. Vision documents
Two locked docs (`docs/vision.md`, `docs/positioning.md`) that say what daemon is, who it's for, and what it will never become. Future-me stops drifting.

### 2. The secrets vault + free-keys cabinet + Arthur's vault.env
A tiny encrypted safe on your computer (AES-256-GCM, master key file, mode 600). The agent stashes things in it ("here's my OpenAI key, remember it") and pulls them back later. Nothing leaves your machine.

On top of that, a shared free-keys cabinet: ask for `brave_search_api_key` and if you don't have your own, daemon hands you ours, free.

**On top of THAT**, Arthur's existing 50-key `~/.secrets/vault.env` is now wired in for him specifically: 21 keys (anthropic, openai, google, github, twilio, stripe, cloudflare, etc.) become available to his daemon agent automatically, with zero re-typing. They're flagged operator-only so they never leak to other tenants on the same daemon instance. Each is just one catalogue line + a relay restart.

### 3. The scheduler
The "agent that runs while you sleep" piece. You tell it: "every morning at 8, summarize my unread emails." Daemon writes that down, and a tiny clock inside the device ticks every 30 seconds checking what's due. When 8am hits, the device pings the relay over HTTPS, the relay wakes the agent loop in the right thread, and the result lands in your chat — even if no browser is open. Tested with 6 cron patterns + lifecycle tests. End to end.

### 4. Notifications (web push)
The "tap me on the shoulder" piece. The agent calls `notify(title, body)` and you get a real native browser notification, even with the daemon tab closed. You click it and a daemon tab opens to whatever URL the agent set. Cryptographic VAPID keys generated and stored in the vault, full pipeline wired, the relay's `/api/notifications/vapid-key` endpoint serves the public key to browsers that want to subscribe.

### 5. The system-prompt scaffolding (the meta-primitive)
The glue. Every chat turn now starts with a generated block enumerating the agent's daemon environment: hard rules, primitives reference, current memory blocks, secret names, active schedules, notifications status. Without this, the model has to *guess* what's available. With it, the model knows. Strict 2000-char budget so it doesn't bloat context. Live-tested: 22 secrets enumerated for Arthur, 1265 chars used, 30ms latency.

### 6. File-in-chat clickable links
When the agent mentions a file in backticks (the existing convention), the chat UI now renders it as a clickable button that opens the file with the OS default app — even when the chat is being served from the relay across the internet. The trick: a tiny localhost-only HTTP server on the daemon device at `127.0.0.1:4810` with a single `/open?path=...` endpoint that realpath-checks against the user's home, then spawns `xdg-open`. 9/9 path-safety unit tests pass, including `/etc/passwd` rejected, symlink-out rejected, CORS preflight verified, evil origin doesn't leak. If the user is on a different machine than their daemon device, the click falls back to copying the path to clipboard.

### 7. Semantic file search wired as a daemon tool
The "way better Finder" demo. We didn't build this — we **reused** the existing `/home/arthur/file-search` MCP service that was already running with a hot Gemini Embedding 2 + LanceDB index. Wrote a tiny Python bridge (`cli/semantic-search-helper.py`) that imports file-search's `search()` function, exposed as a `semantic_search` tool in `daemon.mjs`. End-to-end test: agent on the relay calls `semantic_search("daemon scheduler primitive cron")` → ws hub → device → spawn python → Gemini embed → LanceDB lookup → JSON results back to chat. Side fix: daemon-device.service was missing the vault.env env file, so it couldn't reach Gemini. Fixed.

### 8. <username>.daemon.page hosting primitive
Every user gets a public-facing subdomain. The agent calls `host_publish(path, content, visibility)` and a static HTML/JSON/SVG/CSS file lands at `data/sites/<username>/<path>`. The middleware rewrites subdomain requests to `/api/hosted/[...path]` which serves them. End-to-end tested: published a real `hello.html`, fetched it via Host header, listed it, deleted it. Path traversal attempt rejected at the segment scan. Fixed the architecture critic's M-4 finding (`startsWith` → realpath both sides) in the same commit.

## What's running in the background right now

### 9. Pendant firmware fork (parallel agent)
Forking the omi `omiGlass/firmware/` (MIT, ESP32-S3, BLE audio) and adapting it to Honest Puck v3.2's actual pinout. The pendant uses ESP32-S3-WROOM-1, IM73D122 PDM mic, 4× WS2812C privacy LEDs, and a Si2301BDS PMOS load switch on IO4 that physically interlocks the mic VDD with the LED rail (recording light cannot be defeated by software). Agent has produced: pinout header, honest_mic component, honest_ui component (buttons + LEDs), mostly-finished BLE component, NOTICE crediting upstream. About to commit.

### 10. Architecture critic review (parallel agent)
Reviewing all 9 commits from this sprint for real bugs. Specifically auditing: scaffold.ts perf cliffs, host-tools.ts TOCTOU on the realpath check, web-push private key exposure, platform-secrets operator-only leakage, scheduler fire-endpoint auth, open-server CORS, semantic-search shell-meta safety. Will return a punch list of concrete fixes I'll apply before continuing.

## Things I'm explicitly NOT doing

- No telegram bandaid. Notifications go through real native channels.
- No copying what other agents do. We pick the small set of basics nobody else has built properly.
- No paywall or visible API broker UI yet — plumbing only.
- No cloud lock-in. Your data stays on your devices.
- No new code without leveraging what exists. Two parallel research agents told me what to reuse from this machine and what to fork from open source. I'm acting on both.

## What's queued after the agents return

- **Architecture critic findings** — fix critical/high before adding more primitives
- **Reverse-direction gossip** (#37) — finishes the multi-device sync story
- **Gemini embedding for facts** (#16) — turns memory recall from keyword grep into semantic match
- **iOS app skeleton** (#48) — long parallel task, probably another background agent

## Things that already exist and we successfully reused

- `~/.secrets/vault.env` — Arthur's 50-key vault, now exposed to his daemon agent through the operator-only platform tier
- `/home/arthur/file-search/server.py` — running Gemini+LanceDB MCP, wired as a daemon tool
- `~/.claude/projects/-home-arthur/memory/` — auto-memory system Claude Code already maintains
- `daemon-web.service` + `daemon-device.service` — both already deployed via systemd
- The existing `/api/hosted/[...path]` route + middleware subdomain rewrite — was already in place, just needed the write side
- Cloudflare DNS for `*.daemon.page` — already wired to the relay

## Where to read the actual stuff

- Source of truth for the product: `docs/vision.md`
- Pitch / target audience: `docs/positioning.md`
- This file: `STATUS.md`
- Recent commits: `git log --oneline -12` from `~/daemon`
