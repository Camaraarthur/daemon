import { NextRequest, NextResponse } from 'next/server'
import { getUserId } from '@/lib/auth'
import { createDeviceToken } from '@/lib/db'

// Pairing codes: in-memory with TTL cleanup
const PAIRING_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789' // no 0/O, 1/I/L
const CODE_LENGTH = 6
const CODE_TTL_MS = 5 * 60 * 1000 // 5 minutes

interface PairingCode {
  userId: number
  expiresAt: number
  timer: ReturnType<typeof setTimeout>
}

const pairingCodes = new Map<string, PairingCode>()

function generateCode(): string {
  let code = ''
  const bytes = new Uint8Array(CODE_LENGTH)
  crypto.getRandomValues(bytes)
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += PAIRING_CHARS[bytes[i] % PAIRING_CHARS.length]
  }
  return code
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { action } = body

  // ── Generate a pairing code (requires auth) ──
  if (action === 'generate') {
    const userId = await getUserId(req)
    if (!userId) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    // Generate unique code
    let code: string
    do {
      code = generateCode()
    } while (pairingCodes.has(code))

    const expiresAt = Date.now() + CODE_TTL_MS

    // Auto-cleanup after TTL
    const timer = setTimeout(() => {
      pairingCodes.delete(code)
    }, CODE_TTL_MS)

    pairingCodes.set(code, { userId, expiresAt, timer })

    return NextResponse.json({ code, expiresAt: new Date(expiresAt).toISOString() })
  }

  // ── Claim a pairing code (NO auth — the code IS the auth) ──
  if (action === 'claim') {
    const { code, device_id, device_name, platform } = body

    if (!code || !device_id) {
      return NextResponse.json({ error: 'Missing code or device_id' }, { status: 400 })
    }

    const upperCode = code.toUpperCase()
    const entry = pairingCodes.get(upperCode)

    if (!entry) {
      return NextResponse.json({ error: 'Invalid or expired pairing code' }, { status: 400 })
    }

    if (Date.now() > entry.expiresAt) {
      pairingCodes.delete(upperCode)
      return NextResponse.json({ error: 'Pairing code expired' }, { status: 400 })
    }

    // Create device token
    const rawToken = createDeviceToken(entry.userId, device_id, device_name, platform)

    // Delete the code (one-time use)
    clearTimeout(entry.timer)
    pairingCodes.delete(upperCode)

    return NextResponse.json({
      device_token: rawToken,
      ws_url: 'wss://my.daemon.page/ws/device',
    })
  }

  return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
}
