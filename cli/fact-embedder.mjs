/**
 * Step 16 — Gemini Embedding 2 pipeline for project_facts.
 *
 * Wraps the Gemini Embedding REST endpoint and stores the resulting
 * 768-dim vectors in the device's local fact_embeddings table.
 *
 * Two entry points:
 *
 *   embedFactNow(factId, content)
 *     Synchronous embed + store. Used by the addFact() hot path
 *     when the agent commits a new fact and wants it findable
 *     immediately. Falls back to "skip silently" on Gemini errors
 *     so a fact insert never fails because of an embedding hiccup.
 *
 *   backfillProjectEmbeddings(project_id)
 *     Idempotent batch backfill. Walks every fact in a project that
 *     has embedded=0 and embeds it. Used by an admin command and
 *     by the daemon's startup hook (small projects only).
 *
 * The model is fixed to gemini-embedding-2-preview at 768 dimensions
 * — matching what /home/arthur/file-search uses, so we share the
 * embedding space and could later cross-search across both stores.
 *
 * Cost note (vision §4.3): ~$0.000025 per embed at the time of
 * writing. 1000 facts = $0.025. The backfill is intentionally
 * batched + rate-limited (100ms per call) so a project with 10k
 * facts costs ~$0.25 and takes ~17 minutes.
 */

import { upsertFactEmbedding, listUnembeddedFacts } from './store.mjs'

const MODEL = 'gemini-embedding-2-preview'
const DIM = 768
const RATE_LIMIT_MS = 100

async function embedQueryGemini(text) {
  const apiKey = process.env.GOOGLE_API_KEY
  if (!apiKey) {
    throw new Error('GOOGLE_API_KEY not set — daemon-device.service needs vault.env')
  }
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:embedContent?key=${apiKey}`
  const body = JSON.stringify({
    content: { parts: [{ text }] },
    taskType: 'RETRIEVAL_DOCUMENT',
    outputDimensionality: DIM,
  })
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    signal: AbortSignal.timeout(15000),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`gemini embed ${res.status}: ${text.slice(0, 200)}`)
  }
  const data = await res.json()
  const values = data?.embedding?.values
  if (!Array.isArray(values) || values.length !== DIM) {
    throw new Error(`gemini embed: bad response shape (got ${values?.length} values, expected ${DIM})`)
  }
  return new Float32Array(values)
}

/**
 * Embed a query string with task type RETRIEVAL_QUERY (asymmetric
 * embedding — query and document spaces are separately optimized).
 * Returns a Float32Array; throws on Gemini errors.
 */
export async function embedQuery(text) {
  const apiKey = process.env.GOOGLE_API_KEY
  if (!apiKey) throw new Error('GOOGLE_API_KEY not set')
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:embedContent?key=${apiKey}`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      content: { parts: [{ text }] },
      taskType: 'RETRIEVAL_QUERY',
      outputDimensionality: DIM,
    }),
    signal: AbortSignal.timeout(15000),
  })
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(`gemini embed ${res.status}: ${t.slice(0, 200)}`)
  }
  const data = await res.json()
  return new Float32Array(data?.embedding?.values || [])
}

/**
 * Embed a single fact and store. Best-effort: returns true on
 * success, false on any error (logged to stderr).
 */
export async function embedFactNow(factId, content) {
  if (!content || typeof content !== 'string') return false
  try {
    const vec = await embedQueryGemini(content.slice(0, 8000))
    upsertFactEmbedding(factId, MODEL, vec)
    return true
  } catch (e) {
    console.warn(`[fact-embed] fact_id=${factId} failed: ${e.message}`)
    return false
  }
}

/**
 * Backfill every unembedded fact in a project. Returns counts.
 * Stops after `limit` facts (defaults to 1000) so a single call
 * can't run away on a large project.
 */
export async function backfillProjectEmbeddings(project_id, limit = 1000) {
  const facts = listUnembeddedFacts(project_id, limit)
  let success = 0
  let failed = 0
  for (const f of facts) {
    const ok = await embedFactNow(f.id, f.content)
    if (ok) success++
    else failed++
    // Rate-limit to be polite to the Gemini quota.
    await new Promise((r) => setTimeout(r, RATE_LIMIT_MS))
  }
  return { project_id, attempted: facts.length, success, failed }
}

/**
 * Cosine similarity between two same-length Float32Arrays. Both
 * vectors are L2-normalized (Gemini Embedding 2 returns unit-norm
 * vectors at the requested output dim, so a plain dot product
 * suffices, but we re-normalize to be safe against quantization
 * drift).
 */
export function cosineSimilarity(a, b) {
  if (a.length !== b.length) return 0
  let dot = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  if (normA === 0 || normB === 0) return 0
  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}

export const EMBED_MODEL = MODEL
export const EMBED_DIM = DIM
