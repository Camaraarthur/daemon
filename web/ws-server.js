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
import Database from 'better-sqlite3'
import { createHash } from 'crypto'
import { join } from 'path'

// ── Device Token Validation (SQLite) ────────────────────
const DB_PATH = join(process.cwd(), '..', 'data', 'users.db')
let _tokenDb = null

function getTokenDb() {
  if (!_tokenDb) {
    _tokenDb = new Database(DB_PATH, { readonly: false })
    _tokenDb.pragma('journal_mode = WAL')
  }
  return _tokenDb
}

function hashToken(raw) {
  return createHash('sha256').update(raw).digest('hex')
}

function validateDeviceToken(rawToken) {
  try {
    const hash = hashToken(rawToken)
    const row = getTokenDb().prepare(
      'SELECT user_id, device_id FROM device_tokens WHERE token_hash = ? AND revoked = 0'
    ).get(hash)
    return row ? { userId: row.user_id, deviceId: row.device_id } : null
  } catch (e) {
    console.error('[ws] Token validation error:', e.message)
    return null
  }
}

function updateLastSeen(rawToken) {
  try {
    const hash = hashToken(rawToken)
    getTokenDb().prepare(
      "UPDATE device_tokens SET last_seen = datetime('now') WHERE token_hash = ?"
    ).run(hash)
  } catch (e) {
    console.error('[ws] updateLastSeen error:', e.message)
  }
}

const PORT = 4801
const PING_INTERVAL = 15_000
const PONG_TIMEOUT = 10_000

// ── Command Validation ──────────────────────────────────
const ALLOWED_COMMAND_TYPES = new Set([
  'run_command', 'get_device_info', 'list_files', 'read_file',
  'receive_file', 'ping', 'clipboard_update',
])
const MAX_COMMAND_LENGTH = 10_000  // 10K chars
const MAX_FILE_SIZE = 10 * 1024 * 1024  // 10MB

function validateCommand(command) {
  if (!command || typeof command !== 'object') {
    return 'Command must be a JSON object'
  }
  if (!command.type || !ALLOWED_COMMAND_TYPES.has(command.type)) {
    return `Invalid command type "${command.type}". Allowed: ${[...ALLOWED_COMMAND_TYPES].join(', ')}`
  }
  // Check overall size
  const serialized = JSON.stringify(command)
  if (serialized.length > MAX_COMMAND_LENGTH) {
    return `Command too large (${serialized.length} chars, max ${MAX_COMMAND_LENGTH})`
  }
  // Log run_command for audit trail
  if (command.type === 'run_command' && command.command) {
    console.log(`[ws] AUDIT run_command: ${String(command.command).slice(0, 200)}`)
  }
  // Check file size for receive_file
  if (command.type === 'receive_file' && command.data) {
    const dataSize = typeof command.data === 'string' ? command.data.length : 0
    // Base64 is ~33% overhead, so raw size ~ dataSize * 0.75
    if (dataSize * 0.75 > MAX_FILE_SIZE) {
      return `File too large (estimated ${Math.round(dataSize * 0.75 / 1024 / 1024)}MB, max 10MB)`
    }
  }
  return null  // valid
}

const devices = new Map() // deviceId -> { ws, info, capabilities, stats }
let clipboardHistory = [] // last 50 clipboard entries across all devices

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
        userId: d.userId || null,
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
        const { device_id, command, user_id: requestUserId } = JSON.parse(body)

        // Validate command before forwarding to device
        const validationError = validateCommand(command)
        if (validationError) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: validationError }))
          return
        }

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

        // Enforce same-user ownership if both sides have user IDs
        if (device && requestUserId && device.userId && device.userId !== requestUserId) {
          res.writeHead(403, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'Device belongs to a different user' }))
          return
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
        case 'device_register': {
          // Token-based auth: validate device_token if provided
          let authUserId = null
          if (msg.device_token) {
            const tokenResult = validateDeviceToken(msg.device_token)
            if (!tokenResult) {
              console.log(`[ws] Invalid device token from ${req.socket.remoteAddress}`)
              ws.send(JSON.stringify({ type: 'auth_error', message: 'Invalid device token' }))
              ws.close(4001, 'Invalid device token')
              return
            }
            authUserId = tokenResult.userId
            updateLastSeen(msg.device_token)
            console.log(`[ws] Token auth OK: user_id=${authUserId}, device=${tokenResult.deviceId}`)
          }

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
            userId: authUserId,
            deviceToken: msg.device_token || null,
          })
          console.log(`[ws] Device registered: ${deviceId} (${msg.device_name || 'unknown'})${authUserId ? ` [user:${authUserId}]` : ''}`)
          console.log(`[ws] Capabilities:`, msg.capabilities)

          // Acknowledge
          ws.send(JSON.stringify({
            type: 'registered',
            device_id: deviceId,
            message: `Welcome, ${msg.device_name || deviceId}`,
            server_time: Date.now(),
          }))
          break
        }

        case 'command_response':
          stats.commandsReceived++
          console.log(`[ws] Response from ${deviceId}:`, msg.request_id)
          const device = devices.get(deviceId)
          if (device?.pendingRequests?.[msg.request_id]) {
            device.pendingRequests[msg.request_id](msg.result || msg)
            delete device.pendingRequests[msg.request_id]
          }
          break

        case 'clipboard_update':
          // Broadcast to all OTHER connected devices
          console.log(`[ws] Clipboard from ${deviceId}: ${(msg.content || '').slice(0, 40)}...`)
          // Store in history
          if (!clipboardHistory) clipboardHistory = []
          clipboardHistory.push({
            content: msg.content,
            source: deviceId,
            timestamp: Date.now(),
          })
          if (clipboardHistory.length > 50) clipboardHistory.shift()
          // Broadcast to all other devices
          for (const [otherId, otherDevice] of devices) {
            if (otherId !== deviceId && otherDevice.ws.readyState === WebSocket.OPEN) {
              otherDevice.ws.send(JSON.stringify({
                type: 'clipboard_update',
                content: msg.content,
                source_device: deviceId,
                timestamp: Date.now(),
              }))
            }
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
