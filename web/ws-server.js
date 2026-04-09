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
 *
 * Security:
 * - Per-user device maps: each user can only see/command their own devices
 * - Token-validated device registration
 * - Clipboard broadcast scoped to same user
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

// Validate a browser session cookie token (sessions table). Returns user_id or null.
function validateSessionToken(rawToken) {
  try {
    const row = getTokenDb().prepare(
      "SELECT user_id FROM sessions WHERE token = ? AND (expires_at IS NULL OR expires_at > datetime('now'))"
    ).get(rawToken)
    return row?.user_id || null
  } catch (e) {
    console.error('[ws] Session token validation error:', e.message)
    return null
  }
}

// Look up the user_id that owns a chat thread (used to authorize subscriptions).
function getThreadOwnerUserId(threadId) {
  try {
    const row = getTokenDb().prepare(
      'SELECT user_id FROM chat_threads WHERE id = ?'
    ).get(threadId)
    return row?.user_id || null
  } catch (e) {
    return null
  }
}

// Parse a cookie header into an object.
function parseCookies(cookieHeader) {
  const out = {}
  if (!cookieHeader) return out
  for (const part of cookieHeader.split(';')) {
    const [k, ...v] = part.trim().split('=')
    if (k) out[k] = decodeURIComponent(v.join('='))
  }
  return out
}

// Shared secret for the internal /broadcast endpoint. Must match the one
// the Next.js process uses to push thread events. In dev, both sides default
// to 'dev-broadcast-secret'.
const BROADCAST_SECRET = process.env.WS_BROADCAST_SECRET || 'dev-broadcast-secret'

// Per-thread set of subscribed browser WebSockets. Populated when a client
// sends {type:'subscribe', thread_id}, drained on disconnect.
//   threadId -> Set<ws>
const threadSubscribers = new Map()

function broadcastToThread(threadId, payload) {
  const subs = threadSubscribers.get(threadId)
  if (!subs) return 0
  let sent = 0
  const data = JSON.stringify({ type: 'thread_event', thread_id: threadId, ...payload })
  for (const ws of subs) {
    if (ws.readyState === WebSocket.OPEN) {
      try { ws.send(data); sent++ } catch (_) {}
    }
  }
  return sent
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
  'skill.list', 'skill.invoke',
  // Step 7: chat message gossip and local store inspection
  'chat.message_imported', 'store.stats',
  // Step 8: relay reads thread history from device, not its own DB
  'chat.fetch_messages', 'chat.get_latest_session',
  // Step 8c: memory tools dispatched to device
  'memory.remember', 'memory.recall', 'memory.list_facts',
  'memory.get_block', 'memory.list_blocks',
  'memory.update_block', 'memory.append_block',
  // Vision §3.2: encrypted secrets vault on the device
  'secrets.set', 'secrets.get', 'secrets.delete',
  'secrets.list', 'secrets.exists', 'secrets.status',
  // Vision §3.3: scheduler primitive (cron / schedule / loop)
  'schedule.create', 'schedule.list', 'schedule.get',
  'schedule.delete', 'schedule.set_enabled',
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
  // Check file size for receive_file (uses higher limit)
  if (command.type === 'receive_file' && command.data) {
    const dataSize = typeof command.data === 'string' ? command.data.length : 0
    // Base64 is ~33% overhead, so raw size ~ dataSize * 0.75
    if (dataSize * 0.75 > MAX_FILE_SIZE) {
      return `File too large (estimated ${Math.round(dataSize * 0.75 / 1024 / 1024)}MB, max 10MB)`
    }
  } else {
    // Non-file commands: check overall size
    const serialized = JSON.stringify(command)
    if (serialized.length > MAX_COMMAND_LENGTH) {
      return `Command too large (${serialized.length} chars, max ${MAX_COMMAND_LENGTH})`
    }
  }
  // Log run_command for audit trail
  if (command.type === 'run_command' && command.command) {
    console.log(`[ws] AUDIT run_command: ${String(command.command).slice(0, 200)}`)
  }
  return null  // valid
}

