import { requireAuth } from '@/lib/auth'
import { NextRequest, NextResponse } from 'next/server'

const WS_SERVER = 'http://localhost:4801'
const ESP32_IP = '10.27.241.196'
const DEVICE_ID = 'Pixel 8 Pro'

async function readSensor(): Promise<number> {
  try {
    const { execFile } = await import('child_process')
    const { promisify } = await import('util')
    const exec = promisify(execFile)
    const { stdout } = await exec('/home/arthur/daemon/server/read_sensor.sh', [], {
      timeout: 8000,
      env: { ...process.env, HOME: '/home/arthur' },
    })
    const val = parseFloat(stdout.trim())
    if (!isNaN(val) && val > 0) return val
  } catch {}
  return -1
}

function pushToStream(data: any) {
  const push = (globalThis as any).__daemonStreamPush
  if (push) push(data)
}

// GET /api/sensor-stream?action=start — starts streaming sensor data to SSE
// GET /api/sensor-stream?action=stop — stops streaming
// GET /api/sensor-stream?action=once — single read + push

let streaming = false
let streamInterval: ReturnType<typeof setInterval> | null = null

export async function GET(req: NextRequest) {
  const authErr = requireAuth(req); if (authErr) return authErr

  const action = req.nextUrl.searchParams.get('action') || 'once'

  if (action === 'stop') {
    streaming = false
    if (streamInterval) { clearInterval(streamInterval); streamInterval = null }
    pushToStream({ type: 'clear' })
    return NextResponse.json({ ok: true, streaming: false })
  }

  if (action === 'start') {
    if (streaming) return NextResponse.json({ ok: true, streaming: true, message: 'Already streaming' })
    streaming = true

    // Push immediately
    const dist = await readSensor()
    pushToStream({ type: 'sensor', distance: dist, timestamp: Date.now() })

    // Then every 2 seconds
    streamInterval = setInterval(async () => {
      if (!streaming) { clearInterval(streamInterval!); streamInterval = null; return }
      try {
        const d = await readSensor()
        pushToStream({ type: 'sensor', distance: d, timestamp: Date.now() })
      } catch {}
    }, 2000)

    return NextResponse.json({ ok: true, streaming: true })
  }

  // action === 'once'
  const dist = await readSensor()
  pushToStream({ type: 'sensor', distance: dist, timestamp: Date.now() })
  return NextResponse.json({ ok: true, distance: dist })
}
