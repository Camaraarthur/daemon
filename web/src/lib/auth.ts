import { NextRequest, NextResponse } from 'next/server'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { join } from 'path'

const execFileAsync = promisify(execFile)
const DAEMON_ROOT = join(process.cwd(), '..')
const VENV_PYTHON = join(DAEMON_ROOT, '.venv', 'bin', 'python3')

export function requireAuth(req: NextRequest): NextResponse | null {
  const token = req.cookies.get('daemon_token')?.value
  if (!token) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }
  return null // proceed
}

/**
 * Get the user ID from the daemon_token cookie via the Python users module.
 */
export async function getUserId(req: NextRequest): Promise<number | null> {
  const token = req.cookies.get('daemon_token')?.value
  if (!token) return null
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
