/**
 * Letta-style project memory service.
 *
 * Two layers, mirroring Letta's MemGPT architecture:
 *
 *   1. CORE MEMORY (memory_blocks table)
 *      Always-loaded labelled blocks rendered into the system prompt every
 *      turn. Bounded in size (max_chars), the agent may edit them via tool
 *      calls. Standard labels: project, recent, open_threads, gotchas,
 *      preferences. Think of these as the project's "working set".
 *
 *   2. ARCHIVAL MEMORY (project_facts table)
 *      Unbounded structured facts the agent writes when something is worth
 *      remembering long-term but doesn't need to be in every prompt. Pulled
 *      in on demand via recall() / grep_facts() / list_facts(). Each fact
 *      has a category (decision/gotcha/api/file/person/...), importance,
 *      and access stats so we can surface what actually matters.
 *
 * The agent calls these as tools:
 *   - update_memory_block(label, content)        — edit core memory
 *   - append_memory_block(label, addition)       — append to a core block
 *   - remember(category, content, importance)    — write a fact
 *   - recall(query)                              — search facts + blocks
 *   - list_facts(category?)                      — browse facts
 */

import {
  CORE_BLOCK_LABELS,
  type MemoryBlock,
  type ProjectFact,
  getMemoryBlocks,
  getMemoryBlock,
  upsertMemoryBlock,
  appendMemoryBlock,
  addFact,
  listFacts,
  grepFacts,
  touchFact,
  deleteFact,
  updateFact,
  countFacts,
  getProjectMemory,
  setProjectMemory,
  listThreads,
  listRecentMessages,
} from './db'

// ── Core memory rendering ────────────────────────────────────

const BLOCK_DESCRIPTIONS: Record<string, string> = {
  project: 'What this project is, its purpose, stack, domain',
  recent: 'What was just being worked on (last session(s))',
  open_threads: 'Pending TODOs, unfinished work, blockers',
  gotchas: 'Things that bit you, common mistakes to avoid',
  preferences: 'How the user wants this project handled',
}

/**
 * Assemble all core memory blocks into a single system-prompt section.
 * If a standard block is missing, render an empty placeholder so the agent
 * knows it can write to it.
 */
export function assembleCoreMemory(projectId: number): string {
  const blocks = getMemoryBlocks(projectId)
  const byLabel = new Map(blocks.map(b => [b.label, b]))

  const lines: string[] = ['## Project Memory (core blocks — always loaded)']
  lines.push(
    '_Edit with `update_memory_block(label, content)` or ' +
    '`append_memory_block(label, addition)`. Write durable facts with ' +
    '`remember(category, content)`. Search everything with `recall(query)`._',
  )

  // Render standard blocks first (in defined order), then any custom ones.
  const seen = new Set<string>()
  for (const label of CORE_BLOCK_LABELS) {
    seen.add(label)
    const block = byLabel.get(label)
    const desc = BLOCK_DESCRIPTIONS[label] || ''
    if (block && block.content.trim()) {
      lines.push(`\n### ${label} (${block.content.length}/${block.max_chars} chars)`)
      if (desc) lines.push(`_${desc}_`)
      lines.push(block.content.trim())
    } else {
      lines.push(`\n### ${label} _(empty${desc ? ' — ' + desc : ''})_`)
    }
  }
  for (const block of blocks) {
    if (seen.has(block.label)) continue
    if (!block.content.trim()) continue
    lines.push(`\n### ${block.label} (${block.content.length}/${block.max_chars} chars)`)
    lines.push(block.content.trim())
  }

  // Footer: archival fact summary so the agent knows what's recallable.
  const counts = countFacts(projectId)
  if (counts.total > 0) {
    const cats = Object.entries(counts.by_category)
      .sort((a, b) => b[1] - a[1])
      .map(([c, n]) => `${c}(${n})`)
      .join(', ')
    lines.push(`\n### archival index`)
    lines.push(`${counts.total} facts available via \`recall\` / \`list_facts\`. Categories: ${cats}`)
  } else {
    lines.push(`\n### archival index`)
    lines.push(`No archival facts yet. When you learn something durable, call \`remember(category, content)\`.`)
  }

  return lines.join('\n')
}

// ── Unified search (recall) ──────────────────────────────────

