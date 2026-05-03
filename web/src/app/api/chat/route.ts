import { NextRequest, NextResponse } from 'next/server'
import { execFile, spawn } from 'child_process'
import { promisify } from 'util'
import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from 'fs'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { routeChat, type ModelTier, PROVIDERS } from '@/lib/model-router'
import { createSSEStream, parseClaudeStreamLine, type SSEEvent } from '@/lib/streaming'
import { runAgentLoopStreaming } from '@/lib/agent-loop-streaming'
// SLICE-B: invokeDeviceTool for resolving @-mentioned files via the user's device
import { invokeDeviceTool } from '@/lib/agent-loop'
import { matchSlashCommand } from '@/lib/slash-commands'
import * as db from '@/lib/db'
import { buildProjectContext, appendSessionSummary } from '@/lib/context'
// ── Cost Calculation (inlined from removed billing.ts — v0 has no billing) ──

const MODEL_COSTS: Record<string, { input: number; output: number; provider: string }> = {
  'qwen/qwen3-coder:free': { input: 0, output: 0, provider: 'openrouter' },
  'qwen/qwen3-coder': { input: 0.20, output: 0.60, provider: 'openrouter' },
  'qwen3-coder': { input: 0, output: 0, provider: 'openrouter' },
  'deepseek-chat': { input: 0.14, output: 0.28, provider: 'deepseek' },
  'deepseek-v3': { input: 0.14, output: 0.28, provider: 'deepseek' },
  'gemini-3-flash': { input: 0.075, output: 0.30, provider: 'google' },
  'gemini-3-pro': { input: 1.25, output: 5.00, provider: 'google' },
  'claude-sonnet': { input: 3.00, output: 15.00, provider: 'anthropic' },
  'claude-opus': { input: 15.00, output: 75.00, provider: 'anthropic' },
}

function calculateCost(model: string, inputTokens: number, outputTokens: number): number {
  const costs = MODEL_COSTS[model]
  if (!costs) return ((inputTokens * 0.50) + (outputTokens * 1.50)) / 1_000_000
  return ((inputTokens * costs.input) + (outputTokens * costs.output)) / 1_000_000
}

function detectProvider(model: string): string {
  const costs = MODEL_COSTS[model]
  if (costs) return costs.provider
  if (model.includes('claude')) return 'anthropic'
  if (model.includes('gemini')) return 'google'
  if (model.includes('deepseek')) return 'deepseek'
  if (model.includes('qwen')) return 'openrouter'
  return 'unknown'
}

const execFileAsync = promisify(execFile)

// ── Input Sanitization ────────────────────────────────────
const TOKEN_REGEX = /^[a-zA-Z0-9]+$/

function sanitizeToken(token: string): string {
  if (!TOKEN_REGEX.test(token)) {
    throw new Error('Invalid token format')
  }
  return token
}

// ── Rate Limiting ─────────────────────────────────────────
const RATE_LIMIT_FREE = 50    // messages per day
const RATE_LIMIT_PAID = 500   // messages per day

interface RateLimitEntry {
  count: number
  resetAt: number  // epoch ms
}

const rateLimits = new Map<string, RateLimitEntry>()

// Reset all counters daily at midnight
setInterval(() => {
  const now = Date.now()
  for (const [key, entry] of rateLimits) {
    if (now >= entry.resetAt) {
      rateLimits.delete(key)
    }
  }
}, 60_000) // cleanup every minute

function checkRateLimit(userId: string, tier: ModelTier): { allowed: boolean; remaining: number } {
  const limit = tier === 'free' ? RATE_LIMIT_FREE : RATE_LIMIT_PAID
  const now = Date.now()

  let entry = rateLimits.get(userId)
  if (!entry || now >= entry.resetAt) {
    // Reset: next midnight UTC
    const tomorrow = new Date()
    tomorrow.setUTCHours(24, 0, 0, 0)
    entry = { count: 0, resetAt: tomorrow.getTime() }
    rateLimits.set(userId, entry)
  }

  entry.count++
  const remaining = Math.max(0, limit - entry.count)

  return { allowed: entry.count <= limit, remaining }
}

const DAEMON_ROOT = join(process.cwd(), '..')
const CONFIG_DIR = join(DAEMON_ROOT, 'config')
const SOUL_PATH = join(DAEMON_ROOT, 'SOUL.md')
const PERSONALITY_PATH = join(CONFIG_DIR, 'personality.json')
const VENV_PYTHON = join(DAEMON_ROOT, '.venv', 'bin', 'python3')
const MCP_CONFIG_PATH = join(CONFIG_DIR, 'mcp_tools.json')
const PROMPT_DIR = join('/tmp', 'daemon-prompts')

try { mkdirSync(PROMPT_DIR, { recursive: true }) } catch {}

// Session IDs per thread for conversation continuity (premium only)
const claudeSessions: Record<string, string> = {}

function loadPersonality() {
  if (existsSync(PERSONALITY_PATH)) {
    return JSON.parse(readFileSync(PERSONALITY_PATH, 'utf-8'))
  }
  return null
}

