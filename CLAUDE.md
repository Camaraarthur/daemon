# Daemon Development Guide

## Architecture

- **Web UI**: Next.js 16 at `web/` (port 4802, proxied through `proxy.js` on 4800)
- **WebSocket server**: `ws-server.js` (port 4801) handles device connections
- **Device bridges**: `cli/daemon.mjs` (Node.js), `android/` (Kotlin), `desktop/` (Tauri/Rust)
- **Database**: SQLite at `data/users.db` (use `web/src/lib/db.ts` for access)
- **Protocol spec**: `protocol/types.ts`

## Key files

- `web/src/lib/agent-loop.ts` — AI agent tool execution loop (lint-on-edit, plan/act mode)
- `web/src/lib/agent-loop-streaming.ts` — Streaming variant of agent loop
- `web/src/lib/model-router.ts` — Routes to Qwen/DeepSeek/Claude based on tier
- `web/src/lib/db.ts` — Database access layer with migrations
- `web/src/lib/auth.ts` — Authentication and session management
- `web/src/lib/sanitize.ts` — Input sanitization functions
- `web/src/lib/safety-check.ts` — Command safety validation
- `web/src/lib/slash-commands.ts` — Slash command parser
- `web/src/app/api/chat/route.ts` — Main chat API endpoint
- `web/src/app/api/stream/route.ts` — Streaming chat endpoint
- `web/ws-server.js` — WebSocket server for device connections
- `cli/daemon.mjs` — Cross-platform device bridge (Node.js)
- `desktop/` — Tauri/Rust desktop bridge
- `SPEC.md` — The definitive v0 specification

## Rules

- ALWAYS read SPEC.md before making architectural decisions
- ALWAYS run `cd web && npm run build` after making web changes to verify compilation
- NEVER modify `protocol/types.ts` without updating SPEC.md
- NEVER add billing, voice, personality, or hardware code (not in v0 scope)
- NEVER store API keys in code — use vault.env or environment variables
- ALWAYS add `user_id` filtering to database queries (multi-tenant isolation)
- ALWAYS use `sanitize.ts` functions for user input before database or shell operations
- ALWAYS use `safety-check.ts` before executing user-provided commands
- NEVER bypass the sandbox (Docker/bwrap) for agent-executed commands
- NEVER import from `web/src/` in `cli/` or `desktop/` — protocol types are the shared contract
- When adding API routes, follow the existing pattern in `web/src/app/api/`
- When adding agent tools, add them to `AGENT_TOOLS` array in `agent-loop.ts`

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
