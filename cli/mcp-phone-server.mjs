#!/usr/bin/env node
/**
 * Daemon Phone MCP Server.
 *
 * Exposes pendant-agent-friendly tools over stdio JSON-RPC (MCP):
 *   - phone_photo_to_page: tell the user's primary phone to take a
 *     photo, save it into the user's site dir, and flash it on the
 *     canvas so Arthur sees it land during the demo.
 *   - page_write_text: push a card to the live canvas AND append a
 *     section to the published page.json if it exists.
 *
 * Architecture: this runs as a separate process spawned by a
 * headless `claude -p` pendant agent. It talks to two backends:
 *
 *   1. ws-server (HTTP mux, default :4801) — POST /skill/invoke to
 *      dispatch tool calls to the user's Android device. No auth on
 *      this endpoint at the time of writing (see ws-server.js line 424).
 *      Supports DAEMON_WS_SECRET if that changes.
 *
 *   2. Next relay (default https://my.daemon.page) — POST
 *      /api/stream/push to flash events on the live canvas. Requires
 *      daemon_token session cookie via DAEMON_SESSION_TOKEN.
 *
 * Env vars (lazy-read per call):
 *   DAEMON_RELAY_HTTP         — ws-server HTTP mux. Default http://localhost:4801.
 *   DAEMON_RELAY_HTTPS        — Next relay origin. Default https://my.daemon.page.
 *   DAEMON_SESSION_TOKEN      — daemon_token cookie. Required for canvas pushes.
 *   DAEMON_USER_ID            — integer user id. Required.
 *   DAEMON_PRIMARY_DEVICE_ID  — phone device id. Required.
 *   DAEMON_NAME               — site name (e.g. "my" for my.daemon.page). Required.
 *   DAEMON_WS_SECRET          — optional; sent as x-broadcast-secret if set.
 *   DAEMON_DATA_ROOT          — override data dir. Default /home/arthur/daemon/data.
 */

import { createInterface } from 'readline'
import { mkdirSync, writeFileSync, readFileSync, existsSync, renameSync } from 'fs'
import { join } from 'path'

// ── Env helpers (lazy) ─────────────────────────────────────

function env(name, fallback) {
  const v = process.env[name]
  return v && v.length ? v : fallback
}
function envRequired(name) {
  const v = process.env[name]
  if (!v) throw new Error(`${name} is required`)
  return v
}
function relayHttp() {
  return (env('DAEMON_RELAY_HTTP', 'http://localhost:4801')).replace(/\/+$/, '')
}
function relayHttps() {
  return (env('DAEMON_RELAY_HTTPS', 'https://my.daemon.page')).replace(/\/+$/, '')
}
function dataRoot() {
  return env('DAEMON_DATA_ROOT', '/home/arthur/daemon/data')
}

// ── Relay calls ────────────────────────────────────────────

async function invokeSkill(toolName, toolArgs, deviceIdOverride) {
  const userId = parseInt(envRequired('DAEMON_USER_ID'), 10)
  if (!Number.isFinite(userId)) throw new Error('DAEMON_USER_ID must be an integer')
  const deviceId = deviceIdOverride || envRequired('DAEMON_PRIMARY_DEVICE_ID')

  const headers = { 'Content-Type': 'application/json' }
  const wsSecret = env('DAEMON_WS_SECRET', '')
  if (wsSecret) headers['x-broadcast-secret'] = wsSecret

  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 40000)
  try {
    const res = await fetch(`${relayHttp()}/skill/invoke`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        user_id: userId,
        device_id: deviceId,
        tool_name: toolName,
        arguments: toolArgs || {},
      }),
      signal: ctrl.signal,
    })
    const text = await res.text()
    if (!res.ok) throw new Error(`relay ${res.status}: ${text.slice(0, 300)}`)
    try { return JSON.parse(text) } catch { return { raw: text } }
  } finally {
    clearTimeout(timer)
  }
}

async function callPageUpdate(tool, args) {
  const token = env('DAEMON_SESSION_TOKEN', '')
  const res = await fetch(`${relayHttps()}/api/page/update`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: `daemon_token=${token}`,
    },
    body: JSON.stringify({ tool, args }),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`page/update ${res.status}: ${text.slice(0, 200)}`)
  try { return JSON.parse(text) } catch { return { raw: text } }
}

async function pushToCanvas(type, data) {
  const token = env('DAEMON_SESSION_TOKEN', '')
  if (!token) {
    process.stderr.write('[phone-mcp] WARN: DAEMON_SESSION_TOKEN unset — canvas push will 401.\n')
  }
  const res = await fetch(`${relayHttps()}/api/stream/push`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: `daemon_token=${token}`,
    },
    body: JSON.stringify({ type, data, client: 'mcp-phone' }),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`canvas ${res.status}: ${body.slice(0, 200)}`)
  }
}