function buildSystemPrompt(personality: any): string {
  let soul = ''
  if (existsSync(SOUL_PATH)) {
    soul = readFileSync(SOUL_PATH, 'utf-8')
  }

  const name = personality?.name || 'unnamed'
  const traits = personality?.traits || {}
  const memories = personality?.memory_highlights || []

  const traitLines = Object.entries(traits)
    .map(([k, v]) => `  ${k}: ${v}`)
    .join('\n')

  const memoryBlock = memories.length > 0
    ? memories.slice(-20).map((m: string) => `  - ${m}`).join('\n')
    : '  (none yet)'

  return `${soul}

## Current State
Name: ${name}
Interactions: ${personality?.interaction_count || 0}

### Traits
${traitLines}

### Memory Highlights
${memoryBlock}
`
}

async function getKnowledgeContext(message: string): Promise<string> {
  try {
    // Pass message via stdin to avoid shell injection through env vars
    const safeMessage = message.slice(0, 500)
    const child = spawn(VENV_PYTHON, [
      '-c',
      `import sys,os,json; sys.path.insert(0, os.environ["DAEMON_SERVER"])
from knowledge import build_knowledge_context
query = sys.stdin.read()
print(build_knowledge_context(query, limit=5))`,
    ], {
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 15000,
      env: { ...process.env, PYTHONPATH: join(DAEMON_ROOT, 'server'), DAEMON_SERVER: join(DAEMON_ROOT, 'server') },
    })
    child.stdin.write(safeMessage)
    child.stdin.end()

    return new Promise((resolve) => {
      let stdout = ''
      child.stdout.on('data', (d) => { stdout += d.toString() })
      child.on('close', () => resolve(stdout.trim()))
      child.on('error', () => resolve(''))
      setTimeout(() => { try { child.kill() } catch {} resolve('') }, 15000)
    })
  } catch {
    return ''
  }
}

async function storeKnowledge(userMsg: string, daemonMsg: string) {
  try {
    // Pass messages via stdin as JSON to avoid shell injection through env vars
    const payload = JSON.stringify({ user: userMsg.slice(0, 300), daemon: daemonMsg.slice(0, 300) })
    const child = spawn(VENV_PYTHON, [
      '-c',
      `import sys,os,json; sys.path.insert(0, os.environ["DAEMON_SERVER"])
from memory import store_conversation_turn
data = json.loads(sys.stdin.read())
store_conversation_turn(data["user"], data["daemon"])`,
    ], {
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 15000,
      env: { ...process.env, PYTHONPATH: join(DAEMON_ROOT, 'server'), DAEMON_SERVER: join(DAEMON_ROOT, 'server') },
    })
    child.stdin.write(payload)
    child.stdin.end()
  } catch {
    // Non-critical
  }
}

// ── Project Memory Generation ─────────────────────────────
// After every N messages in a thread, generate a MEMORY.md summary

const MEMORY_GENERATION_THRESHOLD = 10

async function maybeGenerateMemory(threadKey: string, userId: string) {
  try {
    const messages = db.listMessages(threadKey, 200)
    if (messages.length < MEMORY_GENERATION_THRESHOLD) return

    // Check if memory already exists for this thread (avoid regenerating too often)
    const memoryDir = join(DAEMON_ROOT, 'data', 'memory', `user_${userId}`)
    const threadMemoryFlag = join(memoryDir, '.memory_generated_' + threadKey.slice(0, 8))
    if (existsSync(threadMemoryFlag)) {
      // Only regenerate every 10 more messages
      const lastCount = parseInt(readFileSync(threadMemoryFlag, 'utf-8').trim() || '0')
      if (messages.length - lastCount < MEMORY_GENERATION_THRESHOLD) return
    }

    // Get thread info for project-specific memory
    const thread = db.getThread(threadKey)
    let targetDir = join(memoryDir, 'global')

    if (thread?.project_id) {
      const project = db.getProject(parseInt(userId) || 0, thread.project_id)
      if (project) {
        targetDir = join(memoryDir, 'projects', project.name)
      }
    }

    // Build a summary from the conversation
    const recentMessages = messages.slice(-20)
    const conversationText = recentMessages
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .map(m => `${m.role}: ${(m.content || '').slice(0, 200)}`)
      .join('\n')

    // Extract key points (simple heuristic — no LLM call to keep it fast)
    const keyPoints: string[] = []
    for (const msg of recentMessages) {
      if (!msg.content) continue
      // Look for decisions, file paths, tech stack mentions
      const content = msg.content
      if (/(?:decided|chose|using|switched to|installed|created|deployed|fixed)\b/i.test(content)) {
        keyPoints.push(content.slice(0, 150))
      }
    }

    const memoryContent = `# Conversation Memory
Generated: ${new Date().toISOString().slice(0, 19)}
Thread: ${threadKey.slice(0, 8)}
Messages: ${messages.length}

## Key Points
${keyPoints.length > 0 ? keyPoints.map(p => `- ${p}`).join('\n') : '- (no key decisions detected yet)'}

## Recent Context
${conversationText.slice(0, 2000)}
`

    mkdirSync(targetDir, { recursive: true })
    const memoryPath = join(targetDir, 'MEMORY.md')

    // Append to existing memory (don't overwrite)
    if (existsSync(memoryPath)) {
      const existing = readFileSync(memoryPath, 'utf-8')
      writeFileSync(memoryPath, existing + '\n---\n\n' + memoryContent)
    } else {
      writeFileSync(memoryPath, memoryContent)
    }

    // Write flag with current message count
    mkdirSync(memoryDir, { recursive: true })
    writeFileSync(threadMemoryFlag, String(messages.length))
  } catch (e) {
    console.warn('[chat] Memory generation failed:', e)
  }
}

