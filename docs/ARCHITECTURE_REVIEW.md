# Daemon v0 Architecture Review

**Date:** 2026-04-05
**Reviewer:** Claude Opus 4.6 (1M context)
**Scope:** Full SPEC.md compliance audit + code quality review
**Files reviewed:** All files in `web/src/lib/`, `web/src/app/api/`, `web/ws-server.js`, `cli/daemon.mjs`, `protocol/types.ts`, `server/users.py`, `web/src/middleware.ts`

---

## Summary

The codebase has a working core: auth, chat, device pairing, clipboard sync, deploy, and an agent loop with sandboxing. However, there are significant spec deviations, critical security issues, leftover pre-v0 code, and several architectural smells. This review found **8 critical**, **14 high**, **12 medium**, and **9 low** severity issues.

---

## 1. CRITICAL ISSUES (Fix Now)

### C1. Session tokens stored as raw plaintext in DB

- **Category:** Spec mismatch / Security
- **Severity:** Critical
- **Location:** `/home/arthur/daemon/server/users.py:27-33`, `/home/arthur/daemon/server/users.py:88-96`
- **Issue:** The `sessions` table stores the raw token as its PRIMARY KEY (`token TEXT PRIMARY KEY`). The SPEC (Section 5.1) requires tokens to be stored as SHA-256 hashes (`token_hash TEXT PRIMARY KEY`). `get_user_by_token()` does `WHERE s.token = ?` with the raw token value. This means session tokens are stored in plaintext in the database. If the DB file is ever leaked, all sessions are compromised.
- **Fix:** Change sessions table to use `token_hash TEXT PRIMARY KEY`. On login, store `SHA256(token)`, not the raw token. In `get_user_by_token()`, hash the incoming token before DB lookup. This matches how `device_tokens` already works correctly.
- **Priority:** Fix now

### C2. SHA-256 password fallback still exists

- **Category:** Spec mismatch / Security
- **Severity:** Critical
- **Location:** `/home/arthur/daemon/server/users.py:43-48`
- **Issue:** The SPEC (Section 5.1) explicitly states "The SHA-256 path in the current codebase MUST be removed before launch." The `check_password()` function still has a legacy SHA-256 verification + migration path. This is a weaker hash.
- **Fix:** Remove the SHA-256 fallback entirely. If legacy users exist, force a password reset flow. The migration-on-login approach is reasonable for dev but must not ship.
- **Priority:** Fix now

### C3. Google OAuth session creation bypasses token hashing

- **Category:** Security
- **Severity:** Critical
- **Location:** `/home/arthur/daemon/web/src/app/api/auth/route.ts:93-113` and `129-155`
- **Issue:** The Google OAuth login and signup paths execute raw Python that directly inserts `secrets.token_hex(32)` as the raw token into `sessions.token`. It does not hash the token. It also does not set `expires_at` in the Google login path (line 108). This creates sessions that never expire.
- **Fix:** All session creation paths must hash the token before insertion and always set `expires_at`.
- **Priority:** Fix now

### C4. `auth.ts` validateSession passes raw token to Python via env var

- **Category:** Security
- **Severity:** Critical
- **Location:** `/home/arthur/daemon/web/src/lib/auth.ts:30-38`
- **Issue:** The token is passed to the Python process via `AUTH_TOKEN` environment variable. Environment variables are visible in `/proc/PID/environ` to any process running as the same user. The SPEC (Section 5.7) says "pass the token via process.argv or environment variable" -- but the real fix should be stdin (which the chat route already does). Environment variables persist in process listings.
- **Fix:** Pass the token via stdin (like `chat/route.ts` already does for some calls) or via a temporary file with restricted permissions.
- **Priority:** Fix now

### C5. Fuzzy device ID matching in WebSocket server

- **Category:** Spec mismatch / Security
- **Severity:** Critical
- **Location:** `/home/arthur/daemon/web/ws-server.js:121-134`
- **Issue:** The SPEC (Section 4.2) explicitly states "Device ID matching MUST be exact (no fuzzy/partial matching)." The `getUserDevice()` function does substring matching: `id.toLowerCase().includes(deviceId.toLowerCase())`. The `/command` endpoint also does fuzzy matching (line 221). This could allow User A to send commands to User B's device if device IDs overlap partially (e.g., "macbook-linux-x64" partially matching "macbook-linux-x64-v2").
- **Fix:** Remove all fuzzy matching. Only exact `deviceMap.get(deviceId)` should be used.
- **Priority:** Fix now

