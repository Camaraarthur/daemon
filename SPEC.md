# Daemon v0 Specification

**Version:** 0.1.0
**Date:** April 5, 2026
**Status:** Canonical. All implementation decisions reference this document.

---

## 1. VISION

### What Daemon IS

Daemon is an open-source AI coding agent with terminal access to every device you own. You sign up, pair your devices, and chat with an AI that can run commands on your laptop, read files on your phone, sync your clipboard, and deploy apps to your personal page -- all through one conversation. It ships with a free model (Qwen via OpenRouter), supports bring-your-own-key for any provider, and treats multi-device connectivity as a first-class feature rather than an afterthought.

### What Daemon is NOT

- **Not a billing platform.** v0 has no Stripe, no credits, no subscriptions. Revenue comes later.
- **Not a voice companion.** No personality engine, no emotional AI, no character customization.
- **Not a skills marketplace.** No third-party plugin registry. Every tool is MCP-standard and user-installed.
- **Not an IDE.** Daemon is a chat-first agent, not a code editor. It executes commands on your behalf.
- **Not a hardware product.** No ESP32, no pendant, no watch app in v0.

### Three-Year Trajectory

| Version | Timeframe | Identity | Core Capability |
|---------|-----------|----------|----------------|
| **v0** | Now | Coding agent | Multi-device chat + terminal + deploy |
| **v1** | 6-12 months | Personal AI | Memory import, calendar, email, photos |
| **v2** | 18-36 months | Device OS | Intent system, app ecosystem, agent-to-agent |

### Core Principles

1. **Data sovereignty.** User data lives on the user's devices. The server is a relay and coordinator, not a data warehouse. Users can self-host the entire stack.
2. **Open protocol.** The Daemon Protocol is a spec, not just an implementation. Anyone can build a compatible client or server. The protocol is the product; the reference implementation proves it works.
3. **Progressive trust.** Daemon asks for zero permissions upfront. Each capability (terminal, files, clipboard, camera) is requested when first needed and can be revoked at any time.
4. **Community-built.** MIT license. Monorepo. No skills marketplace -- MCP servers are the extension format. Contributions go through automated security gates + AI review + human maintainer approval.

---

## 2. USER STORIES

### 2.1 Vibe Coder (Primary Target)

**Maya, 24, self-taught developer. Uses Claude Code and Cursor. Has a MacBook and a Pixel phone.**

1. Maya sees a Show HN post: "Daemon -- open-source AI agent that connects all your devices."
2. She visits **daemon.page**. The hero says "One AI. All your devices." with a 30-second demo video showing a conversation flowing from laptop to phone.
3. She clicks "Get Started" and signs in with Google. Takes 3 seconds.
4. She gets **maya.daemon.page** as her personal page.
5. The dashboard says "Connect a device to get started." She sees her OS auto-detected (macOS) and a one-liner: `npx daemon-cli pair`.
6. She runs it in her terminal. A 6-character code appears: `XK7M2P`. She types it into the web UI.
7. Her MacBook appears in the device list with a green dot. The chat says: "Connected to Maya's MacBook. I can now run commands and access files. What would you like to build?"
8. She types: "Build me a personal blog with a dark theme."
9. Daemon (using free Qwen model) scaffolds a Next.js site in her home directory, writes the pages, and says: "Ready. Type /deploy to publish it to maya.daemon.page."
10. She types `/deploy`. Daemon builds the site and deploys it. She opens maya.daemon.page on her phone and sees her blog.
11. She copies the URL on her phone. It appears on her MacBook clipboard automatically (clipboard sync).
12. Later, she pastes her OpenAI API key in settings. Now Daemon uses GPT-5 for her requests.

**Time from discovery to first deployed app: under 10 minutes.**

### 2.2 Power Developer

**Raj, 32, senior engineer. Claude Max subscriber. Has a Linux workstation, a Windows laptop, and an Android phone.**

1. Raj installs Daemon and links all three devices. Each appears in his mesh with its capabilities listed.
2. He pastes his Anthropic API key. Daemon routes through Claude Opus for all requests.
3. He creates a project called "invoice-api" and starts chatting: "Set up a FastAPI project with SQLite, auth, and CRUD for invoices."
4. Daemon writes the code on his Linux workstation (the device with the project directory), runs tests, and reports results -- all visible in the web UI and on his phone.
5. He types `/commit` -- Daemon creates a clean git commit with a generated message.
6. He types `/deploy` -- Daemon builds a Docker container and deploys to raj.daemon.page.
7. On the bus home, he opens Daemon on his phone, reviews the code diff in the chat, and says "Add input validation for the amount field." Daemon makes the change on his workstation remotely.
8. Memory persists: next week, when he returns to the project, Daemon remembers the stack, the file structure, and the pending TODO for pagination.

### 2.3 Non-Technical User (Future -- NOT v0)

**Elena, 45, marketing director. Has an iPhone and a MacBook.**

1. Elena signs up and imports her WhatsApp chat history.
2. Daemon learns her communication style (concise, no emojis, prefers bullet points).
3. She says "Draft a response to the email from Paolo about the Q2 budget."
4. Daemon reads the email (via connected Gmail), drafts a response in Elena's voice, and asks for confirmation before sending.
5. She says "What did I discuss with Luca last Tuesday?" Daemon searches her conversation memory and summarizes.

This persona validates the long-term vision but requires v1 features (email integration, chat import, personality engine). v0 does not target Elena.

---

## 3. PROTOCOL SPECIFICATION

### 3.0 Transport and Encoding

- **Transport:** JSON messages over WebSocket (WSS).
- **Encoding:** UTF-8.
- **Max message size:** 10 MB (for file transfers; base64-encoded data). Messages exceeding this MUST use the HTTP file transfer endpoint instead.
- **Versioning:** Every message includes a `v` field. v0 protocol version is `"0"`. Servers MUST reject messages with unsupported versions.
- **Error format:** `{ "type": "error", "code": "string", "message": "string", "request_id": "string|null" }`
- **Request IDs:** All request-response pairs use `request_id` (UUID v4). The server echoes the `request_id` in the response.

### 3.1 Authentication

