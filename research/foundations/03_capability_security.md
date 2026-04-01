# Capability-Based Security for AI Agent Permissions

*Research Foundation 03 -- 2026-04-01*
*Deep research from first principles for the daemon permission system.*

---

## 1. The Problem Statement

Daemon is a persistent AI agent that unifies multiple devices into one computer. It needs a permission system that is:

- **Granular enough to be safe** -- "read files in ~/Documents" not "read all files"
- **Simple enough that users don't drown in popups** -- no Android-style permission fatigue
- **Flexible enough that the AI can be useful** -- static permissions break when agents decide at runtime what to do
- **Provably secure** -- formal properties, not just "we think it's safe"

The fundamental tension: an AI agent that reasons, plans, and adapts cannot have its permissions fully designed in advance. What it needs to do is not known until execution time. Traditional access control assumes static, predictable access patterns. Daemon's access patterns are inherently dynamic.

---

## 2. Historical Foundations

### 2.1 Dennis and Van Horn (1966) -- The Origin

Jack B. Dennis and Earl C. Van Horn published "Programming Semantics for Multiprogrammed Computations" in Communications of the ACM (vol. 9, no. 3, pp. 143-155, 1966). This is the foundational paper.

**Key ideas:**

- A **capability** is an unforgeable token that both *designates* an object and *authorizes* specific operations on it. Designation and authority are bundled together -- you cannot name something you cannot access.
- Each process has a **C-list** (capability list) defining its **sphere of protection** -- the complete set of objects it can access and the operations it can perform.
- Capabilities are managed by the supervisor (kernel), not by user code. User code cannot forge, inspect, or modify the raw capability bits.
- Processes can **share** capabilities by passing them in messages, enabling controlled cooperation between mutually untrusting computations.

**Why this matters for daemon:** The C-list model maps directly to an agent's permission set. Each daemon session gets a C-list. The daemon process cannot access anything outside its C-list. Sub-agents get derived C-lists that are subsets of the parent's.

### 2.2 The Confused Deputy Problem (1988)

Norm Hardy identified the confused deputy problem: a program with legitimate authority is tricked into misusing that authority on behalf of a less-privileged requester.

**Example for daemon:** A sub-agent asks daemon to "read the config file at ~/.secrets/vault.env" as part of a seemingly benign task. In an ACL system, daemon has permission (it runs as the user). In a capability system, the sub-agent would need an explicit capability for that specific file -- which it would not have.

**Capability systems prevent confused deputies structurally:** authority is carried by the capability token, not inferred from ambient identity. The sub-agent can only access objects for which it holds explicit capabilities. No capability for vault.env = no access, period. The deputy cannot be confused because it has no ambient authority to be confused about.

### 2.3 Mark Miller's Object-Capability Model (2006)

Miller's PhD thesis "Robust Composition: Towards a Unified Approach to Access Control and Concurrency Control" (Johns Hopkins, 2006) formalized the **object-capability (ocap) model** and proved several critical properties.

**Core principles:**

1. **No ambient authority.** A process can only act on objects for which it holds explicit capabilities. There are no global namespaces, no ambient filesystem, no implicit network access.

2. **Capabilities are unforgeable references.** In an object-capability language, an object reference IS a capability. If you have the reference, you have authority. If you don't, you cannot manufacture it.

3. **Principle of Least Authority (POLA) made mechanical.** You can only give what you have. You can only give *less* (attenuation). This is not a policy choice -- it is a structural property of the system.

4. **Attenuation is transitive.** If Alice attenuates a capability before giving it to Bob, Bob can only further attenuate before giving to Carol. Authority monotonically decreases through delegation chains.

5. **Revocation via the caretaker pattern.** A caretaker is a proxy that forwards messages to a target object. The caretaker's creator can disable forwarding at any time, instantly revoking the capability for all holders downstream.

6. **Membranes for compartments.** A membrane wraps an entire object graph, attenuating all capabilities that cross the boundary. This enables sandboxing entire subsystems.

**"Capability Myths Demolished" (Miller, Yee, Shapiro, 2003):**
Refuted three persistent myths:
- **Equivalence myth:** ACL systems and capability systems are NOT equivalent. ACLs cannot correctly handle multi-principal interactions (the confused deputy).
- **Irrevocability myth:** Capabilities CAN be revoked (caretaker pattern, membranes).
- **Confinement myth:** Capability systems CAN enforce confinement through careful construction.

---

## 3. Real-World Implementations

### 3.1 Capsicum (FreeBSD, 2010)

Capsicum adds capability-based security to UNIX. Developed by Robert Watson and Jonathan Anderson, presented at USENIX Security 2010. In FreeBSD since 9.0, enabled by default since 10.0.

**How it works:**

- A process enters **capability mode** via `cap_enter()`. This is a one-way transition -- there is no escape.
- In capability mode, the process loses ALL ambient authority. No `open()` by path, no `socket()`, no process table visibility.
- The only authorities it retains are its open **file descriptors**, which become capabilities.
- File descriptors can be **limited** with `cap_rights_limit()` to restrict operations (e.g., read-only, no seek, no fstat).
- New file descriptors can only be obtained relative to existing directory descriptors via `openat()`.

