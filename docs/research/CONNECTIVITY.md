# Daemon Connectivity Architecture Research (April 2026)

Research into connection topologies, transport protocols, NAT traversal, mobile persistence, device capability abstraction, cross-platform bridges, and file transfer for a multi-device AI agent system.

---

## 1. Connection Topologies

### Star (Current Daemon Architecture)

All devices connect to a central server. Server relays all messages.

| Aspect | Assessment |
|--------|-----------|
| Latency | 1 extra hop for device-to-device (device A -> server -> device B) |
| Reliability | Single point of failure at server; but simple reconnection logic |
| Privacy | Server sees all traffic metadata (can encrypt payloads end-to-end) |
| Complexity | Low. Each device only needs to know the server address |
| NAT | No NAT issues -- all connections are outbound from devices |

**Who uses it:**
- **Pushbullet**: Pure cloud relay. Phone runs a background service that forwards via HTTPS to Pushbullet servers, which deliver to desktop app/browser extension. REST API with HTTP Basic Auth.
- **Microsoft Phone Link**: Cloud-mediated relay using Wi-Fi, Bluetooth (for calls), and BLE. Requires Microsoft account authentication on both endpoints. Pairing via QR code handshake.
- **WhatsApp/Signal**: Star topology with Erlang backend. Each user maintains one WebSocket per active session with 30-second heartbeats. Server relays encrypted packets (Signal Protocol E2E encryption). Servers handle routing but cannot read message contents.

### Mesh (P2P / LAN-Direct)

Devices connect directly to each other. No central relay.

| Aspect | Assessment |
|--------|-----------|
| Latency | Lowest possible -- direct device-to-device |
| Reliability | No single point of failure; but each pair must maintain connectivity |
| Privacy | Best -- no intermediary sees traffic |
| Complexity | High. Every device must discover and connect to every other device |
| NAT | Major challenge. Requires STUN/TURN/hole-punching for internet P2P |

**Who uses it:**
- **KDE Connect**: Pure LAN mesh. Discovery via UDP broadcast/multicast on /24 subnet (ports 1714-1764). Once identity packet received, TCP connection established directly. No cloud relay. Devices must be on same Wi-Fi network. Moving toward mDNS for discovery (more reliable, less often blocked).
- **AirDrop (Apple)**: Uses AWDL (Apple Wireless Direct Link), a proprietary Wi-Fi-based P2P protocol. BLE for discovery, then direct Wi-Fi for data transfer. Operates on social channels 6, 44, 149. Channel-hops between AWDL peers and infrastructure Wi-Fi simultaneously. No encryption at AWDL layer -- TLS with mutual authentication (client certificates) handles security. Extremely fast for local transfers but zero internet capability.
- **Apple Continuity/Handoff**: BLE for discovery and negotiation, then Wi-Fi Direct for data transfer. iCloud account authenticates and pairs devices. Handoff messages sent over BLE advertising channel (no established connection needed). AES-GCM encryption with dedicated BLE key.

### Hybrid (Recommended for Daemon)

Server for coordination/signaling, P2P for data transfer when possible.

| Aspect | Assessment |
|--------|-----------|
| Latency | Direct when on same network; server relay as fallback |
| Reliability | Best of both -- always reachable via server, fast when local |
| Privacy | Good -- bulk data stays local when possible |
| Complexity | Medium-high. Need both relay and P2P paths |
| NAT | Server relay solves NAT; P2P available when both on LAN |

**Who uses it:**
- **Tailscale**: Every connection starts via DERP relay, then upgrades to direct WireGuard P2P if NAT traversal succeeds (94% of the time via UDP hole-punching). DERP servers are "dumb pipes" -- they relay WireGuard-encrypted packets over HTTPS on port 443, never see plaintext. Uses STUN for public IP/port discovery.
- **Syncthing**: P2P with relay fallback. Discovery via local broadcast + global discovery servers. Block Exchange Protocol (BEP) over TLS 1.3. Relay servers forward encrypted traffic when direct connection fails.

### Recommendation for Daemon

**Keep star topology as primary, add LAN-direct as optimization.**

Rationale:
1. Star is already working and handles the AI agent use case well (agent on server orchestrates devices)
2. The AI agent lives on the server -- most commands originate there, so star is natural
3. Add mDNS/local discovery so devices on the same LAN can transfer files directly (P2P for data, star for commands)
4. No need for full mesh -- devices rarely talk to each other without the AI agent mediating