### C6. `/command` endpoint allows cross-user device access without user_id

- **Category:** Security
- **Severity:** Critical
- **Location:** `/home/arthur/daemon/web/ws-server.js:214-227`
- **Issue:** When `/command` is called without a `user_id` parameter, it falls through to searching ALL device maps across ALL users (line 219-226). This is the exact cross-user device access the spec prohibits. The warning log does not prevent the action.
- **Fix:** Make `user_id` required. Return 400 if missing. Never search across user maps.
- **Priority:** Fix now

### C7. Unauthenticated devices can connect to WS server

- **Category:** Spec mismatch / Security
- **Severity:** Critical
- **Location:** `/home/arthur/daemon/web/ws-server.js:327-328`
- **Issue:** If `msg.device_token` is not provided, the device is assigned `userId = 0` and allowed to connect (line 328). The SPEC (Section 3.1) says "If validation fails, the server sends an error message with code 'auth_failed' and closes the WebSocket." Unauthenticated devices should be rejected.
- **Fix:** Require `device_token`. If missing or invalid, send error and close the connection.
- **Priority:** Fix now

### C8. `memory/route.ts` has shell injection via unsanitized Python f-string interpolation

- **Category:** Security
- **Severity:** Critical
- **Location:** `/home/arthur/daemon/web/src/app/api/memory/route.ts:28-49`
- **Issue:** User-provided values (`query`, `pattern`, `projectId`) are interpolated directly into Python code via `JSON.stringify()` which is then inserted into a Python script template. `JSON.stringify` creates valid JSON strings, but these are placed inside a Python script executed by `execFile`. While `JSON.stringify` provides some escaping, this is a code injection vector. A crafted query like `"); import os; os.system("malicious")#` could break out of the string.
- **Fix:** Pass all user inputs via environment variables or stdin (as JSON), never by interpolating into Python code strings.
- **Priority:** Fix now

---

## 2. HIGH SEVERITY ISSUES

### H1. No rate limiting at the proxy layer

- **Category:** Spec mismatch
- **Severity:** High
- **Location:** Missing file — spec says `proxy/rate-limiter.ts` should exist; `config/proxy.js` is referenced but does not exist
- **Issue:** The SPEC (Sections 4.3 and 5.6) requires rate limiting at the proxy layer: 10 req/min for auth, 30 req/min for chat, 5 WS connections per IP. The chat route has its own daily rate limit (lines 55-92 in `chat/route.ts`), but there is no per-IP rate limiting at the proxy/middleware level. The proxy.js file doesn't even exist.
- **Fix:** Implement rate limiting in `web/src/middleware.ts` or create the proxy module per spec.
- **Priority:** Fix before launch

### H2. `device_tokens` table missing `expires_at` and `permissions` columns

- **Category:** Spec mismatch
- **Severity:** High
- **Location:** `/home/arthur/daemon/web/src/lib/db.ts:141-156` (migration 011)
- **Issue:** The SPEC schema (Section 6) specifies `expires_at TEXT` and `permissions TEXT DEFAULT '{"tier":0}'` columns on `device_tokens`. The actual migration and DB schema are missing both. Device tokens never expire. Tokens are also missing the `device_id UNIQUE` constraint that the spec requires.
- **Fix:** Add migration to add `expires_at`, `permissions`, and `UNIQUE(device_id)` to `device_tokens`. Enforce 30-day expiry with renewal on heartbeat.
- **Priority:** Fix before launch

### H3. `imported_sessions` table still exists (non-v0)

- **Category:** Spec mismatch
- **Severity:** High
- **Location:** `/home/arthur/daemon/web/src/lib/db.ts:80-91` (migration 004), lines 394-406 (functions)
- **Issue:** The SPEC (Section 6, "Tables removed") explicitly says `imported_sessions` should be removed for v0. It still exists in migrations, the actual DB, and has active functions (`isSessionImported`, `markSessionImported`).
- **Fix:** Remove migration 004, remove the functions, clean up any callers.
- **Priority:** Fix before launch

### H4. `subscriptions` and `credit_usage` tables still in DB

