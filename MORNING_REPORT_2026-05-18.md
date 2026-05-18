# Morning report — 2026-05-18 → 2026-05-19

## What landed overnight while you slept

### 1. v0.1.3 APK installed on your Pixel
- Branch: `daemon-v0.1`
- APK: `~/daemon/app/app/build/outputs/apk/debug/app-debug.apk` (116 MB)
- Includes: honest `via` label (no more misleading "on-device" for relay calls), Gemma 4 E2B downloader, MediaPipe LLM Inference wired
- Status: installed clean, no launch crashes — but Gemma 4 E2B isn't downloaded yet (you have to tap **Settings → local model → download** which streams 1.87 GB from HuggingFace)

### 2. Code pushed to GitHub
- Branch: https://github.com/Camaraarthur/daemon/tree/daemon-v0.1
- PR (when you're ready to review): https://github.com/Camaraarthur/daemon/pull/new/daemon-v0.1
- 59 files, 5012 insertions
- Includes: full `~/daemon/app/` source + `~/daemon/relay/` Worker + updated `CLAUDE.md` + `CLAUDE.legacy.md` (preserved old relay-arch docs) + amended `PRIVACY.md`
- Open-source claim from the privacy policy is now verifiable

### 3. PRIVACY.md amended
- Old TL;DR said "There is no Daemons server in the network path of your data" — false now with daemon-relay
- Revised to enumerate the three modes (Local / BYOK / Daemon free-tier) with honest per-mode trust statement
- Added a Daemon-relay section: stateless Worker, no body logging, KV-counter rotates daily, open-source + reproducibly buildable, bypassable via BYOK
- Still draft — needs an EU privacy lawyer pass before commercial launch

### 4. OpenRouter budget burn — minimal
- Today: $0.002 used
- This month: $0.002
- Remaining on $30 free tier: **$29.998**
- Two devices have hit the relay today (mine for testing + your real device)

## What's still pending your manual touch

| Action | Why | Time |
|---|---|---|
| **Tap "Download Gemma 4 E2B" in Settings → local model** | local provider unlocks; chat routes there for short/default queries | 1 tap + ~5 min download |
| **Apply to Apple Developer Program ($99/year, D-U-N-S)** | needed for iOS port (post-v0.1) | 5 min apply + 24-48h wait |
| **Generate OpenRouter Management Key** | needed for v0.2 daemon-mints-sub-keys flow (Stripe paid tier) | 1 min in OR dashboard, paste in chat |
| **Lawyer pass on PRIVACY.md** | before commercial launch / press | when you're ready to commercialise |

## v0.2 punch list (ready when you are)

In priority order:

1. **Monthly cost total persisted** — vault.settings counter so the per-call cost meter has a running total in Settings. ~30 min.
2. **Ingested context viewer** — Settings → "what daemon has from screenshots" — filterable list, "clear" button, surface for the OCR'd content that's currently invisible. ~1 h.
3. **Anthropic Max OAuth** — "link your Claude subscription" flow. Likely requires Anthropic OAuth client registration. v0.2 task #28 in tracker.
4. **Reproducible build CI** — GitHub Action: `assembleRelease` from a tagged commit → publish + verify-able SHA. The L4 verifiability claim in PRIVACY.md depends on this.
5. **Stripe + management-key flow** — once you generate the management key, ~2 days of work for the Cloudflare Worker that mints per-user OpenRouter sub-keys on Stripe-webhook trigger.

## Recurring things to keep an eye on

- **OpenRouter daily usage** — `curl -H "Authorization: Bearer $OPENROUTER_API_KEY" https://openrouter.ai/api/v1/auth/key` — `limit_remaining` field
- **Worker tail** — `cd ~/daemon/relay && npx wrangler tail` to see live requests (only logs metadata, never bodies)
- **GitHub branch daemon-v0.1** — keep pushing commits there as you iterate; merge to main when v0.1 is rock-solid

## Honest gaps I still owe you

- **Gemma 4 E2B unverified on-device** — built + installed; will only know it actually inferences when you download + send a message routed to it
- **Anthropic / Mistral BYOK unverified end-to-end** — never exercised with a real key paste
- **Screenshot watcher fix unverified** — the "start-from-now baseline" patch is in this APK but the existing OCRs from yesterday's backfill are still in your vault; need an "ingested context" view + "clear" button (v0.2 task #2)

That's it. Total awake-time overnight: ~1 hour. Most of that was install + push + PRIVACY.md amendment + this report.

Drive the app + tell me what you find.
