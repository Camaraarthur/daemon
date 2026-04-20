/**
 * Device-side SQLite store using Node 22's node:sqlite builtin.
 * Zero native deps. Lives at ~/.daemon/store.db.
 *
 * Schema mirrors the relay's chat_messages so a message synced from the
 * relay slots in without translation. Other tables (memory_blocks,
 * project_facts, etc.) will be added in later steps as we move more
 * state to the device.
 *
 * The architecture v1 doc commits us to "no application content on the
 * relay" — this store is the destination. Step 7+ progressively moves
 * state from the relay's data/users.db to here.
 */

import { DatabaseSync } from 'node:sqlite'
import { existsSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { userInfo } from 'os'

const STORE_DIR = join(userInfo().homedir, '.daemon')
const STORE_PATH = join(STORE_DIR, 'store.db')

let _db = null

function ensureDir() {
  if (!existsSync(STORE_DIR)) mkdirSync(STORE_DIR, { recursive: true, mode: 0o700 })
}

export function getStore() {
  if (_db) return _db
  ensureDir()
  _db = new DatabaseSync(STORE_PATH)
  _db.exec('PRAGMA journal_mode = WAL')
  _db.exec('PRAGMA foreign_keys = ON')
  runMigrations(_db)
  return _db
}

export function closeStore() {
  if (_db) {
    try { _db.close() } catch {}
    _db = null
  }
}

// ── Migrations ────────────────────────────────────────────

function runMigrations(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS migrations (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      applied_at TEXT NOT NULL
    )
  `)

  const applied = new Set(
    db.prepare('SELECT name FROM migrations').all().map((r) => r.name),
  )

  const migrations = [
    [
      '001_chat_messages',
      `
      -- Mirrors the relay's chat_messages schema. Step 7+ replicates
      -- messages here from the relay; later steps reverse the direction
      -- so the device becomes authoritative.
      CREATE TABLE IF NOT EXISTS chat_messages (
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT,
        tool_calls TEXT,
        tool_call_id TEXT,
        model TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        source_session_id TEXT,
        complete INTEGER NOT NULL DEFAULT 1,
        -- Device-side sync metadata
        synced_from TEXT,           -- "relay" or a peer device id
        synced_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_msg_thread ON chat_messages(thread_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_msg_session ON chat_messages(thread_id, source_session_id);
      CREATE INDEX IF NOT EXISTS idx_msg_inflight ON chat_messages(thread_id, complete);
    `,
    ],
    [
      '002_chat_threads',
      `
      -- Lightweight thread metadata mirror so we can list threads locally
      -- without round-tripping to the relay.
      CREATE TABLE IF NOT EXISTS chat_threads (
        id TEXT PRIMARY KEY,
        project_id INTEGER,
        title TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        last_message_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_threads_project ON chat_threads(project_id);
    `,
    ],
    [
      '003_secrets',
      `
      -- Per-user encrypted secrets vault. Each row stores ONE secret
      -- (e.g. "openai_api_key") encrypted at rest with a key derived
      -- from the user's password (Argon2id) plus an optional OS keychain
      -- entry. The secrets are never written to disk in plaintext.
      --
      -- For v1 we use a simpler scheme: a master key file at
      -- ~/.daemon/master.key (chmod 600) generated at first run, and
      -- per-secret nonce + libsodium box (XChaCha20-Poly1305 via the
      -- 'sodium-native' lib if available, or AES-256-GCM via Node's
      -- built-in crypto otherwise).
      --
      -- Recovery: if master.key is lost, every secret is unrecoverable.
      -- Per the architecture critic finding M-6, v1.5 adds a BIP-39
      -- recovery phrase the user writes down at signup.
      CREATE TABLE IF NOT EXISTS secrets (
        name TEXT PRIMARY KEY,
        ciphertext TEXT NOT NULL,        -- base64
        nonce TEXT NOT NULL,             -- base64 (random per encryption)
        algo TEXT NOT NULL DEFAULT 'aes-256-gcm',
        category TEXT,                   -- 'api_key', 'token', 'password', 'env'
        description TEXT,                -- human-readable, never the secret value
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        last_used_at TEXT,
        use_count INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_secrets_category ON secrets(category);
    `,
    ],
    [
      '004_schedules',
      `
      -- Vision §3.3 — scheduler primitive. Recurring agent runs.
      --
      -- A row here = "every <cron>, fire <prompt> in <thread_id>". The
      -- daemon's tick loop (cli/scheduler.mjs) checks next_run_at every
      -- 30s, picks due rows, and POSTs the relay's /api/schedule/fire
      -- with the device_token + schedule name. The relay then runs the
      -- agent loop with the prompt as a fresh user message in the tagged
      -- thread; the result is gossiped back to chat_messages.
      --
      -- name is the user-facing handle ("morning_briefing"). It is the
      -- primary key inside the device's vault — the agent calls
      -- list_schedules / cancel_schedule by name.
      CREATE TABLE IF NOT EXISTS schedules (
        name TEXT PRIMARY KEY,
        cron TEXT NOT NULL,
        prompt TEXT NOT NULL,
        thread_id TEXT,                  -- destination chat thread
        project_id INTEGER,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        last_run_at TEXT,
        next_run_at TEXT NOT NULL,       -- pre-computed at insert/update
        run_count INTEGER NOT NULL DEFAULT 0,
        last_error TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_schedules_next ON schedules(enabled, next_run_at);
    `,
    ],
    [
      '005_fact_embeddings',
      `
      -- Step 16 — Gemini Embedding 2 vectors for project_facts.
      --
      -- Each row corresponds to a project_facts row by id. We store
      -- the raw embedding as a binary BLOB (768 floats = 3072 bytes
      -- for embedding-2-preview at default dim). model + dim are
      -- stored alongside so we can re-embed if we ever swap models.
      --
      -- recallMemory() does cosine sim against this table in
      -- addition to its existing keyword grep, then merges scores
      -- by max(grep_score, cos_score * importance/10).
      --
      -- New facts get embedded fire-and-forget after addFact().
      -- A backfill helper re-embeds all rows where embedded=0.
      CREATE TABLE IF NOT EXISTS fact_embeddings (
        fact_id INTEGER PRIMARY KEY,
        model TEXT NOT NULL,
        dim INTEGER NOT NULL,
        vector BLOB NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (fact_id) REFERENCES project_facts(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_fact_emb_model ON fact_embeddings(model);
    `,
    ],
    [
      '006_files',
      `
      CREATE TABLE IF NOT EXISTS files (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL DEFAULT '',
        body TEXT NOT NULL DEFAULT '',
        mime TEXT NOT NULL DEFAULT 'text/markdown',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_files_updated ON files(updated_at DESC);
    `,
    ],
  ]

  const insertMigration = db.prepare(
    "INSERT INTO migrations (name, applied_at) VALUES (?, datetime('now'))",
  )

  for (const [name, sql] of migrations) {
    if (!applied.has(name)) {
      db.exec(sql)
      insertMigration.run(name)
      console.log(`[store] applied migration: ${name}`)
    }
  }
}

// ── Chat message operations ──────────────────────────────

/**
 * Idempotent upsert of a chat message. Used by the gossip handler when
 * the relay (or a peer) pushes us a message. Existing rows with the same
 * id are updated in place — content can grow during streaming.
 */
export function upsertChatMessage(msg) {
  const db = getStore()
  if (!msg.id || !msg.thread_id) {
    throw new Error('upsertChatMessage requires id and thread_id')
  }
  db.prepare(
    `
    INSERT INTO chat_messages
      (id, thread_id, role, content, tool_calls, tool_call_id, model,
       created_at, source_session_id, complete, synced_from, synced_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(id) DO UPDATE SET
      content = excluded.content,
      tool_calls = excluded.tool_calls,
      model = excluded.model,
      complete = excluded.complete,
      synced_at = datetime('now')
  `,
  ).run(
    String(msg.id),
    String(msg.thread_id),
    String(msg.role || 'user'),
    msg.content == null ? null : String(msg.content),
    msg.tool_calls == null ? null : (typeof msg.tool_calls === 'string' ? msg.tool_calls : JSON.stringify(msg.tool_calls)),
    msg.tool_call_id == null ? null : String(msg.tool_call_id),
    msg.model == null ? null : String(msg.model),
    msg.created_at || new Date().toISOString().replace('T', ' ').slice(0, 19),
    msg.source_session_id == null ? null : String(msg.source_session_id),
    msg.complete == null ? 1 : (msg.complete ? 1 : 0),
    msg.synced_from || 'relay',
  )

  // Touch the thread row so list queries are fast.
  db.prepare(
    `
    INSERT INTO chat_threads (id, project_id, title, last_message_at)
    VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(id) DO UPDATE SET last_message_at = datetime('now')
  `,
  ).run(
    String(msg.thread_id),
    msg.project_id == null ? null : Number(msg.project_id),
    msg.thread_title || null,
  )
}

export function getChatMessage(id) {
  return getStore().prepare('SELECT * FROM chat_messages WHERE id = ?').get(id)
}

export function listChatMessages(threadId, limit = 200) {
  return getStore()
    .prepare(
      'SELECT * FROM chat_messages WHERE thread_id = ? ORDER BY created_at ASC LIMIT ?',
    )
    .all(String(threadId), Number(limit))
}

export function countChatMessages(threadId) {
  const row = getStore()
    .prepare('SELECT COUNT(*) as c FROM chat_messages WHERE thread_id = ?')
    .get(String(threadId))
  return row?.c || 0
}

export function listThreads(limit = 50) {
  return getStore()
    .prepare(
      `
      SELECT t.*,
             (SELECT COUNT(*) FROM chat_messages WHERE thread_id = t.id) AS message_count
      FROM chat_threads t
      ORDER BY COALESCE(t.last_message_at, t.created_at) DESC
      LIMIT ?
    `,
    )
    .all(Number(limit))
}

export function getStorePath() {
  return STORE_PATH
}

// ── Memory operations (Letta-style) ──────────────────────
//
// memory_blocks and project_facts tables are created by the MCP server's
// migrations (mcp_001_memory_blocks, mcp_002_project_facts). The device
// daemon shares the same tables — both processes are on the same machine
// reading/writing the same SQLite file. WAL mode handles concurrent
// access cleanly.
//
// We use CREATE TABLE IF NOT EXISTS guards in case the device daemon
// starts before the MCP server has ever run.

function ensureMemoryTables() {
  const db = getStore()
  db.exec(`
    CREATE TABLE IF NOT EXISTS memory_blocks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      label TEXT NOT NULL,
      content TEXT NOT NULL,
      max_chars INTEGER DEFAULT 4000,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(project_id, label)
    );
    CREATE INDEX IF NOT EXISTS idx_blocks_project ON memory_blocks(project_id);

    CREATE TABLE IF NOT EXISTS project_facts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      category TEXT NOT NULL,
      content TEXT NOT NULL,
      source TEXT,
      embedded INTEGER DEFAULT 0,
      importance INTEGER DEFAULT 5,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_accessed_at TEXT,
      access_count INTEGER DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_facts_project ON project_facts(project_id, category);
    CREATE INDEX IF NOT EXISTS idx_facts_importance ON project_facts(project_id, importance DESC);
  `)
}

export function addFact({ project_id, category, content, source, importance }) {
  ensureMemoryTables()
  const db = getStore()
  const result = db
    .prepare(
      `INSERT INTO project_facts (project_id, category, content, source, importance)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(
      Number(project_id),
      String(category || ''),
      String(content || ''),
      source ? String(source) : null,
      importance ?? 5,
    )
  return Number(result.lastInsertRowid)
}

export function listFacts(project_id, category, limit = 50) {
  ensureMemoryTables()
  const db = getStore()
  if (category) {
    return db
      .prepare(
        `SELECT * FROM project_facts WHERE project_id = ? AND category = ?
         ORDER BY importance DESC, created_at DESC LIMIT ?`,
      )
      .all(Number(project_id), String(category), Number(limit))
  }
  return db
    .prepare(
      `SELECT * FROM project_facts WHERE project_id = ?
       ORDER BY importance DESC, created_at DESC LIMIT ?`,
    )
    .all(Number(project_id), Number(limit))
}

export function grepFacts(project_id, pattern, limit = 20) {
  ensureMemoryTables()
  return getStore()
    .prepare(
      `SELECT * FROM project_facts WHERE project_id = ? AND content LIKE ?
       ORDER BY importance DESC LIMIT ?`,
    )
    .all(Number(project_id), `%${pattern}%`, Number(limit))
}

export function touchFact(id) {
  getStore()
    .prepare(
      `UPDATE project_facts SET last_accessed_at = datetime('now'),
       access_count = access_count + 1 WHERE id = ?`,
    )
    .run(Number(id))
}

// ── Fact embeddings (Step 16, vision recall) ─────────────
//
// Stored as Float32Array BLOB. Encoded with Buffer.from(view.buffer).
// Decoded with new Float32Array(buf.buffer, buf.byteOffset,
// buf.byteLength/4).

function ensureFactEmbeddingsTable() {
  const db = getStore()
  db.exec(`
    CREATE TABLE IF NOT EXISTS fact_embeddings (
      fact_id INTEGER PRIMARY KEY,
      model TEXT NOT NULL,
      dim INTEGER NOT NULL,
      vector BLOB NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (fact_id) REFERENCES project_facts(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_fact_emb_model ON fact_embeddings(model);
  `)
}

export function upsertFactEmbedding(factId, model, vector) {
  ensureFactEmbeddingsTable()
  const f32 = vector instanceof Float32Array ? vector : new Float32Array(vector)
  const blob = Buffer.from(f32.buffer, f32.byteOffset, f32.byteLength)
  getStore()
    .prepare(
      `INSERT INTO fact_embeddings (fact_id, model, dim, vector)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(fact_id) DO UPDATE SET
         model = excluded.model,
         dim = excluded.dim,
         vector = excluded.vector,
         created_at = datetime('now')`,
    )
    .run(Number(factId), String(model), f32.length, blob)
  // Mark the fact as embedded so the backfill helper skips it.
  getStore()
    .prepare('UPDATE project_facts SET embedded = 1 WHERE id = ?')
    .run(Number(factId))
}

export function getFactEmbedding(factId) {
  ensureFactEmbeddingsTable()
  const row = getStore()
    .prepare('SELECT model, dim, vector FROM fact_embeddings WHERE fact_id = ?')
    .get(Number(factId))
  if (!row) return null
  const buf = row.vector
  const vec = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4)
  return { model: row.model, dim: row.dim, vector: vec }
}

/**
 * Return all (factId, vector) pairs for facts in a project that have
 * been embedded with `model`. Used by the cosine-search loop in
 * recallMemoryWithEmbeddings.
 */
export function loadProjectEmbeddings(project_id, model) {
  ensureFactEmbeddingsTable()
  const rows = getStore()
    .prepare(
      `SELECT e.fact_id, e.dim, e.vector, f.content, f.category, f.importance
       FROM fact_embeddings e
       JOIN project_facts f ON f.id = e.fact_id
       WHERE f.project_id = ? AND e.model = ?`,
    )
    .all(Number(project_id), String(model))
  return rows.map((r) => ({
    fact_id: r.fact_id,
    content: r.content,
    category: r.category,
    importance: r.importance,
    vector: new Float32Array(r.vector.buffer, r.vector.byteOffset, r.vector.byteLength / 4),
  }))
}

/**
 * Mark a fact as not yet embedded — used by tests / backfill scripts.
 */
export function listUnembeddedFacts(project_id, limit = 100) {
  ensureFactEmbeddingsTable()
  return getStore()
    .prepare(
      `SELECT id, content, category, importance FROM project_facts
       WHERE project_id = ? AND embedded = 0
       ORDER BY id ASC LIMIT ?`,
    )
    .all(Number(project_id), Number(limit))
}

export function countFacts(project_id) {
  ensureMemoryTables()
  const db = getStore()
  const total = db
    .prepare('SELECT COUNT(*) as c FROM project_facts WHERE project_id = ?')
    .get(Number(project_id)).c
  const byCat = db
    .prepare(
      'SELECT category, COUNT(*) as c FROM project_facts WHERE project_id = ? GROUP BY category',
    )
    .all(Number(project_id))
  const by_category = {}
  for (const r of byCat) by_category[r.category] = r.c
  return { total, by_category }
}

export function getMemoryBlocks(project_id) {
  ensureMemoryTables()
  return getStore()
    .prepare('SELECT * FROM memory_blocks WHERE project_id = ? ORDER BY label')
    .all(Number(project_id))
}

export function getMemoryBlock(project_id, label) {
  ensureMemoryTables()
  return getStore()
    .prepare('SELECT * FROM memory_blocks WHERE project_id = ? AND label = ?')
    .get(Number(project_id), String(label))
}

export function upsertMemoryBlock(project_id, label, content, maxChars = 4000) {
  ensureMemoryTables()
  getStore()
    .prepare(
      `INSERT INTO memory_blocks (project_id, label, content, max_chars, updated_at)
       VALUES (?, ?, ?, ?, datetime('now'))
       ON CONFLICT(project_id, label) DO UPDATE SET
         content = excluded.content,
         max_chars = excluded.max_chars,
         updated_at = datetime('now')`,
    )
    .run(Number(project_id), String(label), String(content), Number(maxChars))
}

export function appendMemoryBlock(project_id, label, addition) {
  const existing = getMemoryBlock(project_id, label)
  const current = existing?.content || ''
  const maxChars = existing?.max_chars || 4000
  let next = current ? `${current}\n${addition}` : String(addition)
  if (next.length > maxChars) next = next.slice(next.length - maxChars)
  upsertMemoryBlock(project_id, label, next, maxChars)
}

/**
 * Unified search across blocks, facts, and (optionally) recent chat
 * messages for a project. Same scoring as the MCP server's recall().
 */
export function recallMemory(project_id, query, limit = 20) {
  const terms = String(query)
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 2)
  if (terms.length === 0) return []

  const score = (text) => {
    if (!text) return 0
    const lower = text.toLowerCase()
    let hits = 0
    for (const t of terms) if (lower.includes(t)) hits++
    return hits / terms.length
  }

  const hits = []

  for (const block of getMemoryBlocks(project_id)) {
    const s = score(block.content)
    if (s > 0) {
      hits.push({
        source: 'block',
        id: block.id,
        label_or_category: block.label,
        score: s + 0.1,
        content: block.content,
      })
    }
  }

  const candidates = new Map()
  for (const term of terms) {
    for (const f of grepFacts(project_id, term, 50)) candidates.set(f.id, f)
  }
  for (const f of candidates.values()) {
    const s = score(f.content)
    if (s > 0) {
      hits.push({
        source: 'fact',
        id: f.id,
        label_or_category: f.category,
        score: s * (0.5 + f.importance / 10),
        content: f.content,
      })
      touchFact(f.id)
    }
  }

  hits.sort((a, b) => b.score - a.score)
  return hits.slice(0, Number(limit))
}

// ── Files (pasted documents, cross-device) ────────────────

export function listFiles(limit = 200) {
  const db = getStore()
  return db
    .prepare(
      `SELECT id, title, mime, created_at, updated_at, length(body) AS size
       FROM files ORDER BY updated_at DESC LIMIT ?`,
    )
    .all(Number(limit))
}

export function getFile(id) {
  const db = getStore()
  return db.prepare(`SELECT * FROM files WHERE id = ?`).get(String(id)) || null
}

export function putFile({ id, title, body, mime }) {
  const db = getStore()
  const fid = id || (globalThis.crypto?.randomUUID?.() ||
    `f_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`)
  const t = String(title ?? '').slice(0, 500)
  const b = String(body ?? '')
  const m = String(mime || 'text/markdown').slice(0, 120)
  db.prepare(
    `INSERT INTO files (id, title, body, mime)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       title = excluded.title,
       body = excluded.body,
       mime = excluded.mime,
       updated_at = datetime('now')`,
  ).run(fid, t, b, m)
  return getFile(fid)
}

export function deleteFile(id) {
  const db = getStore()
  const info = db.prepare(`DELETE FROM files WHERE id = ?`).run(String(id))
  return info.changes > 0
}
