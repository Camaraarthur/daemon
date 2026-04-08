# Daemon — Architecture v1

> **Status:** locked. Source of truth for all v1 work.
> **Date:** 2026-04-08
> **Positioning:** the Volvo of secure AI agent platforms. Open source, end-to-end verifiable, production-grade. The way most people will run Claude Code across their devices.

---

## 1. The four pillars (constraints, not features)

These are not "things we'll add later." They are constraints the architecture
must satisfy by construction. Anything that violates them is rejected,
including by us.

### Privacy
- The relay holds **zero application content**. Not encrypted content. Not
  transient content. Zero.
- The relay's persistent state is **identity, routing, pairing**. That's it.
- The agent loop runs in the data plane (on user devices), not the control
  plane (the relay).
- End-to-end encryption between a user's own devices is **shipped in v1**,
  not Phase Z.
- The model API call originates from a user device using their BYOK key.
  The relay never holds an API key on behalf of any user.
- "Verifiable from outside" means a journalist with `tcpdump`, `strings`,
  and the source code can prove the relay never sees plaintext.

### Security
- Per-device Ed25519 identity keypair. Private key never leaves the
  device's hardware-backed storage (Secure Enclave / Android Keystore /
  TPM 2.0 / kernel keyring).
- Pairing is challenge-response (Noise IK pattern), not "paste a token."
- Short-lived access tokens + long-lived refresh tokens. Revocation pushes
  a kill signal over WS to every connected device.
- Multi-tenant isolation: per-user worker for the agent loop, never a
  shared process.
- Sandbox where the OS supports it: macOS sandbox, Linux bubblewrap,
  Android by default. Daemon reads/writes only paths the user has granted.
- Reproducible builds via Guix/Nix container; Sigstore/cosign signed
  releases; SLSA L3 provenance.
- No swallowed errors. No `--no-verify`. No `any` types. No "TODO refactor
  later." We hold this bar from day one.

### Reliability
- **Single-writer-per-namespace** for mutable state. No CRDTs.
- **Append-only gossip** for chat messages. No conflicts because messages
  are ordered by `(timestamp, device_id)`.
- **Hard offline indicator** when the agent home is down. Secondaries show
  "agent home offline, last seen 12m ago" and refuse to fabricate state.
- Multi-relay failover. Two endpoints, clients heartbeat both, prefer
  lowest latency.
- Battery awareness on laptop primaries: throttle on battery, surface
  "throttled" badge on secondaries.
- Tests at every step. Green CI on a fresh clone, no flakes. The bar.

### Scaling
- Relay is stateless except for a tiny SQL DB (auth + device registry,
  ~kB per user) and an in-memory routing table.
- Agent loop scales linearly with users because each user's loop runs on
  their own device. No shared compute bottleneck on the relay.
- Open protocol; anyone can write a daemon client. The contract lives in
  `protocol/types.ts` with `protocol/tests/` proving conformance.
- AGPLv3, self-hostable on a $5 VPS in 60 seconds.

---

## 2. Glossary (use Tailscale's vocabulary)

| Term | Meaning |
|---|---|
| **Control plane** | The relay. Holds identity, routing, pairing. Never sees plaintext content. |
| **Data plane** | The user's devices. Holds chat, memory, code, files, BYOK keys. |
| **Device** | Anything that speaks the daemon protocol. Phone, laptop, daemon-key, server, headless Pi. |
| **Agent home** | The device designated to run the agent loop for a given conversation. |
| **Device ring** | The set of one user's devices that share a content key for E2EE. |
| **Primary** | A user's chosen agent home for conversations they don't override. |
| **Secondary** | Any device of yours that isn't currently the agent home. Thin-client UX, optimistic UI. |
| **Pendant** | ESP32 + mic + BLE. **Phone peripheral**, not a daemon device. Streams audio to the phone. |
| **Daemon-key** | Orange Pi 4 Pro. Full daemon device. The always-on small box product. |
| **Self-host** | Anyone can run the relay. AGPLv3, $5 VPS, 60 seconds. |

---

## 3. Hardware lineup