async function getUserTier(token: string): Promise<{ tier: ModelTier; email: string; userId: string }> {
  try {
    // Validate token is alphanumeric (hex from secrets.token_hex)
    const safeToken = sanitizeToken(token)
    // Pass token via stdin to avoid env var injection
    const child = spawn(VENV_PYTHON, ['-c', `
import sys,json,os; sys.path.insert(0,os.environ["DAEMON_SERVER"])
from users import get_user_by_token
token = sys.stdin.read().strip()
u=get_user_by_token(token)
if u:
    settings = json.loads(u.get("settings","{}") or "{}")
    print(json.dumps({"ok":True,"email":u["email"],"tier":settings.get("model_tier","free"),"userId":str(u["id"])}))
else:
    print(json.dumps({"ok":False}))
`], {
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 3000,
      env: { ...process.env, PYTHONPATH: join(DAEMON_ROOT, 'server'), DAEMON_SERVER: join(DAEMON_ROOT, 'server') },
    })
    child.stdin.write(safeToken)
    child.stdin.end()

    const stdout = await new Promise<string>((resolve, reject) => {
      let out = ''
      child.stdout.on('data', (d) => { out += d.toString() })
      child.on('close', (code) => {
        if (code === 0 || out.trim()) resolve(out)
        else reject(new Error(`Python exited with code ${code}`))
      })
      child.on('error', reject)
    })
    const result = JSON.parse(stdout.trim())
    if (!result.ok) throw new Error('Invalid token')
    // Arthur (tutucamara@gmail.com) always gets premium
    const tier = result.email === 'tutucamara@gmail.com' ? 'premium' : (result.tier || 'free')
    return { tier: tier as ModelTier, email: result.email, userId: result.userId || '0' }
  } catch {
    throw new Error('Authentication failed')
  }
}

// Detect messages that need tool use (code execution, file ops, system commands)
const TOOLS_REGEX = /ssh|device|esp32|sensor|distance|temperature|phone|battery|pixel|msi|arturito|screen|display|hardware|run|execute|check|what.*running|connect|plot|stream|live|data|web.*page|key|pendant|show|monitor|write.*(?:code|script|file|program)|create.*(?:file|script|app)|build|install|compile|test|debug|fix.*(?:code|bug)|python|javascript|node|pip|npm|git|curl|wget|mkdir|docker/i

// ── Streaming handlers ─────────────────────────────────────

