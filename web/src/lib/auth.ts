import { NextRequest, NextResponse } from 'next/server'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { join } from 'path'
import { sanitizeToken } from './sanitize'

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
 * Validate a session token against the database.
 * Checks: token format (alphanumeric hex), exists in DB, not expired.
 * Returns the user object { id, email, daemon_name, ... } or null if invalid.
 */
export async function validateSession(token: string): Promise<{ id: number; email: string; daemon_name: string } | null> {
  // Format check: must be 64-char hex string
  const clean = sanitizeToken(token)
  if (!clean) return null

  try {
    const { stdout } = await execFileAsync(VENV_PYTHON, ['-c', `
import sys,json,os; sys.path.insert(0,os.environ["DAEMON_SERVER"])
from users import get_user_by_token
u=get_user_by_token(os.environ["AUTH_TOKEN"])
if u:
    print(json.dumps({"id": u["id"], "email": u["email"], "daemon_name": u["daemon_name"]}))
else:
    print(json.dumps(None))
`], { timeout: 3000, env: { ...process.env, DAEMON_SERVER: join(DAEMON_ROOT, 'server'), AUTH_TOKEN: clean } })
    const result = JSON.parse(stdout.trim())
    return result
  } catch {
    return null
  }
}

/**
 * Get the user ID from the daemon_token cookie.
 * Uses validateSession for proper token format + DB + expiry checks.
 */
export async function getUserId(req: NextRequest): Promise<number | null> {
  const token = req.cookies.get('daemon_token')?.value
  if (!token) return null
  const user = await validateSession(token)
  return user?.id ?? null
}
