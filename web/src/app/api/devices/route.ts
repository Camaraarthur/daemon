import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, getUserId } from '@/lib/auth'
import { listDeviceTokens } from '@/lib/db'

/**
 * Pretty-print a raw device label. Strips "user@host" prefixes (we
 * never want the audience to see "arthur@arturito") and maps the
 * common hardware Arthur uses to short names: MSI / Orange Pi / Pixel.
 * Everything else falls through with just the user@ stripped.
 */
function prettyDeviceName(raw: string, platform?: string): string {
  if (!raw) return 'unknown'
  const stripped = raw.replace(/^[^@]+@/, '')
  const lc = stripped.toLowerCase()
  if (lc.includes('pixel')) return 'Pixel'
  if (lc.includes('msi')) return 'MSI'
  if (lc.includes('orange') || lc.includes('daemon-key') || lc.includes('daemonkey')) return 'daemon key'
  if (lc.includes('arturito')) return 'arturito'
  return stripped
}

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

  // Build device list from tokens + WS status. Dedupe by device_id —
  // re-pairs create new token rows with the same id; we only want the
  // newest entry per physical device.
  const seenIds = new Set<string>()
  for (const token of tokens) {
    if (seenIds.has(token.device_id)) continue
    seenIds.add(token.device_id)
    // Check if this device is currently connected via WS
    const connected = wsDevices.find(
      (d: any) => d.id === token.device_id && d.connected && d.userId === userId
    )

    devices.push({
      id: token.device_id,
      name: prettyDeviceName(token.device_name || token.device_id, token.platform || undefined),
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
    const wsName = prettyDeviceName(wsDev.name || wsDev.id, wsDev.platform)
    if (wsDev.connected && wsDev.userId === userId && !devices.find(d => d.id === wsDev.id || d.name === wsName)) {
      devices.push({
        id: wsDev.id,
        name: prettyDeviceName(wsDev.name || wsDev.id, wsDev.platform),
        platform: wsDev.platform || 'unknown',
        status: 'online',
        connection: 'direct ws',
        last_seen: 'now',
        capabilities: [],
      })
    }
  }

  // Synthetic Pendant entry — REMOVED. It was hardcoded to mirror the
  // Pixel's status, which lied to the user (pendant could be unpaired,
  // BLE off, or out of range and we'd still show "online"). The pendant
  // shouldn't appear here until the Android side reports its real BLE
  // connection state via a `pendant.status` device WS message that
  // /api/devices reads. Real fix is firmware/pendant agent's lane.
  const _pendantPlaceholder = false
  if (_pendantPlaceholder) {
    devices.push({
      id: 'pendant',
      name: 'Pendant',
      platform: 'ble',
      status: 'online',
      connection: 'BLE → Pixel',
      last_seen: 'now',
      capabilities: ['voice'],
    })
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
