import { NextRequest } from 'next/server'
import { getUserId } from '@/lib/auth'

// Per-user in-memory pub/sub.
// The daemon / agent tools push events scoped to a userId; canvas SSE clients
// only receive events for their own userId. Unauthenticated callers get an
// empty (heartbeat-only) stream so the public /canvas page doesn't 401 on
// first paint.
//
// Event types emitted here: sensor, camera, text, html, card, clear, idle.
// (sensor/camera retained for pre-existing tools — do not break.)

type Listener = (data: string) => void

// userId → Set<Listener>
const listenersByUser: Map<number, Set<Listener>> = new Map()
// userId → last event JSON (for immediate replay on subscribe)
const lastEventByUser: Map<number, string> = new Map()

const IDLE_EVENT = JSON.stringify({ type: 'idle' })

export function pushEvent(userId: number, data: any) {
  const json = JSON.stringify(data)
  lastEventByUser.set(userId, json)
  const set = listenersByUser.get(userId)
  if (!set) return
  for (const fn of set) {
    try { fn(json) } catch { /* listener disconnected — cleanup in GET */ }
  }
}

// Expose globally so other modules (agent tools) can push without importing
// this route file (which would pull Next server types into non-route code).
;(globalThis as any).__daemonStreamPush = pushEvent

export async function GET(req: NextRequest) {
  // Resolve userId from session cookie. If there is no valid session, we still
  // open an SSE stream (so the /canvas iframe works before login) but it will
  // only receive heartbeats until/unless the user authenticates.
  const userId = await getUserId(req).catch(() => null)

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    start(controller) {
      let closed = false
      const safeEnqueue = (chunk: Uint8Array) => {
        if (closed) return
        try { controller.enqueue(chunk) } catch { closed = true }
      }

      let listener: Listener | null = null

      if (userId != null) {
        // Send last known state for this user immediately
        const last = lastEventByUser.get(userId) ?? IDLE_EVENT
        safeEnqueue(encoder.encode(`data: ${last}\n\n`))

        listener = (data: string) => {
          safeEnqueue(encoder.encode(`data: ${data}\n\n`))
        }
        let set = listenersByUser.get(userId)
        if (!set) {
          set = new Set()
          listenersByUser.set(userId, set)
        }
        set.add(listener)
      } else {
        // Anonymous — just idle + heartbeats, no partitioned events.
        safeEnqueue(encoder.encode(`data: ${IDLE_EVENT}\n\n`))
      }

      // Heartbeat every 15s
      const heartbeat = setInterval(() => {
        safeEnqueue(encoder.encode(`: heartbeat\n\n`))
      }, 15000)

      // Cleanup on close
      req.signal.addEventListener('abort', () => {
        closed = true
        clearInterval(heartbeat)
        if (listener != null && userId != null) {
          const set = listenersByUser.get(userId)
          if (set) {
            set.delete(listener)
            if (set.size === 0) listenersByUser.delete(userId)
          }
        }
        try { controller.close() } catch {}
      })
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'X-Accel-Buffering': 'no',
    },
  })
}
