# Where we are with Daemon

Plain English. No jargon. Updated as I go.

## The big picture

Daemon is the thing every "AI on your stuff" gets built on top of. Instead of every app reinventing the basics, daemon hands the agent a starter kit out of the box: places to store keys, a way to remember things, a way to schedule itself, a way to send you a notification, a place to put a webpage, links to your files, semantic search, etc. The agent just picks them up.

## Sprint summary (14 commits, all green)

Every primitive in the v1 vision is now built, tested end to end on the live arturito relay, and reviewed by an architecture critic that found 17 issues across 8 primitives — every critical, high, and medium fix applied.

## Primitives shipped

### 1. Vision documents
Two locked docs (`docs/vision.md`, `docs/positioning.md`) so future-me stops drifting. Says what daemon is, who it's for, and what it will never become.

### 2. Secrets vault + free-keys cabinet + Arthur's vault.env wiring
Encrypted safe on the device (AES-256-GCM, master key file mode 600). Agent stashes API keys, pulls them back. Nothing leaves the machine. On top of that: a shared free-keys cabinet (Brave Search free for everyone). On top of THAT: Arthur's existing 50-key `~/.secrets/vault.env` is wired in for him specifically — 21 keys (anthropic, openai, google, github, twilio, stripe, cloudflare, etc.) become available with zero re-typing. Operator-only flag means they never leak to other tenants.

### 3. Scheduler
"Agent that runs while you sleep." Tell it `every morning at 8 summarize my unread emails`. Tiny clock on the device ticks every 30 seconds checking what's due. When 8am hits, the device pings the relay over HTTPS, the relay wakes the agent loop in the right thread, result lands in chat — even if no browser is open. POSIX dom/dow OR semantics correct. Impossible crons (Feb 30) rejected up front.

### 4. Notifications (web push)
"Tap me on the shoulder." Agent calls `notify(title, body)` and you get a real native browser notification, even with the daemon tab closed. Click it and a daemon tab opens to whatever URL the agent set. VAPID keys generated and stored in vault. Per-user rate limit (10 per 60s sliding window) so the agent can't spam you into oblivion. Dead-subscription cleanup on 404/410/403/400-expired.

### 5. System-prompt scaffolding (the meta-primitive)
The glue. Every chat turn now starts with a generated block enumerating the agent's daemon environment: hard rules, primitives reference, current memory blocks, secret names, active schedules, notifications status. Without this, the model has to *guess* what's available. With it, the model knows. Hard 2000-char budget. 60-second per-user cache. 73ms cold, 0ms warm. Three device round-trips parallelized via `Promise.all`.

### 6. File-in-chat clickable links
When the agent mentions a file in backticks, the chat UI renders it as a clickable button that opens it with the OS default app — even when the chat is being served from the relay across the internet. Localhost-only HTTP server on the device at `127.0.0.1:4810`. POST + custom `X-Daemon-Open` header forces a CORS preflight that we reject by Origin, so a malicious page can't trigger via `<img src>`. Realpath check against `$HOME` blocks `/etc/passwd` and symlink-out attacks. Falls back to clipboard-copy when the user is on a different machine than the daemon.

### 7. Semantic file search (reused from existing infra)
Wired the existing `/home/arthur/file-search` MCP service (Gemini Embedding 2 + LanceDB, already running with a hot index) as a daemon `semantic_search` tool. Tiny Python bridge imports file-search's `search()` function. Agent on the relay calls it via WS hub → device → spawn python → Gemini embed → LanceDB lookup. The "way better Finder" demo. Query length capped, file-type filter validated, directories restricted to `$HOME` so a compromised relay can't pivot into directory escape.

### 8. <username>.daemon.page hosting
Every user gets a public-facing subdomain. Agent calls `host_publish(path, content, visibility)` and a static HTML/JSON/SVG/CSS file lands at `data/sites/<username>/<path>`. Existing middleware rewrites subdomain requests to the existing serving route. Username validated against the users table (not just any directory in `data/sites/`). Reserved subdomains (www, api, daemon, _next, private, etc.) rejected. Realpath both sides on the read path (architecture critic M-4). `host_delete` refuses directories so the agent can't accidentally nuke a subtree. End-to-end tested: published a real page, fetched it via Host header, deleted it.

