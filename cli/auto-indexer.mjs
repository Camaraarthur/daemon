#!/usr/bin/env node
/**
 * Chat -> Project auto-indexer.
 *
 * Arthur has many chat threads spread across many projects. New conversations
 * land on the active project (often "untitled-XXXXXX"), drift from topic,
 * or belong to a sibling project. This bot reads the first few messages of
 * orphan/untitled threads and decides one of:
 *
 *   - rename          : thread lives in an auto-untitled project; suggest a
 *                       better display_name for that project (only if the
 *                       project has exactly one thread).
 *   - move_to_project : the thread clearly belongs to an existing, named
 *                       project — set chat_threads.project_id to that id.
 *   - new_project     : it's its own topic, unrelated to anything existing;
 *                       leave the untitled project but suggest a name.
 *   - leave           : can't tell / low confidence / throwaway test thread.
 *
 * Content lives on the device (~/.daemon/store.db, per CLAUDE.md).
 * Metadata (projects, chat_threads) lives on the relay
 * (/home/arthur/daemon/data/users.db). The indexer reads from both
 * (same machine) and writes back via direct SQL.
 *
 * Classification uses Claude Haiku via the `claude` CLI (Max subscription,
 * no ANTHROPIC_API_KEY). We strip the key before spawning, per
 * feedback_never_anthropic_api.md.
 *
 * Usage:
 *   node cli/auto-indexer.mjs --once       # one pass, then exit
 *   node cli/auto-indexer.mjs --watch      # loop every 5 minutes
 *   node cli/auto-indexer.mjs --user-id 3  # restrict to one user (default: all)
 *   node cli/auto-indexer.mjs --dry        # classify but don't write
 */

import { DatabaseSync } from 'node:sqlite'
import { spawn } from 'node:child_process'
import { existsSync, appendFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { userInfo } from 'node:os'

// ── Paths ─────────────────────────────────────────────────

const HOME = userInfo().homedir
const DEVICE_DB = `${HOME}/.daemon/store.db`
const RELAY_DB = `${HOME}/daemon/data/users.db`
const LOG_PATH = '/tmp/auto-indexer.log'

// ── Config ────────────────────────────────────────────────

const MIN_MESSAGES = 3            // need at least N messages before classifying
const MAX_THREADS_PER_RUN = 10    // budget
const LOOP_INTERVAL_MS = 5 * 60 * 1000  // 5 min
const CLAUDE_TIMEOUT_MS = 90_000
const CLAUDE_MODEL = 'haiku'
const READ_MESSAGES = 5           // first N messages sent to the classifier
const MAX_MESSAGE_CHARS = 600     // truncation per message

// ── Logging ───────────────────────────────────────────────

function log(...args) {
  const line = `[${new Date().toISOString()}] ${args.map((a) =>
    typeof a === 'string' ? a : JSON.stringify(a)
  ).join(' ')}`
  try {
    mkdirSync(dirname(LOG_PATH), { recursive: true })
    appendFileSync(LOG_PATH, line + '\n')
  } catch {}
  console.log(line)
}

// ── Args ──────────────────────────────────────────────────

function parseArgs(argv) {
  const args = { once: false, watch: false, dry: false, userId: null }
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--once') args.once = true
    else if (a === '--watch') args.watch = true
    else if (a === '--dry') args.dry = true
    else if (a === '--user-id' && argv[i + 1]) { args.userId = parseInt(argv[++i], 10) }
  }
  if (!args.once && !args.watch) args.once = true
  return args
}

// ── DB helpers ────────────────────────────────────────────

function openRelay() {
  if (!existsSync(RELAY_DB)) {
    throw new Error(`relay db not found at ${RELAY_DB}`)
  }
  const db = new DatabaseSync(RELAY_DB)
  db.exec('PRAGMA journal_mode = WAL')
  return db
}

function openDevice() {
  if (!existsSync(DEVICE_DB)) {
    throw new Error(`device db not found at ${DEVICE_DB}`)
  }
  const db = new DatabaseSync(DEVICE_DB)
  db.exec('PRAGMA journal_mode = WAL')
  return db
}

// ── Thread selection ──────────────────────────────────────

