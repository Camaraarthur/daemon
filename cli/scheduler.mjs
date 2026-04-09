/**
 * Scheduler primitive (vision.md §3.3).
 *
 * "Every <cron>, run <prompt> in this chat thread." The agent registers
 * schedules via the schedule() tool. The device's tick loop fires due
 * schedules by POSTing the relay's /api/schedule/fire endpoint with the
 * device_token + schedule name. The relay then runs an agent loop with
 * the schedule's prompt as a fresh user message in the tagged thread,
 * and the result is gossiped back as chat messages.
 *
 * Cron parser: minimal 5-field spec (minute hour day-of-month month
 * day-of-week). Supports star, step (slash-N), N, N-M, comma lists,
 * and combinations. NO seconds field, NO @reboot, NO timezone — UTC.
 *
 * Tick interval: 30 seconds. A schedule fires within ~30s of its
 * scheduled minute, which is fine for the "morning briefing" /
 * "every hour" use cases this primitive targets.
 *
 * Why no node-cron dep: zero-deps is a hard rule (vision.md §11). The
 * cron grammar we support is small enough to write in 60 lines.
 */

import { getStore } from './store.mjs'

// ── Cron parser ────────────────────────────────────────────

const FIELD_RANGES = [
  [0, 59],   // minute
  [0, 23],   // hour
  [1, 31],   // day-of-month
  [1, 12],   // month
  [0, 6],    // day-of-week (0 = Sunday)
]

function parseField(field, [min, max]) {
  // Returns a Set<number> of allowed values for this field.
  const values = new Set()
  for (const part of field.split(',')) {
    let step = 1
    let range = part
    if (part.includes('/')) {
      const [r, s] = part.split('/')
      range = r
      step = parseInt(s, 10)
      if (isNaN(step) || step < 1) throw new Error(`bad cron step: ${part}`)
    }
    let lo, hi
    if (range === '*') {
      lo = min
      hi = max
    } else if (range.includes('-')) {
      const [a, b] = range.split('-').map((n) => parseInt(n, 10))
      lo = a
      hi = b
    } else {
      lo = parseInt(range, 10)
      hi = lo
    }
    if (isNaN(lo) || isNaN(hi) || lo < min || hi > max || lo > hi) {
      throw new Error(`bad cron field: ${part} (range ${min}-${max})`)
    }
    for (let v = lo; v <= hi; v += step) values.add(v)
  }
  return values
}

export function parseCron(cron) {
  if (typeof cron !== 'string') throw new Error('cron must be a string')
  const fields = cron.trim().split(/\s+/)
  if (fields.length !== 5) {
    throw new Error(`cron must be 5 fields (got ${fields.length}): "${cron}"`)
  }
  return fields.map((f, i) => parseField(f, FIELD_RANGES[i]))
}

/**
 * Compute the next time after `from` (a Date) at which a cron expression
 * fires. Walks minute-by-minute up to ~366 days ahead before giving up.
 * UTC throughout. Returns a Date.
 */
export function nextRun(cron, from = new Date()) {
  const [mins, hrs, doms, mons, dows] = parseCron(cron)
  // Start at the next minute boundary after `from`.
  const t = new Date(from.getTime())
  t.setUTCSeconds(0, 0)
  t.setUTCMinutes(t.getUTCMinutes() + 1)

  const maxIter = 366 * 24 * 60
  for (let i = 0; i < maxIter; i++) {
    if (
      mins.has(t.getUTCMinutes()) &&
      hrs.has(t.getUTCHours()) &&
      doms.has(t.getUTCDate()) &&
      mons.has(t.getUTCMonth() + 1) &&
      dows.has(t.getUTCDay())
    ) {
      return t
    }
    t.setUTCMinutes(t.getUTCMinutes() + 1)
  }
  throw new Error(`no next run found for cron "${cron}" within 366 days`)
}

// ── Schedule store API ─────────────────────────────────────

function isoNow() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19)
}

function isoFrom(date) {
  return date.toISOString().replace('T', ' ').slice(0, 19)
}

/**
 * Idempotent create-or-update. Validates the cron expression first;
 * throws if it's invalid (the agent's tool dispatcher catches and
 * returns the error to the model).
 */
