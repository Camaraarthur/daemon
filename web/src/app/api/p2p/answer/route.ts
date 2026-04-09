/**
 * POST /api/p2p/answer
 *
 * Phase 6b stub — destination device's response to a /api/p2p/offer.
 * The relay forwards the answer back to the originator over the
 * existing /command WS channel.
 *
 * Body: { from_device, to_device, sdp_answer }
 *
 * Status: STUB, locked protocol, deferred to v1.5.
 */

import { NextRequest, NextResponse } from 'next/server'
import { validateDeviceToken } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface AnswerBody {
  from_device?: string
  to_device?: string
  sdp_answer?: string
}

export async function POST(req: NextRequest) {
  const auth = req.headers.get('authorization') || ''
  const m = auth.match(/^Bearer\s+(.+)$/i)
  if (!m) return NextResponse.json({ error: 'missing bearer token' }, { status: 401 })
  const tokenInfo = validateDeviceToken(m[1])
  if (!tokenInfo) return NextResponse.json({ error: 'invalid device_token' }, { status: 401 })

  let body: AnswerBody
  try {
    body = (await req.json()) as AnswerBody
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  }
  if (!body.from_device || !body.to_device || !body.sdp_answer) {
    return NextResponse.json(
      { error: 'from_device, to_device, sdp_answer required' },
      { status: 400 },
    )
  }
  return NextResponse.json(
    { ok: false, error: 'p2p signaling deferred to v1.5', protocol_locked: true },
    { status: 501 },
  )
}
