/**
 * Claude Code JSONL bidirectional sync.
 *
 * Goal: when a daemon project is linked to a Claude Code project directory,
 * messages flow IN BOTH DIRECTIONS so the conversation in daemon's web UI
 * and the conversation in `claude` CLI in the terminal are literally the same
 * file.
 *
 * Architecture:
 *  - Each daemon project links to ~/.claude/projects/{flatPath}/{sessionId}.jsonl
 *  - On chat send: daemon writes user + assistant messages to BOTH SQLite
 *    AND appends to the JSONL in Claude Code's exact format
 *  - On project open: daemon reads any new JSONL entries since last sync
 *    and inserts them into SQLite (so messages typed in `claude` show up in
 *    the web UI)
 *  - For premium tier: daemon passes the active sessionId to `claude --resume`
 *    so the CLI continues writing to the same file
 *
 * Format reference: Claude Code v2.1.x
 *  - User msg: { parentUuid, isSidechain, promptId, type:"user", message:{role,content},
 *               uuid, timestamp, permissionMode, userType, entrypoint, cwd, sessionId,
 *               version, gitBranch }
 *  - Asst msg: { parentUuid, isSidechain, requestId, type:"assistant",
 *               message:{model, id, type:"message", role:"assistant",
 *                        content:[{type:"text",text:"..."}], stop_reason, stop_sequence,
 *                        usage}, uuid, timestamp, ..., sessionId, version, gitBranch }
 */

import * as fs from 'fs'
import * as path from 'path'
import { randomUUID } from 'crypto'
import {
  getClaudeCodeLink,
  upsertClaudeCodeLink,
  updateClaudeCodeLinkSync,
  addMessage,
  getThread,
  listThreads,
  listRecentMessages,
  getSessionCursor,
  upsertSessionCursor,
  getProject,
  type ChatMessage,
} from './db'
import { gossipChatMessage } from './ws-broadcast'

const CLAUDE_PROJECTS_ROOT = path.join(process.env.HOME || '/home/arthur', '.claude', 'projects')
const CLAUDE_VERSION = '2.1.90' // matches the format we read from
const HOSTNAME = process.env.HOSTNAME || 'arturito'

// ── Path mapping ─────────────────────────────────────────────

/**
 * Convert a local file path to a Claude Code project directory.
 *   /home/arthur/arturito → ~/.claude/projects/-home-arthur-arturito
 *   /home/arthur/daemon/web → ~/.claude/projects/-home-arthur-daemon-web
 */
export function localPathToClaudeProjectDir(localPath: string): string {
  // Claude Code replaces / with -, dropping leading slash but keeping it as a leading -
  const flat = localPath.replace(/\//g, '-')
  return path.join(CLAUDE_PROJECTS_ROOT, flat)
}

/**
 * Find the most recently modified .jsonl session in a Claude project directory.
 */
export function findLatestSession(claudeProjectDir: string): string | null {
  if (!fs.existsSync(claudeProjectDir)) return null
  try {
    const files = fs.readdirSync(claudeProjectDir)
      .filter(f => f.endsWith('.jsonl'))
      .map(f => {
        const full = path.join(claudeProjectDir, f)
        return { full, mtime: fs.statSync(full).mtimeMs, sessionId: f.replace('.jsonl', '') }
      })
      .sort((a, b) => b.mtime - a.mtime)
    return files[0]?.sessionId || null
  } catch {
    return null
  }
}

// ── JSONL parsing ────────────────────────────────────────────

interface JsonlUserMessage {
  type: 'user'
  uuid: string
  parentUuid: string | null
  timestamp: string
  message: { role: 'user'; content: string | Array<{ type: string; text?: string }> }
  sessionId: string
  cwd?: string
}

interface JsonlAssistantMessage {
  type: 'assistant'
  uuid: string
  parentUuid: string | null
  timestamp: string
  message: {
    model: string
    role: 'assistant'
    content: Array<{ type: string; text?: string }>
    usage?: { input_tokens?: number; output_tokens?: number }
  }
  sessionId: string
  cwd?: string
}

type JsonlMessage = JsonlUserMessage | JsonlAssistantMessage

function parseJsonl(filePath: string): JsonlMessage[] {
  if (!fs.existsSync(filePath)) return []
  const text = fs.readFileSync(filePath, 'utf-8')
  const out: JsonlMessage[] = []
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    try {
      const obj = JSON.parse(line)
      if (obj.type === 'user' || obj.type === 'assistant') {
        out.push(obj)
      }
    } catch {
      // Skip malformed lines silently — Claude Code sometimes writes partial lines
    }
  }
  return out
}

