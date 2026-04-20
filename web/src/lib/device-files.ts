/**
 * Relay-side wrapper for dispatching files.* tool calls to a user's
 * daemon device. Mirrors device-memory.ts. The authoritative files
 * store lives on the device at ~/.daemon/store.db — no file content
 * ever persists on the relay.
 */

const WS_SERVER_URL = process.env.WS_SERVER_URL || 'http://localhost:4801'

interface UserDeviceInfo {
  id: string
  name?: string
  platform?: string
  connected: boolean
  userId: number | null
}

export interface FileRow {
  id: string
  title: string
  body?: string
  mime: string
  size?: number
  created_at: string
  updated_at: string
}

async function pickPrimaryDevice(userId: number): Promise<string | null> {
  try {
    const res = await fetch(`${WS_SERVER_URL}/health`, { signal: AbortSignal.timeout(2000) })
    if (!res.ok) return null
    const data: { devices?: UserDeviceInfo[] } = await res.json()
    const mine = (data.devices || []).filter((d) => d.connected && d.userId === userId)
    // files.* handlers live in cli/daemon.mjs (node). Android/iOS daemons don't implement them yet,
    // so prefer a desktop daemon if the user has one online. Fall back to first available.
    const desktop = mine.find((d) => ['linux', 'darwin', 'macos', 'windows', 'win32'].includes(String(d.platform || '').toLowerCase()))
    return (desktop || mine[0])?.id || null
  } catch {
    return null
  }
}

async function sendCommand<T = unknown>(
  userId: number,
  command: Record<string, unknown> & { type: string },
): Promise<{ ok: boolean; data?: T; error?: string }> {
  const deviceId = await pickPrimaryDevice(userId)
  if (!deviceId) return { ok: false, error: 'no device online' }
  try {
    const res = await fetch(`${WS_SERVER_URL}/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ device_id: deviceId, user_id: String(userId), command }),
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) return { ok: false, error: `device returned ${res.status}` }
    const data = await res.json()
    if (!data?.ok) return { ok: false, error: data?.error || 'device error' }
    return { ok: true, data }
  } catch (e: unknown) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

export async function deviceListFiles(userId: number, limit = 200) {
  const r = await sendCommand<{ files: FileRow[] }>(userId, { type: 'files.list', limit })
  return r.ok ? { ok: true, files: (r.data as any).files as FileRow[] } : { ok: false, error: r.error }
}

export async function deviceGetFile(userId: number, id: string) {
  const r = await sendCommand<{ file: FileRow }>(userId, { type: 'files.get', id })
  return r.ok ? { ok: true, file: (r.data as any).file as FileRow } : { ok: false, error: r.error }
}

export async function devicePutFile(
  userId: number,
  input: { id?: string; title?: string; body?: string; mime?: string },
) {
  const r = await sendCommand<{ file: FileRow }>(userId, {
    type: 'files.put',
    id: input.id,
    title: input.title,
    body: input.body,
    mime: input.mime,
  })
  return r.ok ? { ok: true, file: (r.data as any).file as FileRow } : { ok: false, error: r.error }
}

export async function deviceDeleteFile(userId: number, id: string) {
  const r = await sendCommand(userId, { type: 'files.delete', id })
  return r.ok ? { ok: true } : { ok: false, error: r.error }
}
