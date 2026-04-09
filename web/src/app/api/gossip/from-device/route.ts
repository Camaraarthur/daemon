/**
 * POST /api/gossip/from-device
 *
 * Step 7d: reverse-direction gossip — a device publishes a chat message
 * change to all of its peer devices via the relay.
 *
 * The forward direction (relay → all devices) was 7b. This is the
 * other half: when a device-resident agent (or future offline buffer
 * sync) modifies chat_messages locally, it POSTs here so the same
 * row can replicate to the user's other devices.
 *
 * Auth: Bearer device_token. The user_id is read from the token,
 * never from the body — a device can only gossip messages for the
 * user it's paired to. The source device is excluded from the
 * fan-out by passing source_device_id to the ws-server's existing
 * /gossip/chat-message endpoint.
 *
 * The relay does NOT persist the message — it just routes. Each
 * destination device's daemon.mjs handles the upsert via the existing
 * chat.message_imported handler that 7b uses.
 */

import { NextRequest, NextResponse } from 'next/server'
import { validateDeviceToken } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const WS_SERVER_URL = process.env.WS_SERVER_URL || 'http://localhost:4801'
const BROADCAST_SECRET = process.env.WS_BROADCAST_SECRET || 'dev-broadcast-secret'

interface GossipBody {
  message?: {
    id?: string
    thread_id?: string
    role?: string
    content?: string | null
    tool_calls?: unknown
    tool_call_id?: string | null
    model?: string | null
    created_at?: string
    source_session_id?: string | null
    complete?: boolean
    project_id?: number | null
  }
}

export async function POST(req: NextRequest) {
  // Auth: Bearer device_token
  const auth = req.headers.get('authorization') || ''
  const m = auth.match(/^Bearer\s+(.+)$/i)
  if (!m) {
    return NextResponse.json({ error: 'missing bearer token' }, { status: 401 })
  }
  const tokenInfo = validateDeviceToken(m[1])
  if (!tokenInfo) {
    return NextResponse.json({ error: 'invalid device_token' }, { status: 401 })
  }
  const { userId, deviceId } = tokenInfo

  let body: GossipBody
  try {
    body = (await req.json()) as GossipBody
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  }
  const msg = body.message
  if (!msg || !msg.id || !msg.thread_id) {
    return NextResponse.json(
      { error: 'message{id, thread_id} required' },
      { status: 400 },
    )
  }
  if (msg.content && typeof msg.content === 'string' && msg.content.length > 200_000) {
    return NextResponse.json({ error: 'content too large (>200KB)' }, { status: 413 })
  }

  // Forward to ws-server's internal gossip endpoint with the source
  // device id so the fan-out skips the originator.
  try {
    const res = await fetch(`${WS_SERVER_URL}/gossip/chat-message`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-broadcast-secret': BROADCAST_SECRET,
      },
      body: JSON.stringify({
        user_id: userId,
        source_device_id: deviceId,
        message: msg,
      }),
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      return NextResponse.json(
        { ok: false, error: `ws-server ${res.status}: ${text.slice(0, 200)}` },
        { status: 502 },
      )
    }
    const data = await res.json()
    return NextResponse.json({
      ok: true,
      sent_to: data?.sent ?? 0,
      excluded_source: deviceId,
    })
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 502 },
    )
  }
}
