/**
 * POST /api/devices/apns
 *
 * Phase 5 — iOS app calls this to register its APNs device token
 * after a successful UNUserNotificationCenter authorization.
 *
 * The relay stores the APNs token in the existing device_tokens
 * row (one new column: apns_token), so when the agent calls notify()
 * for a user, the relay can dispatch via APNs (iOS) in addition to
 * the existing web push (Linux/macOS/Windows browsers) and FCM
 * (Android — coming in v1.5).
 *
 * Auth: Bearer <device_token> from the iOS app's Keychain. The
 * relay validates the token, extracts user_id + device_id, then
 * upserts apns_token onto the matching device_tokens row.
 *
 * APNs SEND path is NOT in this commit — that's the next iteration
 * (web/src/lib/apns-push.ts using node-apn or apple's @parse/node-apn).
 * This commit just stores the address book.
 */

import { NextRequest, NextResponse } from 'next/server'
import { validateDeviceToken } from '@/lib/db'
import getDb from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface ApnsBody {
  device_id?: string
  apns_token?: string
}

export async function POST(req: NextRequest) {
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

  let body: ApnsBody
  try {
    body = (await req.json()) as ApnsBody
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  }
  if (!body.apns_token || typeof body.apns_token !== 'string') {
    return NextResponse.json({ error: 'apns_token required' }, { status: 400 })
  }
  if (body.apns_token.length > 256) {
    return NextResponse.json({ error: 'apns_token too long' }, { status: 400 })
  }
  // Token format: 64 hex chars (APNs production length).
  if (!/^[a-fA-F0-9]+$/.test(body.apns_token)) {
    return NextResponse.json({ error: 'apns_token must be hex' }, { status: 400 })
  }

  // Lazily ensure the column exists. The migrations array in db.ts
  // is the canonical place to add it; this guard handles fresh
  // installs that haven't restarted daemon-web.service since the
  // schema bump.
  try {
    getDb().exec(`
      ALTER TABLE device_tokens ADD COLUMN apns_token TEXT;
    `)
  } catch {
    // already exists — fine
  }

  try {
    getDb()
      .prepare(
        `UPDATE device_tokens
         SET apns_token = ?
         WHERE user_id = ? AND device_id = ?`,
      )
      .run(body.apns_token, userId, deviceId)
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    )
  }

  return NextResponse.json({ ok: true, device_id: deviceId })
}
