import { NextRequest } from 'next/server'

// In-memory stream state — the daemon writes to this, SSE clients read from it
// This is a simple pub/sub in the server process
const listeners: Set<(data: string) => void> = new Set()
let lastEvent: string = JSON.stringify({ type: 'idle' })

export function pushEvent(data: any) {
  const json = JSON.stringify(data)
  lastEvent = json
  listeners.forEach(fn => fn(json))
}

// Make pushEvent available globally for other API routes to call
;(globalThis as any).__daemonStreamPush = pushEvent

export async function GET(req: NextRequest) {
  // No auth required for the canvas — it's embedded in the public page
  // But it only shows what the daemon explicitly pushes (no sensitive data)

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    start(controller) {
      // Send last known state immediately
      controller.enqueue(encoder.encode(`data: ${lastEvent}\n\n`))

      const listener = (data: string) => {
        try {
          controller.enqueue(encoder.encode(`data: ${data}\n\n`))
        } catch {
          listeners.delete(listener)
        }
      }
      listeners.add(listener)

      // Heartbeat every 15s
      const heartbeat = setInterval(() => {
        try { controller.enqueue(encoder.encode(': heartbeat\n\n')) }
        catch { clearInterval(heartbeat) }
      }, 15000)

      // Cleanup on close
      req.signal.addEventListener('abort', () => {
        listeners.delete(listener)
        clearInterval(heartbeat)
      })
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    },
  })
}
