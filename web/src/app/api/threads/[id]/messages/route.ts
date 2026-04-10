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
import { fetchMessagesFromDevice } from '@/lib/device-store'

// Step 8: when set to 'true', read from the user's daemon device's local
// SQLite via WS instead of the relay's chat_messages table. The relay
// still dual-writes during the transition, so we can fall back if the
// device is offline.
const READ_FROM_DEVICE = process.env.DAEMON_READ_FROM_DEVICE !== '0'

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
  // BOUND Claude Code session before reading. Sync writes to the relay's
  // DB (legacy) and gossips to the device — both copies stay current.
  let boundSessionId: string | null = null
  if (thread.project_id) {
    try {
      const proj = getProject(userId, thread.project_id)
      const result = syncBoundProject(thread.project_id, id, proj?.local_path || null, userId)
      boundSessionId = result.sessionId
    } catch (e) {
      console.warn('[claude-sync] pull-on-read failed:', e)
    }
  }

  const limit = parseInt(req.nextUrl.searchParams.get('limit') || '200', 10)
  const mode = req.nextUrl.searchParams.get('mode') || 'recent' // 'recent' | 'oldest' | 'all'
  const offset = parseInt(req.nextUrl.searchParams.get('offset') || '0', 10)
  const explicitSession = req.nextUrl.searchParams.get('session')

  // Resolve the session id (bound Claude Code session). The relay's
  // claude_code_links table is metadata, not content — keeps living here.
  const sessionId = explicitSession || boundSessionId ||
    (thread.project_id ? getClaudeCodeLink(thread.project_id)?.active_session_id || null : null)

  // ── Step 8 path: read from the user's daemon device ──────
  // The device's local SQLite has the canonical conversation (mirrored
  // by gossip from the relay). When the device is online, we use it.
  // When it's not, we fall back to the relay's legacy chat_messages
  // table during the transition.
  if (READ_FROM_DEVICE && mode !== 'oldest' && mode !== 'all') {
    const deviceResult = await fetchMessagesFromDevice({
      userId,
      threadId: id,
      limit,
      sourceSessionId: sessionId,
    })
    if (deviceResult.ok) {
      return NextResponse.json({
        messages: deviceResult.messages,
        total: deviceResult.total,
        source_session_id: sessionId || undefined,
        from_device: deviceResult.device_id,
      })
    }
    // Device unreachable — fall through to legacy path
    console.warn('[messages] device fetch failed, falling back to relay DB:', deviceResult.error)
  }

  // ── Legacy path: read from relay's chat_messages ─────────
  // Used when no device is online OR when the caller explicitly asks
  // for an older mode (oldest / all) that the device doesn't support yet.
  if (mode !== 'all' && mode !== 'oldest') {
    if (sessionId) {
      const total = countMessagesForSession(id, sessionId)
      const messages = listRecentMessagesForSession(id, sessionId, limit)
      return NextResponse.json({ messages, total, source_session_id: sessionId })
    }
  }

  const total = countMessages(id)
  const messages = mode === 'oldest'
    ? listMessages(id, limit, offset)
    : listRecentMessages(id, limit)

  return NextResponse.json({ messages, total })
}