- **Category:** Spec mismatch
- **Severity:** High
- **Location:** Actual DB schema (visible in `sqlite3 .schema` output)
- **Issue:** The SPEC says to remove `subscriptions` and `credit_usage` tables. They still exist in the live database, including billing-related columns like `stripe_customer_id`, `credit_balance_usd`.
- **Fix:** Create a migration to drop these tables.
- **Priority:** Fix before launch

### H5. Non-v0 pages and routes still present

- **Category:** Spec mismatch
- **Severity:** High
- **Location:** `web/src/app/voice/page.tsx`, `web/src/app/canvas/page.tsx`, `web/src/app/logos/page.tsx`, `web/src/app/api/stream/route.ts`, `web/src/app/api/hosted/[...path]/route.ts`
- **Issue:** The SPEC (Section 1, "What Daemon is NOT") says "No voice companion. No personality engine." The voice page, canvas page, logos page, and the stream API (for canvas) are non-v0 features. The middleware explicitly marks `/api/stream` as public with no auth.
- **Fix:** Remove or disable non-v0 pages. The stream/canvas SSE endpoint is a potential data leak vector since it's unauthenticated.
- **Priority:** Fix before launch

### H6. `ws-protocol.ts` is entirely from arturito-bd, not daemon

- **Category:** Code quality
- **Severity:** High
- **Location:** `/home/arthur/daemon/web/src/lib/ws-protocol.ts`
- **Issue:** This file defines types for "Arturito BD Stable" including `ContactResult`, `WS_SearchContacts`, `WS_ContractSend`, `WS_BrowserAction`, `WS_WebRTCRequest`, etc. None of these types are related to the Daemon protocol. This is leftover from a different project entirely.
- **Fix:** Delete this file. The Daemon protocol types are in `protocol/types.ts`.
- **Priority:** Fix before launch

### H7. WS server messages don't include protocol version `v` field

- **Category:** Spec mismatch
- **Severity:** High
- **Location:** `/home/arthur/daemon/web/ws-server.js` (all `ws.send` calls)
- **Issue:** The SPEC (Section 3.0) says "Every message includes a `v` field. v0 protocol version is `"0"`. Servers MUST reject messages with unsupported versions." The WS server sends messages like `{ type: 'registered', device_id, message }` without any `v` field. It also never validates `v` on incoming messages. The CLI bridge also sends messages without `v`.
- **Fix:** Add `v: "0"` to all outgoing messages. Validate `v` on all incoming messages. Use `protocol/types.ts` types and the `createMessage()` helper.
- **Priority:** Fix before launch

### H8. WS server uses non-spec message types

- **Category:** Spec mismatch
- **Severity:** High
- **Location:** `/home/arthur/daemon/web/ws-server.js`, `/home/arthur/daemon/cli/daemon.mjs`
- **Issue:** The WS server expects `device_register` instead of `auth.hello`, sends `registered` instead of `auth.session`, expects `command_response` instead of `device.result`, and expects `heartbeat` instead of `device.heartbeat`. The CLI sends `device_register` and `command_response`. None of these match the protocol types defined in `protocol/types.ts` or SPEC Section 3.
- **Fix:** Align both the WS server and CLI bridge to use the exact message types from the spec: `auth.hello`, `auth.session`, `device.heartbeat`, `device.heartbeat_ack`, `device.result`, etc.
- **Priority:** Fix before launch

### H9. Middleware only checks cookie existence, not token validity

- **Category:** Spec mismatch / Security
- **Severity:** High
- **Location:** `/home/arthur/daemon/web/src/middleware.ts:116`
- **Issue:** The SPEC (Section 4.1, 5.1) says "Middleware MUST validate the token hash against the database on every request, not just check cookie existence." The middleware only checks `if (!token)`. A stolen or expired token cookie will pass middleware. Individual API routes do validate, but this leaves page routes unprotected.
- **Fix:** Middleware should validate the token hash against the DB. This requires either making middleware async with DB access, or using a secondary fast-path validation (e.g., HMAC-signed cookie).
- **Priority:** Fix before launch

### H10. `/api/me` route passes raw token in environment variable

