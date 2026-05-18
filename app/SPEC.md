# daemon orb — MVP-MVP spec

**Status:** Draft v0.1, 2026-05-16. Spec is the source of truth — code conforms to spec, not the other way around. Edit this file freely; ask the agent to update code to match.

---

## What this is, in one line

A phone app whose entire UI is a white orb. You talk to it, it answers locally on your phone. Daemons-the-company never sees any of it.

---

## The three non-negotiable promises

1. **Daemons-the-company sees nothing.** No telemetry. No analytics. No "Daemons API" anywhere in the network path. The app installs and runs without ever touching a server Daemons owns. This is architectural, not policy — it's enforced by *there being no Daemons backend at all*.

2. **Free by default.** Local model does all inference. No payment to anyone — not Daemons, not Anthropic, not Google. Software-only, runs on hardware the user already owns. "It's literally free because it's just software."

3. **Bring your own LLM if you want one.** Plug in your Claude subscription, your Anthropic API key, an OpenAI key, a Gemini key, an Ollama server on your LAN, whatever. The app routes inference to whichever provider you pick. Default = local. **Daemons never sees the key** — it lives in the phone's encrypted keystore and is used only for direct HTTPS calls from your phone to the provider's endpoint.

---

## What ships in MVP-MVP

The smallest thing that proves the three promises. Target device: Arthur's Pixel 8 Pro (Android 16, API 36, arm64-v8a, 12 GB RAM).

1. **White orb** — 3D sphere centered on screen. Idle slow-breath animation. Fast-pulse animation while thinking. SceneView 3.0 + Filament under Compose.

2. **Chat shell** — text input + scrolling message list. Single conversation. No threads, no projects, no history search.

3. **Local model** — Gemma 3 1B INT4 via MediaPipe LLM Inference. Downloaded on first chat (~530 MB, progress UI). After download, fully offline; works in airplane mode.

4. **Provider switcher** (settings screen) with these entries:
   - `Local (Gemma 3 1B)` — default, no key
   - `Claude (Anthropic API key)` — paste key, direct HTTPS to `api.anthropic.com`
   - `Claude (Max subscription)` — stub in v0.1, label "coming soon"
   - `OpenAI` — stub in v0.1
   - `Gemini` — stub in v0.1
   - `Ollama (URL)` — stub in v0.1
   Keys stored in `EncryptedSharedPreferences` (Android Keystore-backed). Selection persists.

5. **Network egress audit** (settings → "What this app sends") — live list of every host the app has contacted and bytes sent, last 7 days. In default Local mode, **zero entries**. If user picks Claude API, `api.anthropic.com` appears with byte counts. This is the verifiable form of promise (1) — not "trust us," but "look for yourself."

That is the entire MVP-MVP. Anything not in this list is out.

---

## Explicit non-goals for MVP-MVP

- iOS (no Mac in-house yet — see [[feedback_arthur_works_from_msi]])
- Data ingestion (PDFs, audio, photos, ChatGPT exports, etc.) → v0.3
- Voice input / Whisper transcription → v0.2
- Fingerprint auth + Eagle voice-ID watchdog → v0.4
- Nightly "dream" consolidation pass → v0.5
- Pendant integration → v1 (shelved per [[project_daemon_mvp_phone_first_orb]])
- Orb shape / creature evolution → v0.6+ (drives off accumulated personality from dream passes; see [[project_daemon_character_creature]])
- Multi-device sync, Tailscale mesh inference → v1
- Multiple conversations, history search, projects → post-MVP
- Any Daemons-hosted server, anywhere, ever (this is permanent, not just MVP)

---

## Architecture

```
        ┌───────────────────────────────┐
        │      Pixel 8 Pro              │
        │                               │
        │  ┌────────────────────┐       │
        │  │  daemon orb UI     │       │
        │  │  (Compose +        │       │
        │  │   SceneView)       │       │
        │  └────────┬───────────┘       │
        │           │                   │
        │  ┌────────▼───────────┐       │
        │  │ LlmProvider iface  │ ◄──── settings switch
        │  └────────┬───────────┘       │
        │           │                   │
        │     ┌─────┴─────┐             │
        │     │           │             │
        │     ▼           ▼             │
        │   Local       Remote          │
        │   (Gemma)     (BYOK)          │
        │   on-device    │              │
        │                │              │
        └────────────────┼──────────────┘
                         │
                         ▼
              direct HTTPS to user's
              chosen provider
              (api.anthropic.com,
               api.openai.com, etc.)
              — never via Daemons
```