**Device registration (after pairing):**
```json
// Client -> Server
{
  "v": "0",
  "type": "auth.hello",
  "device_token": "raw-64-byte-hex-token",
  "device_id": "unique-device-uuid",
  "device_name": "Maya's MacBook",
  "platform": "macos",
  "capabilities": {
    "shell": true,
    "files": true,
    "clipboard": true,
    "notifications": false,
    "camera": false,
    "browser": false
  }
}

// Server -> Client
{
  "v": "0",
  "type": "auth.session",
  "device_id": "unique-device-uuid",
  "user_id": 42,
  "session_id": "ws-session-uuid",
  "message": "Connected as Maya's MacBook"
}
```

The server validates `device_token` by hashing with SHA-256 and looking up the hash in the `device_tokens` table. If validation fails, the server sends an `error` message with code `"auth_failed"` and closes the WebSocket.

### 3.2 Heartbeat

```json
// Client -> Server (every 60 seconds)
{
  "v": "0",
  "type": "device.heartbeat",
  "timestamp": 1712345678000,
  "state": {
    "battery": 85,
    "online": true,
    "active_project": "invoice-api"
  }
}

// Server -> Client
{
  "v": "0",
  "type": "device.heartbeat_ack",
  "server_time": 1712345678123
}
```

If no heartbeat is received for 120 seconds, the server marks the device as offline and removes it from the active connections map. The client MUST implement reconnection with exponential backoff: 1s, 2s, 4s, 8s, 16s, 32s, 60s max.

### 3.3 Command Execution

```json
// Server -> Device
{
  "v": "0",
  "type": "device.invoke",
  "request_id": "uuid-v4",
  "command": "ls -la ~/projects",
  "timeout_ms": 30000,
  "permission_tier": 3
}

// Device -> Server
{
  "v": "0",
  "type": "device.result",
  "request_id": "uuid-v4",
  "result": {
    "stdout": "total 48\ndrwxr-xr-x ...",
    "stderr": "",
    "exit_code": 0,
    "duration_ms": 45
  }
}
```

The `permission_tier` field tells the device what level of permission this command requires (see Section 5.2). The device MUST check that the user has granted the required permission tier before executing.

### 3.4 MCP Tool Discovery

```json
// Server -> Device
{
  "v": "0",
  "type": "skill.list"
}

// Device -> Server
{
  "v": "0",
  "type": "skill.list_result",
  "tools": [
    {
      "name": "read_file",
      "description": "Read file contents from this device",
      "inputSchema": {
        "type": "object",
        "properties": {
          "path": { "type": "string", "description": "Absolute file path" }
        },
        "required": ["path"]
      }
    },
    {
      "name": "run_command",
      "description": "Execute a shell command on this device",
      "inputSchema": {
        "type": "object",
        "properties": {
          "command": { "type": "string" },
          "working_directory": { "type": "string" }
        },
        "required": ["command"]
      }
    }
  ]
}
```

Each device bridge acts as an MCP server. The Daemon AI agent is an MCP client that discovers tools across all connected devices. Tools are namespaced by device: `macbook.run_command`, `pixel.read_file`.

### 3.5 MCP Tool Call

```json
// Server -> Device
{
  "v": "0",
  "type": "skill.invoke",
  "request_id": "uuid-v4",
  "name": "read_file",
  "arguments": { "path": "/home/maya/projects/blog/index.tsx" }
}

// Device -> Server
{
  "v": "0",
  "type": "skill.result",
  "request_id": "uuid-v4",
  "result": {
    "content": "import React from 'react';\n..."
  }
}
```

### 3.6 Clipboard Sync

```json
// Device -> Server
{
  "v": "0",
  "type": "clipboard.update",
  "content": "https://maya.daemon.page",
  "source_device": "macbook-uuid",
  "timestamp": 1712345678000
}
```

The server broadcasts the clipboard update to ALL other connected devices of the same user. No acknowledgment required. Max clipboard content size: 1 MB. Binary clipboard content (images) is NOT supported in v0.

### 3.7 File Transfer

**Small files (<1 MB): binary WebSocket frames.**

```json
// Metadata message first
{
  "v": "0",
  "type": "file.transfer",
  "request_id": "uuid-v4",
  "filename": "report.pdf",
  "size": 524288,
  "target_device": "pixel-uuid"
}
// Followed by binary WebSocket frame with file contents
```

**Medium/large files (>1 MB): HTTP upload/download.**

Upload to `POST /api/files/upload` (multipart form data, auth via `daemon_token` cookie). The server stores the file temporarily and sends a download notification to the target device via WebSocket. The target device downloads via `GET /api/files/:id`.

Files are auto-deleted after 24 hours.

### 3.8 Chat Messages

```json
// Client -> Server (via HTTP POST /api/chat, not WebSocket)
{
  "message": "Build me a todo app",
  "thread_id": "thread-uuid",
  "project_id": 5,
  "stream": true
}

// Server -> Client (via SSE stream)
data: {"type":"chunk","content":"I'll create a todo app..."}
data: {"type":"tool_call","name":"macbook.run_command","arguments":{"command":"mkdir -p ~/projects/todo-app"}}
data: {"type":"tool_result","content":""}
data: {"type":"chunk","content":"Created the project directory..."}
data: {"type":"done","message_id":"msg-uuid","model":"qwen/qwen3-coder","usage":{"input_tokens":1200,"output_tokens":800}}
```

Chat messages flow over HTTP/SSE, not WebSocket. WebSocket is reserved for device communication. This separation ensures chat works even when no devices are connected.

---

## 4. ARCHITECTURE

### 4.1 Web Server (Next.js)

**Purpose:** Serves the chat UI, dashboard, settings pages, and all API routes.

**Port:** 4802 (proxied through 4800 by proxy.js).

**Key pages:**

| Route | Purpose |
|-------|---------|
| `/` | Landing page (daemon.page) |
| `/chat` | Chat interface with project sidebar |
| `/devices` | Device mesh dashboard |
| `/settings` | API keys, account, preferences |
| `/download` | OS-detected download page |
| `[subdomain].daemon.page` | User's deployed apps |

**Auth:** All authenticated routes check the `daemon_token` cookie. The cookie is httpOnly, Secure, SameSite=Strict, 30-day expiry. The server validates the token hash against the `sessions` table AND checks `expires_at`.

