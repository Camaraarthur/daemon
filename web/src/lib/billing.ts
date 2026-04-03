/**
 * Billing utilities — cost calculation, provider detection, Stripe/Coinbase helpers.
 *
 * Pricing philosophy:
 *   - $15/mo flat subscription for platform (hosting, memory, device mesh, daemon.page deploy)
 *   - API usage at cost — transparent pass-through, no markup
 *   - BYOK free tier — use your own keys, 50 free messages/day on our Qwen key
 */

import Stripe from 'stripe'

// ── Cost Tables (per million tokens) ────────────────────────

export const MODEL_COSTS: Record<string, { input: number; output: number; provider: string }> = {
  // Free tier
  'qwen/qwen3-coder:free': { input: 0, output: 0, provider: 'openrouter' },
  'qwen/qwen3-coder': { input: 0.20, output: 0.60, provider: 'openrouter' },
  'qwen3-coder': { input: 0, output: 0, provider: 'openrouter' },

  // DeepSeek
  'deepseek-chat': { input: 0.14, output: 0.28, provider: 'deepseek' },
  'deepseek-v3': { input: 0.14, output: 0.28, provider: 'deepseek' },

  // Gemini
  'gemini-3-flash': { input: 0.075, output: 0.30, provider: 'google' },
  'gemini-3-pro': { input: 1.25, output: 5.00, provider: 'google' },

  // Anthropic
  'claude-sonnet': { input: 3.00, output: 15.00, provider: 'anthropic' },
  'claude-opus': { input: 15.00, output: 75.00, provider: 'anthropic' },
  'claude-opus-4-20250514': { input: 15.00, output: 75.00, provider: 'anthropic' },
  'claude-sonnet-4-20250514': { input: 3.00, output: 15.00, provider: 'anthropic' },
}

/**
 * Calculate cost from token counts and model name.
 * If the API response includes a `cost` field (OpenRouter does this), prefer that.
 */
export function calculateCost(model: string, inputTokens: number, outputTokens: number, apiReportedCost?: number): number {
  // Trust API-reported cost if available (OpenRouter provides this)
  if (apiReportedCost !== undefined && apiReportedCost > 0) {
    return apiReportedCost
  }

  const costs = MODEL_COSTS[model]
  if (!costs) {
    // Unknown model — estimate conservatively at mid-tier pricing
    return ((inputTokens * 0.50) + (outputTokens * 1.50)) / 1_000_000
  }

  return ((inputTokens * costs.input) + (outputTokens * costs.output)) / 1_000_000
}

/**
 * Detect provider from model string
 */
export function detectProvider(model: string): string {
  const costs = MODEL_COSTS[model]
  if (costs) return costs.provider

  if (model.includes('claude')) return 'anthropic'
  if (model.includes('gemini')) return 'google'
  if (model.includes('deepseek')) return 'deepseek'
  if (model.includes('qwen')) return 'openrouter'
  return 'unknown'
}

// ── Stripe ──────────────────────────────────────────────────

let _stripe: Stripe | null = null

export function getStripe(): Stripe {
  if (!_stripe) {
    const key = process.env.STRIPE_SECRET_KEY
    if (!key) throw new Error('STRIPE_SECRET_KEY not set')
    _stripe = new Stripe(key)
  }
  return _stripe
}

const SUBSCRIPTION_PRICE = 1500 // $15.00 in cents

/**
 * Create a Stripe Checkout session for a $15/mo subscription.
 */
export async function createSubscriptionCheckout(params: {
  userId: number
  email: string
  successUrl: string
  cancelUrl: string
  stripeCustomerId?: string
}): Promise<string> {
  const stripe = getStripe()

  // Create or reuse customer
  let customerId = params.stripeCustomerId
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: params.email,
      metadata: { daemon_user_id: String(params.userId) },
    })
    customerId = customer.id
  }

  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: 'subscription',
    payment_method_types: ['card'],
    line_items: [{
      price_data: {
        currency: 'usd',
        product_data: {
          name: 'Daemon Pro',
          description: 'Platform hosting, device mesh, memory, daemon.page deployment',
        },
        unit_amount: SUBSCRIPTION_PRICE,
        recurring: { interval: 'month' },
      },
      quantity: 1,
    }],
    // Also create a metered price for API usage
    // We'll add usage line items via Stripe Billing Meter
    success_url: params.successUrl,
    cancel_url: params.cancelUrl,
    metadata: {
      daemon_user_id: String(params.userId),
    },
  })

  return session.url!
}

/**
 * Create a Stripe Billing Portal session for managing subscription.
 */
export async function createBillingPortal(stripeCustomerId: string, returnUrl: string): Promise<string> {
  const stripe = getStripe()
  const session = await stripe.billingPortal.sessions.create({
    customer: stripeCustomerId,
    return_url: returnUrl,
  })
  return session.url
}

// ── Coinbase Commerce (Onchain) ─────────────────────────────

const COINBASE_API_URL = 'https://api.commerce.coinbase.com'

/**
 * Create a Coinbase Commerce charge for USDC payment.
 * Coinbase Commerce does NOT support recurring subscriptions natively —
 * we create one-time charges and track subscription state ourselves.
 */
export async function createCoinbaseCharge(params: {
  userId: number
  email: string
  amount: number  // USD amount
  description: string
  redirectUrl: string
  cancelUrl: string
}): Promise<{ chargeId: string; hostedUrl: string }> {
  const apiKey = process.env.COINBASE_COMMERCE_API_KEY
  if (!apiKey) throw new Error('COINBASE_COMMERCE_API_KEY not set')

  const res = await fetch(`${COINBASE_API_URL}/charges`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-CC-Api-Key': apiKey,
      'X-CC-Version': '2018-03-22',
    },
    body: JSON.stringify({
      name: 'Daemon Pro Subscription',
      description: params.description,
      pricing_type: 'fixed_price',
      local_price: {
        amount: String(params.amount.toFixed(2)),
        currency: 'USD',
      },
      metadata: {
        daemon_user_id: String(params.userId),
        email: params.email,
      },
      redirect_url: params.redirectUrl,
      cancel_url: params.cancelUrl,
    }),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Coinbase Commerce error (${res.status}): ${err}`)
  }

  const data = await res.json()
  return {
    chargeId: data.data.id,
    hostedUrl: data.data.hosted_url,
  }
}

/**
 * Verify a Coinbase Commerce webhook signature.
 */
export function verifyCoinbaseWebhook(payload: string, signature: string, secret: string): boolean {
  const crypto = require('crypto')
  const hmac = crypto.createHmac('sha256', secret)
  hmac.update(payload)
  const computed = hmac.digest('hex')
  return crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(signature))
}

// ── Free tier limits ────────────────────────────────────────

export const FREE_DAILY_LIMIT = 50 // messages per day on daemon's free key

export function isOverFreeLimit(todayMessages: number): boolean {
  return todayMessages >= FREE_DAILY_LIMIT
}
