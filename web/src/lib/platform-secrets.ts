/**
 * Platform secrets layer (the API broker).
 *
 * Vision §3.2 / §3 Two-layer secrets vault, second layer.
 *
 * Daemon-the-company holds a small set of API keys that all users get
 * access to for free (or under a quota for v2). Examples:
 *   - brave_search_api_key (foundational online search, free for all)
 *   - gemini_embedding_key  (semantic file search, shared quota)
 *   - openai_api_key        (only when the user opts into "use the
 *                            shared key" — costs the platform money,
 *                            heavy quota)
 *
 * The agent's get_secret(name) tool tries the user's device vault first,
 * then falls through to here. The agent never knows the difference.
 *
 * v1 implementation: secrets live in vault.env (the relay's environment),
 * unlimited quota for the wedge audience. v2 adds:
 *   - per-user quota tracking in a platform_secret_usage table
 *   - paid tier with bigger quotas
 *   - explicit opt-in for secrets that cost real money
 *   - usage audit log the user can request via /api/me/platform-usage
 *
 * For v1 we just expose the names + check the env, log every use to
 * stderr (so a human reading logs can see "user 3 used brave_search_api_key").
 */

interface PlatformSecretSpec {
  name: string
  envVar: string
  description: string
  category: 'search' | 'embedding' | 'llm' | 'comms' | 'data' | 'infra' | 'social' | 'payments'
  freeForAll: boolean
  /**
   * Operator-only: only returned when the requester is the operator
   * of this daemon instance (DAEMON_OPERATOR_USER_ID env var, defaults
   * to user_id=3 for arturito). Used for Arthur's personal vault.env
   * keys that he WANTS exposed to his own daemon agent but should NOT
   * leak to other users on the same instance.
   */
  operatorOnly?: boolean
}

const OPERATOR_USER_ID = parseInt(process.env.DAEMON_OPERATOR_USER_ID || '3', 10)

// The catalogue of platform secrets daemon provides. Add to this list
// when daemon-the-company signs up for a new service. The agent's
// system prompt enumerates by `name`, never by `envVar`.
const CATALOGUE: PlatformSecretSpec[] = [
  {
    name: 'brave_search_api_key',
    envVar: 'BRAVE_SEARCH_API_KEY',
    description: 'Brave Search API — web search for grounding agent answers. Free for all daemon users.',
    category: 'search',
    freeForAll: true,
  },
  // ── Operator-only secrets (Arthur's personal vault.env) ──
  // Loaded automatically because daemon-web.service has
  // EnvironmentFile=/home/arthur/.secrets/vault.env. These are
  // available ONLY when the requester is the operator user (his
  // own daemon instance). They never leak to other tenants.
  //
  // Adding a new key Arthur uses: append a row here, restart
  // daemon-web — the vault.env value is already in process.env.
  { name: 'anthropic_api_key', envVar: 'ANTHROPIC_API_KEY',
    description: "Claude API key (insights-main workspace)",
    category: 'llm', freeForAll: false, operatorOnly: true },
  { name: 'openai_api_key', envVar: 'OPENAI_API_KEY',
    description: "OpenAI API key", category: 'llm', freeForAll: false, operatorOnly: true },
  { name: 'deepgram_api_key', envVar: 'DEEPGRAM_API_KEY',
    description: "Deepgram speech-to-text API", category: 'comms', freeForAll: false, operatorOnly: true },
  { name: 'google_api_key', envVar: 'GOOGLE_API_KEY',
    description: "Google API key (CRA AI main project) — Gemini, Embedding 2",
    category: 'llm', freeForAll: false, operatorOnly: true },
  { name: 'gemini_embedding_key', envVar: 'GOOGLE_API_KEY',
    description: "Gemini Embedding 2 (alias of google_api_key for clarity)",
    category: 'embedding', freeForAll: false, operatorOnly: true },
  { name: 'github_pat', envVar: 'GITHUB_PAT',
    description: "GitHub personal access token", category: 'infra', freeForAll: false, operatorOnly: true },
  { name: 'qdrant_api_key', envVar: 'QDRANT_API_KEY',
    description: "Qdrant vector DB API key", category: 'data', freeForAll: false, operatorOnly: true },
  { name: 'hubspot_api_key', envVar: 'HUBSPOT_API_KEY',
    description: "HubSpot CRM", category: 'data', freeForAll: false, operatorOnly: true },
  { name: 'serpapi_key', envVar: 'SERPAPI_KEY',
    description: "SerpAPI Google Search results", category: 'search', freeForAll: false, operatorOnly: true },
  { name: 'apollo_api_key', envVar: 'APOLLO_API_KEY',
    description: "Apollo.io B2B contact enrichment", category: 'data', freeForAll: false, operatorOnly: true },
  { name: 'telegram_bot_token', envVar: 'TELEGRAM_BOT_TOKEN',
    description: "Telegram bot token", category: 'social', freeForAll: false, operatorOnly: true },
  { name: 'twilio_account_sid', envVar: 'TWILIO_ACCOUNT_SID',
    description: "Twilio account SID", category: 'comms', freeForAll: false, operatorOnly: true },
  { name: 'twilio_auth_token', envVar: 'TWILIO_AUTH_TOKEN',
    description: "Twilio auth token", category: 'comms', freeForAll: false, operatorOnly: true },
  { name: 'stripe_secret_key', envVar: 'STRIPE_SECRET_KEY',
    description: "Stripe secret key", category: 'payments', freeForAll: false, operatorOnly: true },
  { name: 'cloudflare_api_token', envVar: 'CLOUDFLARE_API_TOKEN',
    description: "Cloudflare API token (DNS, Tunnels, Access)", category: 'infra', freeForAll: false, operatorOnly: true },
  { name: 'railway_token', envVar: 'RAILWAY_TOKEN',
    description: "Railway deployment token", category: 'infra', freeForAll: false, operatorOnly: true },
  { name: 'composio_api_key', envVar: 'COMPOSIO_API_KEY',
    description: "Composio MCP integration platform", category: 'infra', freeForAll: false, operatorOnly: true },
  { name: 'duffel_api_key', envVar: 'DUFFEL_API_KEY',
    description: "Duffel flights API", category: 'data', freeForAll: false, operatorOnly: true },
  { name: 'retell_api_key', envVar: 'RETELL_API_KEY',
    description: "Retell AI voice", category: 'comms', freeForAll: false, operatorOnly: true },
  { name: 'openrouter_api_key', envVar: 'OPENROUTER_API_KEY',
    description: "OpenRouter (multi-provider LLM proxy)", category: 'llm', freeForAll: false, operatorOnly: true },
  { name: 'deepseek_api_key', envVar: 'DEEPSEEK_API_KEY',
    description: "DeepSeek API", category: 'llm', freeForAll: false, operatorOnly: true },
]

