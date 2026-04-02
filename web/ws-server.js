/**
 * WebSocket server for daemon device connections.
 * Runs alongside Next.js on port 4801.
 * Devices (Android app, Windows app) connect here to register
 * and receive commands from the daemon.
 */

import { WebSocketServer, WebSocket } from "ws"
import http from 'http'

const PORT = 4801
const devices = new Map() // deviceId -> { ws, info, capabilities }

const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({
      status: 'ok',
      devices: Array.from(devices.entries()).map(([id, d]) => ({
        id,
        name: d.info?.device_name,
        platform: d.info?.platform,
        connected: d.ws.readyState === WebSocket.OPEN,
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
        const device = devices.get(device_id)

        if (!device || device.ws.readyState !== WebSocket.OPEN) {
          res.writeHead(404, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: `Device "${device_id}" not connected. Connected: ${Array.from(devices.keys()).join(', ')}` }))
          return
        }

        const requestId = command.request_id || `req-${Date.now()}`

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

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString())

      switch (msg.type) {
        case 'device_register':
          deviceId = msg.device_id || `device-${Date.now()}`
          devices.set(deviceId, {
            ws,
            info: msg,
            capabilities: msg.capabilities || {},
            registeredAt: new Date().toISOString(),
          })
          console.log(`[ws] Device registered: ${deviceId} (${msg.device_name || 'unknown'})`)
          console.log(`[ws] Capabilities:`, msg.capabilities)

          // Acknowledge
          ws.send(JSON.stringify({
            type: 'registered',
            device_id: deviceId,
            message: `Welcome, ${msg.device_name || deviceId}`,
          }))
          break

        case 'command_response':
          // Device responding to a command — route back to pending HTTP request
          console.log(`[ws] Response from ${deviceId}:`, msg.request_id)
          const device = devices.get(deviceId)
          if (device?.pendingRequests?.[msg.request_id]) {
            device.pendingRequests[msg.request_id](msg.result || msg)
            delete device.pendingRequests[msg.request_id]
          }
          break

        case 'heartbeat':
          ws.send(JSON.stringify({ type: 'heartbeat_ack' }))
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

  // Send ping every 30s
  const pingInterval = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.ping()
    } else {
      clearInterval(pingInterval)
    }
  }, 30000)
})

// API to send commands to devices
function sendCommandToDevice(deviceId, command) {
  const device = devices.get(deviceId)
  if (!device || device.ws.readyState !== WebSocket.OPEN) {
    return { error: `Device ${deviceId} not connected` }
  }

  const requestId = `req-${Date.now()}`
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
})