export function createSchedule({ name, cron, prompt, thread_id, project_id, enabled = true }) {
  if (!name || typeof name !== 'string') throw new Error('name required')
  if (name.length > 64) throw new Error('name too long (max 64)')
  if (!cron || typeof cron !== 'string') throw new Error('cron required')
  if (!prompt || typeof prompt !== 'string') throw new Error('prompt required')
  if (prompt.length > 4000) throw new Error('prompt too long (max 4000)')

  // Validate + compute first run
  const next = nextRun(cron)

  const db = getStore()
  db.prepare(
    `INSERT INTO schedules
       (name, cron, prompt, thread_id, project_id, enabled,
        updated_at, next_run_at, run_count)
     VALUES (?, ?, ?, ?, ?, ?, datetime('now'), ?, 0)
     ON CONFLICT(name) DO UPDATE SET
       cron = excluded.cron,
       prompt = excluded.prompt,
       thread_id = excluded.thread_id,
       project_id = excluded.project_id,
       enabled = excluded.enabled,
       updated_at = datetime('now'),
       next_run_at = excluded.next_run_at`,
  ).run(
    name,
    cron,
    prompt,
    thread_id || null,
    project_id == null ? null : Number(project_id),
    enabled ? 1 : 0,
    isoFrom(next),
  )
  return { ok: true, name, next_run_at: isoFrom(next) }
}

export function listSchedules() {
  return getStore()
    .prepare(
      `SELECT name, cron, prompt, thread_id, project_id, enabled,
              created_at, updated_at, last_run_at, next_run_at,
              run_count, last_error
       FROM schedules ORDER BY next_run_at ASC`,
    )
    .all()
    .map((r) => ({ ...r, enabled: !!r.enabled }))
}

export function getSchedule(name) {
  const r = getStore().prepare('SELECT * FROM schedules WHERE name = ?').get(name)
  if (!r) return null
  return { ...r, enabled: !!r.enabled }
}

export function deleteSchedule(name) {
  const r = getStore().prepare('DELETE FROM schedules WHERE name = ?').run(name)
  return r.changes > 0
}

export function setEnabled(name, enabled) {
  const r = getStore()
    .prepare(
      `UPDATE schedules SET enabled = ?, updated_at = datetime('now') WHERE name = ?`,
    )
    .run(enabled ? 1 : 0, name)
  return r.changes > 0
}

/**
 * Pick all schedules that are due (next_run_at <= now and enabled).
 * The tick loop calls this, fires each, then advances next_run_at.
 */
function pickDue() {
  return getStore()
    .prepare(
      `SELECT * FROM schedules
       WHERE enabled = 1 AND next_run_at <= datetime('now')
       ORDER BY next_run_at ASC LIMIT 50`,
    )
    .all()
}

function markFired(name, cronExpr, error = null) {
  let next
  try {
    next = nextRun(cronExpr)
  } catch (e) {
    // If the cron is somehow now invalid, disable it so we don't loop.
    getStore()
      .prepare(
        `UPDATE schedules SET enabled = 0, last_error = ?, updated_at = datetime('now') WHERE name = ?`,
      )
      .run(`cron parse failed: ${e.message}`, name)
    return
  }
  getStore()
    .prepare(
      `UPDATE schedules
       SET last_run_at = datetime('now'),
           next_run_at = ?,
           run_count = run_count + 1,
           last_error = ?,
           updated_at = datetime('now')
       WHERE name = ?`,
    )
    .run(isoFrom(next), error, name)
}

// ── Tick loop ──────────────────────────────────────────────

let _tickTimer = null
const TICK_MS = 30_000

/**
 * Start the device's scheduler tick. The fire callback receives the
 * row (with prompt, thread_id, etc.) and is responsible for waking the
 * relay's agent loop. We pass it in (instead of importing fetch here)
 * so the daemon process owns the auth + endpoint config.
 *
 * The fire callback is awaited per-schedule to avoid hammering the
 * relay. If it throws, we record the error against the schedule but
 * still advance next_run_at so we don't tightspin.
 */
export function startScheduler({ fire, log = console.log }) {
  if (_tickTimer) return
  const tick = async () => {
    let due
    try {
      due = pickDue()
    } catch (e) {
      log(`[scheduler] tick: pickDue failed: ${e.message}`)
      return
    }
    for (const row of due) {
      log(`[scheduler] firing: ${row.name} (cron="${row.cron}")`)
      let error = null
      try {
        await fire(row)
      } catch (e) {
        error = String(e?.message || e)
        log(`[scheduler] fire failed for ${row.name}: ${error}`)
      }
      try {
        markFired(row.name, row.cron, error)
      } catch (e) {
        log(`[scheduler] markFired failed for ${row.name}: ${e.message}`)
      }
    }
  }
  // Run once immediately so freshly-due rows fire on daemon start.
  tick().catch(() => {})
  _tickTimer = setInterval(() => {
    tick().catch(() => {})
  }, TICK_MS)
}

export function stopScheduler() {
  if (_tickTimer) {
    clearInterval(_tickTimer)
    _tickTimer = null
  }
}
