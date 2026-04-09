/**
 * POST /api/p2p/offer
 *
 * Phase 6b stub — WebRTC signaling endpoint for device-to-device
 * direct data channels. The relay is the matchmaker; once the
 * data channel is up, traffic flows direct (no bytes through the
 * relay).
 *
 * Body:
 *   { from_device, to_device, sdp_offer }
 *
 * Auth: Bearer <device_token>. The relay validates the token and
 * extracts user_id; only signals BETWEEN a single user's own devices
 * are allowed (no cross-user matchmaking).
 *
 * Status: STUB. The wire protocol is locked here so the device
 * implementations can target the right shape, but the actual relay
 * dispatch + persistence is v1.5. For v1, device_send_file uses the
 * relay-mediated fallback in transfer-tools.ts.
 */

import { NextRequest, NextResponse } from 'next/server'
import { validateDeviceToken } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface OfferBody {
  from_device?: string
  to_device?: string
  sdp_offer?: string
}

export async function POST(req: NextRequest) {
  const auth = req.headers.get('authorization') || ''
  const m = auth.match(/^Bearer\s+(.+)$/i)
  if (!m) return NextResponse.json({ error: 'missing bearer token' }, { status: 401 })
  const tokenInfo = validateDeviceToken(m[1])
  if (!tokenInfo) return NextResponse.json({ error: 'invalid device_token' }, { status: 401 })

  let body: OfferBody
  try {
    body = (await req.json()) as OfferBody
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  }
  if (!body.from_device || !body.to_device || !body.sdp_offer) {
    return NextResponse.json(
      { error: 'from_device, to_device, sdp_offer required' },
      { status: 400 },
    )
  }
  // Phase 6b will route the offer to the destination device via the
  // existing /command WS channel. For now, return 501 so the agent
  // (and any test harness) knows the path is locked-but-deferred.
  return NextResponse.json(
    {
      ok: false,
      error: 'p2p signaling deferred to v1.5 — use device_send_file relay-mediated fallback',
      protocol_locked: true,
    },
    { status: 501 },
  )
}
