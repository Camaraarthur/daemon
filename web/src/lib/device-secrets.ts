/**
 * Relay-side wrapper for the secrets vault.
 *
 * The agent's get_secret(name) tool dispatches here. We:
 *   1. Check the user's device-side encrypted vault via the WS hub
 *      (calls cli/daemon.mjs `secrets.get`).
 *   2. If not found, fall through to the platform broker
 *      (web/src/lib/platform-secrets.ts).
 *   3. Return whichever hit first; the agent never knows the difference.
 *
 * The plaintext value travels relay-internal in memory only — never
 * persisted on the relay, never logged, never echoed back to the
 * browser.
 */

import { getPlatformSecret, listPlatformSecrets, isPlatformSecret } from './platform-secrets'

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
    if (!data?.ok) return { ok: false, error: data?.error || 'device error' }
    return { ok: true, data }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

// ── Public API ─────────────────────────────────────────────

export interface SecretMetadata {
  name: string
  category: string | null
  description: string | null
  source: 'user' | 'platform'
  available: boolean
}

/**
 * The agent's get_secret() backend.
 *
 * 1. Try user vault on device.
 * 2. Fall through to platform broker.
 * 3. Return null if both miss.
 *
 * THE RETURNED STRING IS THE ACTUAL SECRET. Never log it. Never persist it.
 * Pass it to the model API call and discard.
 */
export async function getSecret(opts: {
  userId: number
  name: string
}): Promise<{ ok: boolean; value?: string; source?: 'user' | 'platform'; error?: string }> {
  // 1. User vault on the device
  const r = await deviceCommand<{ value: string }>(opts.userId, {
    type: 'secrets.get',
    name: opts.name,
  })
  if (r.ok && (r.data as { value: string })?.value) {
    return { ok: true, value: (r.data as { value: string }).value, source: 'user' }
  }

  // 2. Platform broker
  const platformValue = getPlatformSecret(opts.userId, opts.name)
  if (platformValue) {
    return { ok: true, value: platformValue, source: 'platform' }
  }

  return { ok: false, error: r.error || 'secret not found' }
}

/**
 * Set a secret in the user's device vault. Always device-side — the
 * relay never holds user secrets, even temporarily.
 */
export async function setSecret(opts: {
  userId: number
  name: string
  value: string
  category?: string
  description?: string
}): Promise<{ ok: boolean; error?: string }> {
  const r = await deviceCommand(opts.userId, {
    type: 'secrets.set',
    name: opts.name,
    value: opts.value,
    category: opts.category,
    description: opts.description,
  })
  return { ok: r.ok, error: r.error }
}

export async function deleteSecret(opts: {
  userId: number
  name: string
}): Promise<{ ok: boolean; error?: string }> {
  const r = await deviceCommand(opts.userId, {
    type: 'secrets.delete',
    name: opts.name,
  })
  return { ok: r.ok, error: r.error }
}

/**
 * List ALL secrets the user has access to — device vault + platform
 * broker — names only, never values. Used by the system-prompt
 * scaffolding to enumerate available secrets to the agent.
 */
export async function listSecrets(opts: {
  userId: number
}): Promise<{ ok: boolean; secrets: SecretMetadata[]; error?: string }> {
  const out: SecretMetadata[] = []

  // Device vault
  const userListR = await deviceCommand<{
    secrets: Array<{ name: string; category: string | null; description: string | null }>
  }>(opts.userId, { type: 'secrets.list' })
  if (userListR.ok) {
    for (const s of (userListR.data as { secrets: Array<{ name: string; category: string | null; description: string | null }> })?.secrets || []) {
      out.push({
        name: s.name,
        category: s.category,
        description: s.description,
        source: 'user',
        available: true,
      })
    }
  }

  // Platform broker
  for (const p of listPlatformSecrets(opts.userId)) {
    // Don't double-list if user has overridden a platform secret with their own
    if (out.find((u) => u.name === p.name && u.source === 'user')) continue
    out.push({
      name: p.name,
      category: p.category,
      description: p.description,
      source: 'platform',
      available: p.available,
    })
  }

  return { ok: true, secrets: out, error: userListR.error }
}

/**
 * Existence check without retrieving the value. Cheap.
 */
export async function secretExists(opts: {
  userId: number
  name: string
}): Promise<boolean> {
  const r = await deviceCommand<{ exists: boolean }>(opts.userId, {
    type: 'secrets.exists',
    name: opts.name,
  })
  if (r.ok && (r.data as { exists: boolean })?.exists) return true
  return isPlatformSecret(opts.name)
}
