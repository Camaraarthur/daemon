#!/usr/bin/env node
/**
 * Daemon Composio MCP Server.
 *
 * Exposes a minimal set of Composio-backed actions (Gmail send/search,
 * Google Calendar create event, Google Drive upload) over the Model
 * Context Protocol (stdio JSON-RPC) so a spawned `claude -p` pendant
 * agent can reach the outside world in one tool call.
 *
 * Architecture: standalone stdio process. Each tool call POSTs directly
 * to Composio's v3 execute endpoint
 *   POST https://backend.composio.dev/api/v3/tools/execute/{SLUG}
 * with header `x-api-key: $COMPOSIO_API_KEY` and body
 *   { user_id: DAEMON_USER_EMAIL, arguments: {...} }
 *
 * 15s hard timeout per call (AbortController). One retry on 5xx or
 * network/timeout. 4xx returned immediately. On error code 1810
 * ("connected account not found") we surface a helpful message pointing
 * the user to https://dev.arturito.dev/integrations — we do NOT initiate
 * OAuth from this MCP server.
 *
 * Setup (register in pendant-mcp.json under mcpServers):
 *
 *   "composio": {
 *     "command": "node",
 *     "args": ["/home/arthur/daemon/cli/mcp-composio-server.mjs"],
 *     "env": {
 *       "COMPOSIO_API_KEY": "<key from vault.env>",
 *       "DAEMON_USER_EMAIL": "tutucamara@gmail.com"
 *     }
 *   }
 *
 * Env vars (read lazily on each call, not at module load):
 *   COMPOSIO_API_KEY   — Composio API key. Required. Warn on stderr if missing.
 *   DAEMON_USER_EMAIL  — Composio user_id (the authorized account's email).
 *                        Required. Warn on stderr if missing.
 */

import { createInterface } from 'readline'

const COMPOSIO_BASE = 'https://backend.composio.dev/api/v3'
const TOOL_TIMEOUT_MS = 15_000
const AUTHORIZE_URL = 'https://dev.arturito.dev/integrations'
const ERR_CONNECTED_ACCOUNT_NOT_FOUND = 1810

// Lazy env reads — the reference impl in arturito is explicit that this
// module must not snapshot env at import time.
function getApiKey() {
  return process.env.COMPOSIO_API_KEY || ''
}
function getUserEmail() {
  return process.env.DAEMON_USER_EMAIL || ''
}

if (!getApiKey()) {
  process.stderr.write('[composio-mcp] WARNING: COMPOSIO_API_KEY not set — tool calls will fail.\n')
}
if (!getUserEmail()) {
  process.stderr.write('[composio-mcp] WARNING: DAEMON_USER_EMAIL not set — tool calls will fail.\n')
}

// ── Composio execution ─────────────────────────────────────

