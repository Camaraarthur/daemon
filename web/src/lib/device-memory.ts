/**
 * Relay-side wrapper for dispatching memory tool calls to a user's
 * daemon device. Mirrors device-store.ts but for memory operations
 * (remember, recall, list_facts, memory blocks).
 *
 * The agent loop's executeMemoryTool routes through here, so the
 * canonical memory store lives on the device — same SQLite file the
 * MCP server reads/writes. Single source of truth, no drift between
 * the daemon web UI and Claude Code terminal.
 */

const WS_SERVER_URL = process.env.WS_SERVER_URL || 'http://localhost:4801'

interface UserDeviceInfo {
  id: string
  name?: string
  platform?: string
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
    if (myDevices.length === 0) return null
    return myDevices[0].id
  } catch {
    return null
  }
}

interface DeviceCommandResult<T = unknown> {
  ok: boolean
  data?: T
  error?: string
}

/**
 * Send a memory.* command to the user's primary device. Returns the
 * device's response unmodified, plus an `ok` flag.
 */
async function sendMemoryCommand<T = unknown>(opts: {
  userId: number
  command: Record<string, unknown> & { type: string }
}): Promise<DeviceCommandResult<T>> {
  const deviceId = await pickPrimaryDevice(opts.userId)
  if (!deviceId) {
    return { ok: false, error: 'no device online' }
  }
  try {
    const res = await fetch(`${WS_SERVER_URL}/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        device_id: deviceId,
        user_id: String(opts.userId),
        command: opts.command,
      }),
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) {
      return { ok: false, error: `device returned ${res.status}` }
    }
    const data = await res.json()
    if (!data?.ok) {
      return { ok: false, error: data?.error || 'device error', data }
    }
    return { ok: true, data }
  } catch (e: unknown) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

// ── Public API: matches the shape executeMemoryTool expects ─────

export async function deviceRemember(opts: {
  userId: number
  projectId: number
  category: string
  content: string
  importance?: number
  source?: string
}): Promise<{ ok: boolean; fact_id?: number; error?: string }> {
  const r = await sendMemoryCommand<{ fact_id: number }>({
    userId: opts.userId,
    command: {
      type: 'memory.remember',
      project_id: opts.projectId,
      category: opts.category,
      content: opts.content,
      importance: opts.importance,
      source: opts.source,
    },
  })
  return r.ok
    ? { ok: true, fact_id: (r.data as { fact_id: number }).fact_id }
    : { ok: false, error: r.error }
}

export async function deviceRecall(opts: {
  userId: number
  projectId: number
  query: string
  limit?: number
}): Promise<{
  ok: boolean
  count?: number
  hits?: Array<{
    source: string
    id: number
    label_or_category: string
    score: number
    content: string
  }>
  error?: string
}> {
  const r = await sendMemoryCommand<{
    count: number
    hits: Array<{ source: string; id: number; label_or_category: string; score: number; content: string }>
  }>({
    userId: opts.userId,
    command: {
      type: 'memory.recall',
      project_id: opts.projectId,
      query: opts.query,
      limit: opts.limit,
    },
  })
  return r.ok
    ? { ok: true, count: (r.data as any).count, hits: (r.data as any).hits }
    : { ok: false, error: r.error }
}

export async function deviceListFacts(opts: {
  userId: number
  projectId: number
  category?: string
  limit?: number
}): Promise<{
  ok: boolean
  total?: number
  by_category?: Record<string, number>
  facts?: Array<{ id: number; category: string; content: string; importance: number; created_at: string }>
  error?: string
}> {
  const r = await sendMemoryCommand({
    userId: opts.userId,
    command: {
      type: 'memory.list_facts',
      project_id: opts.projectId,
      category: opts.category,
      limit: opts.limit,
    },
  })
  return r.ok ? { ok: true, ...(r.data as any) } : { ok: false, error: r.error }
}

export async function deviceGetBlock(opts: {
  userId: number
  projectId: number
  label: string
}): Promise<{
  ok: boolean
  block?: { label: string; content: string; max_chars: number; updated_at: string }
  error?: string
}> {
  const r = await sendMemoryCommand({
    userId: opts.userId,
    command: { type: 'memory.get_block', project_id: opts.projectId, label: opts.label },
  })
  return r.ok ? { ok: true, ...(r.data as any) } : { ok: false, error: r.error }
}

export async function deviceListBlocks(opts: {
  userId: number
  projectId: number
}): Promise<{
  ok: boolean
  blocks?: Array<{ label: string; content: string; max_chars: number; updated_at: string }>
  error?: string
}> {
  const r = await sendMemoryCommand({
    userId: opts.userId,
    command: { type: 'memory.list_blocks', project_id: opts.projectId },
  })
  return r.ok ? { ok: true, ...(r.data as any) } : { ok: false, error: r.error }
}

export async function deviceUpdateBlock(opts: {
  userId: number
  projectId: number
  label: string
  content: string
  maxChars?: number
}): Promise<{ ok: boolean; error?: string }> {
  const r = await sendMemoryCommand({
    userId: opts.userId,
    command: {
      type: 'memory.update_block',
      project_id: opts.projectId,
      label: opts.label,
      content: opts.content,
      max_chars: opts.maxChars,
    },
  })
  return { ok: r.ok, error: r.error }
}

export async function deviceAppendBlock(opts: {
  userId: number
  projectId: number
  label: string
  addition: string
}): Promise<{ ok: boolean; total_chars?: number; error?: string }> {
  const r = await sendMemoryCommand<{ total_chars: number }>({
    userId: opts.userId,
    command: {
      type: 'memory.append_block',
      project_id: opts.projectId,
      label: opts.label,
      addition: opts.addition,
    },
  })
  return r.ok
    ? { ok: true, total_chars: (r.data as any).total_chars }
    : { ok: false, error: r.error }
}
