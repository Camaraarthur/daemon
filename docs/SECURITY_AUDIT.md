# Daemon Platform Security Audit

**Date**: 2026-04-05
**Scope**: Full codebase at `/home/arthur/daemon/`
**Auditor**: Automated penetration test (Claude)
**Server tested**: localhost:4800 (web), localhost:4801 (WebSocket)

---

## Executive Summary

Found **3 Critical**, **5 High**, **6 Medium**, and **5 Low** severity issues. The most dangerous is a **confirmed remote code execution** via the memory API that allows any authenticated user to execute arbitrary Python code on the server. Two additional critical issues involve missing user-tenant isolation in the chat system and an unsandboxed auto-update mechanism in the CLI.

---

## CRITICAL

### VULN-01: Remote Code Execution via Memory API (Python Injection)

- **Severity**: Critical
- **File**: `/home/arthur/daemon/web/src/app/api/memory/route.ts`
- **Lines**: 25-49

**Description**: The `runMemorySearch()` function constructs Python code by string-interpolating user input directly into executable Python. The `projectId` parameter in both the `grep` and `context` actions is inserted without any sanitization or escaping into a Python expression that gets passed to `execFileAsync(python, ['-c', script])`.

```typescript
// Line 46 — projectId inserted raw into Python code
script = `
from memory_search import get_project_context
ctx = get_project_context(${projectId})   // <-- INJECTION POINT
print(json.dumps({"context": ctx}))
`
```

**Attack vector**: Any authenticated user sends:
```
GET /api/memory?action=context&projectId=0)%0aimport%20subprocess;print(subprocess.getoutput('id'))%0a%23
```

**Confirmed exploit**: The server responded with `uid=1000(a...` proving arbitrary command execution.

**Impact**: Full server compromise. Attacker can read/write any file, access the database, steal API keys from vault.env, pivot to other machines via Tailscale SSH.

**Fix**: Pass `projectId` via stdin as JSON (same pattern used in chat/route.ts for knowledge/store), or validate it as an integer:
```typescript
const safeProjectId = parseInt(projectId, 10)
if (isNaN(safeProjectId)) throw new Error('Invalid projectId')
```
The `pattern` parameter in the `grep` action uses `JSON.stringify()` which provides escaping, but `projectId` in both `grep` (line 38: `project_id=${projectId}`) and `context` (line 48: `get_project_context(${projectId})`) is raw-interpolated.

**Test**: After fix, verify the following returns an error, not command output:
```bash
curl -s "http://localhost:4800/api/memory?action=context&projectId=0)%0aimport%20os;os.system('id')%0a%23" \
  -b "daemon_token=VALID_TOKEN"
```

---

### VULN-02: Missing Tenant Isolation in Chat — Any User Can Read/Write Any Thread

- **Severity**: Critical
- **File**: `/home/arthur/daemon/web/src/app/api/chat/route.ts`
- **Lines**: 564-611

**Description**: The chat POST handler accepts a `threadId` from the client and uses it directly as `threadKey` without verifying that the thread belongs to the authenticated user. The `getThread()` function (db.ts line 281) queries by thread ID alone with no `user_id` filter. The handler then:

1. Reads the thread's project (line 564-566) — leaking another user's project context
2. Reads messages from the thread (line 205) — via `maybeGenerateMemory` which calls `listMessages(threadKey, 200)`
3. Writes messages to the thread (line 611) — poisoning another user's conversation

**Attack vector**: User A guesses or enumerates thread IDs (UUIDs are random but thread IDs can be client-supplied), then sends:
```bash
curl -X POST http://localhost:4800/api/chat \
  -b "daemon_token=USER_A_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"message":"What was discussed?","threadId":"USER_B_THREAD_ID","stream":false}'
```

The system prompt will include User B's project memory and context. The response will be stored in User B's thread.

Note: The `/api/threads/[id]/messages` route DOES check `thread.user_id !== userId` correctly (line 19). The chat route does not.

**Impact**: Cross-tenant data leakage, conversation poisoning, potential privilege escalation if project context contains secrets.

**Fix**: Add user ownership check in the chat route:
```typescript
if (threadId) {
  const thread = db.getThread(threadId)
  if (thread && thread.user_id !== parseInt(userId)) {
    return NextResponse.json({ error: 'Thread not found' }, { status: 404 })
  }
}
```

---

### VULN-03: CLI Auto-Update RCE — No Code Signing or Integrity Verification

