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

// ── Device gossip ────────────────────────────────────────
//
// Step 7: when the relay persists a chat message, fan it out to all of
// the user's connected daemon devices so each device's local SQLite
// mirrors the conversation. The relay holds the canonical copy today;
// later steps reverse the direction so the device becomes authoritative
// and the relay holds nothing.

export interface GossipChatMessage {
  id: string
  thread_id: string
  role: string
  content?: string | null
  tool_calls?: string | null
  tool_call_id?: string | null
  model?: string | null
  created_at?: string
  source_session_id?: string | null
  complete?: boolean
  // Optional thread metadata so the device can populate chat_threads
  project_id?: number | null
  thread_title?: string | null
}

/**
 * Push a chat message to every daemon device of a user. Fire-and-forget;
 * never blocks the chat route. The ws-server's /gossip/chat-message
 * endpoint walks the user's connected device map and sends each one a
 * `chat.message_imported` WS message.
 */
export function gossipChatMessage(userId: number, message: GossipChatMessage): void {
  fetch(`${WS_URL}/gossip/chat-message`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Broadcast-Secret': SECRET,
    },
    body: JSON.stringify({ user_id: userId, message }),
  }).catch((e) => {
    if (!_warnedGossipOnce) {
      _warnedGossipOnce = true
      console.warn('[gossip] failed (will not warn again):', e?.message || e)
    }
  })
}

let _warnedGossipOnce = false