---

## 2. Transport Protocols

### WebSocket (Current)

Persistent bidirectional TCP connection. Upgrade handshake from HTTP.

| Aspect | Rating | Notes |
|--------|--------|-------|
| Latency | Good | Sub-100ms for established connections |
| Battery | Moderate | ~1% battery/hour with heartbeats. Tunable via heartbeat interval |
| Reliability | Good | TCP guarantees delivery; but head-of-line blocking on packet loss |
| Browser support | 99%+ | Universal |
| Mobile support | Excellent | Native on Android (OkHttp) and iOS (URLSessionWebSocketTask) |
| Complexity | Low | Mature libraries everywhere |

### WebTransport (HTTP/3 / QUIC)

Modern alternative running over QUIC. Multiplexed streams, unreliable datagrams.

| Aspect | Rating | Notes |
|--------|--------|-------|
| Latency | Excellent | 1-RTT connection setup, 0-RTT for returning users. 23-35% lower latency than WS in tests |
| Battery | Good | QUIC connection migration handles network switches without reconnection |
| Reliability | Excellent | No head-of-line blocking (independent streams). Handles network interruptions better |
| Browser support | ~75% | Growing from 8% (2024) to 27% (early 2025). Not universal yet |
| Mobile support | Limited | No native mobile SDKs yet. Browser-only in practice |
| Complexity | High | Immature server libraries. Limited tooling |

**Verdict**: Promising but premature for Daemon. Revisit in 2027 when server libraries mature and mobile SDKs exist.

### Server-Sent Events (SSE)

Unidirectional server-to-client stream over standard HTTP.

| Aspect | Rating | Notes |
|--------|--------|-------|
| Latency | Good | Same as HTTP |
| Battery | Good | Less overhead than WebSocket (no heartbeats needed, HTTP keep-alive handles it) |
| Reliability | Excellent | Built-in reconnection with Last-Event-ID header for resumption. Automatic retry |
| Browser support | 99%+ | Universal |
| Mobile support | Good | Standard HTTP, works everywhere |
| Complexity | Very low | Simplest to implement |

**Key advantage**: Automatic reconnection with stream resumption is built into the protocol. WebSocket requires manual implementation.

**Limitation**: Client-to-server requires separate HTTP POST requests. Not truly bidirectional.

### gRPC Streaming

Typed RPC framework with bidirectional streaming. Protobuf serialization.

| Aspect | Rating | Notes |
|--------|--------|-------|
| Latency | Good | Protobuf is 5x faster than JSON at encoding |
| Battery | Good | Efficient binary protocol |
| Reliability | Good | Built on HTTP/2, multiplexed streams |
| Browser support | Poor | gRPC-web exists but no bidirectional streaming, no multiplexing |
| Mobile support | Good | Native Android (Kotlin) and iOS (Swift) libraries |
| Complexity | Medium | Requires protobuf schema management. More setup than WebSocket |

**Best for**: Service-to-service communication. Overkill for device bridge unless you need strong typing.

### MQTT

Lightweight pub/sub messaging protocol designed for IoT.

| Aspect | Rating | Notes |
|--------|--------|-------|
| Latency | Good | Minimal overhead. 2-byte minimum header |
| Battery | Excellent | Designed for constrained devices. Used by Facebook Messenger. 80% less bandwidth than WebSocket for IoT patterns |
| Reliability | Excellent | 3 QoS levels (at-most-once, at-least-once, exactly-once). Built-in session persistence |
| Browser support | Good | MQTT over WebSocket |
| Mobile support | Good | Lightweight clients available |
| Complexity | Medium | Need MQTT broker (Mosquitto, EMQX). Different mental model (pub/sub vs request/response) |

**Key insight**: MQTT's QoS levels and session persistence (broker stores messages for offline clients) map well to the device agent use case. Connect-disconnect pattern is more battery-friendly than persistent connections.

### Protocol Recommendation for Daemon

**Keep WebSocket as primary transport. Add SSE as lightweight alternative for watch/constrained devices.**

Rationale:
1. WebSocket's bidirectional nature is needed -- devices both receive commands AND send results
2. SSE + POST could work but adds complexity for bidirectional flows
3. MQTT would be ideal for the pub/sub patterns (agent publishes commands to device topics) but requires running a broker
4. Consider MQTT if scaling beyond ~50 devices becomes a goal

