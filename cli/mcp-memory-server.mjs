#!/usr/bin/env node
/**
 * Daemon Memory MCP Server.
 *
 * Exposes the daemon's Letta-style memory tools (remember, recall,
 * memory blocks, archival facts) to any Claude Code instance via the
 * Model Context Protocol over stdio.
 *
 * The data lives in the device daemon's local SQLite at ~/.daemon/store.db
 * — same store the device daemon uses. So when Arthur (premium tier on
 * the daemon web UI) uses the daemon page, he gets memory tools via the
 * Daemon agent loop. When he uses Claude Code in his terminal, he gets
 * memory tools via this MCP server. SAME DATA on both sides.
 *
 * Setup (in ~/.claude/mcp.json or via --mcp-config):
 *
 *   {
 *     "mcpServers": {
 *       "daemon-memory": {
 *         "command": "node",
 *         "args": ["/home/arthur/daemon/cli/mcp-memory-server.mjs"],
 *         "env": {
 *           "DAEMON_PROJECT_ID": "8"
 *         }
 *       }
 *     }
 *   }
 *
 * The DAEMON_PROJECT_ID env var picks which daemon project the memory
 * tools target (so different cwd-bound Claude Code sessions can share
 * the same memory). Defaults to project_id=1 if unset.
 *
 * Protocol: JSON-RPC 2.0 over stdin/stdout.
 *
 * Methods supported:
 *   initialize           — handshake
 *   tools/list           — return tool definitions
 *   tools/call           — invoke a tool
 *   notifications/initialized  — fire-and-forget
 */

