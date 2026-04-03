import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { listProjects, createProject, updateProject, type Project } from '@/lib/db'

// Helper to get user ID from auth
async function getUserId(req: NextRequest): Promise<number | null> {
  const token = req.cookies.get('daemon_token')?.value
  if (!token) return null
  // Use the existing Python bridge for now
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

  const projects = listProjects(userId)
  return NextResponse.json({ projects })
}

export async function POST(req: NextRequest) {
  const authErr = requireAuth(req)
  if (authErr) return authErr

  const userId = await getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const data = await req.json()
  if (!data.name) return NextResponse.json({ error: 'Name required' }, { status: 400 })

  try {
    const project = createProject(userId, data)
    return NextResponse.json({ project })
  } catch (e: any) {
    if (e.message?.includes('UNIQUE')) {
      return NextResponse.json({ error: 'Project already exists' }, { status: 409 })
    }
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

export async function PUT(req: NextRequest) {
  const authErr = requireAuth(req)
  if (authErr) return authErr

  const userId = await getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const { id, ...data } = await req.json()
  if (!id) return NextResponse.json({ error: 'Project ID required' }, { status: 400 })

  const ok = updateProject(userId, id, data)
  return NextResponse.json({ ok })
}
