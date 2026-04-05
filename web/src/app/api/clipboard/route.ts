import { requireAuth } from '@/lib/auth'
import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  const authErr = requireAuth(req); if (authErr) return authErr
  const { content, source } = await req.json()
  if (!content) return NextResponse.json({ error: 'Missing content' }, { status: 400 })

  // Forward to the WS server which broadcasts to all connected devices
  try {
    const res = await fetch('http://localhost:4801/command', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        // Broadcast by sending clipboard_update to all devices via a special broadcast
        // The WS server doesn't have a broadcast endpoint, so we use a workaround:
        // fetch connected devices and send to each one
      }),
    })
    // Actually, the simplest: just hit the health endpoint to get device list,
    // then send clipboard_update command to each
    const healthRes = await fetch('http://localhost:4801/health')
    const healthData = await healthRes.json()
    const devices = (healthData.devices || []).filter((d: any) => d.connected)

    let sent = 0
    for (const device of devices) {
      try {
        await fetch('http://localhost:4801/command', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            device_id: device.id,
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
