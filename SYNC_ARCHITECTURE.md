# Daemon Sync Architecture
*v1 — 2026-04-01 — Arthur Camara*

**Core principle: Nothing is stored on the server. Everything lives on user devices. The server is ephemeral compute that routes and merges.**

---

## Table of Contents

1. [Design Decisions](#1-design-decisions)
2. [Data Model](#2-data-model)
3. [Sync Protocol](#3-sync-protocol)
4. [Conflict Resolution](#4-conflict-resolution)
5. [Encryption](#5-encryption)
6. [Device Lifecycle](#6-device-lifecycle)
7. [Storage Layer](#7-storage-layer)
8. [Transport](#8-transport)
9. [Implementation Plan](#9-implementation-plan)

---

## 1. Design Decisions

### Why not full CRDTs

CRDTs (Automerge, Yjs) are designed for real-time collaborative editing where multiple users modify the same document simultaneously. Daemon is single-user, multi-device. The user is only actively typing on ONE device at a time. Conflicts are rare and simple — two devices were offline and both drifted.

Full CRDTs add:
- 2-3x storage overhead for metadata (vector clocks per field, tombstones)
- Complex merge semantics that are overkill for key-value personality traits
- Library dependencies that don't work uniformly across Android/Web/ESP32/desktop

### What we actually use: Hybrid approach

| Data Type | Sync Strategy | Why |
|-----------|--------------|-----|
| Conversations | Append-only log + Lamport timestamps | Messages are never edited. Just append and sort. |
| Personality traits | LWW (Last-Write-Wins) per field + version vector | Traits change slowly via settling algorithm. LWW with device+timestamp is sufficient. |
| Knowledge graph | Operation log + periodic snapshot | Graph mutations (add entity, add fact, update) are recorded as ops. Replay to reconstruct. |
| User preferences | LWW per key | Simple config. Last device to change a setting wins. |
| Device inventory | Ephemeral, not synced | Each device knows its own USB/sensor state. Server aggregates live state via WebSocket. |
| Files/blobs | Content-addressed (SHA-256) + lazy pull | Don't push blobs. Advertise hashes. Pull on demand. |
| Memory (Qdrant vectors) | Export as structured JSON + operation log | Vectors aren't synced directly. The text+metadata that generated them is synced. Vectors are re-embedded on each device. |

### Why not Replicache/ElectricSQL/PowerSync

These all assume a persistent server database (Postgres) as the source of truth. Daemon has no server database. The server is a stateless relay. These tools solve the wrong problem for us.

### What we learn from Linear

Linear's sync engine is the closest model: client-side IndexedDB as the real database, server as ordering authority, delta sync via incremental sync IDs. We adapt this pattern but make the server truly ephemeral — it doesn't persist the sync ID sequence, devices do.

---

## 2. Data Model

### 2.1 The Daemon State Document

Every daemon's complete state is a single logical document with these top-level sections:

```
DaemonState {
  version: uint64            // Global version counter (Lamport clock)
  daemon_id: string          // Unique daemon identifier (derived from user account)

  identity: {
    name: string | null
    created_at: ISO8601
    soul_hash: SHA256        // Hash of SOUL.md template used
  }

  personality: {
    traits: Map<string, float>   // directness, humor, etc.
    interaction_count: uint64
    last_settled: ISO8601 | null
    memory_highlights: string[]
  }

  conversations: ConversationLog[]   // See 2.2
  knowledge: KnowledgeOpLog[]        // See 2.3
  preferences: Map<string, any>      // Simple key-value

  devices: {                         // NOT synced — assembled from live connections
    [device_id]: DeviceInfo
  }
}
```

### 2.2 Conversation Log

Conversations are the simplest data type — append-only, never edited.

```
ConversationMessage {
  id: string                  // {device_id}-{lamport_timestamp}-{random4}
  thread_id: string           // Groups messages into conversations
  role: "user" | "daemon"
  content: string
  timestamp: ISO8601          // Wall clock (for display)
  lamport: uint64             // Logical clock (for ordering)
  device_id: string           // Which device generated this
}
```

**Ordering rule:** Sort by `lamport` first, break ties by `device_id` (lexicographic). This gives a total order that all devices agree on without coordination.

**Why Lamport over wall clock:** Phones and laptops have different clock skew. A phone might be 30 seconds behind. Lamport timestamps increment monotonically and guarantee causal ordering — if message B was created after seeing message A, B's lamport > A's lamport.

### 2.3 Knowledge Operation Log

The knowledge graph (entities, facts, preferences, events) is too complex for simple LWW. Instead, we record mutations as an operation log:

```
KnowledgeOp {
  id: string                  // {device_id}-{lamport}
  op: "add_entity" | "update_entity" | "delete_entity"
     | "add_fact" | "update_fact" | "delete_fact"
     | "add_preference" | "add_event"
  collection: string          // "daemon_entities", "daemon_facts", etc.
  payload: any                // The entity/fact/preference/event data
  lamport: uint64
  device_id: string
  timestamp: ISO8601
}
```

**Reconstruction:** Any device can rebuild its knowledge graph by replaying the op log from the beginning. In practice, we checkpoint — take a full snapshot every N ops and only replay ops after the snapshot.

**Compaction:** After 1000 ops, create a snapshot, discard ops before the snapshot. All devices must have synced past the snapshot point before compaction (verified by version vectors).

### 2.4 Version Vector

Every device maintains a version vector — a map of `{device_id: last_seen_lamport}` for every device it knows about.

```
VersionVector {
  "pixel-8-pro": 4521,
  "msi-laptop": 4519,
  "arturito": 4520,
  "esp32-kitchen": 12     // ESP32 generates very few events
}
```

When device A wants to sync with device B:
1. A sends its version vector to B
2. B computes the diff: for each device_id, find ops where lamport > A's known value
3. B sends those ops to A
4. A applies them, updates its version vector

This is the standard version vector delta sync used by Riak, CouchDB, and cr-sqlite.

---

## 3. Sync Protocol

### 3.1 Transport: WebSocket with HTTP Fallback

```
Primary:   wss://my.daemon.page/sync    (persistent, bidirectional)
Fallback:  POST my.daemon.page/sync     (for constrained devices like ESP32)
```

The existing WebSocket server on port 4801 is extended. Currently it handles device registration and command routing. We add a `/sync` channel alongside `/ws/device`.

### 3.2 Sync Message Types

```typescript
// Device → Server (or Device → Device in P2P mode)
type SyncMessage =
  | { type: "sync_request", version_vector: VersionVector, device_id: string }
  | { type: "sync_push", ops: Operation[], version_vector: VersionVector }
  | { type: "sync_ack", version_vector: VersionVector }
  | { type: "full_state_request", device_id: string }  // New device joining

// Server → Device
  | { type: "sync_response", ops: Operation[], server_vv: VersionVector }
  | { type: "sync_notify", from_device: string, op_count: number }  // Push notification
  | { type: "full_state", encrypted_state: Uint8Array, from_device: string }
```

### 3.3 The Sync Flow

**Normal operation (device comes online):**

```
Phone                          Server                         Laptop
  |                              |                              |
  |--- sync_request {vv} ------>|                              |
  |                              |--- sync_notify ------------->|
  |                              |<-- sync_push {ops, vv} -----|
  |<-- sync_response {ops} -----|                              |
  |--- sync_ack {vv} ---------->|                              |
  |                              |--- sync_ack {vv} ---------->|
```

**Real-time (both devices online):**

```
Phone                          Server                         Laptop
  |                              |                              |
  |--- sync_push {ops} -------->|                              |
  |                              |--- sync_response {ops} ---->|
  |                              |<-- sync_ack {vv} -----------|
  |<-- sync_ack {vv} ----------|                              |
```

The server is a relay, not a database. It holds ops in memory for a short window (60 seconds) to batch and route. If the server restarts, devices detect the broken WebSocket, reconnect, and do a full version-vector exchange.

### 3.4 Server Container Restart Recovery

When the server container restarts:
1. All WebSocket connections drop
2. Devices detect disconnection, start exponential backoff reconnect (1s, 2s, 4s, 8s, max 60s)
3. First device to reconnect sends its full version vector
4. Server stores this in memory as the "known state"
5. Second device connects, sends its version vector
6. Server computes the diff between the two vectors and requests the missing ops from whichever device has them
7. Server relays ops to the other device

**The server never needs persistent storage.** It bootstraps its knowledge of the world from the first devices that connect.

### 3.5 Delta Sync vs Full State

| Scenario | Method |
|----------|--------|
| Normal reconnect | Delta: exchange version vectors, send missing ops |
| New device joining | Full state transfer from the most up-to-date device |
| Server restart | Delta: devices re-exchange version vectors |
| Corrupted local DB | Full state transfer from another device |
| ESP32 (constrained) | Personality snapshot only — no conversation history |

---

## 4. Conflict Resolution

### 4.1 Per-Data-Type Resolution

**Conversations (append-only):**
No conflicts possible. Messages from different devices are interleaved by Lamport timestamp. Two messages with the same Lamport get ordered by device_id. Deterministic, identical on all devices.

**Personality traits (LWW per field):**
Each trait carries `{value, lamport, device_id}`. When two devices both run settling independently:

```
Device A settled at lamport 100: directness = 0.65
Device B settled at lamport 102: directness = 0.60
→ Device B wins (higher lamport)
```

If both settle at the same lamport (extremely unlikely but possible):
- Higher device_id wins (deterministic tiebreaker)
- The delta is tiny (max 0.05 per settling cycle) so either value is acceptable

**Knowledge ops:**
Operations are commutative for adds — adding the same entity twice is idempotent (same content hash = same point ID in Qdrant). For updates, LWW per field. For deletes, a tombstone with lamport timestamp — delete wins over concurrent add only if delete's lamport is higher.

**Preferences:**
Pure LWW. The last device to change a preference wins. For things like "dark mode" or "response length", this is the right behavior — the user's most recent action should stick.

### 4.2 The Two-Offline-Devices Scenario

This is the hard case. Phone and laptop are both offline. User chats on phone. Settling runs on laptop. Both come online.

```
Phone (offline for 2 hours):
  - 15 new conversation messages (lamport 500-514)
  - interaction_count: 250

Laptop (offline for 2 hours):
  - Settling ran at interaction 240 (lamport 498)
  - Traits adjusted: directness 0.55 → 0.60
  - 3 new conversation messages (lamport 499-501)
```

Resolution:
1. **Conversations:** All 18 messages merge by lamport. Phone's 500-514 and laptop's 499-501 interleave correctly. Lamport 499 (laptop) comes before 500 (phone) — causal order preserved because both clocks were advancing independently.

2. **Personality:** Phone's interaction_count 250 > laptop's implicit 240. Phone wins for interaction_count. Laptop's trait changes at lamport 498 are older than phone's state at 514, but since traits are LWW per field and phone didn't change traits, laptop's settling results are kept. No conflict.

3. **Knowledge:** Both devices may have stored new conversation memories. Since IDs are content-hash-based, duplicate memories are automatically deduplicated.

### 4.3 What about the settling algorithm running on two devices?

Settling runs every 20 interactions. If phone reaches interaction 240 and laptop also reaches 240 (from different conversations), both will run settling on their local conversation history. They'll produce slightly different trait adjustments because they have different recent message windows.

**Resolution:** The settling results are just trait updates with lamport timestamps. Higher lamport wins per trait. The device that settled later (or had a higher lamport at the time) wins. The difference is at most 0.05 per trait per cycle — negligible.

**Optimization:** After merging, the receiving device checks if the merged conversation history would produce different settling results and re-runs settling if needed. This is cheap (one Haiku call).

---

## 5. Encryption

### 5.1 Threat Model

- **Server is untrusted relay.** It routes encrypted blobs. It cannot read conversations, personality, or knowledge.
- **Network is untrusted.** TLS for transport, E2E encryption for data at rest on server.
- **Device compromise:** If one device is compromised, attacker gets that device's data. Other devices are not retroactively compromised (forward secrecy per device is out of scope for v1 — too complex for the benefit).

### 5.2 Key Architecture

```
User Account
  └── Master Key (derived from password via Argon2id, 256-bit)
       ├── Daemon Encryption Key (HKDF-derived, for encrypting daemon state)
       ├── Device Auth Key (HKDF-derived, for authenticating devices)
       └── Per-Device Keys (wrapped by Master Key)
            ├── Phone Key (X25519 keypair)
            ├── Laptop Key (X25519 keypair)
            └── ESP32 Key (X25519 keypair)
```

**Master Key derivation:**
```
master_key = Argon2id(password, salt=SHA256(email), iterations=3, memory=64MB, parallelism=1)
```

The Master Key never leaves a device. It's derived from the user's password on each device independently.

### 5.3 Encryption of Synced Data

All sync messages are encrypted with the Daemon Encryption Key using AES-256-GCM:

```
encrypted_payload = AES-256-GCM(
  key = daemon_encryption_key,
  nonce = random_96bit,
  plaintext = CBOR(sync_message),
  aad = device_id + lamport_timestamp   // Authenticated additional data
)
```

**Why CBOR over JSON:** Sync payloads are binary-heavy (ops, version vectors). CBOR is 30-40% smaller than JSON and faster to parse on constrained devices (ESP32).

**Why AES-GCM over ChaCha20:** AES-NI hardware acceleration is available on all target platforms (ARM phones, x86 laptops). ESP32-S3 has AES hardware too.

### 5.4 Device Linking

When a new device joins:

1. User logs in on the new device (email + password)
2. New device derives Master Key from password
3. New device generates its own X25519 keypair
4. New device sends a `device_link_request` through the server:
   ```
   { type: "device_link_request",
     device_id: "new-phone",
     public_key: X25519_public,
     proof: HMAC-SHA256(device_auth_key, device_id + timestamp) }
   ```
5. An existing device receives the request and shows a confirmation prompt
6. User approves on the existing device
7. Existing device sends the encrypted daemon state to the new device:
   ```
   { type: "full_state",
     encrypted_state: AES-256-GCM(daemon_encryption_key, full_state),
     from_device: "existing-laptop" }
   ```
8. New device decrypts with its independently-derived daemon_encryption_key
9. New device is now a full peer in the sync mesh

**No additional key exchange needed** because both devices derive the same daemon_encryption_key from the same password. The X25519 keypairs are for optional per-device encryption in future (v2).

### 5.5 What if the User Loses All Devices

The Master Key is derived from the password. If the user remembers their password and creates a new account on a new device, they can derive the same keys. But the data is gone — it was only on the lost devices.

**Recovery option (v2):** Encrypted backup to user-chosen cloud (iCloud, Google Drive, a USB stick). The backup is encrypted with the daemon_encryption_key. The server never has the key. The user can restore from backup on a new device.

**Recovery option (v3):** Social recovery — the user designates 3 trusted contacts. Each holds a Shamir Secret Sharing shard of the Master Key. Any 2 of 3 can reconstruct it.

---

## 6. Device Lifecycle

### 6.1 New Device Joins

```
┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│  New Device  │    │   Server    │    │Existing Dev. │
└──────┬──────┘    └──────┬──────┘    └──────┬──────┘
       │                   │                   │
       │── login ─────────>│                   │
       │<─ auth token ─────│                   │
       │                   │                   │
       │── device_link ───>│── link_request ──>│
       │                   │                   │
       │                   │      [user approves on existing device]
       │                   │                   │
       │                   │<─ full_state ─────│
       │<─ full_state ─────│                   │
       │                   │                   │
       │── sync_request ──>│                   │
       │   (normal sync)   │                   │
```

**Time to first sync:** ~2-5 seconds for a typical daemon state (personality + recent conversations + knowledge snapshot). Under 500KB for most users.

### 6.2 Device Goes Offline

Nothing happens. The device continues to work locally. Conversations are stored locally. When it comes back online, delta sync catches it up.

### 6.3 Device Leaves (Deregistered)

User removes a device from their account:
1. Other devices are notified via `device_removed` message
2. All devices update their version vectors to stop expecting ops from the removed device
3. The removed device's local data is not wiped remotely (can't force-wipe — the device might be offline). If the user wants to wipe, they do it locally.

### 6.4 ESP32 and Constrained Devices

The ESP32 is a special case — 520KB RAM, no persistent filesystem (or very limited flash).

**What it syncs:**
- Daemon name (for display)
- Current personality traits (for behavior tuning)
- Device inventory (for sensor display)
- Nothing else. No conversation history, no knowledge graph.

**How it syncs:**
- HTTP POST to `/sync/constrained` with a 200-byte JSON payload
- Receives a 500-byte JSON response with current state
- Polls every 30 seconds (not WebSocket — too much RAM overhead)

```
POST /sync/constrained
{ "device_id": "esp32-kitchen", "traits_version": 42 }

Response:
{ "name": "Luna", "traits": { "directness": 0.65, ... }, "traits_version": 45 }
```

---

## 7. Storage Layer

### 7.1 Per-Platform Storage

| Platform | Primary Store | Sync Metadata | Capacity |
|----------|--------------|---------------|----------|
| Android (Kotlin) | SQLite (Room) | SQLite table `sync_ops` | 1GB+ |
| Web (Next.js) | IndexedDB (via Dexie.js) | IndexedDB `sync_ops` store | 100MB-1GB (browser dependent) |
| Desktop (future) | SQLite | SQLite table `sync_ops` | Unlimited |
| ESP32 | SPIFFS/LittleFS flash | None (stateless fetch) | 4MB |
| Server | In-memory only | None (relay) | 0 (ephemeral) |

### 7.2 SQLite Schema (Android + Desktop)

```sql
-- Conversation messages
CREATE TABLE messages (
    id TEXT PRIMARY KEY,           -- {device_id}-{lamport}-{rand4}
    thread_id TEXT NOT NULL,
    role TEXT NOT NULL,             -- 'user' or 'daemon'
    content TEXT NOT NULL,
    timestamp TEXT NOT NULL,        -- ISO8601
    lamport INTEGER NOT NULL,
    device_id TEXT NOT NULL,
    synced INTEGER DEFAULT 0       -- 0=local only, 1=synced to server
);
CREATE INDEX idx_messages_thread ON messages(thread_id, lamport);
CREATE INDEX idx_messages_unsynced ON messages(synced) WHERE synced = 0;

-- Personality state
CREATE TABLE personality (
    key TEXT PRIMARY KEY,           -- 'name', 'directness', 'humor', etc.
    value TEXT NOT NULL,            -- JSON-encoded value
    lamport INTEGER NOT NULL,
    device_id TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

-- Knowledge operations log
CREATE TABLE knowledge_ops (
    id TEXT PRIMARY KEY,
    op TEXT NOT NULL,                -- 'add_entity', 'update_fact', etc.
    collection TEXT NOT NULL,
    payload TEXT NOT NULL,           -- JSON
    lamport INTEGER NOT NULL,
    device_id TEXT NOT NULL,
    timestamp TEXT NOT NULL
);
CREATE INDEX idx_knowledge_ops_lamport ON knowledge_ops(lamport);

-- Sync metadata
CREATE TABLE sync_state (
    device_id TEXT PRIMARY KEY,
    last_lamport INTEGER NOT NULL,
    last_sync TEXT NOT NULL          -- ISO8601
);

-- Pending outbound ops (not yet confirmed by server)
CREATE TABLE outbox (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    op_type TEXT NOT NULL,           -- 'message', 'personality', 'knowledge'
    payload TEXT NOT NULL,           -- JSON
    created_at TEXT NOT NULL,
    attempts INTEGER DEFAULT 0
);
```

### 7.3 IndexedDB Schema (Web)

```typescript
// Using Dexie.js for IndexedDB wrapper
const db = new Dexie('daemon');
db.version(1).stores({
  messages: 'id, thread_id, lamport, synced',
  personality: 'key, lamport',
  knowledge_ops: 'id, lamport, collection',
  sync_state: 'device_id',
  outbox: '++id, op_type',
});
```

### 7.4 Knowledge Graph Reconstruction

Qdrant (vector DB) runs on each device that needs semantic search (Android, Desktop). It does NOT sync. Instead:

1. The `knowledge_ops` table syncs across devices (lightweight text + metadata)
2. On each device, a background job replays `knowledge_ops` to populate local Qdrant
3. Embeddings are generated locally using the device's Gemini API key
4. This means each device has its own vector index but the underlying data is identical

**Why not sync vectors directly:** Embedding vectors are 3072 floats (12KB each). Syncing hundreds of vectors over mobile data is wasteful. The text that generates them is a few KB total. Re-embedding is cheap (~$0.001 per 1000 texts with Gemini).

---

## 8. Transport

### 8.1 WebSocket Protocol Extension

The existing `ws-server.js` on port 4801 is extended with sync capabilities:

```javascript
// New message types added to the existing WebSocket server
switch (msg.type) {
  // Existing types
  case 'device_register': ...
  case 'command_response': ...
  case 'heartbeat': ...

  // New sync types
  case 'sync_request':
    // Device sends version vector, wants missing ops
    handleSyncRequest(ws, deviceId, msg.version_vector);
    break;

  case 'sync_push':
    // Device pushing new ops to server for relay
    handleSyncPush(ws, deviceId, msg.ops, msg.version_vector);
    break;

  case 'sync_ack':
    // Device acknowledging received ops
    handleSyncAck(ws, deviceId, msg.version_vector);
    break;

  case 'full_state_request':
    // New device wants full state from any peer
    relayFullStateRequest(ws, deviceId);
    break;

  case 'full_state':
    // Existing device sending full state to new device
    relayFullState(ws, msg.target_device, msg.encrypted_state);
    break;

  case 'device_link_request':
    // New device wants to join the mesh
    handleDeviceLinkRequest(ws, deviceId, msg);
    break;
}
```

### 8.2 Server-Side In-Memory Buffer

The server holds a short-lived buffer of recent ops to relay between devices:

```javascript
// In-memory sync state (lost on restart — that's fine)
const syncBuffer = new Map();  // device_id → { version_vector, pending_ops[] }
const OP_BUFFER_TTL = 60_000;  // 60 seconds — ops older than this are dropped

// Server doesn't persist anything. If it restarts, devices re-sync
// their version vectors and the server rebuilds its routing knowledge.
```

### 8.3 Bandwidth Budget

| Data Type | Typical Size | Sync Frequency | Monthly (1 device) |
|-----------|-------------|----------------|---------------------|
| Conversation message | 200 bytes (CBOR) | ~50/day | 300 KB |
| Personality update | 100 bytes | ~1/day | 3 KB |
| Knowledge op | 300 bytes | ~10/day | 90 KB |
| Preference change | 50 bytes | ~1/week | 1 KB |
| Sync overhead (VV, ack) | 50 bytes/msg | ~100/day | 150 KB |
| **Total** | | | **~550 KB/month** |

This is negligible. Even on metered mobile data, syncing the daemon costs less than loading a single web page.

### 8.4 P2P Mode (Future, v2)

When devices are on the same local network (detected via mDNS/Bonjour), they sync directly without the server:

```
Phone ←──── WiFi LAN ────→ Laptop
         (mDNS discovery)
         (direct WebSocket)
```

This is useful when the server is down or for faster sync. Same protocol, just no relay.

---

## 9. Implementation Plan

### Phase 1: Foundation (Week 1-2)

**Goal:** Conversations sync between web and Android.

1. **Add Lamport clock to the server orchestrator** (`daemon.py`)
   - Every message gets a lamport timestamp
   - Store lamport in conversation_history.json (migration from current format)

2. **Add sync tables to web** (IndexedDB via Dexie.js)
   - Messages table with lamport, device_id, synced flag
   - Outbox for pending ops

3. **Extend ws-server.js** with `sync_request`, `sync_push`, `sync_ack`
   - In-memory op buffer (60s TTL)
   - Version vector tracking per connected device

4. **Add sync client to Android app**
   - Room database with messages table
   - Background sync service (WorkManager)
   - WebSocket connection to sync channel

5. **Test:** Send message on web, see it appear on Android, and vice versa.

### Phase 2: Personality + Knowledge (Week 3-4)

**Goal:** Full daemon state syncs. Personality settling works across devices.

1. **Migrate personality.json to SQLite** (or keep JSON but add version vectors)
2. **Add knowledge_ops table and operation logging** to knowledge.py
3. **Implement knowledge graph reconstruction** from op log
4. **Add settling conflict resolution** (LWW per trait)
5. **Test:** Settle on phone, see traits update on laptop.

### Phase 3: Encryption (Week 5-6)

**Goal:** Server cannot read synced data.

1. **Implement Argon2id key derivation** in both web (using `argon2-browser`) and Android (`BouncyCastle`)
2. **Add AES-256-GCM encryption** to all sync payloads
3. **Implement device linking flow** with approval prompt
4. **Add CBOR serialization** (replacing JSON for sync payloads)
5. **Test:** Inspect server logs — all payloads are opaque blobs.

### Phase 4: Robustness (Week 7-8)

**Goal:** Handle all edge cases.

1. **Server restart recovery** — devices reconnect and re-exchange version vectors
2. **Offline-then-online merge** — two devices offline, both generate data, both come online
3. **Knowledge graph compaction** — snapshot + prune old ops
4. **ESP32 constrained sync** — HTTP poll endpoint
5. **Bandwidth monitoring** — track sync bytes per device
6. **Test:** Kill server, let two devices drift, restart server, verify convergence.

### Future (v2+)

- P2P sync via mDNS
- Encrypted cloud backup (user-chosen provider)
- Social recovery (Shamir Secret Sharing)
- Per-device encryption (X25519 key exchange)
- Selective sync (phone gets only recent conversations, desktop gets everything)
- Sync compression (zstd on CBOR payloads — useful when history grows large)

---

## Appendix A: Why Not These Alternatives

| Technology | Why Not |
|------------|---------|
| **Automerge** | Great for collaborative docs, overkill for single-user. 2.5x storage overhead. No Kotlin/Android native. |
| **Yjs** | Optimized for text editing. Daemon conversations are append-only, not collaboratively edited. |
| **cr-sqlite** | Promising but 2.5x slower inserts, still experimental. SQLite extension loading is tricky on Android. |
| **CouchDB/PouchDB** | Full database replication is heavy. We need to sync specific data types with different strategies. |
| **Firebase Realtime DB** | Vendor lock-in. Server stores data. Violates "nothing on the server" principle. |
| **Replicache** | Requires server-side push/pull/poke endpoints with persistent state. Our server is ephemeral. |
| **ElectricSQL** | Read-path only. Requires Postgres. |
| **PowerSync** | Closest fit but still assumes a persistent server DB. Commercial product with pricing. |
| **Gun.js** | P2P-first is appealing but unreliable in practice. NAT traversal issues. Data durability concerns. |

## Appendix B: Message Wire Format (CBOR)

```
Sync push message (encrypted):
┌──────────────────────────────────────────────┐
│ Header (4 bytes)                              │
│   version: u8 = 1                             │
│   type: u8 = 0x02 (sync_push)                │
│   payload_len: u16 (big-endian)               │
├──────────────────────────────────────────────┤
│ Nonce (12 bytes, random)                      │
├──────────────────────────────────────────────┤
│ Encrypted CBOR payload (variable)             │
│   ┌────────────────────────────────────────┐ │
│   │ ops: [KnowledgeOp | Message | ...]     │ │
│   │ version_vector: { device_id: lamport } │ │
│   │ device_id: string                      │ │
│   └────────────────────────────────────────┘ │
├──────────────────────────────────────────────┤
│ AES-GCM Auth Tag (16 bytes)                   │
└──────────────────────────────────────────────┘

Total overhead per message: 32 bytes (header + nonce + tag)
```

## Appendix C: Existing Code Mapping

| Current File | Sync Role | Changes Needed |
|-------------|-----------|----------------|
| `server/personality.py` | Personality state producer | Add lamport to trait updates, emit ops to outbox |
| `server/memory.py` | Knowledge producer (Qdrant) | Add op logging before Qdrant upsert |
| `server/knowledge.py` | Knowledge producer (structured) | Add op logging, support replay from op log |
| `server/daemon.py` | Orchestrator | Increment Lamport clock, tag messages with device_id |
| `server/users.py` | Auth (server-side) | Add device registry table, device linking |
| `web/ws-server.js` | Relay | Add sync message handlers, in-memory buffer |
| `web/src/` (chat UI) | Consumer | Add IndexedDB storage, sync client, offline queue |
| `android/` (chat) | Consumer | Add Room DB, sync service, WorkManager |
| `config/personality.json` | State file | Migrate to SQLite or add version metadata |
| `config/conversation_history.json` | Message log | Migrate to SQLite with lamport + device_id |
