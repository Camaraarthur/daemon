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
    ['008_subscriptions', `
      CREATE TABLE IF NOT EXISTS subscriptions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL UNIQUE,
        plan TEXT NOT NULL DEFAULT 'free',
        status TEXT NOT NULL DEFAULT 'inactive',
        stripe_customer_id TEXT,
        stripe_subscription_id TEXT,
        coinbase_charge_id TEXT,
        payment_method TEXT DEFAULT 'none',
        current_period_start TEXT,
        current_period_end TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (user_id) REFERENCES users(id)
      );
      CREATE INDEX IF NOT EXISTS idx_sub_user ON subscriptions(user_id);
      CREATE INDEX IF NOT EXISTS idx_sub_stripe ON subscriptions(stripe_customer_id);
    `],
    ['009_credits', `
      ALTER TABLE subscriptions ADD COLUMN credit_balance_usd REAL DEFAULT 5.0;
      ALTER TABLE subscriptions ADD COLUMN credits_used_this_month REAL DEFAULT 0.0;
      ALTER TABLE subscriptions ADD COLUMN credit_reset_date TEXT;
    `],
    ['010_credit_usage_log', `
      CREATE TABLE IF NOT EXISTS credit_usage (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        api_id TEXT NOT NULL,
        api_name TEXT NOT NULL,
        units REAL NOT NULL DEFAULT 1,
        cost_usd REAL NOT NULL DEFAULT 0,
        description TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (user_id) REFERENCES users(id)
      );
      CREATE INDEX IF NOT EXISTS idx_credit_usage_user ON credit_usage(user_id);
      CREATE INDEX IF NOT EXISTS idx_credit_usage_month ON credit_usage(user_id, substr(created_at, 1, 7));
    `],
  ]

  const insertMigration = db.prepare('INSERT INTO migrations (name, applied_at) VALUES (?, datetime(\'now\'))')

  for (const [name, sql] of migrations) {
    if (!applied.has(name)) {
      db.exec(sql)
      insertMigration.run(name)
      console.log(`[db] Applied migration: ${name}`)
    }
  }
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

export function touchProject(projectId: number) {
  getDb().prepare('UPDATE projects SET last_active = datetime(\'now\') WHERE id = ?').run(projectId)
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
}

export function listMessages(threadId: string, limit = 100, offset = 0): ChatMessage[] {
  return getDb().prepare(
    'SELECT * FROM chat_messages WHERE thread_id = ? ORDER BY created_at ASC LIMIT ? OFFSET ?'
  ).all(threadId, limit, offset) as ChatMessage[]
}

export function addMessage(threadId: string, msg: {
  role: string
  content?: string
  tool_calls?: string
  tool_call_id?: string
  model?: string
}): ChatMessage {
  const id = crypto.randomUUID()
  getDb().prepare(`
    INSERT INTO chat_messages (id, thread_id, role, content, tool_calls, tool_call_id, model)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, threadId, msg.role, msg.content || null, msg.tool_calls || null, msg.tool_call_id || null, msg.model || null)
  touchThread(threadId)
  return getDb().prepare('SELECT * FROM chat_messages WHERE id = ?').get(id) as ChatMessage
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

// ── Subscriptions ────────────────────────────────────────

export interface Subscription {
  id: number
  user_id: number
  plan: string
  status: string
  stripe_customer_id: string | null
  stripe_subscription_id: string | null
  coinbase_charge_id: string | null
  payment_method: string
  current_period_start: string | null
  current_period_end: string | null
  credit_balance_usd: number
  credits_used_this_month: number
  credit_reset_date: string | null
  created_at: string
  updated_at: string
}

export function getSubscription(userId: number): Subscription | undefined {
  return getDb().prepare(
    'SELECT * FROM subscriptions WHERE user_id = ?'
  ).get(userId) as Subscription | undefined
}

export function upsertSubscription(userId: number, data: Partial<Subscription>) {
  const db = getDb()
  const existing = getSubscription(userId)

  if (existing) {
    const fields: string[] = []
    const values: any[] = []
    for (const [key, val] of Object.entries(data)) {
      if (key !== 'id' && key !== 'user_id' && key !== 'created_at') {
        fields.push(`${key} = ?`)
        values.push(val)
      }
    }
    fields.push("updated_at = datetime('now')")
    values.push(userId)
    db.prepare(`UPDATE subscriptions SET ${fields.join(', ')} WHERE user_id = ?`).run(...values)
  } else {
    db.prepare(`
      INSERT INTO subscriptions (user_id, plan, status, stripe_customer_id, stripe_subscription_id, coinbase_charge_id, payment_method, current_period_start, current_period_end)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      userId,
      data.plan || 'free',
      data.status || 'inactive',
      data.stripe_customer_id || null,
      data.stripe_subscription_id || null,
      data.coinbase_charge_id || null,
      data.payment_method || 'none',
      data.current_period_start || null,
      data.current_period_end || null,
    )
  }
}

