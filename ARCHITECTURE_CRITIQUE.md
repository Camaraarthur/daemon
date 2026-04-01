# Daemon Architecture Critique

Senior systems review. April 2026. Based on reading every file in the codebase.

---

## Executive Summary

The daemon has a working prototype that proves the concept: chat with personality, multi-device control via SSH/WebSocket, knowledge graph with semantic search, Android app that bridges phone sensors to the server. It works for one user (Arthur). It will not survive contact with a second user, a server restart, or a moderately motivated attacker. The architecture plan (`melodic-mapping-spark.md`) describes a solid multi-tenant system with gVisor containers and device pairing. Almost none of that is implemented. What exists is a shell-script-in-a-trenchcoat pretending to be a platform.

---

## 1. Scalability Holes

### Claude CLI process-per-message (route.ts:196)

Every chat message spawns a new `claude` process with `spawn('claude', args)`. This is the central architectural bottleneck.

**What happens at scale:**
- **1 user:** Works. 15-27s latency is annoying but acceptable for a power user.
- **10 users:** 10 concurrent Claude processes. Each loads the system prompt, MCP tools, connects to Anthropic's API. The 32GB server runs out of memory. Claude CLI processes are not lightweight -- each is a full Node.js runtime + Python MCP server.
- **100 users:** Dead. Even if you could fit them in memory, you'd hit Anthropic's rate limits on the Max subscription (which is designed for one human, not 100 concurrent agents).

**The real constraint nobody talks about:** The Max subscription ToS likely prohibits programmatic multi-user access. One person's subscription powering 100 daemons is the kind of thing that gets your account terminated.

**Concurrency limit:** Practically 3-5 simultaneous Claude processes on a 32GB machine. The 180s timeout (route.ts:27) means a stuck process blocks resources for 3 minutes.

### In-memory session store (route.ts:52)

```typescript
const sessions: Record<string, string> = {}
```

Server restart = all conversation sessions lost. Every user starts a fresh conversation. The `--resume` flag (route.ts:194) only works if the session ID is still in memory. This is documented in the architecture plan as "data on user devices" but the implementation doesn't sync anything to devices. Sessions live and die with the Node.js process.

### Single-process personality file (route.ts:207-209)

```typescript
personality.interaction_count = (personality.interaction_count || 0) + 1
writeFileSync(PERSONALITY_PATH, JSON.stringify(personality, null, 2))
```

One `personality.json` file, written synchronously on every message. Two concurrent requests = race condition = lost writes. No per-user personality. The architecture plan describes per-user containers with isolated state. What exists is one global personality file.

### No request queuing

If 5 messages arrive while Claude is processing message 1, they all spawn concurrent Claude processes. No queue, no backpressure, no "your daemon is thinking, please wait." Just 5 processes fighting for RAM.

---

## 2. Reliability

### WebSocket device registration: zero auth (ws-server.js:91-99)

```javascript
case 'device_register':
  deviceId = msg.device_id || `device-${Date.now()}`
  devices.set(deviceId, { ws, info: msg, ... })
```

Any WebSocket connection to port 4801 can register as any device. Send `{"type": "device_register", "device_id": "Pixel 8 Pro"}` and you've hijacked Arthur's phone. The architecture plan describes X25519 key exchange and 6-character pairing codes. None of that exists.

The `/command` endpoint (ws-server.js:30-74) has no authentication either. Any HTTP POST to `localhost:4801/command` can send commands to any connected device. It's only safe because Cloudflare tunnel presumably doesn't expose port 4801 -- but one misconfiguration and it's open.

### ESP32 connection: raw TCP, no auth, no encryption (tools_mcp.py:249-267)

The ESP32 command goes: Claude process -> MCP tool -> SSH to MSI -> Python script -> TCP to 192.168.1.191:8266. Five hops, zero authentication at the ESP32 end. Anyone on the local WiFi can send MicroPython commands to the ESP32. The `esp32ScanAndCommand` in CommandExecutor.kt (line 366-391) literally brute-force scans every IP on four subnets trying to find an ESP32. This is a network scanner, not a device control protocol.

### Sensor polling chain

The live sensor page polls: browser -> HTTP -> Next.js -> WebSocket server -> WebSocket to phone -> phone reads sensor -> response back through the chain. Six hops for a temperature reading. If any link drops, the poll silently returns nothing. There's no error propagation, no retry with backoff, no "sensor unavailable" state. The `catch {}` blocks throughout the codebase (route.ts:48, route.ts:106, route.ts:125) swallow errors silently.