**Used in production:** tcpdump, dhclient, Chromium (Google collaboration), auditdistd, hastd, kdump, and dozens of FreeBSD base system utilities.

**Lesson for daemon:** Capsicum proves that capability-based security can be retrofitted onto UNIX without rewriting the world. The key insight is that file descriptors already ARE capabilities in UNIX -- Capsicum just removes all the non-capability paths (ambient open, etc.).

### 3.2 CloudABI

CloudABI takes POSIX, adds capability-based security, and removes everything incompatible. The result: only 49 syscalls.

**Key properties:**

- Processes cannot open files by absolute path.
- Processes cannot open network connections from scratch.
- Processes cannot observe global system state (process table, etc.).
- A process's capabilities are fully determined by its set of file descriptors at launch.
- The parent process is responsible for launching children with the correct set of resources.

**Example:** A static web server is launched with two file descriptors: one TCP listener, one directory handle for serving files. It physically cannot read any other directory or open any other network port.

**Lesson for daemon:** CloudABI's launch-with-capabilities model maps perfectly to daemon spawning sub-agents. The orchestrator decides what capabilities each sub-agent gets at creation time. The sub-agent cannot expand its own authority.

### 3.3 Fuchsia OS (Google)

Fuchsia's Zircon microkernel is fully capability-based. Deployed in production on all Google Nest Hub devices.

**Architecture:**

- **No ambient authority.** Applications can interact only with objects to which they have been explicitly granted access.
- **Handle-based access.** Capabilities are passed as kernel handles, not names. You cannot access `/dev/camera` by name -- you need a handle granted by the component framework.
- **Component isolation.** Every application and system service runs in an isolated sandbox. All inter-process communication is explicitly declared in component manifests.
- **Capability routing.** The component framework routes capabilities between components based on declared "use" and "expose" relationships. A component cannot use a capability it didn't declare, and the framework won't route one it didn't approve.
- **Enforced by the kernel,** not by application-level checks. A process literally cannot perform operations for which it lacks handles.

**Lesson for daemon:** Fuchsia's component manifest model is directly applicable. Each daemon tool/skill can declare what capabilities it needs (its "use" declarations) and what it provides (its "expose" declarations). The daemon orchestrator routes capabilities between them like Fuchsia's component framework.

### 3.4 WASI (WebAssembly System Interface)

WASI implements capability-based security for WebAssembly modules. Reaching WASI 1.0 maturity in 2026.

**How it works:**

- Wasm modules have NO ambient access to the filesystem, network, or system.
- The host runtime explicitly grants specific capabilities: this directory handle, this network socket, this environment variable.
- Modules cannot access anything beyond what was explicitly provided.
- The Wasmtime runtime enforces this at the VM level -- there is no escape hatch.

**Lesson for daemon:** If daemon ever runs plugins/skills as Wasm modules, WASI provides hardware-enforced capability isolation for free. Even without Wasm, the WASI model of "host grants specific resources at instantiation" is the right pattern.

---

## 4. What Mobile Platforms Got Wrong (and Right)

### 4.1 Android Permission Model -- Critique

**Problems:**

- **All-or-nothing grants.** Until Android 11, granting "location" meant granting it always. No time-boxing, no context-sensitivity.
- **Permission fatigue.** Users rubber-stamp permission dialogs. Studies show most users don't read or understand what they're granting.
- **Over-privileging.** Apps routinely request more permissions than needed. The per-app model breaks when most data access comes from shared third-party libraries.
- **Coarse granularity.** "Camera" means full camera access. No distinction between "take one photo for a profile picture" and "stream video continuously."
- **No attenuation.** An app with camera permission cannot give a sub-component *reduced* camera permission. The library gets the same full access.
- **No delegation chain.** No way to trace how a permission was obtained or restrict downstream use.

**What Android got right (eventually):**
- One-time permissions (Android 11+)
- Approximate vs. precise location (Android 12+)
- Photo picker (specific photos vs. full library, Android 13+)
- Auto-revocation of unused permissions

### 4.2 iOS Permission Model -- Critique

**Problems:**

- **Binary access.** Permission is granted or denied. Once granted, the app gets full access to the raw data type.
- **Bundled consent.** App Tracking Transparency bundles multiple consent decisions into one toggle.
- **Limited granularity.** Until iOS 14, photo library was all-or-nothing. No time-boxing for camera/mic.
- **No user-visible attenuation.** Users cannot say "only during business hours" or "only in this app context."

**What iOS got right:**
- Permission prompts at point of use (not at install time like early Android)
- Indicator lights for active camera/mic
- Approximate location option
- Selected photos access (iOS 14+)

### 4.3 The Core Lesson

Both mobile platforms prove that **identity-based permission models (this app has permission X) fail at scale.** The user cannot reason about the combinatorial explosion of apps x permissions x contexts. What works better:

1. **Just-in-time** -- ask at the moment of use, not at install
2. **Scoped** -- "this photo" not "all photos"
3. **Time-bounded** -- "for this session" not "forever"
4. **Attenuable** -- the recipient can restrict further
5. **Revocable** -- the user can revoke at any time
6. **Visible** -- show when capabilities are in use (iOS indicator lights)