- **Category:** Security
- **Severity:** High
- **Location:** `/home/arthur/daemon/web/src/app/api/me/route.ts:22`
- **Issue:** Same as C4 -- token passed via `AUTH_TOKEN` env var to Python subprocess. But also, this route has no input sanitization at all on the token before passing it to Python.
- **Fix:** Use `sanitizeToken()` from `sanitize.ts`, pass via stdin.
- **Priority:** Fix before launch

### H11. `/api/settings` route passes raw token in environment variable

- **Category:** Security
- **Severity:** High
- **Location:** `/home/arthur/daemon/web/src/app/api/settings/route.ts:21`
- **Issue:** Same pattern as C4/H10. Raw token in env var, no sanitization.
- **Fix:** Use `sanitizeToken()`, pass via stdin.
- **Priority:** Fix before launch

### H12. Cookie `sameSite` set to `lax` instead of `strict`

- **Category:** Spec mismatch
- **Severity:** High
- **Location:** `/home/arthur/daemon/web/src/app/api/auth/route.ts:47,65,121,159`
- **Issue:** The SPEC (Section 5.1) says `SameSite=Strict`. The code uses `sameSite: 'lax'`. Lax allows the cookie to be sent on top-level GET requests from external sites, enabling certain CSRF patterns.
- **Fix:** Change to `sameSite: 'strict'`.
- **Priority:** Fix before launch

### H13. No CSRF protection via X-Daemon-Client header

- **Category:** Spec mismatch
- **Severity:** High
- **Location:** Not implemented anywhere
- **Issue:** The SPEC (Section 5.4) requires "SameSite=Strict cookie + custom `X-Daemon-Client` header on all API requests." No API route or middleware checks for this header.
- **Fix:** Add header validation to middleware or a shared auth helper.
- **Priority:** Fix before launch

### H14. `safety-check.ts` runs `find` command on user-supplied paths

- **Category:** Security
- **Severity:** High
- **Location:** `/home/arthur/daemon/web/src/lib/safety-check.ts:205-216`
- **Issue:** `estimateFileCount()` uses `exec()` (not `execFile()`) with `find ${JSON.stringify(dirPath)}`. While `JSON.stringify` adds quotes, using `exec()` with shell interpolation is a shell injection risk. A crafted path like `"; rm -rf / #` inside the JSON string would be properly quoted, but the use of `exec` over `execFile` is the spec-violating pattern.
- **Fix:** Use `execFile('find', [dirPath, '-maxdepth', '3', ...])` instead of `exec()` with string interpolation.
- **Priority:** Fix before launch

---

## 3. MEDIUM SEVERITY ISSUES

### M1. Chat route duplicates token sanitization with weaker regex

- **Category:** Code quality / Consistency
- **Severity:** Medium
- **Location:** `/home/arthur/daemon/web/src/app/api/chat/route.ts:45-52`
- **Issue:** Defines its own `TOKEN_REGEX = /^[a-zA-Z0-9]+$/` and `sanitizeToken()` that differs from the canonical `sanitize.ts` version (`/^[a-f0-9]{64}$/`). The chat version accepts uppercase and any length, while the canonical one correctly enforces 64-char lowercase hex. The chat version is weaker.
- **Fix:** Import from `@/lib/sanitize` instead of reinventing.
- **Priority:** Fix before launch

### M2. Chat route has growing in-memory Maps that never fully clean up

- **Category:** Performance / Memory leak
- **Severity:** Medium
- **Location:** `/home/arthur/daemon/web/src/app/api/chat/route.ts:63-73` (rateLimits), `/home/arthur/daemon/web/src/app/api/chat/route.ts:105` (claudeSessions)
- **Issue:** `rateLimits` Map grows as new users send messages. The cleanup interval only removes entries past their reset time, but the Map grows unbounded for new users. `claudeSessions` Record grows forever -- session IDs for every thread ever used are never cleaned up.
- **Fix:** Add TTL-based eviction for `claudeSessions`. Add size cap for `rateLimits` (evict oldest entries when exceeding, say, 10K entries).
- **Priority:** Fix before launch

### M3. Agent loop sandbox Maps grow unbounded

- **Category:** Performance / Memory leak
- **Severity:** Medium
- **Location:** `/home/arthur/daemon/web/src/lib/agent-loop.ts:122-133`
- **Issue:** `activeSandboxes` Map is cleaned every 5 minutes for 30-min-idle containers, but new entries are added on every agent loop invocation. If a user's sandbox fails to create, the BWRAP_SANDBOX_ID entry persists forever (it has no idle timeout because the "lastUsed" keeps getting updated on each request).
- **Fix:** Add maximum sandbox count. Clean up BWRAP entries after inactivity too.
- **Priority:** Fix before launch