// ── Per-User Device Maps ─────────────────────────────────
// Structure: userDevices = Map<userId, Map<deviceId, DeviceInfo>>
// Unauthenticated devices go into userId=0 (admin-visible only, cannot relay commands cross-user)
const userDevices = new Map() // userId -> Map(deviceId -> { ws, info, capabilities, stats, ... })

// Helper: iterate all devices across all users (for health/admin)
function* allDevices() {
  for (const [userId, deviceMap] of userDevices) {
    for (const [deviceId, device] of deviceMap) {
      yield [deviceId, device, userId]
    }
  }
}

// Helper: find a device by deviceId within a specific user's map (with fuzzy match)
function getUserDevice(userId, deviceId) {
  const deviceMap = userDevices.get(userId)
  if (!deviceMap) return null
  // Exact match first
  let device = deviceMap.get(deviceId)
  if (device) return device
  // Fuzzy match
  for (const [id, d] of deviceMap) {
    if (id.toLowerCase().includes(deviceId.toLowerCase()) ||
        deviceId.toLowerCase().includes(id.toLowerCase())) {
      return d
    }
  }
  return null
}

// Helper: remove a device from its user's map
function removeDevice(userId, deviceId) {
  const deviceMap = userDevices.get(userId)
  if (deviceMap) {
    deviceMap.delete(deviceId)
    if (deviceMap.size === 0) {
      userDevices.delete(userId)
    }
  }
}

// Helper: add a device to a user's map
function addDevice(userId, deviceId, deviceInfo) {
  if (!userDevices.has(userId)) {
    userDevices.set(userId, new Map())
  }
  userDevices.get(userId).set(deviceId, deviceInfo)
}