| Device | Form | Role | Runs agent loop? |
|---|---|---|---|
| Pendant | ESP32 + mic + BLE | Phone peripheral, audio capture | No (peripheral) |
| Phone | Android (later iOS) | Daemon device with mic, clipboard, notifications, GPS, camera | Yes if no other device available |
| Laptop | Tauri desktop on Linux/Mac/Windows | Daemon device with bash, files, screen, clipboard | Yes if open and BYOK key present |
| Daemon-key | Orange Pi 4 Pro (4–6GB RAM, ARM A55, Linux, ~$80–120 BOM) | Always-on full daemon device with sensors via GPIO/I2C/SPI | **Yes by default** |
| Home server | Any Linux box (Arthur uses arturito) | Always-on full daemon device | **Yes by default** |

Pendant streams audio to phone over BLE. Phone is the daemon device the
relay sees. The pendant never connects to the relay directly.

The daemon-key is the productized "I want a tiny always-on box for $120
to be my agent home" form factor. The Orange Pi 4 Pro is the chosen SBC.

---

## 4. The control plane (the relay)

### What it persists

Four tables. Together: ~kilobytes per user. No content.

```sql
users(id, email, password_hash, created_at)
sessions(token, user_id, expires_at)              -- short-lived (15min access)
device_registry(user_id, device_id, pubkey,       -- Ed25519 identity
                label, capabilities_json,
                last_seen, created_at)
pairing_codes(code, user_id, label, expires_at)   -- 15-minute TTL

-- Plus optionally, for the encrypted backup tier (opt-in only):
encrypted_backups(user_id, blob, version,
                  uploaded_at)                    -- opaque ciphertext, relay
                                                  -- has no key
```

### What it does at runtime

- **Auth**: validates session tokens against the `sessions` table.
- **WS routing fabric**: receives encrypted blobs from device A addressed
  to device B (both owned by same user), forwards them. Cannot decrypt.
- **Pairing flow**: serves the 6-character pairing codes, performs
  challenge-response key exchange between an existing trusted device and
  the new joiner.
- **Device registry queries**: tells device A which other devices owned
  by the same user are currently online (so device A knows where to
  route its gossip).
- **Encrypted backup babysitting**: stores opaque ciphertext blobs for
  users who opted in. Has no key. Cannot decrypt. Bytes go in, bytes
  come out.

### What it does NOT do

- It does **NOT** run any agent loop.
- It does **NOT** call any model API.
- It does **NOT** read any user's filesystem.
- It does **NOT** persist any chat message, memory block, project, or
  file content in any form it can read.
- It does **NOT** see any tool input or output in cleartext.

### Code shape

- ~2,000 lines of TypeScript on Node (or Rust if we go that direction).
- A Next.js app for the marketing landing page and the web UI shell only.
- The web UI itself is a daemon device — see §6.
- Multi-region: deploy to two regions (Cloudflare Workers + a bare VPS, or
  two bare VPSes). Clients know both endpoints, fail over silently.
- Auditable: every line of relay code is on GitHub, AGPLv3.

---

## 5. The data plane (devices)

### One protocol, many implementations

The contract lives in `protocol/types.ts`. The conformance test suite
lives in `protocol/tests/`. Any implementation that passes the tests is a
legitimate daemon device.

| Platform | Stack | Status |
|---|---|---|
| Linux desktop | Tauri (Rust core + web UI) | New (cross-compile from existing Windows target) |
| macOS desktop | Tauri | New (cross-compile) |
| Windows desktop | Tauri | Exists |
| Android | Kotlin native | Exists, needs tool surface parity |
| iOS | Swift native | v2 |
| Headless Linux (Pi, server, daemon-key) | Rust binary | Replaces `cli/daemon.mjs` |
| Browser tab | Ephemeral device with session keypair in memory | New |

### Tool surface (Claude Code vocabulary)

Every device implements as much of this as makes sense for its hardware:

| Tool | Linux desktop | macOS | Windows | Android | iOS | Daemon-key | Pendant |
|---|---|---|---|---|---|---|---|
| `bash` | ✓ | ✓ | ✓ (PowerShell) | ✗ | ✗ | ✓ | ✗ |
| `read_file` | ✓ | ✓ | ✓ | sandboxed | sandboxed | ✓ | ✗ |
| `write_file` | ✓ | ✓ | ✓ | sandboxed | sandboxed | ✓ | ✗ |
| `edit_file` | ✓ | ✓ | ✓ | sandboxed | sandboxed | ✓ | ✗ |
| `glob` | ✓ | ✓ | ✓ | sandboxed | sandboxed | ✓ | ✗ |
| `grep` | ✓ | ✓ | ✓ | sandboxed | sandboxed | ✓ | ✗ |
| `lint_file` | ✓ | ✓ | ✓ | ✗ | ✗ | ✓ | ✗ |
| `device_info` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `screenshot` | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ |
| `clipboard_read/write` | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ |
| `notification_send` | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ |
| `mic_record` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ (via I2S) | ✓ (BLE→phone) |
| `camera_capture` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ (USB) | ✗ |
| `gps` | ✗ | ✗ | ✗ | ✓ | ✓ | ✗ | ✗ |
| `gpio_read/write` | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ | ✗ |
| `i2c_scan/read/write` | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ | ✗ |
| `usb_list/claim` | ✓ | ✓ | ✓ | ✓ (host) | ✗ | ✓ | ✗ |
| `serial_open/read/write` | ✓ | ✓ | ✓ | ✗ | ✗ | ✓ | ✗ |

Tool capability discovery via `skill.list` at connect time. The agent
loop knows which tools each device has and routes accordingly.

### Persistent shell sessions

Every device with `bash` runs a `node-pty` (or libc pty) session **per
(user, conversation)**. State (cwd, env, exported funcs) survives across
tool calls within one conversation. Sessions GC after 30min idle.

This is non-negotiable per the prior-art critique: every mature agent
runtime converged on this. `bash -c` per call silently loses cwd.

---

## 6. Three rules for three kinds of data

This is the heart of the design. Three categories of data, three
different consistency models.

### Rule 1: append-only data → **gossip everywhere**

**What:** chat messages, tool call records, audit log entries.

**How:**
- Every device holds a full copy in local SQLite.
- New messages get pushed via the relay's WS routing to every other online
  device of the user. The push payload is encrypted to each recipient
  device's pubkey.
- Devices that were offline catch up on reconnect via a `gossip.sync`
  request that asks "give me everything since this `(timestamp, device_id)`."
- Merge is trivial: sort by `(timestamp, device_id)`. No conflicts because
  the data is append-only.

**What this gives you:** every device has the full conversation history.
Open daemon on any device, see everything. Close one device, the others
are unaffected. Plug in a brand new device, it pulls the history from any
existing one via a one-time bulk sync.

### Rule 2: mutable structured data → **single-writer-per-namespace with leases**

**What:** memory blocks (Letta-style), project metadata, settings, user
preferences.

**How:**
- Each namespace (e.g., `memory_blocks/project_8/recent`) has a current
  owner: the device that most recently wrote to it.
- To write, a device acquires a brief lease from the relay (cheap CAS
  on the namespace's version number — this is metadata, not content,
  so the relay can hold it).
- If two devices race, the loser gets a 409 and re-fetches the latest
  version.
- Reads are always allowed from the local copy (eventually consistent).

**What this gives you:** memory blocks update predictably, no merge hell,
no CRDT complexity. The granularity is small (per namespace), so
contention is rare.

### Rule 3: agent loop execution → **pinned to an agent home, with fallback chain**

**What:** the actual model API call and the tool dispatch loop.

**How:**
- Each conversation has a designated **agent home device**: the device
  that runs the loop. Defaults to the user's chosen primary (e.g., for
  Arthur: arturito).
- If the agent home is offline, fall through to the next device in the
  user's fallback chain (e.g., arturito → MSI → phone). Each device in
  the chain must have the BYOK API key (replicated via the device ring).
- The chosen device runs the loop, calls the model API, dispatches tools
  (which may target other devices in the data plane), and streams the
  response back via gossip.
- Other secondaries see the streamed response **live** through the same
  WS routing — they're effectively read-only viewers of the agent home's
  output during the turn.

**Why pinned not dynamic:** predictable. Latency on the relay hop is
50–200ms WAN, fine for chat. The persistent pty stays in one place per
conversation. Simpler mental model, simpler debugging.