### Reconnection is naive (DaemonService.kt:123-135)

```kotlin
scope.launch {
    delay(5000)
    connectWebSocket()
}
```

Fixed 5-second retry with no exponential backoff, no jitter, no max retry limit. If the server is down for an hour, the phone hammers it every 5 seconds. If 100 devices disconnect simultaneously (server restart), they all reconnect at the same time (thundering herd).

---

## 3. Claude Code CLI as Backend

### The fundamental problem

Every message:
1. Spawns a new OS process
2. That process loads Node.js (Claude Code runtime)
3. Reads and parses the system prompt file
4. If MCP tools needed: spawns ANOTHER process (Python MCP server)
5. Connects to Anthropic API
6. Waits for response (15-27s)
7. Returns JSON
8. Process dies

This is CGI-bin architecture from 1995. It works, but it's the worst possible approach for a real-time conversational agent.

### Why it exists (honest)

The Max subscription only works through the CLI. There's no API endpoint for Max. The `--resume` flag gives conversation continuity without managing context windows manually. It's the pragmatic choice for a single-user prototype. The architecture plan acknowledges this: "Agent SDK requires pay-per-token API key. Max subscription only works via claude CLI."

### What it costs

- **Latency:** 15-27s per message minimum. Unacceptable for a "companion" product. Character.ai responds in <2s. Even Claude's web UI is 3-5s.
- **No streaming:** The response comes back as one JSON blob after Claude finishes. No token-by-token streaming. The user stares at a spinner for 20 seconds.
- **Memory:** Each Claude process uses 200-500MB. Two concurrent chats and you're at 1GB just for Claude processes.
- **No mid-conversation tool use visibility:** User can't see the daemon thinking, using tools, or accessing devices in real-time.

### Alternatives (in order of viability)

1. **Claude API with prompt caching (best for multi-user):** Pay per token, but cache the system prompt + personality + knowledge context. With 90% cache hits, cost drops to ~$2-5/user/month for light usage. Requires users to bring their own key or you to pay.

2. **`--input-format stream-json --output-format stream-json` (best for single-user):** The architecture plan mentions this but it's not implemented. Keep one long-running Claude process per user, pipe messages in, stream responses out. Eliminates process spawn overhead. Still limited to Max subscription throughput.

3. **Agent SDK (best for BYOK):** The Anthropic Agent SDK is designed for exactly this use case. Users who bring their own API key get Agent SDK; subscription users get the managed backend. This is the architecture plan's Phase 2 strategy and it's the right call.

---

## 4. Knowledge Graph

### Qdrant + Gemini embeddings: right choice, wrong execution

The choice of Qdrant for vector storage and Gemini for embeddings is fine. The problem is the execution.

**Duplicate systems:** There are TWO memory systems:
- `memory.py`: Single collection `daemon_memory`, stores raw conversation turns
- `knowledge.py`: Five collections (`daemon_entities`, `daemon_facts`, `daemon_events`, `daemon_preferences`, `daemon_conversations`), extracts structured knowledge using Claude Haiku

Both are called from `route.ts:111-126` via `storeKnowledge()`, which imports from `knowledge.py` AND `memory.py`. Two embedding calls per message, two Qdrant writes, with different schemas and no deduplication between them.

**Silent failure (route.ts:111-126):**

```typescript
async function storeKnowledge(userMsg: string, daemonMsg: string) {
  try {
    execFileAsync(VENV_PYTHON, [...], { timeout: 15000 })
  } catch {
    // Non-critical, don't block
  }
}
```

The fire-and-forget pattern means: if Qdrant goes down, if the Google API key expires, if the Python venv breaks -- the daemon silently stops building memory. No alerting, no health check, no dashboard showing "last memory stored: 3 weeks ago." The daemon's long-term memory -- its core differentiator -- could be broken for months and nobody would notice.

**Knowledge extraction spawns Claude Haiku (knowledge.py:118-134):**

```python
result = subprocess.run(
    ["claude", "-p", prompt, "--output-format", "json",
     "--model", "haiku", "--no-session-persistence"],
    capture_output=True, text=True, timeout=30,
)
```

Every conversation turn spawns ANOTHER Claude process to extract structured knowledge. So each message spawns: one Opus process (for the response) + one Haiku process (for knowledge extraction) + two Gemini API calls (for embeddings). Four external API calls per message.

