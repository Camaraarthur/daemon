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
 */
export function parseClaudeStreamLine(line: string): SSEEvent | null {
  if (!line.trim()) return null
  try {
    const obj = JSON.parse(line)

    // Claude stream-json events:
    // { type: "assistant", subtype: "text", text: "..." }
    // { type: "tool_use", name: "...", input: {...} }
    // { type: "tool_result", tool_use_id: "...", content: "..." }
    // { type: "result", result: "...", session_id: "..." }

    if (obj.type === 'assistant' && obj.subtype === 'text') {
      return { type: 'text', data: { text: obj.text } }
    }

    if (obj.type === 'tool_use') {
      return {
        type: 'tool_call',
        data: { id: obj.tool_use_id || obj.id, name: obj.name, args: obj.input },
      }
    }

    if (obj.type === 'tool_result') {
      return {
        type: 'tool_result',
        data: {
          id: obj.tool_use_id,
          output: typeof obj.content === 'string' ? obj.content : JSON.stringify(obj.content),
        },
      }
    }

    if (obj.type === 'result') {
      return {
        type: 'done',
        data: {
          response: obj.result,
          sessionId: obj.session_id,
          model: Object.keys(obj.model_usage || obj.modelUsage || {})[0] || 'claude-opus',
        },
      }
    }

    // Content block delta (streaming text)
    if (obj.type === 'content_block_delta' || obj.type === 'content_block_start') {
      const text = obj.delta?.text || obj.content_block?.text || ''
      if (text) return { type: 'text', data: { text } }
    }

    return null
  } catch {
    return null
  }
}
