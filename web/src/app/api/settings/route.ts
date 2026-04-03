import { NextRequest, NextResponse } from 'next/server'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { join } from 'path'

const execFileAsync = promisify(execFile)
const DAEMON_ROOT = join(process.cwd(), '..')
const VENV_PYTHON = join(DAEMON_ROOT, '.venv', 'bin', 'python3')
const DAEMON_SERVER = join(DAEMON_ROOT, 'server')

/** Authenticate and return user from token */
async function getUser(token: string) {
  const { stdout } = await execFileAsync(VENV_PYTHON, ['-c', `
import sys, os, json; sys.path.insert(0, os.environ["DAEMON_SERVER"])
from users import get_user_by_token
u = get_user_by_token(os.environ["AUTH_TOKEN"])
if u:
    print(json.dumps({"id": u["id"], "email": u["email"], "settings": u.get("settings", "{}") or "{}"}))
else:
    print(json.dumps({"error": "Invalid token"}))
`], { timeout: 3000, env: { ...process.env, PYTHONPATH: DAEMON_SERVER, DAEMON_SERVER, AUTH_TOKEN: token } })
  return JSON.parse(stdout.trim())
}

/** Update user settings JSON in DB */
async function updateUserSettings(userId: number, settings: string) {
  await execFileAsync(VENV_PYTHON, ['-c', `
import sys, os, json; sys.path.insert(0, os.environ["DAEMON_SERVER"])
from users import get_db
db = get_db()
db.execute("UPDATE users SET settings = ? WHERE id = ?", (os.environ["SETTINGS_JSON"], int(os.environ["USER_ID"])))
db.commit()
print("ok")
`], { timeout: 3000, env: { ...process.env, PYTHONPATH: DAEMON_SERVER, DAEMON_SERVER, SETTINGS_JSON: settings, USER_ID: String(userId) } })
}

/** Verify an API key by making a lightweight request */
async function verifyApiKey(keyId: string, keyValue: string): Promise<boolean> {
  try {
    switch (keyId) {
      case 'anthropic': {
        const res = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'x-api-key': keyValue,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            model: 'claude-sonnet-4-20250514',
            max_tokens: 1,
            messages: [{ role: 'user', content: 'hi' }],
          }),
        })
        // 200 or 400 (bad request but key valid) both mean key works
        return res.status !== 401 && res.status !== 403
      }
      case 'openrouter': {
        const res = await fetch('https://openrouter.ai/api/v1/auth/key', {
          headers: { 'Authorization': `Bearer ${keyValue}` },
        })
        return res.ok
      }
      case 'deepseek': {
        const res = await fetch('https://api.deepseek.com/v1/models', {
          headers: { 'Authorization': `Bearer ${keyValue}` },
        })
        return res.ok
      }
      case 'google_ai': {
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${keyValue}`)
        return res.ok
      }
      case 'openai': {
        const res = await fetch('https://api.openai.com/v1/models', {
          headers: { 'Authorization': `Bearer ${keyValue}` },
        })
        return res.ok
      }
      default:
        return false
    }
  } catch {
    return false
  }
}

/** GET /api/settings — return user's settings */
export async function GET(req: NextRequest) {
  const token = req.cookies.get('daemon_token')?.value
  if (!token) {
    return NextResponse.json({ error: 'Not logged in' }, { status: 401 })
  }

  try {
    const user = await getUser(token)
    if (user.error) return NextResponse.json(user, { status: 401 })

    const settings = JSON.parse(user.settings || '{}')
    return NextResponse.json({
      model: settings.model || 'qwen3-coder',
      useLocalClaude: settings.useLocalClaude || false,
      plan: settings.plan || 'free',
    })
  } catch {
    return NextResponse.json({ error: 'Failed to load settings' }, { status: 500 })
  }
}

/** PUT /api/settings — update user settings or verify a key */
export async function PUT(req: NextRequest) {
  const token = req.cookies.get('daemon_token')?.value
  if (!token) {
    return NextResponse.json({ error: 'Not logged in' }, { status: 401 })
  }

  try {
    const user = await getUser(token)
    if (user.error) return NextResponse.json(user, { status: 401 })

    const body = await req.json()

    // Key verification request
    if (body.verifyKey && body.keyValue) {
      const valid = await verifyApiKey(body.verifyKey, body.keyValue)
      return NextResponse.json({ valid })
    }

    // Settings update
    const settings = JSON.parse(user.settings || '{}')

    if (body.model !== undefined) {
      settings.model = body.model

      // Map model selection to tier for the existing chat system
      const modelToTier: Record<string, string> = {
        'qwen3-coder': 'free',
        'deepseek-v3': 'mid',
        'claude-sonnet': 'premium',
        'claude-opus': 'premium',
        'gemini-3-flash': 'free',
        'gemini-3-pro': 'mid',
      }
      settings.model_tier = modelToTier[body.model] || 'free'
    }

    if (body.useLocalClaude !== undefined) {
      settings.useLocalClaude = body.useLocalClaude
    }

    await updateUserSettings(user.id, JSON.stringify(settings))

    return NextResponse.json({
      ok: true,
      model: settings.model,
      useLocalClaude: settings.useLocalClaude,
    })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Failed to update settings' }, { status: 500 })
  }
}
