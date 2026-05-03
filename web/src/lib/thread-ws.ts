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
 *
 * SLICE-D: connectionState observable + 15s heartbeat + 3-miss watchdog +
 * exponential backoff reconnect (1s -> 2s -> 4s -> 8s -> ... cap 30s).
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

// SLICE-D: connection-state contract for the chat header badge.
export type ConnectionState = 'connecting' | 'online' | 'reconnecting' | 'offline'
type StateListener = (state: ConnectionState, lastSeenAt: number | null) => void

// SLICE-D: heartbeat tunables. 15s ping, 3 missed = offline.
const HEARTBEAT_INTERVAL_MS = 15_000
const HEARTBEAT_MAX_MISSED = 3

// SLICE-D: backoff schedule. 1s, 2s, 4s, 8s, 16s, then cap at 30s.
const BACKOFF_INITIAL_MS = 1_000
const BACKOFF_MAX_MS = 30_000

class ThreadWebSocketClient {
  private ws: WebSocket | null = null
  private subscribedThread: string | null = null
  private listeners = new Set<Listener>()
  private destroyed = false

  // SLICE-D: connection-state machine.
  private state: ConnectionState = 'connecting'
  private stateListeners = new Set<StateListener>()
  private lastSeenAt: number | null = null

  // SLICE-D: heartbeat bookkeeping.
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null
  private missedHeartbeats = 0

  // SLICE-D: reconnect bookkeeping (replaces old reconnectDelay/maxReconnectDelay).
  private reconnectDelay = BACKOFF_INITIAL_MS
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private hasEverConnected = false

  constructor() {
    if (typeof window !== 'undefined') {
      this.connect()
    }
  }

  private connect(): void {
    if (this.destroyed) return
    // SLICE-D: state goes 'connecting' on the very first attempt; later attempts
    // are 'reconnecting' so the UI distinguishes "haven't tried yet" from
    // "was connected, lost it, retrying".
    this.setState(this.hasEverConnected ? 'reconnecting' : 'connecting')
    try {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      const url = `${protocol}//${window.location.host}/ws/client`
      this.ws = new WebSocket(url)

      this.ws.onopen = () => {
        // eslint-disable-next-line no-console
        console.log('[thread-ws] connected')
        this.hasEverConnected = true
        this.reconnectDelay = BACKOFF_INITIAL_MS
        this.missedHeartbeats = 0
        this.lastSeenAt = Date.now()
        this.setState('online')
        // Re-subscribe to whatever we were on before disconnect
        if (this.subscribedThread) {
          this.sendRaw({ type: 'subscribe', thread_id: this.subscribedThread })
        }
        // SLICE-D: kick off heartbeat ticking once the socket is open.
        this.startHeartbeat()
      }

      this.ws.onmessage = (e) => {
        let msg: any
        try { msg = JSON.parse(e.data) } catch { return }
        if (!msg || typeof msg !== 'object') return
        // SLICE-D: any inbound message resets the watchdog. Server replies
        // 'pong' to our 'ping' (see web/ws-server.js L682-683) but real
        // thread events count as liveness too.
        this.missedHeartbeats = 0
        this.lastSeenAt = Date.now()
        if (msg.type === 'thread_event' && msg.event) {
          for (const fn of this.listeners) {
            try { fn(msg.event) } catch (err) { console.warn('[thread-ws] listener error:', err) }
          }
        } else if (msg.type === 'pong') {
          // SLICE-D: explicit pong handling — already counted above as
          // liveness; nothing else to do here.
        } else if (msg.type === 'auth_error') {
          // Cookie expired or unauthenticated — let the page's normal auth flow handle it.
          console.warn('[thread-ws] auth error, will not retry until page reload')
          this.destroyed = true
          this.stopHeartbeat()
          this.setState('offline')
        }
      }

      this.ws.onerror = () => {
        // onclose will fire next; do reconnect there.
      }

      this.ws.onclose = () => {
        this.ws = null
        this.stopHeartbeat()
        if (this.destroyed) return
        // SLICE-D: until reconnect succeeds, we are reconnecting (or offline
        // if the watchdog already promoted us). Don't downgrade offline back
        // to reconnecting prematurely — but if the close was triggered by a
        // heartbeat-miss promotion, state is already 'offline' and stays.
        if (this.state !== 'offline') this.setState('reconnecting')
        const delay = this.reconnectDelay
        this.reconnectDelay = Math.min(this.reconnectDelay * 2, BACKOFF_MAX_MS)
        if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
        this.reconnectTimer = setTimeout(() => {
          this.reconnectTimer = null
          this.connect()
        }, delay)
      }
    } catch (e) {
      console.warn('[thread-ws] connect failed:', e)
      if (this.state !== 'offline') this.setState('reconnecting')
      const delay = this.reconnectDelay
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, BACKOFF_MAX_MS)
      if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null
        this.connect()
      }, delay)
    }
  }

  // SLICE-D: heartbeat lifecycle.
  private startHeartbeat(): void {
    this.stopHeartbeat()
    this.heartbeatInterval = setInterval(() => this.tickHeartbeat(), HEARTBEAT_INTERVAL_MS)
  }

  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval)
      this.heartbeatInterval = null
    }
  }

  private tickHeartbeat(): void {
    if (this.destroyed) return
    if (this.ws?.readyState !== WebSocket.OPEN) return
    // SLICE-D: send a ping; ws-server.js replies with 'pong'. Count as
    // missed until we hear something back; onmessage resets the counter.
    this.missedHeartbeats += 1
    try {
      this.ws.send(JSON.stringify({ type: 'ping', t: Date.now() }))
    } catch {
      // send failed — let the close path handle it.
    }
    if (this.missedHeartbeats >= HEARTBEAT_MAX_MISSED) {
      // SLICE-D: 3 missed in a row -> mark offline and force-close so the
      // reconnect path takes over. lastSeenAt stays at its last good value
      // so the badge can render "last seen Xm ago".
      console.warn('[thread-ws] heartbeat watchdog: 3 missed pings, marking offline')
      this.setState('offline')
      try { this.ws?.close() } catch {}
    }
  }

  private setState(next: ConnectionState): void {
    if (this.state === next) return
    this.state = next
    for (const fn of this.stateListeners) {
      try { fn(next, this.lastSeenAt) } catch (err) { console.warn('[thread-ws] state listener error:', err) }
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

  // SLICE-D: connection-state observable. Returns an unsubscribe function.
  // The listener is invoked immediately with the current state for easy
  // hookup from a useEffect.
  onConnectionState(fn: StateListener): () => void {
    this.stateListeners.add(fn)
    try { fn(this.state, this.lastSeenAt) } catch (err) { console.warn('[thread-ws] state listener error:', err) }
    return () => this.stateListeners.delete(fn)
  }

  // SLICE-D: synchronous accessors for tests and one-shot reads.
  getConnectionState(): ConnectionState { return this.state }
  getLastSeenAt(): number | null { return this.lastSeenAt }
}

let _instance: ThreadWebSocketClient | null = null

export function getThreadWS(): ThreadWebSocketClient {
  if (!_instance) _instance = new ThreadWebSocketClient()
  return _instance
}
