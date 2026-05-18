# daemon — privacy policy

**v0.1 · effective 2026-05-17**

This is a draft. A real EU privacy lawyer should review before commercial launch. The language below is honest about what daemon is, by design.

---

## TL;DR

Daemon runs entirely on your phone. We — Daemons, the company — never see, receive, store, or process the content of your chats, your imported data, or your AI-model outputs. There is no Daemons server in the network path of your data. We can't be breached, subpoenaed, or leak — because there's nothing on our side to breach.

That's not a promise we ask you to trust. It's a property of the software you can verify yourself: the code is open-source, the app shows you every byte it sends, our Android builds are reproducible from public source.

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
