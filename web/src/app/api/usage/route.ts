/**
 * GET /api/usage — returns usage stats and billing info for the current user.
 *
 * Response:
 * {
 *   today: { cost, messages, models },
 *   this_month: { cost, messages },
 *   daily: [{ date, cost, messages }, ...],
 *   subscription: { plan, price, status, next_billing, payment_method },
 *   total_due: number  // subscription + API usage this month
 * }
 */

import { NextRequest, NextResponse } from 'next/server'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { join } from 'path'
import * as db from '@/lib/db'

const execFileAsync = promisify(execFile)
const DAEMON_ROOT = join(process.cwd(), '..')
const VENV_PYTHON = join(DAEMON_ROOT, '.venv', 'bin', 'python3')
const DAEMON_SERVER = join(DAEMON_ROOT, 'server')

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

export async function GET(req: NextRequest) {
  const token = req.cookies.get('daemon_token')?.value
  if (!token) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  try {
    const user = await getUser(token)
    if (user.error) return NextResponse.json(user, { status: 401 })

    const userId = user.id
    const today = db.getUsageToday(userId)
    const thisMonth = db.getUsageThisMonth(userId)
    const daily = db.getUsageDailyBreakdown(userId, 30)
    const subscription = db.getSubscription(userId)

    const plan = subscription?.plan || 'free'
    const subPrice = plan === 'pro' ? 15.00 : 0
    const totalDue = subPrice + thisMonth.cost

    return NextResponse.json({
      today: {
        cost: Math.round(today.cost * 10000) / 10000,
        messages: today.messages,
        models: today.models,
      },
      this_month: {
        cost: Math.round(thisMonth.cost * 10000) / 10000,
        messages: thisMonth.messages,
      },
      daily,
      subscription: {
        plan,
        price: subPrice,
        status: subscription?.status || 'inactive',
        next_billing: subscription?.current_period_end || null,
        payment_method: subscription?.payment_method || 'none',
        stripe_customer_id: subscription?.stripe_customer_id || null,
      },
      total_due: Math.round(totalDue * 100) / 100,
    })
  } catch (err: any) {
    console.error('[usage api]', err?.message || err)
    return NextResponse.json({ error: 'Failed to load usage' }, { status: 500 })
  }
}