- **Severity**: Critical
- **File**: `/home/arthur/daemon/cli/daemon.mjs`
- **Lines**: 682-725

**Description**: The CLI auto-update mechanism downloads code from a URL specified in a JSON file (`https://my.daemon.page/cli/version.json`), then overwrites its own source file and restarts. There is:

1. No cryptographic signature verification on the downloaded code
2. No hash/checksum validation
3. The `httpGet()` function follows redirects blindly (line 656) — an attacker who compromises DNS or the server can redirect to a malicious URL
4. The only validation is `newCode.length > 100` (line 697)

**Attack vector**: MITM attack on the network, DNS poisoning, or compromising the daemon.page server allows an attacker to push arbitrary JavaScript that executes with the user's full privileges on every device running the daemon CLI.

**Impact**: Full compromise of every device running the daemon CLI. The CLI has shell access, file read/write, and runs as the user.

**Fix**:
1. Pin the download to HTTPS with certificate validation (already using https, good)
2. Add Ed25519 signature verification: the version.json should include a signature, and the CLI should embed the public key
3. At minimum, add SHA-256 hash verification:
```javascript
const expectedHash = info.sha256
const actualHash = createHash('sha256').update(newCode).digest('hex')
if (actualHash !== expectedHash) {
  err('Update hash mismatch — aborting')
  return false
}
```

---

## HIGH

### VULN-04: Google OAuth — No Audience (aud) Validation

- **Severity**: High
- **File**: `/home/arthur/daemon/web/src/app/api/auth/route.ts`
- **Lines**: 85-88

**Description**: The Google Sign-In flow sends the `id_token` to Google's `tokeninfo` endpoint but never validates the `aud` (audience) claim. This means a token issued for a *different* application (any Google OAuth client) can be used to authenticate to Daemon.

**Attack vector**: Attacker obtains a Google OAuth token for the victim's email from any other app (or their own malicious app), then uses it to log in to Daemon:
```bash
curl -X POST http://localhost:4800/api/auth \
  -H "Content-Type: application/json" \
  -d '{"action":"google","credential":"TOKEN_FROM_DIFFERENT_APP"}'
```

**Impact**: Account takeover for any user who has a Google-linked account, without knowing their password.

**Fix**: After receiving the `gData` response, verify the audience:
```typescript
const EXPECTED_CLIENT_ID = process.env.GOOGLE_CLIENT_ID
if (gData.aud !== EXPECTED_CLIENT_ID) {
  return NextResponse.json({ error: 'Invalid token audience' }, { status: 401 })
}
```

---

### VULN-05: No Session Revocation / Logout Endpoint

- **Severity**: High
- **Files**: `/home/arthur/daemon/web/src/app/api/auth/route.ts`, `/home/arthur/daemon/server/users.py`

**Description**: There is no logout endpoint. Sessions last 30 days and cannot be revoked by the user. The `cleanup_expired_sessions()` function exists in `users.py` but there is no API to call it, and no way for a user to invalidate their own session.

**Attack vector**: If a session token is stolen (XSS, network sniffing, log file exposure), the attacker has 30 days of access with no way for the victim to revoke it.

**Impact**: Extended unauthorized access after credential theft.

**Fix**: Add a `POST /api/auth` with `action: 'logout'` that deletes the session from the database:
```python
def revoke_session(token):
    db = get_db()
    db.execute("DELETE FROM sessions WHERE token = ?", (token,))
    db.commit()
```

---

### VULN-06: Settings API — Token Passed via Environment Variable Without Sanitization

- **Severity**: High
- **Files**: `/home/arthur/daemon/web/src/app/api/settings/route.ts` (line 21), `/home/arthur/daemon/web/src/app/api/me/route.ts` (line 22)

**Description**: The `settings/route.ts` and `me/route.ts` pass the raw `daemon_token` cookie value to Python via the `AUTH_TOKEN` environment variable without calling `sanitizeToken()`. While `execFile` prevents shell injection, environment variables have OS-specific length and character restrictions. More importantly, the token is not validated as a 64-char hex string before being used, which means:

1. The Python `get_user_by_token()` receives arbitrary strings
2. Error messages may leak internal paths or stack traces

Compare with `auth.ts` which properly calls `sanitizeToken(token)` and `chat/route.ts` which calls its own `sanitizeToken()`.

**Impact**: Information disclosure via error messages, potential for unexpected behavior in the Python layer.