### M4. `chat/route.ts` loads personality from non-v0 file on every request

- **Category:** Spec mismatch / Performance
- **Severity:** Medium
- **Location:** `/home/arthur/daemon/web/src/app/api/chat/route.ts:107-143`
- **Issue:** Every chat request reads `SOUL.md` and `personality.json` from disk (synchronous `readFileSync`). These are non-v0 features (personality engine). Also, the personality JSON is written back on every request (line 693-695), creating unnecessary disk I/O and potential race conditions with concurrent requests.
- **Fix:** Remove personality loading for v0. The system prompt should be a static template, not loaded from a "soul" file.
- **Priority:** Fix before launch

### M5. Knowledge store calls (Qdrant/memory) on every chat request

- **Category:** Spec mismatch / Performance
- **Severity:** Medium
- **Location:** `/home/arthur/daemon/web/src/app/api/chat/route.ts:146-196`
- **Issue:** Every chat request calls `getKnowledgeContext()` which spawns a Python subprocess, and `storeKnowledge()` which spawns another. The SPEC says "No vector search in v0" and "Qdrant vector database exists but is not required for v0 launch." These add latency to every request.
- **Fix:** Remove or disable knowledge store/retrieval for v0. Keep only the file-based MEMORY.md pattern.
- **Priority:** Fix before launch

### M6. `agent-loop-streaming.ts` duplicates sandbox exec without bwrap support

- **Category:** Code quality
- **Severity:** Medium
- **Location:** `/home/arthur/daemon/web/src/lib/agent-loop-streaming.ts:12-32`
- **Issue:** Comment says "duplicated to avoid tight coupling." The `execInSandbox()` function here only supports Docker, not bwrap fallback. This means the streaming agent loop has weaker sandboxing than the non-streaming one. Code duplication with divergent behavior is a bug factory.
- **Fix:** Extract shared sandbox execution into a separate module (`sandbox.ts` per the spec file structure). Both agent loops import from it.
- **Priority:** Fix before launch

### M7. `touchProject()` has optional user_id bypass

- **Category:** Security
- **Severity:** Medium
- **Location:** `/home/arthur/daemon/web/src/lib/db.ts:250-256`
- **Issue:** When `userId` is not provided, `touchProject()` updates any project by ID without user_id filtering. The SPEC (Section 5.2) says "Every database query that touches user data MUST include `WHERE user_id = ?`."
- **Fix:** Make `userId` required. Remove the fallback path without user_id filtering.
- **Priority:** Fix before launch

### M8. Missing API endpoints from spec

- **Category:** Spec mismatch
- **Severity:** Medium
- **Location:** Missing files
- **Issue:** Several endpoints from SPEC Section 8 are missing:
  - `DELETE /api/projects/:id` -- spec requires it, no route exists (projects route has no DELETE handler)
  - `DELETE /api/threads/:id` -- spec requires it, no route exists
  - `GET /api/threads/:id/messages` with cursor pagination (`before=:message_id`) -- implemented with offset, not cursor
  - `POST /api/files/upload` -- entire file transfer API is missing
  - `GET /api/files/:id` -- entire file transfer API is missing
  - `PUT /api/projects/:id` -- spec uses path param, implementation uses body `{ id }`
- **Fix:** Implement missing endpoints. For file transfer, at minimum create placeholder routes.
- **Priority:** Fix before launch

### M9. Deploy endpoint does not stream SSE per spec

- **Category:** Spec mismatch
- **Severity:** Medium
- **Location:** `/home/arthur/daemon/web/src/app/api/deploy/route.ts`
- **Issue:** The SPEC says `POST /api/deploy` should return an SSE stream with `{ type: "log" }` progress events. The implementation returns a single JSON response. This means no progress feedback for large deployments.
- **Fix:** Add SSE streaming for the build/deploy process, or document the deviation.
- **Priority:** Fix in v1

### M10. Settings GET response doesn't match spec format