**The recall is good, the storage is wasteful.** `build_knowledge_context()` queries all five collections and assembles a structured prompt section. That's well-designed. But the storage pipeline is over-engineered for what amounts to a personal journal.

### Should you just use Claude's built-in context?

For a single user with the `--resume` flag, Claude already maintains conversation context. The knowledge graph adds value for CROSS-SESSION recall ("what were we working on last month?") and for injecting relevant context that wouldn't fit in the conversation window. Keep it, but consolidate to one collection with structured metadata instead of five collections with separate embedding calls.

---

## 5. Auth Model

### Password hashing: SHA-256, not bcrypt (users.py:33-36)

```python
def hash_password(password):
    salt = secrets.token_hex(16)
    h = hashlib.sha256((salt + password).encode()).hexdigest()
    return f"{salt}:{h}"
```

SHA-256 is a fast hash. That's bad for passwords. A GPU can compute billions of SHA-256 hashes per second. Use `bcrypt`, `scrypt`, or `argon2`. This is a one-line fix with massive security impact.

### No token expiry (users.py:64-66)

```python
token = secrets.token_hex(32)
db.execute("INSERT INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)",
           (token, user["id"], datetime.now(timezone.utc).isoformat()))
```

Tokens never expire. Once issued, valid forever. No refresh token rotation. No "log out all devices." If a token leaks, the attacker has permanent access.

### Token validation via Python subprocess (route.ts:136-144)

```typescript
const authCheck = await execFileAsync(VENV_PYTHON, ['-c', `
from users import get_user_by_token
u=get_user_by_token("${token.replace(/"/g,'')}")
print(json.dumps({"ok":True} if u else {"ok":False}))
`], { timeout: 3000 })
```

Every authenticated request spawns a Python process to check a token against SQLite. This is ~100-300ms of overhead per request. A simple in-process SQLite query via `better-sqlite3` (Node.js) would be <1ms.

The `token.replace(/"/g,'')` on line 139 is an attempt at injection prevention, but it only strips double quotes. A token containing `\n` or backticks or triple-quoted strings could still break the Python inline script. This isn't SQL injection (the actual SQL in `users.py` uses parameterized queries correctly), but it's command injection in the Python string interpolation layer.

### Middleware doesn't validate tokens (middleware.ts:63-76)

```typescript
const token = request.cookies.get('daemon_token')?.value
if (!token) {
    // No token -> 401
}
// Has token -> let through
return NextResponse.next()
```

The middleware only checks if a token EXISTS, not if it's VALID. Any random string in the `daemon_token` cookie passes the middleware. The actual validation happens in `route.ts` for the chat API, but other protected routes (if any exist) just check for cookie presence.

### No rate limiting anywhere

No rate limiting on login (brute-force passwords), no rate limiting on chat (spam the Claude API), no rate limiting on device commands (DoS connected devices). A single `while(true)` loop could exhaust the Anthropic API quota.

---

## 6. The "Data on Device" Promise

The architecture plan is explicit: "Data Architecture: Nothing Stored on Server." Here's what's actually stored on the server:

| Data | Claimed location | Actual location |
|------|-----------------|-----------------|
| Conversations | "Every connected device" | In-memory on server (`sessions` object in route.ts:52). Lost on restart. |
| Personality | "Every connected device" | `/home/arthur/daemon/config/personality.json` on server. Single file. |
| Knowledge graph | "Every connected device" | Qdrant on server (localhost:6333). 5+ collections. |
| Memory | "Every connected device" | Qdrant on server. `daemon_memory` collection. |
| User accounts | Not mentioned | SQLite on server (`/home/arthur/daemon/data/users.db`). |
| SOUL.md | Not mentioned | On server filesystem. |

**Zero data lives on user devices.** The Android app stores nothing locally. It's a pure command executor -- it receives commands via WebSocket, executes them, and returns results. There's no local SQLite, no personality cache, no conversation history on the phone.

The architecture plan describes: "Container loads state from first connecting device on session start, pushes deltas to all devices on change." None of this sync protocol exists. The `DaemonService.kt` has no data storage, no sync capability, no offline mode.

**This matters because:** The BMC sells "You own everything. Your data stays on your devices. Export anytime." Today, if arturito's disk dies, every daemon's personality, memories, and knowledge graph are gone. The privacy story is backwards -- the server has everything, the devices have nothing.