---

## 5. Macaroons: Capabilities as Cryptographic Tokens

Google's macaroon construction (Birgisson et al., 2014) provides a practical cryptographic mechanism for capabilities with contextual caveats.

### 5.1 How Macaroons Work

A macaroon is a bearer credential constructed from chained HMACs:

```
root_key = secret known only to the issuer
macaroon_id = "user:arthur, resource:files"
signature_0 = HMAC(root_key, macaroon_id)
```

**Caveats** attenuate the macaroon by chaining additional HMAC operations:

```
caveat_1 = "path UNDER ~/Documents"
signature_1 = HMAC(signature_0, caveat_1)

caveat_2 = "expires 2026-04-01T12:00:00Z"
signature_2 = HMAC(signature_1, caveat_2)

caveat_3 = "operations = read"
signature_3 = HMAC(signature_2, caveat_3)
```

**Properties:**

- **Anyone can add caveats** (attenuate). Adding a caveat only requires the current macaroon, not the root key.
- **Nobody can remove caveats.** The HMAC chain is one-directional. Removing a caveat would require recomputing from the root key.
- **Verification requires the root key.** The issuer recomputes the HMAC chain and checks each caveat.
- **Third-party caveats** require discharge from an external service (e.g., "authenticated via Google SSO"), enabling federated authorization.

### 5.2 Fly.io Production Experience

Fly.io adopted macaroons for their entire authorization system:

- **Hierarchical scoping:** Organization -> App -> Machine/Volume
- **Permission masks:** Read, Write, Create, Delete, Control
- **Practical attenuation:** An admin token (`org 4721, mask=*`) can be attenuated to app-specific read-only, CI/CD deploy-only, or auditor-only tokens.
- **Service-to-service:** Worker tokens derived from user tokens with auth/expiry stripped, locked to specific machines.
- **Structured caveats:** They deliberately avoided untyped caveats, using structured formats for operational clarity.

### 5.3 Why Macaroons Fit Daemon

Macaroons solve daemon's specific problems:

| Daemon Need | Macaroon Solution |
|---|---|
| "Read files in ~/Documents only" | Path caveat: `path UNDER ~/Documents` |
| "Use camera for 30 seconds" | Time caveat: `expires +30s`, resource caveat: `device = camera` |
| "SSH to msi, read-only" | Host caveat: `ssh_target = msi`, operation caveat: `ops = read` |
| Sub-agent gets reduced permissions | Parent attenuates its macaroon before passing to child |
| User revokes mid-operation | Short-lived tokens + revocation list check |
| "Only when user is home" | Context caveat with third-party discharge from location service |

---

## 6. Identity and Attestation: SPIFFE/SPIRE

SPIFFE (Secure Production Identity Framework for Everyone) and SPIRE (its reference implementation) address the question: *how do you know who is asking?*

### 6.1 Core Concepts

- **SPIFFE ID:** A URI-format identity for every workload: `spiffe://daemon.page/agent/arthur/main`
- **SVID (SPIFFE Verifiable Identity Document):** A short-lived X.509 certificate or JWT proving the identity. Typically valid for minutes, not days.
- **Node attestation:** Before an agent on a device gets an identity, SPIRE verifies the device itself (TPM measurement, cloud instance metadata, etc.).
- **Workload attestation:** Before a process on an attested device gets an identity, SPIRE verifies the process (binary hash, container ID, cgroup, etc.).

### 6.2 Why This Matters for Daemon

Daemon runs across multiple devices (arturito, msi, pixel). Each daemon process on each device needs a verifiable identity:

- The daemon orchestrator on arturito: `spiffe://daemon.page/orchestrator/arturito`
- A sub-agent spawned for a task: `spiffe://daemon.page/agent/arthur/task-12345`
- The Android app: `spiffe://daemon.page/client/android/pixel`
- The ESP32 pendant: `spiffe://daemon.page/device/esp32/pendant-01`

Each identity gets short-lived credentials. A compromised ESP32 cannot impersonate the orchestrator. A malicious sub-agent cannot claim to be the main daemon.

### 6.3 Combining SPIFFE with Capabilities

SPIFFE answers "who are you?" Capabilities answer "what can you do?"

The flow:
1. Device attests to SPIRE -> gets SVID (identity)
2. Orchestrator verifies SVID -> issues capability tokens (macaroons) scoped to the task
3. Agent uses capability tokens for resource access -> enforcement point checks token validity
4. Token expires or task completes -> authority vanishes

Identity without capability = authenticated but unauthorized (safe).
Capability without identity = authorized but unverifiable (unsafe).
Both together = verified identity with scoped, attenuable, revocable authority.

---

## 7. Zero Trust for AI Agents

### 7.1 Why Zero Trust Applies

Zero trust operates on "never trust, always verify." For AI agents, this is not paranoia -- it is structural necessity:

- **Agents are non-deterministic.** The same prompt can produce different actions.
- **Agents can be manipulated.** Prompt injection can alter behavior without changing code.
- **Agent chains amplify risk.** A compromised sub-agent can attempt to escalate through the chain.
- **Autonomy varies.** The same agent might be trustworthy for reading files and dangerous for deleting them.

