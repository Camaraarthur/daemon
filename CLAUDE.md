# Daemon — Development Guide

**As of 2026-05-18, the v0.1 product is in `~/daemon/app/`.** The pre-existing
relay/device-split architecture described in `CLAUDE.legacy.md` has been
**superseded** for v0.1+ by the architecture in `~/daemon/app/SPEC.md`. Read
that spec before making any structural decisions.

The high-level change in one sentence: the new daemon has **no Daemons-operated
server** in the network path of user data — the trust promise is "Daemons-the-
company sees nothing, by architecture not policy." See
`feedback_daemon_three_promises` in memory for the full posture, and
`project_daemon_gdpr_positioning` for the legal anchor (Article 25 by design).

## Where the v0.1 product lives

```
~/daemon/app/                        ← the v0.1 Android app
├── SPEC.md                          ← source of truth — read first
├── PRIVACY.md                       ← v0 privacy policy draft (lawyer review pending)
├── settings.gradle.kts              ← rootProject.name = "daemon-app"
├── app/
│   ├── build.gradle.kts             ← applicationId = "dev.daemon.app"
│   └── src/main/
│       ├── AndroidManifest.xml
│       └── java/dev/daemon/app/
│           ├── MainActivity.kt
│           ├── llm/                  ← provider abstraction + 4 impls
│           ├── net/                  ← OkHttp + egress interceptor
│           ├── privacy/              ← PII regex strip + EgressLog
│           ├── security/             ← SecureKeyStore (Keystore-backed)
│           ├── vault/                ← SQLCipher + biometric-gated master key
│           ├── share/                ← Share-with-daemon intent parsing
│           ├── ingest/               ← ScreenshotWatcher + ML Kit OCR
│           └── ui/                   ← Compose UI (chat, settings, egress audit, biometric lock)
```

Other dirs in `~/daemon/` (cli/, web/, desktop/, android/, mobile/, etc.) are
the **legacy relay+device-split** codebase. Treat them as parked — they don't
ship in v0.1 and may be removed in v0.2 once the new architecture stabilises.
**Do not add new features there.** Do not propagate the old patterns into the
new app. If you find yourself thinking "the relay should X," stop — the new
architecture has no relay.

## The three architectural non-negotiables

(from `feedback_daemon_three_promises` in memory)

1. **Daemons-the-company sees nothing.** No telemetry, no analytics, no
   Daemons backend in the network path. The v0.1 repo has **no `server/`
   directory**. Implementation: provider keys live in EncryptedSharedPreferences,
   BYOK calls go direct phone → provider via OkHttp, generic User-Agent.
2. **Free by default.** Local model (Gemini Nano via ML Kit GenAI on Pixel
   8 Pro+, Apple Foundation Models on iOS 26+, Gemma 4 1B via LiteRT-LM as
   universal fallback in v0.2). No subscription to Daemons.
3. **BYOK pluggable.** Claude Sonnet 4.6, Mistral Large, OpenAI, Gemini —
   direct HTTPS from phone with user's own key. Daemons never sees the key
   or the traffic.

## The trust spine (L1–L4)

(architecture detail in `project_daemon_zero_trust_architecture` in memory + SPEC.md)

| Layer | What | Where |
|---|---|---|
| L1 — data at rest | AES-256 SQLCipher vault + biometric-gated Keystore master key | `vault/` |
| L2 — local compute | Gemini Nano via ML Kit GenAI Prompt API (Pixel-side) | `llm/GeminiNanoProvider.kt` |
| L3 — anonymized egress | PII regex strip on outbound, direct HTTPS, no Daemons hop | `privacy/PiiRedactor.kt` + `net/HttpClient.kt` |
| L4 — verifiability | Open source + in-app egress audit screen + reproducible builds (v0.2) | `ui/EgressAuditScreen.kt` |

## Build + install (the only commands you need day-to-day)

```bash
cd ~/daemon/app
./gradlew assembleDebug             # produces app/build/outputs/apk/debug/app-debug.apk

# Reach the Pixel — via mDNS-discovered ADB name (preferred when on local wifi):
DEV='adb-37271FDJG00BFP-IeR05B._adb-tls-connect._tcp'
adb -s "$DEV" install -r app/build/outputs/apk/debug/app-debug.apk
adb -s "$DEV" shell am force-stop dev.daemon.app
adb -s "$DEV" shell am start -n dev.daemon.app/.MainActivity

# When mDNS isn't available (different network), use Tailscale IP:port —
# Wireless debugging shows the current port on the Pixel:
# Settings → Developer options → Wireless debugging → IP address & Port
# Then: adb connect 100.126.71.26:<port>
```

## Rules

- **Read `~/daemon/app/SPEC.md` first.** It defines what's in scope for v0.1+.
- **Never introduce a Daemons-operated server** for user content. The v0.1 architecture commitment is permanent (see `feedback_daemon_three_promises`).
- **All user content stays in the SQLCipher vault.** No plain SQLite for messages, API keys, imports, OCR output. Use `Vault.appendMessage` / `Vault.setSetting`.
- **All outbound HTTPS goes through `HttpClient.get(context)`** so it's logged by the egress interceptor.
- **PII goes through `PiiRedactor`** before any BYOK call. Restore placeholders on-device before the user sees the response.
- **Biometric is the auth boundary.** Never bypass `VaultSession.isUnlocked` to render content from the vault.
- **No analytics SDKs.** Ever. Firebase, Crashlytics, Sentry — none of them. Crashes go to local `logcat`.
- **Match the existing toolchain** (`gradle/libs.versions.toml`) when adding deps. Don't bump major versions without verifying the build still passes.
- **iOS port** (when it lands, post-Apple-Dev-account): different code, same architecture. Swift + RealityKit shell, Apple Foundation Models for local, Keychain for keys, SQLCipher works on iOS too.

## Useful pointers

- v0.1 ship report (what actually shipped vs the spec) — bottom of `~/daemon/app/SPEC.md`
- Privacy policy first draft — `~/daemon/app/PRIVACY.md`
- Memory: `feedback_daemon_three_promises`, `project_daemon_mvp_phone_first_orb`, `project_daemon_gdpr_positioning`, `project_daemon_local_only_positioning`
- Legacy architecture (relay + ws-server + cli daemon.mjs, no longer shipping) — `CLAUDE.legacy.md`