**Override:** the user can manually pin a specific conversation to a
specific device ("this conversation always runs on MSI"). Per-conversation
override stored in user settings.

---

## 7. Cryptographic identity

### Per-device keypair

- Ed25519 for identity signing.
- X25519 for key exchange.
- Generated at first launch by the device daemon.
- Private keys live in **hardware-backed storage**:
  - macOS / iOS: Secure Enclave via Keychain.
  - Android: Android Keystore (hardware-backed where SE/StrongBox available).
  - Linux: TPM 2.0 if present, else kernel keyring; daemon-key uses TPM.
  - Windows: Windows Hello / TPM.
  - Browser tab: ephemeral, in-memory only, lost on tab close (acceptable —
    browser sessions are transient by design).
- The relay only ever sees pubkeys.

### Pairing flow

1. User opens the daemon app on a new device. Device generates a
   keypair. Device asks for an existing trusted device.
2. User opens daemon on an existing trusted device, taps "Add device,"
   shows a 6-character code (and optionally a QR).
3. New device displays its pubkey fingerprint as a 4-word "safety
   number" (Signal-style).
4. User confirms the safety number matches on both devices.
5. Existing device wraps the user's content key (X25519 box) to the new
   device's pubkey, sends through the relay. Relay sees ciphertext only.
6. New device decrypts, stores the content key in hardware-backed
   storage, registers its pubkey with the relay.
7. New device is now in the device ring.

### Device ring

The device ring is the set of a user's devices that share a content key.
Only ring members can decrypt the user's gossip messages. Adding a device
requires an existing device to vouch for it (step 5 above). Removing a
device:
1. Mark the device as revoked in the relay's `device_registry`.
2. Push a kill signal to all other ring members.
3. Each ring member generates a new content key, re-wraps it to the
   remaining members. The revoked device cannot decrypt new messages.
4. Optionally re-encrypt historical data (slow, opt-in).

---

## 8. End-to-end encryption (Phase 1, not Phase Z)

### Layer 1: device ↔ relay

Noise XX pattern over WSS. Authenticates the device to the relay using
its Ed25519 identity. The relay does not become an MITM because the
session keys derive from the device's long-term identity key.

This protects against passive network observers and against a malicious
relay operator on the wire (CDN, ISP, NSA tapping the cables).

### Layer 2: device ↔ device

Every gossip payload is wrapped in libsodium `box` (X25519 + XSalsa20 +
Poly1305) addressed to each recipient device's pubkey. The relay forwards
ciphertext only.

This protects against a malicious relay operator at the application level
(rogue insider, court order, server compromise). The relay literally
cannot decrypt because it does not have the keys.

### Implementation

- `libsodium-bindings` (Rust) on the device side.
- `tweetnacl` (JS) for the browser tab device.
- All keys derived from a user-held master key, generated at signup,
  stored in hardware on every ring member.
- Reference: Bitchat's stack (Noise XK + Ed25519 + X25519) for an
  open-source 2025 reference implementation.

### What about the encrypted backup tier?

Same primitives. The user's master key + a per-backup nonce encrypts a
SQLite dump of the device's chat DB. The blob goes to the relay. The
relay babysits bytes; cannot decrypt.

To restore: a fresh device joins the ring (via existing trusted device),
receives the master key, downloads the blob from the relay, decrypts,
populates its local SQLite.

---

## 9. The encrypted backup tier (opt-in, off by default)

### What it is

A nightly encrypted dump of your chat history pushed to the relay's
`encrypted_backups` table. The relay holds opaque bytes. Cannot decrypt.
Costs us $0.0001 per user per night in S3.

### What it is not

- Not the default. **Default: zero data on relay, ever.**
- Not a substitute for device-level replication. Your data is already on
  every device in your ring.
- Not decryptable by the company under any circumstances. No master key
  recovery. If you lose all your devices AND your master key recovery
  phrase, the backup is unrecoverable. This is the point.

### The settings menu copy

```
☐  Encrypted backup to daemon servers

   Off — your data lives only on your devices. To lose it you'd
   need to lose every device in your ring (currently: arturito,
   MSI, phone). They're already a backup of each other.

   On — daemon servers hold a nightly encrypted snapshot of your
   chat history. The encryption key only exists on your devices,
   so even daemon-the-company cannot read your data. If you lose
   every device, this is how you recover. ~$0.001/month per GB.
```