**Dependencies:** SQLite (via better-sqlite3), Python server module (for auth operations in v0, to be consolidated).

### 4.2 WebSocket Server

**Purpose:** Maintains persistent connections with paired devices. Routes commands from the AI agent to specific devices. Broadcasts clipboard updates.

**Port:** 4801 (proxied through 4800 at `/ws` path).

**Connection lifecycle:**
1. Device opens WSS connection to `wss://my.daemon.page/ws/device`
2. Device sends `auth.hello` with device token
3. Server validates token, adds device to per-user device map
4. Heartbeat loop begins (60-second interval)
5. Server can send `device.invoke` or `skill.invoke` at any time
6. Device can send `clipboard.update`, `device.heartbeat`, or `skill.result` at any time
7. On disconnect, device is removed from map after 120s timeout

**Critical design requirements:**
- Device maps MUST be per-user, not global. A user MUST NOT see or interact with another user's devices.
- Device ID matching MUST be exact (no fuzzy/partial matching).
- The server MUST validate the device token on every WebSocket connection, not just check for existence.

**Dependencies:** ws (Node.js WebSocket library), SQLite for token validation.

### 4.3 Proxy

**Purpose:** Single entry point on port 4800. Routes HTTP to Next.js (4802), WebSocket to WS server (4801).

**Implementation:** ~70 lines of Node.js. Checks the `Upgrade` header for WebSocket connections and the URL path for routing.

**Security requirement for v0:** Add rate limiting at this layer. 60 requests/minute per IP for auth endpoints. 10 requests/second per IP for chat. 5 WebSocket connections per IP.

### 4.4 Device Bridge

**Purpose:** Software that runs on each user device, maintains a WebSocket connection to the server, and exposes local capabilities as MCP tools.

**Platforms:**

| Platform | Implementation | Distribution |
|----------|---------------|-------------|
| macOS / Linux | Node.js CLI (`daemon-cli`) | `npx daemon-cli pair` |
| Windows | Tauri desktop app | `.msi` download from daemon.page/download |
| Android | Kotlin/Compose app | `.apk` download, later Google Play |

**Common capabilities (all platforms):**
- Shell command execution (with permission gating)
- File read/write (within allowed paths)
- Clipboard read/write (platform-dependent; Android can only write)
- Device info (OS, battery, hostname)

**Platform-specific notes:**

- **macOS/Linux CLI:** Installs as a systemd service (Linux) or LaunchAgent (macOS). Auto-updates by checking the server every 6 hours.
- **Windows/Tauri:** Runs as a system tray app. Shell commands use PowerShell. File paths use backslashes.
- **Android:** Uses a foreground service for active sessions. Transitions to FCM-only for idle state (wake on push, connect, execute, disconnect). Progressive permissions: the app requests ZERO Android permissions at install. Each capability (notifications, camera, files) is requested the first time the AI agent needs it.

**Auto-reconnection:** All bridges implement exponential backoff reconnection (1s, 2s, 4s, 8s, 16s, 32s, 60s max).

### 4.5 AI Chat Engine

**Purpose:** Receives user messages, routes to the appropriate model, executes tool calls, streams responses.

**Model routing:**

| Tier | Model | Provider | Trigger |
|------|-------|----------|---------|
| Free | Qwen3-Coder | OpenRouter | Default for new users |
| BYOK | User's choice | User's API key | User pastes key in settings |
| Premium | Claude Opus | Anthropic API / Claude CLI | User provides Anthropic key or links Max |

All non-Claude models use the OpenAI-compatible chat completions API format. Claude uses the Anthropic SDK or Claude CLI.