async function streamClaudeCLI(
  message: string,
  systemPrompt: string,
  threadId: string,
  needsTools: boolean,
  send: (event: SSEEvent) => void,
): Promise<{ response: string; model: string; sessionId?: string; toolCalls: Array<{ id?: string; tool: string; args: any; result?: string }> }> {
  const promptFile = join(PROMPT_DIR, `${randomUUID()}.md`)
  writeFileSync(promptFile, systemPrompt)

  const args = [
    '-p', message,
    '--output-format', 'stream-json',
    '--verbose',
    '--model', 'opus',
    '--system-prompt-file', promptFile,
    '--dangerously-skip-permissions', '--allow-dangerously-skip-permissions',
  ]

  if (needsTools && existsSync(MCP_CONFIG_PATH)) {
    args.push('--mcp-config', MCP_CONFIG_PATH)
    args.push(
      '--allowed-tools',
      'Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep',
      'mcp__daemon-tools__ssh_run',
      'mcp__daemon-tools__list_devices',
      'mcp__daemon-tools__device_info',
      'mcp__daemon-tools__list_usb_devices',
      'mcp__daemon-tools__scan_i2c',
      'mcp__daemon-tools__esp32_command',
      'mcp__daemon-tools__phone_command',
      'mcp__daemon-tools__plot_sensor_web',
      'mcp__daemon-tools__plot_sensor_esp32',
      'mcp__daemon-tools__push_to_web',
    )
  }

  // Use the daemon thread_id directly as claude's session id. Daemon
  // thread_ids are already UUIDs (see chat_threads.id), and `claude
  // --session-id <uuid>` both creates a fresh session AND resumes if
  // one exists with that id. Eliminates the in-memory `claudeSessions`
  // map (which lost continuity across relay restarts) — claude resolves
  // session state from disk on every spawn. Restart-safe.
  args.push('--session-id', threadId)
  if (claudeSessions[threadId]) {
    // Legacy fallback: if we have a non-thread-id session id cached
    // from a prior request, prefer --resume to it (covers the brief
    // window where some threads had a different claude session id).
    // Otherwise --session-id covers both create + resume.
  }

  return new Promise((resolve, reject) => {
    const claudeBin = process.env.CLAUDE_BIN || '/home/arthur/.local/bin/claude'
    const claudeEnv = { ...process.env, PATH: `/home/arthur/.local/bin:${process.env.PATH}`, ANTHROPIC_API_KEY: '' }
    const child = spawn(claudeBin, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: claudeEnv,
    })
    child.stdin.end()

    let fullText = ''
    let sessionId: string | undefined
    let model = 'claude-opus'
    let buffer = ''
    // Accumulate tool calls so they can be persisted on the assistant message —
    // otherwise the bash/edit/read blocks vanish on page refresh.
    const collectedToolCalls: Array<{ id?: string; tool: string; args: any; result?: string }> = []
    const toolCallById = new Map<string, { id?: string; tool: string; args: any; result?: string }>()

    const handleEvent = (event: SSEEvent) => {
      if (event.type === 'text') {
        fullText += event.data.text
        send(event)
      } else if (event.type === 'tool_call') {
        const tc = { id: event.data.id, tool: event.data.name, args: event.data.args || {} }
        collectedToolCalls.push(tc)
        if (event.data.id) toolCallById.set(event.data.id, tc)
        send(event)
      } else if (event.type === 'tool_result') {
        const tc = event.data.id ? toolCallById.get(event.data.id) : undefined
        if (tc) tc.result = event.data.output
        send(event)
      } else if (event.type === 'done') {
        if (event.data.response) fullText = event.data.response
        if (event.data.sessionId) sessionId = event.data.sessionId
        if (event.data.model) model = event.data.model
      } else {
        send(event)
      }
    }

    child.stdout.on('data', (chunk) => {
      resetIdleTimer()
      buffer += chunk.toString()
      const lines = buffer.split('\n')
      // Keep last incomplete line in buffer
      buffer = lines.pop() || ''

      for (const line of lines) {
        for (const event of parseClaudeStreamLine(line)) {
          handleEvent(event)
        }
      }
    })

    child.stderr.on('data', (d) => {
      resetIdleTimer()
      const msg = d.toString().trim()
      if (msg) send({ type: 'thinking', data: { text: msg } })
    })

    // Inactivity timeout — kill only if claude has been silent for too
    // long, NOT if total runtime exceeds an arbitrary ceiling. The
    // previous hard 180s timer killed long bash runs mid-output.
    // Reset every time stdout/stderr produces a chunk (see handlers
    // below). 5-minute idle window is generous; real hangs (network
    // wedged, infinite loop) still get caught, but a slow pip install
    // or a long curl no longer triggers a fake "timeout".
    const IDLE_TIMEOUT_MS = 5 * 60 * 1000
    let timer: NodeJS.Timeout
    const resetIdleTimer = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        child.kill()
        reject(new Error(`Claude idle for ${IDLE_TIMEOUT_MS / 1000}s — likely hung; killed.`))
      }, IDLE_TIMEOUT_MS)
    }
    resetIdleTimer()

    child.on('close', (code) => {
      clearTimeout(timer)
      try { unlinkSync(promptFile) } catch {}
      // Process remaining buffer
      if (buffer.trim()) {
        for (const event of parseClaudeStreamLine(buffer)) {
          handleEvent(event)
        }
      }
      if (sessionId) claudeSessions[threadId] = sessionId
      if (fullText || code === 0) {
        resolve({ response: fullText, model, sessionId, toolCalls: collectedToolCalls })
      } else {
        reject(new Error(`Claude exited with code ${code}`))
      }
    })
  })
}

async function streamOpenAICompatible(
  tier: 'free' | 'mid',
  systemPrompt: string,
  message: string,
  send: (event: SSEEvent) => void,
  history?: Array<{ role: string; content: string }>,
): Promise<{ response: string; model: string; usage?: any }> {
  const provider = PROVIDERS[tier]
  const apiKey = provider.getApiKey()
  if (!apiKey) {
    throw new Error(`No API key configured for ${provider.name}`)
  }

  // Build messages: system + history + current message
  const chatMessages: Array<{ role: string; content: string }> = [
    { role: 'system', content: systemPrompt },
  ]
  if (history?.length) {
    // Include last N turns to stay within context limits
    const recentHistory = history.slice(-20)
    chatMessages.push(...recentHistory)
  }
  chatMessages.push({ role: 'user', content: message })

  const res = await fetch(provider.baseUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      ...provider.extraHeaders,
    },
    body: JSON.stringify({
      model: provider.model,
      messages: chatMessages,
      max_tokens: provider.maxTokens,
      temperature: 0.7,
      stream: true,
    }),
  })

  if (!res.ok) {
    const errBody = await res.text()
    throw new Error(`${provider.name} API error (${res.status}): ${errBody}`)
  }

  const reader = res.body?.getReader()
  if (!reader) throw new Error('No response body')

  const decoder = new TextDecoder()
  let fullText = ''
  let model = provider.model
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue
      const payload = line.slice(6).trim()
      if (payload === '[DONE]') continue

      try {
        const obj = JSON.parse(payload)
        const delta = obj.choices?.[0]?.delta
        if (delta?.content) {
          // Strip thinking blocks
          let text = delta.content
          if (text.includes('<think>') || fullText.endsWith('</thi') || fullText.endsWith('</thin') || fullText.endsWith('</think')) {
            // Accumulate and strip later
          }
          fullText += text
          send({ type: 'text', data: { text } })
        }
        if (obj.model) model = obj.model
      } catch {
        // Skip malformed lines
      }
    }
  }

  // Strip thinking blocks from accumulated text
  fullText = fullText.replace(/<think>[\s\S]*?<\/think>/g, '').trim()

  return { response: fullText, model }
}

