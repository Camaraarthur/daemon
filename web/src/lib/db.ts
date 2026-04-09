/**
 * Daemon database — SQLite via better-sqlite3.
 * Shares the same DB file as the Python users module.
 * Handles: projects, chat threads, chat messages, imported sessions.
 */

import Database from 'better-sqlite3'
import { join } from 'path'

const DB_PATH = join(process.cwd(), '..', 'data', 'users.db')

let _db: Database.Database | null = null

function getDb(): Database.Database {
  if (!_db) {
    _db = new Database(DB_PATH)
    _db.pragma('journal_mode = WAL')
    _db.pragma('foreign_keys = ON')
    runMigrations(_db)
  }
  return _db
}

function runMigrations(db: Database.Database) {
  // Create migration tracking table
  db.exec(`CREATE TABLE IF NOT EXISTS migrations (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    applied_at TEXT NOT NULL
  )`)

  const applied = new Set(
    db.prepare('SELECT name FROM migrations').all().map((r: any) => r.name)
  )

  const migrations: [string, string][] = [
    ['001_projects', `
      CREATE TABLE IF NOT EXISTS projects (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        display_name TEXT,
        local_path TEXT,
        git_remote TEXT,
        git_branch TEXT DEFAULT 'develop',
        stack TEXT,
        domain TEXT,
        service_name TEXT,
        settings TEXT DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        last_active TEXT,
        UNIQUE(user_id, name)
      )
    `],
    ['002_chat_threads', `
      CREATE TABLE IF NOT EXISTS chat_threads (
        id TEXT PRIMARY KEY,
        project_id INTEGER,
        user_id INTEGER NOT NULL,
        title TEXT DEFAULT 'New conversation',
        branch TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        last_message_at TEXT,
        FOREIGN KEY (project_id) REFERENCES projects(id)
      )
    `],
    ['003_chat_messages', `
      CREATE TABLE IF NOT EXISTS chat_messages (
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT,
        tool_calls TEXT,
        tool_call_id TEXT,
        model TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (thread_id) REFERENCES chat_threads(id)
      )
    `],
    ['004_imported_sessions', `
      CREATE TABLE IF NOT EXISTS imported_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER,
        source TEXT NOT NULL,
        source_session_id TEXT,
        imported_at TEXT NOT NULL DEFAULT (datetime('now')),
        message_count INTEGER DEFAULT 0,
        FOREIGN KEY (project_id) REFERENCES projects(id),
        UNIQUE(source, source_session_id)
      )
    `],
    ['005_indexes', `
      CREATE INDEX IF NOT EXISTS idx_projects_user ON projects(user_id);
      CREATE INDEX IF NOT EXISTS idx_threads_project ON chat_threads(project_id);
      CREATE INDEX IF NOT EXISTS idx_threads_user ON chat_threads(user_id);
      CREATE INDEX IF NOT EXISTS idx_messages_thread ON chat_messages(thread_id);
      CREATE INDEX IF NOT EXISTS idx_messages_created ON chat_messages(created_at);
    `],
    ['006_conversation_memory', `
      CREATE TABLE IF NOT EXISTS conversation_memory (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        thread_id TEXT NOT NULL,
        project_id INTEGER,
        user_id INTEGER NOT NULL,
        tldr TEXT NOT NULL,
        key_decisions TEXT,
        key_facts TEXT,
        problems TEXT,
        solutions TEXT,
        tags TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (thread_id) REFERENCES chat_threads(id),
        FOREIGN KEY (project_id) REFERENCES projects(id)
      );
      CREATE INDEX IF NOT EXISTS idx_memory_thread ON conversation_memory(thread_id);
      CREATE INDEX IF NOT EXISTS idx_memory_project ON conversation_memory(project_id);
      CREATE INDEX IF NOT EXISTS idx_memory_user ON conversation_memory(user_id);
    `],
    ['007_usage_log', `
      CREATE TABLE IF NOT EXISTS usage_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        model TEXT NOT NULL,
        provider TEXT NOT NULL,
        input_tokens INTEGER DEFAULT 0,
        output_tokens INTEGER DEFAULT 0,
        cost_usd REAL DEFAULT 0,
        key_source TEXT DEFAULT 'daemon',
        project_id INTEGER,
        thread_id TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (user_id) REFERENCES users(id)
      );
      CREATE INDEX IF NOT EXISTS idx_usage_user_date ON usage_log(user_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_usage_user_month ON usage_log(user_id, substr(created_at, 1, 7));
    `],
    // v1: billing — subscriptions and credits not needed for v0
    // ['008_subscriptions', `...`],
    // ['009_credits', `...`],
    // ['010_credit_usage_log', `...`],
    ['011_device_tokens', `
      CREATE TABLE IF NOT EXISTS device_tokens (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        device_id TEXT NOT NULL,
        device_name TEXT,
        platform TEXT,
        token_hash TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        last_seen TEXT,
        revoked INTEGER DEFAULT 0,
        FOREIGN KEY (user_id) REFERENCES users(id)
      );
      CREATE INDEX IF NOT EXISTS idx_device_tokens_hash ON device_tokens(token_hash);
      CREATE INDEX IF NOT EXISTS idx_device_tokens_user ON device_tokens(user_id);
    `],
    ['012_session_expiry', `
      ALTER TABLE sessions ADD COLUMN expires_at TEXT;
      UPDATE sessions SET expires_at = datetime(created_at, '+30 days') WHERE expires_at IS NULL;
    `],
    ['013_trust_ledger', `
      CREATE TABLE trust_ledger (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        device_id TEXT,
        tool_name TEXT NOT NULL,
        args_hash TEXT,
        outcome TEXT NOT NULL,
        user_approved INTEGER DEFAULT 1,
        duration_ms INTEGER,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (user_id) REFERENCES users(id)
      );
      CREATE INDEX idx_trust_tool ON trust_ledger(user_id, tool_name);
      CREATE INDEX idx_trust_time ON trust_ledger(user_id, created_at);
    `],
    ['014_user_rules', `
      CREATE TABLE IF NOT EXISTS user_rules (
        user_id INTEGER PRIMARY KEY,
        content TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (user_id) REFERENCES users(id)
      );
    `],
    ['015_project_memory', `
      CREATE TABLE IF NOT EXISTS project_memory (
        project_id INTEGER PRIMARY KEY,
        content TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (project_id) REFERENCES projects(id)
      );
    `],
    ['016_claude_code_links', `
      CREATE TABLE IF NOT EXISTS claude_code_links (
        project_id INTEGER PRIMARY KEY,
        claude_project_dir TEXT NOT NULL,
        active_session_id TEXT,
        last_synced_uuid TEXT,
        last_synced_at TEXT,
        enabled INTEGER DEFAULT 1,
        FOREIGN KEY (project_id) REFERENCES projects(id)
      );
      CREATE INDEX IF NOT EXISTS idx_claude_links_session ON claude_code_links(active_session_id);
    `],
    ['017_letta_memory', `
      -- Structured memory blocks (Letta's "core memory" — always-loaded sections)
      CREATE TABLE IF NOT EXISTS memory_blocks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL,
        label TEXT NOT NULL,        -- 'persona', 'project', 'recent', 'open_threads', 'stack', 'gotchas'
        content TEXT NOT NULL,
        max_chars INTEGER DEFAULT 4000,
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (project_id) REFERENCES projects(id),
        UNIQUE(project_id, label)
      );

      -- Archival memory (Letta's archival — structured facts the agent remembers)
      CREATE TABLE IF NOT EXISTS project_facts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL,
        category TEXT NOT NULL,     -- 'decision', 'fact', 'gotcha', 'todo', 'reference', 'preference'
        content TEXT NOT NULL,
        source TEXT,                -- where this came from: 'chat', 'manual', 'file:path', 'commit:hash'
        embedded INTEGER DEFAULT 0, -- whether this fact has been embedded to Qdrant
        importance INTEGER DEFAULT 5, -- 1-10
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        last_accessed_at TEXT,
        access_count INTEGER DEFAULT 0,
        FOREIGN KEY (project_id) REFERENCES projects(id)
      );
      CREATE INDEX IF NOT EXISTS idx_facts_project ON project_facts(project_id, category);
      CREATE INDEX IF NOT EXISTS idx_facts_importance ON project_facts(project_id, importance DESC);
    `],
    ['018_claude_session_cursors', `
      -- Per-(project, session) sync cursor. A single Claude Code JSONL session
      -- can carry messages for multiple projects (different cwds), and a project
      -- can pull from many sessions. Replaces the single-session cursor on
      -- claude_code_links for cross-project sync.
      CREATE TABLE IF NOT EXISTS claude_session_cursors (
        project_id INTEGER NOT NULL,
        session_id TEXT NOT NULL,
        jsonl_path TEXT NOT NULL,
        last_uuid TEXT,
        last_synced_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (project_id, session_id),
        FOREIGN KEY (project_id) REFERENCES projects(id)
      );
      CREATE INDEX IF NOT EXISTS idx_session_cursors_project ON claude_session_cursors(project_id);
    `],
    ['019_message_source_session', `
      -- Tag each imported chat_message with the JSONL session it came from.
      -- The conversation view filters to the MOST RECENT session by default,
      -- so users see "their current conversation" instead of every message
      -- ever typed from inside the project directory across 70+ sessions.
      ALTER TABLE chat_messages ADD COLUMN source_session_id TEXT;
      CREATE INDEX IF NOT EXISTS idx_messages_session ON chat_messages(thread_id, source_session_id, created_at);
    `],
    ['020_message_complete_flag', `
      -- Streaming-into-DB. Every chat_message has a 'complete' flag:
      --   complete=1: message is final, content/tool_calls are settled
      --   complete=0: message is in flight (streaming, content grows)
      -- This is the SOURCE OF TRUTH for streaming state. The client never
      -- holds inflight state the DB doesn't already have, so a refresh
      -- mid-stream just shows the current row and keeps receiving WS push
      -- updates until complete=1.
      ALTER TABLE chat_messages ADD COLUMN complete INTEGER NOT NULL DEFAULT 1;
      CREATE INDEX IF NOT EXISTS idx_messages_inflight ON chat_messages(thread_id, complete);
    `],
    ['021_drop_memory_tables', `
      -- Step 8c moved memory_blocks and project_facts to the device's local
      -- store (~/.daemon/store.db). The relay no longer reads from or
      -- writes to these tables. Drop them so the relay's data/users.db
      -- has no application content. Idempotent — DROP IF EXISTS is fine.
      DROP TABLE IF EXISTS project_facts;
      DROP TABLE IF EXISTS memory_blocks;
    `],
    ['022_push_subscriptions', `
      -- Vision §3.4 — native notification protocol (web push first).
      -- Each row is one browser+device subscribing to web push via the
      -- Push API. Stored on the relay because notifications need to be
      -- sent even when the user's daemon device is offline. The endpoint
      -- + p256dh + auth keys are NOT secret content — they're delivery
      -- addresses, like a phone number. The agent never sees them.
      CREATE TABLE IF NOT EXISTS push_subscriptions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        endpoint TEXT NOT NULL UNIQUE,
        p256dh TEXT NOT NULL,
        auth TEXT NOT NULL,
        user_agent TEXT,
        platform TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        last_used_at TEXT,
        send_count INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        FOREIGN KEY (user_id) REFERENCES users(id)
      );
      CREATE INDEX IF NOT EXISTS idx_push_user ON push_subscriptions(user_id);
    `],
  ]

  const insertMigration = db.prepare('INSERT INTO migrations (name, applied_at) VALUES (?, datetime(\'now\'))')

  for (const [name, sql] of migrations) {
    if (!applied.has(name)) {
      db.exec(sql)
      insertMigration.run(name)
      console.log(`[db] Applied migration: ${name}`)

      // Post-migration seeds
      if (name === '014_user_rules') {
        try {
          // Seed Arthur's CLAUDE.md (user_id=3) from disk if available
          const fs = require('fs') as typeof import('fs')
          const path = '/home/arthur/.claude/CLAUDE.md'
          if (fs.existsSync(path)) {
            const content = fs.readFileSync(path, 'utf-8')
            db.prepare(
              'INSERT OR REPLACE INTO user_rules (user_id, content, updated_at) VALUES (?, ?, datetime(\'now\'))'
            ).run(3, content)
            console.log('[db] Seeded user_rules for user_id=3 from CLAUDE.md')
          }
        } catch (e) {
          console.warn('[db] Failed to seed user_rules:', e)
        }
      }

      if (name === '015_project_memory') {
        try {
          // For each project, look up potential MEMORY/CLAUDE files
          const fs = require('fs') as typeof import('fs')
          const pathMod = require('path') as typeof import('path')
          const projects = db.prepare('SELECT id, name, local_path FROM projects').all() as Array<{ id: number; name: string; local_path: string | null }>
          let seeded = 0
          for (const p of projects) {
            const candidates: string[] = [
              `/home/arthur/.claude/projects/-home-arthur/memory/${p.name}.md`,
            ]
            if (p.local_path) {
              candidates.push(pathMod.join(p.local_path, 'CLAUDE.md'))
              candidates.push(pathMod.join(p.local_path, 'MEMORY.md'))
            }
            const parts: string[] = []
            for (const c of candidates) {
              try {
                if (fs.existsSync(c) && fs.statSync(c).isFile()) {
                  parts.push(`# Source: ${c}\n\n${fs.readFileSync(c, 'utf-8')}`)
                }
              } catch {}
            }
            if (parts.length > 0) {
              const content = parts.join('\n\n---\n\n')
              db.prepare(
                'INSERT OR REPLACE INTO project_memory (project_id, content, updated_at) VALUES (?, ?, datetime(\'now\'))'
              ).run(p.id, content)
              seeded++
            }
          }
          console.log(`[db] Seeded project_memory for ${seeded} projects`)
        } catch (e) {
          console.warn('[db] Failed to seed project_memory:', e)
        }
      }
    }
  }
}