---

## 7. MCP Tools: Unsandboxed Remote Execution

### SSH with full privileges (tools_mcp.py:166-191)

```python
def run_ssh(host: str, command: str, timeout: int = 30) -> dict:
    if host == "arturito":
        result = subprocess.run(["bash", "-c", command], ...)
    else:
        result = subprocess.run(["ssh", host, command], ...)
```

For `arturito`, it's literally `bash -c <user-controlled-string>`. The Claude model decides what command to run, but the user's message influences the model. A prompt injection in a chat message could lead to: "Run `rm -rf /` on arturito." The model should refuse, but there's no server-side allowlist or sandboxing.

For remote hosts, it's `ssh host <command>` with full privileges of the SSH user. No command filtering, no audit log, no capability restriction.

### Phone command injection (CommandExecutor.kt:310-326)

```kotlin
fun runCommand(cmd: JSONObject): JSONObject {
    val command = cmd.optString("command", "")
    val process = Runtime.getRuntime().exec(arrayOf("sh", "-c", command))
```

The `run_command` type in the Android app executes arbitrary shell commands. Anyone who can send a WebSocket message to the device (which requires zero auth, see section 2) can execute any command on the phone.

### File system access (CommandExecutor.kt:262-308)

`list_files` and `read_file` have no path restriction. The daemon can read `/data/data/com.whatsapp/databases/` if it has root. Even without root, it can read any file the app has access to -- photos, downloads, documents. The architecture plan describes `"files": {"read": "~/daemon/**", "write": "~/daemon/**"}` capability manifests. Not implemented.

### MCP tool loading regex (route.ts:174)

```typescript
const needsTools = /ssh|device|esp32|sensor|distance|temperature|phone|battery|pixel|msi|arturito|screen|display|hardware|run|execute|check|what.*running|connect/i.test(message)
```

The word "check" triggers MCP tool loading. "Can you check my grammar?" loads SSH and device control tools. The word "run" triggers it. "How do I run a marathon?" loads SSH tools. False positives waste ~2-5s on MCP initialization. False negatives mean "access my server" doesn't load tools because none of the trigger words match.

---

## 8. The Right Architecture

### What exists vs. what should exist

```
WHAT EXISTS (single-user prototype)
====================================

Browser ---HTTPS---> Next.js (:4800)
                        |
                        | spawn per message
                        v
                     Claude CLI process
                        |
                        | stdio MCP
                        v
                     Python MCP server
                        |
                        | subprocess
                        v
                     SSH / TCP / HTTP
                        |
               +--------+--------+
               v        v        v
             arturito   msi    pixel/esp32

Phone ---WSS---> ws-server.js (:4801) [no auth]

State: personality.json (file), Qdrant (server), sessions (memory)
Auth: cookie token, Python subprocess validation
```

```
WHAT SHOULD EXIST (multi-user, same server)
=============================================

Browser ---HTTPS---> Caddy (:443)
  |                     |
  |  Cloudflare Access  |  route by subdomain
  |  (Google login)     |
  |                     v
  +--SSE/WS-------> Next.js (:4800)
                        |
                        | long-lived process per user (pool of 5-10)
                        v
                     Claude worker pool
                        |  (stream-json mode for Max users)
                        |  (Agent SDK for BYOK users)
                        |
                        | in-process MCP
                        v
                     Tool executor (sandboxed)
                        |  - SSH: allowlisted commands only
                        |  - Phone: via authenticated WS
                        |  - ESP32: via phone bridge (not direct)
                        |
               +--------+--------+
               v        v        v
             arturito   msi    pixel/esp32

Phone ---WSS---> ws-server.js (:4801)
  |                 |  [device pairing auth]
  |                 |  [encrypted channel]
  +-- local SQLite: conversations, personality, knowledge cache
  +-- sync on connect: push local changes, pull server changes

State: primary on user devices, server is ephemeral cache
Auth: Cloudflare Access + JWT with 24h expiry + refresh tokens
Knowledge: single Qdrant collection per user, namespace isolation
```

---

## 9. Concrete Fixes (Ordered by Impact/Effort)

### Tier 1: Do this week (high impact, low effort)

