/**
 * Agent-callable tools for the secrets vault + platform broker.
 *
 * Wired into the agent loop the same way memory-tools.ts is. The agent
 * sees `get_secret`, `set_secret`, `list_secrets`, `delete_secret`,
 * `secret_exists` and calls them like any other tool. Routing happens
 * in agent-loop.ts via SECRETS_TOOL_NAMES.
 */

import {
  getSecret as deviceGetSecret,
  setSecret as deviceSetSecret,
  deleteSecret as deviceDeleteSecret,
  listSecrets as deviceListSecrets,
  secretExists as deviceSecretExists,
} from './device-secrets'

export interface SecretsToolDef {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

export const SECRETS_TOOLS: SecretsToolDef[] = [
  {
    type: 'function',
    function: {
      name: 'get_secret',
      description:
        'Retrieve a secret value (API key, token, password) by name. Checks the user\'s encrypted device vault first, then falls through to daemon\'s platform secrets (free shared API keys like Brave Search). Returns the value as a string. NEVER print the value back to the user, NEVER log it, NEVER write it into files. Use it inline (e.g. as a header on an HTTP request) and forget it.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'The secret name. See list_secrets to discover what is available.' },
        },
        required: ['name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'set_secret',
      description:
        'Store a secret in the user\'s encrypted device vault. Idempotent — same name overwrites in place. The value is encrypted at rest with AES-256-GCM using a master key the user owns. Use this when the user pastes an API key or asks you to remember a credential.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Secret name (e.g. "openai_api_key")' },
          value: { type: 'string', description: 'The secret value to encrypt and store' },
          category: { type: 'string', description: 'Optional: api_key, token, password, env' },
          description: {
            type: 'string',
            description: 'Optional human-readable note (NEVER include the secret value)',
          },
        },
        required: ['name', 'value'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_secrets',
      description:
        'List every secret the user has access to (device vault + platform broker). Returns NAMES + categories + descriptions, NEVER the values. Use this to discover what secrets are available before calling get_secret.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_secret',
      description: 'Permanently delete a secret from the user\'s device vault. Cannot delete platform broker secrets.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string' },
        },
        required: ['name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'secret_exists',
      description: 'Check whether a secret with the given name is available (in device vault or platform broker), without retrieving its value.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string' },
        },
        required: ['name'],
      },
    },
  },
]

export const SECRETS_TOOL_NAMES = new Set(SECRETS_TOOLS.map((t) => t.function.name))

/**
 * Idempotent secret reads (get + list + exists) can be parallelized
 * within an agent turn. set/delete must be serial.
 */
export const IDEMPOTENT_SECRETS_TOOLS = new Set([
  'get_secret',
  'list_secrets',
  'secret_exists',
])

/**
 * Execute a secrets tool call. Returns a JSON-stringifiable string the
 * agent loop appends to the message history. Errors are caught and
 * returned as strings so the model sees them.
 *
 * CRITICAL: the value returned by get_secret IS the actual secret. The
 * caller (agent loop) appends it to the LLM message history so the
 * model can use it in the next turn (e.g. to construct an Authorization
 * header). The relay process holds it in memory only — never persists,
 * never logs, never broadcasts to other clients.
 */
export async function executeSecretsTool(
  toolName: string,
  args: Record<string, unknown>,
  ctx: { userId: number },
): Promise<string> {
  if (!ctx.userId) return 'Error: secrets tools require a user context.'
  try {
    switch (toolName) {
      case 'get_secret': {
        const r = await deviceGetSecret({
          userId: ctx.userId,
          name: String(args.name || ''),
        })
        if (!r.ok) return JSON.stringify({ ok: false, error: r.error || 'not found' })
        return JSON.stringify({ ok: true, value: r.value, source: r.source })
      }

      case 'set_secret': {
        const r = await deviceSetSecret({
          userId: ctx.userId,
          name: String(args.name || ''),
          value: String(args.value || ''),
          category: typeof args.category === 'string' ? args.category : undefined,
          description: typeof args.description === 'string' ? args.description : undefined,
        })
        if (!r.ok) return `Error: ${r.error || 'set_secret failed'}`
        return JSON.stringify({ ok: true })
      }

      case 'list_secrets': {
        const r = await deviceListSecrets({ userId: ctx.userId })
        if (!r.ok) return `Error: ${r.error || 'list_secrets failed'}`
        return JSON.stringify({
          ok: true,
          count: r.secrets.length,
          secrets: r.secrets.map((s) => ({
            name: s.name,
            source: s.source,
            category: s.category,
            description: s.description,
            available: s.available,
          })),
        })
      }

      case 'delete_secret': {
        const r = await deviceDeleteSecret({
          userId: ctx.userId,
          name: String(args.name || ''),
        })
        if (!r.ok) return `Error: ${r.error || 'delete_secret failed'}`
        return JSON.stringify({ ok: true })
      }

      case 'secret_exists': {
        const exists = await deviceSecretExists({
          userId: ctx.userId,
          name: String(args.name || ''),
        })
        return JSON.stringify({ ok: true, exists })
      }

      default:
        return `Error: unknown secrets tool: ${toolName}`
    }
  } catch (e) {
    return `Error in ${toolName}: ${e instanceof Error ? e.message : String(e)}`
  }
}