- **Category:** Spec mismatch
- **Severity:** Medium
- **Location:** `/home/arthur/daemon/web/src/app/api/settings/route.ts:100-107`
- **Issue:** The SPEC says GET /api/settings returns `{ email, daemon_name, byok_keys: { anthropic?: "sk-...masked" }, preferences: { model?, theme? } }`. The implementation returns `{ model, useLocalClaude, plan }`. No email, no daemon_name, no key masking, wrong structure.
- **Fix:** Return the spec-compliant format. Mask API keys (show only last 4 chars).
- **Priority:** Fix before launch

### M11. `projects` table has extra columns not in spec

- **Category:** Spec mismatch
- **Severity:** Medium
- **Location:** `/home/arthur/daemon/web/src/lib/db.ts:37-53`
- **Issue:** The `projects` table has `service_name`, `parent_id`, and `branch` (on chat_threads) columns that are not in the SPEC schema. The default `git_branch` is `'develop'` instead of `'main'` as in the spec.
- **Fix:** Remove non-spec columns in a migration. Change default git_branch to 'main'.
- **Priority:** Fix before launch

### M12. `chat_messages` table missing `tokens_used` column

- **Category:** Spec mismatch
- **Severity:** Medium
- **Location:** `/home/arthur/daemon/web/src/lib/db.ts:67-79`
- **Issue:** The SPEC schema has `tokens_used INTEGER` on `chat_messages`. The migration doesn't include it. Token usage is tracked in `usage_log` instead, but per-message token tracking is missing.
- **Fix:** Add column via migration.
- **Priority:** Fix in v1

---

## 4. LOW SEVERITY ISSUES

### L1. `/api/pair` response format differs from spec

- **Category:** Spec mismatch
- **Severity:** Low
- **Location:** `/home/arthur/daemon/web/src/app/api/pair/route.ts:54,84-88`
- **Issue:** Generate action returns `{ code, expiresAt }` but spec says `{ code, expires_in: 300 }` (seconds). Claim action returns `{ device_token, ws_url }` but spec says `{ token, device_id }`.
- **Fix:** Align response format with spec.
- **Priority:** Fix before launch

### L2. Health endpoint missing `uptime` in seconds

- **Category:** Spec mismatch
- **Severity:** Low
- **Location:** `/home/arthur/daemon/web/src/app/api/health/route.ts`
- **Issue:** Returns `Math.floor(process.uptime())` which is correct, but the value is the Next.js process uptime, not the overall system uptime. Minor spec interpretation issue.
- **Fix:** None needed -- this is acceptable.
- **Priority:** None

### L3. Chat non-streaming response format differs from spec

- **Category:** Spec mismatch
- **Severity:** Low
- **Location:** `/home/arthur/daemon/web/src/app/api/chat/route.ts:774-781`
- **Issue:** Returns `{ response, sessionId, model, tier, usage, toolCalls }`. Spec says `{ message: { id, role, content, model, usage }, thread_id }`. Different shape.
- **Fix:** Align with spec format.
- **Priority:** Fix before launch

### L4. Clipboard sync polls every 1.5s on CLI, spec says nothing about polling

- **Category:** Code quality
- **Severity:** Low
- **Location:** `/home/arthur/daemon/cli/daemon.mjs:250`
- **Issue:** Clipboard polling at 1.5s intervals is aggressive and wastes CPU. The spec says "Max clipboard content size: 1 MB" but the CLI caps at 50KB (line 254).
- **Fix:** Increase poll interval to 3-5 seconds. Align max size with spec's 1 MB limit.
- **Priority:** Fix before launch

### L5. Auth route is one monolithic 168-line function

- **Category:** Code quality
- **Severity:** Low
- **Location:** `/home/arthur/daemon/web/src/app/api/auth/route.ts`
- **Issue:** The POST handler has 5 different action types all in one function with deeply nested Python code strings. Hard to test individually, hard to review for security issues.
- **Fix:** Split into separate handler functions per action. Move Python interaction into a shared helper module.
- **Priority:** Fix in v1

### L6. Hardcoded email check for premium tier

- **Category:** Code quality
- **Severity:** Low
- **Location:** `/home/arthur/daemon/web/src/app/api/chat/route.ts:312`
- **Issue:** `result.email === 'tutucamara@gmail.com' ? 'premium' : ...` -- Arthur's email is hardcoded for premium access. This should be a DB flag or env var.
- **Fix:** Use a `is_admin` flag in the users table, or an env var `ADMIN_EMAILS`.
- **Priority:** Fix before launch

