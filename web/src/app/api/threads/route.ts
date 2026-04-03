import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { listThreads, createThread } from '@/lib/db'

// Reuse the getUserId pattern from projects route
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
