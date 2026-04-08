/**
 * Letta-style memory tools exposed to the agent loop.
 *
 * These run in the relay process (same place as the chat DB today). When
 * Step 7+ moves the chat DB to the device, these tools move with it. The
 * function shape stays the same so the agent loop doesn't need to change.
 *
 * Tool surface (what the model sees):
 *   - remember(category, content, importance?) → write a fact to archival
 *   - recall(query) → search blocks + facts + recent messages
 *   - update_memory_block(label, content) → replace a core block
 *   - append_memory_block(label, addition) → append to a core block
 *   - list_facts(category?) → browse facts
 *   - get_memory_block(label) → read one core block
 */

import {
  deviceRemember,
  deviceRecall,
  deviceListFacts,
  deviceGetBlock,
  deviceListBlocks,
  deviceUpdateBlock,
  deviceAppendBlock,
} from './device-memory'

export interface MemoryToolDef {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

export const MEMORY_TOOLS: MemoryToolDef[] = [
  {
    type: 'function',
    function: {
      name: 'remember',
      description:
        'Write a durable fact to the project\'s archival memory. Use when something is worth remembering long-term but doesn\'t need to be in every prompt. Examples: "decision: switched from Postgres to SQLite", "gotcha: PrivateTmp=true masks /tmp from systemd services", "person: Luca is the BD ground truth".',
      parameters: {
        type: 'object',
        properties: {
          category: {
            type: 'string',
            description: 'Fact category. Common: decision, gotcha, fact, todo, person, api, file, reference, preference.',
          },
          content: { type: 'string', description: 'The fact text. Be concise but specific.' },
          importance: { type: 'number', description: '1-10. Default 5. Higher importance facts surface first in recall.' },
          source: { type: 'string', description: 'Where this came from (optional). e.g. "chat", "commit:abc123", "file:foo.ts".' },
        },
        required: ['category', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'recall',
      description:
        'Search the project\'s memory (core blocks + archival facts + recent messages) for anything matching a query. Returns ranked hits. Use when the user asks "what did we decide about X" or "remind me about Y" or you need to check if something has been recorded already.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Free-text query. Multiple words are scored by overlap.' },
          limit: { type: 'number', description: 'Max results. Default 20.' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_memory_block',
      description:
        'Replace the entire content of a core memory block. Core blocks are always loaded into the system prompt every turn — use this to update durable working state. Standard labels: project, recent, open_threads, gotchas, preferences. Errors if the new content exceeds the block\'s max_chars.',
      parameters: {
        type: 'object',
        properties: {
          label: { type: 'string', description: 'Block label, e.g. "recent" or "open_threads".' },
          content: { type: 'string', description: 'Full replacement content for the block.' },
          max_chars: { type: 'number', description: 'Optional new max_chars limit. Default 4000.' },
        },
        required: ['label', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'append_memory_block',
      description:
        'Append text to a core memory block. Auto-trims from the front if it would overflow max_chars. Useful for journaling into "recent" without overwriting the whole block.',
      parameters: {
        type: 'object',
        properties: {
          label: { type: 'string', description: 'Block label.' },
          addition: { type: 'string', description: 'Text to append. A newline is added between existing and new content.' },
        },
        required: ['label', 'addition'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_facts',
      description: 'Browse the project\'s archival facts, optionally filtered by category. Returns the most important facts first.',
      parameters: {
        type: 'object',
        properties: {
          category: { type: 'string', description: 'Optional category filter.' },
          limit: { type: 'number', description: 'Max results. Default 50.' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_memory_block',
      description: 'Read a single core memory block by label. Returns its content and metadata.',
      parameters: {
        type: 'object',
        properties: {
          label: { type: 'string', description: 'Block label.' },
        },
        required: ['label'],
      },
    },
  },
]

/**
 * Execute a memory tool call. Routes the call to the user's daemon
 * device's local SQLite via WS — same store the MCP memory server
 * reads/writes. Single source of truth, no drift between the daemon
 * web UI and Claude Code terminal.
 *
 * All errors are caught and returned as a string so the model sees
 * them and can react.
 */
export async function executeMemoryTool(
  toolName: string,
  args: Record<string, unknown>,
  ctx: { projectId: number; userId: number },
): Promise<string> {
  if (!ctx.projectId) {
    return 'Error: memory tools require a project context. The user must be in a project conversation.'
  }
  if (!ctx.userId) {
    return 'Error: memory tools require a user context.'
  }
  try {
    switch (toolName) {
      case 'remember': {
        const r = await deviceRemember({
          userId: ctx.userId,
          projectId: ctx.projectId,
          category: String(args.category || ''),
          content: String(args.content || ''),
          importance: typeof args.importance === 'number' ? args.importance : undefined,
          source: typeof args.source === 'string' ? args.source : undefined,
        })
        if (!r.ok) return `Error: ${r.error || 'remember failed'}`
        return JSON.stringify({ ok: true, fact_id: r.fact_id })
      }
      case 'recall': {
        const r = await deviceRecall({
          userId: ctx.userId,
          projectId: ctx.projectId,
          query: String(args.query || ''),
          limit: typeof args.limit === 'number' ? args.limit : 20,
        })
        if (!r.ok) return `Error: ${r.error || 'recall failed'}`
        return JSON.stringify({
          ok: true,
          count: r.count,
          hits: (r.hits || []).map((h) => ({
            source: h.source,
            label_or_category: h.label_or_category,
            score: Math.round(h.score * 100) / 100,
            content: h.content.length > 400 ? h.content.slice(0, 400) + '…' : h.content,
          })),
        })
      }
      case 'update_memory_block': {
        const r = await deviceUpdateBlock({
          userId: ctx.userId,
          projectId: ctx.projectId,
          label: String(args.label || ''),
          content: String(args.content || ''),
          maxChars: typeof args.max_chars === 'number' ? args.max_chars : undefined,
        })
        if (!r.ok) return `Error: ${r.error || 'update_memory_block failed'}`
        return JSON.stringify({ ok: true })
      }
      case 'append_memory_block': {
        const r = await deviceAppendBlock({
          userId: ctx.userId,
          projectId: ctx.projectId,
          label: String(args.label || ''),
          addition: String(args.addition || ''),
        })
        if (!r.ok) return `Error: ${r.error || 'append_memory_block failed'}`
        return JSON.stringify({ ok: true, total_chars: r.total_chars })
      }
      case 'list_facts': {
        const r = await deviceListFacts({
          userId: ctx.userId,
          projectId: ctx.projectId,
          category: typeof args.category === 'string' ? args.category : undefined,
          limit: typeof args.limit === 'number' ? args.limit : 50,
        })
        if (!r.ok) return `Error: ${r.error || 'list_facts failed'}`
        return JSON.stringify({
          ok: true,
          total: r.total,
          by_category: r.by_category,
          facts: (r.facts || []).map((f) => ({
            id: f.id,
            category: f.category,
            content: f.content,
            importance: f.importance,
            created_at: f.created_at,
          })),
        })
      }
      case 'get_memory_block': {
        const r = await deviceGetBlock({
          userId: ctx.userId,
          projectId: ctx.projectId,
          label: String(args.label || ''),
        })
        if (!r.ok || !r.block) return JSON.stringify({ ok: false, error: r.error || 'block not found' })
        return JSON.stringify({
          ok: true,
          label: r.block.label,
          content: r.block.content,
          max_chars: r.block.max_chars,
          chars: r.block.content.length,
          updated_at: r.block.updated_at,
        })
      }
      default:
        return `Error: unknown memory tool: ${toolName}`
    }
  } catch (e: unknown) {
    return `Error in ${toolName}: ${e instanceof Error ? e.message : String(e)}`
  }
}

/** Names of the memory tools, for routing in the agent loop. */
export const MEMORY_TOOL_NAMES = new Set(MEMORY_TOOLS.map(t => t.function.name))

/** Memory tools that don't mutate state — safe to parallelize. */
export const IDEMPOTENT_MEMORY_TOOLS = new Set([
  'recall',
  'list_facts',
  'get_memory_block',
])
