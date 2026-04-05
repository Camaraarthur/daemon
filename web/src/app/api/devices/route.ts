import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, getUserId } from '@/lib/auth'
import { listDeviceTokens } from '@/lib/db'

export async function GET(req: NextRequest) {
  const authErr = requireAuth(req); if (authErr) return authErr;
  const userId = await getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const devices: any[] = []

  // Get connected devices from WS server
  let wsDevices: any[] = []
  try {
    const wsRes = await fetch('http://localhost:4801/health')
    const wsData = await wsRes.json()
    wsDevices = wsData.devices || []
  } catch {}

  // Get device tokens from DB
  const tokens = listDeviceTokens(userId)

  // Build device list from tokens + WS status
  for (const token of tokens) {
    // Check if this device is currently connected via WS
    const connected = wsDevices.find(
      (d: any) => d.id === token.device_id && d.connected && d.userId === userId
    )

    devices.push({
      id: token.device_id,
      name: token.device_name || token.device_id,
      platform: token.platform || 'unknown',
      status: connected ? 'online' : 'offline',
      connection: connected ? 'daemon cli' : 'paired',
      last_seen: connected ? 'now' : token.last_seen,
      token_id: token.id,
      created_at: token.created_at,
      capabilities: connected ? (connected.capabilities || []) : [],
    })
  }

  // Also include any WS-connected devices without tokens (legacy/direct connections)
  // SECURITY: Only show devices belonging to this user
  for (const wsDev of wsDevices) {
    if (wsDev.connected && wsDev.userId === userId && !devices.find(d => d.id === wsDev.id)) {
      devices.push({
        id: wsDev.id,
        name: wsDev.name || wsDev.id,
        platform: wsDev.platform || 'unknown',
        status: 'online',
        connection: 'direct ws',
        last_seen: 'now',
        capabilities: [],
      })
    }
  }

  return NextResponse.json({ devices })
}

// DELETE /api/devices — revoke a device token
export async function DELETE(req: NextRequest) {
  const authErr = requireAuth(req); if (authErr) return authErr;
  const userId = await getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const { token_id } = await req.json()
  if (!token_id) return NextResponse.json({ error: 'Missing token_id' }, { status: 400 })

  // Verify the token belongs to this user
  const tokens = listDeviceTokens(userId)
  const target = tokens.find(t => t.id === token_id)
  if (!target) {
    return NextResponse.json({ error: 'Device not found' }, { status: 404 })
  }

  const { revokeDeviceToken } = await import('@/lib/db')
  revokeDeviceToken(token_id)

  return NextResponse.json({ ok: true })
}
