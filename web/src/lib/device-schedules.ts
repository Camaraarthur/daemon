/**
 * Relay-side wrapper for the scheduler primitive (vision.md §3.3).
 *
 * The agent's schedule() / list_schedules() / cancel_schedule() tools
 * dispatch through here. Each call routes to the user's primary daemon
 * device via the WS hub. The schedules themselves live on the device
 * (not the relay) — the relay never holds them in its own DB.
 *
 * Firing is handled the other direction: the device's tick loop POSTs
 * /api/schedule/fire when a schedule is due. See app/api/schedule/fire/.
 */

const WS_SERVER_URL = process.env.WS_SERVER_URL || 'http://localhost:4801'

interface UserDeviceInfo {
  id: string
  connected: boolean
  userId: number | null
}

async function pickPrimaryDevice(userId: number): Promise<string | null> {
  try {
    const res = await fetch(`${WS_SERVER_URL}/health`, { signal: AbortSignal.timeout(2000) })
    if (!res.ok) return null
    const data: { devices?: UserDeviceInfo[] } = await res.json()
    const myDevices = (data.devices || []).filter(
      (d) => d.connected && d.userId === userId,
    )
    return myDevices[0]?.id || null
  } catch {
    return null
  }
}

async function deviceCommand<T = unknown>(
  userId: number,
  command: Record<string, unknown> & { type: string },
): Promise<{ ok: boolean; data?: T; error?: string }> {
  const deviceId = await pickPrimaryDevice(userId)
  if (!deviceId) return { ok: false, error: 'no device online' }
  try {
    const res = await fetch(`${WS_SERVER_URL}/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        device_id: deviceId,
        user_id: String(userId),
        command,
      }),
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) return { ok: false, error: `device ${res.status}` }
    const data = await res.json()
    if (data?.ok === false) return { ok: false, error: data?.error || 'device error' }
    return { ok: true, data }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

// ── Public API ─────────────────────────────────────────────

export interface ScheduleRow {
  name: string
  cron: string
  prompt: string
  thread_id: string | null
  project_id: number | null
  enabled: boolean
  created_at: string
  updated_at: string
  last_run_at: string | null
  next_run_at: string
  run_count: number
  last_error: string | null
}

export async function createSchedule(opts: {
  userId: number
  name: string
  cron: string
  prompt: string
  threadId?: string | null
  projectId?: number | null
}): Promise<{ ok: boolean; nextRunAt?: string; error?: string }> {
  const r = await deviceCommand<{ next_run_at: string }>(opts.userId, {
    type: 'schedule.create',
    name: opts.name,
    cron: opts.cron,
    prompt: opts.prompt,
    thread_id: opts.threadId || null,
    project_id: opts.projectId || null,
    enabled: true,
  })
  if (!r.ok) return { ok: false, error: r.error }
  return {
    ok: true,
    nextRunAt: (r.data as { next_run_at: string })?.next_run_at,
  }
}

export async function listSchedules(opts: {
  userId: number
}): Promise<{ ok: boolean; schedules: ScheduleRow[]; error?: string }> {
  const r = await deviceCommand<{ schedules: ScheduleRow[] }>(opts.userId, {
    type: 'schedule.list',
  })
  if (!r.ok) return { ok: false, schedules: [], error: r.error }
  return { ok: true, schedules: (r.data as { schedules: ScheduleRow[] })?.schedules || [] }
}

export async function deleteSchedule(opts: {
  userId: number
  name: string
}): Promise<{ ok: boolean; removed?: boolean; error?: string }> {
  const r = await deviceCommand<{ removed: boolean }>(opts.userId, {
    type: 'schedule.delete',
    name: opts.name,
  })
  if (!r.ok) return { ok: false, error: r.error }
  return { ok: true, removed: (r.data as { removed: boolean })?.removed }
}

export async function setScheduleEnabled(opts: {
  userId: number
  name: string
  enabled: boolean
}): Promise<{ ok: boolean; error?: string }> {
  const r = await deviceCommand(opts.userId, {
    type: 'schedule.set_enabled',
    name: opts.name,
    enabled: opts.enabled,
  })
  return { ok: r.ok, error: r.error }
}