### 7.2 Key Principles Applied to Daemon

**Verify explicitly.** Every daemon action must carry a valid capability token. No action proceeds on ambient authority alone. The orchestrator verifies identity (SVID) and capability (macaroon) on every request.

**Assume breach.** Design for the case where a sub-agent is compromised:
- Capabilities are time-bounded (minutes, not hours)
- Each sub-agent runs in an isolated context
- Lateral movement is structurally impossible (no shared capabilities between unrelated agents)
- Circuit breakers halt suspicious activity patterns

**Apply least privilege dynamically.** Static least privilege fails for AI agents because their needs are determined at runtime. Instead:
- Per-task token minting: the orchestrator mints capability tokens scoped to the specific planned actions
- Just-in-time expansion: if the agent discovers it needs additional capabilities, it requests them from the orchestrator (which may prompt the user)
- Automatic shrinkage: tokens expire when the task completes

### 7.3 The Agentic Trust Framework (CSA, 2026)

The Cloud Security Alliance published the Agentic Trust Framework applying zero trust to AI agents. Five control domains:

1. **Identity:** Who is this agent? Authentication, authorization, session management.
2. **Behavior:** What is it doing? Observability, anomaly detection, intent analysis.
3. **Data governance:** What data is it consuming and producing? Input validation, PII protection, output controls.
4. **Segmentation:** Where can it go? Access boundaries, resource limits, policy enforcement.
5. **Incident response:** What if it goes rogue? Circuit breakers, kill switches, containment.

---

## 8. Daemon's Capability System Design

### 8.1 Design Principles

Drawing from all the above research, daemon's capability system follows these principles:

1. **No ambient authority.** The daemon process and all sub-agents start with zero capabilities. Every capability is explicitly granted.
2. **Capabilities are macaroon tokens.** Cryptographically constructed, attenuable, verifiable without central authority.
3. **Identity via attestation.** Each device and process proves its identity before receiving capabilities.
4. **Monotonic attenuation.** Capabilities can only be narrowed, never broadened. A sub-agent can never have more authority than its parent.
5. **Time-bounded by default.** Every capability has an expiration. No permanent grants.
6. **User is the root of trust.** The user (Arthur) holds the root capability. All other capabilities derive from the user's explicit grants.
7. **Context-sensitive.** Capabilities can depend on runtime conditions (location, time, device state).
8. **Auditable.** Every capability exercise is logged with the full token chain.

### 8.2 Capability Token Structure

```
DaemonCapability {
  // Identity
  token_id:       UUID
  issuer:         SPIFFE_ID        // who created this token
  holder:         SPIFFE_ID        // who can use this token
  issued_at:      Timestamp

  // Authority (the macaroon core)
  root_signature: bytes            // HMAC from root key
  caveats:        Caveat[]         // ordered list, each narrows scope
  final_signature: bytes           // HMAC chain result

  // Metadata
  parent_token:   UUID | null      // delegation chain
  task_id:        UUID | null      // what task this was issued for
  delegation_depth: uint8          // how many hops from root (max 5)
}

Caveat {
  type:           CaveatType
  value:          CaveatValue

  // CaveatType is one of:
  //   RESOURCE    - what object/path/device
  //   OPERATION   - what actions (read, write, execute, control)
  //   TIME        - expires_at, not_before, max_duration
  //   CONTEXT     - location, network, device_state
  //   RATE        - max_calls, max_bytes, calls_per_minute
  //   SCOPE       - task_id, thread_id, session_id
  //   THIRD_PARTY - requires discharge from external service
}
```

### 8.3 Concrete Capability Examples

**"Read files in ~/Documents"**
```
caveats: [
  { type: RESOURCE,  value: { kind: "filesystem", path: "/home/arthur/Documents/**", device: "arturito" } },
  { type: OPERATION, value: { allowed: ["read", "list", "stat"] } },
  { type: TIME,      value: { expires_at: "2026-04-01T12:30:00Z" } },
  { type: RATE,      value: { max_bytes_read: 10_000_000 } }
]
```

**"Use camera for 30 seconds"**
```
caveats: [
  { type: RESOURCE,  value: { kind: "sensor", device: "pixel", sensor: "camera" } },
  { type: OPERATION, value: { allowed: ["capture_photo"] } },
  { type: TIME,      value: { max_duration_seconds: 30 } },
  { type: RATE,      value: { max_calls: 5 } }
]
```

**"SSH to msi, read-only commands"**
```
caveats: [
  { type: RESOURCE,  value: { kind: "ssh", target_host: "msi" } },
  { type: OPERATION, value: { allowed: ["execute_readonly"] } },
  { type: SCOPE,     value: { command_allowlist: ["ls", "cat", "type", "dir", "Get-Content", "Get-ChildItem"] } },
  { type: TIME,      value: { expires_at: "2026-04-01T12:05:00Z" } }
]
```

**"Access GPS once"**
```
caveats: [
  { type: RESOURCE,  value: { kind: "sensor", device: "pixel", sensor: "gps" } },
  { type: OPERATION, value: { allowed: ["read_location"] } },
  { type: RATE,      value: { max_calls: 1 } },
  { type: SCOPE,     value: { precision: "approximate" } }
]
```

