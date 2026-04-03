import { NextRequest, NextResponse } from 'next/server'
import { execFile, spawn } from 'child_process'
import { promisify } from 'util'
import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from 'fs'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { routeChat, type ModelTier, PROVIDERS } from '@/lib/model-router'
import { createSSEStream, parseClaudeStreamLine, type SSEEvent } from '@/lib/streaming'
import { runAgentLoopStreaming } from '@/lib/agent-loop-streaming'
import * as db from '@/lib/db'
import { calculateCost, detectProvider } from '@/lib/billing'

const execFileAsync = promisify(execFile)

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
    const { stdout } = await execFileAsync(VENV_PYTHON, [
      '-c',
      `import sys,os; sys.path.insert(0, os.environ["DAEMON_SERVER"])
from knowledge import build_knowledge_context
print(build_knowledge_context(os.environ["QUERY_MSG"], limit=5))`,
    ], { timeout: 15000, env: { ...process.env, PYTHONPATH: join(DAEMON_ROOT, 'server'), DAEMON_SERVER: join(DAEMON_ROOT, 'server'), QUERY_MSG: message.slice(0, 500) } })
    return stdout.trim()
  } catch {
    return ''
  }
}

async function storeKnowledge(userMsg: string, daemonMsg: string) {
  try {
    execFileAsync(VENV_PYTHON, [
      '-c',
      `import sys,os; sys.path.insert(0, os.environ["DAEMON_SERVER"])
from memory import store_conversation_turn
store_conversation_turn(os.environ["USER_MSG"], os.environ["DAEMON_MSG"])`,
    ], { timeout: 15000, env: { ...process.env, PYTHONPATH: join(DAEMON_ROOT, 'server'), DAEMON_SERVER: join(DAEMON_ROOT, 'server'), USER_MSG: userMsg.slice(0, 300), DAEMON_MSG: daemonMsg.slice(0, 300) } })
  } catch {
    // Non-critical
  }
}

async function getUserTier(token: string): Promise<{ tier: ModelTier; email: string; userId: string }> {
  try {
    const { stdout } = await execFileAsync(VENV_PYTHON, ['-c', `
import sys,json,os; sys.path.insert(0,os.environ["DAEMON_SERVER"])
from users import get_user_by_token
u=get_user_by_token(os.environ["AUTH_TOKEN"])
if u:
    import json as j
    settings = j.loads(u.get("settings","{}") or "{}")
    print(j.dumps({"ok":True,"email":u["email"],"tier":settings.get("model_tier","free"),"userId":str(u["id"])}))
else:
    print(j.dumps({"ok":False}))
`], { timeout: 3000, env: { ...process.env, PYTHONPATH: join(DAEMON_ROOT, 'server'), DAEMON_SERVER: join(DAEMON_ROOT, 'server'), AUTH_TOKEN: token } })
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
    const { message, threadId, modelOverride, stream: wantStream } = await req.json()

    if (!message) {
      return NextResponse.json({ error: 'No message provided' }, { status: 400 })
    }

    const effectiveTier: ModelTier = modelOverride && ['free', 'mid', 'premium'].includes(modelOverride)
      ? modelOverride as ModelTier
      : tier

    const personality = loadPersonality()
    let systemPrompt = buildSystemPrompt(personality)

    const knowledgeContext = await getKnowledgeContext(message)
    if (knowledgeContext) {
      systemPrompt += '\n\n' + knowledgeContext
    }

    const needsTools = TOOLS_REGEX.test(message)
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
            const r = await streamClaudeCLI(message, systemPrompt, threadKey, needsTools, send)
            result = { ...r, toolCalls: [] }
          } else if (needsTools && userId) {
            // Agent loop with streaming events
            const providerConfig = getProviderConfig(effectiveTier)
            result = await runAgentLoopStreaming({
              provider: providerConfig,
              systemPrompt,
              userMessage: message,
              userId,
              maxIterations: 10,
              onEvent: send,
            })
          } else {
            // Plain OpenAI-compatible streaming
            const r = await streamOpenAICompatible(effectiveTier, systemPrompt, message, send)
            result = { ...r, toolCalls: [] }
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
      message,
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
