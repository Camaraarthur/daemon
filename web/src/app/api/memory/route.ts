import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { join } from 'path'

const DAEMON_ROOT = join(process.cwd(), '..')
const VENV_PYTHON = join(DAEMON_ROOT, '.venv', 'bin', 'python3')
const MEMORY_SEARCH = join(DAEMON_ROOT, 'server', 'memory_search.py')
const FILE_INDEXER = join(DAEMON_ROOT, 'server', 'file_indexer.py')

/**
 * Run file_indexer.py in search mode and return parsed results.
 * Parameters are passed as argv (project id is coerced to int, query is
 * passed as a single argv element so shell metacharacters are inert).
 */
async function runFileSearch(projectId: string, query: string, limit: number): Promise<any[]> {
  const pid = parseInt(projectId, 10)
  if (!Number.isFinite(pid) || pid < 0) throw new Error('Invalid projectId')
  const lim = Math.min(Math.max(parseInt(String(limit), 10) || 10, 1), 50)

  const { execFile } = require('child_process')
  // Clean env: pass only essentials so Python doesn't inherit Node-specific
  // variables (NODE_OPTIONS etc.) that have caused odd hangs in this stack.
  const cleanEnv: Record<string, string> = {
    HOME: process.env.HOME || '/home/arthur',
    PATH: '/home/arthur/.local/bin:/usr/local/bin:/usr/bin:/bin',
    LANG: process.env.LANG || 'C.UTF-8',
    LC_ALL: process.env.LC_ALL || 'C.UTF-8',
  }
  return new Promise((resolve, reject) => {
    execFile(
      VENV_PYTHON,
      ['-u', FILE_INDEXER, 'search', '--project-id', String(pid), '--query', query, '--limit', String(lim)],
      { timeout: 60000, maxBuffer: 4 * 1024 * 1024, env: cleanEnv, cwd: DAEMON_ROOT },
      (err: any, stdout: string, stderr: string) => {
        if (err) {
          console.error('[file_search] error:', err.message, 'code=', err.code, 'signal=', err.signal, '\nstderr:', stderr, '\nstdout:', stdout)
          return reject(new Error(`${err.message} code=${err.code} signal=${err.signal} :: ${stderr || stdout || 'no output'}`))
        }
        try {
          resolve(JSON.parse(stdout.trim() || '[]'))
        } catch (e) {
          reject(new Error(`Bad JSON from file_indexer: ${stdout.slice(0, 200)}`))
        }
      },
    )
  })
}

/**
 * Run memory_search.py via Python and return JSON results.
 */
async function runMemorySearch(args: string[]): Promise<any> {
  const { execFile } = require('child_process')
  const { promisify } = require('util')
  const execFileAsync = promisify(execFile)

  // Build a small Python wrapper that imports memory_search and returns JSON
  const [action, ...params] = args

  // SECURITY: All parameters passed via stdin as JSON, never interpolated into code
  const input = JSON.stringify({ action, params })

  const script = `
import sys, json, os
sys.path.insert(0, os.environ["DAEMON_SERVER"])
data = json.loads(sys.stdin.read())
action = data["action"]
params = data["params"]

if action == "search":
    from memory_search import search_memory
    q = str(params[0]) if params else ""
    limit = int(params[1]) if len(params) > 1 else 10
    results = search_memory(q, limit=limit)
    print(json.dumps([r.to_dict() for r in results]))
elif action == "grep":
    from memory_search import grep_memory
    pattern = str(params[0]) if params else ""
    pid = int(params[1]) if len(params) > 1 and params[1] not in ("None","") else None
    results = grep_memory(pattern, project_id=pid)
    print(json.dumps([r.to_dict() for r in results]))
elif action == "context":
    from memory_search import get_project_context
    pid = int(params[0]) if params and params[0] not in ("None","") else 0
    ctx = get_project_context(pid)
    print(json.dumps({"context": ctx}))
else:
    print(json.dumps({"error": "unknown action"}))
`

  const { stdout } = await new Promise<{stdout: string}>((resolve, reject) => {
    const { execFile } = require('child_process')
    const child = execFile(VENV_PYTHON, ['-c', script], {
      timeout: 30000,
      env: { ...process.env, DAEMON_SERVER: join(DAEMON_ROOT, 'server') },
    }, (err: any, stdout: string, stderr: string) => {
      if (err) reject(err)
      else resolve({ stdout })
    })
    child.stdin?.write(input)
    child.stdin?.end()
  })

  return JSON.parse(stdout.trim())
}

/**
 * GET /api/memory?action=search&q=query&limit=10
 * GET /api/memory?action=grep&pattern=text&projectId=N
 * GET /api/memory?action=context&projectId=N
 */
export async function GET(req: NextRequest) {
  const authErr = requireAuth(req)
  if (authErr) return authErr

  const params = req.nextUrl.searchParams
  const action = params.get('action')

  try {
    if (action === 'search') {
      const q = params.get('q') || ''
      const limit = params.get('limit') || '10'
      if (!q) return NextResponse.json({ error: 'Missing q parameter' }, { status: 400 })
      const results = await runMemorySearch(['search', q, limit])
      return NextResponse.json({ results })
    }

    if (action === 'grep') {
      const pattern = params.get('pattern') || ''
      const projectId = params.get('projectId') || 'None'
      if (!pattern) return NextResponse.json({ error: 'Missing pattern parameter' }, { status: 400 })
      const results = await runMemorySearch(['grep', pattern, projectId])
      return NextResponse.json({ results })
    }

    if (action === 'file_search') {
      const projectId = params.get('projectId') || '0'
      const query = params.get('q') || ''
      const limit = parseInt(params.get('limit') || '10', 10)
      if (!query) return NextResponse.json({ error: 'Missing q parameter' }, { status: 400 })
      const results = await runFileSearch(projectId, query, limit)
      return NextResponse.json({ results })
    }

    if (action === 'context') {
      const projectId = params.get('projectId')
      if (!projectId) return NextResponse.json({ error: 'Missing projectId parameter' }, { status: 400 })
      const result = await runMemorySearch(['context', projectId])
      return NextResponse.json(result)
    }

    return NextResponse.json(
      { error: 'Missing or invalid action. Use: search, grep, context, file_search' },
      { status: 400 }
    )
  } catch (err: any) {
    console.error('[memory] Error:', err.message || err)
    return NextResponse.json(
      { error: 'Memory search failed', details: err.message || String(err) },
      { status: 500 }
    )
  }
}
