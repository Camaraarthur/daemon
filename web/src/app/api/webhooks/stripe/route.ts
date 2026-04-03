/**
 * POST /api/webhooks/stripe — handle Stripe webhook events.
 *
 * Events handled:
 *   - checkout.session.completed    → activate subscription
 *   - customer.subscription.updated → update period/status
 *   - customer.subscription.deleted → cancel subscription
 *   - invoice.payment_succeeded     → extend subscription period
 *   - invoice.payment_failed        → mark subscription past_due
 */

import { NextRequest, NextResponse } from 'next/server'
import { getStripe } from '@/lib/billing'
import * as db from '@/lib/db'

export async function POST(req: NextRequest) {
  const stripe = getStripe()
  const body = await req.text()
  const sig = req.headers.get('stripe-signature')

  if (!sig) {
    return NextResponse.json({ error: 'No signature' }, { status: 400 })
  }

  let event
  try {
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET
    if (!webhookSecret) throw new Error('STRIPE_WEBHOOK_SECRET not set')
    event = stripe.webhooks.constructEvent(body, sig, webhookSecret)
  } catch (err: any) {
    console.error('[stripe webhook] Signature verification failed:', err?.message)
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as any
        const userId = parseInt(session.metadata?.daemon_user_id)
        if (!userId) break

        const subscriptionId = session.subscription
        const customerId = session.customer

        db.upsertSubscription(userId, {
          plan: 'pro',
          status: 'active',
          stripe_customer_id: customerId,
          stripe_subscription_id: subscriptionId,
          payment_method: 'stripe',
        })

        // Fetch subscription to get period dates
        if (subscriptionId) {
          const sub = await stripe.subscriptions.retrieve(subscriptionId) as any
          if (sub.current_period_start && sub.current_period_end) {
            db.upsertSubscription(userId, {
              current_period_start: new Date(sub.current_period_start * 1000).toISOString(),
              current_period_end: new Date(sub.current_period_end * 1000).toISOString(),
            })
          }
        }

        console.log(`[stripe] User ${userId} subscribed to Pro via Stripe`)
        break
      }

      case 'customer.subscription.updated': {
        const sub = event.data.object as any
        const customerId = sub.customer

        // Find user by Stripe customer ID
        const subscription = findSubscriptionByStripeCustomer(customerId)
        if (!subscription) break

        const updateData: Partial<db.Subscription> = {
          status: sub.status === 'active' ? 'active' : sub.status === 'past_due' ? 'past_due' : 'inactive',
        }
        if (sub.current_period_start) {
          updateData.current_period_start = new Date(sub.current_period_start * 1000).toISOString()
        }
        if (sub.current_period_end) {
          updateData.current_period_end = new Date(sub.current_period_end * 1000).toISOString()
        }
        db.upsertSubscription(subscription.user_id, updateData)
        break
      }

      case 'customer.subscription.deleted': {
        const sub = event.data.object as any
        const customerId = sub.customer

        const subscription = findSubscriptionByStripeCustomer(customerId)
        if (!subscription) break

        db.upsertSubscription(subscription.user_id, {
          plan: 'free',
          status: 'cancelled',
          stripe_subscription_id: null as any,
        })

        console.log(`[stripe] User ${subscription.user_id} subscription cancelled`)
        break
      }

      case 'invoice.payment_succeeded': {
        const invoice = event.data.object as any
        const customerId = invoice.customer

        const subscription = findSubscriptionByStripeCustomer(customerId)
        if (!subscription) break

        db.upsertSubscription(subscription.user_id, {
          status: 'active',
        })
        break
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object as any
        const customerId = invoice.customer

        const subscription = findSubscriptionByStripeCustomer(customerId)
        if (!subscription) break

        db.upsertSubscription(subscription.user_id, {
          status: 'past_due',
        })

        console.log(`[stripe] Payment failed for user ${subscription.user_id}`)
        break
      }
    }
  } catch (err: any) {
    console.error('[stripe webhook] Error processing event:', err?.message)
    // Still return 200 to acknowledge receipt
  }

  return NextResponse.json({ received: true })
}

function findSubscriptionByStripeCustomer(customerId: string): db.Subscription | undefined {
  const dbInstance = (db as any).default()
  const row = dbInstance.prepare(
    'SELECT * FROM subscriptions WHERE stripe_customer_id = ?'
  ).get(customerId)
  return row as db.Subscription | undefined
}
