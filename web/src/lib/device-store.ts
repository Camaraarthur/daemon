/**
 * Relay-side wrapper for fetching chat data from a user's daemon device.
 *
 * Step 8: the relay no longer reads from its own chat_messages table
 * (we only kept it as a transitional dual-write). Instead, when the
 * messages endpoint or any other consumer needs chat history, it asks
 * the user's primary daemon device via /skill/invoke and returns the
 * device's response unmodified.
 *
 * If the user has no device online, we degrade gracefully — the caller
 * gets an empty result and surfaces a "no device online" hint to the UI.
 */

const WS_SERVER_URL = process.env.WS_SERVER_URL || 'http://localhost:4801'

export interface DeviceMessage {
  id: string
  thread_id: string
  role: string
  content: string | null
  tool_calls: string | null
  tool_call_id: string | null
  model: string | null
  created_at: string
  source_session_id: string | null
  complete: number
}

export interface DeviceMessagesResponse {
  ok: boolean
  messages: DeviceMessage[]
  total: number
  source_session_id?: string | null
  device_id?: string
  error?: string
}

interface UserDeviceInfo {
  id: string
  name?: string
  platform?: string
  connected: boolean
  userId: number | null
}

/**
 * Pick the "primary" device for a user. For now: the most recently
 * connected device that's currently online and belongs to this user.
 * Later this becomes a user-configurable preference (architecture v1
 * §6 rule 3 — agent home with fallback chain).
 */
async function pickPrimaryDevice(userId: number): Promise<string | null> {
  try {
    const res = await fetch(`${WS_SERVER_URL}/health`, { signal: AbortSignal.timeout(2000) })
    if (!res.ok) return null
    const data: { devices?: UserDeviceInfo[] } = await res.json()
    const myDevices = (data.devices || []).filter(
      (d) => d.connected && d.userId === userId,
    )
    if (myDevices.length === 0) return null
    // Most recently connected wins for now
    return myDevices[0].id
  } catch {
    return null
  }
}

/**
 * Send a chat.fetch_messages WS request to the user's primary device.
 * Returns the device's response or a clear empty/error result.
 */
export async function fetchMessagesFromDevice(opts: {
  userId: number
  threadId: string
  limit?: number
  sourceSessionId?: string | null
}): Promise<DeviceMessagesResponse> {
  const deviceId = await pickPrimaryDevice(opts.userId)
  if (!deviceId) {
    return { ok: false, messages: [], total: 0, error: 'no device online' }
  }

  try {
    const res = await fetch(`${WS_SERVER_URL}/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        device_id: deviceId,
        user_id: String(opts.userId),
        command: {
          type: 'chat.fetch_messages',
          thread_id: opts.threadId,
          limit: opts.limit || 200,
          source_session_id: opts.sourceSessionId || null,
        },
      }),
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) {
      return { ok: false, messages: [], total: 0, error: `device returned ${res.status}` }
    }
    const data = await res.json()
    if (!data.ok) {
      return { ok: false, messages: [], total: 0, error: data.error || 'device error' }
    }
    return {
      ok: true,
      messages: data.messages || [],
      total: data.total || 0,
      device_id: deviceId,
    }
  } catch (e: unknown) {
    return {
      ok: false,
      messages: [],
      total: 0,
      error: e instanceof Error ? e.message : String(e),
    }
  }
}

/**
 * Ask the user's primary device for the latest source_session_id
 * recorded in a thread. Used by the messages endpoint to filter to
 * the bound Claude Code session.
 */
export async function fetchLatestSessionFromDevice(opts: {
  userId: number
  threadId: string
}): Promise<string | null> {
  const deviceId = await pickPrimaryDevice(opts.userId)
  if (!deviceId) return null
  try {
    const res = await fetch(`${WS_SERVER_URL}/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        device_id: deviceId,
        user_id: String(opts.userId),
        command: {
          type: 'chat.get_latest_session',
          thread_id: opts.threadId,
        },
      }),
      signal: AbortSignal.timeout(3000),
    })
    if (!res.ok) return null
    const data = await res.json()
    return data?.source_session_id || null
  } catch {
    return null
  }
}