---

## 10. Failure modes and offline UX

### Agent home offline

- All secondaries show a single status pill at the top: **"agent home
  offline · arturito · last seen 12m ago"**.
- Clicking the pill opens a panel with: wake-on-LAN button (if
  configured), "switch agent home to MSI" action, "open arturito's
  remote desktop" link.
- Secondaries do **not** queue messages locally for later replay. They
  refuse to fabricate state. If you type something while the agent home
  is offline, it gets sent to the next device in your fallback chain.
- If every device in the chain is offline: the message is held in the
  device's local outbox with a clear "queued — no agent home reachable"
  state. It does not appear in the conversation as if it were sent.

### Single device in the ring

- New users with one device: that device IS the agent home AND the
  primary AND the entire data plane. Works.
- The "no agent home" state can never happen because the device the user
  is typing on IS the agent home by definition.

### All devices offline at once

- The conversation is intact on each device's local SQLite.
- When any device comes back online, it's the agent home for whatever
  conversation the user opens first.
- If the user opted into encrypted backup and lost every device, restore
  from backup on a fresh device.

### Relay down

- Devices fail over to the second relay region.
- If both relays are down, devices on the same LAN can theoretically
  discover each other directly via mDNS and continue gossiping
  peer-to-peer. v2 feature, not v1.
- Single device users keep working — they don't need the relay at all
  when the agent home is the device they're on.

---

## 11. Reproducible builds

State of the art for 2026:

- **Builder image**: Guix or Nix container. Same inputs → same outputs,
  byte-for-byte.
- **CI**: GitHub Actions runs the build inside the container.
- **Signing**: Sigstore + cosign. Each release artifact gets a signature
  in `.intoto.jsonl` provenance format.
- **SLSA L3**: provenance proves "this binary was built from this commit
  by this CI job," verifiable by anyone.
- **Verification**: users run `cosign verify daemon-1.0.0.dmg` and get
  a cryptographic proof of authenticity. Or they re-run the Guix build
  themselves and diff the output.
- **Bitcoin Core's pipeline** is the reference. We copy it.

This is mandatory before 1.0. Budget: 2-3 weeks of one engineer.

---

## 12. Open source

- **AGPLv3.** Forces self-hosters to open-source their forks.
- **Self-hostable on a $5 VPS in 60 seconds.** A single Docker compose
  file, a single `daemon-relay` binary, done.
- **The relay is small.** ~2000 lines of TypeScript. Auditable in an
  afternoon.
- **The protocol is the moat**, not proprietary code. Anyone can write a
  daemon client; the conformance test suite tells them if their
  implementation is legitimate.
- **Public security disclosure** via `SECURITY.md` and a Bug Bounty
  program once we're past v1.

---

## 13. The build sequence (small steps, tests at every step)

This is what we'll execute, in order. Each step has an **acceptance test**
that must pass before moving on. No "we'll fix that later." No skipped
tests. No half-finished steps.

### Step 0 — sign-off on this document

**Action:** Arthur reads and approves this doc, or pushes back on
specific decisions and we revise.

**Acceptance:** explicit "go" from Arthur.

### Step 1 — fix the dead protocol endpoints

The agent has been calling `/skill/invoke` and `/tools` on the relay
since day one, but those endpoints don't exist in `ws-server.js`. This
is why the local sandbox always fires. Adding them is the **single
unblock** that makes everything else testable.

**Files:** `web/ws-server.js`, `web/src/lib/agent-loop.ts`.

**Diff:**
- Add `GET /tools?user_id=X` returning the union of all tools advertised
  by user X's currently-connected devices.
- Add `POST /skill/invoke` that takes `{user_id, device_id, tool_name,
  arguments}`, looks up the device by `(user_id, device_id)`, sends
  `skill.invoke` over the WS, awaits the response with timeout.
- Reject any request without `user_id`. Delete the cross-user fallback
  in `getUserDevice`.

**Test:**
1. Pair a real device (`cli/daemon.mjs` running locally with a token).
2. Curl `GET /tools?user_id=3`, verify returns the device's tool list.
3. Curl `POST /skill/invoke` with a `device_info` request, verify the
   response comes back from the device.
