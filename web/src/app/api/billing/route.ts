/**
 * POST /api/billing — create checkout sessions, manage billing.
 *
 * Actions:
 *   { action: 'stripe_checkout' }     — create Stripe Checkout session for $15/mo sub
 *   { action: 'stripe_portal' }       — create Stripe Billing Portal session
 *   { action: 'coinbase_checkout' }   — create Coinbase Commerce charge for USDC payment
 */

import { NextRequest, NextResponse } from 'next/server'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { join } from 'path'
import * as db from '@/lib/db'
import {
  createSubscriptionCheckout,
  createBillingPortal,
  createCoinbaseCharge,
} from '@/lib/billing'

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

export async function POST(req: NextRequest) {
  const token = req.cookies.get('daemon_token')?.value
  if (!token) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  try {
    const user = await getUser(token)
    if (user.error) return NextResponse.json(user, { status: 401 })

    const { action } = await req.json()
    const origin = req.headers.get('origin') || 'https://my.daemon.page'
    const subscription = db.getSubscription(user.id)

    switch (action) {
      case 'stripe_checkout': {
        const url = await createSubscriptionCheckout({
          userId: user.id,
          email: user.email,
          successUrl: `${origin}/settings?billing=success`,
          cancelUrl: `${origin}/settings?billing=cancel`,
          stripeCustomerId: subscription?.stripe_customer_id || undefined,
        })

        // Store customer ID if this is a new customer
        // (actual subscription activation happens via webhook)
        return NextResponse.json({ url })
      }

      case 'stripe_portal': {
        if (!subscription?.stripe_customer_id) {
          return NextResponse.json({ error: 'No active Stripe subscription' }, { status: 400 })
        }
        const url = await createBillingPortal(
          subscription.stripe_customer_id,
          `${origin}/settings`,
        )
        return NextResponse.json({ url })
      }

      case 'coinbase_checkout': {
        const { chargeId, hostedUrl } = await createCoinbaseCharge({
          userId: user.id,
          email: user.email,
          amount: 15.00,
          description: 'Daemon Pro — 1 month subscription ($15)',
          redirectUrl: `${origin}/settings?billing=success`,
          cancelUrl: `${origin}/settings?billing=cancel`,
        })

        // Store the charge ID for webhook matching
        db.upsertSubscription(user.id, {
          coinbase_charge_id: chargeId,
          payment_method: 'coinbase',
        })

        return NextResponse.json({ url: hostedUrl, chargeId })
      }

      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 })
    }
  } catch (err: any) {
    console.error('[billing api]', err?.message || err)
    return NextResponse.json(
      { error: err?.message || 'Billing operation failed' },
      { status: 500 },
    )
  }
}
