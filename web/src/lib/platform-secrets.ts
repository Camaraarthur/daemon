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
  category: 'search' | 'embedding' | 'llm' | 'comms' | 'data'
  freeForAll: boolean
  // Future: quotaPerUserPerDay, costPerCallUsd, requiresOptIn
}

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
  // Add when ready:
  // {
  //   name: 'gemini_embedding_key',
  //   envVar: 'GOOGLE_API_KEY',
  //   description: 'Gemini Embedding 002 — semantic file search.',
  //   category: 'embedding',
  //   freeForAll: true,
  // },
  // {
  //   name: 'resend_api_key',
  //   envVar: 'RESEND_API_KEY',
  //   description: 'Resend transactional email. Free up to 100/day per user.',
  //   category: 'comms',
  //   freeForAll: true,
  // },
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
  if (!spec.freeForAll) {
    // v2: check user opt-in here. For v1, all platform secrets are free.
    return null
  }
  const value = process.env[spec.envVar]
  if (!value) return null
  // Audit log (v1: stderr line; v2: platform_secret_usage table row)
  console.log(`[platform-secrets] user=${userId} used ${name}`)
  return value
}

/**
 * Returns the list of platform secret NAMES available to a user — the
 * names only, never the values. The agent's system prompt enumerates
 * these so the model knows what's available without having to call
 * list_secrets manually.
 */
export function listPlatformSecrets(_userId: number): Array<{
  name: string
  description: string
  category: string
  available: boolean
}> {
  return CATALOGUE.filter((s) => s.freeForAll).map((s) => ({
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