4. Curl `GET /tools` without `user_id`, verify 400.
5. Curl `POST /skill/invoke` with `user_id=99` and a device that belongs
   to `user_id=3`, verify 404 (no leak).

### Step 2 — `daemon.mjs` tool name parity

**Files:** `cli/daemon.mjs`.

**Diff:**
- Rename `run_shell` → `bash` (alias `run_shell` for one release).
- Rename `list_directory` → `list_files` (alias for one release).
- Rename `get_system_info` → `device_info`.
- Add `edit_file(path, old_string, new_string)` returning a diff stat.
- Add `glob(pattern, path?)` using `fast-glob`.
- Add `grep(pattern, path?, glob?)` shelling out to `rg`.
- Add `lint_file(path)` running the right linter for the extension.
- All of these return structured `{ok, output, stderr?, stats?}`.

**Test:**
1. For each tool, send `skill.invoke` from a curl through the relay,
   verify the response shape matches `protocol/types.ts`.
2. Edit a file with `edit_file`, verify the diff stat is correct.
3. Glob `**/*.ts` in `web/src/`, verify count matches `find … | wc -l`.
4. Grep `TODO` in `web/src/`, verify count matches `rg TODO web/src/`.
5. Lint a file with a syntax error, verify the error is reported.

### Step 3 — persistent pty per conversation

**Files:** `cli/daemon.mjs`, `protocol/types.ts`.

**Diff:**
- Add `node-pty` dependency.
- The `bash` tool now takes `{command, conversation_id}`.
- Maintain a `Map<conversation_id, PtyProcess>`. First call to `bash`
  for a new conversation spawns a fresh `bash` pty. Subsequent calls
  write the command to the pty and read until the prompt returns.
- GC pty sessions after 30min idle.

**Test:**
1. Send `bash {command: "cd /tmp", conversation_id: "test"}`.
2. Send `bash {command: "pwd", conversation_id: "test"}`.
3. Verify the second response is `/tmp` (cwd persisted).
4. Send the same `pwd` with a different `conversation_id`, verify it's
   the original cwd (not /tmp), proving sessions don't leak.
5. Wait 31 minutes, send `pwd` to "test" again, verify a fresh session
   was created.

### Step 4 — delete the local sandbox fallback

**Files:** `web/src/lib/agent-loop.ts`, `web/src/lib/agent-loop-streaming.ts`.

**Diff:**
- Remove the `else` branch that calls `executeTool(containerId, ...)`.
- If no device exposes a tool with the requested name, return a clear
  error to the model: "no device online with tool X. Pair a device at
  /settings/devices."
- Delete `executeTool`, `execInSandbox`, `getOrCreateSandbox`,
  `destroySandbox`, all the bubblewrap helpers, all the Docker
  container management. ~250 lines deleted.
- `Promise.all` over tool calls in a single turn, but only for tools
  marked `idempotent: true` in the protocol.

**Test:**
1. Send a chat that triggers `bash`, verify it routes to the device.
2. Disconnect the device, send a chat that triggers `bash`, verify the
   error message reaches the user with the "no device online" copy.
3. Reconnect, send a turn that requests 3 file reads in parallel,
   verify wall time is ~1× single read latency, not 3×.
4. `grep -rn execInSandbox web/src` returns nothing.
5. `grep -rn 'docker exec' web/src` returns nothing (in agent code).

### Step 5 — Linux desktop Tauri build

**Files:** `desktop/src-tauri/Cargo.toml`, `desktop/src-tauri/src/main.rs`,
`desktop/build-linux.sh`.

**Diff:**
- Add Linux build target.
- Bundle `daemon` (the new Rust headless binary, or `daemon.mjs`
  packaged with `nexe` as an interim) as a sidecar.
- System tray icon, status indicator (connected/disconnected/working),
  pairing UI, settings page.
- AppImage + .deb output.

**Test:**
1. `bash desktop/build-linux.sh` produces a working AppImage.
2. Run the AppImage, verify the system tray icon appears.
3. Pair the AppImage device with the relay, verify it shows up in
   /api/devices.
4. Send a `device_info` request via the relay, verify the response.
5. Close the AppImage, verify it cleanly disconnects.

