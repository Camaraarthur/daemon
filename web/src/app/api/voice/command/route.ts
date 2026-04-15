import { NextRequest, NextResponse } from 'next/server'
import { spawn } from 'node:child_process'
import { writeFile, mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { requireAuth, getUserId } from '@/lib/auth'
import * as db from '@/lib/db'
import getDb from '@/lib/db'
import { broadcastThreadEvent, gossipChatMessage } from '@/lib/ws-broadcast'
import { fetchMessagesFromDevice } from '@/lib/device-store'

/**
 * POST /api/voice/command
 *
 * Pendant path. Spawns `claude -p <transcript>` with the pendant persona
 * and MCP servers (canvas / composio / phone). Broadcasts the assistant
 * reply to the Voice thread and flashes a canvas card. Returns 202 —
 * the spawn runs fire-and-forget.
 *
 * Deliberately does NOT route through /api/chat. The pendant needs the
 * Claude Code tool loop with MCP, not the relay's model-router agent loop.
 */

const PENDANT_PROMPT = '/home/arthur/daemon/config/pendant-prompt.md'
const PENDANT_MCP_TEMPLATE = '/home/arthur/daemon/config/pendant-mcp.json'
const CLAUDE_BIN = process.env.CLAUDE_BIN || 'claude'
const SPAWN_TIMEOUT_MS = 90_000

export async function POST(req: NextRequest) {
  const unauth = requireAuth(req)
  if (unauth) return unauth

  const userId = await getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  let body: any
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const transcript: string = typeof body?.transcript === 'string' ? body.transcript.trim() : ''
  const source: string = typeof body?.source === 'string' ? body.source : 'pendant'
  const deviceId: string | null = typeof body?.device_id === 'string' ? body.device_id : null
  if (!transcript) return NextResponse.json({ error: 'transcript required' }, { status: 400 })

  const voiceProject = db.getProjectByName(userId, 'voice')
    || db.createProject(userId, { name: 'voice', display_name: 'Voice' })

  const dbc = getDb()
  let voiceThread = dbc.prepare(
    `SELECT * FROM chat_threads WHERE user_id = ? AND project_id = ? AND title = 'Voice' ORDER BY created_at ASC LIMIT 1`,
  ).get(userId, voiceProject.id) as { id: string } | undefined
  if (!voiceThread) {
    const created = db.createThread(userId, voiceProject.id, 'Voice')
    voiceThread = { id: created.id }
  }
  const threadId = voiceThread.id

  const userMsgId = randomUUID()
  const nowIso = new Date().toISOString()
  broadcastThreadEvent(threadId, {
    type: 'message.created',
    message_id: userMsgId,
    thread_id: threadId,
    role: 'user',
    content: transcript,
    created_at: nowIso,
    complete: true,
  })
  gossipChatMessage(userId, {
    id: userMsgId, thread_id: threadId, role: 'user', content: transcript,
    created_at: nowIso, complete: true,
    project_id: voiceProject.id, thread_title: 'Voice',
  })

  const userRow = dbc.prepare(
    `SELECT email, daemon_name FROM users WHERE id = ?`,
  ).get(userId) as { email: string; daemon_name: string } | undefined

  const primaryDevice = dbc.prepare(
    `SELECT device_id FROM device_tokens
       WHERE user_id = ? AND revoked = 0 AND platform = 'android'
       ORDER BY last_seen DESC LIMIT 1`,
  ).get(userId) as { device_id: string } | undefined

  const cookie = req.headers.get('cookie') || ''
  const sessionTokenMatch = cookie.match(/daemon_token=([a-f0-9]+)/i)
  const sessionToken = sessionTokenMatch?.[1] || ''
  const composioKey = process.env.COMPOSIO_API_KEY || ''
  // Composio connections live under the CRA workspace email, not tutucamara@gmail.com.
  const composioUserEmail = process.env.DAEMON_COMPOSIO_USER_EMAIL
    || 'arthur.camara@carloratti.com'

  void runPendantAgent({
    transcript,
    threadId,
    userId,
    projectId: voiceProject.id,
    sessionToken,
    userEmail: composioUserEmail,
    daemonName: userRow?.daemon_name || 'my',
    primaryDeviceId: primaryDevice?.device_id || '',
    composioKey,
    userMsgIdToExclude: userMsgId,
  }).catch((e) => console.error('[voice/command] pendant spawn error:', e))

  return NextResponse.json(
    { ok: true, thread_id: threadId, project_id: voiceProject.id, source, device_id: deviceId },
    { status: 202 },
  )
}

async function runPendantAgent(opts: {
  transcript: string
  threadId: string
  userId: number
  projectId: number
  sessionToken: string
  userEmail: string
  daemonName: string
  primaryDeviceId: string
  composioKey: string
  userMsgIdToExclude: string
}) {
  const rawTemplate = await readFile(PENDANT_MCP_TEMPLATE, 'utf8')
  const mcpJson = rawTemplate
    .replaceAll('__DAEMON_SESSION_TOKEN__', opts.sessionToken)
    .replaceAll('__COMPOSIO_API_KEY__', opts.composioKey)
    .replaceAll('__DAEMON_USER_EMAIL__', opts.userEmail)
    .replaceAll('__DAEMON_USER_ID__', String(opts.userId))
    .replaceAll('__DAEMON_PRIMARY_DEVICE_ID__', opts.primaryDeviceId)
    .replaceAll('__DAEMON_NAME__', opts.daemonName)

  const workDir = await mkdtemp(join(tmpdir(), 'pendant-'))
  const mcpPath = join(workDir, 'mcp.json')
  await writeFile(mcpPath, mcpJson, 'utf8')

  const assistantMsgId = randomUUID()
  const startedAt = new Date().toISOString()

  broadcastThreadEvent(opts.threadId, {
    type: 'message.created',
    message_id: assistantMsgId,
    thread_id: opts.threadId,
    role: 'assistant',
    content: '',
    created_at: startedAt,
    complete: false,
  })

  // Push a "you said" card immediately so the audience sees the
  // transcript land before the agent runs. Best-effort.
  pushPendantCanvas(opts.sessionToken, 'card', {
    title: 'You said',
    body: opts.transcript.slice(0, 400),
  })

  // Build the prompt with recent thread context. Each pendant turn is a
  // fresh `claude -p` spawn — without explicit context, the agent has
  // zero memory of prior turns and can't recognize follow-ups like "hi"
  // as the answer to "what should I write?". Fetch the last few messages
  // from the Voice thread (excluding the just-broadcast user transcript)
  // and prepend them as a context block. Best-effort — if the device is
  // offline or fetch fails, fall back to bare transcript.
  const promptText = await buildPendantPrompt({
    userId: opts.userId,
    threadId: opts.threadId,
    currentTranscript: opts.transcript,
    currentUserMsgId: opts.userMsgIdToExclude,
  })

  // stream-json output gives us per-event tool calls, text deltas, etc. —
  // we mirror them to the canvas so the audience sees "agent thinking,
  // calling tool X, replying" instead of just the final terse reply.
  const args = [
    '-p', promptText,
    '--append-system-prompt', `@${PENDANT_PROMPT}`,
    '--mcp-config', mcpPath,
    '--output-format', 'stream-json',
    '--verbose',
    '--permission-mode', 'bypassPermissions',
  ]

  // Strip ANTHROPIC_API_KEY so claude falls back to the Max subscription
  // auth (stored in ~/.claude/). When the env var is set, claude prefers
  // API pay-as-you-go billing which has a separate (often empty) balance.
  const spawnEnv = { ...process.env }
  delete spawnEnv.ANTHROPIC_API_KEY
  const child = spawn(CLAUDE_BIN, args, {
    cwd: workDir,
    env: spawnEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  let stderr = ''
  let killed = false
  const killTimer = setTimeout(() => {
    killed = true
    try { child.kill('SIGKILL') } catch {}
  }, SPAWN_TIMEOUT_MS)

  // Parse line-buffered stream-json. Each event is a JSON object;
  // we surface tool_use blocks and assistant text to the canvas.
  let buf = ''
  let finalReply = ''
  child.stdout.on('data', (chunk) => {
    buf += chunk.toString()
    let nl
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim()
      buf = buf.slice(nl + 1)
      if (!line) continue
      try {
        const ev = JSON.parse(line)
        handlePendantStreamEvent(ev, opts.sessionToken, (text) => {
          if (text) finalReply += text
        })
      } catch {
        // not JSON — ignore (claude prints non-JSON status sometimes)
      }
    }
  })
  child.stderr.on('data', (c) => { stderr += c.toString() })

  await new Promise<void>((resolve) => child.on('close', () => resolve()))
  clearTimeout(killTimer)

  const reply = (finalReply.trim() || (killed ? 'pendant timed out.' : 'no output.')).slice(0, 4000)
  if (stderr && !finalReply.trim()) console.warn('[pendant] stderr:', stderr.slice(0, 500))

  broadcastThreadEvent(opts.threadId, {
    type: 'message.completed',
    message_id: assistantMsgId,
    thread_id: opts.threadId,
    role: 'assistant',
    content: reply,
    complete: true,
  })
  gossipChatMessage(opts.userId, {
    id: assistantMsgId,
    thread_id: opts.threadId,
    role: 'assistant',
    content: reply,
    created_at: startedAt,
    complete: true,
    project_id: opts.projectId,
    thread_title: 'Voice',
  })

  try {
    await fetch(`${process.env.NEXT_PUBLIC_DAEMON_ORIGIN || 'https://my.daemon.page'}/api/stream/push`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `daemon_token=${opts.sessionToken}`,
      },
      body: JSON.stringify({
        type: 'card',
        data: { title: 'Pendant', body: reply.slice(0, 280) },
        client: 'pendant-agent',
      }),
    })
  } catch (e: any) {
    console.warn('[pendant] canvas push failed:', e?.message)
  }

  rm(workDir, { recursive: true, force: true }).catch(() => {})
}