// ── Photo handling ─────────────────────────────────────────

function extractBase64(result) {
  if (!result || typeof result !== 'object') return null
  // Android CommandExecutor.takePhoto returns { base64, format, size } or { error }
  if (typeof result.error === 'string') throw new Error(`device error: ${result.error}`)
  if (typeof result.base64 === 'string' && result.base64.length > 0) {
    return { b64: result.base64, mime: mimeFromFormat(result.format) }
  }
  if (typeof result.image_base64 === 'string' && result.image_base64.length > 0) {
    return { b64: result.image_base64, mime: result.mime || 'image/jpeg' }
  }
  if (typeof result.data === 'string' && result.data.length > 0) {
    return { b64: result.data, mime: result.mime || 'image/jpeg' }
  }
  // Nested — some callers wrap in { ok: true, result: {...} }
  if (result.result) {
    try { return extractBase64(result.result) } catch (e) { throw e }
  }
  return null
}

function mimeFromFormat(fmt) {
  if (!fmt) return 'image/jpeg'
  const f = String(fmt).toLowerCase()
  if (f.includes('png')) return 'image/png'
  if (f.includes('webp')) return 'image/webp'
  return 'image/jpeg'
}

function extFromMime(mime) {
  if (mime === 'image/png') return 'png'
  if (mime === 'image/webp') return 'webp'
  return 'jpg'
}

function savePhoto(daemonName, b64, mime) {
  const siteDir = join(dataRoot(), 'sites', daemonName)
  const photosDir = join(siteDir, 'photos')
  mkdirSync(photosDir, { recursive: true, mode: 0o755 })
  const clean = b64.replace(/^data:image\/[a-zA-Z+]+;base64,/, '')
  const buf = Buffer.from(clean, 'base64')
  const ts = Date.now()
  const fname = `${ts}.${extFromMime(mime)}`
  const full = join(photosDir, fname)
  writeFileSync(full, buf)
  // Matches savePhotoFromBase64 convention in web/src/lib/page-tools.ts.
  return {
    path: full,
    relative_url: `/photos/${fname}`,
    public_url: `https://${daemonName}.daemon.page/photos/${fname}`,
    bytes: buf.length,
  }
}

function appendSectionToPageJson(daemonName, heading, bodyHtml) {
  const jsonPath = join(dataRoot(), 'sites', daemonName, 'page.json')
  if (!existsSync(jsonPath)) return { written: false, reason: 'page.json not found' }
  let model
  try {
    model = JSON.parse(readFileSync(jsonPath, 'utf8'))
  } catch (e) {
    return { written: false, reason: `page.json parse error: ${e.message}` }
  }
  if (!Array.isArray(model.sections)) model.sections = []
  const idx = model.sections.findIndex(
    (s) => s && typeof s.heading === 'string' &&
      s.heading.toLowerCase() === heading.toLowerCase(),
  )
  const entry = { heading, body_html: bodyHtml, ts: Date.now() }
  if (idx >= 0) model.sections[idx] = entry
  else model.sections.unshift(entry)
  model.updated_at = Date.now()

  // Atomic write — tmp + rename. We do NOT re-render index.html here;
  // the web app's page tooling owns the template. This is a bridge
  // until /api/page/add_* endpoints exist.
  const tmp = jsonPath + '.tmp'
  writeFileSync(tmp, JSON.stringify(model, null, 2), 'utf8')
  renameSync(tmp, jsonPath)
  return { written: true, sections: model.sections.length }
}

// ── Tool definitions ───────────────────────────────────────

const TOOLS = [
  {
    name: 'phone_photo_to_page',
    description:
      "Ask the user's primary phone to take a photo and publish it to their page at <daemon_name>.daemon.page. Saves the photo to the site's /photos/ dir and flashes the image on the live canvas so Arthur sees it land. Use when the user says 'take a photo and put it on my page' or similar.",
    inputSchema: {
      type: 'object',
      properties: {
        caption: { type: 'string', description: 'Optional caption shown with the photo.' },
      },
    },
  },
  {
    name: 'page_write_text',
    description:
      "Write a text section to the user's page and flash it on the canvas. Pushes a card to the live canvas, and if data/sites/<daemon_name>/page.json exists, appends/replaces a section with this heading. Use when the user says 'write X on your page'.",
    inputSchema: {
      type: 'object',
      properties: {
        heading: { type: 'string', description: 'Section heading (also the dedupe key).' },
        body_html: { type: 'string', description: 'HTML body of the section.' },
      },
      required: ['heading', 'body_html'],
    },
  },
]