### Step 6 — `daemon-device.service` on arturito

**Files:** `scripts/install-daemon-device.sh`,
`/etc/systemd/system/daemon-device.service`.

**Diff:**
- Generate a device token via the existing pairing flow.
- Systemd unit runs `node /home/arthur/daemon/cli/daemon.mjs --token-file
  /etc/daemon-device/token` as user `arthur`.
- Connects to `localhost:4801/ws/device`.

**Test:**
1. Run the install script, verify the service starts.
2. `systemctl status daemon-device` shows running.
3. Curl `/api/devices`, verify arturito appears in Arthur's device list.
4. Send a chat that triggers `bash`, verify it runs on arturito.

### Step 7 — gossip protocol for chat messages

**Files:** `protocol/types.ts`, `cli/daemon.mjs`,
`web/src/lib/db.ts` (on the device side, after migration), `web/ws-server.js`.

**Diff:**
- New protocol message type: `gossip.message {message_id, thread_id,
  role, content, created_at, source_device_id}` and `gossip.sync_request
  {since_timestamp, since_device_id}`.
- Device-side: new local SQLite table `chat_messages` (mirrors the
  current relay-side schema).
- Relay-side: route `gossip.*` messages between user's devices, just
  like clipboard already works.
- On reconnect, device sends `gossip.sync_request` to all peers and
  catches up.

**Test:**
1. Two devices online for the same user. Send a message via device A.
2. Verify it appears in device B's local SQLite within 1s.
3. Disconnect device B. Send a message via device A.
4. Reconnect device B. Verify it pulls the missed message via
   `gossip.sync_request`.
5. Three devices, all sending messages simultaneously. Verify all three
   end up with identical message lists in the same order.

### Step 8 — move the chat DB from relay to device

**Files:** lots. This is the big migration.

**Diff:**
- The relay's `chat_messages`, `chat_threads`, `projects`, `memory_blocks`,
  `project_facts` tables move to the device-side SQLite.
- The relay's `/api/threads/[id]/messages` endpoint becomes a thin proxy:
  it asks the user's agent home for the data over WS, streams the
  response back to the browser without buffering.
- The `streaming-into-DB` code I shipped this session moves from the
  Next.js process to the device daemon process. Same code, different
  host.

**Test:**
1. Migrate Arthur's existing 8960 messages from relay SQLite to
   arturito's device-side SQLite.
2. Open daemon page, verify all messages appear.
3. Send a new message, verify it appears in arturito's local SQLite
   AND in the web UI.
4. Verify the relay's `chat_messages` table is empty (or dropped).
5. Audit: `tcpdump` the WS traffic for 5 minutes, verify no plaintext
   message content visible (everything is encrypted at this stage).

### Step 9 — end-to-end encryption (Layer 2)

**Files:** `cli/daemon.mjs`, `protocol/types.ts`, `web/ws-server.js`.

**Diff:**
- Per-device Ed25519 + X25519 keypair, stored in the OS keychain.
- Pairing flow generates keys, exchanges via the relay.
- All `gossip.*` messages encrypted with libsodium box to recipient
  pubkey.
- Relay forwards ciphertext only.

**Test:**
1. Pair two devices, verify pubkeys are exchanged.
2. Send a message from device A to device B.
3. `tcpdump` the relay's WS traffic, verify the payload is unintelligible
   ciphertext.
4. Verify device B decrypts and displays the message correctly.
5. Compromise the relay (impersonate a malicious operator), verify it
   cannot read any user message content.

### Step 10 — relay hardening

**Files:** `/etc/systemd/system/daemon-relay.service`,
`/etc/daemon-relay/secrets.env`, `web/src/lib/*` (refactor hardcoded paths).

**Diff:**
- New system user `daemon-relay`, no shell, no home.
- Move secrets to `/etc/daemon-relay/secrets.env`.
- `ProtectHome=true ProtectSystem=strict`.
- Refactor the 5+ hardcoded `/home/arthur` paths.

**Test:**
1. `systemctl show daemon-relay.service | grep Protect` shows the
   sandboxing directives.
2. `sudo -u daemon-relay cat /home/arthur/.secrets/vault.env` fails
   (permission denied).
