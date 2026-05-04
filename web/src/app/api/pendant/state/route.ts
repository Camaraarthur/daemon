import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, getUserId } from '@/lib/auth'

/**
 * GET /api/pendant/state
 *
 * Returns the latest pendant connection state for the authenticated user
 * as recorded by ws-server.js when an Android device sent pendant.connection
 * or pendant.battery. Latest-wins; no history. Used by the chat header to
 * render a connection badge alongside the WS-watchdog badge.
 *
 * Response shape:
 *   { connected: boolean | null, status: string | null,
 *     batteryPercent: number | null, updatedAt: number | null,
 *     stale: boolean }
 *
 * `stale` is true when updatedAt is older than 90s — surface as "unknown"
 * in the UI rather than confidently claiming the last-known state.
 */
export async function GET(req: NextRequest) {
  const authErr = requireAuth(req)
  if (authErr) return authErr
  const userId = await getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  // ws-server.js holds the live state (different process from Next.js).
  // Internal HTTP read; localhost only.
  const wsPort = process.env.WS_INTERNAL_PORT || '4801'
  let s: any = null
  try {
    const r = await fetch(`http://127.0.0.1:${wsPort}/pendant-state/${userId}`, {
      cache: 'no-store',
    })
    if (r.ok) s = await r.json()
  } catch {}
  if (!s || Object.keys(s).length === 0) {
    return NextResponse.json({
      connected: null, status: null, batteryPercent: null,
      updatedAt: null, stale: true,
    })
  }
  const stale = Date.now() - (s.updatedAt || 0) > 90_000
  return NextResponse.json({
    connected: s.connected ?? null,
    status: s.status ?? null,
    batteryPercent: s.batteryPercent ?? null,
    updatedAt: s.updatedAt ?? null,
    stale,
  })
}
