import { NextRequest, NextResponse } from 'next/server'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { join } from 'path'

const execFileAsync = promisify(execFile)
const DAEMON_ROOT = join(process.cwd(), '..')
const VENV_PYTHON = join(DAEMON_ROOT, '.venv', 'bin', 'python3')

export async function GET(req: NextRequest) {
  const token = req.cookies.get('daemon_token')?.value
  if (!token) {
    return NextResponse.json({ error: 'Not logged in' }, { status: 401 })
  }

  try {
    const { stdout } = await execFileAsync(VENV_PYTHON, ['-c', `
import sys, os, json; sys.path.insert(0, os.environ["DAEMON_SERVER"])
from users import get_user_by_token
u = get_user_by_token(os.environ["AUTH_TOKEN"])
print(json.dumps({"id": u["id"], "email": u["email"], "daemon_name": u["daemon_name"]} if u else {"error": "Invalid token"}))
`], { timeout: 5000, env: { ...process.env, PYTHONPATH: join(DAEMON_ROOT, 'server'), DAEMON_SERVER: join(DAEMON_ROOT, 'server'), AUTH_TOKEN: token } })

    const user = JSON.parse(stdout.trim())
    if (user.error) {
      return NextResponse.json(user, { status: 401 })
    }
    return NextResponse.json(user)
  } catch {
    return NextResponse.json({ error: 'Auth failed' }, { status: 500 })
  }
}
