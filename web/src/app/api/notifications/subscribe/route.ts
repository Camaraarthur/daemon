/**
 * POST /api/notifications/subscribe
 * DELETE /api/notifications/subscribe
 *
 * Browser registers / unregisters its push subscription. Auth via the
 * daemon_token cookie.
 *
 * POST body: { endpoint, keys: { p256dh, auth }, userAgent?, platform? }
 * DELETE body: { endpoint }
 */

import { NextRequest, NextResponse } from 'next/server'
import { getUserId } from '@/lib/auth'
import { upsertPushSubscription, deletePushSubscription } from '@/lib/db'

export const runtime = 'nodejs'

interface SubscribeBody {
  endpoint?: string
  keys?: { p256dh?: string; auth?: string }
  userAgent?: string
  platform?: string
}

export async function POST(req: NextRequest) {
  const userId = await getUserId(req)
  if (!userId) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  }
  let body: SubscribeBody
  try {
    body = (await req.json()) as SubscribeBody
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  }
  if (!body.endpoint || !body.keys?.p256dh || !body.keys?.auth) {
    return NextResponse.json(
      { error: 'endpoint and keys.p256dh and keys.auth required' },
      { status: 400 },
    )
  }
  let sub
  try {
    sub = upsertPushSubscription({
      userId,
      endpoint: body.endpoint,
      p256dh: body.keys.p256dh,
      auth: body.keys.auth,
      userAgent: body.userAgent,
      platform: body.platform,
    })
  } catch (e) {
    // C-2: another user already owns this endpoint
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'subscribe failed' },
      { status: 409 },
    )
  }
  return NextResponse.json({ ok: true, id: sub.id })
}

export async function DELETE(req: NextRequest) {
  const userId = await getUserId(req)
  if (!userId) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  }
  let body: { endpoint?: string }
  try {
    body = (await req.json()) as { endpoint?: string }
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  }
  if (!body.endpoint) {
    return NextResponse.json({ error: 'endpoint required' }, { status: 400 })
  }
  // C-2: scope to userId so one user can't delete another's subscription.
  const removed = deletePushSubscription(body.endpoint, userId)
  return NextResponse.json({ ok: true, removed })
}
