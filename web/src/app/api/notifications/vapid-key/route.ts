/**
 * GET /api/notifications/vapid-key
 *
 * Returns the VAPID public key the browser needs to subscribe to web
 * push. Public key only — the private key never leaves the relay.
 */

import { NextResponse } from 'next/server'
import { getVapidPublicKey } from '@/lib/web-push'

export const runtime = 'nodejs'

export async function GET() {
  try {
    return NextResponse.json({ publicKey: getVapidPublicKey() })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