**Fix**: Import and use `sanitizeToken` from `@/lib/sanitize` in both routes before passing to Python. Alternatively, pass the token via stdin as done in the chat route's `getUserTier()`.

---

### VULN-07: WebSocket Health Endpoint Leaks All Users' Device Information

- **Severity**: High
- **File**: `/home/arthur/daemon/web/ws-server.js`
- **Lines**: 174-194

**Description**: The `/health` endpoint on port 4801 returns device information for ALL users without any authentication. It exposes `userId`, `deviceId`, device name, platform, and connection stats.

**Confirmed**: `curl http://localhost:4801/health` returns all connected devices with their user IDs.

**Attack vector**: Any client that can reach port 4801 can enumerate all connected devices and their owners. While the port is not directly exposed (proxied only for `/ws/*` paths), the internal network (Tailscale mesh) can access it directly.

**Impact**: User enumeration, device fingerprinting, reconnaissance for targeted attacks.

**Fix**: Either require authentication on the `/health` endpoint, or filter the response to only show the requesting user's devices (requires passing a token). At minimum, remove `userId` from the response and add rate limiting.

---

### VULN-08: WebSocket /command Endpoint — Fallback Allows Cross-User Device Access

- **Severity**: High
- **File**: `/home/arthur/daemon/web/ws-server.js`
- **Lines**: 214-227

**Description**: When the `/command` POST endpoint receives a request without a `user_id` field, it falls back to searching ALL users' device maps (lines 218-227). While it logs a warning, it still allows the command to proceed. Any internal caller that omits `user_id` can send commands to any user's device.

**Impact**: Cross-user command execution on devices. An attacker who can reach port 4801 (internal network) can run commands on any connected device.

**Fix**: Make `user_id` required. Reject requests without it:
```javascript
if (!requestUserId) {
  res.writeHead(400, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ error: 'user_id is required' }))
  return
}
```

---

## MEDIUM

### VULN-09: CLI Clipboard Sync — PowerShell Command Injection (Windows)

- **Severity**: Medium
- **File**: `/home/arthur/daemon/cli/daemon.mjs`
- **Line**: 239

**Description**: The `setClipboard()` function on Windows uses string interpolation into a PowerShell command:
```javascript
exec(`powershell -c "Set-Clipboard -Value '${text.replace(/'/g, "''")}'"`);
```
While single quotes are escaped, the text is wrapped in double quotes at the outer `exec()` level. A clipboard payload containing `'"; calc.exe; echo "` would break out of the PowerShell string.

**Attack vector**: Device A (attacker-controlled, same user) sends a clipboard_update with a malicious payload. Device B (Windows) receives it and executes arbitrary commands.

**Impact**: Remote code execution on Windows devices through clipboard sync.

**Fix**: Write clipboard content via stdin instead of command-line argument:
```javascript
const proc = exec('powershell -c "$input | Set-Clipboard"')
proc.stdin.write(text)
proc.stdin.end()
```

---

### VULN-10: Rate Limiting — In-Memory, Per-Process, Easily Bypassed

- **Severity**: Medium
- **File**: `/home/arthur/daemon/web/src/app/api/chat/route.ts`
- **Lines**: 54-92

**Description**: Rate limiting uses an in-memory `Map<string, RateLimitEntry>` which:
1. Resets on every server restart
2. Is per-user (keyed by `userId`), not per-IP — a single user cannot be stopped, but there's no protection against creating multiple accounts
3. Is not shared across worker processes if Next.js runs multiple workers

**Impact**: Abuse of API resources (AI model calls that cost money), DoS through resource exhaustion.

**Fix**: Move rate limiting to SQLite (already have the DB) or Redis. At minimum, add IP-based rate limiting for unauthenticated endpoints (login, signup).

---

### VULN-11: Pairing Code Brute-Force — No Rate Limiting on Claim Action

- **Severity**: Medium
- **File**: `/home/arthur/daemon/web/src/app/api/pair/route.ts`

