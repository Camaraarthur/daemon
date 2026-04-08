/**
 * StreamingWriter — pure broadcaster, no relay DB writes.
 *
 * Wraps the SSE `send` callback used by the chat route's streaming functions
 * (streamClaudeCLI, runAgentLoopStreaming, streamOpenAICompatible). Every
 * event is:
 *   1. Forwarded to the SSE client (browser)
 *   2. Broadcast via WS push to subscribed clients (other tabs/devices)
 *   3. Gossipped to the user's daemon devices (their local SQLite)
 *
 * The relay process holds NO chat content. The device's local SQLite is
 * the source of truth. Mid-stream refreshes read from the device via the
 * /api/threads/[id]/messages endpoint which fetches over the WS hub.
 *
 * Lifecycle:
 *
 *   const w = new StreamingWriter({...})
 *   //   → broadcast message.created + gossip empty placeholder
 *
 *   // pass w.handleEvent as `onEvent` to the streaming function
 *   await runAgentLoopStreaming({..., onEvent: w.handleEvent})
 *
 *   w.finalize({content, model, toolCalls})
 *   //   → broadcast message.completed + gossip final state
 *
 * On error, call w.finalizeError(message) instead.
 */

import { randomUUID } from 'crypto'
import { broadcastThreadEvent, gossipChatMessage } from './ws-broadcast'
import type { SSEEvent } from './streaming'

// Minimal local shape — we no longer fetch from the DB.
interface LocalMessage {
  id: string
  thread_id: string
  role: string
  model: string | null
  source_session_id: string | null
  created_at: string
}

export interface StreamingWriterOpts {
  threadId: string
  role: 'assistant' | 'user' | 'system'
  model?: string
  sourceSessionId?: string | null
  /** The SSE send callback that pushes events to the connected browser. */
  sseSend: (event: SSEEvent) => void
  /** User id — used to gossip the message to the user's daemon devices. */
  userId?: number
  /** Project id — included in gossip so devices can populate chat_threads. */
  projectId?: number | null
}

interface InternalToolCall {
  id?: string
  tool: string
  args: Record<string, unknown>
  result?: string
}

const FLUSH_INTERVAL_MS = 120

function nowSqliteTimestamp(): string {
  return new Date().toISOString().replace('T', ' ').slice(0, 19)
}

export class StreamingWriter {
  private message: LocalMessage
  private contentBuffer = ''
  private toolCalls: InternalToolCall[] = []
  private toolCallById = new Map<string, InternalToolCall>()
  private flushTimer: ReturnType<typeof setTimeout> | null = null
  private dirty = false
  private finalized = false

  constructor(private opts: StreamingWriterOpts) {
    // Generate a fresh UUID for this message — same shape as the relay's
    // old createStreamingMessage but without writing anything to disk.
    // The device's local SQLite gets the row via the gossip event below.
    this.message = {
      id: randomUUID(),
      thread_id: opts.threadId,
      role: opts.role,
      model: opts.model || null,
      source_session_id: opts.sourceSessionId || null,
      created_at: nowSqliteTimestamp(),
    }

    // Push message.created so any subscribed clients render the bubble
    // immediately, even before the first token arrives.
    broadcastThreadEvent(opts.threadId, {
      type: 'message.created',
      message_id: this.message.id,
      thread_id: opts.threadId,
      role: this.message.role,
      content: '',
      tool_calls: [],
      model: this.message.model,
      created_at: this.message.created_at,
      source_session_id: this.message.source_session_id || null,
      complete: false,
    })
    // Also gossip the placeholder to the user's daemon devices so the
    // empty (complete=0) row exists locally before content streams in.
    if (opts.userId) {
      gossipChatMessage(opts.userId, {
        id: this.message.id,
        thread_id: opts.threadId,
        role: this.message.role,
        content: '',
        model: this.message.model || null,
        created_at: this.message.created_at,
        source_session_id: this.message.source_session_id || null,
        complete: false,
        project_id: opts.projectId || null,
      })
    }
  }

  /** SSE event handler — pass this as the `onEvent` callback. */
  handleEvent = (event: SSEEvent): void => {
    // Forward to the connected SSE client first (synchronous fanout).
    this.opts.sseSend(event)

    if (event.type === 'text') {
      const text = event.data?.text || ''
      if (text) {
        this.contentBuffer += text
        this.dirty = true
        this.scheduleFlush()
      }
    } else if (event.type === 'tool_call') {
      const tc: InternalToolCall = {
        id: event.data?.id,
        tool: event.data?.name || 'unknown',
        args: event.data?.args || {},
      }
      this.toolCalls.push(tc)
      if (tc.id) this.toolCallById.set(tc.id, tc)
      this.dirty = true
      this.scheduleFlush()
    } else if (event.type === 'tool_result') {
      const tc = event.data?.id ? this.toolCallById.get(event.data.id) : undefined
      if (tc) tc.result = event.data?.output || ''
      this.dirty = true
      this.scheduleFlush()
    }
    // 'thinking', 'done', 'error' aren't persisted — `finalize` / `finalizeError`
    // handle the terminal state.
  }

