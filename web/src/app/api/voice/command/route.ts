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

  void runPendantAgent({
    transcript,
    threadId,
    userId,
    projectId: voiceProject.id,
    sessionToken,
    userEmail: userRow?.email || '',
    daemonName: userRow?.daemon_name || 'my',
    primaryDeviceId: primaryDevice?.device_id || '',
    composioKey,
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

  const args = [
    '-p', opts.transcript,
    '--append-system-prompt', `@${PENDANT_PROMPT}`,
    '--mcp-config', mcpPath,
    '--output-format', 'text',
    '--permission-mode', 'bypassPermissions',
  ]

  const child = spawn(CLAUDE_BIN, args, {
    cwd: workDir,
    env: { ...process.env },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  let stdout = ''
  let stderr = ''
  let killed = false
  const killTimer = setTimeout(() => {
    killed = true
    try { child.kill('SIGKILL') } catch {}
  }, SPAWN_TIMEOUT_MS)

  child.stdout.on('data', (c) => { stdout += c.toString() })
  child.stderr.on('data', (c) => { stderr += c.toString() })

  await new Promise<void>((resolve) => child.on('close', () => resolve()))
  clearTimeout(killTimer)

  const reply = (stdout.trim() || (killed ? 'pendant timed out.' : 'no output.')).slice(0, 4000)
  if (stderr && !stdout.trim()) console.warn('[pendant] stderr:', stderr.slice(0, 500))

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