async function executeOnce(slug, args, userEmail) {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), TOOL_TIMEOUT_MS)
  try {
    const res = await fetch(`${COMPOSIO_BASE}/tools/execute/${encodeURIComponent(slug)}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': getApiKey(),
      },
      body: JSON.stringify({ user_id: userEmail, arguments: args }),
      signal: controller.signal,
    })
    const body = await res.json().catch(() => ({}))
    return { status: res.status, body }
  } finally {
    clearTimeout(timeoutId)
  }
}

function toolkitFromSlug(slug) {
  return slug.split('_')[0].toLowerCase()
}

function truncate(s, max = 2000) {
  if (s.length <= max) return s
  return s.slice(0, max) + `… [truncated ${s.length - max} chars]`
}

/**
 * Execute a Composio tool. Returns a single `{type:'text', text}` entry
 * for the MCP content array.
 */
async function runComposio(slug, args) {
  const apiKey = getApiKey()
  const userEmail = getUserEmail()
  if (!apiKey) return [{ type: 'text', text: 'Error: COMPOSIO_API_KEY not configured' }]
  if (!userEmail) return [{ type: 'text', text: 'Error: DAEMON_USER_EMAIL not configured' }]

  let lastError = null

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const { status, body } = await executeOnce(slug, args, userEmail)

      if (status >= 200 && status < 300) {
        const data = (body && typeof body === 'object' && 'data' in body) ? body.data : body
        return [{ type: 'text', text: truncate(JSON.stringify(data)) }]
      }

      const errBody = body && typeof body === 'object' ? body.error : null
      const errCode = errBody && typeof errBody === 'object' ? errBody.code : null
      const errSlug = errBody && typeof errBody === 'object' ? errBody.slug : null

      if (
        errCode === ERR_CONNECTED_ACCOUNT_NOT_FOUND ||
        errSlug === 'ActionExecute_ConnectedAccountNotFound'
      ) {
        const toolkit = toolkitFromSlug(slug)
        return [{
          type: 'text',
          text: `Authorize ${toolkit} first at ${AUTHORIZE_URL}`,
        }]
      }

      // 4xx → no retry
      if (status >= 400 && status < 500) {
        const msg = (errBody && errBody.message) || `Composio ${status}`
        return [{ type: 'text', text: `Error: ${msg}` }]
      }

      // 5xx → retry
      lastError = new Error(
        `Composio ${status}: ${(errBody && errBody.message) || truncate(JSON.stringify(body), 200)}`,
      )
    } catch (err) {
      if (err && err.name === 'AbortError') {
        if (attempt === 0) {
          lastError = err
          continue
        }
        return [{ type: 'text', text: `Error: Composio call timed out after ${TOOL_TIMEOUT_MS}ms` }]
      }
      lastError = err
    }
  }

  const msg = lastError instanceof Error ? lastError.message : String(lastError)
  return [{ type: 'text', text: `Error: ${msg}` }]
}

// ── Tool definitions ───────────────────────────────────────

const TOOLS = [
  {
    name: 'email_send',
    description:
      'Send an email via the authorized Gmail account. Use for pendant-driven messages ("tell Luca I\'ll be 10 min late"). Keep subjects short.',
    inputSchema: {
      type: 'object',
      properties: {
        recipient_email: { type: 'string', description: 'Recipient email address.' },
        subject: { type: 'string', description: 'Email subject line.' },
        body: { type: 'string', description: 'Email body.' },
        is_html: { type: 'boolean', description: 'Treat body as HTML. Default false.' },
      },
      required: ['recipient_email', 'subject', 'body'],
    },
  },
  {
    name: 'email_search',
    description:
      'Search the authorized Gmail inbox using Gmail query syntax (e.g. "from:luca after:2026/04/01"). Returns matching message summaries.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Gmail search query.' },
        max_results: { type: 'number', description: 'Max messages to return. Default 5.' },
      },
      required: ['query'],
    },
  },
  {
    name: 'calendar_create_event',
    description:
      'Create an event in the authorized Google Calendar. Use ISO8601 datetimes. Default timezone is Europe/Rome.',
    inputSchema: {
      type: 'object',
      properties: {
        summary: { type: 'string', description: 'Event title.' },
        start_datetime: { type: 'string', description: 'ISO8601 start datetime.' },
        end_datetime: { type: 'string', description: 'ISO8601 end datetime.' },
        description: { type: 'string', description: 'Optional event description.' },
        attendees: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional attendee email list.',
        },
        timezone: { type: 'string', description: 'IANA timezone. Default Europe/Rome.' },
      },
      required: ['summary', 'start_datetime', 'end_datetime'],
    },
  },
  {
    name: 'drive_upload',
    description:
      'Upload a local file (by server path) to the authorized Google Drive. Optional custom name and parent folder id.',
    inputSchema: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'Absolute local path on the daemon server.' },
        file_name: { type: 'string', description: 'Optional name for the uploaded file.' },
        parent_folder_id: { type: 'string', description: 'Optional Drive folder id to upload into.' },
      },
      required: ['file_path'],
    },
  },
]

// ── Tool dispatch ──────────────────────────────────────────

async function callTool(name, args) {
  try {
    switch (name) {
      case 'email_send': {
        const recipient_email = String(args.recipient_email ?? '')
        const subject = String(args.subject ?? '')
        const body = String(args.body ?? '')
        if (!recipient_email || !subject || !body) {
          return [{ type: 'text', text: 'Error: recipient_email, subject, and body are required' }]
        }
        const is_html = Boolean(args.is_html ?? false)
        return await runComposio('GMAIL_SEND_EMAIL', { recipient_email, subject, body, is_html })
      }

      case 'email_search': {
        const query = String(args.query ?? '')
        if (!query) return [{ type: 'text', text: 'Error: query is required' }]
        const max_results = Number(args.max_results ?? 5)
        return await runComposio('GMAIL_FETCH_EMAILS', { query, max_results })
      }

      case 'calendar_create_event': {
        const summary = String(args.summary ?? '')
        const start_datetime = String(args.start_datetime ?? '')
        const end_datetime = String(args.end_datetime ?? '')
        if (!summary || !start_datetime || !end_datetime) {
          return [{ type: 'text', text: 'Error: summary, start_datetime, and end_datetime are required' }]
        }
        const payload = {
          summary,
          start_datetime,
          end_datetime,
          timezone: String(args.timezone ?? 'Europe/Rome'),
        }
        if (args.description != null) payload.description = String(args.description)
        if (Array.isArray(args.attendees)) payload.attendees = args.attendees.map((a) => String(a))
        return await runComposio('GOOGLECALENDAR_CREATE_EVENT', payload)
      }

      case 'drive_upload': {
        const file_path = String(args.file_path ?? '')
        if (!file_path) return [{ type: 'text', text: 'Error: file_path is required' }]
        const payload = { file_path }
        if (args.file_name != null) payload.file_name = String(args.file_name)
        if (args.parent_folder_id != null) payload.parent_folder_id = String(args.parent_folder_id)
        return await runComposio('GOOGLEDRIVE_UPLOAD_FILE', payload)
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
        serverInfo: { name: 'daemon-composio', version: '0.1.0' },
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
    process.stderr.write(`[composio-mcp] handler error: ${e?.message || e}\n`)
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
  `[composio-mcp] ready (api_key=${getApiKey() ? 'set' : 'MISSING'}, user=${getUserEmail() || 'MISSING'})\n`,
)