  private scheduleFlush(): void {
    if (this.flushTimer || this.finalized) return
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null
      this.flushNow()
    }, FLUSH_INTERVAL_MS)
  }

  private flushNow(): void {
    if (!this.dirty || this.finalized) return
    this.dirty = false
    const tcJson = this.toolCalls.length ? JSON.stringify(this.toolCalls) : null
    try {
      // No relay-DB write — gossip is the persistence path.
      broadcastThreadEvent(this.opts.threadId, {
        type: 'message.updated',
        message_id: this.message.id,
        thread_id: this.opts.threadId,
        content: this.contentBuffer,
        tool_calls: this.toolCalls,
        complete: false,
      })
      // Incremental gossip: push the in-flight state to the user's
      // daemon devices so a refresh-during-stream can reload from the
      // device with the partial content. Same upsert path as the
      // final message — the device's chat_messages.complete=0 row
      // grows over time.
      if (this.opts.userId) {
        gossipChatMessage(this.opts.userId, {
          id: this.message.id,
          thread_id: this.opts.threadId,
          role: this.message.role,
          content: this.contentBuffer,
          tool_calls: tcJson,
          model: this.message.model || null,
          created_at: this.message.created_at,
          source_session_id: this.message.source_session_id || null,
          complete: false,
          project_id: this.opts.projectId || null,
        })
      }
    } catch (e) {
      console.warn('[streaming-writer] flush failed:', e)
    }
  }

  /**
   * Finalize the message — UPDATE complete=1 and broadcast message.completed.
   * `finalContent` may differ from the accumulated buffer if the streaming
   * function returns a synthesized full response (Claude CLI does this).
   */
  finalize(opts: {
    content?: string
    model?: string
    toolCalls?: any[]
  } = {}): string {
    if (this.finalized) return this.message.id
    this.finalized = true
    if (this.flushTimer) { clearTimeout(this.flushTimer); this.flushTimer = null }

    const content = opts.content ?? this.contentBuffer
    const toolCalls = opts.toolCalls ?? this.toolCalls
    const tcJson = toolCalls.length ? JSON.stringify(toolCalls) : null
    const model = opts.model ?? this.message.model ?? undefined

    try {
      // No relay-DB write — gossip is the persistence path.
      broadcastThreadEvent(this.opts.threadId, {
        type: 'message.completed',
        message_id: this.message.id,
        thread_id: this.opts.threadId,
        content,
        tool_calls: toolCalls as any[],
        model: model || null,
        complete: true,
      })
      // Gossip the final message to all of the user's daemon devices so
      // their local SQLite mirrors the conversation. Fire-and-forget.
      if (this.opts.userId) {
        gossipChatMessage(this.opts.userId, {
          id: this.message.id,
          thread_id: this.opts.threadId,
          role: this.message.role,
          content,
          tool_calls: tcJson,
          model: model || null,
          created_at: this.message.created_at,
          source_session_id: this.message.source_session_id || null,
          complete: true,
          project_id: this.opts.projectId || null,
        })
      }
    } catch (e) {
      console.warn('[streaming-writer] finalize failed:', e)
    }
    return this.message.id
  }

  /** Mark as complete with an error suffix and broadcast message.error. */
  finalizeError(errMsg: string): string {
    if (this.finalized) return this.message.id
    this.finalized = true
    if (this.flushTimer) { clearTimeout(this.flushTimer); this.flushTimer = null }

    const content = this.contentBuffer
      ? `${this.contentBuffer}\n\n[error] ${errMsg}`
      : `[error] ${errMsg}`
    const tcJson = this.toolCalls.length ? JSON.stringify(this.toolCalls) : null

    try {
      // No relay-DB write — gossip is the persistence path.
      broadcastThreadEvent(this.opts.threadId, {
        type: 'message.error',
        message_id: this.message.id,
        thread_id: this.opts.threadId,
        content,
        tool_calls: this.toolCalls as any[],
        complete: true,
        error: errMsg,
      })
      if (this.opts.userId) {
        gossipChatMessage(this.opts.userId, {
          id: this.message.id,
          thread_id: this.opts.threadId,
          role: this.message.role,
          content,
          tool_calls: tcJson,
          created_at: this.message.created_at,
          source_session_id: this.message.source_session_id || null,
          complete: true,
          project_id: this.opts.projectId || null,
        })
      }
    } catch (e) {
      console.warn('[streaming-writer] finalizeError failed:', e)
    }
    return this.message.id
  }

  get id(): string { return this.message.id }
}