/**
 * A thread is a "candidate" for re-indexing if:
 *  - it has >= MIN_MESSAGES messages on the device
 *  - AND (project_id is NULL) OR (its project is an auto-slug "untitled-*"
 *         whose display_name is NULL or equals the slug)
 *  - AND we haven't classified it in the last 24h (idempotency via settings)
 */
function findCandidateThreads(relay, device, userId) {
  const threadsSql = userId
    ? `SELECT id, project_id, user_id, title FROM chat_threads WHERE user_id = ?`
    : `SELECT id, project_id, user_id, title FROM chat_threads`
  const threads = userId
    ? relay.prepare(threadsSql).all(userId)
    : relay.prepare(threadsSql).all()

  const projectsById = new Map()
  const projectsRows = relay.prepare(
    'SELECT id, user_id, name, display_name, parent_id FROM projects'
  ).all()
  for (const p of projectsRows) projectsById.set(p.id, p)

  const candidates = []
  for (const t of threads) {
    // Skip obvious test threads by id shape.
    if (/^test-/i.test(t.id)) continue

    // Condition: untitled-style project or no project.
    let projectIsUntitled = false
    if (t.project_id) {
      const p = projectsById.get(t.project_id)
      if (p && typeof p.name === 'string' && p.name.startsWith('untitled-')) {
        if (!p.display_name || p.display_name === p.name) {
          projectIsUntitled = true
        }
      }
    }
    const needsIndex = t.project_id == null || projectIsUntitled
    if (!needsIndex) continue

    // Count messages on the device.
    let cnt = 0
    try {
      const row = device.prepare(
        'SELECT COUNT(*) AS c FROM chat_messages WHERE thread_id = ?'
      ).get(String(t.id))
      cnt = row?.c || 0
    } catch {}
    if (cnt < MIN_MESSAGES) continue

    candidates.push({ thread: t, messageCount: cnt })
  }

  // Prefer threads with more content (more signal for the classifier).
  candidates.sort((a, b) => b.messageCount - a.messageCount)
  return candidates
}

/**
 * Load first READ_MESSAGES messages of a thread from the device store.
 * We skip tool-call-only rows and truncate each message body.
 */
function loadThreadSample(device, threadId) {
  const rows = device.prepare(
    `SELECT role, content
     FROM chat_messages
     WHERE thread_id = ? AND content IS NOT NULL AND content != ''
     ORDER BY created_at ASC
     LIMIT ?`
  ).all(String(threadId), Number(READ_MESSAGES))
  return rows.map((r) => ({
    role: r.role,
    content: String(r.content || '').slice(0, MAX_MESSAGE_CHARS),
  }))
}

// ── Claude classifier ─────────────────────────────────────

/**
 * Strip ANTHROPIC_API_KEY from spawned env — Arthur's Max subscription
 * must be the auth path (feedback_never_anthropic_api.md).
 */
function sanitizedEnv() {
  const env = { ...process.env }
  delete env.ANTHROPIC_API_KEY
  delete env.ANTHROPIC_AUTH_TOKEN
  return env
}

function buildPrompt(projects, messages) {
  // Named (non-untitled, non-archived) projects, compact one-line each.
  const lines = []
  for (const p of projects) {
    if (typeof p.name === 'string' && p.name.startsWith('untitled-')) continue
    const label = p.display_name || p.name
    lines.push(`  ${p.id}\t${label}`)
  }

  const convo = messages
    .map((m) => `[${m.role}] ${m.content}`)
    .join('\n')
    .slice(0, 4000)

  return `You are a chat classifier. Decide which project a conversation belongs to.

EXISTING PROJECTS (id, name):
${lines.join('\n') || '  (none)'}

CONVERSATION (first few messages):
${convo}

Return ONE LINE of strict JSON, no prose, no markdown. Schema:
{"action":"move_to_project"|"rename"|"new_project"|"leave","target_project_id":<int or null>,"suggested_name":<string or null>,"confidence":<0..1>,"reasoning":"<=20 words"}

Rules:
- "move_to_project" + target_project_id: the conversation is clearly about one listed project. Only if confidence >= 0.7.
- "rename": use when the conversation IS its own topic. Provide a 1-4 word suggested_name for the untitled placeholder.
- "new_project": alias for rename (choose rename; kept for back-compat).
- "leave": junk/test/unclear. Low-content greetings ("hi", "what is 2+2") => leave with confidence 0.
Output JSON only.`
}