**"Track location continuously" (requires explicit escalation)**
```
caveats: [
  { type: RESOURCE,  value: { kind: "sensor", device: "pixel", sensor: "gps" } },
  { type: OPERATION, value: { allowed: ["read_location", "subscribe_location"] } },
  { type: RATE,      value: { poll_interval_min_seconds: 60 } },
  { type: TIME,      value: { max_duration_seconds: 3600 } },
  { type: SCOPE,     value: { precision: "precise" } },
  { type: THIRD_PARTY, value: { discharge_service: "user_consent", prompt: "Daemon wants to track your location for 1 hour" } }
]
```

### 8.4 Capability Delegation to Sub-Agents

When daemon spawns a sub-agent for a task:

```
1. Orchestrator plans task
   -> identifies required capabilities
   -> checks: do I have these capabilities? (I can only give what I have)

2. Orchestrator attenuates its own capabilities
   -> narrows resource scope to task-specific paths
   -> narrows operations to task-specific actions
   -> adds task_id caveat
   -> sets expiry to task timeout
   -> increments delegation_depth

3. Orchestrator creates sub-agent
   -> passes attenuated capability tokens
   -> sub-agent is the new holder (SPIFFE ID)
   -> sub-agent CANNOT use parent's original capabilities

4. Sub-agent executes
   -> every resource access requires presenting a valid token
   -> enforcement point verifies: signature chain, all caveats, holder identity
   -> rejection if ANY caveat fails

5. Sub-agent wants to delegate further (e.g., to a tool)
   -> can only attenuate further (delegation_depth increments)
   -> max depth = 5 (hard limit, prevents unbounded chains)
   -> tool gets even narrower capability

6. Task completes or times out
   -> all task-scoped tokens expire
   -> no cleanup needed
```

### 8.5 Capability Revocation

Three complementary mechanisms:

**1. Ephemeral authority (primary).**
Most capabilities expire in minutes. A stolen token is useless after expiry. For 90% of operations, this is sufficient -- no explicit revocation needed.

**2. Revocation list (supplementary).**
For long-running capabilities or emergency revocation:
```
RevocationEntry {
  token_id:    UUID         // specific token to revoke
  revoked_at:  Timestamp
  reason:      string
  scope:       "token" | "holder" | "task"  // revoke one token, all tokens for a holder, or all tokens for a task
}
```
Enforcement points check the revocation list before honoring a token. The list is small (only active, non-expired tokens) and checked in O(1) via hash lookup.

**3. Circuit breaker (emergency).**
If anomalous behavior is detected (excessive access, unusual patterns, failed caveat checks), the orchestrator can:
- Revoke all tokens for a sub-agent (scope: "holder")
- Revoke all tokens for a task (scope: "task")
- Enter lockdown mode: reject ALL capability exercises until user confirms
- Kill the sub-agent process

### 8.6 Context-Dependent Capabilities

Some capabilities should only be valid under specific conditions:

**"Can use camera only when user is home"**
```
caveats: [
  { type: RESOURCE,  value: { kind: "sensor", sensor: "camera" } },
  { type: CONTEXT,   value: { condition: "user_location", operator: "within",
                               reference: "home_geofence", radius_meters: 100 } }
]
```

Context caveats are evaluated at exercise time by the enforcement point, which queries context providers:

| Context Type | Provider | How Evaluated |
|---|---|---|
| `user_location` | Pixel GPS / WiFi SSID | Is the user within the geofence? |
| `time_of_day` | System clock | Is current time within allowed window? |
| `device_state` | Device health monitor | Is the device connected/charged/unlocked? |
| `network` | Network monitor | Is the device on trusted WiFi vs. public? |
| `user_presence` | Sensor fusion | Is the user actively present (recent interaction)? |

Context evaluation adds latency (~50ms for local, ~200ms for cross-device). Cache context state for high-frequency checks.

### 8.7 Risk Tiers and User Interaction

Not every capability grant should require a popup. The system classifies operations into risk tiers:

```
Tier 0 -- SILENT (auto-approve, log only)
  - Read daemon's own knowledge graph
  - Read conversation history
  - Perform web searches
  - Read public data
  - Check device status

Tier 1 -- NOTIFY (auto-approve, show indicator)
  - Read files in pre-approved directories
  - Execute pre-approved read-only commands
  - Use sensors for single reads (time check, weather)
  - Access approximate location

Tier 2 -- CONFIRM (require user tap/click)
  - Write/modify files
  - Execute commands with side effects
  - Send messages (email, Telegram, etc.)
  - Access precise location
  - Use camera/microphone

Tier 3 -- CHALLENGE (require explicit authentication)
  - Access secrets/credentials
  - SSH write operations to other devices
  - Financial transactions (Stripe, etc.)
  - Modify system configuration
  - Grant capabilities to third parties
  - Continuous sensor access (tracking)
```

