/**
 * System-prompt scaffolding (vision §5).
 *
 * The meta-primitive: every agent turn starts with a generated block
 * enumerating EVERY daemon primitive available to the user, with
 * current state. Without this, the model has to guess that get_secret
 * / schedule / notify exist and what's already registered.
 *
 * Hard budget: ≤ 2000 chars (architecture critic finding C-3). Sections
 * that are empty are omitted. Sections that overflow are truncated
 * with a "(N more)" suffix.
 *
 * The block is best-effort: if the device is offline, we omit the
 * device-resident sections rather than failing the whole turn. The
 * agent already gets a "no devices online" hint from agent-loop.
 */

import { listSecrets as deviceListSecretsFn } from './device-secrets'
import { listSchedules as deviceListSchedulesFn, type ScheduleRow } from './device-schedules'
import { deviceListBlocks } from './device-memory'

const SECTION_CHAR_BUDGET = 600
const TOTAL_CHAR_BUDGET = 2000

interface ScaffoldOpts {
  userId: number
  projectId?: number | null
  deviceCount: number
  /** Whether the user has any push subscriptions registered. */
  notificationsActive?: boolean
}

interface Section {
  title: string
  body: string
  /** Higher = more important. Lower-priority sections drop first if budget tight. */
  priority: number
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s
  return s.slice(0, max - 3) + '...'
}

function bullet(items: string[], maxChars = SECTION_CHAR_BUDGET): string {
  const lines: string[] = []
  let used = 0
  for (let i = 0; i < items.length; i++) {
    const line = `- ${items[i]}`
    if (used + line.length + 1 > maxChars) {
      const remaining = items.length - i
      lines.push(`- (${remaining} more — call list_* to see all)`)
      break
    }
    lines.push(line)
    used += line.length + 1
  }
  return lines.join('\n')
}

async function safe<T>(p: Promise<T>, fallback: T): Promise<T> {
  try {
    return await p
  } catch {
    return fallback
  }
}

/**
 * Build the daemon environment block. Returns an empty string if there's
 * nothing useful to surface (no devices, no project, no secrets, etc.) —
 * the caller can then skip prepending it.
 */
