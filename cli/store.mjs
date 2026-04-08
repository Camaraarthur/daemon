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