// ── User Rules (CLAUDE.md equivalent) ─────────────────────

export function getUserRules(userId: number): string | null {
  const row = getDb().prepare(
    'SELECT content FROM user_rules WHERE user_id = ?'
  ).get(userId) as { content: string } | undefined
  return row?.content ?? null
}

export function setUserRules(userId: number, content: string): void {
  getDb().prepare(`
    INSERT INTO user_rules (user_id, content, updated_at)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(user_id) DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at
  `).run(userId, content)
}

// ── Project Memory (MEMORY.md equivalent) ─────────────────

export function getProjectMemory(projectId: number): string | null {
  const row = getDb().prepare(
    'SELECT content FROM project_memory WHERE project_id = ?'
  ).get(projectId) as { content: string } | undefined
  return row?.content ?? null
}

export function setProjectMemory(projectId: number, content: string): void {
  getDb().prepare(`
    INSERT INTO project_memory (project_id, content, updated_at)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(project_id) DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at
  `).run(projectId, content)
}

export function appendProjectMemory(projectId: number, content: string): void {
  const existing = getProjectMemory(projectId) ?? ''
  const merged = existing ? `${existing}\n${content}` : content
  setProjectMemory(projectId, merged)
}

// ── Projects ──────────────────────────────────────────────

export interface Project {
  id: number
  user_id: number
  name: string
  display_name: string | null
  local_path: string | null
  git_remote: string | null
  git_branch: string
  stack: string | null
  domain: string | null
  service_name: string | null
  settings: string
  created_at: string
  last_active: string | null
  parent_id: number | null
}

