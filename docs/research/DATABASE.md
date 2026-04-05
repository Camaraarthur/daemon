# Database Architecture Research — Daemon Platform

**Date:** 2026-04-05
**Context:** Multi-device AI agent platform. Currently SQLite (25 MB, 19K messages, 3 users) + Qdrant Docker (942 MB vector data). Needs to scale to multi-user, real-time chat, semantic search, billing, and data sovereignty.

---

## Table of Contents

1. [Current State](#1-current-state)
2. [Relational Databases](#2-relational-databases)
3. [Vector Databases](#3-vector-databases)
4. [Embedding Models](#4-embedding-models)
5. [Data Sovereignty Architecture](#5-data-sovereignty-architecture)
6. [Backup and Replication](#6-backup-and-replication)
7. [Data Portability](#7-data-portability)
8. [Recommendations](#8-recommendations)

---

## 1. Current State

### SQLite (`users.db` — 25 MB)

| Table | Rows | Purpose |
|-------|------|---------|
| `chat_messages` | 19,060 | Conversation content (role, content, tool_calls, model) |
| `conversation_memory` | 315 | TLDRs, key decisions, facts per thread |
| `projects` | 17 | Project metadata (paths, git, domains) |
| `users` | 3 | Accounts (email, password_hash, daemon_name) |
| `subscriptions` | — | Stripe/Coinbase billing, credits |
| `usage_log` | 0 | Token usage tracking per model |
| `device_tokens` | 0 | Multi-device auth tokens |
| `chat_threads` | — | Thread metadata (title, branch, project) |

Schema uses `sqlite3` directly (no ORM). No WAL mode configured explicitly. Single-file, single-writer.

### Qdrant (Docker, 942 MB on disk)

Stores vector embeddings of conversation memories and knowledge. Used by `memory_search.py` for semantic search and `embed_conversations.py` for ingestion. Currently using Gemini embeddings.

### Pain Points

- No concurrent write support (single writer)
- No replication (daily backup to same disk)
- Qdrant Docker adds operational overhead
- No encryption at rest for user data
- SQLite file must live on same machine as server

---

## 2. Relational Databases

### 2.1 SQLite (Current)

**When it works:** Single-server, low-to-moderate write load, simple deployments.

| Metric | Value |
|--------|-------|
| Read latency | ~0.01 ms (local PK lookup) |
| Write throughput (WAL) | 10K–50K writes/sec on NVMe |
| Write throughput (BEGIN CONCURRENT) | 5K–20K writes/sec (experimental, not mainline) |
| Concurrent writers | **1** (fundamental limitation) |
| Concurrent readers | Unlimited (WAL mode) |
| RAM usage | Minimal (~10–50 MB typical) |
| Operational complexity | **1/5** |
| Cost | $0 |

**When SQLite breaks:**
- Multiple server processes writing simultaneously (SQLITE_BUSY errors)
- Need for row-level security or per-user access control
- Horizontal scaling across multiple servers
- Real-time replication to standby nodes
- More than a few hundred concurrent write transactions/sec from different processes

**WAL mode details:** Writes go to a sequential WAL file instead of random pages in the main DB. This gives ~2x write performance over rollback journal. Setting `wal_autocheckpoint=1000` yields ~12% improvement (11,800 vs 10,548 inserts/sec). But there is still only ONE writer at any moment — all writes are serialized.

**Verdict for Daemon:** SQLite is fine at current scale (3 users, 19K messages). It will start to strain at ~50–100 concurrent users doing real-time chat, especially if multiple API responses are writing simultaneously. The single-writer lock becomes the bottleneck.

### 2.2 PostgreSQL

**The obvious upgrade path. Industry standard for this exact use case.**

| Metric | Value |
|--------|-------|
| Read latency | ~1–3 ms (same region) |
| Write throughput | 10K–100K+ writes/sec (depends on hardware) |
| Concurrent writers | Thousands (MVCC) |
| RAM usage | 256 MB minimum, 1–4 GB typical |
| Operational complexity | **3/5** (self-hosted) or **2/5** (managed) |
| Cost (self-hosted) | $0 (software) + server costs |
| Cost (Neon free) | $0 (0.5 GB storage, 100 CU-hours/month) |
| Cost (Neon Launch) | $19/month (10 GB storage) |
| Cost (Supabase free) | $0 (500 MB, 50K monthly active users) |
| Cost (Supabase Pro) | $25/month (8 GB storage) |

**Key advantages over SQLite:**
- True MVCC — thousands of concurrent readers AND writers
- Row-level security (RLS) — per-user data isolation at the DB level
- JSONB — native JSON storage with indexing (perfect for `settings`, `tool_calls`)
- pgvector — vector search in the same database (eliminates Qdrant)
- Streaming replication, point-in-time recovery
- Full-text search built in
- Extensions ecosystem (pg_cron, pg_stat_statements, etc.)

**PostgreSQL 18 (2026):** Asynchronous I/O improvements, refined vector indexing support, solidifying its position as the AI application database.

**Migration path:** `pgloader` handles SQLite-to-Postgres in a single command. It auto-discovers schema, maps types (TEXT→TEXT, INTEGER→INTEGER, REAL→DOUBLE PRECISION), and streams data via COPY protocol. For 25 MB of data, migration takes seconds.

### 2.3 MySQL/MariaDB

| Metric | Value |
|--------|-------|
| Write throughput | Comparable to PostgreSQL |
| Vector support | MySQL 9 adds VECTOR type (up to 16,383 dims) — immature vs pgvector |
| Operational complexity | **3/5** |

**Verdict:** No advantage over PostgreSQL for this use case. MySQL 9's vector support is nascent. No equivalent to pgvector's HNSW/IVFFlat indexes. The AI ecosystem has standardized on PostgreSQL — new projects choose Postgres 3:1 over MySQL in 2026. **Skip.**

### 2.4 CockroachDB / PlanetScale (Distributed SQL)

| Metric | CockroachDB | PlanetScale |
|--------|-------------|-------------|
| Architecture | Distributed, strongly consistent | MySQL-compatible, sharded |
| Latency | Higher for single-region (consensus overhead) | Comparable to MySQL |
| Operational complexity | **4/5** | **3/5** |
| Cost | $0 (free tier, 10 GiB) | ~$39/month starter |
| Best for | Global distribution, "always on" | MySQL shops needing scale |

**Verdict:** Massive overkill for Daemon's scale. Distributed SQL adds latency (consensus rounds), operational complexity, and cost — all for problems Daemon doesn't have yet. A single PostgreSQL instance handles millions of messages. Revisit only if Daemon needs multi-region deployment with strong consistency guarantees (unlikely before thousands of users). **Skip for now.**

### 2.5 Turso (libSQL)

**The "SQLite but better" option. Open-source fork with replication.**

| Metric | Value |
|--------|-------|
| Architecture | Primary-follower, WAL streaming |
| Read latency | Single-digit ms (local replica) |
| Write throughput | 1K–5K writes/sec (network-bound to primary) |
| Concurrent writes | Supports BEGIN CONCURRENT (MVCC) |
| Operational complexity | **2/5** |
| Cost (free) | 500 databases, 9 GB storage, 1B row reads/month |
| Cost (Scaler) | $29/month (unlimited databases, 24 GB) |

**Key features:**
- Embedded replicas — local SQLite file syncs from primary server
- Full SQLite API compatibility — zero code changes for reads
- Native vector search built into libSQL
- Edge deployment possible (replica per device)

**Pros:** Minimal migration (it IS SQLite), replication built in, embedded replicas mean offline-capable clients, concurrent write support.

**Cons:** Write throughput limited by network to primary (~1K–5K/sec vs Postgres 10K–100K+). Younger ecosystem. No row-level security. Fewer extensions than PostgreSQL. Vector search less mature than pgvector.

**Verdict:** Compelling middle ground if you want to stay in the SQLite world. Best for edge/offline-first architectures where each device has a local replica. However, PostgreSQL still wins for a server-centric platform that needs RLS, pgvector, and battle-tested tooling.

---

## 3. Vector Databases

### Current: Qdrant (Docker, 942 MB)

| Metric | Value |
|--------|-------|
| RAM required | 8 GB recommended (can run with 100 MB using on_disk=True) |
| Latency | Sub-10 ms for small collections |
| Filtering | Pre-filter (metadata first, then vector search) — accurate |
| Operational complexity | **3/5** (Docker required for server mode) |
| Embedded mode | Yes — `QdrantClient(path="./data")`, no Docker needed |
| Cost | $0 (self-hosted) |

**Key insight:** Qdrant does NOT require Docker. It can run in embedded mode from Python directly, eliminating the Docker dependency entirely. This is the quick win.

### 3.1 pgvector (PostgreSQL Extension)

**Eliminates the need for a separate vector database entirely.**

| Metric | Value |
|--------|-------|
| RAM required | Shares PostgreSQL's memory (1–4 GB typical) |
| Latency | Sub-100 ms at 99% recall (50M vectors with pgvectorscale) |
| Throughput | 471 QPS at 50M vectors (pgvectorscale) — 11.4x better than Qdrant in benchmarks |
| Index types | IVFFlat, HNSW (pgvector), DiskANN (pgvectorscale) |
| Operational complexity | **2/5** (just a Postgres extension) |
| Cost | $0 (part of PostgreSQL) |
| Max dimensions | 2,000 (pgvector) or higher with pgvectorscale |

**Benchmark caveat:** The 11.4x throughput advantage was with pgvectorscale's DiskANN index at 50M vectors. At smaller scales (< 5M vectors), pgvector with HNSW matches Qdrant's latency exactly. For Daemon's ~315 memory vectors + future growth to maybe 100K, pgvector is more than sufficient.

**The big advantage:** One database for everything. Conversations, users, billing, AND vector search. Single backup, single connection pool, transactional consistency between relational and vector data. No Docker, no separate service.

### 3.2 Chroma

| Metric | Value |
|--------|-------|
| Architecture | Embedded (in-process) or client-server |
| RAM required | 4–8 GB |
| Operational complexity | **1/5** |
| Cost | $0 (self-hosted) |
| Best for | Prototyping, simple RAG |

Rewrote in Rust in 2025 (4x faster). Simple API. But adds another dependency when pgvector can do the same job inside PostgreSQL. No advantage over pgvector for a platform that already needs a relational database.

### 3.3 LanceDB

| Metric | Value |
|--------|-------|
| Architecture | Embedded, columnar (Lance format) |
| RAM required | Low (disk-efficient, handles larger-than-memory datasets) |
| Operational complexity | **1/5** |
| Cost | $0 (self-hosted), <$30/month managed |
| Best for | Large corpora, multi-modal data |

Already used in Arthur's `file-search` system. Excellent for local/embedded use. But same story — if Daemon moves to PostgreSQL, pgvector consolidates the stack.

### 3.4 Pinecone (Managed)

| Metric | Value |
|--------|-------|
| Latency | Sub-50 ms at billion scale |
| Operational complexity | **1/5** (fully managed) |
| Cost | $50/month minimum, $0.30/GB storage, $16/M read units |
| Best for | Teams without DevOps, rapid deployment |

Excellent product but expensive and proprietary. Data leaves your infrastructure. Antithetical to Daemon's data sovereignty goals. **Skip.**

### 3.5 Weaviate (Managed/Self-hosted)

| Metric | Value |
|--------|-------|
| RAM required | 16 GB+ (self-hosted) |
| Operational complexity | **4/5** (self-hosted) or **2/5** (managed) |
| Cost | $25/month minimum (managed) |
| Best for | Hybrid search, multi-modal |

Heavy for what Daemon needs. Native BM25 is nice but PostgreSQL has full-text search too. **Skip.**

### Vector Database Summary

| Database | RAM | Ops Complexity | Cost | Daemon Fit |
|----------|-----|----------------|------|-----------|
| **pgvector** | Shared w/ Postgres | 2/5 | $0 | **Best** — consolidates stack |
| Qdrant (embedded) | 100 MB–8 GB | 2/5 | $0 | Good — quick win, drop Docker |
| LanceDB | Low | 1/5 | $0 | Good — already familiar |
| Chroma | 4–8 GB | 1/5 | $0 | OK — no advantage over pgvector |
| Pinecone | Managed | 1/5 | $50+/mo | No — cost, data leaves infra |
| Weaviate | 16 GB+ | 4/5 | $25+/mo | No — too heavy |

---

## 4. Embedding Models

| Model | Dimensions | MTEB Score | Cost per 1M tokens | Notes |
|-------|-----------|------------|--------------------|-|
| **Gemini Embedding 2** | 3072 (MRL) | #1 on MTEB Multilingual (68.32) | Free tier generous | 5 modalities, 100+ languages, 32K context. Best overall. |
| Gemini embedding-001 | 768 | High | Free tier | Currently used in file-search. Solid. |
| OpenAI text-embedding-3-large | 3072 | Strong | $0.13/1M tokens | Good but not #1. 8K token context. |
| OpenAI text-embedding-3-small | 1536 | Good | $0.02/1M tokens | Budget option. |
| Voyage-3-large (int8, 512d) | 512 | Beats OpenAI 3072d by 1.16% | $0.06/1M tokens | Best cost/performance ratio. 200x less storage than OpenAI. |
| nomic-embed-text-v1.5 | 768 | Good (English only) | Free (open source) | Fully open: weights, training code, data. Self-hostable. |
| BAAI/bge-m3 | 1024 | Good multilingual | Free (open source) | Good open-source multilingual option. |

**Recommendation:** Stay with Gemini embeddings. Gemini Embedding 2 is #1 on MTEB, free tier is generous, and Daemon already uses Gemini. MRL (Matryoshka Representation Learning) lets you truncate dimensions for storage savings without re-embedding. Use 768d for storage efficiency or 3072d for max quality.

**Open-source fallback:** nomic-embed-text-v1.5 is fully open and self-hostable for data sovereignty purists, but English-only. BAAI/bge-m3 for multilingual.

---

## 5. Data Sovereignty Architecture

### The Problem

Daemon positions itself as a personal AI agent. Users will store intimate data — conversations, memories, notes, sensor data. The platform operator (Arthur) should not be able to access user data, even with database access.

### How Signal and ProtonMail Do It

**ProtonMail:**
- Body content and attachments are end-to-end encrypted (AES-256)
- Encryption keys derived from user's password (never sent to server)
- Server stores only encrypted blobs — Proton cannot decrypt
- Subject lines and metadata are encrypted but NOT end-to-end (Proton can read them)
- Legal requests yield only metadata, never plaintext content

**Signal:**
- All messages are end-to-end encrypted (Signal Protocol)
- Server stores essentially nothing — messages are deleted after delivery
- Legal requests: "We don't have your messages. Here's your registration date."

### Architecture Options for Daemon

#### Option A: Client-Side Encryption (ProtonMail Model)

```
User types message → Client encrypts with user's key → Server stores ciphertext
Server retrieves ciphertext → Client decrypts → User sees message
```

**Implementation:**
1. User's password derives a master key (Argon2id KDF)
2. Master key encrypts a randomly-generated data encryption key (DEK)
3. DEK encrypts all user content (messages, memories, notes)
4. Server stores: encrypted DEK (unlockable only with password), encrypted content
5. On login: password → master key → decrypt DEK → decrypt content

**What the server can see:** Metadata (timestamps, thread IDs, message counts, model used, token counts). Cannot see message content.

**What breaks:** Server-side search over content. The server cannot search encrypted text. Options:
- **Client-side search:** Download all encrypted messages to client, decrypt, search locally. Works for small datasets, terrible for 19K+ messages.
- **Searchable Symmetric Encryption (SSE):** Build encrypted indexes that allow keyword search without decryption. Academic research exists but practical implementations are immature and leak access patterns.
- **Homomorphic Encryption:** Compute on encrypted data. Still 1000x–1,000,000x slower than plaintext operations in 2026. Not practical for real-time search.
- **Bloom filter indexes:** Client builds bloom filters of keywords, sends to server. Server can check membership but not extract keywords. Fuzzy, limited.

#### Option B: Server-Side Encryption at Rest + Access Controls

```
User types message → Server encrypts at rest (AES-256) → Stored encrypted
Server decrypts for search/retrieval → Returns to client
```

**Implementation:** Per-user encryption keys managed by the server. Database encryption at rest (PostgreSQL TDE or filesystem-level encryption). Row-level security in PostgreSQL.

**What the server can see:** Everything (it holds the keys). But provides protection against database theft, disk compromise, backups leaking.

**What breaks:** Nothing functionally. But the operator CAN access user data. This is what most SaaS platforms do.

#### Option C: Hybrid — Encrypt Sensitive Content, Index Metadata

```
Message content → client-side encrypted → stored as blob
Message metadata (timestamp, role, model) → stored plaintext → searchable
Memory summaries → client-side encrypted
Search → client downloads + decrypts locally, or uses metadata-only server search
```

**The realistic middle ground.** Protects the most sensitive data (actual conversations) while allowing the server to do useful things with metadata.

#### Option D: Vault Model — User Holds Keys, Server is Dumb Storage

Each user gets a separate encrypted database file (SQLite + SQLCipher or age-encrypted). Server stores encrypted files. Client downloads, decrypts, operates locally, re-encrypts, uploads.

Works for offline-first/local-first apps. Terrible for real-time multi-device sync.

### Vector Embeddings and Encryption

**Critical problem:** Vector embeddings leak semantic information. An embedding of "I'm depressed" is close to embeddings of "mental health", "sadness", etc. Even if you encrypt the source text, the embeddings themselves reveal what the text is about.

**Options:**
- Encrypt embeddings too → can't do vector search server-side
- Generate embeddings client-side, search client-side → works but slow for large collections
- Accept that embeddings are a privacy trade-off → document this clearly
- Use per-user encryption for embeddings stored in Qdrant/pgvector → server can search within one user's space but operator could theoretically run queries

### Recommendation for Daemon

**Phase 1 (now):** Option B — server-side encryption at rest + PostgreSQL RLS. This is what every production platform does. RLS ensures User A cannot see User B's data even via SQL injection. Encrypt the database volume. This handles 99% of real-world threats.

**Phase 2 (when Daemon has paying users who care):** Option C — hybrid. Encrypt message content client-side. Keep metadata searchable server-side. Document the privacy model clearly. This is the ProtonMail approach adapted for AI.

**Phase 3 (if Daemon wants to be Signal-level):** Option A — full client-side encryption. Accept that server-side search is gone. Build thick clients that download and search locally. This is technically possible but fundamentally changes the architecture.

**Reality check:** Zero-knowledge architecture and semantic search are fundamentally at odds. You cannot do vector similarity search on data the server cannot read. Every AI platform (ChatGPT, Claude, etc.) stores user conversations in plaintext on the server. Daemon can be better than the baseline by doing Option B+C, but true zero-knowledge requires sacrificing server-side intelligence.

---

## 6. Backup and Replication

### Current State

- Daily backup: `users.db` → `users.db.bak.{date}` on the same disk
- Qdrant: no backup
- **Risk:** Single disk failure loses everything

### Options

#### 6.1 Litestream (SQLite → S3/R2)

| Metric | Value |
|--------|-------|
| Architecture | Background process, streams WAL pages to object storage |
| RPO (data loss window) | Seconds (continuous streaming) |
| Restore time | Minutes (reconstruct from WAL frames) |
| Storage backends | S3, R2, GCS, Azure Blob, SFTP |
| Operational complexity | **1/5** (single binary, simple config) |
| Cost | Free (software) + storage costs |

**How it works:** Litestream watches the WAL file and continuously copies new pages to the replica destination. On restore, it reconstructs the database from the base snapshot + WAL frames. Supports point-in-time recovery.

**LTX format (v0.5.0, Oct 2025):** Introduced compaction — hierarchical snapshots at 30-second, 5-minute windows. Reduces storage and speeds up restore.

**Best for:** If staying on SQLite. Set it up, point at R2, forget about it. Free with Cloudflare R2 (zero egress fees).

#### 6.2 PostgreSQL Backup Options

| Method | RPO | Complexity | Notes |
|--------|-----|-----------|-------|
| `pg_dump` (cron) | Hours | 1/5 | Simple SQL dump. Fine for small DBs. |
| `pg_basebackup` + WAL archiving | Seconds | 3/5 | Point-in-time recovery. Standard for production. |
| Streaming replication | Sub-second | 3/5 | Hot standby, automatic failover possible. |
| Managed (Neon/Supabase) | Automatic | 1/5 | Backups handled by provider. |

#### 6.3 Object Storage Pricing

For Daemon's data (~25 MB SQLite + 942 MB Qdrant = ~1 GB total, growing slowly):

| Provider | Storage/GB/month | Egress/GB | 1 GB/month cost | 100 GB/month cost |
|----------|-----------------|-----------|------------------|-------------------|
| **Cloudflare R2** | $0.015 | **$0** | $0.02 | $1.50 |
| **Backblaze B2** | $0.006 | $0.01 (free via CDN partners) | $0.01 | $0.60 |
| AWS S3 Standard | $0.023 | $0.09 | $0.11 | $11.30 |
| AWS S3 Glacier | $0.004 | $0.09 | $0.09 | $9.40 |

**Recommendation:** Cloudflare R2. Zero egress fees means you can restore without cost anxiety. Daemon already uses Cloudflare (tunnels, DNS). $0.02/month for current data.

### Backup Recommendation

**If staying on SQLite:** Add Litestream → Cloudflare R2 today. Takes 10 minutes to set up. Continuous replication, point-in-time recovery, costs pennies.

**If moving to PostgreSQL:** Use a managed provider (Neon or Supabase) that handles backups automatically. Or self-host with `pg_basebackup` + WAL archiving to R2.

**Either way:** Also back up Qdrant data to R2. Qdrant supports snapshots: `POST /collections/{name}/snapshots`.

---

## 7. Data Portability

### GDPR Requirements (Mandatory by August 2026)

Article 20 — Right to data portability: Users must be able to receive their personal data "in a structured, commonly used and machine-readable format" and transmit it to another controller.

### What Daemon Should Export

| Data Type | Format | Notes |
|-----------|--------|-------|
| Conversations | JSON (with metadata) | Thread → messages array. Include role, content, timestamps, model. |
| Conversation memories | JSON | TLDRs, key decisions, facts |
| User profile | JSON | Email, daemon name, settings, created_at |
| Projects | JSON | Name, paths, git info |
| Usage/billing | CSV or JSON | Token counts, costs, dates |
| Device tokens | JSON | Device names, platforms, last seen |
| Vector embeddings | **Do not export** | See below |

### Conversation Export Format

No universal standard exists yet. Follow ChatGPT's export format (de facto standard):

```json
{
  "user": {
    "email": "user@example.com",
    "daemon_name": "myDaemon",
    "created_at": "2026-01-15T10:00:00Z"
  },
  "conversations": [
    {
      "id": "thread_abc123",
      "title": "Project Architecture Discussion",
      "project": "daemon",
      "created_at": "2026-03-15T14:30:00Z",
      "messages": [
        {
          "role": "user",
          "content": "How should we structure the database?",
          "timestamp": "2026-03-15T14:30:00Z"
        },
        {
          "role": "assistant",
          "content": "Here are several options...",
          "model": "claude-opus-4",
          "timestamp": "2026-03-15T14:30:05Z"
        }
      ]
    }
  ],
  "memories": [...],
  "usage": [...],
  "exported_at": "2026-04-05T12:00:00Z",
  "format_version": "1.0"
}
```

### Can Users Take Their Vector Embeddings?

**Technically:** Yes, you can export the raw float arrays. But they're useless without the same embedding model to query against them. Embeddings from Gemini won't work with OpenAI's search, and vice versa.

**Practically:** Export the source text, not the embeddings. The new platform can re-embed with their own model. Embeddings are derived data, not primary data.

**GDPR interpretation:** Embeddings are likely "inferred data" and may not fall under the portability right. Export the source material.

### Implementation

Add a `/api/export` endpoint that:
1. Queries all user data from SQLite/Postgres
2. Formats as JSON (conversations) + CSV (usage)
3. Zips and returns as download
4. Logs the export request for compliance

---

## 8. Recommendations

### The Plan: Three Phases

#### Phase 1 — Quick Wins (This Week)

**Cost: $0 | Time: 2–4 hours**

1. **Enable SQLite WAL mode** — add `PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=1000;` to connection setup. Immediate 2x write performance improvement.

2. **Switch Qdrant to embedded mode** — replace Docker with `QdrantClient(path="./data/qdrant")`. Eliminates Docker dependency, reduces RAM usage, same performance. One-line change.

3. **Add Litestream → Cloudflare R2** — continuous backup of `users.db`. Install binary, add config, run as systemd service. Cost: ~$0.02/month.

4. **Add Qdrant snapshot cron** — daily snapshot to R2. Cost: ~$0.01/month.

#### Phase 2 — PostgreSQL Migration (When Reaching ~50 Users)

**Cost: $0–25/month | Time: 1–2 days**

1. **Migrate to PostgreSQL** — use `pgloader` for data, rewrite `sqlite3` calls to `asyncpg` or `psycopg`. The schema is simple enough that this is straightforward.

2. **Add pgvector** — move all Qdrant data into PostgreSQL. One database for everything. Eliminate Qdrant entirely.

3. **Enable Row-Level Security** — per-user data isolation at the database level. User A's queries physically cannot return User B's data.

4. **Hosting options:**
   - **Self-hosted on arturito** (free, full control, you manage backups)
   - **Neon free tier** (0.5 GB, auto-scaling, managed backups) — good for dev
   - **Supabase** ($25/month for Pro, includes auth, storage, realtime)
   - **Neon Launch** ($19/month, 10 GB, generous compute)

5. **Add data export endpoint** — `/api/export` returning JSON zip. GDPR compliance.

#### Phase 3 — Data Sovereignty (When Daemon Has Paying Privacy-Conscious Users)

**Cost: Engineering time | Time: 1–2 weeks**

1. **Client-side encryption for message content** — derive key from user password (Argon2id), encrypt message bodies before sending to server. Server stores ciphertext.

2. **Metadata stays searchable** — timestamps, thread structure, model used, token counts remain in plaintext for server-side functionality.

3. **Client-side vector search** — for encrypted content, search must happen on the client. Download encrypted embeddings, decrypt, search locally. Feasible for personal-scale data (< 100K vectors).

4. **Document the privacy model** — clearly state what the server can and cannot see. Transparency > marketing claims.

### Why PostgreSQL + pgvector (Not Turso, Not Stay on SQLite)

| Factor | SQLite | Turso | PostgreSQL + pgvector |
|--------|--------|-------|----------------------|
| Concurrent writers | 1 | Multiple (MVCC) | Thousands (MVCC) |
| Vector search | No (need Qdrant) | Built-in (basic) | pgvector (mature, benchmarked) |
| Row-level security | No | No | Yes (native) |
| Ecosystem/tooling | Minimal | Growing | Massive |
| Migration effort | N/A | Low | Medium |
| Managed options | Turso, D1 | Turso | Neon, Supabase, RDS, etc. |
| Max scale | Single server | Multi-region | Multi-region |
| Real-time features | No | No | LISTEN/NOTIFY, logical replication |

PostgreSQL is the industry standard for exactly this use case: multi-user, conversations + metadata + vectors + billing in one database. The migration is straightforward (pgloader + rewrite ~200 lines of sqlite3 calls). Every managed hosting provider supports it. The ecosystem is unmatched.

Turso is interesting but solves a different problem (edge/offline-first with SQLite compatibility). Daemon is server-centric — the server runs the AI models and MCP tools. Edge replicas don't help when the intelligence lives on the server.

### Architecture Diagram (Target State)

```
┌─────────────┐     ┌─────────────┐     ┌──────────────┐
│  Android    │     │  Web App    │     │  Watch/ESP32 │
│  (Kotlin)   │     │  (Next.js)  │     │  (Sensors)   │
└──────┬──────┘     └──────┬──────┘     └──────┬───────┘
       │                   │                    │
       └───────────┬───────┘────────────────────┘
                   │ HTTPS / WebSocket
                   ▼
          ┌────────────────┐
          │  Daemon Server │
          │  (Python)      │
          └────────┬───────┘
                   │
                   ▼
          ┌────────────────────────────┐
          │  PostgreSQL 18             │
          │  ┌──────────────────────┐  │
          │  │ Relational tables    │  │
          │  │ users, conversations,│  │
          │  │ billing, devices     │  │
          │  ├──────────────────────┤  │
          │  │ pgvector             │  │
          │  │ conversation_memory  │  │
          │  │ knowledge embeddings │  │
          │  ├──────────────────────┤  │
          │  │ Row-Level Security   │  │
          │  │ per-user isolation   │  │
          │  └──────────────────────┘  │
          └────────────┬───────────────┘
                       │ WAL streaming
                       ▼
              ┌──────────────────┐
              │  Cloudflare R2   │
              │  (backups)       │
              │  ~$0.02/month    │
              └──────────────────┘
```

---

## Sources

### SQLite & WAL Mode
- [SQLite Write-Ahead Logging](https://www.sqlite.org/wal.html)
- [Concurrent Write Transactions in SQLite](https://oldmoe.blog/2024/07/08/the-write-stuff-concurrent-write-transactions-in-sqlite/)
- [Turso Concurrent Writes](https://turso.tech/blog/beyond-the-single-writer-limitation-with-tursos-concurrent-writes)
- [SQLite Renaissance 2026](https://dev.to/pockit_tools/the-sqlite-renaissance-why-the-worlds-most-deployed-database-is-taking-over-production-in-2026-3jcc)
- [SQLite in Production Benchmark](https://shivekkhurana.com/blog/sqlite-in-production/)

### PostgreSQL & pgvector
- [pgvector vs Qdrant (Tiger Data)](https://www.tigerdata.com/blog/pgvector-vs-qdrant)
- [pgvector vs Qdrant 1M Benchmark](https://nirantk.com/writing/pgvector-vs-qdrant/)
- [PostgreSQL vs MySQL 2026](https://www.zignuts.com/blog/postsql-vs-mysql)
- [PostgreSQL Extensions Ecosystem 2026](https://www.javacodegeeks.com/2026/03/the-postgresql-extensions-ecosystemin-2026.html)
- [pgvector vs Qdrant (Encore)](https://encore.dev/articles/pgvector-vs-qdrant)

### Turso & libSQL
- [Turso](https://turso.tech/)
- [Distributed SQLite: libSQL and Turso 2026](https://dev.to/dataformathub/distributed-sqlite-why-libsql-and-turso-are-the-new-standard-in-2026-58fk)
- [SQLite vs Turso for Solo Developers](https://solodevstack.com/blog/sqlite-vs-turso-solo-developers)

### Vector Databases
- [Vector Database Comparison 2026 (4xxi)](https://4xxi.com/articles/vector-database-comparison/)
- [Best Vector Databases 2026 (Firecrawl)](https://www.firecrawl.dev/blog/best-vector-databases)
- [Best Vector Databases 2026 (Encore)](https://encore.dev/articles/best-vector-databases)
- [Pinecone vs Weaviate Cost Comparison](https://rahulkolekar.com/vector-db-pricing-comparison-pinecone-weaviate-2026/)
- [Qdrant Memory Consumption](https://qdrant.tech/articles/memory-consumption/)

### Embedding Models
- [Best Embedding Models 2026 (Openxcell)](https://www.openxcell.com/blog/best-embedding-models/)
- [Embedding Model Benchmark 2026](https://zc277584121.github.io/rag/2026/03/20/embedding-models-benchmark-2026.html)
- [Best Embedding Models for RAG 2026 (Milvus)](https://milvus.io/blog/choose-embedding-model-rag-2026.md)

### Data Sovereignty & Encryption
- [Proton Zero-Access Encryption](https://proton.me/security/zero-access-encryption)
- [Zero Knowledge Encryption Guide (Hivenet)](https://www.hivenet.com/post/zero-knowledge-encryption-the-ultimate-guide-to-unbreakable-data-security)
- [Zero-Knowledge Architecture (PrettyFluid)](https://www.prettyfluidtechnologies.com/why-we-built-on-zero-knowledge-architecture-and-why-its-no-longer-optional/)

### Backup & Storage
- [Litestream](https://litestream.io/)
- [Litestream v0.5.0](https://simonwillison.net/2025/Oct/3/litestream/)
- [Cloudflare R2 vs Backblaze B2](https://onidel.com/blog/cloudflare-r2-vs-backblaze-b2)
- [Cloudflare R2 vs S3 2026](https://algeriatech.news/object-storage-price-war-r2-s3-2026/)

### Migration
- [pgloader SQLite to PostgreSQL](https://pgloader.readthedocs.io/en/latest/ref/sqlite.html)
- [SQLite to PostgreSQL Migration Guide](https://www.nihardaily.com/93-how-to-convert-sqlite-to-postgresql-step-by-step-migration-guide-for-developers)

### GDPR & Data Portability
- [GDPR Compliant AI Chat 2026](https://blog.premai.io/gdpr-compliant-ai-chat-requirements-architecture-setup-2026/)
- [GDPR Compliant Chatbot Guide (Quickchat)](https://quickchat.ai/post/gdpr-compliant-chatbot-guide)

### Managed PostgreSQL
- [Neon Pricing](https://neon.com/pricing)
- [Neon Serverless Postgres Pricing 2026](https://vela.simplyblock.io/articles/neon-serverless-postgres-pricing-2026/)

### Distributed SQL
- [Serverless Databases 2025: Neon vs PlanetScale vs CockroachDB](https://markaicode.com/vs/serverless-databases-2025-neon-vs-planetscale-vs-cockroachdb-serverless/)