function runClaude(prompt, text) {
  return new Promise((resolve) => {
    const child = spawn('claude', ['-p', prompt, '--model', CLAUDE_MODEL], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: sanitizedEnv(),
      timeout: CLAUDE_TIMEOUT_MS,
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (d) => { stdout += d.toString() })
    child.stderr.on('data', (d) => { stderr += d.toString() })
    child.on('error', (e) => resolve({ ok: false, error: String(e?.message || e) }))
    child.on('close', (code) => {
      if (code !== 0) {
        resolve({ ok: false, error: `claude exited ${code}: ${stderr.slice(0, 300)}` })
        return
      }
      resolve({ ok: true, text: stdout.trim() })
    })
    // Pipe extra context via stdin in case it helps (harmless if unused).
    try { child.stdin.write(text || ''); child.stdin.end() } catch {}
  })
}

function parseDecision(raw) {
  if (!raw) return null
  // Strip code fences if the model ignored instructions.
  let s = raw.trim()
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fence) s = fence[1].trim()
  // Find the first {...} JSON object.
  const first = s.indexOf('{')
  const last = s.lastIndexOf('}')
  if (first === -1 || last === -1 || last <= first) return null
  try {
    const obj = JSON.parse(s.slice(first, last + 1))
    const action = String(obj.action || '').toLowerCase()
    const validActions = new Set(['move_to_project', 'rename', 'new_project', 'leave'])
    if (!validActions.has(action)) return null
    return {
      action: action === 'new_project' ? 'rename' : action,
      target_project_id: Number.isInteger(obj.target_project_id) ? obj.target_project_id : null,
      suggested_name: obj.suggested_name ? String(obj.suggested_name).slice(0, 80) : null,
      confidence: typeof obj.confidence === 'number' ? obj.confidence : 0.5,
      reasoning: obj.reasoning ? String(obj.reasoning).slice(0, 200) : '',
    }
  } catch {
    return null
  }
}

// ── Write-back ────────────────────────────────────────────

function applyDecision(relay, thread, decision, userId, dry) {
  if (!decision) return { applied: false, reason: 'no-decision' }

  // Safety: never apply low-confidence non-leave actions.
  if (decision.confidence < 0.6 && decision.action !== 'leave') {
    return { applied: false, reason: `low-confidence(${decision.confidence})` }
  }

  if (decision.action === 'leave') {
    return { applied: true, reason: 'leave' }
  }

  if (decision.action === 'move_to_project') {
    if (!decision.target_project_id) return { applied: false, reason: 'no-target' }
    // Verify target belongs to the same user and is not itself untitled-*.
    const target = relay.prepare(
      'SELECT id, user_id, name, display_name FROM projects WHERE id = ? AND user_id = ?'
    ).get(decision.target_project_id, userId)
    if (!target) return { applied: false, reason: 'target-not-found' }
    if (typeof target.name === 'string' && target.name.startsWith('untitled-')) {
      return { applied: false, reason: 'target-is-untitled' }
    }
    if (dry) return { applied: true, reason: `would-move-to:${target.id}:${target.display_name || target.name}` }
    relay.prepare(
      'UPDATE chat_threads SET project_id = ? WHERE id = ? AND user_id = ?'
    ).run(decision.target_project_id, String(thread.id), userId)
    relay.prepare(
      "UPDATE projects SET last_active = datetime('now') WHERE id = ? AND user_id = ?"
    ).run(decision.target_project_id, userId)
    return { applied: true, reason: `moved->${target.id}:${target.display_name || target.name}` }
  }

  if (decision.action === 'rename') {
    // Only rename if the thread's current project is an untitled-* placeholder
    // AND the placeholder has no display_name yet.
    if (!thread.project_id) return { applied: false, reason: 'rename-needs-project' }
    const proj = relay.prepare(
      'SELECT id, name, display_name FROM projects WHERE id = ? AND user_id = ?'
    ).get(thread.project_id, userId)
    if (!proj) return { applied: false, reason: 'project-missing' }
    if (!(typeof proj.name === 'string' && proj.name.startsWith('untitled-'))) {
      return { applied: false, reason: 'not-untitled-placeholder' }
    }
    if (proj.display_name && proj.display_name !== proj.name) {
      return { applied: false, reason: 'already-named' }
    }
    const name = (decision.suggested_name || '').trim()
    if (!name) return { applied: false, reason: 'no-name' }
    if (dry) return { applied: true, reason: `would-rename-project-${proj.id}->${name}` }
    relay.prepare(
      'UPDATE projects SET display_name = ? WHERE id = ? AND user_id = ?'
    ).run(name, proj.id, userId)
    return { applied: true, reason: `renamed-project-${proj.id}->${name}` }
  }

  return { applied: false, reason: `unknown-action:${decision.action}` }
}

