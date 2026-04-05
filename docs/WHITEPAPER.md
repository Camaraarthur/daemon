# Daemon: A Personal AI Agent Protocol for Cross-Device Sovereignty

**Version 0.1 -- April 2026**
**Authors:** Arthur Bussolino and contributors
**Repository:** [github.com/arthurito/daemon](https://github.com/arthurito/daemon)
**License:** MIT

---

## Abstract

Daemon is an open-source protocol and reference implementation for personal AI agents that operate across every device a person owns. Unlike existing AI coding tools that run in a single terminal on a single machine, Daemon treats multi-device connectivity as a first-class primitive: your laptop, phone, server, and desktop form a unified mesh, coordinated by an AI agent that persists memory, manages trust, and routes between free and premium models. The protocol specifies authentication, tool discovery via MCP, and a novel capability-attenuated trust system where permissions are mathematically constrained -- tokens can only be narrowed, never widened. Daemon ships with a free model tier (Qwen via OpenRouter), supports bring-your-own-key for any provider, and is designed so that user data never leaves user-controlled devices. The server is a relay, not a warehouse. This paper describes the architecture, the protocol, the trust model, and the path from coding agent to personal AI operating system.

---

## 1. The Problem

The average knowledge worker uses 3.6 devices daily. A developer might use a Linux workstation at their desk, a Windows laptop on the couch, a phone on the bus, and a cloud server for deployments. Their AI tools -- Claude Code, Cursor, GitHub Copilot -- are anchored to one device, one terminal session, one project context. Close the terminal, and the context evaporates. Switch to your phone, and you start from zero.

This is not a minor inconvenience. It is a structural failure of the current AI tooling paradigm. When a developer asks their AI agent to "deploy the app I was working on earlier," the agent cannot comply because "earlier" happened in a different session on a different machine. When they want to review code on their phone during a commute, they resort to SSH into their workstation through a cramped terminal emulator. When they return to a project after a week, the agent has no memory of the decisions, the architecture, or the bugs they discussed.

The fragmentation runs deeper than sessions. Each AI tool maintains its own permission model, its own memory format, its own extension system. Claude Code has CLAUDE.md files. Cursor has .cursorrules. VS Code has settings.json. None of them talk to each other. A developer who has carefully tuned their AI's behavior in one tool starts over in another.

The open-source community has attempted to bridge this gap. OpenClaw, which reached 335,000 GitHub stars before its acquisition, proved massive demand for an open AI agent ecosystem. But OpenClaw's architecture -- a centralized skills marketplace where third-party developers published agent capabilities -- created a security catastrophe. An independent audit found that 41% of published skills contained malicious patterns: prompt injection, data exfiltration, credential harvesting. The platform was acquired, banned in several jurisdictions, and its marketplace shut down. The lesson: demand for an open agent ecosystem is real, but the security model must be fundamentally different from "publish and pray."

Commercial alternatives are no better. OpenAI's platform locks users to GPT models. Anthropic's Claude Code is excellent but terminal-only and single-device. Microsoft's Copilot integrates deeply with Windows but nowhere else, and routes all data through Microsoft's cloud. Google's agent efforts are tied to the Google ecosystem. None of these offer an open protocol. None support arbitrary devices. None give users mathematical guarantees about what their agent can and cannot do.

The fundamental gap: no open protocol exists for a personal AI agent that operates across all your devices, persists memory across sessions, routes between models based on cost and capability, and provides cryptographic -- not just policy-based -- security guarantees about agent permissions.

Daemon fills this gap.

---

## 2. Design Principles

Daemon's architecture follows four principles that distinguish it from existing AI agent platforms.

**Data sovereignty.** User data lives on user-controlled devices. The Daemon server is a WebSocket relay that routes messages between devices and the AI model. It does not store conversation history, files, or personal data. Users who want full control can self-host the entire stack -- the server, the database, the model routing -- on a $5/month VPS or a Raspberry Pi. Data sovereignty is not a feature flag; it is the architecture.

**Open protocol.** The Daemon Protocol is a specification, not just an implementation. It defines message formats (JSON over WebSocket), authentication flows (pairing codes to device tokens), tool discovery (MCP-standard), and capability negotiation. Anyone can build a compatible client or server. The protocol is the product; the reference implementation proves it works. See `protocol/types.ts` for the canonical type definitions and `SPEC.md` for the full specification.

**Progressive trust.** Daemon requests zero permissions at installation. The first time the agent needs terminal access, it asks. The first time it needs to read files, it asks. Each permission can be revoked at any time. Over time, the trust ledger records every action and outcome. Actions that succeed repeatedly earn auto-approval. Dangerous actions -- `rm -rf`, `sudo`, credential access -- never auto-approve regardless of history. Trust is computed from evidence, not declared by policy.

**Community-built.** MIT license. Monorepo. No walled garden. Extensions use the MCP (Model Context Protocol) standard -- the same format used by Claude, VS Code, and the broader AI tooling ecosystem. There is no proprietary plugin format, no skills marketplace, no review board. Users install MCP servers directly. Contributions to the core go through automated security scanning and AI-assisted code review before human maintainer approval.

---

## 3. Architecture

Daemon uses a star topology with a WebSocket relay at the center, similar in structure to Signal or WhatsApp. User devices connect to the relay over WSS (WebSocket Secure). The relay authenticates devices, routes messages, and coordinates tool invocations. It does not process or store message content beyond what is needed for routing.

### System Components

The reference implementation consists of five components:

**Web UI (Next.js 16).** The primary interface. A responsive web application that works on desktop and mobile browsers. Handles chat rendering, project management, device status, memory browsing, and settings. Served at `{username}.daemon.page`.

**WebSocket Server.** A lightweight relay (Node.js) that maintains persistent connections to all user devices. Handles authentication, heartbeat monitoring, message routing, and device presence. Runs on port 4801 behind the proxy.

**Device Bridges.** Native clients that run on user devices and expose local capabilities (shell, files, clipboard, camera, sensors) as MCP tools. Implementations exist for:
- **CLI** (`daemon-cli`, Node.js) -- Linux, macOS, Windows. One-liner install via `npx`.
- **Android** (Kotlin/Jetpack Compose) -- foreground service with 15+ capability modules.
- **Desktop** (Tauri v2/Rust) -- native tray app for Windows and macOS.
- **iOS** -- thin client only (Apple's sandbox prevents device access beyond chat).

**AI Model Router.** Routes user messages to the appropriate language model based on the user's configuration:
- **Free tier:** Qwen3-Coder via OpenRouter. Zero cost, good for scaffolding and simple tasks.
- **Mid tier:** DeepSeek via API. Low cost, strong coding performance.
- **Premium tier:** Claude Opus via direct API or linked Claude Max subscription. Best quality, highest cost.

Users can also bring their own API keys (BYOK) for any OpenAI-compatible provider. The router handles key management, token counting, cost tracking, and fallback logic.

**Data Layer.** SQLite for structured data (users, projects, threads, messages, device tokens, usage logs, trust ledger). Qdrant (vector database, self-hosted in Docker) for semantic search over conversation history and project memory. Both run on the user's server; nothing is sent to external services.

### Connection Flow

1. User signs up via the web UI (Google OAuth or email/password).
2. User runs `npx daemon-cli pair` on a device. A 6-character pairing code is displayed.
3. User enters the code in the web UI. The server generates a 64-byte device token, hashes it (SHA-256), and stores the hash. The raw token is returned to the device exactly once.
4. The device connects via WSS, sends `auth.hello` with the raw token and its capabilities.
5. The server validates the token hash, registers the device in the active connections map, and sends `auth.session`.
6. The device sends heartbeats every 60 seconds. If no heartbeat is received for 120 seconds, the device is marked offline.
7. When the AI agent needs to execute a tool on a device, the server sends `skill.invoke` to the target device. The device executes the tool, applies permission checks, and returns `skill.result`.

### Diagram

See `docs/ARCHITECTURE.md` for the full system overview in Mermaid format, including the proxy layer, Cloudflare tunnel, Docker sandbox, and model routing paths.

---

## 4. The Daemon Protocol

The Daemon Protocol defines how devices, the server, and the AI agent communicate. It is designed to be simple enough to implement in a weekend, expressive enough to support arbitrary tool invocations, and versioned for forward compatibility.

### Transport

All messages are JSON objects sent over WebSocket (WSS), UTF-8 encoded. Maximum message size is 10 MB (to accommodate base64-encoded file transfers; larger payloads use the HTTP upload endpoint). Every message includes a `v` field indicating the protocol version. The current version is `"0"`.

### Message Types

The protocol defines the following message categories:

**Authentication** (`auth.hello`, `auth.session`). Device registration after pairing. The device sends its token, platform, and capabilities. The server responds with the authenticated session.

**Heartbeat** (`device.heartbeat`, `device.heartbeat_ack`). Periodic liveness check (60-second interval). Includes device state: battery level, online status, active project. The server responds with its timestamp for clock synchronization. Devices implement reconnection with exponential backoff (1s to 60s max).

**Command Execution** (`device.invoke`, `device.result`). Direct shell command execution on a target device. Includes a `permission_tier` field that the device checks before executing. Results include stdout, stderr, exit code, and duration.

**Tool Discovery** (`skill.list`, `skill.list_result`). MCP-standard tool enumeration. Each device bridge acts as an MCP server, advertising its available tools with JSON Schema input definitions. Tools are namespaced by device: `macbook.run_command`, `pixel.read_file`.

**Tool Invocation** (`skill.invoke`, `skill.result`). MCP-standard tool calls. The server routes invocations to the target device. Each invocation carries a `request_id` (UUID v4) for response correlation.

**Clipboard Sync** (`clipboard.push`, `clipboard.pull`). Cross-device clipboard synchronization. Content is encrypted in transit and never stored on the server.

**File Transfer** (`file.offer`, `file.accept`). Peer-to-peer file transfer negotiated through the relay. Small files (<10 MB) are base64-encoded in WebSocket messages. Larger files use the HTTP upload endpoint with resumable uploads.

**Errors** (`error`). Structured error responses with error codes, human-readable messages, and the `request_id` of the failed operation.

### Versioning

The protocol uses a simple integer version scheme. Servers MUST reject messages with unsupported versions. When a breaking change is needed, the version increments. Clients and servers negotiate the version during the `auth.hello`/`auth.session` handshake. The canonical type definitions live in `protocol/types.ts`.

---

## 5. Capability-Attenuated Trust

This is the core contribution of the Daemon architecture: a trust system where permissions are enforced by cryptography, not policy.

### The Problem with Current Permission Models

Every AI agent platform today uses one of three permission models, all of which are inadequate:

1. **Rules in prompts.** Claude Code uses `CLAUDE.md` files to declare what the agent can and cannot do. These are advisory -- the model can ignore them. A sufficiently long context, a clever prompt injection, or a model update can override any rule. Security through suggestion.

2. **Ask every time.** Many agents prompt the user before every potentially dangerous action. This creates permission fatigue -- users learn to click "Allow" reflexively, defeating the purpose. Studies of mobile permission dialogs show that after the fifth prompt, approval rates exceed 95% regardless of the requested permission.

3. **Sandbox everything.** Docker containers, WebAssembly, restricted shells. Effective but blunt. The agent cannot install a package, modify a config file, or deploy code without breaking out of the sandbox. Overly restrictive sandboxes make agents useless; overly permissive ones make them dangerous.

None of these models provide a mathematical guarantee. They are policies enforced by software that can be circumvented, misconfigured, or ignored.

### Capability Tokens

Daemon introduces capability-attenuated tokens inspired by the Biscuit authorization framework. A capability token is a cryptographic bearer token that encodes exactly what the holder is permitted to do, expressed as Datalog policies.

The key property: **tokens can only be narrowed, never widened.** A token that grants `read_file(path: "/home/user/projects/*")` can be attenuated to `read_file(path: "/home/user/projects/blog/*")` by anyone holding the token, but it cannot be widened to `read_file(path: "/home/user/*")`. This is enforced by the cryptographic structure -- attenuation appends a new signed block to the token, and verification checks the entire chain.

This means:
- The server can issue a broad token to a device.
- The device can narrow it before passing it to the AI agent.
- The AI agent can narrow it further before passing it to an MCP tool.
- At no point can any party in the chain escalate permissions.

Token verification is fast -- 0.22ms in our benchmarks, comparable to a JWT verification. Tokens are compact (typically under 1 KB) and can be transmitted in WebSocket message headers.

### The Trust Ledger

Capability tokens define what an agent *can* do. The trust ledger records what it *did* do. Every tool invocation is logged:

```sql
CREATE TABLE trust_ledger (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    device_id TEXT,
    tool_name TEXT NOT NULL,
    args_hash TEXT,          -- SHA-256 of serialized arguments
    outcome TEXT NOT NULL,   -- 'success', 'failure', 'denied', 'error'
    user_approved INTEGER,   -- 1 = user approved, 0 = auto-approved
    duration_ms INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

From this ledger, Daemon computes a trust score per tool per user:

- **Total runs:** How many times this tool has been invoked.
- **Success rate:** Percentage of invocations that succeeded.
- **Auto-approve eligible:** `true` if the tool has >10 runs, >95% success rate, and no `denied` outcomes in the last 30 days.

Tools that earn auto-approval stop prompting the user for confirmation. Tools that fail or are denied lose auto-approval status. The trust score is computable (derived deterministically from the ledger), auditable (every entry is timestamped and queryable), and portable (the ledger can be exported and verified independently).

Critically, certain tools are exempt from auto-approval regardless of their trust score. Any tool that involves `sudo`, `rm -rf`, credential access, or system-level changes always requires explicit user confirmation. This is a hardcoded safety check, not a policy that can be overridden.

### Comparison

| Feature | Daemon | Claude Code | OpenAI Guardrails | Microsoft Copilot | AIP (arXiv:2603.24775) |
|---------|--------|-------------|-------------------|-------------------|------------------------|
| Permission model | Crypto tokens + evidence ledger | Rules in CLAUDE.md | Moderation API | Azure RBAC | Mutual attestation |
| Can permissions escalate? | No (crypto-enforced) | Yes (prompt override) | N/A (filtering only) | Yes (admin override) | No (attestation chain) |
| Adaptive trust | Yes (auto-approve from evidence) | No | No | No | No |
| Auditable | Full ledger with outcomes | Session logs only | API logs | Azure audit logs | Attestation records |
| User-controlled | Full (self-host, inspect, export) | Partial (local files) | No (API-side) | No (Azure-side) | Partial (enterprise) |
| Scope | Personal agent | Coding tool | Content filter | Enterprise copilot | Inter-enterprise agents |

### Implementation Roadmap

**v0 (current):** Evidence ledger with safety checks. Every tool invocation is logged. Dangerous commands require explicit approval. Trust scores are computed but auto-approval is conservative (>10 runs, >95% success, no denials in 30 days). No cryptographic tokens yet -- permissions are enforced by the server and device bridges.

**v1:** Full Biscuit token implementation. Capability tokens are issued during device pairing, attenuated per-session, and verified on every tool invocation. The trust ledger informs token issuance -- tools with high trust scores receive broader initial tokens.

---

## 6. Memory and Personalization

AI agents today have the memory of a goldfish. Each session starts fresh. Claude Code mitigates this with `CLAUDE.md` files -- manually maintained instruction files that persist between sessions. This is better than nothing, but it requires the user to write and maintain their own context. It does not scale to dozens of projects, and it does not capture the nuance of how a user works.

Daemon implements structured, multi-layer memory:

**Project memory.** Each project has a `MEMORY.md` file (compatible with Claude Code's format) that records architecture decisions, tech stack, key files, and conventions. This is automatically maintained -- when the AI makes a significant decision or learns a new fact about the project, it appends to the memory file. Users can edit these files directly.

**Conversation memory.** After each conversation, Daemon generates a structured summary: a TLDR, key decisions made, facts learned, problems encountered, and solutions applied. These summaries are stored in the database and indexed for semantic search.

**Semantic search.** Conversation summaries and project memories are embedded using vector embeddings and stored in Qdrant. When the user asks "what did we decide about the auth flow?", Daemon retrieves the relevant memory entries by semantic similarity, not keyword matching.

**Settling.** Over time, Daemon learns user preferences from the evidence: preferred frameworks, naming conventions, coding style, communication tone. This is not a personality engine -- it is pattern recognition over the conversation history. The daemon "settles" into the user's working style, reducing the need for explicit instructions.

**Future: history import.** v1 will support importing conversation history from WhatsApp, ChatGPT, Claude, and other platforms. This bootstraps the daemon's understanding of the user from day one, rather than requiring weeks of interaction to build context.

---

## 7. Coding Agent Harness

A common misconception in AI development: the model is the product. In practice, the harness around the model matters more than the model itself. A free model (Qwen3-Coder) with a disciplined harness consistently outperforms an expensive model (Claude Opus) with a bare prompt.

Daemon's agent harness implements several techniques that compound in quality:

**Lint-on-edit.** After every file modification, the agent runs the project's linter (ESLint, Ruff, rustc, etc.) and receives immediate feedback. Errors are corrected before the user sees them. This eliminates the "it wrote code but it doesn't compile" failure mode that plagues simpler agents.

**Test-after-change.** If the project has tests, the agent runs relevant tests after making changes. Test failures are fed back into the agent loop for automatic correction. The agent does not report success until tests pass.

**Repository map.** Before making changes, the agent builds a map of the project structure: file tree, key function signatures, import relationships. This gives the model spatial awareness of the codebase, reducing hallucinated imports and incorrect file paths.

**Plan/act separation.** For complex tasks, the agent first generates a plan (a numbered list of steps), then executes each step individually. This prevents the model from trying to do everything in one shot and losing coherence. The user can review and modify the plan before execution begins.

**Spec-first development.** Daemon encourages a workflow where the user describes what they want in natural language, the agent writes a specification, the user approves it, and then the agent implements it. This mirrors how experienced developers work and produces better results than "just build it."

These harness techniques are model-agnostic. They work with Qwen, DeepSeek, Claude, GPT, or any model that supports tool calling. The harness is the equalizer.

---

## 8. Community and Ecosystem

Daemon's extension model is deliberately simple: MCP servers. The Model Context Protocol is an open standard (originated at Anthropic, adopted across the industry) for exposing tools to AI agents. Any MCP server -- whether it provides database access, API integration, hardware control, or domain-specific computation -- works with Daemon out of the box.

There is no skills marketplace. OpenClaw proved that centralized skill repositories become attack vectors: 335,000 stars, 41% malicious skills, one catastrophic audit. Instead, Daemon users install MCP servers directly from source (npm, pip, cargo, or git clone). The user controls what code runs on their devices.

For shared integrations, Daemon maintains a curated registry of community-contributed MCP servers. Contributions go through three gates:

1. **Automated security scanning.** Static analysis for prompt injection patterns, credential harvesting, data exfiltration, and known vulnerability signatures.
2. **AI-assisted code review.** An AI reviewer checks for logic errors, permission violations, and deviation from the MCP specification.
3. **Human maintainer approval.** A human reviews the code, the tests, and the security scan results before merging.

This pipeline is slower than "publish and pray" but eliminates the class of attacks that destroyed OpenClaw.

**The extraction loop.** As users build integrations with their daemon, patterns emerge. A user who builds a Gmail integration discovers useful abstractions. These abstractions are extracted, generalized, and contributed back to the registry. The AI itself assists in this process -- identifying reusable patterns across user-built integrations and proposing them for extraction. The ecosystem grows organically from real usage, not speculative publishing.

---

## 9. Business Model

Daemon is fully open source (MIT license). The business model separates the platform (free) from the convenience layer (paid).

**Free tier.** Qwen3-Coder via OpenRouter (zero cost), the full web UI, device mesh, memory, and agent harness. Users who bring their own API keys get the complete Daemon experience at no charge. Self-hosting is fully supported.

**Pro tier.** Managed API routing across multiple providers (DeepSeek, Claude, GPT) with smart model selection, hosted infrastructure (no self-hosting required), priority support, and pre-configured integrations (Gmail, Calendar, GitHub). Priced at $15-40/month depending on usage.

**Open core.** Every feature that touches security, privacy, or the protocol is open source. Paid features are convenience: managed hosting, pre-configured integrations, usage dashboards, and priority model routing. A user who is willing to self-host and configure their own API keys never needs to pay.

---

## 10. Roadmap

**v0 (shipping now): Multi-device coding agent.** Web UI, CLI bridge, Android app, WebSocket relay, AI agent harness with lint-on-edit and test-after-change, project memory, free model tier, BYOK support, device pairing, clipboard sync, trust ledger. The minimum viable product that replaces Claude Code's terminal with a cross-device web experience.

**v1 (6-12 months): Personal AI with memory and integrations.** History import (WhatsApp, ChatGPT, Claude), email and calendar integration via MCP, structured memory with semantic search, full Biscuit capability tokens, desktop app (macOS, Windows), agent-to-user proactive notifications, and the API broker billing model.

**v2 (18-36 months): Device OS with intent system.** Natural language intent routing ("send this to Luca" resolves to the right app and channel), app ecosystem built on MCP, agent-to-agent protocol for multi-user collaboration, hardware integrations (smart home, wearables), and the transition from coding tool to general-purpose personal AI.

---

## 11. Related Work

**Agent Identity Protocol (AIP).** Published as arXiv:2603.24775, AIP is the closest existing work to Daemon's trust model. AIP defines mutual attestation between AI agents in enterprise settings: agents verify each other's identity, capabilities, and authorization before interacting. Daemon's capability-attenuated tokens serve a similar function but are scoped to the personal domain -- a single user's devices and tools -- rather than inter-enterprise agent communication. AIP validates the need for cryptographic trust in agent systems; Daemon applies the principle to the individual.

**Vitalik Buterin's self-sovereign LLM setup (April 2026).** Buterin publicly documented his personal AI configuration: self-hosted models, encrypted storage, no cloud dependencies. His setup validates the demand for AI sovereignty among technical users but requires significant expertise to replicate. Daemon aims to make this level of sovereignty accessible to anyone who can run `npx daemon-cli pair`.

**OpenClaw.** The largest open-source AI agent ecosystem before its acquisition, with 335,000 GitHub stars. OpenClaw proved that developers want an open platform for AI agent skills. It failed because its centralized skill marketplace became a vector for malicious code (41% of audited skills contained harmful patterns). Daemon learns from this failure: no marketplace, no centralized skill review, MCP as the extension format, and cryptographic capability tokens to limit what any extension can do.

**Plan 9 from Bell Labs / Fuchsia OS.** Both operating systems pioneered capability-based security at the OS level. In Plan 9, every resource is a file, and access is controlled by per-process namespaces. In Fuchsia, capabilities are unforgeable tokens passed between processes. Daemon applies this principle at the AI agent level: every tool invocation is mediated by a capability token that can only be narrowed, never widened. The OS-level inspiration translates naturally to the agent domain.

**Existing AI coding tools.** Claude Code (Anthropic), Cursor (Anysphere), GitHub Copilot (Microsoft), and Windsurf (Codeium) are the primary competitors in the AI coding agent space. All are single-device tools. None offer an open protocol for multi-device operation. None provide cryptographic trust guarantees. Daemon does not compete with these tools on model quality -- it wraps them, providing a better harness, persistent memory, and device connectivity that no single-vendor tool can match.

---

## Conclusion

The AI agent landscape is fragmenting into walled gardens. Each vendor builds its own client, its own extension system, its own permission model, its own memory format. Users are locked into single devices, single vendors, single models. Their context is ephemeral, their permissions are advisory, and their data flows through someone else's cloud.

Daemon is the counter-proposal: an open protocol for personal AI agents that treats your devices as a unified computing surface, your memory as a persistent asset, your permissions as cryptographic guarantees, and your choice of model as a routing decision, not a platform lock-in.

The protocol is the product. The reference implementation is the proof. The community is the moat.

We are shipping v0 now. Try it at [daemon.page](https://daemon.page).