**Tier escalation rules:**
- Combination of Tier 1 capabilities that together constitute Tier 2 behavior (e.g., read files + send network request = potential exfiltration) -> escalate to Tier 2.
- Repeated Tier 2 requests in the same task can be batched: "Daemon wants to: write 3 files, send 1 email. Approve all?"
- User can pre-approve patterns: "Always allow daemon to read ~/Documents" creates a standing Tier 1 grant.
- Standing grants are still time-bounded (user sets: 1 hour, 1 day, 1 week, or until revoked).

### 8.8 Enforcement Architecture

```
                    +------------------+
                    |   User (Arthur)  |
                    |  Root of Trust   |
                    +--------+---------+
                             |
                    grants root capability
                             |
                    +--------v---------+
                    |   Orchestrator   |
                    |  (daemon-core)   |
                    |                  |
                    |  - Plans tasks   |
                    |  - Mints tokens  |
                    |  - Routes caps   |
                    +--------+---------+
                             |
              attenuates & delegates
                             |
            +----------------+----------------+
            |                |                |
   +--------v------+  +-----v--------+  +----v---------+
   |  Sub-Agent A  |  | Sub-Agent B  |  |  Tool/Skill  |
   |  (e.g., file  |  | (e.g., SSH   |  |  (e.g., web  |
   |   operations) |  |  commands)   |  |   search)    |
   +--------+------+  +-----+--------+  +----+---------+
            |                |                |
            | presents token | presents token | presents token
            |                |                |
   +--------v----------------v----------------v---------+
   |              Enforcement Points                     |
   |                                                     |
   |  - Filesystem guard (path + operation check)        |
   |  - SSH guard (host + command allowlist check)       |
   |  - Sensor guard (device + sensor + rate check)      |
   |  - Network guard (destination + protocol check)     |
   |  - API guard (endpoint + method + payload check)    |
   |                                                     |
   |  Each guard:                                        |
   |    1. Verifies token signature (HMAC chain)         |
   |    2. Checks all caveats                            |
   |    3. Checks revocation list                        |
   |    4. Evaluates context caveats                     |
   |    5. Logs the access attempt + result              |
   |    6. ALLOWS or DENIES                              |
   +-----------------------------------------------------+
```

### 8.9 Protocol: Capability Request Flow

```
Agent                    Orchestrator              Enforcement Point        User
  |                           |                           |                   |
  |  "I need to read          |                           |                   |
  |   ~/Documents/report.md"  |                           |                   |
  |-------------------------->|                           |                   |
  |                           |                           |                   |
  |                    [Check: do I hold a                 |                   |
  |                     filesystem capability              |                   |
  |                     covering this path?]               |                   |
  |                           |                           |                   |
  |                    [Check risk tier: Tier 1            |                   |
  |                     (pre-approved directory)]          |                   |
  |                           |                           |                   |
  |                    [Mint attenuated token:             |                   |
  |                     path=~/Documents/report.md         |                   |
  |                     ops=read, expires=+5min]           |                   |
  |                           |                           |                   |
  |  <-- token --------------|                           |                   |
  |                           |                           |                   |
  |  "read ~/Documents/report.md"                         |                   |
  |  + token                  |                           |                   |
  |---------------------------------------->              |                   |
  |                           |                           |                   |
  |                           |              [Verify signature]               |
  |                           |              [Check caveats: path OK]         |
  |                           |              [Check revocation: clear]        |
  |                           |              [Log: access granted]            |
  |                           |                           |                   |
  |  <-- file contents ----------------------|            |                   |
  |                           |                           |                   |


--- For Tier 2+ (requires user confirmation): ---

Agent                    Orchestrator              Enforcement Point        User
  |                           |                           |                   |
  |  "I need to delete        |                           |                   |
  |   ~/Documents/old.txt"    |                           |                   |
  |-------------------------->|                           |                   |
  |                           |                           |                   |
  |                    [Check risk tier: Tier 2            |                   |
  |                     (write/delete operation)]          |                   |
  |                           |                           |                   |
  |                           |  "Daemon wants to delete  |                   |
  |                           |   ~/Documents/old.txt"    |                   |
  |                           |----------------------------------------->     |
  |                           |                           |                   |
  |                           |                           |    [User taps     |
  |                           |                           |     APPROVE]      |
  |                           |                           |                   |
  |                           |  <-- approved ----------------------------|   |
  |                           |                           |                   |
  |                    [Mint token: path=old.txt           |                   |
  |                     ops=delete, expires=+1min,         |                   |
  |                     max_calls=1]                       |                   |
  |                           |                           |                   |
  |  <-- token ---------------|                           |                   |
  |                           |                           |                   |
  |  (proceeds as above)      |                           |                   |
```

### 8.10 Data Structures: Implementation Sketch

