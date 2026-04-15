import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, getUserId } from '@/lib/auth'
import * as db from '@/lib/db'
import { deviceAppendBlock } from '@/lib/device-memory'

/**
 * POST /api/voice/context
 *
 * Ambient transcription chunks from a voice device. Appended to the
 * pendant_conversation memory block on the user's primary device,
 * each line prefixed with [ISO8601]. Not the pendant command path —
 * this is background listening.
 *
 * Body:
 *   { transcript: string, source?: string, device_id?: string,
 *     session_id?: string, chunk_index?: number,
 *     started_at?: string, ended_at?: string }
 *
 * Returns 202 — memory append is fire-and-forget.
 */
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
  if (!transcript) return NextResponse.json({ error: 'transcript required' }, { status: 400 })

  const source: string = typeof body?.source === 'string' ? body.source : 'pendant'
  const deviceId: string | null = typeof body?.device_id === 'string' ? body.device_id : null
  const sessionId: string | null = typeof body?.session_id === 'string' ? body.session_id : null
  const chunkIndex: number | null = typeof body?.chunk_index === 'number' ? body.chunk_index : null
  const startedAt: string | null = typeof body?.started_at === 'string' ? body.started_at : null
  const endedAt: string | null = typeof body?.ended_at === 'string' ? body.ended_at : null

  const voiceProject = db.getProjectByName(userId, 'voice')
    || db.createProject(userId, { name: 'voice', display_name: 'Voice' })

  const ts = endedAt || startedAt || new Date().toISOString()
  const meta: string[] = [source]
  if (deviceId) meta.push(`dev=${deviceId}`)
  if (sessionId) meta.push(`sid=${sessionId.slice(0, 8)}`)
  if (chunkIndex != null) meta.push(`#${chunkIndex}`)
  const line = `[${ts}] (${meta.join(' ')}) ${transcript}\n`

  void deviceAppendBlock({
    userId,
    projectId: voiceProject.id,
    label: 'pendant_conversation',
    addition: line,
  }).catch((e) => console.warn('[voice/context] memory append failed:', e?.message || e))

  return NextResponse.json(
    { ok: true, project_id: voiceProject.id, label: 'pendant_conversation', bytes: line.length },
    { status: 202 },
  )
}
