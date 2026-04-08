import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, getUserId } from '@/lib/auth'
import { getProject, getClaudeCodeLink, upsertClaudeCodeLink } from '@/lib/db'
import { findSessionsForLocalPath, findJsonlForSessionId } from '@/lib/claude-sync'
import * as fs from 'fs'
import * as path from 'path'

/**
 * GET  /api/projects/{id}/bound-session
 *   Returns the current bound Claude Code session id and a list of candidate
 *   sessions the user can switch to (sorted by mtime, newest first).
 *
 * POST /api/projects/{id}/bound-session
 *   Body: { session_id: string }
 *   Sets the project's bound Claude Code session. The next pull-on-read will
 *   pull from this session and only this session.
 *
 * DELETE /api/projects/{id}/bound-session
 *   Clears the binding so auto-bind picks a fresh session next time.
 */

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const authErr = requireAuth(req); if (authErr) return authErr
  const userId = await getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const { id } = await ctx.params
  const projectId = parseInt(id, 10)
  if (isNaN(projectId)) return NextResponse.json({ error: 'Invalid project id' }, { status: 400 })

  const proj = getProject(userId, projectId)
  if (!proj) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

  const link = getClaudeCodeLink(projectId)
  const bound = link?.active_session_id || null

  // Candidate sessions: any JSONL whose cwd has touched this project's path,
  // sorted by mtime DESC. The user picks one to bind.
  const candidates = proj.local_path
    ? findSessionsForLocalPath(proj.local_path).slice(0, 50).map(s => ({
        session_id: s.sessionId,
        jsonl_path: s.jsonlPath,
        mtime: s.mtime,
        is_bound: s.sessionId === bound,
      }))
    : []

  return NextResponse.json({
    bound_session_id: bound,
    bound_jsonl_path: bound ? findJsonlForSessionId(bound) : null,
    last_synced_at: link?.last_synced_at || null,
    candidates,
  })
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const authErr = requireAuth(req); if (authErr) return authErr
  const userId = await getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const { id } = await ctx.params
  const projectId = parseInt(id, 10)
  if (isNaN(projectId)) return NextResponse.json({ error: 'Invalid project id' }, { status: 400 })

  const proj = getProject(userId, projectId)
  if (!proj) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

  let body: any = {}
  try { body = await req.json() } catch {}
  const sessionId = (body.session_id || '').toString().trim()
  if (!sessionId) {
    return NextResponse.json({ error: 'session_id required' }, { status: 400 })
  }
  // Reject obviously bad input
  if (!/^[a-f0-9-]{8,64}$/i.test(sessionId)) {
    return NextResponse.json({ error: 'Invalid session_id format' }, { status: 400 })
  }

  const jsonlPath = findJsonlForSessionId(sessionId)
  if (!jsonlPath) {
    return NextResponse.json({ error: 'Session JSONL not found on disk' }, { status: 404 })
  }

  // Use the JSONL's parent dir as claude_project_dir for the link record.
  const link = getClaudeCodeLink(projectId)
  upsertClaudeCodeLink(
    projectId,
    link?.claude_project_dir || path.dirname(jsonlPath),
    sessionId,
  )

  return NextResponse.json({
    bound_session_id: sessionId,
    bound_jsonl_path: jsonlPath,
    bound_jsonl_size: fs.statSync(jsonlPath).size,
  })
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const authErr = requireAuth(req); if (authErr) return authErr
  const userId = await getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const { id } = await ctx.params
  const projectId = parseInt(id, 10)
  if (isNaN(projectId)) return NextResponse.json({ error: 'Invalid project id' }, { status: 400 })

  const proj = getProject(userId, projectId)
  if (!proj) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

  // Clear active_session_id but keep claude_project_dir + enabled state.
  const link = getClaudeCodeLink(projectId)
  if (link) {
    // Direct UPDATE to avoid the COALESCE in upsertClaudeCodeLink that would
    // preserve the existing value.
    const dbm = (await import('@/lib/db')).default
    dbm().prepare('UPDATE claude_code_links SET active_session_id = NULL WHERE project_id = ?').run(projectId)
  }
  return NextResponse.json({ bound_session_id: null })
}