// ── Main pass ─────────────────────────────────────────────

async function indexOnce({ userId, dry }) {
  const relay = openRelay()
  const device = openDevice()
  const stats = { considered: 0, classified: 0, applied: 0, skipped: 0, errors: 0, decisions: [] }

  // Distinct user_ids to iterate.
  const userIds = userId
    ? [userId]
    : relay.prepare('SELECT DISTINCT user_id FROM chat_threads').all().map((r) => r.user_id)

  for (const uid of userIds) {
    const candidates = findCandidateThreads(relay, device, uid)
    log(`user ${uid}: ${candidates.length} candidate threads`)

    const budget = candidates.slice(0, MAX_THREADS_PER_RUN)
    const projects = relay.prepare(
      'SELECT id, name, display_name, settings FROM projects WHERE user_id = ?'
    ).all(uid).filter((p) => {
      try { return !JSON.parse(p.settings || '{}').archived } catch { return true }
    })

    for (const { thread } of budget) {
      stats.considered++
      try {
        const sample = loadThreadSample(device, thread.id)
        if (sample.length === 0) { stats.skipped++; continue }
        // Very short interactions are almost always tests.
        const totalChars = sample.reduce((n, m) => n + m.content.length, 0)
        if (totalChars < 40) {
          log(`thread ${thread.id.slice(0, 8)}: skip (totalChars=${totalChars})`)
          stats.skipped++
          continue
        }

        const prompt = buildPrompt(projects, sample)
        const res = await runClaude(prompt, '')
        if (!res.ok) {
          log(`thread ${thread.id.slice(0, 8)}: claude error: ${res.error}`)
          stats.errors++
          continue
        }
        const decision = parseDecision(res.text)
        stats.classified++
        if (!decision) {
          log(`thread ${thread.id.slice(0, 8)}: unparseable: ${res.text.slice(0, 200)}`)
          stats.errors++
          continue
        }

        const out = applyDecision(relay, thread, decision, uid, dry)
        log(`thread ${thread.id.slice(0, 8)} [${thread.title?.slice(0, 50) || ''}] => ${JSON.stringify({ decision, out })}`)
        stats.decisions.push({ thread_id: thread.id, title: thread.title, decision, out })
        if (out.applied) stats.applied++
        else stats.skipped++
      } catch (e) {
        log(`thread ${thread.id.slice(0, 8)}: exception: ${e?.message || e}`)
        stats.errors++
      }
    }
  }

  try { relay.close() } catch {}
  try { device.close() } catch {}
  log(`run complete: ${JSON.stringify(stats)}`)
  return stats
}

// ── Entry point ───────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv)
  log(`auto-indexer start: ${JSON.stringify(args)}`)

  if (args.once) {
    const stats = await indexOnce(args)
    // Print machine-readable summary last line so callers can parse.
    console.log('SUMMARY:' + JSON.stringify({
      considered: stats.considered,
      classified: stats.classified,
      applied: stats.applied,
      skipped: stats.skipped,
      errors: stats.errors,
    }))
    return
  }

  if (args.watch) {
    // Run immediately, then every LOOP_INTERVAL_MS.
    const tick = async () => {
      try { await indexOnce(args) }
      catch (e) { log(`watch tick error: ${e?.message || e}`) }
    }
    await tick()
    setInterval(tick, LOOP_INTERVAL_MS)
    // Keep process alive
    process.stdin.resume()
  }
}

main().catch((e) => {
  log(`fatal: ${e?.stack || e?.message || e}`)
  process.exit(1)
})
