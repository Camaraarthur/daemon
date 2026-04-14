import { NextRequest, NextResponse } from 'next/server'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { join } from 'path'
import { validateDeviceToken } from '@/lib/db'
import getDb from '@/lib/db'
import { randomBytes } from 'crypto'

const execFileAsync = promisify(execFile)
const DAEMON_ROOT = join(process.cwd(), '..')
const VENV_PYTHON = join(DAEMON_ROOT, '.venv', 'bin', 'python3')

async function pyUsers(code: string, extraEnv: Record<string, string> = {}): Promise<any> {
  const { stdout } = await execFileAsync(VENV_PYTHON, ['-c', `
import sys, os, json; sys.path.insert(0, os.environ["DAEMON_SERVER"])
from users import *
${code}
`], { timeout: 10000, env: { ...process.env, PYTHONPATH: join(DAEMON_ROOT, 'server'), DAEMON_SERVER: join(DAEMON_ROOT, 'server'), ...extraEnv } })
  return JSON.parse(stdout.trim())
}

// POST /api/auth — signup or login
export async function POST(req: NextRequest) {
  const { action, email, password, daemon_name, credential, google_email } = await req.json()

  if (action === 'signup') {
    if (!email || !password || !daemon_name) {
      return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
    }
    if (!/^[a-z0-9_-]+$/.test(daemon_name) || daemon_name.length < 2 || daemon_name.length > 20) {
      return NextResponse.json({ error: 'Daemon name must be 2-20 chars, lowercase, letters/numbers/dash only' }, { status: 400 })
    }
    // Reserved names
    if (['my', 'www', 'api', 'app', 'admin', 'daemon', 'test'].includes(daemon_name)) {
      return NextResponse.json({ error: 'That name is reserved' }, { status: 400 })
    }
    const result = await pyUsers(`
r = create_user(os.environ["USER_EMAIL"], os.environ["USER_PASSWORD"], os.environ["DAEMON_NAME"])
print(json.dumps(r))
`, { USER_EMAIL: email, USER_PASSWORD: password, DAEMON_NAME: daemon_name })
    if (!result.ok) return NextResponse.json(result, { status: 400 })
    // Auto-login after signup
    const login_result = await pyUsers(`
r = login(os.environ["USER_EMAIL"], os.environ["USER_PASSWORD"])
print(json.dumps(r if r else {"error": "Login failed"}))
`, { USER_EMAIL: email, USER_PASSWORD: password })
    const response = NextResponse.json(login_result)
    if (login_result.token) {
      response.cookies.set('daemon_token', login_result.token, {
        httpOnly: true, secure: true, sameSite: 'lax', maxAge: 30 * 24 * 3600,
        domain: '.daemon.page', path: '/',
      })
    }
    return response
  }

  if (action === 'login') {
    if (!email || !password) {
      return NextResponse.json({ error: 'Missing email or password' }, { status: 400 })
    }
    const result = await pyUsers(`
r = login(os.environ["USER_EMAIL"], os.environ["USER_PASSWORD"])
print(json.dumps(r if r else {"error": "Wrong email or password"}))
`, { USER_EMAIL: email, USER_PASSWORD: password })
    if (result.error) return NextResponse.json(result, { status: 401 })
    const response = NextResponse.json(result)
    response.cookies.set('daemon_token', result.token, {
      httpOnly: true, secure: true, sameSite: 'lax', maxAge: 30 * 24 * 3600,
      domain: '.daemon.page', path: '/',
    })
    return response
  }

  if (action === 'check') {
    const dn = daemon_name || ''
    if (!dn) return NextResponse.json({ exists: false })
    const result = await pyUsers(`
r = get_user_by_daemon_name(os.environ["DAEMON_NAME"])
print(json.dumps({"exists": r is not None}))
`, { DAEMON_NAME: dn })
    return NextResponse.json(result)
  }

  if (action === 'google') {
    if (!credential) return NextResponse.json({ error: 'No credential' }, { status: 400 })

    // Verify with Google
    const googleRes = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${credential}`)
    const gData = await googleRes.json()
    if (!gData.email) return NextResponse.json({ error: 'Invalid Google token' }, { status: 401 })

    const userEmail = gData.email as string
    const suggestedName = userEmail.split('@')[0].toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 20)

    // Try login first
    const loginResult = await pyUsers(`
r = login_by_email(os.environ["USER_EMAIL"]) if hasattr(__import__('users', fromlist=['login_by_email']), 'login_by_email') else None
if r is None:
    # Try to find user by email and create session
    import sqlite3
    from users import DB_PATH, get_user_by_daemon_name
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    row = conn.execute("SELECT * FROM users WHERE email = ?", (os.environ["USER_EMAIL"],)).fetchone()
    if row:
        import secrets
        from datetime import datetime, timezone
        token = secrets.token_hex(32)
        conn.execute("INSERT INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)",
                     (token, row["id"], datetime.now(timezone.utc).isoformat()))
        conn.commit()
        r = {"token": token, "daemon_name": row["daemon_name"], "email": row["email"]}
    else:
        r = None
    conn.close()
print(json.dumps(r if r else {"needs_signup": True, "email": os.environ["USER_EMAIL"], "suggested_name": os.environ["SUGGESTED_NAME"]}))
`, { USER_EMAIL: userEmail, SUGGESTED_NAME: suggestedName })

    if (loginResult.needs_signup) {
      return NextResponse.json(loginResult)
    }
    const response = NextResponse.json(loginResult)
    if (loginResult.token) {
      response.cookies.set('daemon_token', loginResult.token, {
        httpOnly: true, secure: true, sameSite: 'lax', maxAge: 30 * 24 * 3600,
        domain: '.daemon.page', path: '/',
      })
    }
    return response
  }

  if (action === 'google_signup') {
    const dn = daemon_name
    if (!google_email || !dn) return NextResponse.json({ error: 'Missing fields' }, { status: 400 })

    // Create user with random password (Google-only auth)
    const result = await pyUsers(`
import secrets
r = create_user(os.environ["USER_EMAIL"], secrets.token_hex(32), os.environ["DAEMON_NAME"])
print(json.dumps(r))
`, { USER_EMAIL: google_email, DAEMON_NAME: dn })
    if (!result.ok) return NextResponse.json(result, { status: 400 })

    // Auto-login
    const loginResult = await pyUsers(`
import sqlite3, secrets
from datetime import datetime, timezone
from users import DB_PATH
conn = sqlite3.connect(DB_PATH)
conn.row_factory = sqlite3.Row
row = conn.execute("SELECT * FROM users WHERE email = ?", (os.environ["USER_EMAIL"],)).fetchone()
token = secrets.token_hex(32)
conn.execute("INSERT INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)",
             (token, row["id"], datetime.now(timezone.utc).isoformat()))
conn.commit()
conn.close()
print(json.dumps({"token": token, "daemon_name": row["daemon_name"], "email": row["email"]}))
`, { USER_EMAIL: google_email })

    const response = NextResponse.json(loginResult)
    if (loginResult.token) {
      response.cookies.set('daemon_token', loginResult.token, {
        httpOnly: true, secure: true, sameSite: 'lax', maxAge: 30 * 24 * 3600,
        domain: '.daemon.page', path: '/',
      })
    }
    return response
  }

  // Exchange a device_token for a session cookie. Native apps (Tauri
  // desktop, iOS, Android) already paired with the relay have a
  // device_token in ~/.daemon/config.json — they call this at startup
  // to get an authenticated session without any Google/password login.
  // Native auth should NEVER require OAuth in an embedded webview
  // (Google blocks it) or a password the user never set.
  if (action === 'device_token_exchange') {
    const { device_token } = await req.json().catch(() => ({ device_token: null }))
    // Pull device_token from body OR Authorization header (Bearer)
    const authHeader = req.headers.get('authorization') || ''
    const bearer = authHeader.match(/^Bearer\s+(.+)$/i)?.[1]
    const token = device_token || bearer
    if (!token) {
      return NextResponse.json({ error: 'device_token required' }, { status: 400 })
    }
    const tokenInfo = validateDeviceToken(token)
    if (!tokenInfo) {
      return NextResponse.json({ error: 'invalid device_token' }, { status: 401 })
    }
    // Look up user metadata via the relay's own DB (no Python subprocess)
    const user = getDb()
      .prepare('SELECT id, email, daemon_name FROM users WHERE id = ?')
      .get(tokenInfo.userId) as { id: number; email: string; daemon_name: string } | undefined
    if (!user) {
      return NextResponse.json({ error: 'user not found' }, { status: 404 })
    }
    // Mint a session token (same shape as sessions produced by login)
    const sessionToken = randomBytes(32).toString('hex')
    const now = new Date().toISOString()
    getDb()
      .prepare('INSERT INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)')
      .run(sessionToken, user.id, now)
    const response = NextResponse.json({
      ok: true,
      token: sessionToken,
      daemon_name: user.daemon_name,
      email: user.email,
    })
    response.cookies.set('daemon_token', sessionToken, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      maxAge: 30 * 24 * 3600,
      domain: '.daemon.page',
      path: '/',
    })
    return response
  }

  return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
}