// Build the prompt body sent to `claude -p`. If we can fetch recent
// thread messages from the user's device, we prepend them as a context
// block so the agent recognizes follow-ups ("hi" answering "what should
// I write?"). Bounded to the last 8 messages to keep the prompt small.
//
// Format:
//   Recent voice conversation (most recent last). Use this to recognize
//   follow-ups and continuations. Times are ISO 8601 UTC.
//
//     [2026-04-15T15:38:30Z] user: write a draft message to myself on whatsapp
//     [2026-04-15T15:38:36Z] assistant: sure — what should I write?
//
//   New transcript (act on this; the lines above are only context):
//     hi
async function buildPendantPrompt(opts: {
  userId: number
  threadId: string
  currentTranscript: string
  currentUserMsgId: string
}): Promise<string> {
  let history: Array<{ role: string; content: string; created_at: string; id: string }> = []
  try {
    const r = await Promise.race([
      fetchMessagesFromDevice({ userId: opts.userId, threadId: opts.threadId, limit: 16 }),
      new Promise<{ ok: false; messages: [] }>((resolve) =>
        setTimeout(() => resolve({ ok: false, messages: [] }), 3000),
      ),
    ])
    if (r.ok && Array.isArray(r.messages)) history = r.messages as any
  } catch {}

  // Drop the message we just wrote (so the agent doesn't see "user: hi"
  // duplicated in both the context block and the new-transcript line).
  // Also drop incomplete assistant placeholders.
  const filtered = history
    .filter((m) => m.id !== opts.currentUserMsgId)
    .filter((m) => typeof m.content === 'string' && m.content.trim().length > 0)
    .slice(-8)

  if (filtered.length === 0) return opts.currentTranscript

  const lines = filtered.map((m) => {
    const ts = m.created_at || ''
    const role = m.role === 'assistant' ? 'assistant' : 'user'
    const body = String(m.content).replace(/\s+/g, ' ').slice(0, 400)
    return `  [${ts}] ${role}: ${body}`
  })

  return [
    'Recent voice conversation (most recent last). Use this to recognize',
    'follow-ups and continuations. Times are ISO 8601 UTC. If the new',
    'transcript looks like a short reply ("hi", "yes", "no", a name…),',
    'treat it as the answer to the most recent assistant question.',
    '',
    ...lines,
    '',
    'New transcript (act on this; the lines above are only context):',
    `  ${opts.currentTranscript}`,
  ].join('\n')
}