const _byName = new Map(CATALOGUE.map((s) => [s.name, s]))

/**
 * Look up a platform secret by name. Returns the value if the secret
 * is in the catalogue AND its env var is set, else null.
 *
 * userId is required for quota check + audit log (v1 logs to stderr;
 * v2 writes to platform_secret_usage and enforces limits).
 */
export function getPlatformSecret(userId: number, name: string): string | null {
  const spec = _byName.get(name)
  if (!spec) return null
  // Operator-only secrets: only the operator user gets them. Used for
  // Arthur's personal vault.env keys exposed to his own daemon agent
  // without leaking to other tenants on the same instance.
  if (spec.operatorOnly && userId !== OPERATOR_USER_ID) {
    return null
  }
  if (!spec.freeForAll && !spec.operatorOnly) {
    // v2: check user opt-in here.
    return null
  }
  const value = process.env[spec.envVar]
  if (!value) return null
  // Audit log (v1: stderr line; v2: platform_secret_usage table row)
  console.log(`[platform-secrets] user=${userId} used ${name}${spec.operatorOnly ? ' (operator)' : ''}`)
  return value
}

/**
 * Returns the list of platform secret NAMES available to a user — the
 * names only, never the values. The agent's system prompt enumerates
 * these so the model knows what's available without having to call
 * list_secrets manually.
 */
export function listPlatformSecrets(userId: number): Array<{
  name: string
  description: string
  category: string
  available: boolean
}> {
  return CATALOGUE
    .filter((s) => {
      if (s.freeForAll) return true
      if (s.operatorOnly && userId === OPERATOR_USER_ID) return true
      return false
    })
    .map((s) => ({
      name: s.name,
      description: s.description,
      category: s.category,
      available: !!process.env[s.envVar],
    }))
}

/** Used by the system-prompt scaffolding to know if a name is platform-provided. */
export function isPlatformSecret(name: string): boolean {
  const spec = _byName.get(name)
  return !!spec && !!process.env[spec.envVar]
}
