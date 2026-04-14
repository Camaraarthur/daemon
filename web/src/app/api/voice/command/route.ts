import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, getUserId } from '@/lib/auth'
import * as db from '@/lib/db'
import getDb from '@/lib/db'

/**
 * POST /api/voice/command
 *
 * Receives a transcript from a pendant/voice device, routes it into the
 * user's designated "Voice" chat thread (auto-creating the "Voice"
 * project and thread on first use), and kicks off the agent loop via
 * the existing /api/chat streaming pipeline.
 *
 * Returns 202 immediately — the agent runs async and broadcasts results
 * to any subscribed WS clients (browser canvas, voice channel) via
 * broadcastThreadEvent from the /api/chat streaming path.
 *
 * Auth: daemon_token cookie (same session cookie the web UI uses).
 * Native apps exchange their device_token for this cookie via
 * /api/auth action=device_token_exchange.
 */
export async function POST(req: NextRequest) {
  const unauth = requireAuth(req)
  if (unauth) return unauth

  const userId = await getUserId(req)
  if (!userId) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const transcript: string = typeof body?.transcript === 'string' ? body.transcript.trim() : ''
  const source: string = typeof body?.source === 'string' ? body.source : 'pendant'
  const deviceId: string | null = typeof body?.device_id === 'string' ? body.device_id : null

  if (!transcript) {
    return NextResponse.json({ error: 'transcript required' }, { status: 400 })
  }

  // Resolve the user's "Voice" project (auto-create if missing)
  let voiceProject = db.getProjectByName(userId, 'voice')
  if (!voiceProject) {
    voiceProject = db.createProject(userId, {
      name: 'voice',
      display_name: 'Voice',
    })
  }

  // Resolve the user's "Voice" thread within that project
  const dbc = getDb()
  let voiceThread = dbc.prepare(
    `SELECT * FROM chat_threads WHERE user_id = ? AND project_id = ? AND title = 'Voice' ORDER BY created_at ASC LIMIT 1`,
  ).get(userId, voiceProject.id) as { id: string } | undefined

  if (!voiceThread) {
    const created = db.createThread(userId, voiceProject.id, 'Voice')
    voiceThread = { id: created.id }
  }

  // Kick off the agent loop via the existing /api/chat streaming pipeline.
  // Fire-and-forget — we return 202 immediately. The chat route handles
  // broadcast via WS push and gossip per the architecture.
  const cookie = req.headers.get('cookie') || ''
  const origin = new URL(req.url).origin

  void fetch(`${origin}/api/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: cookie,
    },
    body: JSON.stringify({
      message: transcript,
      threadId: voiceThread.id,
      projectId: voiceProject.id,
      stream: true,
    }),
  })
    .then(async (r) => {
      // Drain the SSE stream so the agent loop runs to completion.
      // We don't forward events — clients subscribe via WS (/ws/client).
      if (!r.body) return
      const reader = r.body.getReader()
      while (true) {
        const { done } = await reader.read()
        if (done) break
      }
    })
    .catch((e) => {
      console.error('[voice/command] agent loop error:', e)
    })

  return NextResponse.json(
    {
      ok: true,
      thread_id: voiceThread.id,
      project_id: voiceProject.id,
      source,
      device_id: deviceId,
    },
    { status: 202 },
  )
}
