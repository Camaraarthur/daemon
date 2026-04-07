import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, getUserId } from '@/lib/auth'
import { listMessages, listRecentMessages, countMessages, getThread } from '@/lib/db'

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

  const limit = parseInt(req.nextUrl.searchParams.get('limit') || '200', 10)
  const mode = req.nextUrl.searchParams.get('mode') || 'recent' // 'recent' = last N, 'oldest' = first N
  const offset = parseInt(req.nextUrl.searchParams.get('offset') || '0', 10)

  const total = countMessages(id)
  const messages = mode === 'oldest'
    ? listMessages(id, limit, offset)
    : listRecentMessages(id, limit)

  return NextResponse.json({ messages, total })
}
