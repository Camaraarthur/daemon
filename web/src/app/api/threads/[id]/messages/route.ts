import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { listMessages, getThread } from '@/lib/db'

export async function GET(
  req: NextRequest,
  ctx: RouteContext<'/api/threads/[id]/messages'>
) {
  const authErr = requireAuth(req)
  if (authErr) return authErr

  const { id } = await ctx.params

  // Verify thread exists
  const thread = getThread(id)
  if (!thread) {
    return NextResponse.json({ error: 'Thread not found' }, { status: 404 })
  }

  const limit = parseInt(req.nextUrl.searchParams.get('limit') || '200', 10)
  const offset = parseInt(req.nextUrl.searchParams.get('offset') || '0', 10)
  const messages = listMessages(id, limit, offset)

  return NextResponse.json({ messages })
}
