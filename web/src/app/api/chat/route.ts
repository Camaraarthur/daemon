import { NextRequest, NextResponse } from 'next/server'
import { execFile, spawn } from 'child_process'
import { promisify } from 'util'
import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from 'fs'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { routeChat, type ModelTier, PROVIDERS } from '@/lib/model-router'
import { createSSEStream, parseClaudeStreamLine, type SSEEvent } from '@/lib/streaming'
import { runAgentLoopStreaming } from '@/lib/agent-loop-streaming'
import { matchSlashCommand } from '@/lib/slash-commands'
import * as db from '@/lib/db'
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
): Promise<{ response: string; model: string; sessionId?: string }> {
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

  if (claudeSessions[threadId]) {
    args.push('--resume', claudeSessions[threadId])
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

    child.stdout.on('data', (chunk) => {
      buffer += chunk.toString()
      const lines = buffer.split('\n')
      // Keep last incomplete line in buffer
      buffer = lines.pop() || ''

      for (const line of lines) {
        const event = parseClaudeStreamLine(line)
        if (!event) continue

        if (event.type === 'text') {
          fullText += event.data.text
          send(event)
        } else if (event.type === 'done') {
          if (event.data.response) fullText = event.data.response
          if (event.data.sessionId) sessionId = event.data.sessionId
          if (event.data.model) model = event.data.model
        } else {
          send(event)
        }
      }
    })

    child.stderr.on('data', (d) => {
      const msg = d.toString().trim()
      if (msg) send({ type: 'thinking', data: { text: msg } })
    })

    const timer = setTimeout(() => {
      child.kill()
      reject(new Error('Claude timed out after 180s'))
    }, 180000)

    child.on('close', (code) => {
      clearTimeout(timer)
      try { unlinkSync(promptFile) } catch {}
      // Process remaining buffer
      if (buffer.trim()) {
        const event = parseClaudeStreamLine(buffer)
        if (event) {
          if (event.type === 'text') fullText += event.data.text
          if (event.type === 'done') {
            if (event.data.response) fullText = event.data.response
            if (event.data.sessionId) sessionId = event.data.sessionId
            if (event.data.model) model = event.data.model
          }
        }
      }
      if (sessionId) claudeSessions[threadId] = sessionId
      if (fullText || code === 0) {
        resolve({ response: fullText, model, sessionId })
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
): Promise<{ response: string; model: string; usage?: any }> {
  const provider = PROVIDERS[tier]
  const apiKey = provider.getApiKey()
  if (!apiKey) {
    throw new Error(`No API key configured for ${provider.name}`)
  }

  const res = await fetch(provider.baseUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      ...provider.extraHeaders,
    },
    body: JSON.stringify({
      model: provider.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: message },
      ],
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
    const { message, threadId, modelOverride, stream: wantStream } = body

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

    // ── Project memory (MEMORY.md pattern) ───────────────
    // Load project memory if a thread is linked to a project
    try {
      if (threadId) {
        const thread = db.getThread(threadId)
        // Verify thread belongs to this user
        if (thread && thread.user_id !== parseInt(userId)) {
          return NextResponse.json({ error: 'Not authorized' }, { status: 403 })
        }
        if (thread?.project_id) {
          // Load from file-based memory
          const memoryDir = join(DAEMON_ROOT, 'data', 'memory', `user_${userId}`, 'projects')
          const project = db.getProject(parseInt(userId) || 0, thread.project_id)
          if (project) {
            const projectMemoryPath = join(memoryDir, project.name, 'MEMORY.md')
            if (existsSync(projectMemoryPath)) {
              const memoryContent = readFileSync(projectMemoryPath, 'utf-8').slice(0, 4000) // 4K token budget
              systemPrompt += `\n\n## Project Memory (${project.display_name || project.name})\n${memoryContent}`
            }
          }
        }
      }
      // Always load global memory if it exists
      const globalMemoryPath = join(DAEMON_ROOT, 'data', 'memory', `user_${userId}`, 'global', 'MEMORY.md')
      if (existsSync(globalMemoryPath)) {
        const globalMemory = readFileSync(globalMemoryPath, 'utf-8').slice(0, 2000)
        systemPrompt += `\n\n## Global Memory\n${globalMemory}`
      }
    } catch {
      // Non-critical — memory loading should never break chat
    }

    const knowledgeContext = await getKnowledgeContext(effectiveMessage)
    if (knowledgeContext) {
      systemPrompt += '\n\n' + knowledgeContext
    }

    const needsTools = TOOLS_REGEX.test(effectiveMessage) || (slashMatch?.command.type === 'prompt')
    const threadKey = threadId || 'default'

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
      db.addMessage(threadKey, { role: 'user', content: message })
    } catch (e) {
      // Non-critical — don't fail the request
      console.warn('[chat] Failed to persist user message:', e)
    }

    // ── Streaming path ──────────────────────────────────────
    if (wantStream) {
      const { response, send, close } = createSSEStream()

      // Run the streaming logic asynchronously
      ;(async () => {
        try {
          send({ type: 'thinking', data: { text: 'Starting...' } })

          let result: { response: string; model: string; sessionId?: string; toolCalls?: any[] }

          if (effectiveTier === 'premium') {
            // Claude CLI streaming
            const r = await streamClaudeCLI(effectiveMessage, systemPrompt, threadKey, needsTools, send)
            result = { ...r, toolCalls: [] }
          } else if (needsTools && userId) {
            // Agent loop with streaming events
            const providerConfig = getProviderConfig(effectiveTier)
            result = await runAgentLoopStreaming({
              provider: providerConfig,
              systemPrompt,
              userMessage: effectiveMessage,
              userId,
              maxIterations: 10,
              onEvent: send,
            })
          } else {
            // Plain OpenAI-compatible streaming with fallback
            try {
              const r = await streamOpenAICompatible(effectiveTier, systemPrompt, effectiveMessage, send)
              result = { ...r, toolCalls: [] }
            } catch (streamErr: any) {
              if (effectiveTier === 'free') {
                console.warn(`[stream] Free tier failed (${streamErr.message}), falling back to mid`)
                send({ type: 'thinking', data: { text: 'Retrying with backup model...' } })
                const r = await streamOpenAICompatible('mid', systemPrompt, effectiveMessage, send)
                result = { ...r, toolCalls: [] }
              } else {
                throw streamErr
              }
            }
          }

          // Persist assistant response
          try {
            db.addMessage(threadKey, {
              role: 'assistant',
              content: result.response,
              model: result.model,
              tool_calls: result.toolCalls?.length ? JSON.stringify(result.toolCalls) : undefined,
            })
          } catch {}

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

          send({
            type: 'done',
            data: {
              response: result.response,
              model: result.model,
              tier: effectiveTier,
              sessionId: result.sessionId,
              toolCalls: result.toolCalls,
            },
          })
        } catch (err: any) {
          send({ type: 'error', data: { message: err?.message || 'Stream failed' } })
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
    })

    // Update personality interaction count
    if (personality) {
      personality.interaction_count = (personality.interaction_count || 0) + 1
      writeFileSync(PERSONALITY_PATH, JSON.stringify(personality, null, 2))
    }

    // Persist assistant response
    try {
      db.addMessage(threadKey, {
        role: 'assistant',
        content: result.response,
        model: result.model,
        tool_calls: result.toolCalls?.length ? JSON.stringify(result.toolCalls) : undefined,
      })
    } catch {}

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
