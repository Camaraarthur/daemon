/**
 * Browser-side WebSocket client for live thread updates.
 *
 * Single connection per tab, multiplexed by thread subscription. Reconnects
 * with exponential backoff. Re-subscribes to the active thread on reconnect
 * so a transient network blip doesn't lose live updates.
 *
 * Usage:
 *
 *   const ws = getThreadWS()
 *   const unsub = ws.on(event => store.applyMessageEvent(event))
 *   ws.subscribe(threadId)
 *   // ... later, when switching threads or unmounting:
 *   ws.subscribe(otherThreadId)  // automatically unsubscribes from previous
 *   unsub()
 */

export interface ThreadWsEvent {
  type: 'message.created' | 'message.updated' | 'message.completed' | 'message.error'
  message_id: string
  thread_id: string
  role?: string
  content?: string | null
  tool_calls?: any[]
  model?: string | null
  created_at?: string
  source_session_id?: string | null
  complete?: boolean
  error?: string
}

type Listener = (event: ThreadWsEvent) => void

class ThreadWebSocketClient {
  private ws: WebSocket | null = null
  private subscribedThread: string | null = null
  private listeners = new Set<Listener>()
  private reconnectDelay = 1000
  private maxReconnectDelay = 15_000
  private destroyed = false

  constructor() {
    if (typeof window !== 'undefined') {
      this.connect()
    }
  }

  private connect(): void {
    if (this.destroyed) return
    try {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      const url = `${protocol}//${window.location.host}/ws/client`
      this.ws = new WebSocket(url)

      this.ws.onopen = () => {
        // eslint-disable-next-line no-console
        console.log('[thread-ws] connected')
        this.reconnectDelay = 1000
        // Re-subscribe to whatever we were on before disconnect
        if (this.subscribedThread) {
          this.sendRaw({ type: 'subscribe', thread_id: this.subscribedThread })
        }
      }

      this.ws.onmessage = (e) => {
        let msg: any
        try { msg = JSON.parse(e.data) } catch { return }
        if (!msg || typeof msg !== 'object') return
        if (msg.type === 'thread_event' && msg.event) {
          for (const fn of this.listeners) {
            try { fn(msg.event) } catch (err) { console.warn('[thread-ws] listener error:', err) }
          }
        } else if (msg.type === 'auth_error') {
          // Cookie expired or unauthenticated — let the page's normal auth flow handle it.
          console.warn('[thread-ws] auth error, will not retry until page reload')
          this.destroyed = true
        }
      }

      this.ws.onerror = () => {
        // onclose will fire next; do reconnect there.
      }

      this.ws.onclose = () => {
        this.ws = null
        if (this.destroyed) return
        const delay = this.reconnectDelay
        this.reconnectDelay = Math.min(this.reconnectDelay * 1.5, this.maxReconnectDelay)
        setTimeout(() => this.connect(), delay)
      }
    } catch (e) {
      console.warn('[thread-ws] connect failed:', e)
      setTimeout(() => this.connect(), this.reconnectDelay)
      this.reconnectDelay = Math.min(this.reconnectDelay * 1.5, this.maxReconnectDelay)
    }
  }

  private sendRaw(obj: any): boolean {
    if (this.ws?.readyState === WebSocket.OPEN) {
      try { this.ws.send(JSON.stringify(obj)); return true } catch { return false }
    }
    return false
  }

  /**
   * Subscribe to a thread. Automatically unsubscribes from any previously
   * subscribed thread. Idempotent — calling with the same id is a no-op.
   */
  subscribe(threadId: string): void {
    if (this.subscribedThread === threadId) return
    if (this.subscribedThread) {
      this.sendRaw({ type: 'unsubscribe', thread_id: this.subscribedThread })
    }
    this.subscribedThread = threadId
    this.sendRaw({ type: 'subscribe', thread_id: threadId })
  }

  unsubscribe(): void {
    if (this.subscribedThread) {
      this.sendRaw({ type: 'unsubscribe', thread_id: this.subscribedThread })
      this.subscribedThread = null
    }
  }

  /** Register a listener. Returns an unsubscribe function. */
  on(fn: Listener): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }
}

let _instance: ThreadWebSocketClient | null = null

export function getThreadWS(): ThreadWebSocketClient {
  if (!_instance) _instance = new ThreadWebSocketClient()
  return _instance
}
