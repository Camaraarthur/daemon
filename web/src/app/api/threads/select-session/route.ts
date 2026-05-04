import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, getUserId } from '@/lib/auth'
import getDb, {
  getProject,
  upsertClaudeCodeLink,
  createThread,
} from '@/lib/db'

/**
 * POST /api/threads/select-session
 *
 * Body: { projectId: number, sessionId: string }
 *
 * Binds a Claude-Code JSONL session_id to a chat_thread for the project so
 * the sidebar can route every conversation type (DB or JSONL) through the
 * same /api/threads/[id]/messages flow. Without this, clicking a JSONL
 * session falls through to the project's singular default thread because
 * getThread() doesn't know JSONL session ids.
 *
 * Returns the chat_thread.id to use for setActiveThread / fetchMessages.
 */
export async function POST(req: NextRequest) {
  const authErr = requireAuth(req)
  if (authErr) return authErr
  const userId = await getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const projectId = Number(body?.projectId)
  const sessionId: string | undefined = body?.sessionId
  if (!Number.isFinite(projectId) || !sessionId) {
    return NextResponse.json({ error: 'projectId and sessionId required' }, { status: 400 })
  }

  const project = getProject(userId, projectId)
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

  // Reuse the project's most recent chat_thread if one exists; otherwise
  // create a new one. One canonical thread per project keeps the sidebar
  // simple and matches how Claude Code's `/resume` sees a project as a
  // single conversation surface that swaps which session it's bound to.
  const existing = getDb()
    .prepare('SELECT id FROM chat_threads WHERE user_id = ? AND project_id = ? ORDER BY created_at DESC LIMIT 1')
    .get(userId, projectId) as { id: string } | undefined
  const threadId = existing?.id ?? createThread(userId, projectId, project.name).id

  // upsert handles both new + existing via ON CONFLICT — replaces
  // active_session_id when a row exists, inserts when it doesn't.
  upsertClaudeCodeLink(projectId, project.local_path || '', sessionId)

  return NextResponse.json({ threadId, sessionId, projectId })
}
