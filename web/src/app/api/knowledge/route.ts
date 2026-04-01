import { requireAuth } from '@/lib/auth'
import { NextRequest, NextResponse } from 'next/server'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { join } from 'path'

const execFileAsync = promisify(execFile)
const DAEMON_ROOT = join(process.cwd(), '..')
const VENV_PYTHON = join(DAEMON_ROOT, '.venv', 'bin', 'python3')

export async function GET(req: NextRequest) {
  const authErr = requireAuth(req); if (authErr) return authErr;
  try {
    const { stdout } = await execFileAsync(VENV_PYTHON, ['-c', `
import sys, os, json
sys.path.insert(0, os.environ["DAEMON_SERVER"])
from knowledge import get_knowledge_stats
print(json.dumps(get_knowledge_stats()))
`], { timeout: 10000, env: { ...process.env, PYTHONPATH: join(DAEMON_ROOT, 'server'), DAEMON_SERVER: join(DAEMON_ROOT, 'server') } })

    return NextResponse.json(JSON.parse(stdout.trim()))
  } catch (error: any) {
    return NextResponse.json({ error: error?.message }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  // Search knowledge graph
  try {
    const { query, limit } = await req.json()
    const { stdout } = await execFileAsync(VENV_PYTHON, ['-c', `
import sys, os, json
sys.path.insert(0, os.environ["DAEMON_SERVER"])
from knowledge import recall_knowledge
results = recall_knowledge(os.environ["SEARCH_QUERY"], limit=int(os.environ["SEARCH_LIMIT"]))
print(json.dumps(results, default=str))
`], { timeout: 15000, env: { ...process.env, PYTHONPATH: join(DAEMON_ROOT, 'server'), DAEMON_SERVER: join(DAEMON_ROOT, 'server'), SEARCH_QUERY: (query || '').slice(0, 500), SEARCH_LIMIT: String(limit || 10) } })

    return NextResponse.json(JSON.parse(stdout.trim()))
  } catch (error: any) {
    return NextResponse.json({ error: error?.message }, { status: 500 })
  }
}
