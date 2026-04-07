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
  type ChatMessage,
} from './db'

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
