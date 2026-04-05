import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, getUserId } from '@/lib/auth'
import { listProjectMessages, getProject } from '@/lib/db'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authErr = requireAuth(req)
  if (authErr) return authErr

  const userId = await getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const { id } = await params
  const projectId = parseInt(id, 10)
  if (isNaN(projectId)) {
    return NextResponse.json({ error: 'Invalid project ID' }, { status: 400 })
  }

  // Verify project belongs to user
  const project = getProject(userId, projectId)
  if (!project) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 })
  }

  const limit = parseInt(req.nextUrl.searchParams.get('limit') || '100', 10)
  const offset = parseInt(req.nextUrl.searchParams.get('offset') || '0', 10)

  const { messages, total } = listProjectMessages(projectId, limit, offset)

  // Insert divider markers at thread boundaries
  const result: any[] = []
  let lastThreadId: string | null = null

  for (const msg of messages) {
    if (msg.thread_id !== lastThreadId) {
      // New thread boundary — insert divider
      const date = new Date(msg.thread_created_at || msg.created_at)
      const dateStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      const title = msg.thread_title || 'Untitled'
      result.push({
        id: `divider-${msg.thread_id}`,
        role: 'divider',
        content: `${dateStr}: ${title}`,
        thread_id: msg.thread_id,
        thread_title: title,
        created_at: msg.created_at,
      })
      lastThreadId = msg.thread_id
    }
    result.push(msg)
  }

  return NextResponse.json({
    messages: result,
    total,
    hasMore: offset + limit < total,
  })
}
