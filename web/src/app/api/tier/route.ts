import { NextRequest, NextResponse } from 'next/server'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { join } from 'path'
import { PROVIDERS, type ModelTier } from '@/lib/model-router'

const execFileAsync = promisify(execFile)
const DAEMON_ROOT = join(process.cwd(), '..')
const VENV_PYTHON = join(DAEMON_ROOT, '.venv', 'bin', 'python3')

/** GET /api/tier — returns current user's tier + available tiers */
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
if u:
    settings = json.loads(u.get("settings","{}") or "{}")
    tier = "premium" if u["email"] == "tutucamara@gmail.com" else settings.get("model_tier", "free")
    print(json.dumps({"tier": tier, "email": u["email"]}))
else:
    print(json.dumps({"error": "Invalid token"}))
`], { timeout: 3000, env: { ...process.env, PYTHONPATH: join(DAEMON_ROOT, 'server'), DAEMON_SERVER: join(DAEMON_ROOT, 'server'), AUTH_TOKEN: token } })

    const result = JSON.parse(stdout.trim())
    if (result.error) return NextResponse.json(result, { status: 401 })

    return NextResponse.json({
      currentTier: result.tier,
      tiers: {
        free: { name: PROVIDERS.free.name, model: PROVIDERS.free.model, cost: 'Free (Alibaba subsidized)' },
        mid: { name: PROVIDERS.mid.name, model: PROVIDERS.mid.model, cost: '$0.28/$0.42 per MTok' },
        premium: { name: 'Claude Opus (Max)', model: 'claude-opus', cost: 'Premium subscription' },
      },
    })
  } catch {
    return NextResponse.json({ error: 'Failed to get tier' }, { status: 500 })
  }
}

/** POST /api/tier — switch user's tier */
export async function POST(req: NextRequest) {
  const token = req.cookies.get('daemon_token')?.value
  if (!token) {
    return NextResponse.json({ error: 'Not logged in' }, { status: 401 })
  }

  const { tier } = await req.json()
  if (!tier || !['free', 'mid', 'premium'].includes(tier)) {
    return NextResponse.json({ error: 'Invalid tier. Choose: free, mid, premium' }, { status: 400 })
  }

  try {
    const { stdout } = await execFileAsync(VENV_PYTHON, ['-c', `
import sys, os, json; sys.path.insert(0, os.environ["DAEMON_SERVER"])
from users import get_user_by_token, get_db
u = get_user_by_token(os.environ["AUTH_TOKEN"])
if u:
    settings = json.loads(u.get("settings","{}") or "{}")
    settings["model_tier"] = os.environ["NEW_TIER"]
    db = get_db()
    db.execute("UPDATE users SET settings = ? WHERE id = ?", (json.dumps(settings), u["id"]))
    db.commit()
    print(json.dumps({"ok": True, "tier": os.environ["NEW_TIER"]}))
else:
    print(json.dumps({"error": "Invalid token"}))
`], { timeout: 3000, env: { ...process.env, PYTHONPATH: join(DAEMON_ROOT, 'server'), DAEMON_SERVER: join(DAEMON_ROOT, 'server'), AUTH_TOKEN: token, NEW_TIER: tier } })

    const result = JSON.parse(stdout.trim())
    if (result.error) return NextResponse.json(result, { status: 401 })
    return NextResponse.json(result)
  } catch {
    return NextResponse.json({ error: 'Failed to update tier' }, { status: 500 })
  }
}