**Optimization**: Reduce heartbeat frequency. WhatsApp uses 30-second heartbeats. For Daemon where real-time isn't critical, 60-90 second heartbeats would cut battery drain significantly.

---

## 3. NAT Traversal and Connectivity

### Current State (All Outbound WSS)

Daemon devices make outbound WebSocket Secure (WSS) connections to the server. This works through any NAT, firewall, or proxy because it's standard HTTPS traffic on port 443. No NAT traversal needed.

**This is the right approach for the star topology.** Don't add NAT traversal complexity unless you need P2P.

### When You Need STUN/TURN/ICE

Only needed for direct P2P connections between devices behind NAT:

- **STUN**: Discovers public IP and port mapping. Free to run. Works for ~80% of NAT configurations. Fails on symmetric NAT (enterprise firewalls, carrier-grade NAT).
- **TURN**: Relay server for when STUN fails. Expensive (relays all media traffic). Needed for ~15-20% of connections.
- **ICE**: Framework that tries STUN first, falls back to TURN. Used by WebRTC.

**Tailscale's approach**: Uses STUN for discovery + custom DERP relay (equivalent to TURN but over HTTPS). UDP hole-punching succeeds 94% of the time. DERP handles the rest. DERP relays WireGuard-encrypted packets -- never sees plaintext.

### Tunneling Solutions for Exposing Services

| Solution | Cost | Throughput | Best For |
|----------|------|-----------|----------|
| **Cloudflare Tunnel** | Free, no bandwidth caps | Fast (Cloudflare edge) | Production. Daemon already uses this |
| **ngrok** | Free tier limited. $8+/mo for production | Fast | Dev/testing. Dropped UDP support. Increasingly restrictive (DDEV dropped it in 2026) |
| **bore** | Free (self-hosted, need VPS ~$4-6/mo) | Moderate | Minimal TCP-only tunneling. Single Rust binary |
| **Tailscale Funnel** | Free with Tailscale | Fast | Exposing services to internet via Tailscale network |

**Verdict**: Cloudflare Tunnel is the right choice for Daemon. Free, production-grade, already in use.

### Maintaining Connection from a Sleeping Phone

The most reliable approach (used by WhatsApp, Signal, Telegram):

1. **Persistent WebSocket** while app is active/foreground
2. **FCM/APNs push notification** to wake the app when server needs to reach it
3. App wakes, re-establishes WebSocket, processes command, goes back to sleep

This is the industry standard. Every major messaging app uses this pattern. See Section 4 for details.

---

## 4. Mobile Connection Persistence

### Android

#### Foreground Service + Wake Lock (Current Daemon Approach)

- Keeps WebSocket alive continuously
- Battery cost: ~1% per hour (varies with heartbeat frequency)
- Android will show persistent notification (required for foreground services)
- Survives Doze mode but consumes battery

#### Doze Mode Impact

Android Doze (introduced in Android M) prevents background processes from accessing the network:
- **Doze mode**: Activates when screen off + stationary + on battery. Defers network access, alarms, jobs. Has periodic "maintenance windows" where batched work can execute.
- **App Standby**: Individual apps that aren't used recently lose network access.
- **WebSocket connections WILL be dropped** in Doze unless the app has a foreground service or is whitelisted.

#### FCM as Wake-Up Mechanism (Recommended)

FCM high-priority messages can wake a sleeping device even in Doze mode:
- High priority: Delivered immediately, wakes device, allows limited network access
- Normal priority: Batched during Doze, delivered in maintenance windows