function extractContentText(msg: JsonlMessage): string {
  const content = msg.message?.content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .filter(p => p && (p.type === 'text' || p.type === 'output_text') && p.text)
      .map(p => p.text)
      .join('\n')
      .trim()
  }
  return ''
}

// ── Linking a project ────────────────────────────────────────

/**
 * Link a daemon project to its Claude Code project directory.
 * Auto-detects the latest session if there is one.
 */
export function linkProject(projectId: number, localPath: string): {
  claudeProjectDir: string
  sessionId: string | null
  exists: boolean
} {
  const claudeProjectDir = localPathToClaudeProjectDir(localPath)
  const exists = fs.existsSync(claudeProjectDir)
  const sessionId = exists ? findLatestSession(claudeProjectDir) : null
  upsertClaudeCodeLink(projectId, claudeProjectDir, sessionId)
  return { claudeProjectDir, sessionId, exists }
}

// ── Reading from JSONL into SQLite ───────────────────────────

/**
 * Sync new messages from the linked JSONL file into the daemon SQLite thread.
 * Returns the number of new messages imported.
 */
export function syncFromJsonl(projectId: number, threadId: string): number {
  const link = getClaudeCodeLink(projectId)
  if (!link || !link.enabled) return 0

  // Pick the most recently modified session in the dir (CC may have started a new one)
  const latestSession = findLatestSession(link.claude_project_dir)
  if (!latestSession) return 0

  const sessionFile = path.join(link.claude_project_dir, `${latestSession}.jsonl`)
  const messages = parseJsonl(sessionFile)
  if (messages.length === 0) return 0

  // Skip everything up to and including last_synced_uuid (or all if no sync yet)
  let startIdx = 0
  if (link.last_synced_uuid && latestSession === link.active_session_id) {
    const idx = messages.findIndex(m => m.uuid === link.last_synced_uuid)
    if (idx >= 0) startIdx = idx + 1
  }

  let imported = 0
  let lastUuid = link.last_synced_uuid
  for (let i = startIdx; i < messages.length; i++) {
    const m = messages[i]
    const text = extractContentText(m)
    if (!text) continue

    const role = m.type === 'assistant' ? 'assistant' : 'user'
    const model = m.type === 'assistant' ? m.message.model : null

    addMessage(threadId, {
      role,
      content: text,
      model: model || undefined,
    })
    imported++
    lastUuid = m.uuid
  }

  if (lastUuid) {
    updateClaudeCodeLinkSync(projectId, latestSession, lastUuid)
  }
  return imported
}

// ── Cross-directory sync (project-aware, cwd-based) ──────────
//
// A single Claude Code session can touch many cwds. The sync model that
// actually matches reality: scan ALL ~/.claude/projects/* JSONLs, find
// every session whose messages have cwd inside (or equal to) the project's
// local_path, and sync just those messages into the project's canonical
// thread. Per-(project, session) cursor so each project tracks its own
// progress through a shared session.

interface JsonlEntry {
  type: string
  uuid: string
  cwd?: string
  message?: any
  sessionId?: string
  timestamp?: string
}

function readJsonlEntries(filePath: string): JsonlEntry[] {
  if (!fs.existsSync(filePath)) return []
  let text: string
  try { text = fs.readFileSync(filePath, 'utf-8') } catch { return [] }
  const out: JsonlEntry[] = []
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    try {
      const obj = JSON.parse(line)
      if (obj && (obj.type === 'user' || obj.type === 'assistant')) out.push(obj)
    } catch {}
  }
  return out
}

function isCwdInside(cwd: string | undefined, root: string): boolean {
  if (!cwd) return false
  // Normalize trailing slash
  const r = root.endsWith('/') ? root.slice(0, -1) : root
  return cwd === r || cwd.startsWith(r + '/')
}

