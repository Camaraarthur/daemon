/**
 * SSE Streaming utilities for Daemon chat.
 *
 * Event types:
 *   thinking    — agent reasoning / status
 *   tool_call   — a tool is being invoked (name + args)
 *   tool_result — output from a tool call
 *   text        — assistant response text (may arrive in chunks)
 *   done        — stream finished, final metadata
 *   error       — something went wrong
 */

export interface SSEEvent {
  type: 'thinking' | 'tool_call' | 'tool_result' | 'text' | 'done' | 'error'
  data: Record<string, any>
}

/**
 * Creates an SSE Response with a writable controller.
 * Returns { response, send, close } — call send() to push events, close() to end the stream.
 */
export function createSSEStream() {
  const encoder = new TextEncoder()
  let controllerRef: ReadableStreamDefaultController<Uint8Array> | null = null

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controllerRef = controller
    },
    cancel() {
      controllerRef = null
    },
  })

  const response = new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })

  function send(event: SSEEvent) {
    if (!controllerRef) return
    try {
      const line = `data: ${JSON.stringify(event)}\n\n`
      controllerRef.enqueue(encoder.encode(line))
    } catch {
      // Stream may be closed by client
    }
  }

  function close() {
    if (!controllerRef) return
    try {
      controllerRef.close()
    } catch {
      // Already closed
    }
    controllerRef = null
  }

  return { response, send, close }
}

/**
 * Parse a line from Claude CLI streaming JSON output.
 * Claude --output-format stream-json emits one JSON object per line.
 *
 * IMPORTANT: a single JSON line can carry MULTIPLE blocks (text + tool_use,
 * or several tool_use blocks at once). We always return an array so the
 * caller can fan them out to the SSE stream — early-returning the first
 * block was the source of "tool calls show up but bash output never does".
 *
 * Also handles Claude CLI's tool result format, which is wrapped in a
 * `user` message:
 *   { type: "user", message: { content: [{ type: "tool_result",
 *       tool_use_id, content }] } }
 */
export function parseClaudeStreamLine(line: string): SSEEvent[] {
  if (!line.trim()) return []
  let obj: any
  try { obj = JSON.parse(line) } catch { return [] }

  const events: SSEEvent[] = []

  // ── Assistant message: text and tool_use blocks ────────────
  if (obj.type === 'assistant' && obj.message?.content && Array.isArray(obj.message.content)) {
    for (const block of obj.message.content) {
      if (block?.type === 'text' && block.text) {
        events.push({ type: 'text', data: { text: block.text } })
      } else if (block?.type === 'tool_use') {
        events.push({
          type: 'tool_call',
          data: { id: block.id, name: block.name, args: block.input || {} },
        })
      } else if (block?.type === 'thinking' && (block.thinking || block.text)) {
        events.push({ type: 'thinking', data: { text: block.thinking || block.text } })
      }
    }
    return events
  }

  // ── User message: tool_result blocks (Claude CLI format) ───
  if (obj.type === 'user' && obj.message?.content && Array.isArray(obj.message.content)) {
    for (const block of obj.message.content) {
      if (block?.type === 'tool_result') {
        // content can be a string or an array of {type:"text",text} blocks
        let output = ''
        if (typeof block.content === 'string') {
          output = block.content
        } else if (Array.isArray(block.content)) {
          output = block.content
            .map((c: any) => (typeof c === 'string' ? c : c?.text || ''))
            .filter(Boolean)
            .join('\n')
        } else if (block.content != null) {
          output = JSON.stringify(block.content)
        }
        events.push({
          type: 'tool_result',
          data: { id: block.tool_use_id, output, is_error: !!block.is_error },
        })
      }
    }
    return events
  }

  // ── Final result line ──────────────────────────────────────
  if (obj.type === 'result') {
    events.push({
      type: 'done',
      data: {
        response: obj.result,
        sessionId: obj.session_id,
        model: Object.keys(obj.model_usage || obj.modelUsage || {})[0] || 'claude-opus',
      },
    })
    return events
  }

  // ── Legacy / fallback shapes ───────────────────────────────
  if (obj.type === 'assistant' && obj.subtype === 'text') {
    events.push({ type: 'text', data: { text: obj.text } })
    return events
  }
  if (obj.type === 'tool_use') {
    events.push({
      type: 'tool_call',
      data: { id: obj.tool_use_id || obj.id, name: obj.name, args: obj.input || {} },
    })
    return events
  }
  if (obj.type === 'tool_result') {
    events.push({
      type: 'tool_result',
      data: {
        id: obj.tool_use_id,
        output: typeof obj.content === 'string' ? obj.content : JSON.stringify(obj.content),
      },
    })
    return events
  }
  if (obj.type === 'content_block_delta' || obj.type === 'content_block_start') {
    const text = obj.delta?.text || obj.content_block?.text || ''
    if (text) events.push({ type: 'text', data: { text } })
    return events
  }

  return events
}
