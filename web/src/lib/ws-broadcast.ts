/**
 * Bridge from Next.js routes to the WebSocket server's internal /broadcast
 * endpoint. The WS server runs in a separate process (ws-server.js on :4801),
 * so we push thread events to it via HTTP and it fans them out to subscribed
 * browser clients.
 *
 * Fire-and-forget: the chat route never awaits a broadcast — a slow WS server
 * must not stall the SSE stream.
 */

const WS_URL = process.env.WS_SERVER_URL || 'http://localhost:4801'
const SECRET = process.env.WS_BROADCAST_SECRET || 'dev-broadcast-secret'

export interface ThreadEvent {
  type: 'message.created' | 'message.updated' | 'message.completed' | 'message.error'
  message_id: string
  thread_id: string
  // Partial message fields — present where relevant.
  role?: string
  content?: string | null
  tool_calls?: any[]
  model?: string | null
  created_at?: string
  source_session_id?: string | null
  complete?: boolean
  error?: string
}

export function broadcastThreadEvent(threadId: string, event: ThreadEvent): void {
  // No await — must not block the streaming loop.
  fetch(`${WS_URL}/broadcast`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Broadcast-Secret': SECRET,
    },
    body: JSON.stringify({ thread_id: threadId, event }),
  }).catch((e) => {
    // Don't log on every event — could be very noisy. Only log first failure.
    if (!_warnedOnce) {
      _warnedOnce = true
      console.warn('[ws-broadcast] failed (will not warn again):', e?.message || e)
    }
  })
}

let _warnedOnce = false