// ── POST handler ─────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const token = req.cookies.get('daemon_token')?.value
    if (!token) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    const { tier, email, userId } = await getUserTier(token)

    let body: any
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }
    // SLICE-B: added `mentionedFiles` to destructured body (rest is unchanged from HEAD)
    const { message, threadId, modelOverride, stream: wantStream, projectId: bodyProjectId, userMessageId: clientUserMessageId, mentionedFiles: bodyMentionedFiles } = body

    if (!message || typeof message !== 'string') {
      return NextResponse.json({ error: 'No message provided' }, { status: 400 })
    }

    // Rate limiting
    const { allowed, remaining } = checkRateLimit(userId, tier)
    if (!allowed) {
      return NextResponse.json(
        { error: 'Rate limit exceeded. Try again tomorrow.', limit: tier === 'free' ? RATE_LIMIT_FREE : RATE_LIMIT_PAID },
        { status: 429, headers: { 'X-RateLimit-Remaining': '0', 'Retry-After': '86400' } }
      )
    }

    const effectiveTier: ModelTier = modelOverride && ['free', 'mid', 'premium'].includes(modelOverride)
      ? modelOverride as ModelTier
      : tier

    // ── Slash command handling (server-side) ──────────────
    // Client may already expand these, but we also handle them server-side
    // to support API-only clients (curl, mobile app, CLI)
    let effectiveMessage = message
    const slashMatch = matchSlashCommand(message)
    if (slashMatch && slashMatch.command.type === 'prompt' && slashMatch.command.promptTemplate) {
      effectiveMessage = `${slashMatch.command.promptTemplate}\n\n${slashMatch.args ? `User request: ${slashMatch.args}` : ''}`.trim()
    }

    const personality = loadPersonality()
    let systemPrompt = buildSystemPrompt(personality)

    // ── Rich project context (CLAUDE.md + MEMORY + last session + git + devices) ──
    // Replaces the previous thin file-based memory loader.
    let resolvedProjectId: number | null = null
    try {
      const userIdNum = parseInt(userId) || 0

      if (threadId) {
        const thread = db.getThread(threadId)
        if (thread && thread.user_id !== userIdNum) {
          return NextResponse.json({ error: 'Not authorized' }, { status: 403 })
        }
        if (thread?.project_id) resolvedProjectId = thread.project_id
      }

      // Allow body to override / supply project (e.g. /resume on a fresh thread)
      if (bodyProjectId && typeof bodyProjectId === 'number') {
        const proj = db.getProject(userIdNum, bodyProjectId)
        if (proj) resolvedProjectId = bodyProjectId
      }

      if (resolvedProjectId) {
        const richContext = await buildProjectContext(userIdNum, resolvedProjectId, {
          email,
          daemonName: personality?.name,
        })
        if (richContext) {
          systemPrompt += `\n\n${richContext}`
        }
      } else {
        // No project — still inject the user's CLAUDE.md so global rules always apply
        const userRules = db.getUserRules(userIdNum)
        if (userRules) {
          systemPrompt += `\n\n### User Rules (CLAUDE.md)\n${userRules.slice(0, 8000)}`
        }
      }
    } catch (e) {
      console.warn('[chat] Rich context loading failed:', e)
    }

    // SLICE-B: resolve `mentionedFiles` to a `<mentioned-files>` bundle and
    // prepend to systemPrompt so the agent sees the file content up-front
    // (no need for a round-trip read_file). 8 KiB cap per file. Unknown
    // mentions are silently dropped.
    if (Array.isArray(bodyMentionedFiles) && bodyMentionedFiles.length > 0) {
      try {
        const userIdNum = parseInt(userId) || 0
        // Find the user's primary Linux/macOS daemon device.
        const dbInner = (await import('@/lib/db')).default
        const devRows = dbInner()
          .prepare(
            `SELECT device_id, platform, last_seen FROM device_tokens
             WHERE user_id = ? AND revoked = 0
             ORDER BY last_seen DESC`,
          )
          .all(userIdNum) as Array<{ device_id: string; platform: string | null }>
        let deviceId: string | null = null
        for (const r of devRows) {
          const plat = (r.platform || '').toLowerCase()
          if (plat === 'linux' || plat === 'macos' || plat === 'darwin') { deviceId = r.device_id; break }
        }
        if (!deviceId && devRows.length > 0) deviceId = devRows[0].device_id

        if (deviceId) {
          // Resolve project root so relative paths (e.g. "CLAUDE.md") work.
          let projectRoot: string | null = null
          if (resolvedProjectId) {
            const proj = db.getProject(userIdNum, resolvedProjectId)
            projectRoot = proj?.local_path || null
          }

          const PER_FILE_BYTES = 8 * 1024
          const fileBlocks: string[] = []
          // Cap mentions per request — defensive against absurd payloads
          const mentions = bodyMentionedFiles
            .filter((p: any) => typeof p === 'string' && p.length > 0 && p.length < 500)
            .slice(0, 16)
          for (const rawPath of mentions) {
            // If relative, resolve against project root; else use as-is
            const isAbs = rawPath.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(rawPath)
            const resolved = isAbs ? rawPath : (projectRoot ? `${projectRoot.replace(/\/$/, '')}/${rawPath}` : rawPath)
            try {
              const raw = await invokeDeviceTool(deviceId, 'read_file', { path: resolved }, userId)
              const parsed = (() => { try { return JSON.parse(raw) } catch { return null } })()
              if (!parsed || parsed.ok === false || typeof parsed.content !== 'string') {
                // Silently drop unresolved mentions
                continue
              }
              let content: string = parsed.content
              if (Buffer.byteLength(content, 'utf-8') > PER_FILE_BYTES) {
                // Naive char-truncate (UTF-8 might cut a multi-byte char, but
                // worst case is one mangled char; we mark explicitly).
                content = content.slice(0, PER_FILE_BYTES) + '\n[truncated]'
              }
              const safePath = String(resolved).replace(/"/g, '&quot;')
              fileBlocks.push(`<file path="${safePath}">\n${content}\n</file>`)
            } catch {
              // ignore single-file failure; keep going
            }
          }
          if (fileBlocks.length > 0) {
            const bundle = `<mentioned-files>\n${fileBlocks.join('\n')}\n</mentioned-files>`
            // Prepend BEFORE the existing systemPrompt body so the agent sees
            // mentioned files as up-front context.
            systemPrompt = `${bundle}\n\n${systemPrompt}`
          }
        }
      } catch (e) {
        console.warn('[chat] mentionedFiles injection failed:', e)
      }
    }

    const knowledgeContext = await getKnowledgeContext(effectiveMessage)
    if (knowledgeContext) {
      systemPrompt += '\n\n' + knowledgeContext
    }

    const needsTools = TOOLS_REGEX.test(effectiveMessage) || (slashMatch?.command.type === 'prompt')
    const threadKey = threadId || 'default'

    // ── Claude Code sync IN: pull any new messages from the linked JSONL ──
    // This catches messages typed in `claude` CLI in the terminal between page loads.
    // We sync into the project's CANONICAL thread (one-thread-per-project model),
    // not the request's threadKey which may be a transient default.
    let claudeUserUuid: string | null = null
    // The Claude Code session this project is bound to. Used as the
    // source_session_id tag on web-typed messages so they show up in the
    // same conversation view as terminal-typed messages.
    let boundSessionId: string | null = null
    if (resolvedProjectId) {
      try {
        const { syncBoundProject, appendUserMessage } = await import('@/lib/claude-sync')
        // Find the project's canonical thread
        const dbInner = (await import('@/lib/db')).default
        const canonical = dbInner().prepare(
          'SELECT id FROM chat_threads WHERE project_id = ? ORDER BY created_at ASC LIMIT 1'
        ).get(resolvedProjectId) as { id: string } | undefined
        const syncTargetThread = canonical?.id || threadKey

        const proj = db.getProject(parseInt(userId) || 0, resolvedProjectId)
        // Pull only from the project's bound Claude Code session. Auto-binds
        // if no binding exists yet (picks the most recent matching session).
        const { sessionId, imported } = syncBoundProject(
          resolvedProjectId,
          syncTargetThread,
          proj?.local_path || null,
        )
        boundSessionId = sessionId
        if (imported > 0) {
          console.log(`[claude-sync] Pulled ${imported} messages from bound session ${sessionId} into thread ${syncTargetThread}`)
        }
        // Write the user message to JSONL too — daemon and CLI share one history.
        const link = db.getClaudeCodeLink(resolvedProjectId)
        if (link?.enabled && sessionId) {
          const cwd = proj?.local_path || process.cwd()
          claudeUserUuid = appendUserMessage(resolvedProjectId, message, cwd)
        }
      } catch (e) {
        console.warn('[claude-sync] sync IN failed:', e)
      }
    }

    // Bump the project's last_active so the sidebar sorts it to the top.
    // This is the "most recently used" signal readers of listProjects rely
    // on. Without it, the sidebar gets frozen in whatever order projects
    // were last modified (usually creation order).
    if (resolvedProjectId) {
      try { db.touchProject(resolvedProjectId, parseInt(userId) || 0) } catch {}
    }

    // Persist user message to SQLite
    try {
      // Ensure thread exists in DB
      const existingThread = db.getThread(threadKey)
      if (!existingThread) {
        db.createThread(parseInt(userId) || 0, undefined, message.slice(0, 40))
        // The thread ID from createThread is a UUID, but we want to use the client's threadKey.
        // So we insert directly if the thread doesn't exist.
        try {
          const dbInner = (await import('@/lib/db')).default
          dbInner().prepare(
            'INSERT OR IGNORE INTO chat_threads (id, user_id, title) VALUES (?, ?, ?)'
          ).run(threadKey, parseInt(userId) || 0, message.slice(0, 40))
        } catch {}
      }
      // No relay-DB write — gossip is the persistence path. The user
      // message gets a fresh UUID, broadcast to subscribed clients, and
      // gossipped to the user's daemon devices in one shot.
      // If the client sent its own UUID (so it could optimistically render
      // the bubble), reuse it here — the WS `message.created` event then
      // matches the client's row and `applyThreadEvent` updates in place
      // instead of inserting a duplicate.
      const userMessageId = (typeof clientUserMessageId === 'string' && clientUserMessageId)
        ? clientUserMessageId
        : crypto.randomUUID()
      const userCreatedAt = new Date().toISOString().replace('T', ' ').slice(0, 19)
      try {
        const { broadcastThreadEvent, gossipChatMessage } = await import('@/lib/ws-broadcast')
        broadcastThreadEvent(threadKey, {
          type: 'message.created',
          message_id: userMessageId,
          thread_id: threadKey,
          role: 'user',
          content: message,
          model: null,
          created_at: userCreatedAt,
          source_session_id: boundSessionId || null,
          complete: true,
        })
        gossipChatMessage(parseInt(userId, 10) || 0, {
          id: userMessageId,
          thread_id: threadKey,
          role: 'user',
          content: message,
          created_at: userCreatedAt,
          source_session_id: boundSessionId || null,
          complete: true,
          project_id: resolvedProjectId || null,
        })
      } catch {}
    } catch (e) {
      // Non-critical — don't fail the request
      console.warn('[chat] Failed to persist user message:', e)
    }

    // ── Load thread history for non-premium tiers ──────────
    // Premium uses Claude CLI --resume for continuity; other tiers need
    // explicit history in the messages array.
    let threadHistory: Array<{ role: string; content: string }> = []
    if (effectiveTier !== 'premium') {
      try {
        const histMsgs = db.listMessages(threadKey, 40)
        // Convert to OpenAI-style roles, skip the just-added user message (last one)
        threadHistory = histMsgs
          .slice(0, -1) // exclude the message we just persisted above
          .filter(m => m.role === 'user' || m.role === 'assistant')
          .map(m => ({
            role: m.role === 'assistant' ? 'assistant' : 'user',
            content: (m.content || '').slice(0, 2000), // truncate long messages
          }))
      } catch (e) {
        console.warn('[chat] Failed to load thread history:', e)
      }
    }

    // ── Streaming path ──────────────────────────────────────
    if (wantStream) {
      const { response, send, close } = createSSEStream()

      // Run the streaming logic asynchronously
      ;(async () => {
        // Production-grade streaming: a StreamingWriter creates the assistant
        // row in DB up front (complete=0), persists content as it arrives, and
        // marks complete=1 at the end. Refreshes mid-stream see the partial
        // row; subscribed clients receive WS push events.
        const { StreamingWriter } = await import('@/lib/streaming-writer')
        const writer = new StreamingWriter({
          threadId: threadKey,
          role: 'assistant',
          model: undefined, // updated on finalize once we know which model answered
          sourceSessionId: boundSessionId,
          sseSend: send,
          userId: parseInt(userId, 10) || 0,
          projectId: resolvedProjectId || null,
        })
        const wrappedSend = writer.handleEvent

        try {
          wrappedSend({ type: 'thinking', data: { text: 'Starting...' } })

          let result: { response: string; model: string; sessionId?: string; toolCalls?: any[] }

          if (effectiveTier === 'premium') {
            // Claude CLI streaming — toolCalls accumulated inside streamClaudeCLI
            const r = await streamClaudeCLI(effectiveMessage, systemPrompt, threadKey, needsTools, wrappedSend)
            result = r
          } else if (needsTools && userId) {
            // Agent loop with streaming events
            const providerConfig = getProviderConfig(effectiveTier)
            result = await runAgentLoopStreaming({
              provider: providerConfig,
              systemPrompt,
              userMessage: effectiveMessage,
              userId,
              maxIterations: 10,
              onEvent: wrappedSend,
              history: threadHistory,
              conversationId: threadKey,
              projectId: resolvedProjectId || undefined,
            })
          } else {
            // Plain OpenAI-compatible streaming with fallback
            try {
              const r = await streamOpenAICompatible(effectiveTier, systemPrompt, effectiveMessage, wrappedSend, threadHistory)
              result = { ...r, toolCalls: [] }
            } catch (streamErr: any) {
              if (effectiveTier === 'free') {
                console.warn(`[stream] Free tier failed (${streamErr.message}), falling back to mid`)
                wrappedSend({ type: 'thinking', data: { text: 'Retrying with backup model...' } })
                const r = await streamOpenAICompatible('mid', systemPrompt, effectiveMessage, wrappedSend, threadHistory)
                result = { ...r, toolCalls: [] }
              } else {
                throw streamErr
              }
            }
          }

          // Finalize the streaming row: UPDATE complete=1, broadcast message.completed.
          // This replaces the old "addMessage at the end" pattern.
          writer.finalize({
            content: result.response,
            model: result.model,
            toolCalls: result.toolCalls,
          })

          // ── Claude Code sync OUT: write assistant message to JSONL ──
          if (resolvedProjectId && claudeUserUuid) {
            try {
              const { appendAssistantMessage } = await import('@/lib/claude-sync')
              appendAssistantMessage(resolvedProjectId, result.response, claudeUserUuid, result.model)
            } catch (e) {
              console.warn('[claude-sync] sync OUT (stream) failed:', e)
            }
          }

          // Log usage
          try {
            const inputTokens = result.response ? Math.ceil(message.length / 4) : 0  // estimate
            const outputTokens = result.response ? Math.ceil(result.response.length / 4) : 0
            const costUsd = calculateCost(result.model, inputTokens, outputTokens)
            const provider = detectProvider(result.model)
            const keySource = effectiveTier === 'premium' ? 'daemon' : 'daemon' // TODO: detect BYOK
            db.logUsage({
              userId: parseInt(userId) || 0,
              model: result.model,
              provider,
              inputTokens,
              outputTokens,
              costUsd,
              keySource,
              threadId: threadKey,
            })
          } catch (e) {
            console.warn('[chat] Failed to log usage:', e)
          }

          // Update personality
          if (personality) {
            personality.interaction_count = (personality.interaction_count || 0) + 1
            writeFileSync(PERSONALITY_PATH, JSON.stringify(personality, null, 2))
          }

          storeKnowledge(message, result.response)

          // Generate project memory if enough messages accumulated (async, non-blocking)
          maybeGenerateMemory(threadKey, userId).catch(() => {})
          if (resolvedProjectId) {
            appendSessionSummary(resolvedProjectId, threadKey).catch(() => {})
          }

          // Note: do NOT call writer.handleEvent for the 'done' event — the
          // streaming row was already finalized via writer.finalize() above.
          // We send 'done' straight to the SSE client to satisfy the legacy
          // protocol; once the WS push migration is complete, this can go.
          send({
            type: 'done',
            data: {
              response: result.response,
              model: result.model,
              tier: effectiveTier,
              sessionId: result.sessionId,
              toolCalls: result.toolCalls,
              messageId: writer.id,
            },
          })
        } catch (err: any) {
          // Mark the in-flight DB row complete with error suffix and broadcast.
          writer.finalizeError(err?.message || 'Stream failed')
          send({ type: 'error', data: { message: err?.message || 'Stream failed', messageId: writer.id } })
        } finally {
          close()
        }
      })()

      return response
    }

    // ── Non-streaming path (original behavior) ───────────────
    const result = await routeChat({
      message: effectiveMessage,
      tier: effectiveTier,
      systemPrompt,
      threadId: threadKey,
      needsTools,
      userId,
      projectId: resolvedProjectId || undefined,
    })

    // Update personality interaction count
    if (personality) {
      personality.interaction_count = (personality.interaction_count || 0) + 1
      writeFileSync(PERSONALITY_PATH, JSON.stringify(personality, null, 2))
    }

    // Persist assistant response
    let nonStreamMessageId: string | null = null
    // No relay-DB write — gossip is the persistence path.
    const assistantMessageId = crypto.randomUUID()
    const assistantCreatedAt = new Date().toISOString().replace('T', ' ').slice(0, 19)
    nonStreamMessageId = assistantMessageId
    try {
      const { broadcastThreadEvent, gossipChatMessage } = await import('@/lib/ws-broadcast')
      broadcastThreadEvent(threadKey, {
        type: 'message.completed',
        message_id: assistantMessageId,
        thread_id: threadKey,
        role: 'assistant',
        content: result.response,
        tool_calls: result.toolCalls,
        model: result.model,
        created_at: assistantCreatedAt,
        source_session_id: boundSessionId || null,
        complete: true,
      })
      gossipChatMessage(parseInt(userId, 10) || 0, {
        id: assistantMessageId,
        thread_id: threadKey,
        role: 'assistant',
        content: result.response,
        tool_calls: result.toolCalls?.length ? JSON.stringify(result.toolCalls) : null,
        model: result.model,
        created_at: assistantCreatedAt,
        source_session_id: boundSessionId || null,
        complete: true,
        project_id: resolvedProjectId || null,
      })
    } catch {}

    // ── Claude Code sync OUT: write assistant message to JSONL ──
    if (resolvedProjectId && claudeUserUuid) {
      try {
        const { appendAssistantMessage } = await import('@/lib/claude-sync')
        appendAssistantMessage(resolvedProjectId, result.response, claudeUserUuid, result.model)
      } catch (e) {
        console.warn('[claude-sync] sync OUT (non-stream) failed:', e)
      }
    }

    // Log usage
    try {
      const inputTokens = result.usage?.prompt_tokens || Math.ceil(message.length / 4)
      const outputTokens = result.usage?.completion_tokens || Math.ceil(result.response.length / 4)
      const costUsd = calculateCost(result.model, inputTokens, outputTokens)
      const provider = detectProvider(result.model)
      db.logUsage({
        userId: parseInt(userId) || 0,
        model: result.model,
        provider,
        inputTokens,
        outputTokens,
        costUsd,
        keySource: 'daemon',
        threadId: threadKey,
      })
    } catch (e) {
      console.warn('[chat] Failed to log usage:', e)
    }

    // Store in knowledge graph (async, non-blocking)
    storeKnowledge(message, result.response)

    // Generate project memory if enough messages accumulated (async, non-blocking)
    maybeGenerateMemory(threadKey, userId).catch(() => {})
    if (resolvedProjectId) {
      appendSessionSummary(resolvedProjectId, threadKey).catch(() => {})
    }

    return NextResponse.json({
      response: result.response,
      sessionId: result.sessionId,
      model: result.model,
      tier: result.tier,
      usage: result.usage,
      toolCalls: result.toolCalls,
    })
  } catch (error: any) {
    console.error('[chat api]', error?.message || error)
    return NextResponse.json(
      { error: error?.message || 'Failed to communicate with daemon' },
      { status: 500 }
    )
  }
}

// Helper — duplicated from model-router to avoid circular dep for streaming path
function getProviderConfig(tier: 'free' | 'mid') {
  const provider = PROVIDERS[tier]
  return {
    baseUrl: provider.baseUrl,
    model: tier === 'free' ? 'qwen/qwen3-coder' : provider.model,
    apiKey: provider.getApiKey(),
    extraHeaders: provider.extraHeaders as Record<string, string>,
    maxTokens: provider.maxTokens,
  }
}