**Best practice (from Google's 2025 guidance)**: "If your app requires messaging integration with a backend service, Firebase Cloud Messaging is strongly recommended rather than maintaining your own persistent network connection."

#### Recommended Android Architecture for Daemon

```
Normal state:    FCM listener (zero battery cost, Google maintains the connection)
                     |
                 FCM wake-up received ("run command X")
                     |
                 Start foreground service
                     |
                 Connect WebSocket, execute command, stream results
                     |
                 Command complete -> disconnect WebSocket, stop foreground service
                     |
                 Return to FCM-only state
```

This reduces battery drain from ~1%/hour continuous to near-zero when idle, with momentary spikes during command execution. WhatsApp, Signal, and Telegram all use this pattern.

### iOS

iOS is far more restrictive than Android for background execution:

- **No persistent WebSocket in background**: iOS suspends apps ~30 seconds after backgrounding. WebSocket connections are dropped.
- **APNs (Apple Push Notification Service)**: Equivalent of FCM. Required for waking apps. Silent push notifications can trigger background processing.
- **URLSession background configuration**: Can handle network tasks after app suspension, but limited to uploads/downloads, not arbitrary WebSocket communication.
- **Background App Refresh**: Periodically wakes app for brief updates (not real-time).
- **PushKit (VoIP)**: Allows persistent connections but Apple restricts to actual VoIP apps. Misuse gets you rejected from App Store.

**iOS architecture for Daemon**: APNs push to wake -> start background task -> HTTP request to get command -> execute -> report result via HTTP POST -> suspend. No persistent WebSocket.

### Battery Impact Measurements

| Approach | Battery/Hour | Notes |
|----------|-------------|-------|
| Persistent WebSocket (30s heartbeat) | ~1.0% | WhatsApp-like |
| Persistent WebSocket (60s heartbeat) | ~0.5-0.7% | Reduced heartbeat |
| HTTP polling (every 30s) | ~1.2-1.5% | Connect/disconnect overhead |
| FCM/APNs only (idle) | ~0.0-0.1% | Google/Apple maintains connection |
| Push notifications background process | 8-15 mAh/hr | Industry measurement |
| Cloud backup sync | 20-35 mAh/hr | For reference |

### How WhatsApp Maintains Its Connection

1. Long-lived TCP socket to Erlang backend (modified XMPP/FunXMPP protocol)
2. 30-second heartbeats to keep connection alive
3. FCM as fallback wake-up mechanism when socket drops
4. Automatic reconnect + message sync on reconnection
5. Each server node manages hundreds of thousands of connections
6. Signal Protocol E2E encryption wraps every packet (even "typing" indicators)

---

## 5. Device Capability Abstraction

### Current Approach (JSON Capabilities)

```json
{
  "shell": true,
  "files": true,
  "clipboard": true,
  "notifications": true,
  "browser": false
}
```

Simple, works. But no standard for describing what parameters a command takes, what it returns, or how to compose capabilities.

### MCP (Model Context Protocol) -- Strongly Recommended

MCP is the emerging standard for how AI agents interact with tools and data sources. Created by Anthropic (November 2024), now under the Linux Foundation's Agentic AI Foundation (AAIF) alongside OpenAI, Google, Microsoft, AWS, and Block.

**Why MCP fits Daemon perfectly:**

1. **Standard tool definitions**: Each device capability becomes an MCP tool with typed parameters and return values
2. **AI-native**: Claude, ChatGPT, Copilot, and Gemini all support MCP natively. Daemon's AI agent can call device tools through a standard protocol
3. **Security model**: OAuth 2.1 authorization, incremental scope negotiation, least-privilege enforcement
4. **Async execution**: November 2025 spec added long-running task support -- perfect for device commands that take time
5. **Multimodal**: 2026 spec adds image/video/audio support -- relevant for device cameras, screenshots, screen recording

**Architecture with MCP:**
```
Daemon Server (MCP Client / AI Agent)
    |
    |-- MCP transport (over existing WebSocket) -->  Phone (MCP Server)
    |                                                  tools: [shell, files, camera, notifications, ...]
    |
    |-- MCP transport (over existing WebSocket) -->  Laptop (MCP Server)
    |                                                  tools: [shell, files, browser, clipboard, ...]
    |
    |-- MCP transport (over existing WebSocket) -->  Watch (MCP Server)
                                                      tools: [notifications, sensors, haptics, ...]
```

Each device bridge runs an MCP server that exposes its capabilities as MCP tools. The Daemon AI agent is an MCP client that discovers and calls tools across all connected devices through a single, standard protocol.

**Key benefit**: Any MCP-compatible AI (Claude, GPT, Gemini) could control Daemon devices without custom integration code.

### A2A (Agent-to-Agent Protocol)

Created by Google (April 2025). Also under AAIF. Complementary to MCP, not competing:

- **MCP**: Agent-to-tool communication (AI calls a device capability)
- **A2A**: Agent-to-agent communication (one AI delegates to another AI)

A2A reached v1.0 in early 2026 with gRPC support, signed Agent Cards, and multi-tenancy. However, adoption is slower than MCP -- most multi-agent frameworks (LangGraph, CrewAI, AutoGen) handle agent coordination internally.

**Relevance for Daemon**: A2A becomes relevant if Daemon evolves into a multi-agent system where device-local AI agents coordinate with the central AI agent. Not needed now, but worth tracking.

### USB/IP, RDP, VNC

These are relevant for specific use cases:
- **USB/IP**: Forward USB devices over network. Niche -- only useful if Daemon needs to access hardware (e.g., forward a phone's USB-connected Arduino to the server)
- **RDP/VNC**: Remote desktop. Already solved by existing tools. Daemon should integrate with them rather than reimplementing (e.g., an MCP tool that starts a VNC session)

### Recommendation

**Implement MCP as the device capability protocol.** Each bridge exposes an MCP server. Transport MCP messages over the existing WebSocket connection. This gives Daemon:
1. Standard, typed tool definitions
2. Native compatibility with every major AI model
3. Built-in auth and async execution patterns
4. Future-proof as the ecosystem grows

---

## 6. Cross-Platform Bridge Implementation

### Current Stack

| Platform | Language | Framework | Notes |
|----------|----------|-----------|-------|
| CLI/Server | Node.js | - | Runs on Linux/Mac |
| Android | Kotlin | Jetpack Compose + WebView | Foreground service for connection |
| Desktop | Rust | Tauri | WebView-based UI |

### Option A: Everything in Rust

**Pros:**
- Single codebase for all platforms
- Best performance and memory safety
- Dioxus framework enables web + desktop + mobile from one codebase (2025-2026 viable)
- Tauri 2.0 supports Android and iOS alongside desktop

**Cons:**
- Rust mobile ecosystem still maturing (Dioxus mobile is experimental)
- Android integration (notifications, foreground services, system APIs) requires JNI bridges
- Steep learning curve for contributors
- iOS App Store compliance with Rust is possible but less documented

**Verdict**: Too early for "everything Rust." Good for the bridge/transport layer, not for platform-specific UI and system integration.

### Option B: Everything in Go

**Pros:**
- Simple language, fast compilation, excellent cross-compilation
- Good network programming story
- Fyne framework provides cross-platform GUI (desktop + mobile)

**Cons:**
- Go mobile support is second-class (Fyne mobile is basic)
- Go binaries are larger than Rust
- Garbage collector adds unpredictable latency
- No mainstream adoption for mobile apps

**Verdict**: Good for server-side and CLI tools. Not recommended for mobile bridges.

### Option C: Kotlin Multiplatform (KMP)

**Pros:**
- Adoption doubled from 7% to 18% (2024-2025). Used by Netflix, McDonald's, Airbnb, Duolingo
- Native on Android. Compiles to native on iOS, JS for web, JVM for server
- "Shared core + native UI" architecture is the 2026 default: business logic shared, UI native per platform
- Rust can be integrated for performance-critical components (crypto, ML inference)

**Cons:**
- Desktop support less mature than mobile
- Requires JetBrains ecosystem buy-in
- iOS compilation can be slow

**Verdict**: Strong option for sharing bridge logic across Android and iOS while keeping native UI.

### Option D: Keep Current Mixed Stack (Recommended)

| Layer | Technology | Rationale |
|-------|-----------|-----------|
| Bridge transport/protocol | Rust library (shared) | Compile to native on all platforms. Handles WebSocket, MCP, encryption |
| Android app | Kotlin + Compose | Native Android. Best system integration (foreground services, FCM, notifications) |
| iOS app (future) | Swift + SwiftUI | Native iOS. Required for APNs, background tasks, App Store |
| Desktop app | Rust + Tauri | Already working. WebView UI is fine for desktop |
| CLI | Rust or Node.js | Either works. Rust for single binary distribution |

**Key insight from industry**: The trend in 2025-2026 is complementary use -- Kotlin Multiplatform for shared business logic with Rust for performance-critical shared components. Don't force one language across all platforms.

### Recommendation

**Write the bridge protocol layer (WebSocket management, MCP client/server, message framing, encryption) in Rust as a shared library.** Expose it via:
- Direct linking in Tauri desktop app
- JNI/UniFFI bindings for Kotlin Android
- Swift bindings for future iOS
- WASM or FFI for Node.js CLI

This gives you one protocol implementation tested once, with native platform integration where it matters (Android services, iOS background tasks, desktop system tray).

---

## 7. File Transfer Between Devices

### Current (Base64 over WebSocket, ~10MB limit)

Simple but severely limited. Base64 encoding adds 33% overhead. WebSocket frames aren't designed for large binary transfers.

### Option A: Chunked Binary WebSocket Frames

Send files as binary WebSocket frames in chunks (e.g., 64KB-1MB per frame).

| Aspect | Rating |
|--------|--------|
| Complexity | Low -- small change to existing transport |
| Max file size | Unlimited (streaming) |
| Resumability | None without additional protocol |
| Speed | Good for files up to ~100MB |

### Option B: HTTP Upload/Download (Separate Channel)

Device uploads file to server via HTTP POST (multipart or streaming). Recipient downloads via HTTP GET.

| Aspect | Rating |
|--------|--------|
| Complexity | Low -- standard HTTP |
| Max file size | Unlimited |
| Resumability | Possible with Range headers |
| Speed | Good. Can use CDN if files go through Cloudflare |

### Option C: TUS Protocol (Resumable Uploads)

Open protocol for resumable uploads built on HTTP. Used by Cloudflare, Supabase, Vimeo.

| Aspect | Rating |
|--------|--------|
| Complexity | Medium -- need tus server (reference implementation in Go: tusd) |
| Max file size | Unlimited |
| Resumability | Excellent -- built-in. Resume from exact byte offset after interruption |
| Speed | Good. Supports parallel chunk uploads (concatenation extension) |

**Key feature**: Client can upload chunks of any size, resume after network failure, and server concatenates. IETF is standardizing as "Resumable Uploads for HTTP."

### Option D: WebRTC Data Channels (P2P)

Direct device-to-device file transfer using WebRTC.

| Aspect | Rating |
|--------|--------|
| Complexity | High -- need signaling server, STUN/TURN, ICE negotiation |
| Max file size | Unlimited but slow for large files |
| Resumability | Must implement manually |
| Speed | Variable. WebRTC data channel speed is documented as "extremely slow" in some implementations. 40%+ of connections need TURN relay, adding cost and latency |

**Verdict**: Not recommended for Daemon. The complexity and unreliability don't justify the P2P benefit when you already have a server.

### Option E: Syncthing-Style Continuous Sync

Syncthing's Block Exchange Protocol (BEP) over TLS 1.3. Files split into 128KB-16MB blocks. Only changed blocks transferred. P2P with relay fallback.

| Aspect | Rating |
|--------|--------|
| Complexity | High if building from scratch. Could embed Syncthing |
| Max file size | Unlimited |
| Resumability | Excellent -- block-level delta sync |
| Speed | Excellent for incremental sync (only changed blocks) |

**Best for**: Continuous folder synchronization. Overkill for on-demand file transfer.

### Recommendation: Tiered Approach

```
Small files (<1MB):     Binary WebSocket frames (current transport, drop base64)
Medium files (1-100MB): HTTP upload to server, HTTP download to recipient
Large files (>100MB):   TUS resumable upload protocol
Same-LAN transfers:     Direct HTTP between devices (discovered via mDNS)
```

**Implementation priority:**
1. **Immediate**: Switch from base64 to binary WebSocket frames for small files
2. **Next**: Add HTTP upload/download endpoint on server for medium files
3. **Later**: Add TUS for large/unreliable transfers
4. **Optional**: LAN-direct transfer for devices on same network

---

## Summary: What Real Products Actually Use

| Product | Topology | Transport | NAT Strategy | Mobile Persistence | File Transfer |
|---------|----------|-----------|-------------|-------------------|---------------|
| **WhatsApp** | Star (Erlang) | Custom TCP (FunXMPP) | All outbound | WebSocket + FCM fallback | Via server relay |
| **Signal** | Star | WebSocket | All outbound | WebSocket + FCM/APNs | Via server relay |
| **Telegram** | Star (custom MTProto) | Custom TCP/UDP | All outbound | Persistent + push | Via server relay |
| **KDE Connect** | Mesh (LAN only) | TCP direct | LAN only (no NAT) | N/A (desktop focus) | Direct TCP |
| **Apple AirDrop** | Mesh (local) | AWDL (Wi-Fi Direct) | N/A (local only) | N/A | Direct Wi-Fi |
| **Apple Continuity** | Hybrid (iCloud + BLE + WiFi) | BLE + Wi-Fi Direct | iCloud relay | APNs | BLE/Wi-Fi Direct |
| **Pushbullet** | Star (cloud) | HTTPS/REST | All outbound | FCM | Via server relay |
| **Microsoft Phone Link** | Star (cloud) | Wi-Fi + Bluetooth | Wi-Fi/BT | Background service | Wi-Fi Direct |
| **Tailscale** | Hybrid (DERP + P2P) | WireGuard (UDP) | STUN + DERP relay | Persistent VPN | Direct WireGuard |
| **Syncthing** | Mesh + relay | TLS 1.3 (BEP) | Relay fallback | Limited | BEP block exchange |

---

## Architecture Recommendations for Daemon

### Keep
- **Star topology** with server as relay (matches AI agent architecture)
- **WebSocket** as primary transport (mature, bidirectional, universal)
- **Cloudflare Tunnel** for server exposure (free, production-grade)
- **Kotlin + Compose** for Android bridge (best system integration)

### Add
- **MCP protocol** for device capability abstraction (each bridge = MCP server)
- **FCM/APNs wake-up** instead of persistent foreground service (massive battery savings)
- **Binary WebSocket frames** for small file transfer (drop base64 encoding)
- **HTTP upload/download** for medium files, TUS for large files
- **Rust shared library** for protocol layer (WebSocket, MCP, encryption)
- **mDNS discovery** for LAN-direct file transfers between co-located devices

### Defer
- WebTransport (revisit 2027 when mobile SDKs exist)
- MQTT (only if scaling to 50+ devices)
- A2A protocol (only if multi-agent coordination needed)
- Full mesh topology (unnecessary for AI agent use case)
- WebRTC data channels (too complex, unreliable for file transfer)

### Priority Order
1. Switch to FCM wake-up model (biggest user-facing improvement: battery life)
2. Implement MCP on device bridges (biggest architectural improvement: standard tool protocol)
3. Fix file transfer (binary frames + HTTP upload)
4. Rust shared protocol library (long-term maintainability)
5. LAN-direct optimization (nice-to-have for power users)

---

## Sources

### Connection Topologies
- [KDE Connect](https://kdeconnect.kde.org/)
- [KDE Connect Protocol - KDE Community Wiki](https://community.kde.org/KDEConnect)
- [KDE Connect mDNS Discovery](https://invent.kde.org/network/kdeconnect-android/-/merge_requests/375)
- [The Road to KDE Connect 2.0](https://albertvaka.wordpress.com/2023/04/11/the-road-to-kde-connect-2-0/)
- [Apple Continuity Protocol](https://www.btframework.com/continuity.htm)
- [Handoff All Your Privacy - Apple BLE Continuity Protocol](https://ar5iv.labs.arxiv.org/html/1904.10600)
- [Apple Wireless Direct Link (AWDL)](https://owlink.org/)
- [Disrupting Continuity of Apple's Wireless Ecosystem Security](https://www.usenix.org/system/files/sec21-stute.pdf)
- [Microsoft Phone Link - Wikipedia](https://en.wikipedia.org/wiki/Phone_Link)
- [Pushbullet API](https://docs.pushbullet.com/)

### Transport Protocols
- [WebTransport vs WebSocket 2025 Comparison](https://markaicode.com/vs/webtransport-vs-websocket/)
- [FOSDEM 2026: Intro to WebTransport](https://www.infoq.com/news/2026/03/fosdem-webtransport-vs-websocket/)
- [Future of WebSockets: HTTP/3, WebTransport & Beyond](https://websocket.org/guides/future-of-websockets/)
- [WebSocket vs HTTP, SSE, MQTT, WebRTC & More (2026)](https://websocket.org/comparisons/)
- [Beyond WebSockets: Mastering WebTransport (35% Latency Cut)](https://www.vroble.com/2025/11/beyond-websockets-mastering.html)
- [SSE vs WebSockets Comparison](https://softwaremill.com/sse-vs-websockets-comparing-real-time-communication-protocols/)
- [Streaming APIs: SSE, WebSocket, MQTT, AMQP, gRPC](https://www.aklivity.io/post/streaming-apis-and-protocols-sse-websocket-mqtt-amqp-grpc)
- [gRPC vs WebSocket](https://ably.com/topic/grpc-vs-websocket)
- [MQTT vs WebSocket: IoT Messaging](https://websocket.org/comparisons/mqtt/)

### NAT Traversal
- [Tailscale NAT Traversal Improvements](https://tailscale.com/blog/nat-traversal-improvements-pt-1)
- [Tailscale Peer Relays (DERP)](https://www.sitepoint.com/tailscale-peer-relays-nat-traversal-derp/)
- [Tailscale DERP Servers Documentation](https://tailscale.com/kb/1232/derp-servers)
- [Tailscale Connection Types](https://tailscale.com/kb/1257/connection-types)
- [Cloudflare Tunnel vs ngrok vs Tailscale](https://dev.to/mechcloud_academy/cloudflare-tunnel-vs-ngrok-vs-tailscale-choosing-the-right-secure-tunneling-solution-4inm)
- [Top Cloudflare Tunnel Alternatives 2026](https://pinggy.io/blog/best_cloudflare_tunnel_alternatives/)

### Mobile Persistence
- [FCM on Android (2025)](https://firebase.blog/posts/2025/04/fcm-on-android/)
- [Android Doze and App Standby](https://developer.android.com/training/monitoring-device-state/doze-standby)
- [FCM Message Priority](https://firebase.google.com/docs/cloud-messaging/android-message-priority)
- [iOS WebSocket Real-Time Communication 2025](https://www.videosdk.live/developer-hub/websocket/ios-websocket)
- [Building Real-Time Features on iOS](https://ravi6997.medium.com/building-real-time-features-on-ios-websockets-push-notifications-real-time-sync-what-0a92f46ff5e9)
- [WhatsApp System Design Architecture](https://medium.com/@yadavsatale/whatsapp-system-design-a-complete-architecture-deep-dive-8949f8d4eb2b)
- [WhatsApp Real-Time Infrastructure](https://medium.com/@ygsh0816/inside-whatsapps-real-time-infrastructure-the-magic-behind-online-and-typing-f9ac648fb2e7)
- [WebSocket Battery Drain - ntfy Issue](https://github.com/binwiederhier/ntfy/issues/190)
- [WebSocket Mobile Testing - Battery Optimization](https://yrkan.com/blog/websocket-mobile-testing/)

### Device Capability Abstraction
- [MCP Specification (November 2025)](https://modelcontextprotocol.io/specification/2025-11-25)
- [Model Context Protocol - Wikipedia](https://en.wikipedia.org/wiki/Model_Context_Protocol)
- [MCP's Next Phase: November 2025 Spec](https://medium.com/@dave-patten/mcps-next-phase-inside-the-november-2025-specification-49f298502b03)
- [MCP Explained: Why It Matters in 2026](https://robomotion.io/blog/mcp-explained-why-model-context-protocol-matters-in-2026)
- [MCP vs A2A: Developer's Guide 2026](https://torchproxies.com/mcp-vs-a2a-the-developers-guide-to-ai-agent-protocols-in-2026/)
- [A2A and MCP: AI Agent Protocol Wars](https://www.koyeb.com/blog/a2a-and-mcp-start-of-the-ai-agent-protocol-wars)
- [MCP vs A2A: When to Use Each (2026)](https://apigene.ai/blog/mcp-vs-a2a-when-to-use-each-protocol)

### Cross-Platform Development
- [Kotlin Multiplatform 2026 Predictions](https://www.aetherius-solutions.com/blog-posts/kotlin-multiplatform-in-2026)
- [Rust + Kotlin Multiplatform](https://yoo.be/rust-kotlin-multiplatform/)
- [Cross-Platform Development Tools Comparison 2026](https://codenote.net/en/posts/cross-platform-dev-tools-comparison-2026/)
- [Dioxus: Rust Cross-Platform Framework](https://dioxuslabs.com/)
- [Tauri 2.0](https://v2.tauri.app/)

### File Transfer
- [TUS Resumable Upload Protocol](https://tus.io/)
- [TUS Protocol Specification](https://tus.io/protocols/resumable-upload)
- [Syncthing Block Exchange Protocol](https://docs.syncthing.net/specs/bep-v1.html)
- [WebRTC NAT Traversal: STUN, TURN, ICE](https://www.nihardaily.com/168-webrtc-nat-traversal-understanding-stun-turn-and-ice)
- [WebRTC Architecture 2025](https://www.moontechnolabs.com/blog/webrtc-architecture/)
