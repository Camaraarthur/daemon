/* daemon service worker — web push handler (vision §3.4)
 *
 * The relay POSTs notification payloads to the user's push endpoint
 * (FCM, Mozilla, etc.). The browser delivers each push to this worker
 * which renders a system notification with a click-through URL.
 *
 * Deliberately minimal — no offline cache, no app-shell. Service
 * workers cause more bugs than they prevent when they own routing,
 * so this one ONLY handles push.
 */

self.addEventListener('install', (event) => {
  // Activate immediately so the user doesn't need to refresh after
  // first registration.
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('push', (event) => {
  if (!event.data) return
  let payload
  try {
    payload = event.data.json()
  } catch {
    payload = { title: 'daemon', body: event.data.text() }
  }
  const title = payload.title || 'daemon'
  const options = {
    body: payload.body || '',
    icon: payload.icon || '/favicon.png',
    badge: payload.icon || '/favicon.png',
    tag: payload.tag,
    data: { url: payload.url || '/' },
    // Renotify on the same tag (otherwise consecutive pushes are silent).
    renotify: !!payload.tag,
  }
  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = (event.notification.data && event.notification.data.url) || '/'
  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      // If a daemon tab is already open, focus it and navigate.
      for (const client of all) {
        if ('focus' in client) {
          await client.focus()
          if ('navigate' in client) {
            try { await client.navigate(url) } catch {}
          }
          return
        }
      }
      // Otherwise open a new tab.
      if (self.clients.openWindow) {
        await self.clients.openWindow(url)
      }
    })(),
  )
})