import { DatabaseSync } from 'node:sqlite'
import { existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { userInfo } from 'os'
import { randomUUID } from 'crypto'
import { createInterface } from 'readline'

// ── Store (mirror of cli/store.mjs but standalone — this server runs
//     as a separate process so it shouldn't reach into other modules) ─

const STORE_DIR = join(userInfo().homedir, '.daemon')
const STORE_PATH = join(STORE_DIR, 'store.db')

if (!existsSync(STORE_DIR)) mkdirSync(STORE_DIR, { recursive: true, mode: 0o700 })

const db = new DatabaseSync(STORE_PATH)
db.exec('PRAGMA journal_mode = WAL')
db.exec('PRAGMA foreign_keys = ON')

// Memory schema migrations. Idempotent — runs even if cli/store.mjs
// already added them. We use a separate migrations namespace so the
// MCP server doesn't fight with the device daemon over migration
// tracking.

db.exec(`
  CREATE TABLE IF NOT EXISTS migrations (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    applied_at TEXT NOT NULL
  );
`)

const applied = new Set(
  db.prepare('SELECT name FROM migrations').all().map((r) => r.name),
)

const memoryMigrations = [
  [
    'mcp_001_memory_blocks',
    `
    CREATE TABLE IF NOT EXISTS memory_blocks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      label TEXT NOT NULL,
      content TEXT NOT NULL,
      max_chars INTEGER DEFAULT 4000,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(project_id, label)
    );
    CREATE INDEX IF NOT EXISTS idx_blocks_project ON memory_blocks(project_id);
    `,
  ],
  [
    'mcp_002_project_facts',
    `
    CREATE TABLE IF NOT EXISTS project_facts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      category TEXT NOT NULL,
      content TEXT NOT NULL,
      source TEXT,
      embedded INTEGER DEFAULT 0,
      importance INTEGER DEFAULT 5,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_accessed_at TEXT,
      access_count INTEGER DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_facts_project ON project_facts(project_id, category);
    CREATE INDEX IF NOT EXISTS idx_facts_importance ON project_facts(project_id, importance DESC);
    `,
  ],
]

const insertMigration = db.prepare(
  "INSERT INTO migrations (name, applied_at) VALUES (?, datetime('now'))",
)

for (const [name, sql] of memoryMigrations) {
  if (!applied.has(name)) {
    db.exec(sql)
    insertMigration.run(name)
    process.stderr.write(`[daemon-memory] applied migration: ${name}\n`)
  }
}

// ── Project context ─────────────────────────────────────────

const PROJECT_ID = parseInt(process.env.DAEMON_PROJECT_ID || '1', 10)

// ── Memory operations ──────────────────────────────────────

const CORE_BLOCK_LABELS = ['project', 'recent', 'open_threads', 'gotchas', 'preferences']

function addFact({ category, content, source, importance }) {
  const result = db
    .prepare(
      `
    INSERT INTO project_facts (project_id, category, content, source, importance)
    VALUES (?, ?, ?, ?, ?)
  `,
    )
    .run(PROJECT_ID, String(category || ''), String(content || ''), source || null, importance ?? 5)
  return Number(result.lastInsertRowid)
}

function listFacts(category, limit = 50) {
  if (category) {
    return db
      .prepare(
        `SELECT * FROM project_facts WHERE project_id = ? AND category = ?
         ORDER BY importance DESC, created_at DESC LIMIT ?`,
      )
      .all(PROJECT_ID, category, limit)
  }
  return db
    .prepare(
      `SELECT * FROM project_facts WHERE project_id = ?
       ORDER BY importance DESC, created_at DESC LIMIT ?`,
    )
    .all(PROJECT_ID, limit)
}

function grepFacts(pattern, limit = 20) {
  return db
    .prepare(
      `SELECT * FROM project_facts WHERE project_id = ? AND content LIKE ?
       ORDER BY importance DESC LIMIT ?`,
    )
    .all(PROJECT_ID, `%${pattern}%`, limit)
}

function touchFact(id) {
  db.prepare(
    `UPDATE project_facts SET last_accessed_at = datetime('now'),
     access_count = access_count + 1 WHERE id = ?`,
  ).run(id)
}

function countFacts() {
  const total = db
    .prepare('SELECT COUNT(*) as c FROM project_facts WHERE project_id = ?')
    .get(PROJECT_ID).c
  const byCat = db
    .prepare(
      'SELECT category, COUNT(*) as c FROM project_facts WHERE project_id = ? GROUP BY category',
    )
    .all(PROJECT_ID)
  const by_category = {}
  for (const r of byCat) by_category[r.category] = r.c
  return { total, by_category }
}

function getMemoryBlocks() {
  return db
    .prepare('SELECT * FROM memory_blocks WHERE project_id = ? ORDER BY label')
    .all(PROJECT_ID)
}

function getMemoryBlock(label) {
  return db
    .prepare('SELECT * FROM memory_blocks WHERE project_id = ? AND label = ?')
    .get(PROJECT_ID, label)
}

function upsertMemoryBlock(label, content, maxChars = 4000) {
  db.prepare(
    `INSERT INTO memory_blocks (project_id, label, content, max_chars, updated_at)
     VALUES (?, ?, ?, ?, datetime('now'))
     ON CONFLICT(project_id, label) DO UPDATE SET
       content = excluded.content,
       max_chars = excluded.max_chars,
       updated_at = datetime('now')`,
  ).run(PROJECT_ID, label, content, maxChars)
}

function appendMemoryBlock(label, addition) {
  const existing = getMemoryBlock(label)
  const current = existing?.content || ''
  const maxChars = existing?.max_chars || 4000
  let next = current ? `${current}\n${addition}` : addition
  if (next.length > maxChars) next = next.slice(next.length - maxChars)
  upsertMemoryBlock(label, next, maxChars)
}

// recall: search blocks + facts for a query
function recall(query, limit = 20) {
  const terms = String(query)
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 2)
  if (terms.length === 0) return []

  const score = (text) => {
    const lower = text.toLowerCase()
    let hits = 0
    for (const t of terms) if (lower.includes(t)) hits++
    return hits / terms.length
  }

  const hits = []

  // Blocks
  for (const block of getMemoryBlocks()) {
    const s = score(block.content)
    if (s > 0) hits.push({
      source: 'block',
      id: block.id,
      label_or_category: block.label,
      score: s + 0.1,
      content: block.content,
    })
  }

  // Facts via grep then re-score
  const candidates = new Map()
  for (const term of terms) for (const f of grepFacts(term, 50)) candidates.set(f.id, f)
  for (const f of candidates.values()) {
    const s = score(f.content)
    if (s > 0) {
      hits.push({
        source: 'fact',
        id: f.id,
        label_or_category: f.category,
        score: s * (0.5 + f.importance / 10),
        content: f.content,
      })
      touchFact(f.id)
    }
  }

  hits.sort((a, b) => b.score - a.score)
  return hits.slice(0, limit)
}

