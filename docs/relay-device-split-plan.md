# Relay/Device Split — Plan v1

> **Status:** draft, awaiting critique
> **Date:** 2026-04-08
> **Author:** Claude (acting on Arthur's spec)

## 1. Why

Today, "arturito" the box does two jobs in one process:

1. **The relay** — multi-tenant: hosts the Next.js web UI, the WebSocket hub, the
   SQLite DB, the AI agent loop, and the sync infrastructure. Anyone with an
   account can use it.
2. **Arthur's personal device** — single-tenant: the agent loop calls `exec()`,
   `docker exec`, and `bwrap` directly on the same box, so the AI has root over
   /home/arthur, ~/.ssh, vault.env, all of Arthur's source repos.

This conflation has three problems:

- **Multi-tenancy is broken in principle.** Other users of this relay would
  get an agent that runs commands on Arthur's filesystem. There is no
  isolation between "the AI" and "Arthur's machine."
- **Tailscale is a hack.** The agent currently SSHes to `msi`, `pixel`, and
  `arturito` over Tailscale to reach other devices. That's a personal-network
  shortcut. A productized daemon must work for users who never set up
  Tailscale and can't be expected to.
- **The architecture isn't symmetric.** Arthur's laptop gets full filesystem
  access via `exec()`. Other devices (Orange Pi, future iOS, the Android app)
  reach the agent over the daemon WS protocol. Two different paths for the
  same logical operation.

## 2. The simplification

**There is exactly one channel: the daemon WebSocket.**

Every device — Arthur's laptop, the Orange Pi, his phone, his MSI box, a
future iPad, the Android watch — runs a daemon app (Linux/macOS via
`daemon.mjs` or Tauri, Android via the existing Kotlin app, iOS later) and
connects to `wss://my.daemon.page/ws/device` with a device token. The relay
treats them all identically.

The agent loop is a service inside the relay that:

1. Reads chat messages from the user.
2. Calls the model API (Claude / DeepSeek / Qwen — this is the **only**
   privileged thing the relay does, because it needs the API keys).
3. When the model emits a `tool_call`, the agent loop sends an
   `skill.invoke` over the WS hub to the user's chosen device.
4. The device runs the tool locally (`bash`, `read_file`, `edit_file`,
   `glob`, `grep`, sensors, screen, etc.) and sends the result back over
   the WS.
5. The agent feeds the result back to the model.
6. Loop until the model returns a final answer.

The relay has **zero** privileged access to anyone's filesystem. It is a
pure WS hub + AI router + DB. Tailscale is gone. `exec()` in the relay is
gone. The Docker sandbox in the relay is gone (the device is the sandbox —
each user's daemon process runs in their own user account on their own
machine).

### Concretely for Arthur's setup

`arturito` runs **two systemd services** that talk to each other only over
the local WebSocket:

| Service | User | Role | Has access to |
|---|---|---|---|
| `daemon-relay.service` | `daemon-relay` (new system user) | Next.js + WS hub + DB + agent loop | DB, model API keys, nothing in `/home/arthur` |
| `daemon-device.service` | `arthur` | `daemon.mjs` running as Arthur's personal device | `/home/arthur`, `~/.ssh`, vault.env, his code |

The relay listens on `localhost:4801/ws/device`. The device service connects
to that address with Arthur's device token. From the relay's point of view,
this is identical to Arthur's laptop connecting from across the internet.
**Same code path. Same protocol. Same isolation.**

For other users of `my.daemon.page`, only `daemon-relay.service` is on
arturito. Their devices (their own laptops/phones) connect via the public
Cloudflare tunnel `wss://my.daemon.page/ws/device`. The relay never reaches
into anyone's machine — it only relays messages.

## 3. Current vs target

### Current (broken)

```
arturito (one process tree, runs as `arthur`)
├── Next.js (4802) ────────────────┐
│   ├── /api/chat                  │
│   ├── agent-loop.ts ─── exec() ──┼─→ /home/arthur/* (direct fs access)
│   ├── docker exec sandbox        │   ssh msi/pixel via Tailscale
│   └── claude-sync ── reads ──────┴─→ /home/arthur/.claude/projects/*
├── ws-server (4801)
│   └── /ws/device  ←── Android app, Tauri desktop (currently underused)
└── proxy (4800) → fans / and /ws to the right port
```

### Target (clean)

```
arturito (two services, two users, talk over WS only)

┌─ daemon-relay.service ──── runs as `daemon-relay` ──────────┐
│  Next.js (4802)  + ws-server (4801) + proxy (4800)          │
│  - DB, AI router, agent loop, web UI                        │
│  - NO exec(), NO direct fs access, NO ssh, NO Tailscale     │
│  - Reads only its own dir + system env                      │
│  - Has model API keys via systemd env                       │
│  - Speaks ONE language outward: WS skill.invoke             │
└─────────────────────────────────────────────────────────────┘
                     ↑                  ↑                ↑
                  ws/device          ws/device       ws/device
                     │                  │                │
┌─ daemon-device.service ─┐  ┌─ Orange Pi ─┐  ┌─ Arthur's phone ─┐
│  daemon.mjs as `arthur` │  │  daemon.mjs │  │  Android app     │
│  Tools: bash, read,     │  │  + sensors  │  │  + sensors,      │
│  write, edit, glob,     │  │             │  │  screen, mic     │
│  grep, list, sysinfo,   │  │             │  │                  │
│  claude-sync            │  │             │  │                  │
└─────────────────────────┘  └─────────────┘  └──────────────────┘
```

The arrows are all the same protocol. The relay never knows or cares which
device is on the other end of a `ws/device` connection.

## 4. Phased plan

Phases marked with **(∥)** can run in parallel with the previous one.

### Phase 1: device tool surface parity

Goal: `daemon.mjs` exposes every tool the agent needs, with the same names
and shapes as the current in-process tool set.

Today `daemon.mjs` has: `run_shell`, `read_file`, `write_file`,
`list_directory`, `get_system_info`. Add:

- `edit_file(path, old_string, new_string)` — exact-substring edit, returns
  diff stat
- `glob(pattern, path?)` — file-pattern search
- `grep(pattern, path?, glob?, type?)` — content search via ripgrep
- `lint_file(path)` — runs `tsc --noEmit` / `py_compile` / etc. for the
  file's extension
- `claude_run(prompt, cwd?)` — runs `claude -p` locally and streams the
  output back via WS chunks
- `device_info()` — capabilities, OS, CPU, current `cwd`, free disk

Rename the existing tools to match the agent's vocabulary
(`bash` not `run_shell`, etc.), keeping back-compat aliases for one release.

Each tool returns a structured `{ ok, output, stderr?, lines?, diff? }`.

Estimated diff: ~400 lines in `cli/daemon.mjs`.

### Phase 2 (∥): primary-device routing in the relay

The agent needs to know which of a user's devices to route a tool to. Add:

- DB column `users.primary_device_id` (nullable)
- `GET /api/devices` already lists user devices (already exists)
- `POST /api/devices/primary { device_id }` to set the default
- A "device picker" pill in the chat UI header next to the model picker

Default behavior: if no primary is set, pick the most recently registered
online device. If none online, the agent surfaces an error to the user
saying "no device online — pair one to run commands."

Estimated diff: ~150 lines: 1 migration, 1 endpoint, 1 UI pill, 1 store
slice. Independent of Phase 1 — runs in parallel.

### Phase 3: agent-loop refactor (the big one)

`web/src/lib/agent-loop.ts` and `agent-loop-streaming.ts` currently call
`execInSandbox(containerId, ...)` for `bash`/`read_file`/`write_file`/
`list_files`/`search`. Replace **all** of those callsites with
`invokeDeviceTool(deviceId, toolName, args, userId)` which goes over the
existing `/command` POST endpoint to `ws-server`.

The Docker sandbox code path is deleted (or fenced behind `if
(process.env.DAEMON_INPROC_SANDBOX === '1')` for one release as a fallback
during transition).

Critically: **tool calls run in parallel within a turn** when the model
emits multiple. Today the loop iterates them serially with `for (const tc
of tool_calls)`. After the refactor:

```ts
const results = await Promise.all(
  message.tool_calls.map(tc => executeToolViaDevice(primaryDeviceId, tc, userId))
)
```

This is free latency win across every multi-tool turn. The WS server
already supports concurrent in-flight `request_id`s per device, so no
change needed there.

Estimated diff: ~250 lines deleted from agent-loop.ts (sandbox code), ~150
added (device routing). Net negative.

### Phase 4 (∥): Linux daemon as a system service

`scripts/install-daemon-device.sh` — creates a systemd unit that runs
`node /home/arthur/daemon/cli/daemon.mjs --token <env>` as user `arthur`.
Token comes from a one-time `daemon-cli pair` flow that hits the existing
`/api/auth/device-pair` endpoint and stores the token in
`/etc/daemon-device/token` (root-owned, mode 600, readable by service via
`LoadCredential=`).

For Arthur's specific arturito setup, the install script wires the service
to `localhost:4801/ws/device` instead of the public hostname.

This phase can run in parallel with Phase 3 because they touch separate
files. They converge at integration test in Phase 6.

Estimated diff: ~80 lines (1 install script, 1 systemd unit, 1 token
loader in `daemon.mjs`).

### Phase 5: harden the relay (drop the `arthur` user privileges)

Create a new system user `daemon-relay` with no home directory, no shell,
no SSH key. Move the relay's working directory from
`/home/arthur/daemon/web` to `/var/lib/daemon-relay/web` (or symlink). Move
the secrets the relay actually needs (Anthropic API key, etc.) from
`vault.env` to systemd `EnvironmentFile=/etc/daemon-relay/secrets.env`,
which is root-owned and readable only by `daemon-relay`.

Verify with `systemctl show daemon-relay.service` that the process can NOT
read `/home/arthur/.claude/`, `~/.ssh/`, or vault.env. Use systemd
sandboxing directives:

```ini
ProtectHome=true
ProtectSystem=strict
ReadWritePaths=/var/lib/daemon-relay /var/log/daemon-relay
PrivateTmp=true
NoNewPrivileges=true
```

This is the line that turns it from "Arthur's hack" into "a thing other
people can run." It's the test of whether the split is real.

Estimated work: 1 hour systemd surgery + verifying nothing breaks.

### Phase 6: integration test

E2E flow:
1. Send "what's in /home/arthur/daemon and how many lines is db.ts" via the
   chat UI.
2. Verify the agent picks Arthur's primary device, dispatches `glob` and
   `read_file` over WS, gets results back.
3. Verify the relay process never touched the filesystem (audit logs).
4. Send a multi-tool turn ("read these 5 files and summarize") and verify
   the 5 reads ran in parallel (`Promise.all` in action — total wall time
   ≈ slowest single read, not sum of all).
5. Open a second account on the same relay, verify it cannot list, read,
   or invoke anything on Arthur's device (per-user device map enforcement).

### Phase 7 (∥, deferrable): JSONL sync moves to the device

Currently `claude-sync.ts` runs in the Next.js process and reads
`/home/arthur/.claude/projects/*` directly. After Phase 5 the relay can't
do that anymore (and shouldn't — those files belong to Arthur's daemon
device, not the relay).

Move it: `daemon.mjs` watches `~/.claude/projects/` with `fs.watch`, parses
new JSONL entries as they appear, and pushes them up via a new WS message
type `chat.message_imported { thread_id?, content, role, ... }`. The relay
receives those and writes them to `chat_messages` with the correct
`source_session_id` and `complete=1`.

This phase is **deferrable** — Phase 5 can ship with JSONL sync still
running in the relay process if we mount `~/.claude` read-only into a
narrow path the relay can see. But the clean version is to move it.

### Phase 8 (∥): Orange Pi onboarding

Once Phase 1–4 are done, Orange Pi onboarding is literally:

```bash
ssh orangepi
curl -fsSL https://my.daemon.page/install.sh | bash
daemon-cli pair  # paste the 6-char code from the daemon web UI
sudo systemctl enable --now daemon-device
```

That's it. No special-case code anywhere. The Orange Pi shows up in
Arthur's device list with green dot. He can route bash, sensor reads,
display output to it via chat.

## 5. Parallelization (three flavors)

### A. Within an agent turn — tool-call fan-out

The model emits N tool_calls per turn. Today: serial. After refactor:
`Promise.all` over independent calls.

Caveats:
- Some tools have ordering dependencies (write then read the same file).
  The model decides; we trust the order it emits but execute concurrently
  within a single batch. If the model wants ordering, it issues them in
  separate turns.
- Tool calls that target *different devices* (read on laptop, sensor scan
  on Pi) trivially parallelize over the WS hub — different request_ids on
  different connections.

Expected speedup: ~2-5× on tool-heavy turns (e.g., "read these 5 files
and tell me what changed").

### B. Across devices — multi-device fan-out

When a user has phone + laptop + pi:
- The agent can pick per tool: filesystem tools → primary laptop, sensor
  tools → pi, screen/notification → phone.
- The loop's tool dispatcher gets a `selectDevice(userId, toolName)`
  function that consults a per-user routing table (defaults work, user can
  override per tool category in /settings).

This is a Phase 3 follow-up — the MVP just routes everything to the
primary device.

### C. Rebuild parallelization — what we can ship in parallel sessions

Phases 1, 2, and 4 are all **independent** of each other and of Phase 3:

- **Phase 1** (`daemon.mjs` tool surface) only touches `cli/`.
- **Phase 2** (primary-device routing) only touches `web/src/app/api/devices/*`,
  `db.ts` migration, and a small UI bit.
- **Phase 4** (systemd unit + install script) only touches `scripts/`.

Phase 3 (agent-loop refactor) depends on Phases 1 and 2 being merged.
Phase 5 (hardening) depends on Phase 3. Phase 6 (test) depends on 1+2+3+4.
Phase 7 and 8 are deferrable.

Parallel session plan:

| Session | Phases | Deps |
|---|---|---|
| A | 1 (device tools) | none |
| B (∥ with A) | 2 (primary-device routing) | none |
| C (∥ with A,B) | 4 (systemd install) | none |
| D | 3 (agent-loop refactor) | A, B done |
| E | 5 (hardening) + 6 (test) | D done |
| F (later) | 7 (JSONL move) + 8 (Orange Pi) | E done |

Net: ~3 sessions worth of work compressed into 2 wall-clock sessions if
A/B/C run alongside.

## 6. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Latency: WS round-trip per tool call vs inline `exec()` | (a) tool-call fan-out via `Promise.all`; (b) keep tools chunky, don't make the model loop over single bytes; (c) measure: typical exec is 10ms, WS round-trip on localhost is <2ms — net negligible |
| Device offline = no tools | UI shows red dot on the device picker; agent surfaces "no device online" instead of trying to fall back to local exec |
| Model picks wrong device | MVP: single primary device. Phase 3 follow-up: per-tool-category routing |
| daemon.mjs tool surface drift from agent expectations | Both sides import from `protocol/types.ts`; CI test that runs the agent against a mock device verifies the contract |
| Hardening breaks existing JSONL sync | Phase 7 explicitly handles this; in the interim, keep `~/.claude` as a `ReadOnlyPaths` mount for the relay |
| Cross-user device leak via fuzzy match | The existing `getUserDevice(userId, deviceId)` already filters by userId before fuzzy match; verified |
| Token theft on a compromised device | Device tokens are scoped per device via `device_tokens.device_id`; revoke from `/settings/devices` invalidates immediately |
| Single point of failure: the relay | Cloudflare tunnel handles ingress; if the relay process dies, devices reconnect on restart; messages in flight are lost (acceptable for v1) |
| Bandwidth: streaming bash output of `npm run build` over WS to the relay | Stream in chunks; chunk size cap 64KB; truncate at 1MB total per tool call (already in agent-loop today) |

## 7. Open questions for the critique

1. **Claude API key location.** The model API key has to live somewhere.
   In the relay (multi-tenant) it lets one user's prompt charge the
   shared budget unless we add per-user usage caps. Per-user BYOK is
   already half-built (`users.openai_api_key` etc.) — should that become
   the default and the relay-shared key only fall back?
2. **Device-side `claude_run`.** If the daemon device exposes a tool that
   runs `claude -p` locally, the agent on the relay can dispatch a sub-
   agent task to "the user's local Claude Code." That's powerful but the
   semantics of nested context get weird — should we just not?
3. **Where does the AI tool sandbox live now?** Today the relay's Docker
   sandbox is the safety net ("AI can't escape into the host"). After the
   split, the user's daemon device is the sandbox boundary. But on
   Arthur's arturito-as-device, daemon.mjs runs as `arthur` and has
   filesystem write — nothing constrains it. Do we want bubblewrap on
   the device side too, with a per-user-configurable allowlist of paths?
4. **Multi-device ordering**: when a user has 3 devices online, does the
   agent get to dispatch one tool call to each in parallel within one
   turn, or does it have to pick one device per turn? The protocol
   supports the former; the question is whether the model is smart
   enough to use it.
5. **What about the SPEC.md v0 scope?** The spec says "no hardware code"
   but daemon.mjs already runs on hardware. Is the split in or out of
   v0 scope, and if it's out, should we ship it as v0.5?
6. **Migration of Arthur's existing DB rows.** The 4750 messages already
   in project 8's canonical thread were imported by the cwd-scan
   approach. After the split, none of those have a `device_id` tag. Do
   we backfill, or just let them age out and tag new messages going
   forward?
7. **Service-to-service auth on `localhost:4801/ws/device`**. When the
   device daemon connects from the same box as the relay, should we
   skip the device token check (saving one DB lookup per connection)?
   Or always require it for symmetry with remote devices? (I lean:
   always require, symmetry is worth more than one DB lookup.)

## 8. Out of scope for this rewrite

- Any code under `desktop/` (Tauri Rust) — already speaks the protocol
- Android app — already speaks the protocol
- iOS app — doesn't exist yet
- Billing / per-user model API key budgeting
- Anything in SPEC.md Phase 4 (launch)
- Voice / personality / hardware code
- The patent stuff
- The Letta memory tools wiring (separate task #15)