/**
 * Convert an ISO-8601 timestamp from a JSONL entry to SQLite's
 * "YYYY-MM-DD HH:MM:SS" format. Drops timezone — SQLite stores naive UTC,
 * which matches the rest of the schema's `datetime('now')` defaults.
 */
function jsonlTimestampToSqlite(iso: string): string {
  // "2026-04-07T16:11:23.456Z" → "2026-04-07 16:11:23"
  const t = iso.replace('T', ' ').replace(/\.\d+Z?$/, '').replace(/Z$/, '')
  return t
}

function entryText(e: JsonlEntry): string {
  const content = e.message?.content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .filter((p: any) => p && (p.type === 'text' || p.type === 'output_text') && p.text)
      .map((p: any) => p.text)
      .join('\n')
      .trim()
  }
  return ''
}

// Tiny cache so a burst of API calls doesn't re-scan the same JSONLs.
// Keyed by localPath. TTL is short — we want freshness, not perf.
const SESSION_SCAN_CACHE = new Map<string, { at: number; result: Array<{ jsonlPath: string; sessionId: string; mtime: number }> }>()
const SESSION_SCAN_TTL_MS = 4_000

/**
 * Find every Claude Code session JSONL containing at least one message
 * whose cwd is inside `localPath`. Returns descriptors sorted by mtime
 * (newest first).
 *
 * Implementation: a session can start in one cwd and `cd` somewhere else
 * later (a single 12 MB session may touch 7+ different directories), so
 * the prefilter has to look at the WHOLE file, not just the head. We
 * use a substring match on the raw bytes — that's cheap (~tens of ms per
 * 12 MB file) and avoids JSON-parsing files that don't mention the path.
 */
export function findSessionsForLocalPath(localPath: string): Array<{
  jsonlPath: string
  sessionId: string
  mtime: number
}> {
  if (!fs.existsSync(CLAUDE_PROJECTS_ROOT)) return []

  const cached = SESSION_SCAN_CACHE.get(localPath)
  if (cached && Date.now() - cached.at < SESSION_SCAN_TTL_MS) return cached.result

  const results: Array<{ jsonlPath: string; sessionId: string; mtime: number }> = []
  let dirs: string[] = []
  try { dirs = fs.readdirSync(CLAUDE_PROJECTS_ROOT) } catch { return [] }

  // The cwd field in JSONL is JSON-encoded as `"cwd":"<path>"` — substring
  // match on that exact form catches both the project root and any subdir
  // (cwd values like `/home/arthur/daemon/web` will contain `/home/arthur/daemon`).
  const needle = `"cwd":"${localPath}`

  for (const dir of dirs) {
    const dirPath = path.join(CLAUDE_PROJECTS_ROOT, dir)
    let files: string[] = []
    try { files = fs.readdirSync(dirPath).filter(f => f.endsWith('.jsonl')) } catch { continue }
    for (const f of files) {
      const full = path.join(dirPath, f)
      try {
        const stat = fs.statSync(full)
        // Skip enormous files we definitely couldn't have touched (>200MB).
        if (stat.size > 200 * 1024 * 1024) continue
        // Read whole file as a buffer and substring-search. Faster than
        // parsing per-line and good enough as a prefilter.
        const buf = fs.readFileSync(full)
        if (buf.indexOf(needle) === -1) continue
        results.push({
          jsonlPath: full,
          sessionId: f.replace('.jsonl', ''),
          mtime: stat.mtimeMs,
        })
      } catch {
        continue
      }
    }
  }

  results.sort((a, b) => b.mtime - a.mtime)
  SESSION_SCAN_CACHE.set(localPath, { at: Date.now(), result: results })
  return results
}

/**
 * Pull every new message into the project's canonical thread from EVERY
 * Claude Code session that has messages with cwd inside the project's
 * local_path. Returns the number of messages imported across all sessions.
 *
 * This is the function that should run on:
 *  - chat send (immediately before adding the user message)
 *  - chat history GET (so opening a project in the web shows live JSONL)
 *  - project link
 */