// Helper: get all devices for a specific user
function getDevicesForUser(userId) {
  return userDevices.get(userId) || new Map()
}

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
    // Health endpoint shows all devices across all users (admin/debug)
    res.writeHead(200, { 'Content-Type': 'application/json' })
    const deviceList = []
    for (const [deviceId, device, userId] of allDevices()) {
      deviceList.push({
        id: deviceId,
        name: device.info?.device_name,
        platform: device.info?.platform,
        connected: device.ws.readyState === WebSocket.OPEN,
        stats: device.stats,
        userId: userId,
      })
    }
    res.end(JSON.stringify({
      status: 'ok',
      uptime: process.uptime(),
      devices: deviceList,
    }))
    return
  }

  // POST /command — send command to a connected device and wait for response
  if (req.url === '/command' && req.method === 'POST') {
    let body = ''
    req.on('data', chunk => { body += chunk })
    req.on('end', () => {
      try {
        const { device_id, command, user_id: rawUserId } = JSON.parse(body)

        // Validate command before forwarding to device
        const validationError = validateCommand(command)
        if (validationError) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: validationError }))
          return
        }

        // SECURITY: user_id is REQUIRED. The previous "fall back to scanning
        // all users' devices if user_id is missing" was a cross-tenant blast
        // radius hole. Reject hard.
        if (rawUserId == null) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'user_id required' }))
          return
        }

        // Coerce to number — userDevices Map uses numeric keys (the
        // device_register handler stores from device_tokens.user_id which
        // is INTEGER), and JSON-parsed user_id may arrive as a string.
        const requestUserId = typeof rawUserId === 'string' ? parseInt(rawUserId, 10) : rawUserId
        if (isNaN(requestUserId)) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'user_id must be an integer' }))
          return
        }

        // Look up device within ONLY the requesting user's device map.
        const device = getUserDevice(requestUserId, device_id)

        // Enforce same-user ownership (defense in depth — getUserDevice
        // already filters, but a stray code path could pass a wrong device).
        if (device && device.userId && device.userId !== requestUserId) {
          res.writeHead(403, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'Device belongs to a different user' }))
          return
        }

        if (!device || device.ws.readyState !== WebSocket.OPEN) {
          // Only show devices belonging to the requesting user (don't leak other users' device IDs)
          const userDeviceIds = requestUserId
            ? Array.from(getDevicesForUser(requestUserId).keys())
            : []
          res.writeHead(404, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({
            error: `Device "${device_id}" not connected`,
            connected_devices: userDeviceIds,
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

        // Store the pending request. The device will send a `command_response`
        // message which our handler routes here as the whole `msg`. We pull
        // out `msg.result` if present (legacy command shape) or pass `msg`
        // through if not.
        if (!device.pendingRequests) device.pendingRequests = {}
        device.pendingRequests[requestId] = (msg) => {
          clearTimeout(timeout)
          const payload = (msg && typeof msg === 'object' && 'result' in msg) ? msg.result : msg
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify(payload))
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

  // GET /tools?user_id=N — list every tool advertised by every connected
  // device belonging to user N. Returned shape matches what agent-loop.ts
  // expects in fetchDeviceTools(): { tools: [{ name, device_id, device_name,
  // platform, tool_name, description, inputSchema }] }.
  //
  // The `name` field is namespaced as `<device_id>__<tool_name>` so the agent
  // loop can route by name without ambiguity when multiple devices expose
  // the same tool. agent-loop.ts already strips the namespace via deviceToolMap.
  if (req.url && req.url.startsWith('/tools') && req.method === 'GET') {
    try {
      const url = new URL(req.url, 'http://localhost')
      const userId = url.searchParams.get('user_id')
      if (!userId) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'user_id query parameter required' }))
        return
      }
      const numericUserId = parseInt(userId, 10)
      if (isNaN(numericUserId)) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'user_id must be an integer' }))
        return
      }

      const userDevs = getDevicesForUser(numericUserId)
      const tools = []
      for (const [devId, dev] of userDevs) {
        if (dev.ws.readyState !== WebSocket.OPEN) continue
        const deviceTools = Array.isArray(dev.tools) ? dev.tools : []
        for (const t of deviceTools) {
          if (!t || !t.name) continue
          tools.push({
            // Namespaced name for the agent loop's deviceToolMap
            name: `${devId}__${t.name}`,
            device_id: devId,
            device_name: dev.info?.device_name || devId,
            platform: dev.info?.platform || 'unknown',
            tool_name: t.name,           // unprefixed name for skill.invoke
            description: t.description || '',
            inputSchema: t.inputSchema || { type: 'object', properties: {} },
          })
        }
      }

      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ tools }))
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: e.message }))
    }
    return
  }

  // POST /skill/invoke — invoke a tool on a specific device.
  // Body: { user_id, device_id, tool_name, arguments }
  // Sends a `skill.invoke` WS message to the device, awaits its
  // `skill.result` response, returns the result.
  if (req.url === '/skill/invoke' && req.method === 'POST') {
    let body = ''
    req.on('data', chunk => { body += chunk })
    req.on('end', () => {
      try {
        const { user_id, device_id, tool_name, arguments: toolArgs } = JSON.parse(body)

        if (!user_id) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'user_id required' }))
          return
        }
        if (!device_id) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'device_id required' }))
          return
        }
        if (!tool_name) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'tool_name required' }))
          return
        }

        const numericUserId = parseInt(user_id, 10)
        if (isNaN(numericUserId)) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'user_id must be an integer' }))
          return
        }

        const device = getUserDevice(numericUserId, device_id)
        if (!device || device.ws.readyState !== WebSocket.OPEN) {
          const userDeviceIds = Array.from(getDevicesForUser(numericUserId).keys())
          res.writeHead(404, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({
            error: `Device "${device_id}" not connected`,
            connected_devices: userDeviceIds,
          }))
          return
        }
        // Defense in depth — getUserDevice already filtered, but check again.
        if (device.userId && device.userId !== numericUserId) {
          res.writeHead(403, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'Device belongs to a different user' }))
          return
        }

        const requestId = `skill-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

        const timeout = setTimeout(() => {
          delete device.pendingRequests?.[requestId]
          res.writeHead(504, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'Device did not respond within 35s' }))
        }, 35000)

        if (!device.pendingRequests) device.pendingRequests = {}
        device.pendingRequests[requestId] = (response) => {
          clearTimeout(timeout)
          // The device sends back { type: 'skill.result', request_id, name, result }
          // We just return the result field to the caller.
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify(response.result ?? response))
        }

        // Send skill.invoke WS message to the device. daemon.mjs (line 371)
        // already handles this message type and routes to executeMcpTool.
        device.ws.send(JSON.stringify({
          type: 'skill.invoke',
          request_id: requestId,
          name: tool_name,
          arguments: toolArgs || {},
        }))

        device.stats.commandsSent++
        console.log(`[ws] skill.invoke ${tool_name} → ${device_id} (${requestId})`)
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: e.message }))
      }
    })
    return
  }

  // POST /gossip/chat-message — fan a chat message out to every connected
  // daemon device belonging to a user. Step 7 of the relay/device split:
  // each device's local SQLite mirrors the conversation. Fire-and-forget
  // from the relay's perspective. Returns the count of devices that
  // received the gossip event (does NOT wait for ack).
  if (req.url === '/gossip/chat-message' && req.method === 'POST') {
    if (req.headers['x-broadcast-secret'] !== BROADCAST_SECRET) {
      res.writeHead(403, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'forbidden' }))
      return
    }
    let body = ''
    req.on('data', chunk => { body += chunk })
    req.on('end', () => {
      try {
        const { user_id, message } = JSON.parse(body)
        if (!user_id || !message || !message.id || !message.thread_id) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'user_id and message{id,thread_id} required' }))
          return
        }
        const numericUserId = parseInt(user_id, 10)
        if (isNaN(numericUserId)) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'user_id must be an integer' }))
          return
        }
        const userDevs = getDevicesForUser(numericUserId)
        let sent = 0
        for (const [, dev] of userDevs) {
          if (dev.ws.readyState !== WebSocket.OPEN) continue
          try {
            dev.ws.send(JSON.stringify({
              type: 'chat.message_imported',
              message,
              request_id: `gossip-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            }))
            sent++
          } catch (_) {}
        }
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true, sent }))
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: e.message }))
      }
    })
    return
  }

  // POST /broadcast — internal-only push for thread events.
  // Used by the Next.js chat route to fan out message.created/updated/completed
  // to all subscribed browser clients of a thread.
  if (req.url === '/broadcast' && req.method === 'POST') {
    if (req.headers['x-broadcast-secret'] !== BROADCAST_SECRET) {
      res.writeHead(403, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'forbidden' }))
      return
    }
    let body = ''
    req.on('data', chunk => { body += chunk })
    req.on('end', () => {
      try {
        const { thread_id, event } = JSON.parse(body)
        if (!thread_id || !event) {
          res.writeHead(400); res.end(JSON.stringify({ error: 'thread_id and event required' }))
          return
        }
        const sent = broadcastToThread(thread_id, { event })
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true, sent }))
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