export interface RecallHit {
  source: 'block' | 'fact' | 'message'
  id: string | number
  label_or_category: string
  content: string
  score: number
  meta?: Record<string, unknown>
}

/**
 * Score a string against a query using simple multi-term overlap.
 * Returns a value in [0, 1]. Cheap, deterministic, no embeddings needed.
 * Vector search will plug in here later via the `embedded` column on facts.
 */
function scoreText(text: string, terms: string[]): number {
  if (!text || terms.length === 0) return 0
  const lower = text.toLowerCase()
  let hits = 0
  for (const t of terms) {
    if (!t) continue
    if (lower.includes(t)) hits++
  }
  return hits / terms.length
}

/**
 * Search every memory surface for a query — blocks, facts, recent chat
 * messages. Returns ranked hits across all sources. The agent calls this
 * as `recall(query)` whenever the user asks "where is X" / "what did we
 * decide about Y" / "remind me about Z".
 */
export function searchAllMemory(
  projectId: number,
  query: string,
  opts: { limit?: number; userId?: number } = {},
): RecallHit[] {
  const limit = opts.limit ?? 20
  const terms = query
    .toLowerCase()
    .split(/\s+/)
    .filter(t => t.length > 2)
  if (terms.length === 0) return []

  const hits: RecallHit[] = []

  // 1. Core blocks — they're small, scan all of them.
  for (const block of getMemoryBlocks(projectId)) {
    const score = scoreText(block.content, terms)
    if (score > 0) {
      hits.push({
        source: 'block',
        id: block.id,
        label_or_category: block.label,
        content: block.content,
        score: score + 0.1, // small bonus — blocks are curated
      })
    }
  }

  // 2. Archival facts — grep for any term, then score by overlap.
  const factCandidates = new Map<number, ProjectFact>()
  for (const term of terms) {
    for (const f of grepFacts(projectId, term, 50)) {
      factCandidates.set(f.id, f)
    }
  }
  for (const f of factCandidates.values()) {
    const score = scoreText(f.content, terms)
    if (score > 0) {
      // importance scales the score (1..10 → 0.5..1.5x)
      const weighted = score * (0.5 + f.importance / 10)
      hits.push({
        source: 'fact',
        id: f.id,
        label_or_category: f.category,
        content: f.content,
        score: weighted,
        meta: { importance: f.importance, source: f.source, created_at: f.created_at },
      })
      touchFact(f.id)
    }
  }

  // 3. Recent chat messages — scan the most recent 200 of the canonical thread.
  if (opts.userId) {
    try {
      const threads = listThreads(opts.userId, projectId)
      const t0 = threads[0]
      if (t0) {
        const msgs = listRecentMessages(t0.id, 200)
        for (const m of msgs) {
          if (!m.content) continue
          const score = scoreText(m.content, terms)
          if (score > 0.4) {
            hits.push({
              source: 'message',
              id: m.id,
              label_or_category: m.role,
              content: m.content.slice(0, 600),
              score: score * 0.8, // slight discount — messages are noisier
              meta: { created_at: m.created_at },
            })
          }
        }
      }
    } catch {
      // Threads may not exist yet — fine.
    }
  }

  hits.sort((a, b) => b.score - a.score)
  return hits.slice(0, limit)
}

// ── Agent-callable tool functions ────────────────────────────

/**
 * Tool: write a fact to archival memory.
 * Returns the created fact id.
 */
export function remember(args: {
  projectId: number
  category: string
  content: string
  source?: string
  importance?: number
}): { id: number; ok: true } {
  const fact = addFact(args)
  return { id: fact.id, ok: true }
}

/**
 * Tool: search all memory (core blocks + archival facts + recent messages).
 */
export function recall(args: {
  projectId: number
  query: string
  userId?: number
  limit?: number
}): RecallHit[] {
  return searchAllMemory(args.projectId, args.query, {
    limit: args.limit,
    userId: args.userId,
  })
}

/**
 * Tool: replace the entire content of a core memory block.
 * Refuses to write a block that exceeds its max_chars.
 */
