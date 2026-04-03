/**
 * WebSocket server for daemon device connections.
 * Runs alongside Next.js on port 4801.
 * Devices (Android app, Windows app) connect here to register
 * and receive commands from the daemon.
 *
 * Reliability features:
 * - Server-side ping every 15s with dead connection detection
 * - Heartbeat protocol with the client
 * - Connection quality tracking (latency, uptime)
 * - Graceful reconnection support
 */

import { WebSocketServer, WebSocket } from "ws"
import http from 'http'

const PORT = 4801
const PING_INTERVAL = 15_000
const PONG_TIMEOUT = 10_000

const devices = new Map() // deviceId -> { ws, info, capabilities, stats }

const server = http.createServer((req, res) => {
  // CORS headers for local requests
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') {
    res.writeHead(200)
    res.end()
    return
  }

  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({
      status: 'ok',
      uptime: process.uptime(),
      devices: Array.from(devices.entries()).map(([id, d]) => ({
        id,
        name: d.info?.device_name,
        platform: d.info?.platform,
        connected: d.ws.readyState === WebSocket.OPEN,
        stats: d.stats,
      })),
    }))
    return
  }

  // POST /command — send command to a connected device and wait for response
  if (req.url === '/command' && req.method === 'POST') {
    let body = ''
    req.on('data', chunk => { body += chunk })
    req.on('end', () => {
      try {
        const { device_id, command } = JSON.parse(body)

        // Find device by exact ID or fuzzy match
        let device = devices.get(device_id)
        if (!device) {
          // Try case-insensitive / partial match
          for (const [id, d] of devices) {
            if (id.toLowerCase().includes(device_id.toLowerCase()) ||
                device_id.toLowerCase().includes(id.toLowerCase())) {
              device = d
              break
            }
          }
        }

        if (!device || device.ws.readyState !== WebSocket.OPEN) {
          res.writeHead(404, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({
            error: `Device "${device_id}" not connected`,
            connected_devices: Array.from(devices.keys()),
          }))
          return
        }

        const requestId = command.request_id || `req-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

        // Set up response listener with timeout
        const timeout = setTimeout(() => {
          delete device.pendingRequests?.[requestId]
          res.writeHead(504, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'Device did not respond within 30s' }))
        }, 30000)

        // Store the pending request
        if (!device.pendingRequests) device.pendingRequests = {}
        device.pendingRequests[requestId] = (result) => {
          clearTimeout(timeout)
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify(result))
        }

        // Send command to device
        device.ws.send(JSON.stringify({
          ...command,
          request_id: requestId,
        }))

        // Track stats
        device.stats.commandsSent++
        console.log(`[ws] Command sent to ${device_id}: ${command.type} (${requestId})`)
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: e.message }))
      }
    })
    return
  }

  res.writeHead(404)
  res.end()
})

const wss = new WebSocketServer({ server, path: '/ws/device' })

wss.on('connection', (ws, req) => {
  console.log('[ws] New device connection from', req.socket.remoteAddress)
  let deviceId = null
  let isAlive = true

  // Connection stats
  const stats = {
    connectedAt: new Date().toISOString(),
    lastHeartbeat: null,
    heartbeatCount: 0,
    commandsSent: 0,
    commandsReceived: 0,
    reconnections: 0,
    avgLatencyMs: 0,
    latencySamples: [],
  }

  ws.on('message', (data) => {
    isAlive = true
    try {
      const msg = JSON.parse(data.toString())

      switch (msg.type) {
        case 'device_register':
          // If device was previously registered, count as reconnection
          const oldDevice = devices.get(msg.device_id)
          if (oldDevice) {
            stats.reconnections = (oldDevice.stats?.reconnections || 0) + 1
            console.log(`[ws] Device reconnected: ${msg.device_id} (reconnection #${stats.reconnections})`)
            // Close old connection cleanly
            try { oldDevice.ws.close(1000, 'new connection') } catch (_) {}
          }

          deviceId = msg.device_id || `device-${Date.now()}`
          devices.set(deviceId, {
            ws,
            info: msg,
            capabilities: msg.capabilities || {},
            registeredAt: new Date().toISOString(),
            stats,
          })
          console.log(`[ws] Device registered: ${deviceId} (${msg.device_name || 'unknown'})`)
          console.log(`[ws] Capabilities:`, msg.capabilities)

          // Acknowledge
          ws.send(JSON.stringify({
            type: 'registered',
            device_id: deviceId,
            message: `Welcome, ${msg.device_name || deviceId}`,
            server_time: Date.now(),
          }))
          break

        case 'command_response':
          stats.commandsReceived++
          console.log(`[ws] Response from ${deviceId}:`, msg.request_id)
          const device = devices.get(deviceId)
          if (device?.pendingRequests?.[msg.request_id]) {
            device.pendingRequests[msg.request_id](msg.result || msg)
            delete device.pendingRequests[msg.request_id]
          }
          break

        case 'heartbeat':
          stats.lastHeartbeat = new Date().toISOString()
          stats.heartbeatCount++
          // Calculate latency if timestamp provided
          if (msg.timestamp) {
            const latency = Date.now() - msg.timestamp
            stats.latencySamples.push(latency)
            if (stats.latencySamples.length > 20) stats.latencySamples.shift()
            stats.avgLatencyMs = Math.round(
              stats.latencySamples.reduce((a, b) => a + b, 0) / stats.latencySamples.length
            )
          }
          ws.send(JSON.stringify({ type: 'heartbeat_ack', server_time: Date.now() }))
          break

        default:
          console.log(`[ws] Unknown message type from ${deviceId}:`, msg.type)
      }
    } catch (e) {
      console.error('[ws] Parse error:', e.message)
    }
  })

  ws.on('close', () => {
    if (deviceId) {
      console.log(`[ws] Device disconnected: ${deviceId}`)
      devices.delete(deviceId)
    }
  })

  ws.on('error', (err) => {
    console.error(`[ws] Error for ${deviceId}:`, err.message)
  })

  ws.on('pong', () => {
    isAlive = true
  })

  // Server-side ping — detect dead connections
  const pingInterval = setInterval(() => {
    if (!isAlive) {
      console.log(`[ws] Dead connection detected for ${deviceId}, terminating`)
      clearInterval(pingInterval)
      ws.terminate()
      return
    }
    isAlive = false
    if (ws.readyState === WebSocket.OPEN) {
      ws.ping()
    } else {
      clearInterval(pingInterval)
    }
  }, PING_INTERVAL)

  ws.on('close', () => clearInterval(pingInterval))
})

// API to send commands to devices
function sendCommandToDevice(deviceId, command) {
  const device = devices.get(deviceId)
  if (!device || device.ws.readyState !== WebSocket.OPEN) {
    return { error: `Device ${deviceId} not connected` }
  }

  const requestId = `req-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  device.ws.send(JSON.stringify({
    type: command.type,
    request_id: requestId,
    ...command,
  }))

  return { sent: true, request_id: requestId }
}

// Export for use by other modules
export { devices, sendCommandToDevice }

server.listen(PORT, () => {
  console.log(`[ws] Device WebSocket server on :${PORT}/ws/device`)
  console.log(`[ws] Health check: http://localhost:${PORT}/health`)
  console.log(`[ws] Command API: POST http://localhost:${PORT}/command`)
})