// Both WS endpoints use noServer + manual upgrade routing. Two WSS instances
// each calling new WebSocketServer({server,path:...}) on the SAME http server
// silently collide — only the first one's upgrade handler is registered, and
// the second path returns 400. Routing the upgrade ourselves makes both work.
const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 * 1024 })

// ── Browser client WebSocket channel ───────────────────────
//
// Browsers connect here to subscribe to chat thread updates. Auth via the
// daemon_token cookie. Once authed, the client sends {type:'subscribe',
// thread_id} to start receiving message.* events for that thread.
const clientWss = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 })

// Upgrade router: dispatches to the right WSS by path.
server.on('upgrade', (req, socket, head) => {
  let pathname
  try { pathname = new URL(req.url, 'http://localhost').pathname }
  catch { socket.destroy(); return }

  if (pathname === '/ws/device') {
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req))
  } else if (pathname === '/ws/client') {
    clientWss.handleUpgrade(req, socket, head, (ws) => clientWss.emit('connection', ws, req))
  } else {
    socket.destroy()
  }
})

clientWss.on('connection', (ws, req) => {
  const cookies = parseCookies(req.headers.cookie || '')
  const token = cookies.daemon_token
  const userId = token ? validateSessionToken(token) : null
  if (!userId) {
    try { ws.send(JSON.stringify({ type: 'auth_error', message: 'unauthenticated' })) } catch (_) {}
    ws.close(4001, 'unauthenticated')
    return
  }
  console.log(`[ws-client] connected user=${userId} from ${req.socket.remoteAddress}`)

  const subscribedThreads = new Set()

  ws.on('message', (data) => {
    let msg
    try { msg = JSON.parse(data.toString()) } catch { return }
    if (!msg || typeof msg !== 'object') return

    if (msg.type === 'subscribe' && msg.thread_id) {
      const ownerId = getThreadOwnerUserId(msg.thread_id)
      if (!ownerId || ownerId !== userId) {
        try { ws.send(JSON.stringify({ type: 'subscribe_error', thread_id: msg.thread_id, message: 'unauthorized' })) } catch (_) {}
        return
      }
      subscribedThreads.add(msg.thread_id)
      let set = threadSubscribers.get(msg.thread_id)
      if (!set) { set = new Set(); threadSubscribers.set(msg.thread_id, set) }
      set.add(ws)
      try { ws.send(JSON.stringify({ type: 'subscribed', thread_id: msg.thread_id })) } catch (_) {}
      return
    }

    if (msg.type === 'unsubscribe' && msg.thread_id) {
      subscribedThreads.delete(msg.thread_id)
      const set = threadSubscribers.get(msg.thread_id)
      if (set) {
        set.delete(ws)
        if (set.size === 0) threadSubscribers.delete(msg.thread_id)
      }
      return
    }

    if (msg.type === 'ping') {
      try { ws.send(JSON.stringify({ type: 'pong', t: Date.now() })) } catch (_) {}
      return
    }
  })

  ws.on('close', () => {
    for (const tid of subscribedThreads) {
      const set = threadSubscribers.get(tid)
      if (set) {
        set.delete(ws)
        if (set.size === 0) threadSubscribers.delete(tid)
      }
    }
    console.log(`[ws-client] disconnected user=${userId}`)
  })
  ws.on('error', (err) => console.warn(`[ws-client] error user=${userId}:`, err.message))
})