export function syncProjectFromAllSessions(
  projectId: number,
  threadId: string,
  localPath: string,
): number {
  if (!localPath) return 0
  const sessions = findSessionsForLocalPath(localPath)
  if (sessions.length === 0) return 0

  // Cross-session dedup: the same message can appear in multiple JSONLs
  // when a Claude session is resumed in a different cwd, or when our own
  // appendUserMessage / appendAssistantMessage echoes to JSONL. Build a
  // Set of recent (role, content-prefix) hashes from the thread once,
  // and skip any incoming message that matches.
  const dedupKey = (role: string, content: string) =>
    `${role}|${content.slice(0, 500)}`
  const seen = new Set<string>()
  try {
    for (const m of listRecentMessages(threadId, 4000)) {
      if (m.content) seen.add(dedupKey(m.role, m.content))
    }
  } catch {}

  let totalImported = 0
  for (const sess of sessions) {
    const cursor = getSessionCursor(projectId, sess.sessionId)
    const entries = readJsonlEntries(sess.jsonlPath)
    if (entries.length === 0) continue

    // Find the start index (after the cursor's last_uuid).
    let startIdx = 0
    if (cursor?.last_uuid) {
      const idx = entries.findIndex(e => e.uuid === cursor.last_uuid)
      if (idx >= 0) startIdx = idx + 1
    }

    let lastUuid = cursor?.last_uuid || ''
    for (let i = startIdx; i < entries.length; i++) {
      const e = entries[i]
      // Only sync messages whose cwd is inside this project's local_path
      if (!isCwdInside(e.cwd, localPath)) continue
      const text = entryText(e)
      if (!text) continue

      const role = e.type === 'assistant' ? 'assistant' : 'user'
      const key = dedupKey(role, text)
      if (seen.has(key)) {
        // Already in the thread (from another session or a previous run) —
        // advance the cursor but don't insert.
        lastUuid = e.uuid
        continue
      }

      const model = e.type === 'assistant' ? (e.message?.model as string | undefined) : undefined
      try {
        addMessage(threadId, {
          role,
          content: text,
          model: model || undefined,
          // Tag with the JSONL session id so the UI can show ONE conversation
          // per session instead of dumping 70+ sessions worth of messages.
          source_session_id: e.sessionId || sess.sessionId,
          // Preserve the original JSONL timestamp so chronological ordering
          // across sessions is correct (otherwise batch imports collapse to
          // a single 'now' and the latest-session view picks the wrong one).
          created_at: e.timestamp ? jsonlTimestampToSqlite(e.timestamp) : undefined,
        })
        seen.add(key)
        totalImported++
      } catch {}
      lastUuid = e.uuid
    }

    if (lastUuid) {
      upsertSessionCursor(projectId, sess.sessionId, sess.jsonlPath, lastUuid)
    }
  }
  return totalImported
}

/**
 * Convenience: sync using the project's stored local_path.
 */
export function syncProjectById(projectId: number, threadId: string, userId: number): number {
  const proj = getProject(userId, projectId)
  if (!proj || !proj.local_path) return 0
  return syncProjectFromAllSessions(projectId, threadId, proj.local_path)
}

// ── Bound-session sync (the model the user actually wants) ───
//
// Cwd-matching is the wrong signal when many conversations happen in the
// same directory. The right model is an EXPLICIT one-to-one binding:
//
//   project ↔ exactly one Claude Code session id
//
// Sync pulls only from that session, writes go to that session, and
// switching projects in the terminal means the user (or daemon) re-binds.
// This function reflects that.

/**
 * Locate a Claude Code JSONL anywhere under ~/.claude/projects by its
 * session id. The file is named `{sessionId}.jsonl` regardless of which
 * project directory it lives in, so we can find it with a single readdir
 * across the project root.
 */
export function findJsonlForSessionId(sessionId: string): string | null {
  if (!fs.existsSync(CLAUDE_PROJECTS_ROOT)) return null
  let dirs: string[] = []
  try { dirs = fs.readdirSync(CLAUDE_PROJECTS_ROOT) } catch { return null }
  for (const dir of dirs) {
    const candidate = path.join(CLAUDE_PROJECTS_ROOT, dir, `${sessionId}.jsonl`)
    if (fs.existsSync(candidate)) return candidate
  }
  return null
}

/**
 * Sync messages from a single bound JSONL session into a project's
 * canonical thread. Tags every imported row with `source_session_id` and
 * preserves the original JSONL timestamps so chronological ordering is
 * accurate.
 *
 * Returns the number of new messages imported.
 */
