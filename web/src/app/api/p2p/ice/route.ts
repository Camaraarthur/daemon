/**
 * POST /api/p2p/ice
 *
 * Phase 6b stub — ICE candidate exchange between two peer devices.
 * The relay forwards ICE candidates between the offer/answer parties
 * over the existing /command WS channel until both sides have enough
 * candidates to establish the data channel.
 *
 * Body: { from_device, to_device, candidate }
 *
 * Status: STUB, locked protocol, deferred to v1.5.
 */

import { NextRequest, NextResponse } from 'next/server'
import { validateDeviceToken } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface IceBody {
  from_device?: string
  to_device?: string
  candidate?: string
}

export async function POST(req: NextRequest) {
  const auth = req.headers.get('authorization') || ''
  const m = auth.match(/^Bearer\s+(.+)$/i)
  if (!m) return NextResponse.json({ error: 'missing bearer token' }, { status: 401 })
  const tokenInfo = validateDeviceToken(m[1])
  if (!tokenInfo) return NextResponse.json({ error: 'invalid device_token' }, { status: 401 })

  let body: IceBody
  try {
    body = (await req.json()) as IceBody
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  }
  if (!body.from_device || !body.to_device || !body.candidate) {
    return NextResponse.json(
      { error: 'from_device, to_device, candidate required' },
      { status: 400 },
    )
  }
  return NextResponse.json(
    { ok: false, error: 'p2p signaling deferred to v1.5', protocol_locked: true },
    { status: 501 },
  )
}