// ── Credits ─────────────────────────────────────────────

export const INCLUDED_CREDITS = 5.0 // $5 included per month in Pro

export interface CreditUsageEntry {
  id: number
  user_id: number
  api_id: string
  api_name: string
  units: number
  cost_usd: number
  description: string | null
  created_at: string
}

/**
 * Deduct credits from a user's balance. Returns true if successful, false if insufficient.
 */
export function deductCredits(userId: number, apiId: string, apiName: string, units: number, costUsd: number, description?: string): boolean {
  const db = getDb()
  const sub = getSubscription(userId)
  if (!sub || sub.plan !== 'pro') return false

  // Check and reset if needed
  maybeResetCredits(userId)

  const updated = getSubscription(userId)!
  if (updated.credit_balance_usd < costUsd) return false

  const tx = db.transaction(() => {
    db.prepare(`
      UPDATE subscriptions
      SET credit_balance_usd = credit_balance_usd - ?,
          credits_used_this_month = credits_used_this_month + ?,
          updated_at = datetime('now')
      WHERE user_id = ?
    `).run(costUsd, costUsd, userId)

    db.prepare(`
      INSERT INTO credit_usage (user_id, api_id, api_name, units, cost_usd, description)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(userId, apiId, apiName, units, costUsd, description || null)
  })
  tx()
  return true
}

/**
 * Add credits to a user's balance (top-up).
 */
export function addCredits(userId: number, amount: number) {
  getDb().prepare(`
    UPDATE subscriptions
    SET credit_balance_usd = credit_balance_usd + ?,
        updated_at = datetime('now')
    WHERE user_id = ?
  `).run(amount, userId)
}

/**
 * Reset credits if the month has rolled over.
 */
export function maybeResetCredits(userId: number) {
  const sub = getSubscription(userId)
  if (!sub) return

  const now = new Date()
  const currentMonth = now.toISOString().slice(0, 7) // YYYY-MM
  const resetMonth = sub.credit_reset_date?.slice(0, 7)

  if (resetMonth !== currentMonth) {
    getDb().prepare(`
      UPDATE subscriptions
      SET credit_balance_usd = ?,
          credits_used_this_month = 0,
          credit_reset_date = datetime('now'),
          updated_at = datetime('now')
      WHERE user_id = ?
    `).run(INCLUDED_CREDITS, userId)
  }
}

/**
 * Get credit usage breakdown for the current month.
 */
export function getCreditUsageThisMonth(userId: number): {
  entries: { api_id: string; api_name: string; total_cost: number; total_units: number }[]
  total: number
} {
  const db = getDb()
  const month = new Date().toISOString().slice(0, 7)

  const entries = db.prepare(`
    SELECT api_id, api_name, SUM(cost_usd) as total_cost, SUM(units) as total_units
    FROM credit_usage
    WHERE user_id = ? AND substr(created_at, 1, 7) = ?
    GROUP BY api_id
    ORDER BY total_cost DESC
  `).all(userId, month) as { api_id: string; api_name: string; total_cost: number; total_units: number }[]

  const totalRow = db.prepare(`
    SELECT COALESCE(SUM(cost_usd), 0) as total
    FROM credit_usage
    WHERE user_id = ? AND substr(created_at, 1, 7) = ?
  `).get(userId, month) as { total: number }

  return { entries, total: totalRow.total }
}

export default getDb