### L7. `claudeSessions` Record duplicated between `model-router.ts` and `chat/route.ts`

- **Category:** Code quality
- **Severity:** Low
- **Location:** `/home/arthur/daemon/web/src/lib/model-router.ts:119`, `/home/arthur/daemon/web/src/app/api/chat/route.ts:105`
- **Issue:** Both files maintain their own `claudeSessions` mapping. The streaming path in `chat/route.ts` and the non-streaming path in `model-router.ts` will have different session state, causing Claude conversations to lose continuity when switching between streaming and non-streaming.
- **Fix:** Move `claudeSessions` to a shared module.
- **Priority:** Fix before launch

### L8. `PROMPT_DIR` duplicated between `model-router.ts` and `chat/route.ts`

- **Category:** Code quality
- **Severity:** Low
- **Location:** `/home/arthur/daemon/web/src/lib/model-router.ts:114`, `/home/arthur/daemon/web/src/app/api/chat/route.ts:100`
- **Issue:** Both create `/tmp/daemon-prompts`. Minor duplication.
- **Fix:** Extract to shared config.
- **Priority:** Fix in v1

### L9. WS server health endpoint leaks all users' device info

- **Category:** Security
- **Severity:** Low
- **Location:** `/home/arthur/daemon/web/ws-server.js:174-194`
- **Issue:** The `/health` endpoint returns devices for ALL users with their userId and connection status. While this is only accessible internally (localhost:4801), the `/api/devices` route fetches this to enumerate devices. The health endpoint should filter by user or be restricted.
- **Fix:** Add auth to health endpoint, or at minimum remove userId from the response.
- **Priority:** Fix before launch

---

## 5. MISSING FROM SPEC

Things the spec forgot but should address:

| Feature | Why It Matters |
|---------|---------------|
| **Logout endpoint** | Spec Section 8 lists `action: "logout"` but no implementation exists in `auth/route.ts` |
| **Account deletion** | GDPR/privacy compliance requires this. Not in spec. |
| **Password change** | Users who signed up with password have no way to change it. |
| **Device rename** | Devices can only be named at pairing time. |
| **Project deletion cascade** | `DELETE /api/projects/:id` should cascade-delete threads, messages, and memory. Spec mentions it but doesn't define cascade behavior. |
| **Thread deletion** | Spec says `DELETE /api/threads/:id` but doesn't specify cascade to messages. |
| **Session listing/revocation** | Users can't see active sessions or revoke specific ones (only device tokens). |
| **BYOK key deletion** | Users can add API keys but the settings PUT endpoint doesn't support removing them. |
| **Error recovery for WS disconnect during agent loop** | If a device disconnects while a tool call is in-flight, the agent loop hangs for 30 seconds. No retry or failover. |
| **Concurrent chat request handling** | What happens when two chat requests come in for the same thread? The personality.json write and memory generation will race. |

---

## 6. MISSING TESTS

Test cases that would catch real bugs found in this review:

1. **Session token hashing**: Create session, verify raw token is NOT in DB, verify hashed token IS in DB
2. **Expired session rejection**: Create session, set expires_at to past, verify 401 on all endpoints
3. **Cross-user device isolation**: Create 2 users, pair a device for each, verify user A cannot invoke commands on user B's device
4. **Fuzzy device ID rejection**: Create device "test-device-1", send command for "test-device", verify 404
5. **Unauthenticated WS rejection**: Connect to WS without device_token, verify connection is closed with 4001
6. **Rate limiting**: Send 11 auth requests from same IP in 1 minute, verify 429 on 11th
7. **Shell injection in memory search**: Send query `"); import os; os.system("id")#` to `/api/memory`, verify no code execution
8. **Token via env var leakage**: Verify tokens are not visible in `/proc/PID/environ` of Python subprocesses
9. **Google OAuth session expiry**: Sign up via Google, verify session has expires_at set
10. **Cookie sameSite=strict**: Verify cookie is not sent on cross-origin GET requests
11. **Max message size enforcement**: Send >10MB WebSocket message, verify rejection
12. **Concurrent personality.json writes**: Send 10 simultaneous chat requests, verify file isn't corrupted
13. **Sandbox escape**: Execute `cat /etc/passwd` in bwrap sandbox, verify it only sees the bind-mounted view
14. **Deploy malicious content**: Deploy site with `eval(atob(...))`, verify rejection
15. **Device token expiry**: Create device token, fast-forward 31 days, verify token is rejected

