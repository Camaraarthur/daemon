/**
 * Web Push notifications (vision §3.4).
 *
 * Thin wrapper around the `web-push` library. The relay holds the VAPID
 * private key (in env, never in code) and signs each push request. The
 * browser holds the VAPID public key and uses it when subscribing.
 *
 * Why on the relay (not the device):
 *   Notifications need to be deliverable while the user's daemon device
 *   is asleep. Push subscriptions are not user CONTENT — they are
 *   delivery addresses, like a phone number. The agent never sees them.
 *   The relay holds the address book and dials.
 *
 * Lifecycle of a notification:
 *   1. Agent calls notify({title, body, url}) tool
 *   2. notify-tools.ts → sendNotificationToUser(userId, payload)
 *   3. We look up every push_subscriptions row for that user
 *   4. For each, sign + POST to the push endpoint (FCM, Mozilla, etc.)
 *   5. The browser's service worker (web/public/sw.js) catches the push
 *      event and shows a system notification with a click-through URL.
 */

import webpush from 'web-push'
import {
  listPushSubscriptions,
  recordPushSent,
  deletePushSubscription,
  type PushSubscription as DBPushSubscription,
} from './db'

let _initialized = false

function init() {
  if (_initialized) return
  const publicKey = process.env.VAPID_PUBLIC_KEY
  const privateKey = process.env.VAPID_PRIVATE_KEY
  const subject = process.env.VAPID_SUBJECT || 'mailto:hello@daemon.page'
  if (!publicKey || !privateKey) {
    throw new Error(
      'VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY env vars are required for web push',
    )
  }
  webpush.setVapidDetails(subject, publicKey, privateKey)
  _initialized = true
}

export function getVapidPublicKey(): string {
  const k = process.env.VAPID_PUBLIC_KEY
  if (!k) throw new Error('VAPID_PUBLIC_KEY not set')
  return k
}

export interface NotificationPayload {
  title: string
  body: string
  url?: string
  /** SVG/PNG icon URL — defaults to /favicon.ico */
  icon?: string
  /** Used to deduplicate consecutive notifications client-side. */
  tag?: string
}

// Architecture critic finding M-5: per-user rate limit. The agent
// can otherwise call notify() in a loop and push the user into
// oblivion. 10 notifications per 60s window, sliding.
const RATE_LIMIT_MAX = 10
const RATE_LIMIT_WINDOW_MS = 60_000
const _notifyRate = new Map<number, number[]>()

function checkRateLimit(userId: number): { ok: boolean; retryAfterMs?: number } {
  const now = Date.now()
  const windowStart = now - RATE_LIMIT_WINDOW_MS
  const events = (_notifyRate.get(userId) || []).filter((t) => t > windowStart)
  if (events.length >= RATE_LIMIT_MAX) {
    const oldest = events[0]
    return { ok: false, retryAfterMs: RATE_LIMIT_WINDOW_MS - (now - oldest) }
  }
  events.push(now)
  _notifyRate.set(userId, events)
  return { ok: true }
}

/**
 * Send a payload to all of a user's web push subscriptions. Failed
 * subscriptions (404 / 410 / 403 / 400-expired) are removed from the
 * DB so we don't retry them. Per-user rate limit applied. Returns
 * counts plus optional rate-limit metadata.
 */
export async function sendNotificationToUser(
  userId: number,
  payload: NotificationPayload,
): Promise<{ sent: number; failed: number; removed: number; rateLimited?: boolean; retryAfterMs?: number }> {
  init()
  const rl = checkRateLimit(userId)
  if (!rl.ok) {
    console.warn(`[web-push] user ${userId} rate-limited (${RATE_LIMIT_MAX}/${RATE_LIMIT_WINDOW_MS / 1000}s)`)
    return { sent: 0, failed: 0, removed: 0, rateLimited: true, retryAfterMs: rl.retryAfterMs }
  }
  const subs = listPushSubscriptions(userId)
  if (subs.length === 0) {
    return { sent: 0, failed: 0, removed: 0 }
  }

  const body = JSON.stringify({
    title: payload.title.slice(0, 200),
    body: payload.body.slice(0, 1000),
    url: payload.url || '/',
    icon: payload.icon || '/favicon.ico',
    tag: payload.tag,
  })

  let sent = 0
  let failed = 0
  let removed = 0

  await Promise.all(
    subs.map(async (sub: DBPushSubscription) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          },
          body,
          { TTL: 60 * 60 * 24 }, // 24h
        )
        sent++
        recordPushSent(sub.endpoint, null)
      } catch (e: unknown) {
        failed++
        const status = (e as { statusCode?: number })?.statusCode
        const message = e instanceof Error ? e.message : String(e)
        // M-4: also clean up on 403 (FCM unregistered) and on 400
        // when the body indicates the subscription is dead. The
        // previous code only handled 404 / 410.
        const isDead =
          status === 404 ||
          status === 410 ||
          status === 403 ||
          (status === 400 && /expired|notregistered|invalid/i.test(message))
        if (isDead) {
          deletePushSubscription(sub.endpoint)
          removed++
        } else {
          recordPushSent(sub.endpoint, message.slice(0, 200))
          console.warn(
            `[web-push] send failed for endpoint ${sub.endpoint.slice(0, 40)}…: ${status || '?'} ${message}`,
          )
        }
      }
    }),
  )

  return { sent, failed, removed }
}