**Description**: The pairing code is 6 characters from a 30-character alphabet (approximately 729 million combinations). The `claim` action has no rate limiting or account lockout. While the code expires in 5 minutes, an attacker who knows a code is active could attempt brute-force. At 100 requests/second, the full keyspace would take ~84 days, but partial guesses (first few characters observed over someone's shoulder) reduce this dramatically.

**Impact**: Unauthorized device pairing if partial code is leaked.

**Fix**: Add exponential backoff on failed claim attempts (per IP). After 5 failed attempts, require a CAPTCHA or block the IP for 15 minutes.

---

### VULN-12: Daemon Name Enumeration via Auth Check

- **Severity**: Medium
- **File**: `/home/arthur/daemon/web/src/app/api/auth/route.ts`
- **Lines**: 71-79

**Description**: The `action: 'check'` endpoint reveals whether a daemon_name is taken, allowing enumeration of all registered users. This is unauthenticated and has no rate limiting.

**Impact**: User enumeration for targeted attacks, phishing, or credential stuffing.

**Fix**: Add rate limiting (by IP) to the check endpoint. Consider returning the same response regardless of whether the name exists (delay response by random amount to prevent timing attacks).

---

### VULN-13: Database File World-Readable

- **Severity**: Medium
- **File**: `/home/arthur/daemon/data/users.db`

**Description**: The SQLite database file has permissions `644` (world-readable). It contains password hashes, session tokens, and user data.

```
-rw-r--r-- 1 arthur arthur 25747456 Apr  5 21:08 /home/arthur/daemon/data/users.db
```

**Impact**: Any process or user on the system can read the database, including session tokens (which grant full access to user accounts).

**Fix**:
```bash
chmod 600 /home/arthur/daemon/data/users.db
```

---

### VULN-14: Device Token Stored in Plaintext on Client

- **Severity**: Medium
- **File**: `/home/arthur/daemon/cli/daemon.mjs`
- **Lines**: 809-812

**Description**: The device token is saved to `~/.daemon/config.json` in plaintext. Anyone with read access to the user's home directory can steal the device token and impersonate the device.

**Impact**: Device impersonation, unauthorized access to the user's daemon account via the device bridge.

**Fix**: Use OS-native credential storage:
- macOS: Keychain (`security add-generic-password`)
- Linux: `libsecret` / `gnome-keyring` / `kwallet`
- Windows: Credential Manager (`cmdkey`)

At minimum, set file permissions to 600:
```javascript
await writeFile(CONFIG_PATH, JSON.stringify(merged, null, 2), { mode: 0o600 })
```

---

## LOW

### VULN-15: Stream API — Wildcard CORS

- **Severity**: Low
- **File**: `/home/arthur/daemon/web/src/app/api/stream/route.ts`
- **Line**: 55

**Description**: The SSE stream endpoint sends `Access-Control-Allow-Origin: *`. While the comment says it's intentionally public and contains no sensitive data, if sensitive data is accidentally pushed to the stream in the future, it would be accessible from any origin.

**Fix**: Restrict to `*.daemon.page` origins or remove the header (SSE from same-origin works without CORS).

---

### VULN-16: WebSocket Server — No Connection Rate Limiting

- **Severity**: Low
- **File**: `/home/arthur/daemon/web/ws-server.js`

**Description**: There is no limit on the number of WebSocket connections from a single IP. An attacker could open thousands of connections, exhausting server memory (each connection allocates a `stats` object, interval timers, etc.).

**Fix**: Track connections per IP and reject after a threshold (e.g., 10 per IP). Use the `req.socket.remoteAddress` available in the `connection` handler.

---

### VULN-17: Error Messages Leak Internal Paths

- **Severity**: Low
- **Files**: `/home/arthur/daemon/web/src/app/api/memory/route.ts` (line 107)

**Description**: Error responses include full Python stack traces with internal file paths:
```json
{"error":"Memory search failed","details":"Command failed: /home/arthur/daemon/.venv/bin/python3 -c ..."}
```

**Impact**: Information disclosure — attacker learns the server's file structure, Python version, installed packages.

**Fix**: Log full errors server-side, return generic messages to clients:
```typescript
return NextResponse.json({ error: 'Memory search failed' }, { status: 500 })
```

---

### VULN-18: Legacy SHA-256 Password Hash Migration Window

- **Severity**: Low
- **File**: `/home/arthur/daemon/server/users.py`
- **Lines**: 42-48

**Description**: The `check_password()` function supports legacy SHA-256 hashed passwords and migrates them to bcrypt on login. During the migration, both the old and new hashes exist briefly. If migration fails (line 59), the weak SHA-256 hash remains indefinitely. SHA-256 with a simple salt is fast to brute-force compared to bcrypt.

**Fix**: Run a one-time migration script to upgrade all remaining SHA-256 hashes. After confirming all are migrated, remove the legacy code path.

---

### VULN-19: Hosted Sites Missing Security Headers

- **Severity**: Low
- **File**: `/home/arthur/daemon/web/src/app/api/hosted/[...path]/route.ts`

**Description**: User-deployed sites are served with minimal security headers. Missing:
- `Content-Security-Policy` — user sites can run any scripts, load any resources
- `X-Frame-Options` — sites can be iframed (clickjacking)
- `Referrer-Policy`

While user-deployed sites should have freedom, there should at minimum be an `X-Frame-Options: DENY` to prevent the parent daemon.page UI from being framed, and sites should be on isolated subdomains (they are: `username.daemon.page`).

**Fix**: Add `X-Frame-Options: SAMEORIGIN` and `Referrer-Policy: strict-origin-when-cross-origin` to hosted site responses. Consider a basic CSP for the main daemon.page domain.

---

## Summary Table

| ID | Severity | Category | Component | Status |
|----|----------|----------|-----------|--------|
| VULN-01 | **CRITICAL** | Code Injection | memory/route.ts | Confirmed RCE |
| VULN-02 | **CRITICAL** | Tenant Isolation | chat/route.ts | Exploitable |
| VULN-03 | **CRITICAL** | Supply Chain | cli/daemon.mjs | Design flaw |
| VULN-04 | HIGH | Auth Bypass | auth/route.ts | Exploitable |
| VULN-05 | HIGH | Session Management | auth system | Missing feature |
| VULN-06 | HIGH | Input Validation | settings/route.ts, me/route.ts | Inconsistent |
| VULN-07 | HIGH | Info Disclosure | ws-server.js /health | Confirmed |
| VULN-08 | HIGH | Tenant Isolation | ws-server.js /command | Design flaw |
| VULN-09 | MEDIUM | Command Injection | cli/daemon.mjs clipboard | Windows only |
| VULN-10 | MEDIUM | Rate Limiting | chat/route.ts | Weak implementation |
| VULN-11 | MEDIUM | Brute Force | pair/route.ts | Missing controls |
| VULN-12 | MEDIUM | User Enumeration | auth/route.ts | By design? |
| VULN-13 | MEDIUM | File Permissions | data/users.db | Confirmed |
| VULN-14 | MEDIUM | Credential Storage | cli/daemon.mjs | Plaintext |
| VULN-15 | LOW | CORS | stream/route.ts | Wildcard |
| VULN-16 | LOW | DoS | ws-server.js | Missing controls |
| VULN-17 | LOW | Info Disclosure | memory/route.ts | Confirmed |
| VULN-18 | LOW | Crypto | users.py | Legacy code |
| VULN-19 | LOW | Headers | hosted/route.ts | Missing headers |

---

## Positive Findings

Things done well:

1. **Token format validation** in `sanitize.ts` — strict 64-char hex regex
2. **Session tokens** use `secrets.token_hex(32)` — cryptographically random, 256-bit
3. **Password hashing** uses bcrypt with proper salt
4. **SQL injection prevention** — all database queries use parameterized statements (both Python sqlite3 and better-sqlite3)
5. **Path traversal protection** in deploy route — `sanitizeRelPath()` blocks `..`, absolute paths, hidden files
6. **Hosted file serving** — has belt-and-suspenders: checks path components AND verifies `filePath.startsWith(SITES_DIR)`
7. **Device token hashing** — tokens are SHA-256 hashed before storage, raw token shown only once
8. **Command whitelisting** on WebSocket — `ALLOWED_COMMAND_TYPES` set prevents arbitrary message types
9. **Malicious content scanning** in deploy — blocks known crypto miners and cookie exfiltration patterns
10. **Cookie security** — `httpOnly: true, secure: true, sameSite: 'lax'`
11. **execFile over exec** — most Python invocations use `execFile` which avoids shell interpretation
12. **Agent sandbox** — Docker/gVisor with bubblewrap fallback, resource limits, network isolation
13. **Thread message endpoint** (`/api/threads/[id]/messages`) correctly validates `thread.user_id !== userId`
14. **npm audit** — 0 known vulnerabilities in dependencies

---

## Recommended Priority

1. **Immediate** (today): Fix VULN-01 (RCE), VULN-13 (DB permissions)
2. **Urgent** (this week): Fix VULN-02 (tenant isolation), VULN-04 (Google OAuth), VULN-08 (cross-user /command)
3. **Soon** (this sprint): Fix VULN-05 (logout), VULN-07 (health endpoint), VULN-09 (clipboard injection)
4. **Planned**: Everything else
