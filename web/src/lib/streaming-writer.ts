/**
 * StreamingWriter — production-grade streaming-into-DB.
 *
 * Wraps the SSE `send` callback used by the chat route's streaming functions
 * (streamClaudeCLI, runAgentLoopStreaming, streamOpenAICompatible). Every
 * event is forwarded to the SSE client AND persisted to chat_messages so:
 *
 *   - Refreshing the page mid-stream restores the partial response from DB
 *   - Other tabs/devices subscribed to the thread see updates live via WS
 *   - A server crash mid-stream leaves a complete=0 row that the next ws-server
 *     startup reaps with an "[interrupted]" suffix
 *
 * Lifecycle:
 *
 *   const w = new StreamingWriter({...})
 *   //   → INSERT chat_messages (complete=0), broadcast message.created
 *
 *   // pass w.handleEvent as `onEvent` to the streaming function
 *   await runAgentLoopStreaming({..., onEvent: w.handleEvent})
 *
 *   w.finalize({content, model, toolCalls})
 *   //   → UPDATE chat_messages SET complete=1, content=..., broadcast message.completed
 *
 * On error, call w.finalizeError(message) instead.
 */

import {
  createStreamingMessage,
  updateMessageContent,
  markMessageComplete,
  type ChatMessage,
} from './db'
import { broadcastThreadEvent, gossipChatMessage } from './ws-broadcast'
import type { SSEEvent } from './streaming'

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

export class StreamingWriter {
  private message: ChatMessage
  private contentBuffer = ''
  private toolCalls: InternalToolCall[] = []
  private toolCallById = new Map<string, InternalToolCall>()
  private flushTimer: ReturnType<typeof setTimeout> | null = null
  private dirty = false
  private finalized = false

  constructor(private opts: StreamingWriterOpts) {
    // Create the placeholder row immediately so the client (or another tab)
    // can already see "an assistant message exists, complete=0" via the
    // initial /messages fetch.
    this.message = createStreamingMessage({
      thread_id: opts.threadId,
      role: opts.role,
      model: opts.model,
      source_session_id: opts.sourceSessionId || undefined,
    })

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
      updateMessageContent(this.message.id, this.contentBuffer, tcJson)
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
      markMessageComplete(this.message.id, {
        content,
        tool_calls: tcJson,
        model,
      })
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
      markMessageComplete(this.message.id, { content, tool_calls: tcJson })
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
