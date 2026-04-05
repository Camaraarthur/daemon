# Daemon v0 Architecture: The Correct First Brick

**Date**: 2026-04-05
**Author**: Arthur + Claude Opus (deep research)
**Purpose**: Define which architectural decisions are irreversible, which are swappable, and what the v0 foundation must look like to support the long-term vision of a device-agnostic AI OS.

---

## Table of Contents

1. [The Irreversible vs. Swappable Matrix](#1-the-irreversible-vs-swappable-matrix)
2. [Protocol as the Core](#2-protocol-as-the-core)
3. [Crowdsourced Code Management](#3-crowdsourced-code-management)
4. [What to Strip for v0](#4-what-to-strip-for-v0)
5. [Monorepo vs. Multi-Repo](#5-monorepo-vs-multi-repo)
6. [The Device-Agnostic OS Long-Term Vision](#6-the-device-agnostic-os-long-term-vision)
7. [What to Ship This Week](#7-what-to-ship-this-week)
8. [Technology Bets](#8-technology-bets)
9. [The v0 Architecture Blueprint](#9-the-v0-architecture-blueprint)
10. [Sources](#10-sources)

---

## 1. The Irreversible vs. Swappable Matrix

### Lessons from Linux, Android, and Kubernetes

**Linux** chose a monolithic kernel over a microkernel (the Tanenbaum-Torvalds debate). This was "wrong" by academic standards but pragmatically right: it was simpler to get working, and performance was better. The monolithic architecture became irreversible -- but it succeeded because the *interface* (POSIX syscalls, everything-is-a-file) was clean enough that the internals could be refactored endlessly. Linux's scaling secret was not the kernel architecture but the **hierarchical maintainer governance model**: subsystem maintainers review patches in their domain, then feed up to Linus. The architecture of *contribution* mattered more than the architecture of *code*.

**Android** chose Linux as its kernel, open-sourced under Apache 2.0 (not GPL for userland), and introduced the Hardware Abstraction Layer (HAL). The HAL was the key irreversible decision: it meant Android could run on any hardware without rewriting the OS. The other irreversible decision was the Intent system -- every app could expose capabilities and invoke other apps' capabilities through a standard protocol. This made the ecosystem composable.

**Kubernetes** inherited from Google's Borg and learned from its mistakes. The key insight: controllers/operators can see the *entire* state of the world and are expected to "play nice together." The declarative, reconciliation-loop architecture (desired state vs. actual state) proved to be the right abstraction. What they got wrong: the complexity barrier. K8s became so complex that an entire industry (Helm, Rancher, managed K8s) exists just to make it usable.

### The Matrix for Daemon

| Decision | Irreversible? | Why |
|----------|:---:|------|
| **Protocol format** (message types, device handshake, tool invocation) | YES | Every client implementation depends on this. Changing it breaks all devices. |
| **Auth architecture** (how devices authenticate, how users prove identity) | YES | Baked into every client. OAuth vs tokens vs keys -- pick once. |
| **Data ownership model** (where does user data live? Who controls it?) | YES | Defines trust model, compliance, and whether self-hosting works. |
| **Open-source license** | YES | Apache 2.0 vs AGPL vs MIT changes who can use it commercially. |
| **Extension/skill format** (how third-party code integrates) | YES | Community builds on this. Changing it breaks the ecosystem. |
| **Sync primitive** (how device state converges) | MOSTLY | Can evolve but the *model* (event sourcing vs. CRDT vs. server-canonical) is hard to change. |
| Database (SQLite, Postgres, etc.) | No | Data access is behind an abstraction. Swap freely. |
| UI framework (Next.js, Svelte, etc.) | No | Frontend is a client of the protocol. Rebuild anytime. |
| Hosting (Cloudflare, AWS, self-hosted) | No | Protocol is transport-agnostic. |
| Programming language of server | Mostly no | As long as the protocol is implemented correctly. |
| LLM provider (Claude, Gemini, DeepSeek) | No | Model-agnostic by design. |

### The Rule

**If it affects the protocol wire format, the auth handshake, the data ownership model, or the extension interface -- it's irreversible. Everything else is implementation detail.**

---

## 2. Protocol as the Core

### The HTTP Analogy

HTTP defined the web, not Apache or Nginx. SMTP defined email, not Outlook or Gmail. The most successful platforms are defined by their **protocol**, not their implementation.

Daemon should follow this pattern. The "Daemon Protocol" should be a spec that any implementation can follow. This enables:

1. **Alternative implementations**: Someone can write a Daemon server in Go, Rust, or Python
2. **Interoperability**: Daemons can talk to each other (via A2A)
3. **Community ownership**: The protocol belongs to the community, even if the reference implementation is Arthur's
4. **Longevity**: Implementations come and go; protocols endure

### Protocol Layers

```
Layer 4: Application Skills (MCP tools, integrations, automations)
Layer 3: Agent Loop (model routing, tool execution, sandboxing)
Layer 2: Device Mesh (device discovery, capability exchange, state sync)
Layer 1: Daemon Protocol (auth, message format, session management)
Layer 0: Transport (WebSocket today, WebTransport later -- protocol doesn't care)
```

### MCP as the Integration Standard

MCP has won. As of 2026:
- 97 million monthly SDK downloads
- 5,800+ community servers
- Adopted by Anthropic, OpenAI, Google, Microsoft, Amazon
- Donated to Linux Foundation (Agentic AI Foundation)
- Every major IDE and coding platform supports it

**Decision: Daemon skills are MCP servers. Period.** No custom skill format. An MCP server that works with Claude Desktop works with Daemon. This is the single most important ecosystem decision for v0.

### A2A for Daemon-to-Daemon

Google's Agent2Agent protocol (A2A) is gaining traction:
- 150+ supported organizations
- JSON-RPC 2.0 over HTTPS
- Agent Cards for capability discovery
- gRPC support as of v0.3

**Decision: Daemon-to-daemon communication uses A2A.** When Arthur's daemon on arturito wants to invoke a skill on the MSI daemon, it uses A2A. This also means third-party daemons can interoperate.

### The Daemon Protocol Spec (v0)

The v0 protocol must define exactly these message types:

```
// Authentication
auth.hello          → device identifies itself, capabilities, platform
auth.challenge      → server sends challenge
auth.verify         → device proves identity
auth.session        → server grants session token

// Chat
chat.send           → user message
chat.stream         → streamed assistant response (chunks)
chat.tool_call      → agent invokes a tool
chat.tool_result    → tool returns result
chat.complete       → response finished

// Device Mesh
device.register     → add device to mesh
device.heartbeat    → keep-alive with state
device.capability   → declare what this device can do
device.invoke       → ask a specific device to do something
device.result       → device returns result

// Memory
memory.store        → persist a fact/context
memory.query        → retrieve relevant memories
memory.sync         → sync memory state across devices

// Skills (MCP pass-through)
skill.list          → list available MCP servers
skill.invoke        → call an MCP tool
skill.result        → tool result
```

**This spec is the v0 deliverable.** The reference implementation proves the spec works. But the spec is the product.

---

## 3. Crowdsourced Code Management

### The Problem

OpenClaw proved that open community contributions at scale create a security nightmare:
- 12% of ClawHub skills contained malicious code or serious security flaws
- 824+ malicious skills identified in the ClawHavoc campaign
- CVE-2026-32922 scored 9.9 on CVSS (privilege escalation)
- 18,000+ exposed instances vulnerable to attack
- Low publishing barrier (GitHub account >1 week old) with no pre-publication review

### The Stripe/Minions Model

Stripe's approach to AI-managed code is the gold standard:
- Fork of Goose (Block's open-source agent) customized for Stripe's infra
- 1,300+ PRs/week, zero human-written code
- Each Minion gets an isolated VM (same as human dev boxes, 10-second spin-up)
- No internet access, no production access -- completely sandboxed
- Handles predictable work: flaky tests, migrations, well-specified features
- Complex work bails out to humans

### Daemon's Code Management Architecture

**Three-tier review pipeline:**

```
Tier 1: Automated Gates (blocks bad PRs instantly)
├── Static analysis (Semgrep, CodeQL)
├── Dependency scanning (no new unvetted deps)
├── Sandbox execution (run the skill in gVisor, monitor syscalls)
├── Permission manifest validation (skill declares what it needs)
├── Cryptographic signing requirement
└── OWASP Agentic AI Top 10 checklist

Tier 2: AI Review Agent (reviews surviving PRs)
├── CodeRabbit or PR-Agent integration for line-by-line review
├── Behavioral analysis: does the code do what its description says?
├── Cross-reference with existing skills for duplication
├── Security-specific LLM pass (prompt injection, data exfil patterns)
└── Generates human-readable summary

Tier 3: Human Maintainer (final approval)
├── Domain expert reviews AI summary + diffs
├── Tests in staging environment
├── Signs off with maintainer key
└── Merge to main
```

**Skill publishing requirements (non-negotiable for v0):**

1. **Signed manifests**: Every skill must declare permissions (network, filesystem, shell, etc.) in a machine-readable manifest, cryptographically signed by the author
2. **Sandbox-first execution**: Skills run in gVisor containers by default. Network access is opt-in and requires explicit user approval
3. **Attestation chain**: SHA-256 Merkle tree attestation for every published skill (following STSS pattern)
4. **Author identity**: Verified GitHub identity + minimum account age + contribution history
5. **Reproducible builds**: Skill must build deterministically from source

**What NOT to do:**
- Don't build a custom skill registry. Use GitHub repos + npm/pip packages + MCP server standard
- Don't allow arbitrary code execution without user consent
- Don't trust community-submitted code by default -- sandbox everything

---

## 4. What to Strip for v0

### Current Codebase Inventory

| Component | Lines (est.) | v0 Core? | Rationale |
|-----------|:---:|:---:|------|
| WebSocket protocol (ws-protocol.ts) | ~200 | YES | But rewrite to Daemon Protocol spec |
| Model router (model-router.ts) | ~300 | YES | Core value prop: multi-model |
| Agent loop (agent-loop.ts) | ~400 | YES | Tool use for all tiers |
| Auth (auth.ts) | ~150 | YES | But simplify: API key + OAuth |
| SQLite DB (db.ts) | ~200 | YES | Projects, threads, messages |
| Streaming (streaming.ts) | ~150 | YES | SSE for chat responses |
| Safety check (safety-check.ts) | ~100 | YES | Keep but simplify |
| File verification (file-verification.ts) | ~100 | YES | Editing the right file |
| Billing (billing.ts) | ~300 | NO | Not for v0 open source |
| API registry (api-registry.ts) | ~200 | NO | Marketplace is post-v0 |
| Voice client (voice-client.ts) | ~200 | NO | Nice-to-have, not core |
| Slash commands (slash-commands.ts) | ~150 | MAYBE | Keep if simple |
| Personality engine (server/personality.py) | ~500 | NO | Not core |
| ESP32/hardware (server/esp32_*) | ~1000 | NO | Hardware pendant is separate product |
| Watch app (watch/) | ~2000 | NO | Post-v0 |
| Voice companion (server/voice_companion.py) | ~500 | NO | Post-v0 |
| Knowledge graph (server/knowledge.py) | ~400 | NO | Replace with simpler memory |
| Gemini live (server/gemini_live.py) | ~300 | NO | Post-v0 |

### v0 Core (what ships)

```
daemon/
├── protocol/
│   └── SPEC.md              ← The Daemon Protocol specification
├── server/                   ← Reference server implementation
│   ├── src/
│   │   ├── protocol.ts       ← Message types + handlers
│   │   ├── auth.ts           ← Device auth + user auth
│   │   ├── agent-loop.ts     ← Tool execution in sandbox
│   │   ├── model-router.ts   ← Multi-model routing (BYOK)
│   │   ├── memory.ts         ← Simple key-value + vector memory
│   │   ├── device-mesh.ts    ← Device registration + capability exchange
│   │   ├── db.ts             ← SQLite (projects, threads, messages)
│   │   └── mcp-bridge.ts     ← MCP server integration
│   └── Dockerfile
├── web/                      ← Web client (reference UI)
│   ├── src/
│   │   ├── chat/             ← Chat interface
│   │   ├── devices/          ← Device mesh dashboard
│   │   ├── projects/         ← Project management
│   │   └── settings/         ← Model config, API keys
│   └── package.json
├── cli/                      ← CLI client
│   └── daemon.ts             ← Terminal interface
├── android/                  ← Android client
│   └── (Kotlin/Compose, DaemonService)
├── desktop/                  ← Desktop client (Tauri)
│   └── (Rust + shared web UI)
└── docker/
    └── sandbox/              ← gVisor sandbox for tool execution
```

### What to keep private (NOT in the open-source repo)

- Billing/payments code (Stripe integration)
- API broker key management
- Arthur's personal server configuration
- Cloudflare tunnel configs
- User analytics
- The personality engine (potential future differentiator)

---

## 5. Monorepo vs. Multi-Repo

### Research Findings

**Monorepo projects**: Supabase, Tailscale, Turborepo, Vercel -- all use monorepo successfully for open source.

**Multi-repo projects**: Kubernetes (but wishes it hadn't -- cross-repo coordination is painful), Hashicorp tools.

**Key factors:**
- Monorepo: better visibility, simpler dependency management, single CI pipeline, atomic changes across components
- Multi-repo: independent versioning, cleaner ownership boundaries, smaller clones
- At Daemon's current scale (<50k LOC), monorepo overhead is near zero
- Multi-repo only makes sense at >100 contributors or >1M LOC

### Decision: Monorepo

```
daemon/
├── packages/
│   ├── protocol/       ← Shared types + spec (npm package: @daemon/protocol)
│   ├── server/         ← Reference server
│   ├── web/            ← Web client
│   ├── cli/            ← CLI client
│   ├── android/        ← Android app
│   └── desktop/        ← Tauri desktop app
├── docker/
├── docs/
├── .github/workflows/  ← Single CI for everything
└── turbo.json          ← Turborepo for build orchestration
```

**The `@daemon/protocol` package is the linchpin.** It defines TypeScript types for every message, and every client/server imports from it. This guarantees type safety across the entire stack.

When the project grows beyond ~50 active contributors, consider extracting `android/` and `desktop/` into separate repos (they have different build toolchains). But not before.

---

## 6. The Device-Agnostic OS Long-Term Vision

### From Chat Agent to Operating System

The path from "AI chat app" to "AI operating system" has historical precedent:

**Plan 9** (Bell Labs, 1992) treated *everything* as a file -- network, processes, other machines' filesystems. It was too early but the concept was right. Daemon's equivalent: **everything is an MCP tool**. A file on your laptop, a camera on your phone, a deployment on Cloudflare -- they're all tools the daemon can invoke.

**Fuchsia** (Google) was designed with AI interaction in mind from day one. A user could be browsing restaurant reviews, open their calendar, and say "invite Samantha to lunch" -- the OS had all the context. It failed commercially but proved the concept: an AI OS needs **ambient context** across all apps.

**The 2026 landscape**: AI agents are evolving from reactive chatbots to proactive "autonomous task engines." Gemini and Siri are both moving toward OS-level integration.

### The MCP-as-Syscall Model

In a traditional OS:
```
Application → Syscall → Kernel → Hardware
```

In the Daemon OS:
```
User Intent → Daemon Protocol → Agent Loop → MCP Tools → Devices/Services
```

Every device capability is an MCP server:
- Phone camera → `mcp-camera` (take photo, scan document, video call)
- Laptop terminal → `mcp-shell` (run commands, git, build)
- Smart home → `mcp-home` (lights, thermostat, locks)
- Cloud services → `mcp-deploy` (Cloudflare, Railway, Vercel)

The daemon doesn't need to know *how* to control a camera. It just needs to know that `mcp-camera` exists on the phone device, and it can invoke `take_photo()`. The MCP server on the phone handles the platform-specific implementation.

### The 5-Year Path

| Year | Milestone | What It Looks Like |
|------|-----------|-------------------|
| 2026 Q2 | v0: Protocol + Reference Implementation | Chat + tool use + device mesh. Arthur uses it daily. |
| 2026 Q3-Q4 | v0.5: Community + Skills | MCP skill marketplace. 10 active contributors. First BYOK users. |
| 2027 H1 | v1: Multi-Device Reality | Phone + laptop + server as one computer. Stable enough for daily use by 100 people. |
| 2027 H2 | v1.5: Proactive Agent | Daemon suggests actions based on context. "You have a meeting in 30min, should I summarize the PR you were reviewing?" |
| 2028 | v2: OS Layer | Daemon as launcher/home screen on Android. Desktop widget/overlay on Mac/Windows. Always-on ambient context. |
| 2029-2030 | v3: Multi-User | Daemons negotiate on behalf of their users. "My daemon, schedule a meeting with your daemon." (A2A protocol.) |

### Is This Realistic?

Yes, if:
1. The protocol is right (v0 gets this right)
2. MCP adoption continues (it's accelerating)
3. The community builds skills (open source + security done right)
4. Arthur uses it daily (dogfooding catches problems fast)

No, if:
1. Google ships Gemini OS and it's good (biggest threat)
2. Apple opens up Siri to third-party agents (unlikely but possible)
3. The protocol is wrong and needs breaking changes (why v0 matters so much)

---

## 7. What to Ship This Week

### The Single Most Impressive Demo

After analyzing what converts developer-tool users in 2026, the pattern is clear: **immediate, tangible value that you can't get anywhere else.**

Three candidates:

| Demo | "Holy shit" factor | Technical difficulty | Unique to Daemon? |
|------|:---:|:---:|:---:|
| "Install in 30s, connect phone, copy on phone paste on laptop" | Medium | Medium (needs Android app + device mesh) | YES |
| "Talk to your daemon, it deploys to your subdomain" | High | High (needs voice + Cloudflare automation) | No (Goose can do this) |
| "Import ChatGPT/Claude history, your daemon already knows you" | High | Low (JSON parsing) | YES |

### Recommendation: The "30-Second Setup" Demo

**Why this wins:**
1. It's the only thing nobody else does (multi-device is the moat)
2. It's viscerally impressive (type on phone, appears on laptop -- magic)
3. It proves the hard problem (device mesh) works
4. Low bar to try: `npx daemon-setup` or `curl -sSL daemon.page/install | sh`
5. It's the foundation everything else builds on

**Demo script (90 seconds):**
```
1. Terminal: curl -sSL daemon.page/install | sh
2. Browser opens: daemon.page/setup (or localhost:4800)
3. QR code appears
4. Scan with phone → installs PWA or Android app
5. Phone registers in device mesh (shows up on web dashboard)
6. Type on phone: "list my recent git commits"
7. Daemon runs git log on the server, streams response to both phone and browser
8. Type on browser: "take a photo with my phone"
9. Phone camera opens, takes photo, appears in browser chat
```

**What this requires for v0:**
- Server: WebSocket + auth + device mesh + basic agent loop
- Web: Chat UI + device panel + QR setup flow
- Android: WebSocket service + basic tool execution (shell, camera)
- Protocol: auth.hello, chat.send/stream, device.register/invoke

**What this does NOT require:**
- Billing, API marketplace, personality engine, voice, watch, ESP32, desktop app, Claude Code import, git integration, Cloudflare automation

### The v0 Cut

Ship ONLY what's needed for the demo. Everything else is v0.1+.

---

## 8. Technology Bets

### Safe Bets (high confidence, low risk)

| Technology | Why Safe | Evidence |
|-----------|---------|---------|
| **WebSocket** for real-time | 99%+ browser support, mature tooling, every device supports it | WebTransport is 2-3 years from production-ready. Use WS now, migrate later if needed. Transport layer is swappable. |
| **SQLite** for local data | Zero-config, embedded, fast for single-user | Every device can run SQLite. Perfect for local-first. Add Postgres for multi-tenant server later. |
| **MCP** for integrations | Industry standard, Linux Foundation governance, 97M monthly downloads | Anthropic, OpenAI, Google, Microsoft all adopted it. This is not going away. |
| **TypeScript** for server | Shared types with web client, huge ecosystem, Arthur knows it | The `@daemon/protocol` package enforces type safety across server + web + CLI. |
| **Kotlin** for Android | Google's official language, Jetpack Compose is mature | Already built. No reason to change. |
| **Docker/gVisor** for sandboxing | Industry standard, already running on arturito | Agent sandbox is a solved problem at this scale. |

### Moderate Bets (good reasons, some risk)

| Technology | Why | Risk |
|-----------|-----|------|
| **Tauri** for desktop | 10x smaller than Electron, lower memory, better security | Smaller ecosystem than Electron. WebKit rendering differences on Linux. But 35% YoY adoption growth and Tauri 2.0 is production-ready. |
| **A2A** for daemon-to-daemon | Google-backed, 150+ org support, sensible design | Still at v0.3. May evolve significantly. But the concept (agent cards + JSON-RPC) is simple enough to implement and migrate. |
| **Automerge/CRDTs** for sync | Local-first is the right model for multi-device | Complex to implement correctly. Metadata bloat. But the alternative (server-canonical with conflict resolution) is worse for offline-first devices. |

### Risky Bets (avoid for v0)

| Technology | Why Risky | Alternative |
|-----------|----------|------------|
| **Rust for server core** | Arthur doesn't know Rust. Hiring is harder. Development is slower. | TypeScript server is fine for v0 scale. Rewrite hot paths in Rust later if needed (like Goose did). |
| **WebTransport** | 75% browser support, no Safari, no production server infra | WebSocket. Revisit in 2028. |
| **Custom sync protocol** | Building sync is one of the hardest problems in distributed systems | Use Automerge or PowerSync for sync. Don't build your own. |
| **PostgreSQL for v0** | Adds operational complexity (need a running Postgres instance) | SQLite for v0. Postgres when you need multi-tenant or >1000 users. |

### The Load-Bearing Bet: MCP

MCP is the single technology bet that matters most. If MCP fails or forks, Daemon's integration story breaks. But with Linux Foundation governance, universal adoption, and 97M monthly downloads, this is the safest infrastructure bet in the AI ecosystem right now.

---

## 9. The v0 Architecture Blueprint

### Principles

1. **Protocol-first**: The Daemon Protocol spec is the primary deliverable. The reference implementation proves it works.
2. **MCP-native**: Every integration is an MCP server. No custom skill format.
3. **Local-first**: Data lives on the device. Server is a relay + sync point, not the source of truth.
4. **Device-agnostic**: The protocol doesn't know or care what device it's talking to. Capabilities are discovered at runtime.
5. **BYOK-default**: Users bring their own API keys. No vendor lock-in.
6. **Secure by default**: Sandboxed execution, signed skills, no network access without consent.

### Architecture Diagram

```
                    ┌──────────────────────────────────┐
                    │         Daemon Server             │
                    │  (Reference Implementation)       │
                    │                                   │
                    │  ┌───────────┐  ┌──────────────┐ │
                    │  │  Auth     │  │ Device Mesh   │ │
                    │  │  Engine   │  │ Registry      │ │
                    │  └───────────┘  └──────────────┘ │
                    │  ┌───────────┐  ┌──────────────┐ │
                    │  │  Agent    │  │ Model        │ │
                    │  │  Loop     │  │ Router       │ │
                    │  └───────────┘  └──────────────┘ │
                    │  ┌───────────┐  ┌──────────────┐ │
                    │  │  Memory   │  │ MCP Bridge   │ │
                    │  │  Store    │  │              │ │
                    │  └───────────┘  └──────────────┘ │
                    │  ┌───────────────────────────────┐│
                    │  │  SQLite (projects, threads,   ││
                    │  │  messages, device registry)    ││
                    │  └───────────────────────────────┘│
                    └──────────────┬───────────────────┘
                                  │
                    Daemon Protocol (WebSocket + JSON)
                                  │
           ┌──────────────────────┼──────────────────────┐
           │                      │                      │
    ┌──────┴──────┐      ┌───────┴───────┐      ┌──────┴──────┐
    │  Web Client │      │ Android Client│      │Desktop (Tau-│
    │  (Next.js)  │      │ (Kotlin)      │      │ri) / CLI    │
    │             │      │               │      │             │
    │ Chat UI     │      │ DaemonService │      │ Terminal UI │
    │ Device Dash │      │ Tool Executors│      │ Chat UI     │
    │ Project Mgr │      │ (camera, GPS, │      │ Tool Exec   │
    │ Settings    │      │  shell, files)│      │             │
    └─────────────┘      └───────────────┘      └─────────────┘

           │                      │                      │
    ┌──────┴──────┐      ┌───────┴───────┐      ┌──────┴──────┐
    │ Local SQLite│      │ Local SQLite  │      │ Local SQLite│
    │ (cache +    │      │ (offline msg  │      │ (session    │
    │  memory)    │      │  queue)       │      │  history)   │
    └─────────────┘      └───────────────┘      └─────────────┘
```

### Auth Architecture (Irreversible -- Get It Right)

```
Device Registration Flow:
1. User generates invite link on web dashboard (contains one-time token)
2. Device scans QR / opens link
3. Device sends auth.hello with:
   - device_id (generated on first run, stored locally)
   - platform (android/windows/macos/linux/web)
   - capabilities (list of MCP tool names this device supports)
   - invite_token (one-time)
4. Server validates token, registers device, returns:
   - session_token (long-lived, rotated monthly)
   - server_public_key (for future E2E encryption)
5. Subsequent connections use session_token in WS handshake

User Auth Flow:
- v0: Google OAuth (Arthur already has this working)
- v0.1: Add GitHub OAuth (for developer audience)
- v1: Add passkeys/WebAuthn
- BYOK: API keys stored locally on server, never transmitted to Daemon cloud
```

### Data Model (Irreversible -- Get It Right)

```sql
-- Core tables (SQLite, server-side)
CREATE TABLE users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE,
    name TEXT,
    auth_provider TEXT,       -- 'google' | 'github'
    created_at INTEGER,
    settings TEXT              -- JSON blob: model preferences, theme, etc.
);

CREATE TABLE devices (
    id TEXT PRIMARY KEY,
    user_id TEXT REFERENCES users(id),
    name TEXT,                 -- user-assigned friendly name
    platform TEXT,             -- 'android' | 'windows' | 'macos' | 'linux' | 'web'
    capabilities TEXT,         -- JSON array of MCP tool names
    last_seen INTEGER,
    session_token_hash TEXT,
    status TEXT DEFAULT 'online'  -- 'online' | 'offline' | 'sleeping'
);

CREATE TABLE projects (
    id TEXT PRIMARY KEY,
    user_id TEXT REFERENCES users(id),
    name TEXT,
    display_name TEXT,
    local_path TEXT,           -- path on the PRIMARY device
    git_remote TEXT,
    settings TEXT,             -- JSON blob
    created_at INTEGER,
    last_active INTEGER
);

CREATE TABLE threads (
    id TEXT PRIMARY KEY,
    project_id TEXT REFERENCES projects(id),
    user_id TEXT REFERENCES users(id),
    title TEXT,
    model_tier TEXT,           -- 'free' | 'mid' | 'premium'
    created_at INTEGER,
    last_message_at INTEGER
);

CREATE TABLE messages (
    id TEXT PRIMARY KEY,
    thread_id TEXT REFERENCES threads(id),
    role TEXT,                 -- 'user' | 'assistant' | 'tool_call' | 'tool_result'
    content TEXT,
    model TEXT,                -- which model generated this
    tool_name TEXT,            -- for tool_call/tool_result messages
    tool_input TEXT,           -- JSON
    tool_output TEXT,          -- JSON
    device_id TEXT,            -- which device originated this message
    created_at INTEGER
);

CREATE TABLE memories (
    id TEXT PRIMARY KEY,
    user_id TEXT REFERENCES users(id),
    project_id TEXT,           -- NULL for global memories
    content TEXT,
    embedding BLOB,            -- vector for semantic search
    source TEXT,               -- 'user' | 'agent' | 'imported'
    created_at INTEGER
);

CREATE TABLE mcp_servers (
    id TEXT PRIMARY KEY,
    user_id TEXT REFERENCES users(id),
    name TEXT,                 -- e.g. 'github', 'gmail', 'home-assistant'
    command TEXT,              -- how to start it
    args TEXT,                 -- JSON array
    env TEXT,                  -- JSON object (API keys etc., encrypted)
    enabled INTEGER DEFAULT 1,
    device_id TEXT             -- NULL = server-side, or specific device
);
```

### Open-Source License Decision

**Apache 2.0** for the protocol spec, server, web, CLI, and desktop.

Reasoning:
- Apache 2.0 is what Android, Kubernetes, and MCP use
- It allows commercial use without copyleft obligations (unlike AGPL)
- It includes a patent grant (unlike MIT)
- Companies can build on Daemon without fear of license contamination
- The community growth potential is maximized

**Private/proprietary**: Billing service, API broker, hosted infrastructure. These are the business, not the product.

### What v0 Does NOT Include (Explicitly)

- No billing or payments
- No API marketplace or skill registry
- No voice/audio features
- No watch app
- No ESP32/hardware pendant
- No personality engine
- No InDesign integration
- No credits system
- No hosted multi-tenant service
- No Claude Code import (v0.1)
- No git integration (v0.1)
- No Cloudflare automation (v0.1)

These are all good features. They're all v0.1 or later. v0 is the protocol + device mesh + chat + tools.

---

## 10. Sources

### Platform Architecture History
- [Tanenbaum-Torvalds Debate](https://en.wikipedia.org/wiki/Tanenbaum%E2%80%93Torvalds_debate) -- Linux kernel monolithic vs microkernel decision
- [Global Collaboration in Linux Kernel Development](https://www.exam-labs.com/blog/global-collaboration-in-linux-kernel-development) -- Hierarchical maintainer governance
- [Android Platform Architecture](https://developer.android.com/guide/platform) -- HAL, Intent system, Linux kernel foundation
- [Android Architecture Overview (AOSP)](https://source.android.com/docs/core/architecture) -- Hardware abstraction layer design
- [Borg, Omega, and Kubernetes (Google Research)](https://research.google/pubs/archive/44843.pdf) -- K8s design heritage from Borg
- [What Kubernetes Got Right, and Mesos Got Wrong](https://xkyle.com/What-Kubernetes-Got-Right-and-Mesos-Got-Wrong/) -- Declarative state model
- [10 Years of Kubernetes: A Retrospective](https://medium.com/@platform.engineers/10-years-of-kubernetes-a-retrospective-c11b8fbd608c)

### AI Code Management
- [How Stripe's Minions Ship 1300 PRs a Week](https://blog.bytebytego.com/p/how-stripes-minions-ship-1300-prs) -- Five-layer pipeline architecture
- [Stripe Minions Blueprint Architecture (MindStudio)](https://www.mindstudio.ai/blog/stripe-minions-blueprint-architecture-deterministic-agentic-nodes) -- Deterministic + agentic node design
- [CodeRabbit Review 2026](https://vibecoding.app/blog/coderabbit-review) -- AI code review at scale
- [Block/Goose (GitHub)](https://github.com/block/goose) -- Open-source AI agent framework that Stripe forked

### Protocol Standards
- [MCP Wikipedia](https://en.wikipedia.org/wiki/Model_Context_Protocol) -- 97M monthly SDK downloads, Linux Foundation governance
- [MCP Roadmap 2026 (The New Stack)](https://thenewstack.io/model-context-protocol-roadmap-2026/) -- Production growing pains being solved
- [Why the Model Context Protocol Won](https://thenewstack.io/why-the-model-context-protocol-won/) -- Universal adoption analysis
- [A2A Protocol Specification](https://a2a-protocol.org/latest/specification/) -- Agent2Agent v0.3 spec
- [A2A Protocol Google Blog](https://developers.googleblog.com/en/a2a-a-new-era-of-agent-interoperability/) -- 150+ organizations
- [Developer's Guide to AI Agent Protocols (Google)](https://developers.googleblog.com/developers-guide-to-ai-agent-protocols/)

### Security
- [OpenClaw Security Risks (Sangfor)](https://www.sangfor.com/blog/cybersecurity/openclaw-ai-agent-security-risks-2026) -- ClawHavoc campaign, 12% malicious skills
- [CVE-2026-32922: OpenClaw Privilege Escalation (ARMO)](https://www.armosec.io/blog/cve-2026-32922-openclaw-privilege-escalation-cloud-security/) -- CVSS 9.9
- [Nine CVEs in Four Days (OpenClaw Blog)](https://openclawai.io/blog/openclaw-cve-flood-nine-vulnerabilities-four-days-march-2026)
- [OWASP AI Agent Security Top 10 2026](https://medium.com/@oracle_43885/owasps-ai-agent-security-top-10-agent-security-risks-2026-fc5c435e86eb)
- [Microsoft Agent Governance Toolkit](https://opensource.microsoft.com/blog/2026/04/02/introducing-the-agent-governance-toolkit-open-source-runtime-security-for-ai-agents/)
- [How to Sandbox AI Agents in 2026 (Northflank)](https://northflank.com/blog/how-to-sandbox-ai-agents) -- gVisor, MicroVMs, isolation strategies
- [SandyClaw Dynamic Sandbox](https://www.businesswire.com/news/home/20260402370756/en/Permiso-Security-Launches-SandyClaw-the-First-Dynamic-Sandbox-for-AI-Agent-Skills)

### Technology Decisions
- [WebSocket vs WebTransport (WebSocket.org)](https://websocket.org/comparisons/webtransport/) -- WebTransport not production-ready until 2027-2028
- [FOSDEM 2026: WebTransport (InfoQ)](https://www.infoq.com/news/2026/03/fosdem-webtransport-vs-websocket/)
- [SQLite vs PostgreSQL 2026 (SelectHub)](https://www.selecthub.com/relational-database-solutions/postgresql-vs-sqlite/)
- [PowerSync v1.0: Postgres-SQLite Sync](https://www.powersync.com/blog/introducing-powersync-v1-0-postgres-sqlite-sync-layer)
- [Tauri vs Electron 2026 Guide](https://blog.nishikanta.in/tauri-vs-electron-the-complete-developers-guide-2026) -- Tauri 2.0 production-ready, 40% faster startup
- [Tauri vs Electron (DoltHub)](https://www.dolthub.com/blog/2025-11-13-electron-vs-tauri/)
- [Rust vs Go vs Node.js 2026](https://caffeinatedcoder.medium.com/rust-vs-go-vs-node-js-which-backend-language-will-dominate-in-2026-b46e652d12f4)

### Sync & Local-First
- [Local-First Architecture Shift 2026 (DEV Community)](https://dev.to/the_nortern_dev/the-architecture-shift-why-im-betting-on-local-first-in-2026-1nh6)
- [FOSDEM 2026: Local-First, Sync Engines, CRDTs](https://fosdem.org/2026/schedule/track/local-first/)
- [CRDT Implementation Guide (OneUptime)](https://oneuptime.com/blog/post/2026-01-30-crdt-implementation/view)
- [Protocol Buffer CRDTs (CloudKitchens)](https://techblog.cloudkitchens.com/p/protocol-buffer-crdts-outperforming)

### Open Source Strategy
- [Monorepo vs Multi-Repo (Kodus)](https://kodus.io/en/monorepo-vs-multi-repo-strategy/)
- [What is Monorepo? (Semaphore)](https://semaphore.io/blog/what-is-monorepo)
- [Claw Code Open-Source AI Framework](https://www.24-7pressrelease.com/press-release/533389/claw-code-launches-open-source-ai-coding-agent-framework-with-72000-github-stars-in-first-days) -- Open harness architecture
- [Goose: Block's Open Source AI Agent](https://block.github.io/goose/) -- MCP-native, model-agnostic

### AI OS Vision
- [From Chatbots to AI Agents: The New Operating System 2026](https://vucense.com/ai-intelligence/agentic-ai/from-chatbots-to-agents-ai-operating-systems-2026/)
- [Plan 9: The Unsung OS (Oreate AI)](https://www.oreateai.com/blog/plan-9-the-unsung-operating-system-that-dreamed-of-a-networked-future/d30d065bc1ea30c79febdfc06dc49658)
- [How to Build an AI Operating System 2026 (TechTiff)](https://techtiff.substack.com/p/the-2026-ai-operating-system)