export function syncProjectFromBoundSession(
  projectId: number,
  threadId: string,
  sessionId: string,
  userId?: number,
): number {
  const jsonlPath = findJsonlForSessionId(sessionId)
  if (!jsonlPath) return 0

  const entries = readJsonlEntries(jsonlPath)
  if (entries.length === 0) return 0

  const cursor = getSessionCursor(projectId, sessionId)
  let startIdx = 0
  if (cursor?.last_uuid) {
    const idx = entries.findIndex(e => e.uuid === cursor.last_uuid)
    if (idx >= 0) startIdx = idx + 1
  }

  // Cross-source dedup. We may have legacy rows from earlier cwd-based sync;
  // don't re-add identical (role, content) tuples.
  const dedupKey = (role: string, content: string) =>
    `${role}|${content.slice(0, 500)}`
  const seen = new Set<string>()
  try {
    for (const m of listRecentMessages(threadId, 4000)) {
      if (m.content) seen.add(dedupKey(m.role, m.content))
    }
  } catch {}

  let imported = 0
  let lastUuid = cursor?.last_uuid || ''
  for (let i = startIdx; i < entries.length; i++) {
    const e = entries[i]
    const text = entryText(e)
    if (!text) continue
    const role = e.type === 'assistant' ? 'assistant' : 'user'
    const key = dedupKey(role, text)
    if (seen.has(key)) {
      lastUuid = e.uuid
      continue
    }
    const model = e.type === 'assistant' ? (e.message?.model as string | undefined) : undefined
    const createdAt = e.timestamp ? jsonlTimestampToSqlite(e.timestamp) : undefined
    try {
      const saved = addMessage(threadId, {
        role,
        content: text,
        model: model || undefined,
        source_session_id: sessionId,
        created_at: createdAt,
      })
      // The Claude Code sync writes to the relay's DB via addMessage,
      // but the messages API reads from the DEVICE (Step 8). Without
      // gossiping, these messages are orphaned on the relay and the
      // user sees "no conversation history." Gossip each imported
      // message so it lands in ~/.daemon/store.db on the device.
      if (userId && saved) {
        gossipChatMessage(userId, {
          id: saved.id,
          thread_id: threadId,
          role,
          content: text,
          model: model || null,
          created_at: createdAt || new Date().toISOString().replace('T', ' ').slice(0, 19),
          source_session_id: sessionId,
          complete: true,
          project_id: projectId,
        })
      }
      seen.add(key)
      imported++
    } catch {}
    lastUuid = e.uuid
  }

  if (lastUuid) {
    upsertSessionCursor(projectId, sessionId, jsonlPath, lastUuid)
  }
  // Keep claude_code_links.last_synced_uuid in step too — `getResumeSessionId`
  // and the link UI both read it.
  try { updateClaudeCodeLinkSync(projectId, sessionId, lastUuid) } catch {}
  return imported
}

/**
 * Auto-pick the best Claude Code session to bind to a project that has no
 * binding yet. Heuristic: the most recently modified JSONL whose cwd has
 * ever been inside the project's local_path. This is the bootstrap case
 * — once a binding exists, we never override it.
 */
export function autoBindProjectSession(projectId: number, localPath: string): string | null {
  const sessions = findSessionsForLocalPath(localPath)
  if (sessions.length === 0) return null
  const best = sessions[0]
  const link = getClaudeCodeLink(projectId)
  upsertClaudeCodeLink(
    projectId,
    link?.claude_project_dir || path.dirname(best.jsonlPath),
    best.sessionId,
  )
  return best.sessionId
}

/**
 * Top-level entrypoint for the messages route and chat send. Ensures a
 * binding exists, then pulls only from that bound session. Returns the
 * bound session id (or null if nothing could be bound).
 */
export function syncBoundProject(
  projectId: number,
  threadId: string,
  localPath: string | null,
  userId?: number,
): { sessionId: string | null; imported: number } {
  let link = getClaudeCodeLink(projectId)
  let sessionId = link?.enabled ? link.active_session_id : null

  // Auto-bind on first use if we have a local_path to scan from.
  if (!sessionId && localPath) {
    sessionId = autoBindProjectSession(projectId, localPath)
    link = getClaudeCodeLink(projectId)
  }

  if (!sessionId) return { sessionId: null, imported: 0 }

  const imported = syncProjectFromBoundSession(projectId, threadId, sessionId, userId)
  return { sessionId, imported }
}