```python
from dataclasses import dataclass, field
from enum import Enum
from typing import Optional
import hashlib, hmac, json, time, uuid

class CaveatType(Enum):
    RESOURCE    = "resource"
    OPERATION   = "operation"
    TIME        = "time"
    CONTEXT     = "context"
    RATE        = "rate"
    SCOPE       = "scope"
    THIRD_PARTY = "third_party"

class RiskTier(Enum):
    SILENT    = 0  # auto-approve
    NOTIFY    = 1  # auto-approve + indicator
    CONFIRM   = 2  # requires user approval
    CHALLENGE = 3  # requires authentication

@dataclass
class Caveat:
    type: CaveatType
    value: dict  # type-specific structured data

@dataclass
class DaemonCapability:
    token_id: str = field(default_factory=lambda: str(uuid.uuid4()))
    issuer: str = ""           # SPIFFE ID of creator
    holder: str = ""           # SPIFFE ID of authorized user
    issued_at: float = field(default_factory=time.time)
    caveats: list[Caveat] = field(default_factory=list)
    parent_token: Optional[str] = None
    task_id: Optional[str] = None
    delegation_depth: int = 0
    signature: bytes = b""

    def add_caveat(self, caveat: Caveat, current_signature: bytes) -> bytes:
        """Add a caveat (attenuate). Returns new signature."""
        self.caveats.append(caveat)
        caveat_bytes = json.dumps({
            "type": caveat.type.value,
            "value": caveat.value
        }).encode()
        new_sig = hmac.new(current_signature, caveat_bytes, hashlib.sha256).digest()
        self.signature = new_sig
        return new_sig

    def attenuate(self, additional_caveats: list[Caveat],
                  new_holder: str, task_id: str) -> 'DaemonCapability':
        """Create a derived capability with additional restrictions."""
        child = DaemonCapability(
            issuer=self.holder,
            holder=new_holder,
            parent_token=self.token_id,
            task_id=task_id,
            delegation_depth=self.delegation_depth + 1,
            caveats=list(self.caveats),  # inherit parent caveats
            signature=self.signature      # continue HMAC chain
        )
        for caveat in additional_caveats:
            child.add_caveat(caveat, child.signature)
        return child

@dataclass
class CapabilityVerdict:
    allowed: bool
    reason: str
    token_id: str
    caveats_checked: int
    evaluation_ms: float

class EnforcementPoint:
    """Guards a specific resource type. Verifies tokens before allowing access."""

    def __init__(self, root_key: bytes, revocation_store):
        self.root_key = root_key
        self.revocation_store = revocation_store

    def verify(self, token: DaemonCapability,
               requested_resource: dict,
               requested_operation: str,
               context: dict) -> CapabilityVerdict:
        start = time.time()

        # 1. Check revocation
        if self.revocation_store.is_revoked(token.token_id):
            return CapabilityVerdict(False, "token revoked", token.token_id, 0, 0)

        # 2. Verify HMAC chain (recompute from root key)
        if not self._verify_signature_chain(token):
            return CapabilityVerdict(False, "invalid signature", token.token_id, 0, 0)

        # 3. Check delegation depth
        if token.delegation_depth > 5:
            return CapabilityVerdict(False, "max delegation depth exceeded", token.token_id, 0, 0)

        # 4. Evaluate each caveat
        for i, caveat in enumerate(token.caveats):
            if not self._evaluate_caveat(caveat, requested_resource, requested_operation, context):
                elapsed = (time.time() - start) * 1000
                return CapabilityVerdict(False, f"caveat {i} ({caveat.type.value}) failed",
                                        token.token_id, i + 1, elapsed)

        elapsed = (time.time() - start) * 1000
        return CapabilityVerdict(True, "all caveats satisfied",
                                token.token_id, len(token.caveats), elapsed)

    def _evaluate_caveat(self, caveat: Caveat, resource: dict,
                         operation: str, context: dict) -> bool:
        match caveat.type:
            case CaveatType.RESOURCE:
                return self._check_resource(caveat.value, resource)
            case CaveatType.OPERATION:
                return operation in caveat.value.get("allowed", [])
            case CaveatType.TIME:
                now = time.time()
                if "expires_at" in caveat.value:
                    return now < caveat.value["expires_at"]
                if "max_duration_seconds" in caveat.value:
                    return (now - caveat.value.get("started_at", 0)) < caveat.value["max_duration_seconds"]
                return True
            case CaveatType.CONTEXT:
                return self._check_context(caveat.value, context)
            case CaveatType.RATE:
                return self._check_rate(caveat.value, resource)
            case CaveatType.SCOPE:
                return self._check_scope(caveat.value, resource)
            case CaveatType.THIRD_PARTY:
                return self._verify_discharge(caveat.value)
        return False

    def _verify_signature_chain(self, token: DaemonCapability) -> bool:
        """Recompute HMAC chain from root key and verify."""
        sig = hmac.new(self.root_key, token.token_id.encode(), hashlib.sha256).digest()
        for caveat in token.caveats:
            caveat_bytes = json.dumps({
                "type": caveat.type.value,
                "value": caveat.value
            }).encode()
            sig = hmac.new(sig, caveat_bytes, hashlib.sha256).digest()
        return hmac.compare_digest(sig, token.signature)

    # _check_resource, _check_context, _check_rate, _check_scope,
    # _verify_discharge are resource-type-specific implementations
```

---

## 9. Security Properties and Guarantees

### 9.1 What This System Proves

