# daemon — privacy policy

**v0.1 · effective 2026-05-18** (revised — daemon-relay tier added)

This is a draft. A real EU privacy lawyer should review before commercial launch. The language below is honest about what daemon is, by design.

---

## TL;DR

Daemon is designed so we — Daemons, the company — **don't read your prompts, your responses, or your imported data.** Three modes:

1. **Local** (default) — your prompts run on a model on your phone. Nothing leaves the device.
2. **BYOK** — your prompts go straight from your phone to a provider (Anthropic, Mistral, OpenRouter, etc.) you've chosen, using your own key. Daemons is not in the network path.
3. **Daemon free tier (beta)** — your prompts pass through a Daemons-operated Cloudflare Worker at `relay.daemon.page`, which adds Daemons' OpenRouter key (we pay the bill) and forwards to OpenRouter. The Worker is **stateless** (no prompt logging, no body persistence), **rate-limited** per device, and **open source** (`github.com/Camaraarthur/daemon/tree/daemon-v0.1/relay`). This is the only mode where Daemons-operated code touches your prompt in transit — and it doesn't read them.

The code is open-source. The app shows you every byte it sends in **Settings → "What this app sends"**. Our Android builds are reproducibly buildable from public source.

---

## What we collect

### Things that DO touch our infrastructure

These are the only things Daemons-the-company is the data controller of:

- **Email address** if you sign up on daemon.page for early access or release notifications. Stored only to send you those notifications. We use it for nothing else. Deletion: email us / use the unsubscribe link in any email.
- **App-store distribution metadata** that Google Play and Apple App Store collect when you download daemon. We see only aggregate, anonymized statistics from those stores (e.g., total downloads, crash count per OS version). We have no access to your personal account on those stores.

That's the complete list.

### Things that NEVER touch our infrastructure

- Your chat messages, prompts, conversation history, or any reply you've ever received from a model.
- Anything you import into daemon: PDFs, photos, screenshots, voice recordings, ChatGPT/Claude/WhatsApp exports, contacts, calendar.
- API keys you paste in to enable BYOK providers (Anthropic, Mistral, Google, etc.). These live in your phone's hardware-backed secure storage and are never transmitted to Daemons.
- Your fingerprint / Face ID / biometric data. Daemon uses your phone's biometric system to unlock a local encryption key; we never see the biometric itself.

We don't collect any of this because we have no place to put it: daemon has no Daemons-operated backend that user content can flow into.

---

## What happens with your data

### Local (default) mode

All inference runs on your phone. Your prompts go to a local model (e.g., Gemini Nano on Pixel 8 Pro). Nothing leaves the device. No bytes ever travel to Daemons, to a model provider, or to anyone else.

### BYOK (bring-your-own-key) mode

If you paste an API key for a third-party provider (e.g., Claude, Mistral, Google) and switch daemon to use it, then:

1. Daemon strips personally identifying information from your prompt on-device, replacing it with placeholders (e.g., `{{PERSON_1}}`, `{{EMAIL_1}}`). This is *pseudonymization*, not full anonymization — the placeholders can be reversed on your device but not by the provider.
2. The pseudonymized prompt is sent **directly from your phone to the provider's API endpoint** over HTTPS. The request includes your API key (read from secure storage), no user-identifying headers, and a generic User-Agent.
3. The provider's response comes back to your phone. We re-insert the original placeholder values locally so you see the real names.
4. **Daemons-the-company is not in the network path.** The HTTPS connection is between your phone and the provider you chose.

When you use BYOK, you are *choosing* to share your (pseudonymized) data with that provider, under their terms. We facilitate the connection; we do not see what passes through it.

### Daemon free tier (beta) — the relay

For users who don't want to manage their own API key, daemon offers a free tier where Daemons-the-company pays the upstream cost (via our OpenRouter account). The path is:

```
your phone → relay.daemon.page (Cloudflare Worker) → api.openrouter.ai → model provider
```