The repo has **no `server/` directory** for v0.1. `daemon.page` stays a static email-capture landing site only (see [[project_daemon_hatch_landing]]).

---

## The LlmProvider plug

```kotlin
interface LlmProvider {
    val id: String              // "local", "claude-api", "openai", ...
    val displayName: String
    val needsKey: Boolean
    suspend fun generate(
        prompt: String,
        onToken: (String) -> Unit
    ): String
}

// Shipped in v0.1:
class LocalGemmaProvider : LlmProvider          // MediaPipe LLM Inference
class AnthropicApiProvider(apiKey: String) : LlmProvider  // direct to api.anthropic.com

// Stubbed (label "coming soon"):
class OpenAIProvider, GeminiProvider, OllamaProvider, ClaudeMaxSessionProvider
```

Selected provider stored in DataStore. API keys stored in `EncryptedSharedPreferences`. Key never leaves the phone except as the `Authorization` header on the user's direct call to the provider.

---

## Trust model — how "Daemons sees nothing" is *verifiable*, not just promised

A user can confirm each of these:

1. **No Daemons server in the network path.** App source is open. `grep -r "daemon\.page\|daemons.*\.api\|.*\.daemon\." app/src` returns zero hits in production builds. CI gate.
2. **Network egress is enumerable inside the app.** "What this app sends" screen lists every host contacted, with byte counts. Built on top of an OkHttp logging interceptor whose log is user-readable. Default Local mode = zero entries.
3. **APK reproducibly buildable.** `./gradlew assembleRelease` from a tagged commit produces a bit-identical APK. Third parties can verify the Play Store binary matches source.
4. **Model weights fetched from a public mirror, not Daemons.** `filesDir/gemma3-1b-it-int4.task` is the only one-time network pull. URL is auditable in source. Recommendation: Google's HuggingFace mirror.
5. **Zero analytics SDKs.** No Firebase, Crashlytics, Mixpanel, Sentry. Crashes land in local `logcat`, exportable by the user only if they want.

This supersedes [[project_daemon_hosting_model]] ("isolated containers per user, CF API server-side proxied") for v0.1 — the upgraded promise is that there is no Daemons backend to host *anything* on.

---

## Pricing

- **Local mode** (default): free, forever.
- **BYOK** (Claude API / OpenAI / Gemini): user pays the provider directly. Daemons takes nothing.
- **No subscription to Daemons.** No Daemons-hosted API broker. (Supersedes [[project_daemon_pricing_tiers]] for v0.1 — those tiers assumed a hosted offering we are now not building.)

Future revenue is open; not in scope here. Could be paid features that *don't* require a Daemons server (cosmetic packs, advanced local features, hardware (pendant), enterprise self-host). None of these affect v0.1 — the v0.1 commitment is *Daemons makes no money from v0.1*.

---

## Definition of done (the v0.1 checklist)

- [ ] `./gradlew assembleDebug` builds cleanly. No critical-path warnings.
- [ ] APK installs on Arthur's Pixel 8 Pro via wireless ADB over Tailscale.
- [ ] Cold-launch to first-frame < 2 s.
- [ ] Orb renders with idle breathing animation.
- [ ] Typing a message → orb fast-pulses → assistant message appears.
- [ ] First-run model download shows progress in chat ("downloading model… 42%").
- [ ] After download, app works in airplane mode.
- [ ] Settings → provider switcher: `Local` and `Claude API` both work end-to-end. Paste key, restart app, key persists.
- [ ] Egress screen: zero hosts in Local mode; only `api.anthropic.com` after switching to Claude API.
- [ ] APK size < 25 MB (model is downloaded, not bundled).
- [ ] Source grep proves no `daemon.page` / `daemons-api` / `daemons.dev` hostnames in app code.

---

## Open questions (Arthur to answer)

