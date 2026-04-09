/**
 * POST /api/notifications/test
 *
 * Send a test notification to all of the current user's subscribed
 * browsers. Used by the settings page button so the user can verify
 * push works without waiting for an agent to call notify().
 */

import { NextRequest, NextResponse } from 'next/server'
import { getUserId } from '@/lib/auth'
import { sendNotificationToUser } from '@/lib/web-push'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const userId = await getUserId(req)
  if (!userId) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  }
  let body: { title?: string; body?: string; url?: string }
  try {
    body = await req.json()
  } catch {
    body = {}
  }
  const result = await sendNotificationToUser(userId, {
    title: body.title || 'daemon test',
    body: body.body || 'If you can read this, web push is working.',
    url: body.url || '/',
    tag: 'test',
  })
  return NextResponse.json({ ok: true, ...result })
}
