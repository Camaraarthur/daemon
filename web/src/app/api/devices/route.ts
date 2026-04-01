import { requireAuth } from '@/lib/auth'
import { NextRequest, NextResponse } from 'next/server'
import { execFile } from 'child_process'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

export async function GET(req: NextRequest) {
  const authErr = requireAuth(req); if (authErr) return authErr;

  const devices: any[] = []

  // Check arturito (always online — we're running on it)
  devices.push({
    id: 'arturito',
    name: 'arturito',
    type: 'server',
    platform: 'linux',
    ip: '100.124.245.114',
    status: 'online',
    connection: 'local',
    capabilities: ['ssh', 'files', 'docker', 'qdrant', 'claude'],
  })

  // Check MSI via SSH
  try {
    await execFileAsync('ssh', ['-o', 'ConnectTimeout=3', 'msi', 'echo', 'ok'], { timeout: 5000 })
    devices.push({
      id: 'msi',
      name: 'msi',
      type: 'laptop',
      platform: 'windows',
      ip: '100.90.175.87',
      status: 'online',
      connection: 'tailscale ssh',
      capabilities: ['ssh', 'files', 'commands', 'serial (esp32)'],
    })
  } catch {
    devices.push({
      id: 'msi', name: 'msi', type: 'laptop', platform: 'windows',
      ip: '100.90.175.87', status: 'offline', connection: 'tailscale ssh', capabilities: [],
    })
  }

  // Check Pixel via SSH
  try {
    await execFileAsync('ssh', ['-o', 'ConnectTimeout=3', 'pixel', 'echo', 'ok'], { timeout: 5000 })
    devices.push({
      id: 'pixel',
      name: 'pixel 8 pro',
      type: 'phone',
      platform: 'android',
      ip: '100.126.71.26',
      status: 'online',
      connection: 'termux ssh',
      capabilities: ['ssh', 'files', 'commands'],
    })
  } catch {
    // Check WebSocket
    try {
      const wsRes = await fetch('http://localhost:4801/health')
      const wsData = await wsRes.json()
      const pixelWs = wsData.devices?.find((d: any) => d.id === 'Pixel 8 Pro' && d.connected)
      if (pixelWs) {
        devices.push({
          id: 'pixel', name: 'pixel 8 pro', type: 'phone', platform: 'android',
          ip: 'websocket', status: 'online', connection: 'daemon app',
          capabilities: ['camera', 'mic', 'gps', 'sensors', 'battery', 'notifications'],
        })
      } else {
        devices.push({
          id: 'pixel', name: 'pixel 8 pro', type: 'phone', platform: 'android',
          ip: '—', status: 'offline', connection: '—', capabilities: [],
        })
      }
    } catch {
      devices.push({
        id: 'pixel', name: 'pixel 8 pro', type: 'phone', platform: 'android',
        ip: '—', status: 'offline', connection: '—', capabilities: [],
      })
    }
  }

  // Check ESP32 via MSI serial or WiFi
  try {
    // Try serial first
    const { stdout } = await execFileAsync('ssh', [
      '-o', 'ConnectTimeout=3', 'msi',
      'mode', 'COM3',
    ], { timeout: 5000 })
    if (stdout.includes('COM3')) {
      devices.push({
        id: 'esp32', name: 'daemon key', type: 'microcontroller', platform: 'esp32',
        ip: 'COM3 (serial)', status: 'online', connection: 'msi usb serial',
        capabilities: ['display', 'distance sensor', 'gpio', 'wifi'],
      })
    }
  } catch {
    // Try WiFi — scan common subnets
    devices.push({
      id: 'esp32', name: 'daemon key', type: 'microcontroller', platform: 'esp32',
      ip: '—', status: 'offline', connection: '—', capabilities: [],
    })
  }

  return NextResponse.json({ devices })
}