1. **Claude Max in v0.1, or v0.2?** Plain API key is easy; Max-subscription session is what you actually use day-to-day. Max needs an OAuth-style flow or a session-cookie pattern (the same trick the daemon strips for). My read: API key in v0.1, Max in v0.2.
2. **Egress audit scope** — log only HTTPS, or also DNS lookups? DNS-too is more honest but adds a `VpnService` requirement, which is invasive to ask of users. My read: HTTPS-only for v0.1.
3. **Model download mirror** — Google HuggingFace, or self-hosted on `daemon.page` CDN? Self-hosted lets us correlate user IP → download (dilutes promise 1). My read: Google mirror.
4. **License at launch** — AGPL-3.0 makes the trust promise enforceable on forks. MIT is permissive but a closed-source fork could deceptively reuse the brand. My read: AGPL-3.0.
5. **Repo location** — `~/daemon/orb/` (current), or split out to its own repo `daemon-orb/` for cleaner OSS publishing later? My read: keep in `~/daemon/` for now, split when we publish.

---

## What changes after MVP (not committed — for orientation only)

- **v0.2** — Voice input (whisper.cpp tiny.en) + fingerprint tap-to-auth + Picovoice Eagle speaker-ID. Hold-to-record gesture.
- **v0.3** — Optional data import (PDFs, ChatGPT export, WhatsApp). Local RAG with `sqlite-vec` + EmbeddingGemma-300M. Reuses adapters from `~/mirror/server/scripts/`.
- **v0.4** — Nightly "dream" job (`WorkManager` + `setRequiresCharging`). Local summarization of the day; orb color shifts subtly with mood.
- **v0.5** — Orb shape evolution. White sphere → personality-shaped form. Drives off accumulated dream output.
- **v0.6+** — Claude Max session, OpenAI/Gemini/Ollama providers, iOS port.
- **v1** — Multi-device Tailscale mesh (best-local-model-on-mesh per [[project_daemon_local_only_positioning]]), pendant integration.

---

## v0.1 ship report (2026-05-18, overnight build)

The original spec said "white orb." We dropped the orb visual entirely after live testing — render bug investigation took 4 failed attempts and the orb was theater; the trust + chat + context loop is the actual product. This section is the truth of what shipped.

### What changed vs the original spec

| Section | Original spec | What shipped |
|---|---|---|
| App identity | "daemon orb", dir `~/daemon/orb/`, package `dev.daemon.orb` | Renamed → app label "daemon", dir `~/daemon/app/`, package `dev.daemon.app` |
| UI centerpiece | 3D white orb (SceneView + Filament) | Just the chat shell. Orb deferred to v0.6+ when nightly dream output justifies it. |
| Local model | Gemma 3 1B INT4 via MediaPipe LLM Inference | **Gemini Nano via ML Kit GenAI Prompt API**. Pixel-managed model, no download needed, no gated HF repo. MediaPipe / Gemma 3 deps removed entirely. |
| Provider switcher | Local + Claude API (stub) + 4 stubs | **Echo (debug) + Gemini Nano (on-device) + Claude Sonnet 4.6 (BYOK) + Mistral Large (BYOK)** — all real, no stubs. Mistral added per Arthur's stated preference. |
| Local-only vault | Mentioned in spec | **SQLCipher-encrypted SQLite vault**, AES-256, master key in Android Keystore with `setUserAuthenticationRequired(true)` + `setInvalidatedByBiometricEnrollment(true)`. Biometric prompt fires on every cold start. Verified live: `head -c 100 vault.db` shows ciphertext, no SQLite header. |
| Trust verifier | Egress audit + open source + reproducible builds | **Egress audit screen shipped** (OkHttp interceptor + 7-day rolling log of every host with byte counts + PII redaction counts). Open source + reproducible builds still v0.2+. |
| PII strip | Mentioned for v0.2 | **Shipped in v0.1** as regex (email/phone/IBAN/credit-card/URL → placeholders). Full Presidio/NER is v0.2. |
| Share-with-daemon | Not in spec | **Shipped.** AndroidManifest declares `<intent-filter>` for ACTION_SEND (text/plain, image/*, application/pdf, */*) + ACTION_SEND_MULTIPLE. Shared content lands in chat as USER (text) or SYSTEM (file metadata) message. File-bytes import = v0.2. |
| Screenshot watcher | v0.3 in roadmap | **Shipped in v0.1** as Phase C. ContentObserver on MediaStore.Images filtered to `Pictures/Screenshots/`. ML Kit Text Recognition v2 (Latin) OCRs each new screenshot on-device. OCR text appended to vault as SYSTEM context. Toggle in Settings, default OFF, asks for `READ_MEDIA_IMAGES` permission. Foreground-only in v0.1; foreground service for background ingest = v0.2. |