---

## 7. PERFORMANCE CONCERNS

### P1. Python subprocess per auth check
Every authenticated request spawns a Python subprocess (`execFile` -> `python3 -c "..."`) to validate the session token. This adds 100-500ms latency per request. With SQLite already accessible from Node.js via `better-sqlite3`, there is no reason to shell out to Python.

**Fix:** Migrate `get_user_by_token` to TypeScript using `better-sqlite3` directly. The Python `users.py` module should be eliminated over time.

### P2. Synchronous file reads on chat request path
`readFileSync` for `SOUL.md`, `personality.json`, and `MEMORY.md` files happens on every chat request (lines 117, 109, 572-573 in `chat/route.ts`). These block the Node.js event loop.

**Fix:** Use async reads, or cache with TTL.

### P3. No query result caching
`listDeviceTokens`, `listProjects`, `listThreads` are called on every page load without any caching. With SQLite WAL mode this is acceptable for small scale but will become a bottleneck at 50+ concurrent users.

**Fix:** Add in-memory cache with 5-second TTL for frequently accessed queries.

### P4. N+1 in device list
`GET /api/devices` makes an HTTP call to the WS server health endpoint, then iterates all tokens. The health endpoint returns ALL devices for ALL users, and the API route filters client-side. This is an O(all_devices) operation per user request.

**Fix:** Add a `/devices?user_id=X` endpoint to the WS server that returns only the requesting user's devices.

---

## 8. CONSISTENCY ISSUES

| Issue | Locations | Description |
|-------|-----------|-------------|
| Auth error messages | Various routes | Some return `{ error: 'Not authenticated' }`, others `{ error: 'Not logged in' }`, others `{ error: 'Invalid session' }` |
| Auth pattern | `auth.ts`, `settings/route.ts`, `me/route.ts`, `chat/route.ts` | Four different patterns for validating auth: `requireAuth + getUserId`, `validateSession` directly, Python subprocess, and chat's custom `getUserTier` |
| User ID types | `db.ts` (number), `chat/route.ts` (string), `ws-server.js` (number/0) | User ID is sometimes a number, sometimes a string, sometimes 0 for unauthenticated |
| Project creation response code | `projects/route.ts` | Returns default 200, spec says 201 for creation |
| Error structure | All routes | Mix of `{ error: string }` and `{ error: string, details: string }` formats |
| Database access | `db.ts` (better-sqlite3), `auth.ts` (Python), `settings/route.ts` (Python), `ws-server.js` (better-sqlite3) | Three different DB access patterns: direct better-sqlite3, Python subprocess, and Python via auth.ts. This creates consistency and security issues |

---

## 9. RECOMMENDED FIX ORDER

### Phase 0: Security (do this week)
1. C1: Hash session tokens in DB
2. C2: Remove SHA-256 password fallback
3. C3: Fix Google OAuth session creation
4. C4/H10/H11: Pass tokens via stdin, not env vars
5. C5: Remove fuzzy device ID matching
6. C6: Require user_id on /command endpoint
7. C7: Reject unauthenticated WS connections
8. C8: Fix memory route injection
9. H12: sameSite=strict
10. H14: Fix safety-check exec() usage

### Phase 1: Spec Compliance (next week)
1. H7/H8: Align WS protocol with spec message types
2. H2: Add device token expiry and permissions
3. H3/H4: Remove non-v0 tables
4. H5/H6: Remove non-v0 pages and files
5. M8: Implement missing API endpoints
6. H9: Middleware token validation
7. H1: Rate limiting
8. H13: CSRF header validation

### Phase 2: Code Quality (before launch)
1. M1: Deduplicate sanitization
2. M4/M5: Remove personality/knowledge code from chat path
3. M6: Extract shared sandbox module
4. M7: Fix touchProject user_id bypass
5. L5/L7/L8: Deduplicate code across chat/model-router
6. P1: Migrate Python auth to TypeScript
7. P2: Async file reads

---

*Generated by Claude Opus 4.6 architecture review, 2026-04-05*
