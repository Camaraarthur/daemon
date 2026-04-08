import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, getUserId } from '@/lib/auth'
import {
  listMessages,
  listRecentMessages,
  countMessages,
  getThread,
  getProject,
  getClaudeCodeLink,
  listRecentMessagesForSession,
  countMessagesForSession,
} from '@/lib/db'
import { syncBoundProject } from '@/lib/claude-sync'

export async function GET(
  req: NextRequest,
  ctx: RouteContext<'/api/threads/[id]/messages'>
) {
  const authErr = requireAuth(req)
  if (authErr) return authErr

  const userId = await getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const { id } = await ctx.params

  // SECURITY: Verify thread exists AND belongs to this user
  const thread = getThread(id)
  if (!thread || thread.user_id !== userId) {
    return NextResponse.json({ error: 'Thread not found' }, { status: 404 })
  }

  // Pull-on-read: if this thread belongs to a project, sync the project's
  // BOUND Claude Code session before reading from SQLite. The binding is
  // explicit (claude_code_links.active_session_id) so we never confuse
  // unrelated conversations that happen to share a working directory.
  let boundSessionId: string | null = null
  if (thread.project_id) {
    try {
      const proj = getProject(userId, thread.project_id)
      const result = syncBoundProject(thread.project_id, id, proj?.local_path || null)
      boundSessionId = result.sessionId
    } catch (e) {
      console.warn('[claude-sync] pull-on-read failed:', e)
    }
  }

  const limit = parseInt(req.nextUrl.searchParams.get('limit') || '200', 10)
  const mode = req.nextUrl.searchParams.get('mode') || 'recent' // 'recent' | 'oldest' | 'all'
  const offset = parseInt(req.nextUrl.searchParams.get('offset') || '0', 10)
  const explicitSession = req.nextUrl.searchParams.get('session')

  // Default: show ONLY the bound session's messages. The binding is the
  // single source of truth for "which conversation is this project right now".
  if (mode !== 'all' && mode !== 'oldest') {
    const sessionId = explicitSession || boundSessionId ||
      (thread.project_id ? getClaudeCodeLink(thread.project_id)?.active_session_id || null : null)
    if (sessionId) {
      const total = countMessagesForSession(id, sessionId)
      const messages = listRecentMessagesForSession(id, sessionId, limit)
      return NextResponse.json({ messages, total, source_session_id: sessionId })
    }
    // No binding — fall through to the unfiltered view so the user still
    // sees something on un-bound projects.
  }

  const total = countMessages(id)
  const messages = mode === 'oldest'
    ? listMessages(id, limit, offset)
    : listRecentMessages(id, limit)

  return NextResponse.json({ messages, total })
}
