import { requireAuth } from '@/lib/auth'
import { NextRequest, NextResponse } from 'next/server'
import { readFileSync } from 'fs'

const WS_SERVER = 'http://localhost:4801'
const DEVICE_ID = 'Pixel 8 Pro'

function pushToStream(data: any) {
  const push = (globalThis as any).__daemonStreamPush
  if (push) push(data)
}

// GET /api/camera — capture photo from phone and push to SSE as base64
export async function GET(req: NextRequest) {
  const authErr = requireAuth(req); if (authErr) return authErr

  try {
    const res = await fetch(`${WS_SERVER}/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        device_id: DEVICE_ID,
        command: { type: 'take_photo', camera_id: 0 },
      }),
    })
    const data = await res.json()

    if (data.error) {
      return NextResponse.json({ error: data.error }, { status: 500 })
    }

    // If the app returns base64 image data directly
    if (data.base64) {
      pushToStream({ type: 'camera', url: `data:image/jpeg;base64,${data.base64}` })
      return NextResponse.json({ ok: true, size: data.base64.length })
    }

    // If the app returns a file path, we need the app to send the image data
    return NextResponse.json({ ok: true, data })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message }, { status: 500 })
  }
}