The Cloudflare Worker is **in the data plane during transit** — there's no way to avoid that when sharing a single API key across many users. We mitigate honestly:

- **The Worker is stateless.** It receives the request, adds the `Authorization` header, forwards the body to OpenRouter unmodified, and pipes the response back. It does **not** read, parse, log, or persist your prompt or the response. Source: `github.com/Camaraarthur/daemon/blob/daemon-v0.1/relay/src/index.js` (~100 lines).
- **The only Worker-side state is a per-device daily request counter** (rotates every 24 h via Cloudflare KV TTL). The counter key is a random UUID stored in your app's sandbox; it is not tied to your identity, phone number, IMEI, or any device-derived identifier.
- **PII is still stripped on-device before the Worker sees the request.** Same pseudonymization as BYOK — `{{PERSON_1}}` etc.
- **Open-source + reproducibly buildable.** Anyone (you, EU regulators, journalists) can verify the running Worker matches the public source.
- **Bypassable.** If you want the strict "no Daemons-operated server in the path" guarantee, switch to BYOK — your phone calls the provider directly with your own key.

This is a step down from the strict "Daemons sees nothing in the path of your data" promise. The accurate version for the free tier is: **"Daemons-the-company operates a stateless relay that doesn't read your prompts."** We say it this way so you can decide what level of trust matches the value you're getting.

You can see every host daemon has talked to, with byte counts, in **Settings → "What this app sends"**. In Local mode this list is empty.

---

## Storage

All daemon data on your phone — chats, imports, settings, API keys — is encrypted at rest using AES-256. The encryption key is generated inside your phone's hardware secure element (Trusted Execution Environment / StrongBox on Android; Secure Enclave on iOS) and never leaves it. The key is gated by your biometric: unlocking requires fingerprint or Face ID.

If you change your biometric enrollment, the key is permanently invalidated and the database becomes unreadable. You re-enroll, daemon re-derives — but old data is gone. This is intentional.

We do not back up your daemon data to any Daemons-operated server. We do not sync between your devices via Daemons. (Future versions may offer Tailscale-mesh sync between *your own* devices, peer-to-peer — still without Daemons in the path.)

---

## Telemetry, analytics, crash reporting

None. There is no Firebase, Crashlytics, Mixpanel, Sentry, or any analytics SDK in daemon. Crashes are written to your phone's local `logcat`; if you want to file a bug, you choose to share them.

---

## How you can verify

- Source code at `github.com/<TBD>/daemon-orb`, AGPL-3.0 licensed.
- `grep` the source for `daemons.dev`, `daemon.page`, or any Daemons-operated hostname: returns zero matches in the production build path.
- Android APKs are reproducibly buildable: `./gradlew assembleRelease` from a tagged commit produces a bit-identical APK to the one on Google Play.
- iOS builds: because Apple's App Store encrypts binaries (FairPlay), we publish a TestFlight build alongside each tagged release that you can verify matches source.

---

## Your rights

Under GDPR, you have the right to access, correct, delete, port, and restrict processing of your personal data. Since Daemons holds no personal data of yours except possibly your email, the practical scope is small:

- **Access:** email us; we'll send you whatever we have on file (your email row, if any).
- **Deletion:** email us or unsubscribe; we delete your email from our list.
- **All other rights:** apply automatically — there's nothing to access, correct, port, or restrict.

For your *daemon data on your phone*: that's literally your data. You can export the encrypted database, copy it between your own devices, or delete the app to wipe it. We can't help you with that data because we don't have it.

---

## Children

Daemon is for users **16 and older**. If you're under 16, please don't use it.

---

## Changes

If we change this policy, we'll update the date at the top and post a notice on `daemon.page/privacy`. Material changes (e.g., starting to collect something we didn't before) will trigger a notification in-app before they take effect.

---

## Contact

For privacy questions: **privacy@daemon.page**

Daemons, the company: TBD entity, Italy.
