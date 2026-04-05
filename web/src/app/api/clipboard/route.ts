import { requireAuth, getUserId } from '@/lib/auth'
import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  const authErr = requireAuth(req); if (authErr) return authErr

  const userId = await getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const { content, source } = await req.json()
  if (!content) return NextResponse.json({ error: 'Missing content' }, { status: 400 })

  // Forward to WS server — include user_id so it only broadcasts to this user's devices
  try {
    const healthRes = await fetch('http://localhost:4801/health')
    const healthData = await healthRes.json()
    // SECURITY: Only send to devices belonging to THIS user
    const devices = (healthData.devices || []).filter(
      (d: any) => d.connected && d.userId === userId
    )

    let sent = 0
    for (const device of devices) {
      try {
        await fetch('http://localhost:4801/command', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            device_id: device.id,
            user_id: userId,
            command: {
              type: 'clipboard_update',
              content,
              source_device: source || 'api',
              timestamp: Date.now(),
            },
          }),
        })
        sent++
      } catch {}
    }

    return NextResponse.json({ ok: true, devices_notified: sent })
  } catch (e: any) {
    return NextResponse.json({ error: 'WS server unreachable: ' + e.message }, { status: 502 })
  }
}
