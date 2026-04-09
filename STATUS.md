# Where we are with Daemon

Plain English. No jargon. Updated as I go.

## The big picture

Daemon is the thing every "AI on your stuff" gets built on top of. Instead of every app reinventing the basics, daemon hands the agent a starter kit out of the box: places to store keys, a way to remember things, a way to schedule itself, a way to send you a notification, a place to put a webpage, links to your files, etc. The agent just picks them up.

We're building those basics one by one.

## What's done (shipped + committed)

### 1. Vision documents
Two short locked docs (`docs/vision.md`, `docs/positioning.md`) that say what daemon is, who it's for, and what it will never become. Future-me stops drifting.

### 2. The secrets vault + free-keys cabinet
A tiny encrypted safe on your computer. The agent can stash API keys ("here's my OpenAI key, remember it") and pull them back later. Nothing leaves your machine — even if someone copies the file, they can't read it without a second key file that lives only on your computer.

On top of that, a shared free-keys cabinet: ask for "brave_search_api_key" and if you don't have your own, daemon hands you ours, free. Every agent gets web search out of the box. Same call works for both layers — the agent never knows the difference.

### 3. The scheduler
The "agent that runs while you sleep" piece. You tell it: "every morning at 8, summarize my unread emails." It writes that down in a list and a tiny clock inside daemon ticks every 30 seconds checking if anything is due. When 8am hits, it pokes the agent and the result lands in your chat — even if no browser is open. Tested end to end with 6 different cron patterns.

### 4. Notifications (web push)
Daemon can now actually tap you on the shoulder. The agent calls a `notify(title, body)` button and you get a real native browser notification — even with the daemon tab closed. You click it and a daemon tab opens to whatever URL the agent set. Generated the cryptographic keys that prove notifications are coming from us, wired the whole pipeline, restarted the live website, tested the public-key endpoint. The "let users actually turn it on" UI button is small and lives v1.5 — the plumbing is done.

## What I'm building right now

### 5. The system prompt scaffolding (the meta-primitive)

This is the glue. Every time the agent wakes up to answer something, it should already know what its toolkit looks like — what secrets exist, what schedules are running, what's in memory, whether notifications are on. Without this, the agent has to *guess* that "schedule" or "get_secret" exist and *guess* what you've already told it. Wasteful and bad.

What I just wired up: a small builder that, on every chat turn, fetches the current state from the device + relay and prepends a tidy block to the system prompt:

```
## Daemon environment

### Hard rules
1. Use the primitives. Don't write a script when there's a tool.
2. Auto-remember important paths the user mentions.
3. Secrets never get printed/logged/committed.
4. The user's data lives on their devices.

### Primitives you can call directly
- notify, schedule, get_secret/set_secret, remember/recall, ...

### Memory blocks (already loaded)
- project (382/4000 chars): "Daemon - personal AI agent platform..."
- paths (1897/4000 chars): ...

### Secrets (names only)
- User vault: openai_api_key, github_pat
- Platform broker: brave_search_api_key

### Schedules (active)
- morning_briefing: cron "0 8 * * *" → "Summarize emails"

### Notifications: ACTIVE
```

Strict 2000-character budget so it doesn't bloat the model's context. Empty sections drop. Long sections get truncated with "(N more — call list_* to see all)". Wired into both flavors of the agent loop. Build is green.

**What's left for #5:** end-to-end test against a real chat (curl /api/chat with a token, watch the system prompt arrive populated) → commit.

## What's next after the scaffolding

In rough order:

### 6. Sub-page hosting
Let the agent build you a tiny webpage at *yourname*.daemon.page without you setting up a server. "Make me a dashboard." "Host this thing you just generated."

### 7. File-in-chat clickable links
When the agent finds a file on your computer, the chat should show a real button you click to open it. Right now it just prints the path.

### 8. Semantic file search as a built-in tool
Wire up the file-search service (already exists separately on this machine) so any daemon agent can find your files by meaning, not just by name. The "way better Finder" demo.

### 9. The pendant firmware
The wearable mic necklace on the SSD ("Honest Puck v3.2"). ESP32-S3 + PDM mic + 4 privacy LEDs. Hardware is real, schematic is read, the firmware is what's missing.

## Things I'm explicitly NOT doing

- No telegram bandaid. Notifications go through real native channels.
- No copying what other agents do. We pick the small set of basics nobody else has built properly.
- No paywall or visible API broker UI yet — plumbing only.
- No cloud lock-in. Your data stays on your devices.

## Weird stuff I had to figure out

- The pendant was on the SSD, not the server's main drive. Took a few wrong turns to find it.
- The cron parser broke at first because `*/N` inside a `/* ... */` comment ended the comment early. Renamed to "slash-N" in the docstring.
- VAPID notification keys had to land in the relay's env file (`vault.env`) so the systemd service auto-loads them on restart.
- TypeScript made me cast the WebPush key to `Uint8Array<ArrayBuffer>` because Next 16 ships stricter buffer types than upstream `lib.dom.d.ts`.

## Where to read the actual stuff

- Source of truth for the product: `docs/vision.md`
- Pitch / target audience: `docs/positioning.md`
- This file: `STATUS.md`
- Recent commits: `git log --oneline -8` from `~/daemon`