| Property | Mechanism | Formal Basis |
|---|---|---|
| **No privilege escalation** | Monotonic attenuation (HMAC chain only grows) | Macaroon construction |
| **No confused deputy** | Authority carried by token, not ambient identity | Dennis & Van Horn capability model |
| **No forgery** | HMAC chain from root key; root key never leaves orchestrator | Cryptographic HMAC security |
| **Bounded blast radius** | Time expiry + task scoping + max delegation depth | Composition of caveats |
| **Revocability** | Revocation list + ephemeral tokens + circuit breaker | Caretaker pattern (Miller) |
| **Auditability** | Every exercise logged with full token chain | Structural (enforcement point design) |
| **Confinement** | Sub-agents cannot access resources outside their token scope | Capability confinement (Miller thesis) |

### 9.2 What This System Cannot Prevent

Honest accounting of limitations:

- **Covert channels.** A compromised sub-agent could encode information in timing or access patterns. Capability systems do not prevent information flow through side channels.
- **Correct capability assignment.** The system ensures capabilities are enforced, not that the orchestrator assigns the right ones. A misconfigured risk tier is still possible.
- **Model-level attacks.** Prompt injection happens at the LLM layer, before capability enforcement. The capability system limits what a compromised agent can DO, but cannot prevent the compromise itself.
- **Physical access.** If someone has physical access to the ESP32 or phone, they can extract keys. Hardware attestation (TPM) mitigates but does not eliminate this.

### 9.3 Defense in Depth

Capabilities are one layer. The full defense stack:

```
Layer 1: Model safety      -- prompt hardening, output filtering, guardrails
Layer 2: Capability system -- this document (what the agent CAN do)
Layer 3: Behavioral monitor -- anomaly detection on action patterns
Layer 4: Audit trail       -- immutable log of all capability exercises
Layer 5: User override     -- kill switch, real-time revocation
Layer 6: Network isolation -- device-level firewall rules (Tailscale ACLs)
Layer 7: Cryptographic     -- mTLS between devices, SPIFFE identity
```

---

## 10. Implementation Roadmap for Daemon

### Phase 1: Foundation (weeks 1-2)
- Implement `DaemonCapability` and `Caveat` data structures
- Implement HMAC-based token minting and verification
- Build filesystem enforcement point (path + operation checking)
- Hardcode risk tiers for existing daemon operations
- All existing daemon actions (chat, knowledge graph, device status) classified as Tier 0/1

### Phase 2: Device Capabilities (weeks 3-4)
- Build SSH enforcement point (host + command allowlist)
- Build sensor enforcement point (device + sensor + rate)
- Implement cross-device capability routing via WebSocket
- SPIFFE-lite: device attestation using Tailscale identity + process verification

### Phase 3: Delegation (weeks 5-6)
- Implement capability attenuation for sub-agents
- Build the orchestrator's capability planning (task -> required capabilities -> mint tokens)
- Implement delegation depth limits
- Test: sub-agent cannot escalate beyond parent's authority

### Phase 4: User Experience (weeks 7-8)
- Implement risk tier UI (silent/notify/confirm/challenge)
- Build standing grants ("always allow reads in ~/Documents")
- Build capability dashboard (what's active, what was used, revocation controls)
- Mobile (Android) approval flow for Tier 2+ requests

### Phase 5: Advanced (weeks 9-12)
- Context-dependent caveats (location, time, presence)
- Third-party caveats (external service discharge)
- Behavioral anomaly detection (Layer 3 defense)
- Revocation list with cross-device sync
- Circuit breaker automation

---

## 11. Key References

**Foundational:**
- Dennis, J.B. and Van Horn, E.C. "Programming Semantics for Multiprogrammed Computations." Communications of the ACM, 9(3):143-155, 1966.
- Miller, M.S. "Robust Composition: Towards a Unified Approach to Access Control and Concurrency Control." PhD thesis, Johns Hopkins University, 2006.
- Miller, M.S., Yee, K., and Shapiro, J. "Capability Myths Demolished." Technical Report SRL2003-02, Johns Hopkins University, 2003.
- Hardy, N. "The Confused Deputy (or why capabilities might have been invented)." ACM SIGOPS Operating Systems Review, 22(4):36-38, 1988.

**Systems:**
- Watson, R.N.M. et al. "Capsicum: Practical Capabilities for UNIX." USENIX Security Symposium, 2010.
- Birgisson, A. et al. "Macaroons: Cookies with Contextual Caveats for Decentralized Authorization in the Cloud." NDSS, 2014.
- CloudABI: https://github.com/NuxiNL/cloudabi
- Fuchsia Security: https://fuchsia.dev/fuchsia-src/concepts/principles/secure
- WASI Capabilities: https://docs.wasmtime.dev/security.html

**Identity and Zero Trust:**
- SPIFFE: https://spiffe.io/
- Cloud Security Alliance, "Agentic Trust Framework: Zero Trust Governance for AI Agents," February 2026.
- Microsoft, "Zero Trust for AI," March 2026.

**AI Agent Security:**
- OWASP AI Agent Security Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/AI_Agent_Security_Cheat_Sheet.html
- "Capabilities Are the Only Way to Secure Agent Delegation": https://niyikiza.com/posts/capability-delegation/
- Fly.io Macaroons: https://fly.io/blog/macaroons-escalated-quickly/