wss.on('connection', (ws, req) => {
  console.log('[ws] New device connection from', req.socket.remoteAddress)
  let deviceId = null
  let deviceUserId = null // Track which user owns this connection
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

          deviceUserId = authUserId || 0 // 0 = unauthenticated (legacy/debug)

          // If device was previously registered under this user, count as reconnection
          const oldDevice = getUserDevice(deviceUserId, msg.device_id)
          if (oldDevice) {
            stats.reconnections = (oldDevice.stats?.reconnections || 0) + 1
            console.log(`[ws] Device reconnected: ${msg.device_id} (reconnection #${stats.reconnections})`)
            // Close old connection cleanly
            try { oldDevice.ws.close(1000, 'new connection') } catch (_) {}
            removeDevice(deviceUserId, msg.device_id)
          }

          deviceId = msg.device_id || `device-${Date.now()}`
          const deviceInfo = {
            ws,
            info: msg,
            capabilities: msg.capabilities || {},
            tools: msg.tools || [],
            registeredAt: new Date().toISOString(),
            stats,
            userId: authUserId,
            deviceToken: msg.device_token || null,
          }

          addDevice(deviceUserId, deviceId, deviceInfo)
          console.log(`[ws] Device registered: ${deviceId} (${msg.device_name || 'unknown'})${authUserId ? ` [user:${authUserId}]` : ' [unauthenticated]'}`)
          console.log(`[ws] Capabilities:`, msg.capabilities)
          console.log(`[ws] Tools registered: ${(msg.tools || []).map(t => t.name).join(', ') || 'none (will discover)'}`)

          // If no tools were sent inline, request them via skill.list
          if (!msg.tools || msg.tools.length === 0) {
            ws.send(JSON.stringify({ type: 'skill.list', request_id: `discover-${Date.now()}` }))
          }

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
        case 'skill.result':
        case 'skill.list_result': {
          stats.commandsReceived++
          console.log(`[ws] ${msg.type} from ${deviceId}:`, msg.request_id)
          const device = getUserDevice(deviceUserId, deviceId)
          if (device?.pendingRequests?.[msg.request_id]) {
            // Pass the WHOLE message to the pendingRequest callback. The
            // /command handler reads .result, the /skill/invoke handler
            // reads .result, the skill.list response carries .tools.
            device.pendingRequests[msg.request_id](msg)
            delete device.pendingRequests[msg.request_id]
          } else if (msg.type === 'skill.list_result') {
            // Unsolicited skill.list_result on connect — capture device tools
            // so /tools can return them without re-querying.
            if (device && Array.isArray(msg.tools)) {
              device.tools = msg.tools
              console.log(`[ws] Device ${deviceId} advertised ${msg.tools.length} tools (auto-list)`)
            }
          }
          break
        }

        case 'clipboard_update': {
          // SECURITY: Only broadcast to devices belonging to the SAME user
          console.log(`[ws] Clipboard from ${deviceId} [user:${deviceUserId}]: ${(msg.content || '').slice(0, 40)}...`)
          // Store in history
          if (!clipboardHistory) clipboardHistory = []
          clipboardHistory.push({
            content: msg.content,
            source: deviceId,
            userId: deviceUserId,
            timestamp: Date.now(),
          })
          if (clipboardHistory.length > 50) clipboardHistory.shift()

          // Broadcast only to same user's other devices
          if (deviceUserId) {
            const sameUserDevices = getDevicesForUser(deviceUserId)
            for (const [otherId, otherDevice] of sameUserDevices) {
              if (otherId !== deviceId && otherDevice.ws.readyState === WebSocket.OPEN) {
                otherDevice.ws.send(JSON.stringify({
                  type: 'clipboard_update',
                  content: msg.content,
                  source_device: deviceId,
                  timestamp: Date.now(),
                }))
              }
            }
          }
          break
        }

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
    if (deviceId && deviceUserId !== null) {
      console.log(`[ws] Device disconnected: ${deviceId} [user:${deviceUserId}]`)
      removeDevice(deviceUserId, deviceId)
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

// API to send commands to devices (used internally)
function sendCommandToDevice(deviceId, command, userId) {
  let device = null
  if (userId) {
    device = getUserDevice(userId, deviceId)
  } else {
    // Fallback: search all users (legacy callers — log warning)
    console.warn(`[ws] sendCommandToDevice called without userId for device ${deviceId}`)
    for (const [did, d] of allDevices()) {
      if (did === deviceId) {
        device = d
        break
      }
    }
  }

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
export { userDevices, sendCommandToDevice, getDevicesForUser, allDevices }

// Sweep up dangling in-flight chat messages from a prior crash. Anything
// still complete=0 after the server died is a phantom — mark it complete.
try {
  const result = getTokenDb().prepare(`
    UPDATE chat_messages
    SET complete = 1, content = COALESCE(content, '') || char(10) || char(10) || '[interrupted — server restart]'
    WHERE complete = 0
  `).run()
  if (result.changes > 0) console.log(`[ws] Reaped ${result.changes} stale in-flight messages from prior run`)
} catch (e) {
  // chat_messages.complete may not exist yet if migrations haven't run — fine.
}

server.listen(PORT, () => {
  console.log(`[ws] Device WebSocket server on :${PORT}/ws/device`)
  console.log(`[ws] Client WebSocket server on :${PORT}/ws/client`)
  console.log(`[ws] Health check: http://localhost:${PORT}/health`)
  console.log(`[ws] Command API: POST http://localhost:${PORT}/command`)
  console.log(`[ws] Broadcast endpoint: POST http://localhost:${PORT}/broadcast`)
})
