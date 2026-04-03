/**
 * POST /api/webhooks/coinbase — handle Coinbase Commerce webhook events.
 *
 * Events handled:
 *   - charge:confirmed  → activate/extend subscription
 *   - charge:failed     → log failure
 *
 * Note: Coinbase Commerce does NOT support recurring subscriptions natively.
 * We create one-time charges and manage subscription state ourselves.
 * For renewal, the user pays again each month (or we prompt them).
 */

import { NextRequest, NextResponse } from 'next/server'
import { verifyCoinbaseWebhook } from '@/lib/billing'
import * as db from '@/lib/db'

export async function POST(req: NextRequest) {
  const body = await req.text()
  const signature = req.headers.get('x-cc-webhook-signature')

  if (!signature) {
    return NextResponse.json({ error: 'No signature' }, { status: 400 })
  }

  // Verify webhook signature
  const webhookSecret = process.env.COINBASE_WEBHOOK_SECRET
  if (webhookSecret) {
    const valid = verifyCoinbaseWebhook(body, signature, webhookSecret)
    if (!valid) {
      console.error('[coinbase webhook] Invalid signature')
      return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
    }
  }

  try {
    const event = JSON.parse(body)
    const eventType = event.event?.type
    const chargeData = event.event?.data

    if (!chargeData) {
      return NextResponse.json({ received: true })
    }

    const userId = parseInt(chargeData.metadata?.daemon_user_id)
    if (!userId) {
      console.warn('[coinbase webhook] No daemon_user_id in charge metadata')
      return NextResponse.json({ received: true })
    }

    switch (eventType) {
      case 'charge:confirmed': {
        // Payment confirmed — activate subscription for 1 month
        const now = new Date()
        const periodEnd = new Date(now)
        periodEnd.setMonth(periodEnd.getMonth() + 1)

        db.upsertSubscription(userId, {
          plan: 'pro',
          status: 'active',
          coinbase_charge_id: chargeData.id,
          payment_method: 'coinbase',
          current_period_start: now.toISOString(),
          current_period_end: periodEnd.toISOString(),
        })

        console.log(`[coinbase] User ${userId} subscribed to Pro via USDC payment (charge: ${chargeData.id})`)
        break
      }

      case 'charge:failed': {
        console.log(`[coinbase] Charge failed for user ${userId} (charge: ${chargeData.id})`)
        // Don't change subscription status — the charge just didn't go through
        break
      }

      case 'charge:pending': {
        console.log(`[coinbase] Charge pending for user ${userId} (charge: ${chargeData.id})`)
        break
      }

      default:
        console.log(`[coinbase] Unhandled event type: ${eventType}`)
    }
  } catch (err: any) {
    console.error('[coinbase webhook] Error processing:', err?.message)
  }

  return NextResponse.json({ received: true })
}