// ── Writing from daemon back to JSONL ────────────────────────

/**
 * Append a user message to the linked Claude Code JSONL session.
 * Creates the directory and a new session file if none exists.
 * Returns the uuid of the appended message (so the next assistant
 * message can use it as parentUuid).
 */
export function appendUserMessage(
  projectId: number,
  content: string,
  cwd: string,
): string | null {
  const link = getClaudeCodeLink(projectId)
  if (!link || !link.enabled) return null

  // Ensure directory exists
  try {
    fs.mkdirSync(link.claude_project_dir, { recursive: true })
  } catch {
    return null
  }

  // Pick or create a session
  let sessionId = link.active_session_id || findLatestSession(link.claude_project_dir)
  if (!sessionId) {
    sessionId = randomUUID()
    upsertClaudeCodeLink(projectId, link.claude_project_dir, sessionId)
  }

  const sessionFile = path.join(link.claude_project_dir, `${sessionId}.jsonl`)

  // Get parentUuid from last message in file (if any)
  let parentUuid: string | null = null
  if (fs.existsSync(sessionFile)) {
    const existing = parseJsonl(sessionFile)
    if (existing.length > 0) {
      parentUuid = existing[existing.length - 1].uuid
    }
  }

  const uuid = randomUUID()
  const entry = {
    parentUuid,
    isSidechain: false,
    promptId: randomUUID(),
    type: 'user',
    message: { role: 'user', content },
    uuid,
    timestamp: new Date().toISOString(),
    permissionMode: 'bypassPermissions',
    userType: 'external',
    entrypoint: 'cli',
    cwd,
    sessionId,
    version: CLAUDE_VERSION,
    gitBranch: 'HEAD',
  }

  try {
    fs.appendFileSync(sessionFile, JSON.stringify(entry) + '\n')
    return uuid
  } catch {
    return null
  }
}

/**
 * Append an assistant message to the linked Claude Code JSONL session.
 */
export function appendAssistantMessage(
  projectId: number,
  content: string,
  parentUuid: string | null,
  model: string,
): string | null {
  const link = getClaudeCodeLink(projectId)
  if (!link || !link.enabled) return null

  let sessionId = link.active_session_id || findLatestSession(link.claude_project_dir)
  if (!sessionId) return null

  const sessionFile = path.join(link.claude_project_dir, `${sessionId}.jsonl`)
  if (!fs.existsSync(sessionFile)) return null

  // If no parentUuid was passed, use the last message in the file
  if (!parentUuid) {
    const existing = parseJsonl(sessionFile)
    if (existing.length > 0) parentUuid = existing[existing.length - 1].uuid
  }

  const uuid = randomUUID()
  const entry = {
    parentUuid,
    isSidechain: false,
    requestId: `req_${uuid.replace(/-/g, '').slice(0, 24)}`,
    type: 'assistant',
    message: {
      model,
      id: `msg_${uuid.replace(/-/g, '').slice(0, 24)}`,
      type: 'message',
      role: 'assistant',
      content: [{ type: 'text', text: content }],
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: { input_tokens: 0, output_tokens: 0 },
    },
    uuid,
    timestamp: new Date().toISOString(),
    userType: 'external',
    entrypoint: 'cli',
    cwd: '',
    sessionId,
    version: CLAUDE_VERSION,
    gitBranch: 'HEAD',
  }

  try {
    fs.appendFileSync(sessionFile, JSON.stringify(entry) + '\n')
    // Update the sync cursor so we don't re-import what we just wrote
    updateClaudeCodeLinkSync(projectId, sessionId, uuid)
    return uuid
  } catch {
    return null
  }
}

/**
 * Get the active Claude Code session ID for a daemon project, suitable
 * for passing to `claude --resume {sessionId}`.
 */
export function getResumeSessionId(projectId: number): string | null {
  const link = getClaudeCodeLink(projectId)
  if (!link || !link.enabled) return null
  return link.active_session_id || findLatestSession(link.claude_project_dir)
}