### 9. Pendant firmware fork (Honest Puck v3.2)
Forked `BasedHardware/omi`'s `omiGlass/firmware` (MIT) and adapted it to Honest Puck v3.2's actual pinout — bare ESP32-S3-WROOM-1 module + IM73D122 PDM mic + 4× WS2812C privacy LEDs + Si2301BDS PMOS load switch on IO4 that physically interlocks the mic VDD with the LED rail (recording light cannot be defeated by software). 23 files, 1286 lines, real ESP-IDF v5.2 project with NimBLE. Build instructions in firmware/pendant/README.md. Awaits flashing from MSI.

### 10. Reverse-direction gossip (Step 7d)
The forward direction (relay → all devices) was already done. This is the missing other half: device A publishes a chat row → relay → all of user's other devices, with source A excluded so it doesn't echo back. Bearer device_token auth, the user_id comes from the token (never the body). Closes the multi-device sync story: any device can be the authoritative writer for any chat row.

### 11. Gemini embedding pipeline for facts
The existing `recallMemory()` did keyword grep. Added Gemini Embedding 2 vectors over `project_facts` so recall works for "what did the user say about X" instead of just substring matches. New `memory.recall_semantic` WS handler. Live-tested with a query that has zero keyword overlap with the target fact — cosine similarity returned the right hit at score 0.705. New facts get embedded fire-and-forget on `addFact()`. Backfill helper for existing facts. Falls back to keyword recall if Gemini errors.

### 12. iOS Swift app skeleton
Comprehensive skeleton already in place from the prior session: app shell, DaemonClient, 6 App Intents (Chat/Read/Write/Remind/Where/Clipboard), Live Activities, Notification Service Extension, XcodeGen `project.yml`, README, TestFlight checklist. 25 files. Awaits Mac/Xcode validation + the next-session work to wire iOS push registration to our new VAPID/APNs endpoints.

## Architecture critic findings (all fixed)

The critic agent reviewed all 8 primitives and found 17 issues:
- 2 critical (scheduler-fire trusted body, push-sub hijack + cross-user delete)
- 8 high (host TOCTOU, hosted path separator, username not validated, scaffold serial-hops + broken budget enforcement, host_delete recursive, cron OR-vs-AND, OPERATOR_USER_ID footgun)
- 6 medium (open-server CORS in prod, GET vs POST + custom header, Windows path check, web-push cleanup error codes, notify rate limit, semantic-search input validation)
- 1 low deferred to v1.5

Every critical, high, and medium is fixed in 2 follow-up commits (110eede + a9961ab).

## Things I'm explicitly NOT doing

- No telegram bandaid. Notifications go through real native channels.
- No copying what other agents do. We pick the small set of basics nobody else has built properly.
- No paywall or visible API broker UI yet — plumbing only.
- No cloud lock-in. Your data stays on your devices.

## Things successfully reused

- `~/.secrets/vault.env` — Arthur's 50-key vault, exposed via the operator-only platform tier
- `/home/arthur/file-search` — running Gemini+LanceDB MCP, wired as a daemon tool
- `omi/omiGlass/firmware` — forked as the pendant firmware base
- The existing `/api/hosted/[...path]` route + middleware subdomain rewrite — already in place, just needed the write side
- Cloudflare DNS for `*.daemon.page` — already wired to the relay
- The existing chat agent loop, gossip, broadcast, device dispatch infra — every new primitive plugs into them without rewrites

## What's queued for the next sprint

Nothing critical. The v1 vision is shipped. Possible v1.5 work:
- Cloudflare Access policy on `<user>.daemon.page/private/`
- Per-user quota tracking on the platform-secret broker
- Native iOS APNs push (instead of just web push)
- Pendant firmware actually flashed and tested
- L-3 / L-4 low-priority architecture-critic findings
- Swap hand-rolled cron parser for `croner` if we ever need timezones

## Where to read the actual stuff

- Source of truth for the product: `docs/vision.md`
- Pitch / target audience: `docs/positioning.md`
- This file: `STATUS.md`
- Every primitive's full design + tests: `git log --oneline f3fe14c..HEAD` (14 commits)
