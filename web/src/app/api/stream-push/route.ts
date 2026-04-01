import { requireAuth } from '@/lib/auth'
import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  const authErr = requireAuth(req); if (authErr) return authErr;

  const data = await req.json()

  // Push to SSE stream
  const push = (globalThis as any).__daemonStreamPush
  if (push) {
    push(data)
    return NextResponse.json({ ok: true })
  }
  return NextResponse.json({ error: 'Stream not initialized' }, { status: 500 })
}