3. The relay still functions (can serve the web UI, route WS messages).

### Step 11 — encrypted backup tier (opt-in)

**Files:** `cli/daemon.mjs` (backup logic), `web/src/app/api/backup/route.ts`,
the settings UI.

**Diff:**
- New `encrypted_backups` table on the relay (the only "user data" table,
  and it's opaque ciphertext).
- Device daemon dumps its chat DB nightly, encrypts with the user's
  master key, uploads.
- Settings UI has the toggle with the explanatory copy.

**Test:**
1. Toggle backup ON in settings.
2. Wait for the nightly job (or trigger manually).
3. Verify a row appears in `encrypted_backups`.
4. Read the row from the relay DB; verify it's not parseable as a
   SQLite file (it's encrypted).
5. On a fresh device, restore from backup, verify all messages appear.

### Step 12 — multi-relay failover

**Files:** `cli/daemon.mjs`, deployment configs.

**Diff:**
- Deploy a second relay region.
- Devices know both endpoints, prefer lowest latency.
- Failover within seconds when one drops.

**Test:**
1. Two relays running. Device connects to the closer one.
2. Take the closer relay offline. Verify the device fails over within
   3 seconds.
3. Bring the closer relay back. Verify the device fails back (or
   stays on the second one — either is acceptable).

### Step 13 — reproducible builds + signed releases

**Files:** `.github/workflows/release.yml`, `nix/` or `guix/` config,
`SECURITY.md`.

**Diff:**
- GitHub Actions workflow that builds inside a Nix container.
- Cosign signs every artifact.
- SLSA L3 provenance attached.
- Public release page documents how to verify.

**Test:**
1. Tag a release. CI builds artifacts.
2. Download an artifact. Run `cosign verify`, verify it passes.
3. On a different machine, re-run the Nix build, verify byte-identical
   output.
4. The README has copy-paste instructions for verification.

---

## 14. Open questions to revisit

1. **Browser tab device identity**: an ephemeral keypair generated in JS
   and held in memory works, but there's no hardware backing. The
   compromise: browser sessions are explicitly transient — they have no
   persistence past tab close. If you want long-lived multi-device chat
   from a browser, you must install the Tauri desktop app.
2. **Local model inference**: out of v1 scope (Pi 4 can't run anything
   above 1.5B params usefully). v2: optional local Ollama integration as
   a tool the agent can call, with the user explicitly opting in per
   conversation.
3. **Cross-user messaging** (Arthur sends a message to another daemon
   user's daemon): out of scope. Daemon is single-user-multi-device, not
   multi-user.
4. **Per-tool device routing rules** ("filesystem tools always go to my
   laptop, sensor tools always go to the Pi"): v2. v1 routes everything
   to the agent home unless overridden per call.
5. **Conflict resolution UI for the rare lease race**: v2. v1 just shows
   "another device is editing this, try again."

---

## 15. Realistic timeline

| Phase | Steps | Time | Cumulative |
|---|---|---|---|
| Bedrock | 1-4 | 1 week | 1 week |
| Linux + arturito | 5-6 | 1 week | 2 weeks |
| Replication | 7-8 | 3 weeks | 5 weeks |
| E2EE | 9 | 2 weeks | 7 weeks |
| Hardening | 10 | 1 week | 8 weeks |
| Backup | 11 | 1 week | 9 weeks |
| Multi-relay | 12 | 1 week | 10 weeks |
| Builds | 13 | 2 weeks | 12 weeks |

**12 weeks of one engineer to v1 production-grade.** Plus iteration on
real users in parallel.

---

## 16. What this document commits us to

By signing off on this doc, we commit to:

1. **Zero user content on the relay**, ever, in any form the relay can
   read. Period.
2. **Single-writer per namespace**, single agent home per conversation.
   No CRDTs, no state divergence.
3. **End-to-end encryption in v1**, not deferred.
4. **Reproducible signed builds** before 1.0.
5. **Open source under AGPLv3** from day one.
6. **No shortcuts**: no `any`, no swallowed errors, no hardcoded paths,
   no untested code paths, no `--no-verify`.
7. **Tests at every step**, green CI on a fresh clone, no flakes.

If we cannot hold any of these, we change the doc, not the code.
