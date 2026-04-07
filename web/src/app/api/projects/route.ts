import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, getUserId } from '@/lib/auth'
import { listProjects, createProject, updateProject, type Project } from '@/lib/db'
import { existsSync } from 'fs'
import { join } from 'path'
import { spawn } from 'child_process'

const DAEMON_ROOT = join(process.cwd(), '..')
const VENV_PYTHON = join(DAEMON_ROOT, '.venv', 'bin', 'python3')
const FILE_INDEXER = join(DAEMON_ROOT, 'server', 'file_indexer.py')

/**
 * Spawn the semantic file indexer in the background for a project. Errors
 * are logged but never block the API response — indexing is best-effort.
 */
function triggerBackgroundIndex(projectId: number, localPath: string): void {
  try {
    const child = spawn(
      VENV_PYTHON,
      [FILE_INDEXER, 'index', '--project-id', String(projectId), '--path', localPath],
      { detached: true, stdio: 'ignore' },
    )
    child.on('error', (e) => console.error('[projects] indexer spawn error:', e.message))
    child.unref()
  } catch (e: any) {
    console.error('[projects] failed to spawn indexer:', e?.message || e)
  }
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
    if (project && data.local_path && existsSync(data.local_path)) {
      triggerBackgroundIndex(project.id, data.local_path)
    }
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