// ── MCP tool definitions ───────────────────────────────────

const TOOLS = [
  {
    name: 'remember',
    description:
      'Write a durable fact to the project\'s archival memory. Use when something is worth remembering long-term: decisions, gotchas, people, references, file structures, API specs.',
    inputSchema: {
      type: 'object',
      properties: {
        category: { type: 'string', description: 'decision, gotcha, fact, todo, person, api, file, reference, preference' },
        content: { type: 'string', description: 'The fact text. Concise but specific.' },
        importance: { type: 'number', description: '1-10, default 5. Higher importance surfaces first in recall.' },
        source: { type: 'string', description: 'Optional: where this came from' },
      },
      required: ['category', 'content'],
    },
  },
  {
    name: 'recall',
    description:
      'Search the project\'s memory (core blocks + archival facts) for anything matching a query. Returns ranked hits.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        limit: { type: 'number', description: 'Default 20' },
      },
      required: ['query'],
    },
  },
  {
    name: 'list_facts',
    description: 'Browse archival facts, optionally filtered by category. Most important first.',
    inputSchema: {
      type: 'object',
      properties: {
        category: { type: 'string' },
        limit: { type: 'number', description: 'Default 50' },
      },
    },
  },
  {
    name: 'get_memory_block',
    description: 'Read a single core memory block by label (project, recent, open_threads, gotchas, preferences).',
    inputSchema: {
      type: 'object',
      properties: {
        label: { type: 'string' },
      },
      required: ['label'],
    },
  },
  {
    name: 'list_memory_blocks',
    description: 'List all core memory blocks for the project (label, length, max_chars).',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'update_memory_block',
    description:
      'Replace the entire content of a core memory block. Standard labels: project, recent, open_threads, gotchas, preferences. Errors if content > max_chars.',
    inputSchema: {
      type: 'object',
      properties: {
        label: { type: 'string' },
        content: { type: 'string' },
        max_chars: { type: 'number', description: 'Default 4000' },
      },
      required: ['label', 'content'],
    },
  },
  {
    name: 'append_memory_block',
    description: 'Append text to a core memory block. Auto-trims from front if it overflows max_chars.',
    inputSchema: {
      type: 'object',
      properties: {
        label: { type: 'string' },
        addition: { type: 'string' },
      },
      required: ['label', 'addition'],
    },
  },
  {
    name: 'memory_stats',
    description: 'Show counts: total facts, facts per category, total memory blocks. Useful for orientation.',
    inputSchema: { type: 'object', properties: {} },
  },
]

// ── Tool dispatch ──────────────────────────────────────────