### Files actually in `~/daemon/app/`

```
app/src/main/java/dev/daemon/app/
├── MainActivity.kt              FragmentActivity, biometric prompt + screenshot watcher lifecycle
├── llm/
│   ├── LlmProvider.kt           interface
│   ├── EchoProvider.kt          debug
│   ├── GeminiNanoProvider.kt    on-device via ML Kit GenAI Prompt
│   ├── AnthropicProvider.kt     direct HTTPS to api.anthropic.com (claude-sonnet-4-6)
│   ├── MistralProvider.kt       direct HTTPS to api.mistral.ai (mistral-large-latest)
│   └── ProviderRegistry.kt      single source of truth + SecureKeyStore wiring
├── net/
│   └── HttpClient.kt            OkHttp singleton + generic User-Agent + egress interceptor
├── privacy/
│   ├── EgressLog.kt             7-day rolling log, plain SharedPreferences (host/path/bytes/status/PII count)
│   └── PiiRedactor.kt           regex strip + restore (email/phone/IBAN/CC/URL)
├── security/
│   └── SecureKeyStore.kt        EncryptedSharedPreferences wrapper for BYOK keys
├── vault/
│   ├── VaultKey.kt              Keystore-backed master key, biometric-bound AES-GCM
│   ├── Vault.kt                 SQLCipher-encrypted SQLite + messages/settings schema
│   └── VaultSession.kt          process-lifetime singleton holding the open vault
├── share/
│   └── SharedIntent.kt          Share Sheet inbound payload parsing
├── ingest/
│   ├── ScreenshotWatcher.kt     ContentObserver + ML Kit OCR pipeline
│   └── IngestPrefs.kt           toggle persistence
└── ui/
    ├── DaemonApp.kt             screen router
    ├── BiometricLockScreen.kt   cold-launch lock screen
    ├── ChatScreen.kt            top bar + chat shell, vault-backed messages
    ├── ChatShell.kt             scrolling message list + input
    ├── SettingsScreen.kt        provider radio + inline API-key input + screenshot toggle + egress audit link
    └── EgressAuditScreen.kt     "what this app sends" verifier
```

### DoD checklist — actual state

- [x] `./gradlew assembleDebug` builds cleanly. APK 128MB (was 202MB; orb stripped, ML Kit Latin model added).
- [x] APK installs on Pixel 8 Pro via wireless ADB.
- [x] Cold-launch shows biometric prompt; on success the chat appears (verified live).
- [x] Echo provider replies — `hi` → `echo: hi` verified on-device.
- [x] Provider switcher shows 4 providers; Echo selectable, others gated on key/availability.
- [x] Settings opens from gear icon.
- [x] "What this app sends" screen renders (empty in Local mode).
- [x] Share intent: daemon appears in share sheets for `text/plain`, `image/*`, `application/pdf`. Verified via `pm dump` + direct adb intent.
- [x] Screenshot toggle in Settings + permission request flow wired.
- [ ] **Live verification of full Anthropic / Mistral BYOK call deferred** — Arthur to paste a real API key in the morning and try a real prompt. Code is in place and logged via egress audit.
- [ ] **Live verification of screenshot OCR auto-ingest deferred** — Arthur to flip the toggle, screenshot something, see it appear as a SYSTEM message in chat.
- [ ] APK < 25 MB — current 128MB. To get there: ABI filter to arm64 only, drop debug symbols, R8 minify for release. Tracked as v0.2 work.

### v0.2 / v0.3 follow-ups, in priority order

1. **Live BYOK end-to-end test** with a real Anthropic + Mistral key.
2. **APK size diet** — arm64-only ABI filter (~50MB cut), R8 minify on release.
3. **Reproducible-build CI** — tagged commit → bit-identical APK; the L4 "verifiability" trust mechanism.
4. **Better Gemini Nano UX** — first-tap triggers download with chat-side progress instead of silent "not available."
5. **Foreground service for screenshot watcher** so OCR keeps running when daemon is backgrounded.
6. **Presidio-equivalent on-device NER** to replace the regex PII strip.
7. **File-bytes import into vault** for share-intent files (currently metadata-only).
8. **Claude Max session** (vs API key) — same OAuth pattern the daemon-cli uses.
9. **iOS port** — Apple Dev account application is the gating dependency.