// ── Tool dispatch ──────────────────────────────────────────

async function callTool(name, args) {
  try {
    switch (name) {
      case 'phone_photo_to_page': {
        const daemonName = envRequired('DAEMON_NAME')
        const caption = typeof args.caption === 'string' ? args.caption : ''

        const skillResp = await invokeSkill('take_photo', {})
        const extracted = extractBase64(skillResp)
        if (!extracted) {
          return [{
            type: 'text',
            text: `Error: phone responded but no image payload found. Shape: ${JSON.stringify(skillResp).slice(0, 300)}`,
          }]
        }

        const saved = savePhoto(daemonName, extracted.b64, extracted.mime)

        let canvasNote = 'canvas: ok'
        try {
          await pushToCanvas('card', {
            title: 'Photo',
            body: caption || `${saved.bytes} bytes`,
            image_url: saved.public_url,
          })
        } catch (e) {
          canvasNote = `canvas: ${e.message}`
        }

        let pageNote = 'page: ok'
        try {
          await callPageUpdate('page_add_photo', {
            image_url: saved.public_url,
            caption: caption || undefined,
          })
        } catch (e) {
          pageNote = `page: ${e.message}`
        }

        return [{
          type: 'text',
          text: `Photo posted to ${saved.public_url} (${saved.bytes}B; ${canvasNote}; ${pageNote}).`,
        }]
      }

      case 'page_write_text': {
        const daemonName = envRequired('DAEMON_NAME')
        const heading = String(args.heading ?? '').trim()
        const body_html = String(args.body_html ?? '')
        if (!heading || !body_html) {
          return [{ type: 'text', text: 'Error: heading and body_html are required' }]
        }

        let canvasNote = 'canvas: ok'
        try {
          await pushToCanvas('card', { title: heading, body: body_html })
        } catch (e) {
          canvasNote = `canvas: ${e.message}`
        }

        let pageNote = 'page: ok'
        try {
          await callPageUpdate('page_add_section', { heading, body_html })
        } catch (e) {
          pageNote = `page: ${e.message}`
        }

        return [{ type: 'text', text: `Wrote "${heading}". ${canvasNote}; ${pageNote}.` }]
      }

      default:
        return [{ type: 'text', text: `Unknown tool: ${name}` }]
    }
  } catch (e) {
    return [{ type: 'text', text: `Error in ${name}: ${e?.message || String(e)}` }]
  }
}

// ── JSON-RPC 2.0 dispatcher ────────────────────────────────

async function handleRequest(req) {
  const id = req.id ?? null
  const method = req.method
  const params = req.params || {}

  if (method === 'initialize') {
    return {
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'daemon-phone', version: '0.1.0' },
      },
    }
  }
  if (method === 'notifications/initialized') return null
  if (method === 'tools/list') return { jsonrpc: '2.0', id, result: { tools: TOOLS } }
  if (method === 'tools/call') {
    const content = await callTool(params.name, params.arguments || {})
    return { jsonrpc: '2.0', id, result: { content, isError: false } }
  }
  return {
    jsonrpc: '2.0',
    id,
    error: { code: -32601, message: `Method not found: ${method}` },
  }
}

const rl = createInterface({ input: process.stdin })

rl.on('line', async (line) => {
  const trimmed = line.trim()
  if (!trimmed) return
  let req
  try {
    req = JSON.parse(trimmed)
  } catch {
    return
  }
  try {
    const resp = await handleRequest(req)
    if (resp) process.stdout.write(JSON.stringify(resp) + '\n')
  } catch (e) {
    process.stderr.write(`[phone-mcp] handler error: ${e?.message || e}\n`)
    if (req?.id != null) {
      process.stdout.write(
        JSON.stringify({
          jsonrpc: '2.0',
          id: req.id,
          error: { code: -32000, message: e?.message || String(e) },
        }) + '\n',
      )
    }
  }
})

rl.on('close', () => process.exit(0))

process.stderr.write(
  `[phone-mcp] ready (relay_http=${relayHttp()}, relay_https=${relayHttps()}, user=${process.env.DAEMON_USER_ID || 'MISSING'}, device=${process.env.DAEMON_PRIMARY_DEVICE_ID || 'MISSING'}, name=${process.env.DAEMON_NAME || 'MISSING'}, token=${process.env.DAEMON_SESSION_TOKEN ? 'set' : 'MISSING'})\n`,
)