function callTool(name, args) {
  try {
    switch (name) {
      case 'remember': {
        const id = addFact({
          category: args.category,
          content: args.content,
          source: args.source,
          importance: args.importance,
        })
        return [{ type: 'text', text: `**Remembered** (id=${id}, project=${PROJECT_ID}, category=${args.category}, importance=${args.importance ?? 5})` }]
      }

      case 'recall': {
        const hits = recall(args.query, args.limit || 20)
        if (hits.length === 0) {
          return [{ type: 'text', text: `No matches for "${args.query}".` }]
        }
        const lines = [`**${hits.length} hits** for "${args.query}":`, '']
        for (const h of hits) {
          lines.push(
            `- [${h.source}|${h.label_or_category}|score=${h.score.toFixed(2)}] ${h.content.slice(0, 200)}`,
          )
        }
        return [{ type: 'text', text: lines.join('\n') }]
      }

      case 'list_facts': {
        const facts = listFacts(args.category, args.limit || 50)
        const counts = countFacts()
        const lines = [`**${counts.total} total facts**, categories: ${JSON.stringify(counts.by_category)}`]
        if (args.category) lines[0] += ` (showing ${args.category})`
        lines.push('')
        for (const f of facts) {
          lines.push(`- [${f.id}|${f.category}|imp=${f.importance}] ${f.content.slice(0, 200)}`)
        }
        return [{ type: 'text', text: lines.join('\n') }]
      }

      case 'get_memory_block': {
        const block = getMemoryBlock(args.label)
        if (!block) return [{ type: 'text', text: `No block with label "${args.label}".` }]
        return [{ type: 'text', text: `**${block.label}** (${block.content.length}/${block.max_chars} chars, updated ${block.updated_at}):\n\n${block.content}` }]
      }

      case 'list_memory_blocks': {
        const blocks = getMemoryBlocks()
        if (blocks.length === 0) {
          return [{ type: 'text', text: `No memory blocks yet. Standard labels: ${CORE_BLOCK_LABELS.join(', ')}.` }]
        }
        const lines = [`**${blocks.length} blocks** in project ${PROJECT_ID}:`, '']
        for (const b of blocks) lines.push(`- ${b.label} (${b.content.length}/${b.max_chars} chars, updated ${b.updated_at})`)
        return [{ type: 'text', text: lines.join('\n') }]
      }

      case 'update_memory_block': {
        const maxChars = args.max_chars || 4000
        if (String(args.content || '').length > maxChars) {
          return [{ type: 'text', text: `Error: content (${args.content.length} chars) exceeds max_chars (${maxChars}). Trim it or raise max_chars.` }]
        }
        upsertMemoryBlock(args.label, args.content || '', maxChars)
        return [{ type: 'text', text: `**Updated** block "${args.label}" (${args.content.length}/${maxChars} chars)` }]
      }

      case 'append_memory_block': {
        appendMemoryBlock(args.label, args.addition || '')
        const block = getMemoryBlock(args.label)
        return [{ type: 'text', text: `**Appended** to "${args.label}" (${block.content.length}/${block.max_chars} chars total)` }]
      }

      case 'memory_stats': {
        const counts = countFacts()
        const blocks = getMemoryBlocks()
        const lines = [
          `**Memory stats** for project ${PROJECT_ID}:`,
          ``,
          `- Total facts: ${counts.total}`,
          `- By category: ${JSON.stringify(counts.by_category)}`,
          `- Memory blocks: ${blocks.length}`,
        ]
        for (const b of blocks) lines.push(`  - ${b.label}: ${b.content.length}/${b.max_chars} chars`)
        return [{ type: 'text', text: lines.join('\n') }]
      }

      default:
        return [{ type: 'text', text: `Unknown tool: ${name}` }]
    }
  } catch (e) {
    return [{ type: 'text', text: `Error in ${name}: ${e?.message || String(e)}` }]
  }
}

// ── JSON-RPC 2.0 dispatcher ────────────────────────────────

function handleRequest(req) {
  const id = req.id ?? null
  const method = req.method
  const params = req.params || {}

  if (method === 'initialize') {
    return {
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'daemon-memory', version: '0.1.0' },
      },
    }
  }

  if (method === 'notifications/initialized') return null

  if (method === 'tools/list') {
    return { jsonrpc: '2.0', id, result: { tools: TOOLS } }
  }

  if (method === 'tools/call') {
    const toolName = params.name
    const args = params.arguments || {}
    const content = callTool(toolName, args)
    return { jsonrpc: '2.0', id, result: { content, isError: false } }
  }

  return {
    jsonrpc: '2.0',
    id,
    error: { code: -32601, message: `Method not found: ${method}` },
  }
}

// ── stdin reader loop ──────────────────────────────────────

const rl = createInterface({ input: process.stdin })

rl.on('line', (line) => {
  const trimmed = line.trim()
  if (!trimmed) return
  let req
  try {
    req = JSON.parse(trimmed)
  } catch {
    return
  }
  try {
    const resp = handleRequest(req)
    if (resp) {
      process.stdout.write(JSON.stringify(resp) + '\n')
    }
  } catch (e) {
    process.stderr.write(`[daemon-memory] handler error: ${e?.message || e}\n`)
    if (req?.id != null) {
      process.stdout.write(
        JSON.stringify({
          jsonrpc: '2.0',
          id: req.id,
          error: { code: -32000, message: e?.message || String(e) },
        }) + '\n',
      )
    }
  }
})

rl.on('close', () => process.exit(0))

process.stderr.write(`[daemon-memory] ready (project_id=${PROJECT_ID}, store=${STORE_PATH})\n`)
