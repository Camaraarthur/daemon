import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { listProjectMessages, getProject } from '@/lib/db'

// Reuse getUserId pattern
async function getUserId(req: NextRequest): Promise<number | null> {
  const token = req.cookies.get('daemon_token')?.value
  if (!token) return null
  const { execFile } = require('child_process')
  const { promisify } = require('util')
  const { join } = require('path')
  const execFileAsync = promisify(execFile)
  const DAEMON_ROOT = join(process.cwd(), '..')
  const VENV_PYTHON = join(DAEMON_ROOT, '.venv', 'bin', 'python3')
  try {
    const { stdout } = await execFileAsync(VENV_PYTHON, ['-c', `
import sys,json,os; sys.path.insert(0,os.environ["DAEMON_SERVER"])
from users import get_user_by_token
u=get_user_by_token(os.environ["AUTH_TOKEN"])
print(json.dumps({"id": u["id"]} if u else {"id": None}))
`], { timeout: 3000, env: { ...process.env, DAEMON_SERVER: join(DAEMON_ROOT, 'server'), AUTH_TOKEN: token } })
    const { id } = JSON.parse(stdout.trim())
    return id
  } catch { return null }
}

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
