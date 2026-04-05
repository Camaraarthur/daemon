import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, getUserId } from '@/lib/auth'
import { listThreads, createThread } from '@/lib/db'

export async function GET(req: NextRequest) {
  const authErr = requireAuth(req)
  if (authErr) return authErr

  const userId = await getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const projectId = req.nextUrl.searchParams.get('projectId')
  const threads = listThreads(userId, projectId ? parseInt(projectId, 10) : undefined)
  return NextResponse.json({ threads })
}

export async function POST(req: NextRequest) {
  const authErr = requireAuth(req)
  if (authErr) return authErr

  const userId = await getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const { projectId, title } = await req.json()
  const thread = createThread(userId, projectId || undefined, title || undefined)
  return NextResponse.json({ thread })
}