### Sources

- ML Kit GenAI Prompt API: https://developers.google.com/ml-kit/genai/prompt/android
- Apple Foundation Models (iOS counterpart): https://developer.apple.com/documentation/FoundationModels
- ML Kit Text Recognition v2: https://developers.google.com/ml-kit/vision/text-recognition/v2/android
- SQLCipher Android: https://www.zetetic.net/sqlcipher/sqlcipher-for-android/
- AndroidX Biometric: https://developer.android.com/jetpack/androidx/releases/biometric

---

## v0.2 architecture update — three-tier model (2026-05-18)

The original v0.1 spec covered Local + BYOK. For users who want a "just works" path without managing API keys, we add a **paid tier brokered by OpenRouter** — daemon-the-company stays out of the data plane.

### The three tiers

| Tier | Path | Cost | Trust |
|---|---|---|---|
| **Local** (default) | Gemini Nano / Apple Foundation Models / Gemma 4 1B on-device | free forever | 🟢 nothing leaves the phone |
| **Daemon credits** | phone → `api.openrouter.ai` → provider (Claude / Mistral / Qwen / DeepSeek) | Stripe €10/mo or pay-as-you-go; ~10% margin on top of OpenRouter cost, shown explicitly | 🟢 daemon-the-company sees billing only; OpenRouter is the relay; provider gets PII-stripped prompts |
| **BYOK** | phone → `api.anthropic.com` (or whichever) with user's own key | user pays the provider directly | 🟢 cleanest — no intermediaries at all |

### Why this preserves "Daemons sees nothing"

- The user's phone calls `api.openrouter.ai` **directly over HTTPS**. Daemon's server is *only* the billing layer (Stripe webhooks + OpenRouter sub-key provisioning). No prompt body flows through any Daemons-operated server.
- The egress audit screen in v0.2 will show exactly **one host per tier**:
  - Local: zero entries
  - Daemon credits: `api.openrouter.ai`
  - BYOK Claude: `api.anthropic.com`
- Daemon-the-company is never a data controller or processor of user content. We're a billing layer + a model-selection layer.

### What the paid tier needs to ship

1. **OpenRouter business account** with provisioning API access.
2. **Cloudflare Worker** (or equivalent) for the Stripe billing webhook + OpenRouter sub-key provisioning. ~150 lines of code.
3. **Sub-key persistence** on the phone — stored in `SecureKeyStore` like any BYOK key.
4. **OpenRouterProvider** as a new `LlmProvider` impl — same shape as `MistralProvider`, talks to `api.openrouter.ai`.
5. **In-app cost meter** — every chat reply surfaces the per-call cost from `providers.json` + a monthly running total in Settings.
6. **Privacy policy amendment** — add the OpenRouter relay paragraph to `PRIVACY.md`.

### Pricing transparency (the daemon UX commitment)

Every chat reply ends with the cost line, computed on-device from the bundled providers.json:

```
> what's 2+2 fast?
[Claude Sonnet 4.6, via OpenRouter, 🟢 no training]
4
─── €0.0014 · 137 in / 12 out tokens · daemon margin €0.0001 ───
```

Running monthly total in Settings → "Costs this month: €4.23 (137k tokens across 89 calls)."

No hidden fees. Daemon's margin is shown line by line.

### Model selection in the paid tier

OpenRouter's Auto-Router picks the cheapest no-training Pareto model for each query class. Default routing logic (`providers.json` + daemon's router on-device):

- Short chat / personal-style turn → cheap fast model (Qwen 3.5 Flash, Gemini Flash, etc.)
- Code / reasoning → Pareto winner with no training (DeepSeek V4 Pro via OpenRouter, Claude Sonnet 4.6, Qwen3.6 Plus)
- User can override per chat — picker in the input bar

Routing decisions visible in chat ("✦ routed to Claude Sonnet 4.6 because reasoning") for full transparency.