// Fire-and-forget canvas push. Used to mirror agent activity (tool calls,
// thinking, replies) to the live canvas during a pendant turn.
function pushPendantCanvas(sessionToken: string, type: string, data: any) {
  const origin = process.env.NEXT_PUBLIC_DAEMON_ORIGIN || 'https://my.daemon.page'
  fetch(`${origin}/api/stream/push`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: `daemon_token=${sessionToken}`,
    },
    body: JSON.stringify({ type, data, client: 'pendant-agent' }),
  }).catch(() => {})
}

// claude --output-format stream-json emits one JSON object per line.
// Shape (simplified):
//   {type:'system', subtype:'init', ...}                        — boot
//   {type:'assistant', message:{content:[{type:'text'|'tool_use', ...}]}}  — turn
//   {type:'user', message:{content:[{type:'tool_result', ...}]}}           — tool reply
//   {type:'result', subtype:'success', result: '<final text>', ...}         — done
//
// We surface tool_use (so audience sees "calling X") and the final result
// to the canvas. Text blocks are accumulated into finalReply so the chat
// thread + canvas final card show the assistant's actual reply.
function handlePendantStreamEvent(
  ev: any,
  sessionToken: string,
  onText: (text: string) => void,
) {
  try {
    if (ev?.type === 'assistant' && ev.message?.content) {
      for (const block of ev.message.content) {
        if (block.type === 'text' && typeof block.text === 'string') {
          onText(block.text)
        } else if (block.type === 'tool_use' && typeof block.name === 'string') {
          // mirror tool calls live on canvas — strip the mcp__server__ prefix
          // for a cleaner label ("canvas_text" not "mcp__canvas__canvas_text")
          const cleanName = block.name.replace(/^mcp__[^_]+__/, '')
          let argsBody = ''
          try { argsBody = JSON.stringify(block.input || {}, null, 2) } catch {}
          if (argsBody.length > 220) argsBody = argsBody.slice(0, 220) + '…'
          pushPendantCanvas(sessionToken, 'card', {
            title: `🔧 ${cleanName}`,
            body: argsBody,
          })
        }
      }
    } else if (ev?.type === 'result' && typeof ev.result === 'string') {
      pushPendantCanvas(sessionToken, 'card', {
        title: 'Done',
        body: ev.result.slice(0, 280),
      })
      onText(ev.result)
    }
  } catch {
    // never let canvas push errors break the spawn
  }
}
