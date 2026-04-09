/**
 * Browser-side helpers for the web push primitive (vision §3.4).
 *
 * Three operations the UI needs:
 *   - registerServiceWorker()    register /sw.js once
 *   - enableNotifications()      ask permission + subscribe + POST
 *   - disableNotifications()     unsubscribe + DELETE
 *   - isNotificationsEnabled()   current state for the toggle UI
 *
 * Designed to be called from any client component. The relay's
 * /api/notifications/* endpoints handle persistence + auth.
 */

function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const buf = new ArrayBuffer(raw.length)
  const out = new Uint8Array(buf)
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

function bufferToBase64(buf: ArrayBuffer | null): string {
  if (!buf) return ''
  const bytes = new Uint8Array(buf)
  let s = ''
  for (let i = 0; i < bytes.byteLength; i++) s += String.fromCharCode(bytes[i])
  return btoa(s)
}

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof window === 'undefined') return null
  if (!('serviceWorker' in navigator)) return null
  try {
    return await navigator.serviceWorker.register('/sw.js')
  } catch (e) {
    console.warn('[notifications] sw register failed:', e)
    return null
  }
}

export async function isNotificationsEnabled(): Promise<boolean> {
  if (typeof window === 'undefined') return false
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return false
  if (Notification.permission !== 'granted') return false
  const reg = await navigator.serviceWorker.getRegistration()
  if (!reg) return false
  const sub = await reg.pushManager.getSubscription()
  return !!sub
}

export async function enableNotifications(): Promise<{ ok: boolean; error?: string }> {
  if (typeof window === 'undefined') return { ok: false, error: 'not in browser' }
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    return { ok: false, error: 'browser does not support web push' }
  }
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') {
    return { ok: false, error: `permission ${permission}` }
  }
  const reg = (await navigator.serviceWorker.getRegistration()) || (await registerServiceWorker())
  if (!reg) return { ok: false, error: 'service worker registration failed' }

  // Fetch the VAPID public key
  const vapidRes = await fetch('/api/notifications/vapid-key')
  if (!vapidRes.ok) return { ok: false, error: 'vapid key fetch failed' }
  const { publicKey } = (await vapidRes.json()) as { publicKey: string }

  // Reuse existing subscription if it matches; otherwise resubscribe.
  let sub = await reg.pushManager.getSubscription()
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    })
  }

  const body = {
    endpoint: sub.endpoint,
    keys: {
      p256dh: bufferToBase64(sub.getKey('p256dh')),
      auth: bufferToBase64(sub.getKey('auth')),
    },
    userAgent: navigator.userAgent,
    platform: navigator.platform,
  }
  const res = await fetch('/api/notifications/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    return { ok: false, error: `subscribe failed: ${res.status} ${text.slice(0, 100)}` }
  }
  return { ok: true }
}

export async function disableNotifications(): Promise<{ ok: boolean; error?: string }> {
  if (typeof window === 'undefined') return { ok: false }
  const reg = await navigator.serviceWorker.getRegistration()
  if (!reg) return { ok: true }
  const sub = await reg.pushManager.getSubscription()
  if (!sub) return { ok: true }
  const endpoint = sub.endpoint
  await sub.unsubscribe()
  await fetch('/api/notifications/subscribe', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ endpoint }),
  })
  return { ok: true }
}

export async function sendTestNotification(): Promise<{ ok: boolean; sent?: number; error?: string }> {
  const res = await fetch('/api/notifications/test', { method: 'POST' })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) return { ok: false, error: data?.error || `${res.status}` }
  return { ok: true, sent: data?.sent }
}