export function updateBlock(args: {
  projectId: number
  label: string
  content: string
  maxChars?: number
}): { ok: boolean; error?: string } {
  const maxChars = args.maxChars ?? 4000
  if (args.content.length > maxChars) {
    return {
      ok: false,
      error: `Content (${args.content.length} chars) exceeds max_chars (${maxChars}). Trim it or raise max_chars.`,
    }
  }
  upsertMemoryBlock(args.projectId, args.label, args.content, maxChars)
  return { ok: true }
}

/**
 * Tool: append to a core memory block. Auto-trims from the front if it
 * would overflow max_chars.
 */
export function appendBlock(args: {
  projectId: number
  label: string
  addition: string
}): { ok: true } {
  appendMemoryBlock(args.projectId, args.label, args.addition)
  return { ok: true }
}

export {
  // re-exports so callers can `import { ... } from '@/lib/memory'`
  listFacts,
  grepFacts,
  deleteFact,
  updateFact,
  countFacts,
  getMemoryBlock,
  getMemoryBlocks,
}

// ── One-time migration from legacy project_memory ────────────

/**
 * Migrate legacy unstructured `project_memory` text into the new structured
 * blocks. Splits on `## ` headings — any heading whose lowercased name maps
 * to a known core label goes into that block; everything else gets dumped
 * into the `project` block.
 *
 * Idempotent: if a block already has content, skip it (don't overwrite).
 * Returns a summary of what was written.
 */
export function migrateLegacyProjectMemory(projectId: number): {
  migrated: boolean
  blocks_written: string[]
  reason?: string
} {
  const legacy = getProjectMemory(projectId)
  if (!legacy || !legacy.trim()) {
    return { migrated: false, blocks_written: [], reason: 'no legacy content' }
  }

  // Split on H2 headings, keeping the heading with each section.
  const sections: Array<{ heading: string; body: string }> = []
  const lines = legacy.split('\n')
  let current: { heading: string; body: string[] } | null = null
  for (const line of lines) {
    const m = line.match(/^##\s+(.+?)\s*$/)
    if (m) {
      if (current) sections.push({ heading: current.heading, body: current.body.join('\n').trim() })
      current = { heading: m[1].trim(), body: [] }
    } else if (current) {
      current.body.push(line)
    } else {
      // Pre-heading content — treat as project intro.
      if (line.trim()) {
        if (!current) current = { heading: 'project', body: [] }
        current.body.push(line)
      }
    }
  }
  if (current) sections.push({ heading: current.heading, body: current.body.join('\n').trim() })

  // Map headings to standard labels.
  const labelOf = (heading: string): string => {
    const h = heading.toLowerCase()
    if (h.includes('gotcha') || h.includes('mistake') || h.includes('bug')) return 'gotchas'
    if (h.includes('todo') || h.includes('pending') || h.includes('open') || h.includes('next')) return 'open_threads'
    if (h.includes('recent') || h.includes('session') || h.includes('current')) return 'recent'
    if (h.includes('preference') || h.includes('style') || h.includes('how ')) return 'preferences'
    return 'project'
  }

  // Group sections by target label.
  const grouped = new Map<string, string[]>()
  for (const s of sections) {
    const label = labelOf(s.heading)
    const piece = `### ${s.heading}\n${s.body}`.trim()
    const arr = grouped.get(label) || []
    arr.push(piece)
    grouped.set(label, arr)
  }

  const written: string[] = []
  for (const [label, pieces] of grouped) {
    const existing = getMemoryBlock(projectId, label)
    if (existing && existing.content.trim()) continue // don't clobber
    let content = pieces.join('\n\n').trim()
    // Cap at 4000 chars by default — keep the head (most descriptive).
    if (content.length > 4000) content = content.slice(0, 4000) + '\n... [truncated from legacy]'
    upsertMemoryBlock(projectId, label, content, 4000)
    written.push(label)
  }

  // Stash the original under a backup block so nothing is lost.
  const backupKey = '_legacy_project_memory'
  const backup = getMemoryBlock(projectId, backupKey)
  if (!backup) {
    upsertMemoryBlock(projectId, backupKey, legacy, Math.max(legacy.length, 4000))
  }

  return { migrated: written.length > 0, blocks_written: written }
}

/**
 * Convenience: clear the legacy table after a successful migration.
 * Caller decides when to invoke this — typically after verifying the new
 * blocks render correctly.
 */
export function clearLegacyProjectMemory(projectId: number): void {
  setProjectMemory(projectId, '')
}