export function listProjects(userId: number): Project[] {
  return getDb().prepare(
    'SELECT * FROM projects WHERE user_id = ? ORDER BY last_active DESC NULLS LAST, created_at DESC'
  ).all(userId) as Project[]
}

export function getProject(userId: number, projectId: number): Project | undefined {
  return getDb().prepare(
    'SELECT * FROM projects WHERE id = ? AND user_id = ?'
  ).get(projectId, userId) as Project | undefined
}

export function getProjectByName(userId: number, name: string): Project | undefined {
  return getDb().prepare(
    'SELECT * FROM projects WHERE user_id = ? AND name = ?'
  ).get(userId, name) as Project | undefined
}

export function createProject(userId: number, data: Partial<Project>): Project {
  const result = getDb().prepare(`
    INSERT INTO projects (user_id, name, display_name, local_path, git_remote, git_branch, stack, domain, service_name, settings)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    userId,
    data.name!,
    data.display_name || data.name,
    data.local_path || null,
    data.git_remote || null,
    data.git_branch || 'develop',
    data.stack || null,
    data.domain || null,
    data.service_name || null,
    data.settings || '{}',
  )
  return getProject(userId, result.lastInsertRowid as number)!
}

export function updateProject(userId: number, projectId: number, data: Partial<Project>): boolean {
  const fields: string[] = []
  const values: any[] = []

  for (const [key, val] of Object.entries(data)) {
    if (['name', 'display_name', 'local_path', 'git_remote', 'git_branch', 'stack', 'domain', 'service_name', 'settings', 'last_active'].includes(key)) {
      fields.push(`${key} = ?`)
      values.push(val)
    }
  }

  if (fields.length === 0) return false
  values.push(projectId, userId)

  const result = getDb().prepare(
    `UPDATE projects SET ${fields.join(', ')} WHERE id = ? AND user_id = ?`
  ).run(...values)
  return result.changes > 0
}

export function touchProject(projectId: number, userId?: number) {
  if (userId) {
    getDb().prepare('UPDATE projects SET last_active = datetime(\'now\') WHERE id = ? AND user_id = ?').run(projectId, userId)
  } else {
    getDb().prepare('UPDATE projects SET last_active = datetime(\'now\') WHERE id = ?').run(projectId)
  }
}

// ── Chat Threads ──────────────────────────────────────────

export interface ChatThread {
  id: string
  project_id: number | null
  user_id: number
  title: string
  branch: string | null
  created_at: string
  last_message_at: string | null
}

export function listThreads(userId: number, projectId?: number): ChatThread[] {
  if (projectId) {
    return getDb().prepare(
      'SELECT * FROM chat_threads WHERE user_id = ? AND project_id = ? ORDER BY last_message_at DESC NULLS LAST'
    ).all(userId, projectId) as ChatThread[]
  }
  return getDb().prepare(
    'SELECT * FROM chat_threads WHERE user_id = ? ORDER BY last_message_at DESC NULLS LAST'
  ).all(userId) as ChatThread[]
}

export function getThread(threadId: string): ChatThread | undefined {
  return getDb().prepare('SELECT * FROM chat_threads WHERE id = ?').get(threadId) as ChatThread | undefined
}

export function createThread(userId: number, projectId?: number, title?: string): ChatThread {
  const id = crypto.randomUUID()
  getDb().prepare(`
    INSERT INTO chat_threads (id, project_id, user_id, title) VALUES (?, ?, ?, ?)
  `).run(id, projectId || null, userId, title || 'New conversation')
  return getThread(id)!
}

export function updateThreadTitle(threadId: string, title: string) {
  getDb().prepare('UPDATE chat_threads SET title = ? WHERE id = ?').run(title, threadId)
}

export function touchThread(threadId: string) {
  getDb().prepare('UPDATE chat_threads SET last_message_at = datetime(\'now\') WHERE id = ?').run(threadId)
}

// ── Chat Messages ─────────────────────────────────────────

export interface ChatMessage {
  id: string
  thread_id: string
  role: string
  content: string | null
  tool_calls: string | null
  tool_call_id: string | null
  model: string | null
  created_at: string
  source_session_id?: string | null
  /** 1 = final, 0 = in-flight (currently streaming). */
  complete?: number
}

export function listMessages(threadId: string, limit = 100, offset = 0): ChatMessage[] {
  return getDb().prepare(
    'SELECT * FROM chat_messages WHERE thread_id = ? ORDER BY created_at ASC LIMIT ? OFFSET ?'
  ).all(threadId, limit, offset) as ChatMessage[]
}

/**
 * Get the LAST N messages for a thread (most recent), in chronological order.
 * This is what the chat UI wants when opening a conversation: show the recent history.
 */
export function listRecentMessages(threadId: string, limit = 100): ChatMessage[] {
  const db = getDb()
  const total = (db.prepare('SELECT COUNT(*) as c FROM chat_messages WHERE thread_id = ?').get(threadId) as any).c
  const offset = Math.max(0, total - limit)
  return db.prepare(
    'SELECT * FROM chat_messages WHERE thread_id = ? ORDER BY created_at ASC LIMIT ? OFFSET ?'
  ).all(threadId, limit, offset) as ChatMessage[]
}

export function countMessages(threadId: string): number {
  return (getDb().prepare('SELECT COUNT(*) as c FROM chat_messages WHERE thread_id = ?').get(threadId) as any).c
}

export function addMessage(threadId: string, msg: {
  role: string
  content?: string
  tool_calls?: string
  tool_call_id?: string
  model?: string
  /** JSONL session id this message originated from (for sessioned views). */
  source_session_id?: string
  /** Override the default created_at — used by sync to preserve original timestamps. */
  created_at?: string
  /** false = in-flight (streaming), 1 = final. Default 1. */
  complete?: boolean
}): ChatMessage {
  const id = crypto.randomUUID()
  const completeInt = msg.complete === false ? 0 : 1
  if (msg.created_at) {
    getDb().prepare(`
      INSERT INTO chat_messages (id, thread_id, role, content, tool_calls, tool_call_id, model, source_session_id, created_at, complete)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      threadId,
      msg.role,
      msg.content || null,
      msg.tool_calls || null,
      msg.tool_call_id || null,
      msg.model || null,
      msg.source_session_id || null,
      msg.created_at,
      completeInt,
    )
  } else {
    getDb().prepare(`
      INSERT INTO chat_messages (id, thread_id, role, content, tool_calls, tool_call_id, model, source_session_id, complete)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      threadId,
      msg.role,
      msg.content || null,
      msg.tool_calls || null,
      msg.tool_call_id || null,
      msg.model || null,
      msg.source_session_id || null,
      completeInt,
    )
  }
  touchThread(threadId)
  return getDb().prepare('SELECT * FROM chat_messages WHERE id = ?').get(id) as ChatMessage
}

// ── Streaming-into-DB helpers ───────────────────────────────────
//
// The DB is the source of truth for assistant message state. When the chat
// route starts a stream, it creates a placeholder row with complete=0,
// progressively UPDATEs the content as tokens arrive, and marks complete=1
// when done. The client renders whatever's in the row at any moment — so
// refreshing mid-stream just shows the partial content and the WS push keeps
// updating it.

/**
 * Create a placeholder assistant (or any role) message for in-flight streaming.
 * Returns the new ChatMessage row. content starts empty, complete=0.
 */
export function createStreamingMessage(args: {
  thread_id: string
  role: string
  model?: string
  source_session_id?: string
}): ChatMessage {
  return addMessage(args.thread_id, {
    role: args.role,
    content: '',
    model: args.model,
    source_session_id: args.source_session_id,
    complete: false,
  })
}

/**
 * Update the content (and optionally tool_calls JSON) of an in-flight message.
 * Use during streaming. Does not touch the complete flag.
 */
export function updateMessageContent(messageId: string, content: string, toolCallsJson?: string | null): void {
  if (toolCallsJson !== undefined) {
    getDb().prepare(
      'UPDATE chat_messages SET content = ?, tool_calls = ? WHERE id = ?'
    ).run(content, toolCallsJson, messageId)
  } else {
    getDb().prepare(
      'UPDATE chat_messages SET content = ? WHERE id = ?'
    ).run(content, messageId)
  }
}

/**
 * Mark a streaming message as final. Optionally update model/content/tool_calls
 * one last time in the same statement. Touches the parent thread.
 */
export function markMessageComplete(messageId: string, finalize?: {
  content?: string
  tool_calls?: string | null
  model?: string
}): void {
  const fields: string[] = ['complete = 1']
  const values: any[] = []
  if (finalize?.content !== undefined) { fields.push('content = ?'); values.push(finalize.content) }
  if (finalize?.tool_calls !== undefined) { fields.push('tool_calls = ?'); values.push(finalize.tool_calls) }
  if (finalize?.model !== undefined) { fields.push('model = ?'); values.push(finalize.model) }
  values.push(messageId)
  getDb().prepare(`UPDATE chat_messages SET ${fields.join(', ')} WHERE id = ?`).run(...values)

  // Touch the parent thread so list_threads sorts it correctly.
  const row = getDb().prepare('SELECT thread_id FROM chat_messages WHERE id = ?').get(messageId) as { thread_id: string } | undefined
  if (row?.thread_id) touchThread(row.thread_id)
}

/**
 * Get the most recent in-flight (complete=0) message for a thread, if any.
 * Used on page load to detect "this thread has a stream in progress, render
 * it and subscribe for updates".
 */
export function getInflightMessage(threadId: string): ChatMessage | undefined {
  return getDb().prepare(
    'SELECT * FROM chat_messages WHERE thread_id = ? AND complete = 0 ORDER BY created_at DESC LIMIT 1'
  ).get(threadId) as ChatMessage | undefined
}

/**
 * Sweep up dangling in-flight messages older than `maxAgeMinutes` minutes.
 * Used at server startup so a process crash mid-stream doesn't leave a
 * thread with a permanently-spinning placeholder.
 */
export function reapStaleInflightMessages(maxAgeMinutes = 5): number {
  const result = getDb().prepare(`
    UPDATE chat_messages
    SET complete = 1, content = COALESCE(content, '') || '\n\n[interrupted — server restart]'
    WHERE complete = 0
      AND created_at < datetime('now', ?)
  `).run(`-${maxAgeMinutes} minutes`)
  return result.changes
}

/**
 * Find the most recent JSONL session id that contributed messages to this
 * thread. Returns null if no message has a source_session_id (legacy mode).
 */
export function getLatestSessionForThread(threadId: string): string | null {
  const row = getDb().prepare(`
    SELECT source_session_id FROM chat_messages
    WHERE thread_id = ? AND source_session_id IS NOT NULL
    ORDER BY created_at DESC
    LIMIT 1
  `).get(threadId) as { source_session_id: string } | undefined
  return row?.source_session_id || null
}

/**
 * Get the LAST N messages for a thread, restricted to a single source
 * session id. This is what the chat UI uses to render "the current
 * conversation" instead of every message ever typed inside the project dir.
 */
export function listRecentMessagesForSession(threadId: string, sessionId: string, limit = 200): ChatMessage[] {
  const total = (getDb().prepare(
    'SELECT COUNT(*) as c FROM chat_messages WHERE thread_id = ? AND source_session_id = ?'
  ).get(threadId, sessionId) as any).c
  const offset = Math.max(0, total - limit)
  return getDb().prepare(
    'SELECT * FROM chat_messages WHERE thread_id = ? AND source_session_id = ? ORDER BY created_at ASC LIMIT ? OFFSET ?'
  ).all(threadId, sessionId, limit, offset) as ChatMessage[]
}

export function countMessagesForSession(threadId: string, sessionId: string): number {
  return (getDb().prepare(
    'SELECT COUNT(*) as c FROM chat_messages WHERE thread_id = ? AND source_session_id = ?'
  ).get(threadId, sessionId) as any).c
}

// ── Project Messages (merged timeline) ───────────────────

export interface ProjectTimelineMessage {
  id: string
  thread_id: string
  role: string
  content: string | null
  model: string | null
  created_at: string
  thread_title: string
  thread_created_at: string
}

/**
 * Returns all messages across all threads for a project, ordered by created_at ASC.
 * Includes thread title for divider rendering on the client.
 * Uses LIMIT/OFFSET for pagination (load from the end, scroll up for more).
 */
export function listProjectMessages(
  projectId: number,
  limit = 100,
  offset = 0
): { messages: ProjectTimelineMessage[]; total: number } {
  const db = getDb()

  const totalRow = db.prepare(`
    SELECT COUNT(*) as cnt FROM chat_messages cm
    JOIN chat_threads ct ON cm.thread_id = ct.id
    WHERE ct.project_id = ?
  `).get(projectId) as { cnt: number }

  const total = totalRow.cnt

  // We want the LAST `limit` messages (most recent), offset from the end.
  // To achieve "load last N, then scroll up for more":
  // offset=0 means the last `limit` messages, offset=100 means the 100 before that, etc.
  const effectiveOffset = Math.max(0, total - limit - offset)
  const effectiveLimit = Math.min(limit, total - offset)

  if (effectiveLimit <= 0) {
    return { messages: [], total }
  }

  const messages = db.prepare(`
    SELECT cm.id, cm.thread_id, cm.role, cm.content, cm.model, cm.created_at,
           ct.title as thread_title, ct.created_at as thread_created_at
    FROM chat_messages cm
    JOIN chat_threads ct ON cm.thread_id = ct.id
    WHERE ct.project_id = ?
    ORDER BY cm.created_at ASC
    LIMIT ? OFFSET ?
  `).all(projectId, effectiveLimit, effectiveOffset) as ProjectTimelineMessage[]

  return { messages, total }
}

// ── Import Tracking ───────────────────────────────────────

export function isSessionImported(source: string, sessionId: string): boolean {
  const row = getDb().prepare(
    'SELECT 1 FROM imported_sessions WHERE source = ? AND source_session_id = ?'
  ).get(source, sessionId)
  return !!row
}

export function markSessionImported(projectId: number, source: string, sessionId: string, messageCount: number) {
  getDb().prepare(`
    INSERT OR IGNORE INTO imported_sessions (project_id, source, source_session_id, message_count)
    VALUES (?, ?, ?, ?)
  `).run(projectId, source, sessionId, messageCount)
}

// ── Bulk Operations ───────────────────────────────────────

export function bulkAddMessages(threadId: string, messages: Array<{
  role: string
  content?: string
  model?: string
  created_at?: string
}>) {
  const db = getDb()
  const insert = db.prepare(`
    INSERT INTO chat_messages (id, thread_id, role, content, model, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `)

  const tx = db.transaction(() => {
    for (const msg of messages) {
      insert.run(
        crypto.randomUUID(),
        threadId,
        msg.role,
        msg.content || null,
        msg.model || null,
        msg.created_at || new Date().toISOString(),
      )
    }
  })
  tx()
  touchThread(threadId)
}

// ── Usage Logging ────────────────────────────────────────

export interface UsageLogEntry {
  id: number
  user_id: number
  model: string
  provider: string
  input_tokens: number
  output_tokens: number
  cost_usd: number
  key_source: string
  project_id: number | null
  thread_id: string | null
  created_at: string
}

export function logUsage(entry: {
  userId: number
  model: string
  provider: string
  inputTokens: number
  outputTokens: number
  costUsd: number
  keySource: string
  projectId?: number
  threadId?: string
}) {
  getDb().prepare(`
    INSERT INTO usage_log (user_id, model, provider, input_tokens, output_tokens, cost_usd, key_source, project_id, thread_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    entry.userId,
    entry.model,
    entry.provider,
    entry.inputTokens,
    entry.outputTokens,
    entry.costUsd,
    entry.keySource,
    entry.projectId || null,
    entry.threadId || null,
  )
}

export function getUsageToday(userId: number): {
  cost: number
  messages: number
  models: Record<string, number>
} {
  const db = getDb()
  const today = new Date().toISOString().slice(0, 10) // YYYY-MM-DD

  const summary = db.prepare(`
    SELECT COALESCE(SUM(cost_usd), 0) as cost, COUNT(*) as messages
    FROM usage_log
    WHERE user_id = ? AND date(created_at) = ?
  `).get(userId, today) as { cost: number; messages: number }

  const modelRows = db.prepare(`
    SELECT model, COUNT(*) as cnt
    FROM usage_log
    WHERE user_id = ? AND date(created_at) = ?
    GROUP BY model
  `).all(userId, today) as { model: string; cnt: number }[]

  const models: Record<string, number> = {}
  for (const row of modelRows) {
    models[row.model] = row.cnt
  }

  return { cost: summary.cost, messages: summary.messages, models }
}

export function getUsageThisMonth(userId: number): {
  cost: number
  messages: number
} {
  const db = getDb()
  const month = new Date().toISOString().slice(0, 7) // YYYY-MM

  return db.prepare(`
    SELECT COALESCE(SUM(cost_usd), 0) as cost, COUNT(*) as messages
    FROM usage_log
    WHERE user_id = ? AND substr(created_at, 1, 7) = ?
  `).get(userId, month) as { cost: number; messages: number }
}

export function getUsageDailyBreakdown(userId: number, days = 30): {
  date: string
  cost: number
  messages: number
}[] {
  const db = getDb()
  return db.prepare(`
    SELECT date(created_at) as date,
           COALESCE(SUM(cost_usd), 0) as cost,
           COUNT(*) as messages
    FROM usage_log
    WHERE user_id = ?
      AND created_at >= datetime('now', ?)
    GROUP BY date(created_at)
    ORDER BY date ASC
  `).all(userId, `-${days} days`) as { date: string; cost: number; messages: number }[]
}

// v1: Subscription, Credits, and related functions removed for v0 (no billing)

// ── Device Tokens ──────────────────────────────────────

import { createHash, randomBytes } from 'crypto'

function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex')
}

export interface DeviceToken {
  id: number
  user_id: number
  device_id: string
  device_name: string | null
  platform: string | null
  token_hash: string
  created_at: string
  last_seen: string | null
  revoked: number
}

/**
 * Create a new device token. Returns the raw token (only shown once).
 * The hash is stored in the database.
 */
export function createDeviceToken(userId: number, deviceId: string, deviceName?: string, platform?: string): string {
  const rawToken = randomBytes(32).toString('hex')
  const hash = hashToken(rawToken)
  getDb().prepare(`
    INSERT INTO device_tokens (user_id, device_id, device_name, platform, token_hash)
    VALUES (?, ?, ?, ?, ?)
  `).run(userId, deviceId, deviceName || null, platform || null, hash)
  return rawToken
}

/**
 * Validate a raw device token. Returns user_id and device_id if valid, null if not.
 */
export function validateDeviceToken(rawToken: string): { userId: number; deviceId: string } | null {
  const hash = hashToken(rawToken)
  const row = getDb().prepare(
    'SELECT user_id, device_id FROM device_tokens WHERE token_hash = ? AND revoked = 0'
  ).get(hash) as { user_id: number; device_id: string } | undefined
  if (!row) return null
  return { userId: row.user_id, deviceId: row.device_id }
}

/**
 * Revoke a device token by its ID.
 */
export function revokeDeviceToken(tokenId: number): boolean {
  const result = getDb().prepare(
    'UPDATE device_tokens SET revoked = 1 WHERE id = ?'
  ).run(tokenId)
  return result.changes > 0
}

/**
 * List all device tokens for a user.
 */
export function listDeviceTokens(userId: number): DeviceToken[] {
  return getDb().prepare(
    'SELECT * FROM device_tokens WHERE user_id = ? AND revoked = 0 ORDER BY last_seen DESC NULLS LAST, created_at DESC'
  ).all(userId) as DeviceToken[]
}

/**
 * Update the last_seen timestamp for a device token (by hash).
 */
export function updateLastSeen(rawToken: string): void {
  const hash = hashToken(rawToken)
  getDb().prepare(
    "UPDATE device_tokens SET last_seen = datetime('now') WHERE token_hash = ?"
  ).run(hash)
}

// ── Trust Ledger ──────────────────────────────────────

export interface TrustAction {
  id: number
  user_id: number
  device_id: string | null
  tool_name: string
  args_hash: string | null
  outcome: string
  user_approved: number
  duration_ms: number | null
  created_at: string
}

export interface TrustScore {
  tool_name: string
  total_runs: number
  success_rate: number
  auto_approve_eligible: boolean
}

/**
 * Log a tool invocation to the trust ledger.
 */
export function logTrustAction(
  userId: number,
  toolName: string,
  argsHash: string | null,
  outcome: 'success' | 'failure' | 'denied' | 'error',
  userApproved: boolean,
  durationMs: number | null,
  deviceId?: string,
) {
  getDb().prepare(`
    INSERT INTO trust_ledger (user_id, device_id, tool_name, args_hash, outcome, user_approved, duration_ms)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    userId,
    deviceId || null,
    toolName,
    argsHash,
    outcome,
    userApproved ? 1 : 0,
    durationMs,
  )
}

/**
 * Compute the trust score for a specific tool for a user.
 * Auto-approve eligible if: >10 runs AND >95% success rate AND no 'denied' in last 30 days.
 */
export function getTrustScore(userId: number, toolName: string): TrustScore {
  const db = getDb()

  const stats = db.prepare(`
    SELECT
      COUNT(*) as total_runs,
      COALESCE(SUM(CASE WHEN outcome = 'success' THEN 1 ELSE 0 END), 0) as successes
    FROM trust_ledger
    WHERE user_id = ? AND tool_name = ?
  `).get(userId, toolName) as { total_runs: number; successes: number }

  const totalRuns = stats.total_runs
  const successRate = totalRuns > 0 ? stats.successes / totalRuns : 0

  // Check for any 'denied' outcome in the last 30 days
  const recentDenied = db.prepare(`
    SELECT COUNT(*) as cnt FROM trust_ledger
    WHERE user_id = ? AND tool_name = ? AND outcome = 'denied'
      AND created_at >= datetime('now', '-30 days')
  `).get(userId, toolName) as { cnt: number }

  const autoApproveEligible =
    totalRuns > 10 &&
    successRate > 0.95 &&
    recentDenied.cnt === 0

  return {
    tool_name: toolName,
    total_runs: totalRuns,
    success_rate: Math.round(successRate * 10000) / 10000, // 4 decimal places
    auto_approve_eligible: autoApproveEligible,
  }
}

/**
 * Get trust scores for all tools a user has invoked.
 */
export function getTrustSummary(userId: number): TrustScore[] {
  const db = getDb()

  const tools = db.prepare(`
    SELECT DISTINCT tool_name FROM trust_ledger WHERE user_id = ?
  `).all(userId) as { tool_name: string }[]

  return tools.map(t => getTrustScore(userId, t.tool_name))
}

// ── Claude Code link (bidirectional JSONL sync) ─────────────

export interface ClaudeCodeLink {
  project_id: number
  claude_project_dir: string
  active_session_id: string | null
  last_synced_uuid: string | null
  last_synced_at: string | null
  enabled: number
}

export function getClaudeCodeLink(projectId: number): ClaudeCodeLink | undefined {
  return getDb().prepare(
    'SELECT * FROM claude_code_links WHERE project_id = ?'
  ).get(projectId) as ClaudeCodeLink | undefined
}

export function upsertClaudeCodeLink(
  projectId: number,
  claudeProjectDir: string,
  activeSessionId?: string | null,
): void {
  getDb().prepare(`
    INSERT INTO claude_code_links (project_id, claude_project_dir, active_session_id, enabled)
    VALUES (?, ?, ?, 1)
    ON CONFLICT(project_id) DO UPDATE SET
      claude_project_dir = excluded.claude_project_dir,
      active_session_id = COALESCE(excluded.active_session_id, claude_code_links.active_session_id),
      enabled = 1
  `).run(projectId, claudeProjectDir, activeSessionId || null)
}

export function updateClaudeCodeLinkSync(
  projectId: number,
  sessionId: string,
  lastUuid: string,
): void {
  getDb().prepare(`
    UPDATE claude_code_links
    SET active_session_id = ?, last_synced_uuid = ?, last_synced_at = datetime('now')
    WHERE project_id = ?
  `).run(sessionId, lastUuid, projectId)
}

export function disableClaudeCodeLink(projectId: number): void {
  getDb().prepare('UPDATE claude_code_links SET enabled = 0 WHERE project_id = ?').run(projectId)
}

// ── Claude session cursors (per-(project, session) sync cursor) ──

export interface ClaudeSessionCursor {
  project_id: number
  session_id: string
  jsonl_path: string
  last_uuid: string | null
  last_synced_at: string
}

export function getSessionCursor(projectId: number, sessionId: string): ClaudeSessionCursor | undefined {
  return getDb().prepare(
    'SELECT * FROM claude_session_cursors WHERE project_id = ? AND session_id = ?',
  ).get(projectId, sessionId) as ClaudeSessionCursor | undefined
}

export function upsertSessionCursor(projectId: number, sessionId: string, jsonlPath: string, lastUuid: string): void {
  getDb().prepare(`
    INSERT INTO claude_session_cursors (project_id, session_id, jsonl_path, last_uuid, last_synced_at)
    VALUES (?, ?, ?, ?, datetime('now'))
    ON CONFLICT(project_id, session_id) DO UPDATE SET
      last_uuid = excluded.last_uuid,
      jsonl_path = excluded.jsonl_path,
      last_synced_at = datetime('now')
  `).run(projectId, sessionId, jsonlPath, lastUuid)
}

// ── Letta-style memory ─────────────────────────────────────
//
// Memory blocks and project facts moved to the device's local store
// (~/.daemon/store.db) in Step 8c. The relay no longer holds memory
// content. The dead helpers (getMemoryBlocks, addFact, etc.) and the
// in-process tables (memory_blocks, project_facts) are gone — see
// migration 021_drop_memory_tables. Memory access from the relay
// process now routes through web/src/lib/device-memory.ts which sends
// memory.* commands over the WS hub.

// Standard core memory block labels — kept here as the canonical
// vocabulary the agent should use when calling update_memory_block.
export const CORE_BLOCK_LABELS = [
  'project',       // What this project is, its purpose, stack
  'recent',        // What was just being worked on (last session)
  'open_threads',  // Pending TODOs, unfinished work
  'gotchas',       // Things that bit you, common mistakes
  'preferences',   // How the user wants this project handled
] as const

// ── Push subscriptions (vision §3.4) ───────────────────────

export interface PushSubscription {
  id: number
  user_id: number
  endpoint: string
  p256dh: string
  auth: string
  user_agent: string | null
  platform: string | null
  created_at: string
  last_used_at: string | null
  send_count: number
  last_error: string | null
}

export function upsertPushSubscription(opts: {
  userId: number
  endpoint: string
  p256dh: string
  auth: string
  userAgent?: string
  platform?: string
}): PushSubscription {
  getDb().prepare(`
    INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, user_agent, platform)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(endpoint) DO UPDATE SET
      user_id = excluded.user_id,
      p256dh = excluded.p256dh,
      auth = excluded.auth,
      user_agent = excluded.user_agent,
      platform = excluded.platform
  `).run(
    opts.userId,
    opts.endpoint,
    opts.p256dh,
    opts.auth,
    opts.userAgent || null,
    opts.platform || null,
  )
  return getDb().prepare(
    'SELECT * FROM push_subscriptions WHERE endpoint = ?'
  ).get(opts.endpoint) as PushSubscription
}

export function listPushSubscriptions(userId: number): PushSubscription[] {
  return getDb().prepare(
    'SELECT * FROM push_subscriptions WHERE user_id = ? ORDER BY created_at DESC'
  ).all(userId) as PushSubscription[]
}

export function deletePushSubscription(endpoint: string): boolean {
  const r = getDb().prepare(
    'DELETE FROM push_subscriptions WHERE endpoint = ?'
  ).run(endpoint)
  return r.changes > 0
}

export function recordPushSent(endpoint: string, error: string | null = null) {
  getDb().prepare(`
    UPDATE push_subscriptions
    SET last_used_at = datetime('now'),
        send_count = send_count + 1,
        last_error = ?
    WHERE endpoint = ?
  `).run(error, endpoint)
}

export default getDb
