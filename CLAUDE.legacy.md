# Daemon Development Guide

## Architecture (post relay/device split — v1 in progress)

The architecture is locked at **`docs/architecture.md`** — read it before
making any structural decisions. Headlines:

- **Control plane = relay** (Tailscale-style switchboard, no user content).
  Lives in `web/` (Next.js + ws-server.js). Auth, WS routing, device
  registry, pairing codes, model API calls, agent loop. Persistent state
  is metadata only — NO chat content, NO memory blocks, NO facts.

- **Data plane = devices**. Every chat message, every memory block,
  every project fact lives on the user's daemon device's local SQLite
  at `~/.daemon/store.db`. The device daemon (`cli/daemon.mjs`)
  exposes them via WS handlers (`chat.fetch_messages`, `memory.remember`,
  `memory.recall`, etc.).

- **Three communication channels**:
  1. WS push (`ws-server.js` → browser via `/ws/client`) — live thread
     events to subscribed browsers
  2. Gossip (relay → device via `/gossip/chat-message` and `/command`
     with `chat.message_imported`) — relay fans persisted state out to
     the user's devices
  3. Device dispatch (relay → device via `/command` and `/skill/invoke`)
     — agent tool calls and memory ops route to the user's primary device

## Key files

### Relay (web/)
- `web/src/app/api/chat/route.ts` — Main chat API endpoint (no longer
  writes chat content; pure router + broadcaster + gossip publisher)
- `web/src/lib/agent-loop.ts` and `agent-loop-streaming.ts` — AI agent
  tool dispatch. NO local execution. All tool calls go through
  `invokeDeviceTool` to the user's daemon device via the WS hub.
- `web/src/lib/streaming-writer.ts` — Pure broadcaster (WS push +
  gossip). Generates message ids, no DB writes.
- `web/src/lib/device-store.ts` — Relay-side wrapper for fetching chat
  messages from a user's device via WS
- `web/src/lib/device-memory.ts` — Relay-side wrapper for memory ops
  (remember/recall/blocks/facts) routed to the device
- `web/src/lib/memory-tools.ts` — Memory tool definitions exposed to the
  agent loop; routes through device-memory.ts
- `web/src/lib/ws-broadcast.ts` — `broadcastThreadEvent` (WS push to
  browsers) and `gossipChatMessage` (push to user's daemon devices)
- `web/src/lib/db.ts` — Relay's SQLite schema. Holds: users, sessions,
  device_tokens, projects, chat_threads (metadata only), claude_code_links,
  claude_session_cursors, project_memory (legacy), user_rules, usage_log.
  DOES NOT hold: chat_messages content, memory_blocks, project_facts.
- `web/src/lib/model-router.ts` — Routes to Qwen/DeepSeek/Claude
- `web/src/lib/auth.ts` — Authentication and session management
- `web/src/lib/sanitize.ts` — Input sanitization
- `web/src/lib/safety-check.ts` — Command safety validation
- `web/ws-server.js` — WebSocket server. Per-user device maps,
  `/command`, `/skill/invoke`, `/tools`, `/gossip/chat-message`,
  `/broadcast`, `/ws/device`, `/ws/client`

### Device (cli/, desktop/, android/)
- `cli/daemon.mjs` — Headless device daemon (Node.js + node:sqlite).
  Connects to ws-server via `/ws/device`. 9 tools: bash, read_file,
  write_file, edit_file, list_files, glob, grep, lint_file, device_info.
  Plus 7 memory.* handlers and chat.fetch_messages handler.
- `cli/store.mjs` — Device-side SQLite at `~/.daemon/store.db`. The
  source of truth for chat content + memory.
- `cli/mcp-memory-server.mjs` — Standalone MCP server exposing the
  daemon's memory tools to Claude Code via stdio. Reads/writes the same
  store.db. Registered in `~/.claude.json` under `mcpServers.daemon-memory`.
- `desktop/` — Tauri/Rust desktop app (Linux/Mac/Windows shell)
- `android/` — Kotlin device daemon
- `protocol/types.ts` — Shared protocol contract between all clients

### Docs
- `docs/architecture.md` — **Source of truth.** All v1 design decisions.
- `SPEC.md` — Original v0 spec, partly superseded by architecture.md

## Rules

- ALWAYS read `docs/architecture.md` before making architectural decisions
- ALWAYS run `cd web && npm run build` after making web changes
- NEVER add code that persists user content on the relay's data/users.db
  (chat, memory, files, prompts). Content lives on the device.
- NEVER add direct exec/spawn calls in the relay process for agent tool
  execution. The relay is a router. The device is the sandbox boundary.
  Tool calls go through `invokeDeviceTool` → `/skill/invoke` → device.
- NEVER store API keys in code — use vault.env or environment variables
- ALWAYS add `user_id` filtering to database queries (multi-tenant)
- ALWAYS use `sanitize.ts` functions for user input
- NEVER import from `web/src/` in `cli/` or `desktop/` — protocol types
  are the shared contract
- When adding API routes, follow the existing pattern in `web/src/app/api/`
- When adding agent tools, add them to `cli/daemon.mjs` MCP_TOOLS and
  the `executeMcpTool` switch — they automatically become available
  to the agent via `/tools` discovery

## Build & test commands

```bash
# Web (Next.js)
cd web && npm run build          # Type-check + build
cd web && npm run dev            # Dev server on :4802

# Android
cd android && ./gradlew assembleRelease --no-daemon
./scripts/build-test-deploy.sh   # Full APK build-test-deploy cycle

# Desktop (Tauri/Rust, cross-compile for Windows)
cd desktop && cargo xwin build --release --target x86_64-pc-windows-msvc

# Chat quality test
./scripts/test-chat.sh           # Sends test prompts, checks responses

# Pre-commit checks (auto-runs on commit)
.githooks/pre-commit             # Secret scan + TypeScript check
```

## Testing the chat API

```bash
# Get a valid token
TOKEN=$(sqlite3 data/users.db "SELECT token FROM sessions WHERE user_id = 3 AND (expires_at IS NULL OR expires_at > datetime('now')) ORDER BY created_at DESC LIMIT 1;")

# Send a message
curl -s -X POST http://localhost:4800/api/chat \
  -b "daemon_token=$TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"message":"hello","stream":false}'
```

## Project structure conventions

- API routes: `web/src/app/api/<resource>/route.ts`
- Shared lib: `web/src/lib/<module>.ts`
- UI components: `web/src/components/<Component>.tsx`
- Protocol: `protocol/types.ts` (shared between all clients)
- Scripts: `scripts/` (bash scripts for dev tooling)
- Docs/research: `docs/` (architecture, research, decisions)

## Current focus

Building v0 per SPEC.md. Phase 0 (foundation) and Phase 1 (core) are done.
Working on Phase 2 (polish) and Phase 3 (launch).
Key areas: agent coding quality (lint-on-edit, test-after-change, repo map), multi-device stability, deployment pipeline.