**Agent loop:**
1. Receive user message
2. Build context: system prompt + project memory + recent messages (last 20 turns or 30K tokens, whichever is smaller)
3. Call model with tool definitions (derived from connected devices' MCP tools + built-in tools)
4. If response contains tool calls: execute each tool, collect results, go to step 3
5. If response is text: stream to client via SSE, save to database
6. Max iterations: 10. If exceeded, return partial result with explanation.

**Built-in tools (always available, no device required):**
- `read_file` -- read a file on the server (within user's workspace)
- `write_file` -- write a file on the server
- `run_command` -- execute a command in the user's sandbox
- `search` -- search files by content (grep)
- `list_files` -- list directory contents

**Slash commands:**
- `/deploy` -- build and deploy current project to username.daemon.page
- `/commit` -- create a git commit with AI-generated message
- `/memory` -- show/search project memory
- `/devices` -- list connected devices
- `/model` -- switch model for current session
- `/clear` -- clear conversation context

**Streaming:** Responses stream via Server-Sent Events (SSE). Each chunk is a JSON object on a `data:` line. The client renders markdown progressively.

### 4.6 Memory System

**v0 implementation:** Markdown files per project, inspired by Claude Code's CLAUDE.md pattern.

**Storage structure:**
```
data/
  memory/
    user_42/
      global/
        MEMORY.md          # User-level preferences and facts
      projects/
        invoice-api/
          MEMORY.md         # Project-specific memory
          context.json      # Structured data (stack, paths, dependencies)
```

**How memory is created:**
1. At the end of each conversation (or every 10 messages), the AI generates a summary
2. Key facts, decisions, and preferences are extracted
3. The summary is appended to the project's MEMORY.md
4. The structured context (tech stack, file paths, etc.) is updated in context.json

**How memory is used:**
1. On each chat request, the project's MEMORY.md and context.json are loaded into the system prompt
2. Global MEMORY.md is always included
3. Total memory budget: 4K tokens (to leave room for conversation)

**Search:** `grep` over markdown files. No vector search in v0. The Qdrant vector database exists but is not required for v0 launch. It becomes the backend for semantic memory search in v1.

**Why not Qdrant in v0:** Simplicity. Markdown files are inspectable, editable, and portable. They work offline. They can be version-controlled. Vector search adds latency and complexity that is not justified until the memory corpus grows beyond what grep can handle (roughly 1000+ memory entries per user).

### 4.7 Project Management

**Data model:** Each user has projects. Each project has threads. Each thread has messages.

```
User (1) ---> (many) Projects
Project (1) ---> (many) Threads
Thread (1) ---> (many) Messages
```

**Project fields:** name, display_name, local_path (on which device), git_remote, git_branch, stack, domain (for deploy), settings (JSON).

**Thread behavior:**
- One active thread per project at a time
- Switching projects preserves the thread; switching back resumes it
- Threads can be archived but not deleted in v0
- Thread titles are AI-generated from the first user message

**Project creation:** Explicit via the sidebar ("New Project") or implicit when the user starts chatting about a new codebase. The AI can create projects via tool calls.

### 4.8 Hosting (daemon.page)

**How it works:**
1. User types `/deploy` in chat
2. Daemon builds the project (runs `npm run build` or equivalent)
3. Build output is copied to `/var/daemon/sites/{username}/`
4. Cloudflare DNS has a wildcard CNAME: `*.daemon.page -> my.daemon.page`
5. The Next.js server checks the `Host` header; if it matches `{username}.daemon.page`, it serves static files from that user's directory

**Constraints in v0:**
- Static sites only (HTML/CSS/JS). No server-side rendering, no database-backed apps.
- Max 50 MB per site.
- No custom domains (just username.daemon.page).
- Automated security scan before deployment: scan for known malicious patterns (crypto miners, data exfiltration). Block deployment if flagged.

**Future (v1):** Per-user Docker containers for dynamic apps. Custom domain support via Cloudflare.

---

## 5. SECURITY MODEL

### 5.1 Authentication

**Methods:**
- Google OAuth 2.0 (primary, recommended)
- Email + password (fallback)

**Password hashing:** bcrypt with cost factor 12. No SHA-256 fallback. The SHA-256 path in the current codebase MUST be removed before launch.

**Session tokens:**
- Generated as `crypto.randomBytes(32).toString('hex')` (64 hex characters)
- Stored as SHA-256 hash in the `sessions` table
- Cookie: `daemon_token`, httpOnly, Secure, SameSite=Strict, Path=/
- Expiry: 30 days from creation. Enforced in both the cookie `maxAge` AND the `expires_at` database column.
- Middleware MUST validate the token hash against the database on every request, not just check cookie existence.

**Device tokens:**
- Generated as `crypto.randomBytes(32).toString('hex')` (64 hex characters)
- Stored as SHA-256 hash in `device_tokens` table
- Expiry: 30 days from last use (auto-renewed on each heartbeat)
- Revocable via the web UI (Settings > Devices)
- Stored on the device at `~/.daemon/config.json` (chmod 600)

### 5.2 Authorization

**User isolation:** Every database query that touches user data MUST include `WHERE user_id = ?`. There are no admin queries that return cross-user data in any API route.

**Device isolation:** The WebSocket server maintains a `Map<userId, Map<deviceId, WebSocket>>`. A user can only send commands to devices in their own map.

**Permission tiers for device commands:**

| Tier | Permission Level | Examples | Approval |
|------|-----------------|----------|----------|
| 0 | Always allowed | get_device_info, ping, get_time, get_battery | None |
| 1 | Granted once, logged | list_files, get_clipboard, get_notifications | First-time prompt |
| 2 | Per-session | read_file, write_file, take_screenshot | Granted at session start |
| 3 | Per-action | run_command, send_notification, install_app | Every time, with command preview |

The device bridge enforces these tiers locally. The server sends the `permission_tier` with each command. If the user has not granted the required tier, the device bridge returns an error and the AI explains to the user what permission is needed and why.

### 5.3 Command Execution Sandboxing

**Server-side (for built-in tools):**
- All commands run inside bubblewrap (bwrap) sandboxes
- Read-only bind mounts for system directories (/usr, /bin, /lib)
- Read-write only for the user's workspace directory
- Network isolation (`--unshare-net`) by default; opt-in per command
- Process isolation (`--unshare-pid`)
- Auto-cleanup on parent death (`--die-with-parent`)
- 30-second timeout per command

**Device-side:**
- CLI/desktop bridges: commands run as the bridge's OS user but with a blocklist of known-dangerous patterns (rm -rf /, dd if=/dev/zero, fork bombs, etc.)
- Android: no raw `run_command`. Instead, a curated set of 15 MCP tools (open_app, set_alarm, toggle_wifi, read_contacts, etc.)

**Post-launch (multi-user):** Switch from bubblewrap to Firecracker microVMs. Each user gets their own VM with dedicated filesystem, network namespace, and resource limits (2 GB RAM, 1 CPU, 256 PIDs).

### 5.4 Transport Security

- All external connections via WSS through Cloudflare Tunnel (TLS 1.3)
- API calls over HTTPS only
- CORS policy: only `daemon.page` and `*.daemon.page` origins
- CSRF protection: SameSite=Strict cookie + custom `X-Daemon-Client` header on all API requests

### 5.5 Data at Rest

**v0 minimum:**
- SQLite with WAL mode
- bcrypt for passwords
- SHA-256 for token hashing
- API keys (BYOK) stored in users.settings JSON column (encrypted with a server-side key in v1)
- Daily automated backups at 03:00 via cron, 30-day retention

**Post-launch:**
- SQLCipher for database encryption
- Per-user encryption keys derived from user credentials
- Cloudflare R2 for off-site backup storage

### 5.6 Rate Limiting

| Endpoint | Limit | Window |
|----------|-------|--------|
| POST /api/auth (login/signup) | 10 | per minute per IP |
| POST /api/chat | 30 | per minute per user |
| POST /api/pair | 10 | per minute per user |
| WebSocket connections | 5 | per IP |
| File uploads | 10 | per hour per user |

Rate limiting is enforced at the proxy layer using in-memory counters with sliding windows.

### 5.7 Input Sanitization

- Shell commands from the AI agent MUST be passed as array arguments to `execFile`, never interpolated into strings.
- The current shell injection vulnerability in `chat/route.ts` (token interpolated into Python code) MUST be fixed: pass the token via `process.argv` or environment variable.
- All user-provided strings stored in SQLite MUST use parameterized queries (already the case in most code, but MUST be verified for all paths).

---

## 6. DATABASE SCHEMA

All tables live in a single SQLite database at `data/users.db` with WAL mode enabled.

```sql
-- Users: account information
CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,              -- bcrypt hash, prefixed "bcrypt:"
    daemon_name TEXT UNIQUE NOT NULL,          -- username for {name}.daemon.page
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_login TEXT,
    settings TEXT DEFAULT '{}'                 -- JSON: { byok_keys: {}, preferences: {} }
);

-- Sessions: login tokens
CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY,               -- SHA-256 of raw token
    user_id INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at TEXT NOT NULL,                   -- datetime('now', '+30 days')
    FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Projects: code projects
CREATE TABLE projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    name TEXT NOT NULL,                         -- slug: "invoice-api"
    display_name TEXT,                          -- "Invoice API"
    local_path TEXT,                            -- absolute path on device
    device_id TEXT,                             -- which device has this project
    git_remote TEXT,
    git_branch TEXT DEFAULT 'main',
    stack TEXT,                                 -- "nextjs", "fastapi", etc.
    domain TEXT,                                -- subdomain for deploy
    settings TEXT DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_active TEXT,
    UNIQUE(user_id, name),
    FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Chat threads: conversations within projects
CREATE TABLE chat_threads (
    id TEXT PRIMARY KEY,                        -- UUID v4
    project_id INTEGER,
    user_id INTEGER NOT NULL,
    title TEXT DEFAULT 'New conversation',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_message_at TEXT,
    FOREIGN KEY (project_id) REFERENCES projects(id),
    FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Chat messages: individual messages
CREATE TABLE chat_messages (
    id TEXT PRIMARY KEY,                        -- UUID v4
    thread_id TEXT NOT NULL,
    role TEXT NOT NULL,                          -- 'user', 'assistant', 'tool'
    content TEXT,
    tool_calls TEXT,                             -- JSON array of tool calls
    tool_call_id TEXT,                           -- for role='tool', links to the tool call
    model TEXT,                                  -- which model generated this
    tokens_used INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (thread_id) REFERENCES chat_threads(id)
);

-- Device tokens: paired device credentials
CREATE TABLE device_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    device_id TEXT NOT NULL UNIQUE,              -- UUID, self-reported at pair time
    device_name TEXT,                            -- "Maya's MacBook"
    platform TEXT,                               -- "macos", "linux", "windows", "android"
    token_hash TEXT NOT NULL UNIQUE,             -- SHA-256 of raw token
    permissions TEXT DEFAULT '{"tier":0}',       -- JSON: granted permission tiers
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_seen TEXT,
    expires_at TEXT,                             -- datetime('now', '+30 days'), renewed on heartbeat
    revoked INTEGER DEFAULT 0,
    FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Conversation memory: AI-generated summaries
CREATE TABLE conversation_memory (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    thread_id TEXT NOT NULL,
    project_id INTEGER,
    user_id INTEGER NOT NULL,
    tldr TEXT NOT NULL,
    key_decisions TEXT,                          -- JSON array
    key_facts TEXT,                              -- JSON array
    problems TEXT,                               -- JSON array
    solutions TEXT,                              -- JSON array
    tags TEXT,                                   -- comma-separated
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (thread_id) REFERENCES chat_threads(id)
);

-- Usage log: for analytics and future billing
CREATE TABLE usage_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    model TEXT NOT NULL,
    provider TEXT NOT NULL,                      -- "openrouter", "anthropic", "byok"
    input_tokens INTEGER DEFAULT 0,
    output_tokens INTEGER DEFAULT 0,
    cost_usd REAL DEFAULT 0,
    key_source TEXT DEFAULT 'daemon',            -- "daemon" or "byok"
    project_id INTEGER,
    thread_id TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Indexes
CREATE INDEX idx_projects_user ON projects(user_id);
CREATE INDEX idx_threads_project ON chat_threads(project_id);
CREATE INDEX idx_threads_user ON chat_threads(user_id);
CREATE INDEX idx_messages_thread ON chat_messages(thread_id);
CREATE INDEX idx_messages_created ON chat_messages(created_at);
CREATE INDEX idx_memory_user ON conversation_memory(user_id);
CREATE INDEX idx_memory_project ON conversation_memory(project_id);
CREATE INDEX idx_device_tokens_hash ON device_tokens(token_hash);
CREATE INDEX idx_device_tokens_user ON device_tokens(user_id);
CREATE INDEX idx_usage_user_date ON usage_log(user_id, created_at);
```

**Tables removed from current codebase for v0:**
- `subscriptions` -- no billing in v0
- `credit_usage` -- no billing in v0
- `imported_sessions` -- not a v0 feature

---

## 7. FILE STRUCTURE

```
daemon/
├── SPEC.md                  # THIS DOCUMENT - the canonical spec
├── README.md                # Public-facing, links to spec
├── LICENSE                  # MIT
├── package.json             # Monorepo root (workspaces)
│
├── protocol/                # Protocol specification and shared types
│   ├── PROTOCOL.md          # Human-readable protocol spec (extracted from SPEC.md Section 3)
│   └── types.ts             # TypeScript type definitions for all message types
│
├── web/                     # Next.js web UI + API routes
│   ├── src/
│   │   ├── app/
│   │   │   ├── page.tsx             # Landing page
│   │   │   ├── chat/page.tsx        # Chat interface
│   │   │   ├── devices/page.tsx     # Device mesh dashboard
│   │   │   ├── settings/page.tsx    # User settings
│   │   │   ├── download/page.tsx    # OS-detected download page
│   │   │   └── api/
│   │   │       ├── auth/route.ts        # Login, signup, Google OAuth
│   │   │       ├── chat/route.ts        # Send message, stream response
│   │   │       ├── projects/route.ts    # CRUD projects
│   │   │       ├── threads/route.ts     # List threads, get messages
│   │   │       ├── pair/route.ts        # Generate and claim pairing codes
│   │   │       ├── devices/route.ts     # List and manage devices
│   │   │       ├── memory/route.ts      # Search memory
│   │   │       ├── settings/route.ts    # Get/update user settings
│   │   │       ├── files/route.ts       # File upload/download for transfers
│   │   │       └── deploy/route.ts      # Build and deploy to daemon.page
│   │   ├── lib/
│   │   │   ├── db.ts                # SQLite connection + migrations
│   │   │   ├── auth.ts              # Session validation, token management
│   │   │   ├── agent-loop.ts        # Model call -> tool exec -> repeat
│   │   │   ├── model-router.ts      # Route to Qwen/BYOK/Claude
│   │   │   ├── streaming.ts         # SSE response helpers
│   │   │   ├── safety-check.ts      # Command blocklist
│   │   │   ├── sandbox.ts           # Bubblewrap command execution
│   │   │   ├── memory.ts            # Read/write markdown memory files
│   │   │   └── mcp-bridge.ts        # MCP client for device tools
│   │   ├── components/
│   │   │   ├── ChatPanel.tsx
│   │   │   ├── ProjectSidebar.tsx
│   │   │   ├── DeviceList.tsx
│   │   │   ├── MessageBubble.tsx
│   │   │   ├── ToolCallBlock.tsx
│   │   │   └── SettingsForm.tsx
│   │   └── store/
│   │       ├── chat.ts              # Zustand: messages, streaming state
│   │       ├── projects.ts          # Zustand: project list, active project
│   │       └── devices.ts           # Zustand: connected devices
│   ├── package.json
│   └── next.config.js
│
├── ws/                      # WebSocket server (separate process)
│   ├── server.ts            # Device connection handling, per-user routing
│   ├── clipboard.ts         # Clipboard broadcast logic
│   └── package.json
│
├── proxy/                   # Entry point proxy
│   ├── proxy.ts             # Port 4800 -> 4802 (HTTP) / 4801 (WS)
│   ├── rate-limiter.ts      # In-memory sliding window rate limiting
│   └── package.json
│
├── cli/                     # CLI device bridge (Node.js)
│   ├── daemon-cli.ts        # Entry point: pair, connect, status
│   ├── bridge.ts            # WebSocket client + MCP server
│   ├── tools/               # Platform-specific tool implementations
│   │   ├── shell.ts
│   │   ├── files.ts
│   │   └── clipboard.ts
│   ├── auto-update.ts       # Check server for updates every 6 hours
│   └── package.json
│
├── android/                 # Kotlin/Compose Android app
│   ├── app/src/main/
│   │   ├── java/.../daemon/
│   │   │   ├── DaemonApp.kt
│   │   │   ├── DaemonService.kt        # Foreground service + WS client
│   │   │   ├── PairActivity.kt         # Pairing flow
│   │   │   ├── ChatActivity.kt         # WebView chat
│   │   │   ├── PermissionManager.kt    # Progressive permission requests
│   │   │   └── tools/                  # MCP tool implementations
│   │   │       ├── ShellTool.kt
│   │   │       ├── FilesTool.kt
│   │   │       ├── ClipboardTool.kt
│   │   │       └── NotificationTool.kt
│   │   └── AndroidManifest.xml
│   └── build.gradle.kts
│
├── desktop/                 # Tauri desktop app (Windows/Mac/Linux)
│   ├── src-tauri/
│   │   ├── src/main.rs
│   │   └── Cargo.toml
│   └── src/                 # Shared web UI via WebView
│
├── data/                    # Runtime data (gitignored)
│   ├── users.db             # SQLite database
│   ├── backups/             # Daily database backups
│   ├── memory/              # Markdown memory files per user/project
│   ├── sites/               # Deployed static sites per user
│   └── files/               # Temporary file transfer storage
│
├── docker/
│   ├── sandbox/
│   │   └── Dockerfile       # Sandbox image for tool execution
│   └── qdrant/
│       └── docker-compose.yml
│
├── docs/
│   ├── OVERVIEW.md          # Architecture overview with diagrams
│   ├── V0_DECISIONS.md      # Architecture decisions log
│   ├── WAR_ROOM.md          # Technical reality assessment
│   └── research/            # Deep research documents
│
├── scripts/
│   ├── backup.sh            # Database backup (cron)
│   ├── deploy-site.sh       # Build + deploy user site
│   └── setup.sh             # First-time setup script
│
└── config/
    ├── proxy.js             # Current proxy (to be migrated to proxy/)
    └── ws-server.js         # Current WS server (to be migrated to ws/)
```

---

## 8. API REFERENCE

All endpoints require authentication via `daemon_token` cookie unless marked PUBLIC.

### Authentication

**POST /api/auth** PUBLIC

```
Action: "login"
Body: { action: "login", email: string, password: string }
Response 200: { user: { id, email, daemon_name }, token: string }
Response 401: { error: "Invalid credentials" }
Cookie set: daemon_token (httpOnly, Secure, SameSite=Strict, maxAge=30d)

Action: "signup"
Body: { action: "signup", email: string, password: string, daemon_name: string }
Response 201: { user: { id, email, daemon_name }, token: string }
Response 400: { error: "Email already registered" | "Name taken" }
Cookie set: daemon_token

Action: "google"
Body: { action: "google", credential: string }  // Google ID token
Response 200: { user: { id, email, daemon_name }, token: string }
Cookie set: daemon_token

Action: "logout"
Body: { action: "logout" }
Response 200: { success: true }
Cookie cleared: daemon_token
```

### Projects

**GET /api/projects**
```
Response 200: { projects: [{ id, name, display_name, local_path, device_id, git_remote, git_branch, stack, domain, created_at, last_active }] }
```

**POST /api/projects**
```
Body: { name: string, display_name?: string, local_path?: string, device_id?: string, git_remote?: string, stack?: string }
Response 201: { project: { id, name, ... } }
Response 400: { error: "Project name already exists" }
```

**PUT /api/projects/:id**
```
Body: { display_name?: string, local_path?: string, ... }  // partial update
Response 200: { project: { id, name, ... } }
Response 404: { error: "Project not found" }
```

**DELETE /api/projects/:id**
```
Response 200: { success: true }
Response 404: { error: "Project not found" }
```

### Chat

**POST /api/chat**
```
Body: {
  message: string,
  thread_id?: string,      // omit to create new thread
  project_id?: number,
  stream?: boolean          // default true
}

If stream=true:
  Response: SSE stream (Content-Type: text/event-stream)
  Events:
    data: { type: "chunk", content: "..." }
    data: { type: "tool_call", id: "...", name: "...", arguments: {...} }
    data: { type: "tool_result", id: "...", content: "..." }
    data: { type: "done", message_id: "...", thread_id: "...", model: "...", usage: { input_tokens, output_tokens } }
    data: { type: "error", message: "..." }

If stream=false:
  Response 200: { message: { id, role: "assistant", content, model, usage }, thread_id }
```

### Threads

**GET /api/threads?project_id=:id**
```
Response 200: { threads: [{ id, project_id, title, created_at, last_message_at }] }
```

**GET /api/threads/:id/messages?limit=50&before=:message_id**
```
Response 200: { messages: [{ id, role, content, tool_calls, model, created_at }] }
```

**DELETE /api/threads/:id**
```
Response 200: { success: true }
```

### Device Pairing

**POST /api/pair**
```
Action: "generate"
Body: { action: "generate" }
Response 200: { code: "XK7M2P", expires_in: 300 }

Action: "claim"
Body: { action: "claim", code: "XK7M2P", device_id: "uuid", device_name: "Maya's MacBook", platform: "macos" }
Response 200: { token: "raw-64-byte-hex-token", device_id: "uuid" }
Response 400: { error: "Invalid or expired code" }
Response 429: { error: "Rate limit exceeded" }
```

### Devices

**GET /api/devices**
```
Response 200: {
  devices: [{
    id: string,
    device_id: string,
    device_name: string,
    platform: string,
    online: boolean,
    last_seen: string,
    permissions: { tier: number },
    capabilities: { shell, files, clipboard, ... }
  }]
}
```

**DELETE /api/devices/:id** (revoke)
```
Response 200: { success: true }
```

### Memory

**GET /api/memory?project_id=:id&q=:query**
```
Response 200: {
  memories: [{
    source: "project" | "global",
    content: string,      // raw markdown
    project_id?: number
  }]
}
```

### Settings

**GET /api/settings**
```
Response 200: {
  email: string,
  daemon_name: string,
  byok_keys: { anthropic?: "sk-...masked", openai?: "sk-...masked" },
  preferences: { model?: string, theme?: string }
}
```

**PUT /api/settings**
```
Body: {
  byok_keys?: { anthropic?: string, openai?: string, google?: string },
  preferences?: { model?: string, theme?: string }
}
Response 200: { success: true }
```

### File Transfer

**POST /api/files/upload** (multipart/form-data)
```
Fields: file (binary), target_device_id (string)
Response 200: { file_id: "uuid", filename: "report.pdf", size: 524288 }
```

**GET /api/files/:id**
```
Response 200: binary file download
Response 404: { error: "File not found or expired" }
```

### Deploy

**POST /api/deploy**
```
Body: { project_id: number }
Response 200 (SSE stream):
  data: { type: "log", message: "Building..." }
  data: { type: "log", message: "Deploying to maya.daemon.page..." }
  data: { type: "done", url: "https://maya.daemon.page" }
  data: { type: "error", message: "Build failed: ..." }
```

### Health

**GET /api/health** PUBLIC
```
Response 200: { status: "ok", version: "0.1.0", uptime: 86400 }
```

**Error codes used across all endpoints:**

| HTTP Status | Meaning |
|------------|---------|
| 400 | Bad request (invalid params) |
| 401 | Not authenticated |
| 403 | Not authorized (wrong user) |
| 404 | Resource not found |
| 429 | Rate limit exceeded |
| 500 | Internal server error |

---

## 9. IMPLEMENTATION PHASES

### Phase 0: Foundation (Week 1)

**Goal:** Secure the base. Strip non-v0 code. Establish the protocol.

- [ ] Extract protocol types from SPEC.md Section 3 into `protocol/types.ts`
- [ ] Fix shell injection in `chat/route.ts` (pass token via process.argv, not string interpolation)
- [ ] Remove SHA-256 password fallback; bcrypt-only
- [ ] Add `expires_at` enforcement to session middleware
- [ ] Validate token hash against DB in middleware (not just cookie existence)
- [ ] Add rate limiting to proxy (in-memory sliding window)
- [ ] Move to per-user device maps in WebSocket server (no global map)
- [ ] Remove non-v0 API routes: billing, webhooks, voice, esp32-data, sensor-stream, import, camera, share, stream-push, apis, knowledge, tier
- [ ] Remove non-v0 tables: subscriptions, credit_usage, imported_sessions
- [ ] Strip server/ Python code to auth-only (remove personality, voice, ESP32, gemini_live, knowledge)
- [ ] Add bubblewrap sandbox wrapper for server-side command execution
- [ ] Android: remove raw `run_command`, replace with curated MCP tools
- [ ] Android: implement progressive permission requests (zero permissions at install)

**Dependencies:** None. This is parallel work.

### Phase 1: Core Experience (Week 2)

**Goal:** The primary loop works: sign up, pair, chat, build, deploy.

- [ ] Chat works reliably with Qwen free tier via OpenRouter (test 50 diverse prompts)
- [ ] BYOK flow: paste API key in settings, verify it works, use it for chat
- [ ] Device pairing end-to-end: web UI generates code -> CLI runs `npx daemon-cli pair CODE` -> device appears in dashboard
- [ ] MCP tool discovery: server queries device for available tools, adds them to AI's tool list
- [ ] Agent loop with device tools: AI can `run_command` on connected device, read/write files
- [ ] Slash commands: `/deploy`, `/commit`, `/memory`, `/model`
- [ ] Project memory: auto-generate MEMORY.md after conversations, load on project switch
- [ ] Thread management: create, list, switch, archive

**Dependencies:** Phase 0 must be complete.

### Phase 2: Polish (Week 3)

**Goal:** The experience is smooth enough for beta testers.

- [ ] Download page with OS detection (macOS -> CLI instructions, Windows -> .msi link, Android -> .apk link)
- [ ] Auto-deploy to username.daemon.page (static sites)
- [ ] Clipboard sync working between CLI bridge and web UI
- [ ] CLI auto-update mechanism (check server every 6 hours)
- [ ] Graceful error handling in chat (model failures, device disconnects, timeout)
- [ ] Mobile-responsive chat UI
- [ ] Project sidebar with search
- [ ] Settings page for managing devices (view, revoke)
- [ ] Memory search (`/memory search "authentication"`)

**Dependencies:** Phase 1 must be complete.

### Phase 3: Launch (Week 4)

**Goal:** Public GitHub repo. 10 beta testers.

- [ ] Clean the repo: remove all non-v0 files (KiCad, hardware, research, watch)
- [ ] Write README.md: tagline, 30-second GIF, quick start, comparison table, architecture diagram
- [ ] Record 30-second demo video: sign up -> pair -> chat -> deploy
- [ ] Set up GitHub Actions: lint, test, build (Android APK, Tauri, CLI)
- [ ] CONTRIBUTING.md with the "no marketplace, no bloat" stance
- [ ] Open 10 `good-first-issue` issues
- [ ] Invite 10 beta testers (from HN contacts, Twitter followers)
- [ ] Write the Show HN post
- [ ] Monitor: set up basic health check ping (every 5 minutes) with alerts

**Dependencies:** Phase 2 must be complete.

---

## 10. ACCEPTANCE CRITERIA

v0 is done when ALL of the following are true:

### Onboarding
- [ ] A new user can sign up with Google, see their dashboard, and start chatting in under 60 seconds
- [ ] A new user can pair a macOS/Linux device via `npx daemon-cli pair` in under 2 minutes
- [ ] The download page auto-detects the user's OS and shows the right instructions

### Chat
- [ ] Free Qwen model responds correctly to coding questions (tested with 20 diverse prompts)
- [ ] BYOK user can paste an OpenAI API key and get GPT responses
- [ ] BYOK user can paste an Anthropic API key and get Claude responses
- [ ] Streaming works: tokens appear progressively, not all at once
- [ ] Tool calls are visible in the UI (expand/collapse blocks showing command + output)
- [ ] Slash commands work: `/deploy`, `/commit`, `/memory`, `/model`

### Device Mesh
- [ ] Paired device shows as online in the dashboard with correct name and platform
- [ ] AI can run a shell command on the paired device and show the output in chat
- [ ] AI can read a file from the paired device
- [ ] AI can write a file to the paired device
- [ ] Clipboard sync works: copy on laptop, paste on web UI (and vice versa)
- [ ] Device reconnects automatically after network interruption (within 60 seconds)

### Deploy
- [ ] User can say "deploy this" and see their static site at username.daemon.page
- [ ] Deployed site is accessible from any browser without login

### Memory
- [ ] Memory persists across sessions: close chat, reopen, the AI remembers the project context
- [ ] Memory is stored as readable markdown files in `data/memory/`
- [ ] `/memory` command shows relevant memories for the current project

### Security
- [ ] No shell injection vulnerabilities (verified by code review)
- [ ] Session tokens expire after 30 days (verified by checking expired token returns 401)
- [ ] Device tokens expire after 30 days of no use (verified by test)
- [ ] Rate limiting blocks brute-force login attempts (10/min)
- [ ] A user cannot see or command another user's devices (verified by test with 2 accounts)
- [ ] bubblewrap sandbox prevents command from accessing files outside workspace (verified by test)
- [ ] OWASP Top 10 checklist passed (injection, broken auth, XSS, CSRF, SSRF)

### Android
- [ ] App installs with zero permissions requested
- [ ] App opens the chat via WebView
- [ ] First permission request happens only when the AI needs a device capability
- [ ] App does not crash on rotate, background, or kill + restart
- [ ] Foreground service notification appears during active session

### Stability
- [ ] Server stays up for 72 hours under simulated load (10 concurrent users) without crash
- [ ] No white/black screens in the web UI under normal use
- [ ] No unhandled promise rejections in the Node.js processes
- [ ] Database backups run daily and can be restored (verified by test restore)

---

## Appendix A: Technology Stack Summary

| Component | Technology | Version | Why |
|-----------|-----------|---------|-----|
| Web framework | Next.js | Latest | React SSR, API routes, established ecosystem |
| Database | SQLite + better-sqlite3 | 3.x | Simple, file-based, WAL mode, sufficient to ~50 users |
| WebSocket | ws (Node.js) | 8.x | Mature, performant, widely used |
| Android | Kotlin + Jetpack Compose | Latest | Native Android, best system integration |
| Desktop | Tauri v2 | 2.x | Rust + WebView, cross-platform, small binary |
| CLI | Node.js | 22+ | Runs everywhere, npm distribution |
| Sandbox | bubblewrap | Latest | Used by Chromium and Claude Code, minimal overhead |
| AI Gateway | OpenRouter | N/A | Unified billing, 290+ models, 5.5% fee |
| Tunnel | Cloudflare Tunnel | N/A | Free, global, DDoS protection, wildcard subdomains |
| State management | Zustand | 5.x | Simple, lightweight, no boilerplate |
| Styling | Tailwind CSS | 4.x | Utility-first, fast iteration |

## Appendix B: Environment Variables

```env
# Required
OPENROUTER_API_KEY=         # For free tier model routing
DATABASE_PATH=data/users.db

# Optional (for specific features)
GOOGLE_CLIENT_ID=           # Google OAuth
GOOGLE_CLIENT_SECRET=       # Google OAuth
ANTHROPIC_API_KEY=          # For premium tier (if not using BYOK)
DEEPSEEK_API_KEY=           # For mid tier

# Server config
PORT_PROXY=4800
PORT_WEB=4802
PORT_WS=4801
DAEMON_DOMAIN=daemon.page
NODE_ENV=production
```

## Appendix C: Glossary

| Term | Definition |
|------|-----------|
| **Bridge** | Software running on a user's device that connects to the Daemon server via WebSocket |
| **BYOK** | Bring Your Own Key -- user provides their own API key for an LLM provider |
| **Device mesh** | The network of all a user's connected devices, coordinated by the server |
| **MCP** | Model Context Protocol -- standard for AI-to-tool communication (Linux Foundation) |
| **Pairing code** | 6-character alphanumeric code used to link a new device to a user account |
| **Progressive permissions** | Requesting device capabilities only when first needed, not at install |
| **Sandbox** | Isolated execution environment (bubblewrap/Docker/Firecracker) for untrusted commands |
| **SSE** | Server-Sent Events -- one-way HTTP stream for real-time updates from server to client |
| **WAL** | Write-Ahead Logging -- SQLite journaling mode that improves concurrent access |