| # | Fix | File | Effort | Impact |
|---|-----|------|--------|--------|
| 1 | **Replace SHA-256 with bcrypt** for passwords | `server/users.py:33-36` | 10 min | Prevents password cracking if DB leaks |
| 2 | **Add token expiry** (24h) + cleanup cron | `server/users.py:64-66` | 30 min | Prevents permanent token theft |
| 3 | **Validate tokens in middleware**, not just check existence | `web/src/middleware.ts:63-76` | 1 hr | Fixes the "any cookie value passes" bug |
| 4 | **Add WebSocket auth** -- require token on connection, verify before registering device | `web/ws-server.js:82-99` | 1 hr | Prevents device impersonation |
| 5 | **Move token validation to in-process SQLite** (use `better-sqlite3`) instead of spawning Python | `web/src/app/api/chat/route.ts:136-144` | 2 hr | Eliminates 100-300ms auth overhead and command injection risk |
| 6 | **Add request queue** -- one Claude process at a time, return "thinking" for concurrent requests | `web/src/app/api/chat/route.ts:128` | 2 hr | Prevents RAM exhaustion from concurrent spawns |
| 7 | **Add health check for knowledge storage** -- log last successful write, alert if >24h stale | `server/knowledge.py`, `server/memory.py` | 1 hr | Prevents silent memory death |

### Tier 2: Do this month (high impact, medium effort)

| # | Fix | Effort | Impact |
|---|-----|--------|--------|
| 8 | **Consolidate memory.py and knowledge.py** into one module with one collection per user (namespaced by user_id in payload) | 1 day | Halves embedding API calls, simplifies codebase |
| 9 | **Implement stream-json mode** -- keep one long-lived Claude process, pipe messages in/out | 2 days | Eliminates process spawn overhead, enables streaming responses to UI |
| 10 | **Add device pairing protocol** -- 6-char code, verify on both ends, store device credentials | 2 days | Makes the "first to register wins" attack impossible |
| 11 | **Add command allowlisting for SSH** -- define permitted command patterns per host, reject everything else | 1 day | Prevents prompt injection -> arbitrary code execution |
| 12 | **Remove `run_command` from Android CommandExecutor** or gate it behind explicit user approval | 30 min | Closes arbitrary code execution on phone |
| 13 | **Add exponential backoff with jitter** to DaemonService reconnection | 30 min | Prevents thundering herd on server restart |
| 14 | **Persist sessions to SQLite** instead of in-memory object | 2 hr | Survives server restarts |

### Tier 3: Do before multi-user launch

| # | Fix | Effort | Impact |
|---|-----|--------|--------|
| 15 | **Implement per-user data namespacing** -- every Qdrant point gets a `user_id` field, all queries filter by it | 1 day | Prerequisite for multi-user |
| 16 | **Add local storage to Android app** -- SQLite for conversations, personality cache, knowledge excerpts | 3 days | Makes the "data on device" promise real |
| 17 | **Implement sync protocol** -- on device connect, diff local vs server state, merge | 5 days | Enables offline-first, makes server ephemeral |
| 18 | **Add BYOK support** -- detect user's API key, use Agent SDK instead of CLI | 3 days | Unlocks the free tier, eliminates Max subscription dependency |
| 19 | **Implement gVisor containers** per the architecture plan | 1 week | Real multi-tenant isolation |
| 20 | **Rate limiting** -- per-user, per-endpoint, with sensible defaults | 1 day | Prevents abuse |

---

## 10. The Honest Assessment

The daemon works as Arthur's personal tool. The Android app is solid -- camera, sensors, battery, GPS, file access all work. The knowledge graph retrieval is well-designed. The personality system is charming. The BMC is the best-written business plan I've read for a hardware AI product.

But the gap between the architecture plan and the implementation is enormous. The plan describes gVisor containers, X25519 key exchange, capability manifests, device pairing codes, data-on-device sync, stream-json mode. The implementation has: spawn a process, write a file, hope for the best.

The most dangerous thing is not the security holes or the scalability limits. It's that the "data on device" promise -- the core differentiator that makes daemon not-just-another-chatbot -- is a lie in the current code. Every byte of daemon state lives on arturito. Fix that first, because it's the one thing that can't be hand-waved in a demo.

The second most dangerous thing is the 15-27s response time. No amount of personality or settling compensates for waiting 20 seconds for a reply. Stream-json mode (fix #9) is the single highest-impact change for user experience.

Everything else is fixable incrementally. The foundation is sound. The plan is right. The code just hasn't caught up yet.
