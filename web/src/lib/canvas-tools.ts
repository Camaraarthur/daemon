/**
 * Canvas tools — let the agent publish content (text / html / card) to the
 * user's per-user live canvas at /canvas.
 *
 * These tools don't run in the sandbox. They just push events through the
 * in-process pub/sub backing /api/stream. The canvas page (EventSource) is
 * already scoped to the caller's userId, so fanout is per-user.
 *
 * Tool shape follows the same OpenAI-compatible `AGENT_TOOLS` pattern used
 * in agent-loop.ts — a definition array plus a dispatcher `executeCanvasTool`.
 */

type PushFn = (userId: number, data: any) => void

function getPush(): PushFn | null {
  const fn = (globalThis as any).__daemonStreamPush
  return typeof fn === 'function' ? (fn as PushFn) : null
}

export const CANVAS_TOOLS = [
  {
    type: 'function' as const,
    function: {
      name: 'canvas_text',
      description:
        'Display a plain text message on the user\'s live canvas (/canvas). Use this to surface short status lines, answers, or notifications.',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'Text to display.' },
          durationMs: {
            type: 'number',
            description: 'Optional: auto-clear after this many milliseconds.',
          },
        },
        required: ['text'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'canvas_html',
      description:
        'Render a snippet of HTML on the user\'s live canvas. The HTML is rendered inside a sandboxed container; links open in a new tab with noopener. Do not include <script> tags — they will be stripped by the renderer.',
      parameters: {
        type: 'object',
        properties: {
          html: { type: 'string', description: 'HTML snippet to render.' },
          durationMs: { type: 'number', description: 'Optional auto-clear delay (ms).' },
        },
        required: ['html'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'canvas_card',
      description:
        'Render a structured card (title + body + optional image) on the canvas. Useful for search results, summaries, or quick-look info.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Card title.' },
          body: { type: 'string', description: 'Card body text.' },
          image_url: { type: 'string', description: 'Optional image URL.' },
        },
        required: ['title', 'body'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'canvas_clear',
      description: 'Clear the canvas back to idle.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
]

export const CANVAS_TOOL_NAMES = new Set(CANVAS_TOOLS.map(t => t.function.name))

export function isCanvasTool(name: string): boolean {
  return CANVAS_TOOL_NAMES.has(name)
}

/**
 * Execute a canvas_* tool call. userId comes from the agent context (the
 * chat route already resolved it from the session cookie and passes it to
 * the agent loop).
 *
 * Returns a short human-readable string describing the result — this is fed
 * back to the model as the tool's output.
 */
export function executeCanvasTool(
  toolName: string,
  args: Record<string, any>,
  userId: number | string,
): string {
  const uid = typeof userId === 'string' ? parseInt(userId, 10) : userId
  if (!Number.isFinite(uid) || uid <= 0) {
    return 'Error: canvas tools require a valid userId'
  }
  const push = getPush()
  if (!push) {
    return 'Error: canvas stream not initialised (is /api/stream loaded?)'
  }

  switch (toolName) {
    case 'canvas_text': {
      const text = String(args.text ?? '')
      if (!text) return 'Error: canvas_text requires non-empty text'
      push(uid, { type: 'text', data: { text, durationMs: args.durationMs } })
      return `Pushed text to canvas (${text.length} chars)`
    }
    case 'canvas_html': {
      const html = String(args.html ?? '')
      if (!html) return 'Error: canvas_html requires non-empty html'
      push(uid, { type: 'html', data: { html, durationMs: args.durationMs } })
      return `Pushed html to canvas (${html.length} chars)`
    }
    case 'canvas_card': {
      const title = String(args.title ?? '')
      const body = String(args.body ?? '')
      if (!title || !body) return 'Error: canvas_card requires title and body'
      const image_url = args.image_url ? String(args.image_url) : undefined
      push(uid, { type: 'card', data: { title, body, image_url } })
      return `Pushed card to canvas: ${title}`
    }
    case 'canvas_clear': {
      push(uid, { type: 'clear' })
      return 'Canvas cleared'
    }
    default:
      return `Unknown canvas tool: ${toolName}`
  }
}