export async function buildScaffold(opts: ScaffoldOpts): Promise<string> {
  const sections: Section[] = []

  // ── Memory blocks (device-resident, project-scoped) ────
  if (opts.projectId) {
    const blocks = await safe(
      deviceListBlocks({ userId: opts.userId, projectId: opts.projectId }),
      { ok: false, blocks: [] as Array<{ label: string; content: string; max_chars: number; updated_at: string }> },
    )
    if (blocks.ok && blocks.blocks && blocks.blocks.length > 0) {
      const lines = blocks.blocks
        .filter((b) => b.content && b.content.trim().length > 0)
        .map((b) => {
          const preview = truncate(b.content.replace(/\s+/g, ' ').trim(), 120)
          return `${b.label} (${b.content.length}/${b.max_chars}): ${preview}`
        })
      if (lines.length > 0) {
        sections.push({
          title: 'Memory blocks (always loaded — call update_memory_block to edit)',
          body: bullet(lines),
          priority: 90,
        })
      }
    }
  }

  // ── Secrets (device vault + platform broker, names only) ──
  const secrets = await safe(deviceListSecretsFn({ userId: opts.userId }), {
    ok: false,
    secrets: [] as Array<{ name: string; source: 'user' | 'platform'; category: string | null; description: string | null; available: boolean }>,
  })
  if (secrets.ok && secrets.secrets.length > 0) {
    const userSecrets = secrets.secrets.filter((s) => s.source === 'user')
    const platformSecrets = secrets.secrets.filter((s) => s.source === 'platform')
    const lines: string[] = []
    if (userSecrets.length > 0) {
      lines.push(`User vault (${userSecrets.length}): ${userSecrets.map((s) => s.name).join(', ')}`)
    }
    if (platformSecrets.length > 0) {
      lines.push(
        `Platform broker (${platformSecrets.length}): ${platformSecrets
          .map((s) => `${s.name}${s.available ? '' : ' [unavailable]'}`)
          .join(', ')}`,
      )
    }
    sections.push({
      title: 'Secrets (names only — call get_secret(name) to retrieve)',
      body: bullet(lines),
      priority: 80,
    })
  }

  // ── Schedules (device-resident) ────────────────────────
  const schedules = await safe(deviceListSchedulesFn({ userId: opts.userId }), {
    ok: false,
    schedules: [] as ScheduleRow[],
  })
  if (schedules.ok && schedules.schedules.length > 0) {
    const active = schedules.schedules.filter((s) => s.enabled)
    if (active.length > 0) {
      const lines = active.map((s) => {
        const promptPreview = truncate(s.prompt.replace(/\s+/g, ' ').trim(), 60)
        return `${s.name}: cron "${s.cron}" → "${promptPreview}" (next ${s.next_run_at}, runs ${s.run_count})`
      })
      sections.push({
        title: 'Schedules (active — call cancel_schedule(name) to remove)',
        body: bullet(lines),
        priority: 70,
      })
    }
  }

  // ── Notifications status ────────────────────────────────
  if (opts.notificationsActive !== undefined) {
    sections.push({
      title: 'Notifications',
      body: opts.notificationsActive
        ? '- ACTIVE: notify(title, body) will push to the user\'s registered browsers'
        : '- INACTIVE: no push subscriptions yet. Tell the user to enable notifications in the daemon web app before relying on notify().',
      priority: 60,
    })
  }

  // ── Primitives reference (always last, always shown) ───
  // This is the "discoverability" line that lets the model know what
  // tools to reach for. Kept terse — full schemas are in the tool defs.
  const primitivesLine = [
    'notify(title, body, url?) — push to user\'s browsers',
    'schedule(name, cron, prompt) — recurring agent run',
    'get_secret(name) / set_secret(name, value) — encrypted vault',
    opts.projectId
      ? 'remember(category, content) / recall(query) / update_memory_block(label, content)'
      : null,
  ].filter(Boolean) as string[]
  sections.push({
    title: 'Primitives you can call directly without asking',
    body: bullet(primitivesLine),
    priority: 100,
  })

  // ── Hard rules (always last) ────────────────────────────
  sections.push({
    title: 'Hard rules',
    body: [
      '1. When a primitive exists for the user\'s request, use it. Do not write a script when there\'s a tool.',
      '2. Auto-remember important paths the user mentions: update_memory_block("paths", ...). Never re-investigate a path you (or any prior session) have already found.',
      '3. Secrets are NEVER printed back, NEVER logged, NEVER committed. Use them inline (auth headers, env vars) and discard.',
      '4. The user\'s data lives on their devices. Never upload it to the relay.',
    ].join('\n'),
    priority: 110,
  })

  if (sections.length === 0) return ''

  // Build the block, dropping low-priority sections if we go over budget.
  // Priorities: rules (110), primitives (100), memory (90), secrets (80),
  // schedules (70), notifications (60). The first two are required.
  const sorted = [...sections].sort((a, b) => b.priority - a.priority)
  const kept: Section[] = []
  let used = 0
  const HEADER = '## Daemon environment\n\n'
  used += HEADER.length
  for (const s of sorted) {
    const block = `### ${s.title}\n${s.body}\n\n`
    if (used + block.length > TOTAL_CHAR_BUDGET) {
      // Try a truncated version of the body
      const room = TOTAL_CHAR_BUDGET - used - s.title.length - 10
      if (room < 80) continue
      kept.push({ ...s, body: truncate(s.body, room) })
      used += block.length // approximate
      continue
    }
    kept.push(s)
    used += block.length
  }

  // Re-sort kept sections so the rendering order is stable (rules
  // first, then primitives, then state).
  const ORDER = ['Hard rules', 'Primitives you can call directly without asking',
    'Memory blocks (always loaded — call update_memory_block to edit)',
    'Secrets (names only — call get_secret(name) to retrieve)',
    'Schedules (active — call cancel_schedule(name) to remove)',
    'Notifications']
  kept.sort((a, b) => ORDER.indexOf(a.title) - ORDER.indexOf(b.title))

  let out = HEADER
  for (const s of kept) {
    out += `### ${s.title}\n${s.body}\n\n`
  }
  return out.trimEnd()
}
