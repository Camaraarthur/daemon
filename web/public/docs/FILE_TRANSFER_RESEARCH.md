# Daemon File Transfer System — Deep Research
*v1 — 2026-04-01 — Arthur Camara*

**Goal:** Make file transfer between phone, laptop, watch, and any device seamless and instant. Better than AirDrop, better than WhatsApp self-messaging, better than Google Drive. And smarter — because daemon sees what you share and acts on it.

---

## Table of Contents

1. [The Problem](#1-the-problem)
2. [How Existing Solutions Work and Fail](#2-how-existing-solutions-work-and-fail)
3. [Protocol Deep Dive](#3-protocol-deep-dive)
4. [Android Share Sheet Dominance](#4-android-share-sheet-dominance)
5. [Clipboard Sync](#5-clipboard-sync)
6. [Security Architecture](#6-security-architecture)
7. [The AI Angle — What Makes Daemon Better](#7-the-ai-angle)
8. [Per-Platform Requirements](#8-per-platform-requirements)
9. [Recommended Architecture](#9-recommended-architecture)
10. [Build Plan](#10-build-plan)

---

## 1. The Problem

Arthur messages himself on WhatsApp to transfer files between devices. Millions of people do this. Why?

**Every existing solution has a fatal flaw:**
- AirDrop: Apple-only, requires proximity, no Android
- Google Quick Share: Spotty, requires both devices awake, Bluetooth discovery is slow, 30ft range limit
- Google Drive: Requires sign-in, upload wait, storage limits, UI friction
- WhatsApp self-message: Compresses images, disconnects desktop randomly, not built for this
- Bluetooth: 2-3 MB/s max, pairing dance, unreliable
- USB cables: Physical tethering, connector chaos (USB-C, micro-USB, Lightning)
- Email to self: Attachment limits, slow, wasteful

**What people actually want:**
1. Share something on phone -> it appears on laptop in <2 seconds
2. Copy text on laptop -> paste on phone
3. No login flows. No pairing dances. No "searching for devices..."
4. Works when on the same WiFi. Works when on different networks. Works globally.
5. Files aren't stored on some cloud server forever

---

## 2. How Existing Solutions Work and Fail

### 2.1 Apple AirDrop

**Protocol stack:** mDNS discovery -> AWDL (Apple Wireless Direct Link) -> TLS 1.2 mutual auth -> HTTP file transfer

**How it actually works:**
1. Sender broadcasts via mDNS/DNS-SD over the AWDL interface looking for AirDrop service instances
2. AWDL is a proprietary peer-to-peer Wi-Fi protocol (not mesh) — devices join an AWDL cluster and talk directly. Based on Wi-Fi, not Bluetooth
3. For each discovered device, sender establishes HTTPS connection and performs mutual TLS authentication using Apple ID certificates
4. File transfer happens over this encrypted direct Wi-Fi link
5. AWDL itself provides NO encryption — all security is in the TLS layer above

**What works:** Instant when both devices are Apple. Zero configuration. Fast (WiFi Direct speeds).
**What fails:** Apple-only ecosystem lock. AWDL has been shown vulnerable to MitM, DoS, and tracking attacks (USENIX Security 2019). EU regulators forced Apple to deprecate AWDL in favor of open Wi-Fi Aware standard in iOS 26. Contact-only mode leaks phone number hashes that can be brute-forced (PrivateDrop, USENIX 2021).

**Lesson for daemon:** The UX is the gold standard. Zero-config, instant discovery, fast transfer. But the protocol is proprietary garbage. We can do better with open standards.

### 2.2 Google Quick Share (formerly Nearby Share)

**Protocol:** BLE discovery -> Wi-Fi Direct or Wi-Fi Aware for data -> Falls back to WebRTC or cloud relay

**How it works:**
1. BLE (Bluetooth Low Energy) for initial device discovery and authentication
2. Establishes Wi-Fi Direct or Wi-Fi Aware (NAN) link for actual transfer
3. Can also use cellular/internet connectivity for devices further apart
4. Supports up to 8 simultaneous recipients

**Speeds:** ~20 MB/s over Wi-Fi Direct, up to 100 MB/s over direct Wi-Fi in ideal conditions
**Range:** ~30 feet via BLE/Wi-Fi Direct. Unlimited via cloud relay.

**What works:** Cross-platform (Android + Windows + Chrome OS). No Apple dependency.
**What fails:** Discovery is slow (5-15 seconds of "searching..."). Requires both devices to have screens on. Windows app is buggy and frequently disconnects. The "contacts" visibility system is confusing. Samsung's Quick Share and Google's Quick Share were separate, then merged, creating user confusion.

**Lesson for daemon:** BLE discovery is too slow for "instant" feeling. The cloud relay fallback is the right idea — don't limit to local network.

### 2.3 KDE Connect

**Protocol:** TLS + SFTP over local Wi-Fi. mDNS/UDP broadcast for discovery.

**How it works:**
1. Devices on the same LAN discover each other via UDP broadcast
2. Manual pairing required (one-time PIN confirmation)
3. File transfer via SFTP (SSH File Transfer Protocol)
4. Also provides: clipboard sync, notification mirroring, remote input, media control

**Platforms:** Linux, Windows, macOS, Android

**What works:** Open source (GPL). Feature-rich — clipboard sync, notification mirroring, remote input. Very reliable once paired. Active community.
**What fails:** LAN-only — doesn't work across networks. No iOS support. Setup requires both devices on same WiFi. No relay/cloud fallback. Transfer speeds limited by SFTP overhead.

**Lesson for daemon:** The feature set is exactly right (clipboard + files + notifications + remote control). But the LAN-only limitation is a dealbreaker. Daemon already has Tailscale for cross-network connectivity.

### 2.4 LocalSend

**Protocol:** Custom REST API over HTTPS. Multicast (224.0.0.0/24) for discovery. Self-signed TLS certificates per device.

**How it works:**
1. Device generates self-signed TLS certificate on first run
2. Discovery via multicast UDP on the LAN (default group 224.0.0.0/24, chosen because some Android devices reject other multicast groups)
3. One party sets up an HTTPS server
4. File transfer via `POST /api/localsend/v2/upload`
5. Session cancellation via `POST /api/localsend/v2/cancel`
6. Device fingerprinting via SHA-256 hash of certificate (HTTPS) or random string (HTTP)
7. Fallback: sender can create an HTTP server and share a URL for browser-based download

**Platforms:** Windows, macOS, Linux, Android, iOS (Flutter-based, all from one codebase)

**What works:** Truly cross-platform including iOS. No account required. No internet required. Encrypted. Open source (MIT). Very popular — actively maintained as of 2026.
**What fails:** LAN-only, no relay. Discovery uses multicast which is unreliable on some networks (corporate WiFi, VPNs). No clipboard sync. No AI/intelligence layer.

**Lesson for daemon:** The REST API approach is smart and simple. The self-signed cert per device is a good pattern for zero-config encryption. The multicast discovery fallback to URL sharing is clever. But we need to go beyond LAN.

### 2.5 Syncthing

**Protocol:** Block Exchange Protocol (BEP) over TLS. Global Discovery + Local Discovery + Relay servers.

**How it works:**
1. **Local Discovery:** UDP broadcast/multicast every 30 seconds on LAN
2. **Global Discovery:** Announcement to global discovery servers every 30 minutes
3. **Relay System:** TURN-like relay for NAT-piercing. TLS end-to-end even through relay (relay can't see data). Uses TCP with JoinRelayRequest/SessionInvitation protocol.
4. File sync is continuous — watches directories and syncs changes
5. Written in Go, single binary

**What works:** Bulletproof sync engine. E2E encrypted even through relays. Decentralized — anyone can run discovery/relay servers. Handles conflicts intelligently.
**What fails:** It's a sync tool, not a transfer tool. The mental model is wrong for "send this file to my laptop now." It syncs folders, not individual files. Setup requires configuring shared folders on both sides. No share sheet integration.

**Lesson for daemon:** The relay architecture is excellent. The idea that relay servers are untrusted (E2E encrypted, relay sees only ciphertext) is the right security model. But we need on-demand transfer, not continuous sync.

### 2.6 Pushbullet / Join by joaoapps

**Pushbullet model:** Cloud relay via Pushbullet servers. Push notifications for delivery.
**Join model:** Firebase Cloud Messaging for push, Google Drive for file storage.

**What works:** Cross-device push of links, text, files. Clipboard sync. Notification mirroring. People use them as "centralized notepad" for quick thoughts and links.
**What fails:** 
- Pushbullet: Free tier has severe limits on file size and message count. Premium is expensive. Server is centralized and proprietary.
- Join: $4.99 one-time is great, but relies entirely on Google infrastructure (FCM + Drive). If Google changes APIs, it breaks.
- Both: Files go through third-party servers. No E2E encryption. Upload-download model is slow for large files.

**Lesson for daemon:** The "push" mental model is right — you push something to a device, it arrives. But going through third-party cloud is wrong. Daemon has its own infrastructure.

### 2.7 Intel Unison / Microsoft Phone Link

**Intel Unison:** Shut down entirely in July 2025. "All good things come to an end."
**Microsoft Phone Link:** Bluetooth + local WiFi. Limited to 2000 recent photos. Cannot send files from PC to phone. CrossDevice folder has caused data loss (340GB ghost sync incidents). Samsung devices get exclusive features.

**Lesson for daemon:** Big tech can't solve this because they're incentivized to lock you into their ecosystem, not connect all your devices. Daemon has no ecosystem to protect.

### 2.8 Snapdrop / ShareDrop (Web-based P2P)

**Snapdrop:** WebRTC data channels for P2P transfer. WebSocket signaling server for discovery. Falls back to WebSocket relay if WebRTC unavailable. Progressive Web App — works in any browser.
**ShareDrop:** WebRTC only (no fallback). Firebase for signaling.

**What works:** Zero install — just open a URL. WebRTC is true P2P (data never touches server). Works on any device with a browser.
**What fails:** Requires both devices to have the web page open simultaneously. No background transfer. No push notifications. No native share sheet integration. WebRTC NAT traversal sometimes fails.

**Lesson for daemon:** The web UI as fallback (drag-and-drop page) is a great pattern. WebRTC P2P is the right transport for same-network transfers. But it can't be the only path.

### 2.9 croc / Magic Wormhole (CLI tools)

**croc:** Go binary. PAKE (Password-Authenticated Key Exchange) for E2E encryption. Relay-assisted P2P. Uses TCP ports 9009-9013.
**Magic Wormhole:** Python. PAKE with human-readable code words. Direct P2P when possible, relay fallback.

**What works:** Simple mental model — generate a code on one device, enter it on the other. E2E encrypted. Resumable transfers. No account needed.
**What fails:** CLI-only (no share sheet). Requires typing a code word. Not instant — human in the loop.

**Lesson for daemon:** The PAKE model is interesting for one-time sharing with strangers. But for your own devices, the authentication should be pre-established. Daemon devices are already authenticated via the daemon server.

### 2.10 Tailscale Taildrop

**Protocol:** HTTP PUT over WireGuard-encrypted Tailscale mesh. No additional authentication needed — devices are already authenticated on the tailnet.

**How it works:**
1. Devices are already connected via Tailscale (WireGuard mesh)
2. File transfer is a simple HTTP PUT request between devices
3. Uses the fastest available path (direct P2P when possible, DERP relay when not)
4. Resumable transfers
5. Cross-platform (Windows, macOS, Linux, Android, iOS)

**What works:** Dead simple once Tailscale is installed. No discovery needed — devices are always known. E2E encrypted via WireGuard. Works across any network. Resumable.
**What fails:** Requires Tailscale on both devices. No share sheet integration on mobile. No AI/intelligence. No clipboard sync. Just dumb file transfer.

**Lesson for daemon: THIS IS THE BASE LAYER.** Arthur already has Tailscale on all devices. The mesh is already there. Taildrop proves that HTTP over Tailscale is fast and reliable. We should build on top of this, not reinvent the transport.

---

## 3. Protocol Deep Dive

### 3.1 Transport Options Ranked for Daemon

| Transport | Speed | NAT Piercing | Encryption | Complexity | Best For |
|-----------|-------|-------------|-----------|------------|----------|
| **Tailscale direct** | WireGuard speed (near line-rate) | Built-in (DERP relay) | WireGuard E2E | Zero (already deployed) | **Primary transport** |
| WebSocket via daemon server | Server bandwidth limited | N/A (server relays) | TLS | Low | Signaling + small payloads |
| WebRTC data channel | P2P WiFi speeds | STUN/TURN | DTLS/SCTP | Medium | Browser-to-browser fallback |
| QUIC (HTTP/3) | 12% faster connection setup, no HOL blocking | Needs STUN | TLS 1.3 built-in | High | Future optimization |
| BLE + WiFi Direct | 20-100 MB/s (WiFi Direct) | N/A (local only) | App-layer | Very high | Proximity-only edge case |
| Plain HTTPS | Normal HTTP speeds | N/A | TLS | Very low | Web fallback page |

### 3.2 Recommended Protocol Stack

```
┌─────────────────────────────────────────────────────┐
│                  APPLICATION LAYER                   │
│  Share API: POST /api/transfer                       │
│  Clipboard API: POST /api/clipboard                  │
│  Device Registry: WebSocket /ws/device               │
│  AI Processing: POST /api/process                    │
├─────────────────────────────────────────────────────┤
│                  ROUTING LAYER                       │
│  1. Direct Tailscale (same tailnet) — PREFERRED     │
│  2. Server relay (daemon server on arturito)         │
│  3. WebRTC P2P (browser-to-browser fallback)        │
│  4. HTTPS URL (one-off sharing with non-daemon)     │
├─────────────────────────────────────────────────────┤
│                  TRANSPORT LAYER                     │
│  Tailscale: WireGuard mesh (100.x.y.z addresses)    │
│  Server: HTTPS (TLS 1.3) via Cloudflare tunnel      │
│  WebRTC: DTLS + SCTP data channels                  │
├─────────────────────────────────────────────────────┤
│                  DISCOVERY LAYER                     │
│  Tailscale: Always known (tailnet device list)       │
│  LAN: mDNS/DNS-SD (bonus, not required)             │
│  Global: Daemon server device registry               │
└─────────────────────────────────────────────────────┘
```

### 3.3 Why Tailscale First

Arthur's current device mesh:
- `arturito` (100.124.245.114) — Linux server, daemon brain
- `msi` (100.90.175.87) — Windows laptop
- `pixel` (100.126.71.26) — Pixel 8 Pro (Termux, port 8022)

All three already talk to each other over Tailscale. WireGuard gives us:
- **Line-rate encryption** (WireGuard is ~1 Gbps on modern hardware)
- **Always-on connectivity** (no discovery delay)
- **NAT piercing** (DERP relay fallback built-in)
- **Mutual authentication** (device keys on tailnet)

Building on top of Tailscale means: zero transport work. Just HTTP endpoints on each device.

### 3.4 Transfer Flow

```
Phone shares a photo to daemon:

1. Android share sheet → daemon app catches intent
2. App reads file bytes from content URI
3. App checks: is target device on Tailscale?
   YES → HTTP PUT directly to target's Tailscale IP
   NO  → POST to daemon server (arturito), server relays
4. Target device receives file:
   - Phone/Watch: notification + preview
   - Laptop: system notification + file in ~/daemon-inbox/
   - Server: processed by AI (OCR, summary, filing)
5. Daemon AI optionally processes the file:
   - Receipt → extract merchant, amount, date
   - Document → summarize, tag, suggest filing
   - Photo → describe, tag faces/places
   - Link → fetch title, preview, archive
```

---

## 4. Android Share Sheet Dominance

### 4.1 How Android Share Sheet Ranking Works

The Android share sheet uses a **prediction service** that ranks targets based on:
1. **Recency** — how recently you shared to this target
2. **Frequency** — how often you share to this target
3. **Rank hint** — priority set by the app on its shortcuts
4. **App usage** — how much you use the app generally
5. **Content type matching** — does the app handle this MIME type well?
6. **Conversation priority** — for messaging apps, priority of the associated conversation

### 4.2 How to Get Daemon to the Top

**Step 1: Sharing Shortcuts via ShortcutManagerCompat**

The modern Android share sheet prioritizes apps that publish **Sharing Shortcuts** (not just intent filters). Current daemon manifest has intent filters but no shortcuts.

```kotlin
// Must be called on app start and periodically
fun publishSharingShortcuts(context: Context) {
    val shortcut = ShortcutInfoCompat.Builder(context, "daemon-quick-share")
        .setShortLabel("Send to Daemon")
        .setLongLabel("Send to your Daemon")
        .setIcon(IconCompat.createWithResource(context, R.mipmap.ic_launcher))
        .setCategories(setOf("com.daemon.app.category.SHARE"))
        .setIntent(Intent(Intent.ACTION_SEND).apply {
            type = "*/*"
            component = ComponentName(context, MainActivity::class.java)
        })
        .setLongLived(true)  // CRITICAL: makes shortcut persist
        .setRank(0)          // Highest priority
        .build()

    ShortcutManagerCompat.pushDynamicShortcut(context, shortcut)
}
```

**Step 2: Report Usage Every Time Something is Shared**

```kotlin
// Call this after every successful share
ShortcutManagerCompat.reportShortcutUsed(context, "daemon-quick-share")
```

This trains the prediction model. The more you share to daemon, the higher it ranks. After ~5-10 uses, it should appear in the Direct Share row (top of share sheet).

**Step 3: Add share-target in AndroidManifest.xml**

```xml
<activity android:name=".MainActivity">
    <!-- Existing intent filters... -->

    <meta-data
        android:name="android.service.chooser.chooser_target_service"
        android:value="androidx.sharetarget.ChooserTargetServiceCompat" />
</activity>

<!-- In shortcuts.xml (referenced from manifest) -->
<shortcuts>
    <share-target android:targetClass="com.daemon.app.MainActivity">
        <data android:mimeType="*/*" />
        <category android:name="com.daemon.app.category.SHARE" />
    </share-target>
</shortcuts>
```

**Step 4: Multiple Device Shortcuts (Advanced)**

Publish one sharing shortcut per device: "Send to Laptop", "Send to Server", "Send to Watch". Each shortcut targets a specific device. The user sees "Send to Laptop" right in the share sheet — one tap.

```kotlin
fun publishDeviceShortcuts(context: Context, devices: List<DaemonDevice>) {
    devices.forEach { device ->
        val shortcut = ShortcutInfoCompat.Builder(context, "daemon-${device.id}")
            .setShortLabel("→ ${device.name}")
            .setLongLabel("Send to ${device.name}")
            .setIcon(device.icon)
            .setCategories(setOf("com.daemon.app.category.SHARE"))
            .setIntent(Intent(Intent.ACTION_SEND).apply {
                type = "*/*"
                putExtra("target_device", device.id)
                component = ComponentName(context, MainActivity::class.java)
            })
            .setLongLived(true)
            .setRank(device.priority)
            .build()
        ShortcutManagerCompat.pushDynamicShortcut(context, shortcut)
    }
}
```

### 4.3 The Instant-Feel Trick

The biggest UX win: make the share sheet action feel instant, even if the transfer takes a few seconds.

1. User taps "Send to Laptop" in share sheet
2. App opens for 0.5 seconds showing a checkmark animation
3. Transfer happens in the background via foreground service
4. System notification shows progress for large files
5. Target device gets push notification when complete

No waiting. No progress bars (unless the file is huge). Just tap and done.

---

## 5. Clipboard Sync

### 5.1 Why This is More Important Than File Transfer

People copy-paste between devices 10x more often than they transfer files. A URL, a phone number, an address, a code snippet. Currently: copy on phone, email to self, open email on laptop, copy again. Or: type it manually.

### 5.2 How Others Do It

| Solution | Transport | Scope | Limitation |
|----------|-----------|-------|-----------|
| Apple Universal Clipboard | BLE + Handoff (iCloud) | Apple devices only | Requires proximity + same Apple ID |
| Microsoft Cloud Clipboard (SwiftKey) | Cloud (Microsoft servers) | Windows + Android | Text/links/images <1MB only. Each copy replaces remote clipboard. |
| KDE Connect | TCP over LAN | Linux/Windows/macOS/Android | LAN-only |
| Pushbullet | Cloud relay | Any with Pushbullet | Free tier limited. Server sees your clipboard. |
| uniclip (open source) | TCP (Go binary) | Any with Go runtime | Manual setup. No mobile. |

### 5.3 Daemon Clipboard Sync Design

**Transport:** WebSocket over Tailscale (already have persistent connections)

**Flow:**
1. Android: `ClipboardManager.OnPrimaryClipChangedListener` fires when user copies something
2. App sends clipboard content to daemon server via WebSocket: `{type: "clipboard", content: "...", device: "pixel"}`
3. Server broadcasts to all other connected devices
4. Laptop daemon client writes to system clipboard
5. Total latency: <500ms over Tailscale

**Security:**
- Clipboard data transmitted over WireGuard (encrypted)
- Server doesn't persist clipboard data (relay only, in-memory)
- Option to exclude sensitive clips (password manager detected, credit card patterns)

**Smart clipboard (AI angle):**
- Copy a phone number -> daemon suggests adding to contacts
- Copy an address -> daemon suggests navigation
- Copy a URL -> daemon fetches preview and stores for later
- Copy code -> daemon detects language and suggests where to paste it

### 5.4 Platform-Specific Clipboard APIs

| Platform | Read Clipboard | Write Clipboard | Background Access |
|----------|---------------|----------------|-------------------|
| Android 13+ | `ClipboardManager` (restricted in background) | `ClipboardManager` | Only foreground service or active window |
| Windows | `Clipboard.GetText()` / Win32 `OpenClipboard` | Same | Unrestricted (tray app) |
| Linux | `xclip` / `xsel` / `wl-copy` (Wayland) | Same | Unrestricted (daemon process) |
| macOS | `NSPasteboard` | Same | Unrestricted |
| Wear OS | Very limited clipboard API | Very limited | Not practical |

**Android 13+ restriction:** Background apps cannot read clipboard. The daemon foreground service needs a workaround — either the user explicitly triggers "sync clipboard" or we use an accessibility service (controversial, may get rejected from Play Store).

**Practical approach for Android:** Add a "Copy to all devices" quick settings tile and a persistent notification action. One tap to sync current clipboard.

---

## 6. Security Architecture

### 6.1 Threat Model

| Threat | Mitigation |
|--------|-----------|
| Server compromise | Server is relay-only, never stores files. E2E encryption means compromised server sees ciphertext. |
| Network sniffing | WireGuard (Tailscale) encrypts all traffic. HTTPS for non-Tailscale paths. |
| Device theft | Device authentication via daemon token. Files auto-expire. PIN-protected access for web UI. |
| Man-in-the-middle | Tailscale uses WireGuard key authentication. Web paths use TLS with certificate pinning. |
| Unauthorized access | Cloudflare Access on my.daemon.page. Tailscale ACLs for direct device communication. |

### 6.2 Encryption Layers

```
Layer 1: WireGuard (Tailscale)
  - ChaCha20-Poly1305 encryption
  - Curve25519 key exchange
  - Always-on for Tailscale traffic

Layer 2: Application-level E2E (for relay scenarios)
  - AES-256-GCM for file encryption
  - Key derived from shared secret established during device pairing
  - Server relay sees only ciphertext

Layer 3: At-rest (optional, for temporary storage)
  - Files encrypted with device-specific key before writing to disk
  - Auto-delete after configurable TTL (default: 1 hour)
```

### 6.3 PIN-Protected Web Access

For sharing files with people who don't have daemon:

1. User shares a file via daemon
2. Daemon generates a short URL: `https://daemon.page/s/abc123`
3. URL requires a 4-digit PIN to access (shown to sender only)
4. File auto-expires after 24 hours or 5 downloads (whichever first)
5. File is encrypted at rest with a key derived from the PIN + a server secret
6. Zero server-side knowledge of file contents (key derived client-side)

---

## 7. The AI Angle

### Why Daemon's File Transfer is Fundamentally Better Than AirDrop

AirDrop is a dumb pipe. Files go from A to B. Daemon is an intelligent agent that **understands** what you're sharing and **acts on it**.

### 7.1 Smart Processing Pipeline

```
User shares a file → Daemon receives it → AI processes in background

Receipt (image/PDF):
  → OCR with Gemini Vision
  → Extract: merchant, amount, date, category
  → Store in expense tracker
  → "I filed your €47.50 dinner at Osteria Francescana under Meals"

Document (PDF/DOCX):
  → Summarize with Gemini
  → Extract key dates, names, action items
  → Add to knowledge graph
  → "This NDA with Partita expires March 2027. Added to your calendar."

Photo:
  → Describe scene, identify faces (if face DB exists)
  → Tag with location, time, event
  → "Photo from your meeting with Luca at Mugaritz. Tagged and filed."

Link/URL:
  → Fetch page, extract article text
  → Summarize
  → Store in knowledge base
  → "Saved article about EU AI Act. Key point: compliance deadline June 2027."

Contact (vCard):
  → Parse fields
  → Cross-reference with Podio/HubSpot
  → "Added Marco Rossi to your contacts. He's already in Podio as a partner lead."

Voice note:
  → Transcribe with Deepgram
  → Summarize
  → Extract action items
  → "Your voice note mentions calling the lawyer Tuesday. Added reminder."

Code snippet:
  → Detect language
  → Suggest context (which project it belongs to)
  → "This looks like a Kotlin coroutine fix. Want me to create a PR in daemon/android?"
```

### 7.2 Cross-Device Intelligence

The AI processing creates a feedback loop:

1. Share a photo of a whiteboard from your phone
2. Daemon OCRs it, extracts the diagram, converts to structured notes
3. Notes appear on your laptop's daemon inbox — already formatted
4. You can ask daemon: "what was on that whiteboard from yesterday?" and it knows

This turns file transfer from a logistics problem into a **knowledge management** system.

### 7.3 Implementation

Processing happens on the daemon server (arturito) which has Gemini API access. The flow:

```python
@app.route('/api/transfer', methods=['POST'])
async def handle_transfer(request):
    file = request.files['file']
    metadata = request.json

    # 1. Store temporarily (encrypted, auto-expire)
    file_id = store_temp(file, ttl=3600)

    # 2. Route to target device
    target = metadata.get('target_device', 'all')
    await relay_to_device(file_id, target)

    # 3. AI processing (async, non-blocking)
    asyncio.create_task(process_with_ai(file_id, file.content_type))

    return {'status': 'sent', 'file_id': file_id}
```

---

## 8. Per-Platform Requirements

### 8.1 Android Phone (daemon app) — Partially Built

**Current state:** Share target intent filters in AndroidManifest. Handles SEND intent for text and files. Uploads via base64 JSON to `https://my.daemon.page/api/share`.

**What's needed:**
- [ ] Sharing Shortcuts via ShortcutManagerCompat (for share sheet ranking)
- [ ] Per-device shortcuts ("Send to Laptop", "Send to Server")
- [ ] Background transfer via foreground service (not blocking UI)
- [ ] Clipboard sync listener + Quick Settings tile
- [ ] Notification channel for incoming files
- [ ] File reception from other devices (currently only sends)
- [ ] Chunked transfer for large files (current base64 approach has memory issues for files >50MB)
- [ ] Direct Tailscale transfer (HTTP PUT to device IP) instead of always going through server

**Libraries:**
- `androidx.sharetarget:sharetarget:1.2.0` — ChooserTargetServiceCompat
- `androidx.core:core-ktx` — ShortcutManagerCompat
- `io.ktor:ktor-client-okhttp` — HTTP client for transfers
- `io.ktor:ktor-client-websockets` — WebSocket for clipboard sync

**Estimated effort:** 3-4 days

### 8.2 Android Watch (Wear OS) — New

**Capabilities:**
- Wear OS 4+ (Galaxy Watch 5 target)
- Can receive files up to ~65MB
- Has WiFi (can talk directly to daemon server)
- Storage: 4-8GB internal
- Slow Bluetooth transfer, prefer WiFi

**What it should do:**
- Receive text/links from phone or laptop (notification + display)
- Send voice notes to daemon
- Show recent shared items as scrollable cards
- Quick action: "Send clipboard to phone"

**What it should NOT do:**
- Receive large files (pointless on watch screen)
- Run AI processing (no GPU, limited battery)

**Architecture:** Follows the existing WATCH_APP_SPEC.md — primary WiFi direct to server, fallback via phone Data Layer API.

**Libraries:**
- `com.google.android.gms:play-services-wearable` — Data Layer API
- Compose for Wear OS
- Ktor client for HTTP/WebSocket

**Estimated effort:** 2-3 days (basic text/link receive + voice send)

### 8.3 Windows Laptop — New

**Options ranked:**

| Approach | Size | Startup | Features | Effort |
|----------|------|---------|----------|--------|
| **Tauri app (Rust + WebView)** | ~5 MB | Instant | System tray, notifications, clipboard, file drop | 3-4 days |
| PowerShell script + Task Scheduler | 0 MB | Background | Basic CLI transfers | 1 day |
| Electron tray app | ~200 MB | Slow | Full GUI | 3-4 days |
| Browser extension (Chrome) | ~1 MB | Always on | Right-click share, clipboard | 2-3 days |
| Go/Rust CLI binary | ~5 MB | Instant | CLI only, no GUI | 2 days |

**Recommended: Tauri tray app**

Why Tauri over Electron:
- 97% smaller bundle (~5 MB vs ~200 MB)
- Native performance (Rust backend)
- System tray with native look
- Clipboard access via Rust crates
- File system watcher built-in
- No Chromium bundled (uses system WebView2, which Windows 11 has pre-installed)

**Features:**
- System tray icon (red daemon eye) with context menu
- "Send file" option in tray menu + drag-and-drop onto tray icon
- Clipboard sync (bidirectional, automatic)
- Incoming file notification (Windows toast notification)
- Files land in `~/daemon-inbox/` folder
- Explorer context menu: right-click file -> "Send to Daemon"
- Background service via Windows Task Scheduler

**Key libraries:**
- `tauri` — app framework
- `arboard` (Rust crate) — cross-platform clipboard
- `notify` (Rust crate) — file system watcher
- `reqwest` — HTTP client
- `tokio-tungstenite` — WebSocket client
- `windows-rs` — Windows API for toast notifications

**Estimated effort:** 4-5 days

### 8.4 Linux Server (arturito) — Partially Built

**Current state:** daemon server (Python) on port 4800. WebSocket device registry on port 4801.

**What's needed:**
- [ ] `/api/transfer` endpoint for file relay
- [ ] `/api/clipboard` endpoint for clipboard broadcast
- [ ] Temporary encrypted file storage with auto-expiry
- [ ] AI processing pipeline (Gemini Vision for images, Gemini for text)
- [ ] File inbox watcher (watch `~/daemon-inbox/` for files to process)
- [ ] CLI tool: `daemon send <file> --to <device>` (shell alias)

**Estimated effort:** 2-3 days

### 8.5 Web Browser (Fallback) — New

A drag-and-drop web page at `my.daemon.page/transfer`:

- Drag files onto the page to send to your devices
- See list of online devices
- Click a received file to download
- Clipboard paste (Ctrl+V) to send clipboard to all devices
- PIN-protected sharing URLs for non-daemon users

**Implementation:** Simple Next.js page (daemon-web already runs Next.js). WebSocket for real-time device list and transfer progress.

**Estimated effort:** 1-2 days

### 8.6 macOS / iOS — Future

**macOS:** Same Tauri app as Windows (Tauri is cross-platform). Mostly free once Windows version works.
**iOS:** Requires Swift/SwiftUI share extension. More effort due to Apple's app review and sandboxing. Consider Flutter (like LocalSend) for code sharing with Android.

**Estimated effort:** macOS 1-2 days (Tauri port), iOS 5-7 days (new codebase + App Store)

---

## 9. Recommended Architecture

### 9.1 System Diagram

```
┌──────────────────────────────────────────────────────────────────────┐
│                        DAEMON SERVER (arturito)                     │
│                        100.124.245.114:4800                         │
│                                                                      │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌───────────────────┐   │
│  │ /api/    │  │ /api/    │  │ /ws/     │  │ AI Processing    │   │
│  │ transfer │  │ clipboard│  │ device   │  │ (Gemini Vision   │   │
│  │          │  │          │  │          │  │  + Gemini Flash) │   │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └───────┬───────────┘   │
│       │              │              │                │               │
│       └──────────────┴──────────────┴────────────────┘               │
│                              │                                       │
│                    ┌─────────┴─────────┐                             │
│                    │  Temp File Store  │                             │
│                    │  (encrypted,      │                             │
│                    │   auto-expire)    │                             │
│                    └──────────────────┘                              │
└──────────────────────────┬──────────────────────────────────────────┘
                           │
              Tailscale WireGuard Mesh
                           │
         ┌─────────────────┼─────────────────┐
         │                 │                 │
    ┌────┴────┐      ┌────┴────┐      ┌────┴────┐
    │  Phone  │      │ Laptop  │      │  Watch  │
    │ (Pixel) │      │  (MSI)  │      │ (GW5)  │
    │         │      │         │      │         │
    │ Android │      │ Tauri   │      │ Wear OS │
    │ share   │      │ tray    │      │ voice + │
    │ target  │      │ app     │      │ text    │
    │ + clip  │      │ + clip  │      │ only    │
    └─────────┘      └─────────┘      └─────────┘
```

### 9.2 Transfer Protocol

```
MESSAGE FORMAT (JSON over WebSocket or HTTP body):

{
  "type": "transfer" | "clipboard" | "notification" | "command",
  "from": "pixel",
  "to": "msi" | "all",
  "payload": {
    "filename": "receipt.jpg",         // for files
    "content_type": "image/jpeg",      // MIME type
    "size": 245760,                    // bytes
    "checksum": "sha256:abc123...",    // integrity check
    "data": "<base64 or URL>",         // inline for <1MB, URL for larger
    "text": "clipboard content",       // for clipboard sync
    "ttl": 3600                        // seconds until auto-delete
  },
  "encryption": {
    "algorithm": "aes-256-gcm",
    "key_id": "device-pair-key-42"     // pre-shared during device pairing
  },
  "timestamp": "2026-04-01T14:30:00Z"
}
```

### 9.3 Transfer Routing Logic

```python
async def route_transfer(transfer):
    source = transfer['from']
    target = transfer['to']

    # Option 1: Direct Tailscale (best — P2P, encrypted, fast)
    if target_on_tailscale(target):
        tailscale_ip = get_tailscale_ip(target)
        try:
            await http_put(f"http://{tailscale_ip}:4810/receive", transfer)
            return  # Done — direct delivery
        except ConnectionError:
            pass  # Fall through to relay

    # Option 2: WebSocket relay (device connected to server)
    if target_connected_ws(target):
        await ws_send(target, transfer)
        return

    # Option 3: Store-and-forward (device offline)
    file_id = await store_encrypted(transfer, ttl=86400)
    await queue_notification(target, f"File waiting: {transfer['payload']['filename']}")
```

---

## 10. Build Plan

### Phase 1: Core Transfer (Week 1) — 5 days

**Day 1-2: Server API**
- [ ] `/api/transfer` POST endpoint (multipart file upload, not base64)
- [ ] `/api/clipboard` POST/WebSocket for clipboard sync
- [ ] Temp file store with AES-256-GCM encryption + auto-expiry cron
- [ ] Device-to-device routing logic (Tailscale direct > WS relay > store-and-forward)

**Day 3-4: Android App Upgrade**
- [ ] Replace base64 upload with multipart/chunked upload
- [ ] Add ShortcutManagerCompat sharing shortcuts (per-device)
- [ ] Background transfer service (non-blocking UI)
- [ ] File reception handler (notification + save to Downloads)
- [ ] Report shortcut usage for ranking

**Day 5: Web Transfer Page**
- [ ] `my.daemon.page/transfer` — drag-and-drop file sharing
- [ ] WebSocket-driven device list and transfer status
- [ ] Clipboard paste support (Ctrl+V sends to devices)

### Phase 2: Desktop + Clipboard (Week 2) — 5 days

**Day 6-8: Windows Tauri App**
- [ ] System tray with daemon icon
- [ ] Bidirectional clipboard sync via WebSocket
- [ ] File drop zone (drag onto tray icon)
- [ ] Windows toast notifications for incoming files
- [ ] `~/daemon-inbox/` auto-watcher
- [ ] Windows Installer (MSI or NSIS)

**Day 9-10: Clipboard Sync Cross-Platform**
- [ ] Android: ClipboardManager listener + Quick Settings tile
- [ ] Windows: arboard crate polling
- [ ] Linux: wl-copy/xclip integration
- [ ] Server: clipboard broadcast via WebSocket
- [ ] De-duplication (don't echo back to sender)
- [ ] Sensitive content filter (passwords, credit cards)

### Phase 3: AI Processing (Week 3) — 3-4 days

**Day 11-12: Smart Processing Pipeline**
- [ ] Gemini Vision API integration for image analysis
- [ ] Receipt extraction (merchant, amount, date)
- [ ] Document summarization
- [ ] Link preview + archival
- [ ] Voice note transcription (Deepgram, already integrated)

**Day 13-14: Knowledge Integration**
- [ ] Processed files -> Qdrant knowledge graph entries
- [ ] "What did I share yesterday?" query support
- [ ] Cross-reference with Podio contacts
- [ ] Processing results pushed back to sender device

### Phase 4: Watch + Polish (Week 4) — 3-4 days

**Day 15-16: Wear OS App**
- [ ] Text/link reception from daemon server
- [ ] Voice note capture and send
- [ ] Recent shared items view
- [ ] "Send clipboard to phone" quick action

**Day 17-18: Polish + PIN Sharing**
- [ ] PIN-protected public sharing URLs
- [ ] Auto-expire shared files (24h / 5 downloads)
- [ ] Transfer history view in Android app
- [ ] Error handling and retry logic
- [ ] E2E test suite

### Total Estimated Time: ~18 working days (3.5 weeks)

---

## Key Libraries and Dependencies

### Server (Python)
| Library | Purpose |
|---------|---------|
| `aiofiles` | Async file I/O for temp storage |
| `cryptography` (Fernet/AES-GCM) | File encryption at rest |
| `google-generativeai` | Gemini Vision + Flash for AI processing |
| `deepgram-sdk` | Voice note transcription |

### Android (Kotlin)
| Library | Purpose |
|---------|---------|
| `androidx.sharetarget:sharetarget:1.2.0` | Share sheet shortcuts |
| `io.ktor:ktor-client-okhttp:2.3+` | HTTP client (chunked uploads) |
| `io.ktor:ktor-client-websockets:2.3+` | WebSocket for clipboard + signaling |
| `com.google.android.gms:play-services-wearable:18+` | Wear Data Layer API |

### Windows (Tauri/Rust)
| Library | Purpose |
|---------|---------|
| `tauri:2.0+` | App framework, system tray, WebView |
| `arboard:3.0+` | Cross-platform clipboard |
| `notify:6.0+` | File system watcher |
| `reqwest:0.12+` | HTTP client |
| `tokio-tungstenite:0.21+` | WebSocket client |
| `aes-gcm:0.10+` | E2E file encryption |

### Web (Next.js)
| Library | Purpose |
|---------|---------|
| Already in daemon-web | Next.js app |
| Native WebSocket API | Real-time device list |
| Web Crypto API | Client-side encryption |
| File API / Drag-and-Drop API | File handling |

---

## Why This Beats Everything

| Feature | AirDrop | Quick Share | Drive | WhatsApp | **Daemon** |
|---------|---------|------------|-------|----------|-----------|
| Cross-platform | No | Android+Windows | Yes | Yes | **Yes** |
| No account needed | Yes | Yes | No | No | **Pre-authenticated** |
| Works across networks | No | Partial | Yes | Yes | **Yes (Tailscale)** |
| Instant (no discovery) | ~2s | ~5-15s | N/A | N/A | **<1s** |
| Clipboard sync | No | No | No | No | **Yes** |
| AI processing | No | No | No | No | **Yes** |
| E2E encrypted | Yes | Yes | No | Yes | **Yes** |
| No file compression | Yes | Yes | Yes | **No** | **Yes** |
| Offline queue | No | No | Yes | Yes | **Yes** |
| Open source | No | No | No | No | **Yes** |
| PIN sharing with anyone | No | No | Yes | No | **Yes** |
| Knowledge extraction | No | No | No | No | **Yes** |

The killer differentiator: **sharing to daemon is not just transferring a file — it's feeding your AI agent information it can reason about, remember, and act on.** No other file transfer solution does this.

---

## References

- [AirDrop AWDL Protocol (arxiv)](https://arxiv.org/pdf/1808.03156)
- [AirDrop Security Analysis (USENIX 2019)](https://www.usenix.org/system/files/sec19-stute.pdf)
- [PrivateDrop: AirDrop Privacy (USENIX 2021)](https://www.usenix.org/system/files/sec21fall-heinrich.pdf)
- [AirDrop Anywhere (reverse engineering)](https://bakedbean.org.uk/posts/2021-05-airdrop-anywhere-part-2/)
- [Quick Share — Wikipedia](https://en.wikipedia.org/wiki/Quick_Share)
- [KDE Connect](https://kdeconnect.kde.org/)
- [LocalSend (GitHub)](https://github.com/localsend/localsend)
- [LocalSend Protocol](https://github.com/localsend/protocol)
- [Syncthing Relay Protocol](https://docs.syncthing.net/specs/relay-v1.html)
- [Syncthing Local Discovery Protocol](https://docs.syncthing.net/specs/localdisco-v4.html)
- [Taildrop (Tailscale)](https://tailscale.com/kb/1106/taildrop)
- [Taildrop Implementation Blog](https://tailscale.com/blog/2021-06-taildrop-was-easy)
- [croc (GitHub)](https://github.com/schollz/croc)
- [Magic Wormhole File Transfer Protocol](https://magic-wormhole.readthedocs.io/en/latest/file-transfer-protocol.html)
- [ShareDrop (GitHub)](https://github.com/ShareDropio/sharedrop)
- [WebRTC Data Channels (RFC 8831)](https://datatracker.ietf.org/doc/html/rfc8831)
- [WebRTC Data Channels (web.dev)](https://web.dev/webrtc-datachannels/)
- [simple-peer (GitHub)](https://github.com/feross/simple-peer)
- [Android Sharing Shortcuts](https://developer.android.com/training/sharing/direct-share-targets)
- [ShortcutManagerCompat API](https://developer.android.com/reference/androidx/core/content/pm/ShortcutManagerCompat)
- [Android Share Sheet Deep Dive](https://www.oreateai.com/blog/making-sharing-seamless-a-deep-dive-into-androids-share-sheet/652ccf43662c6be1500421a2d9b71f3b)
- [Tauri Framework](https://medium.com/@bhagyarana80/why-i-switched-from-electron-to-tauri-for-a-10x-faster-desktop-app-a796fc337292)
- [HTTP/3 vs HTTP/2 Performance](https://www.debugbear.com/blog/http3-vs-http2-performance)
- [Zero-Knowledge Encryption Guide](https://www.hivenet.com/post/zero-knowledge-encryption-the-ultimate-guide-to-unbreakable-data-security)
- [uniclip — Cross-Platform Clipboard](https://github.com/quackduck/uniclip)
- [Wear OS File Transfer](https://play.google.com/store/apps/details?id=com.somyac.watch.filetransfer)
- [Ktor WebSocket for Android](https://ktor.io/docs/client-websockets.html)
