/**
 * Model Router — routes chat requests to different LLM backends based on user tier.
 *
 * Tiers:
 *   free    → Qwen3-Coder via OpenRouter (Alibaba subsidized, ~200 req/day)
 *   mid     → DeepSeek V3.2 via DeepSeek API ($0.28/$0.42 per MTok)
 *   premium → Claude via local `claude` CLI (Arthur's Max subscription)
 */

import { spawn } from 'child_process'
import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from 'fs'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { runAgentLoop, type AgentResult } from './agent-loop'

export type ModelTier = 'free' | 'mid' | 'premium'

interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

interface RouterResult {
  response: string
  model: string
  tier: ModelTier
  sessionId?: string
  usage?: { prompt_tokens: number; completion_tokens: number }
  toolCalls?: AgentResult['toolCalls']
}

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || ''
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || ''

const PROVIDERS = {
  free: {
    name: 'Qwen3-Coder (free)',
    baseUrl: 'https://openrouter.ai/api/v1/chat/completions',
    model: 'qwen/qwen3-coder:free',
    getApiKey: () => OPENROUTER_API_KEY,
    extraHeaders: {
      'HTTP-Referer': 'https://daemon.page',
      'X-Title': 'Daemon',
    },
    maxTokens: 16384,
  },
  mid: {
    name: 'DeepSeek V3.2',
    baseUrl: 'https://api.deepseek.com/v1/chat/completions',
    model: 'deepseek-chat',
    getApiKey: () => DEEPSEEK_API_KEY,
    extraHeaders: {},
    maxTokens: 8192,
  },
} as const

// --- OpenAI-compatible provider call ---

async function callOpenAICompatible(
  tier: 'free' | 'mid',
  messages: ChatMessage[],
): Promise<RouterResult> {
  const provider = PROVIDERS[tier]
  const apiKey = provider.getApiKey()
  if (!apiKey) {
    throw new Error(`No API key configured for ${provider.name}. Set ${tier === 'free' ? 'OPENROUTER_API_KEY' : 'DEEPSEEK_API_KEY'} in environment.`)
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
      messages,
      max_tokens: provider.maxTokens,
      temperature: 0.7,
    }),
  })

  if (!res.ok) {
    const errBody = await res.text()
    throw new Error(`${provider.name} API error (${res.status}): ${errBody}`)
  }

  const data = await res.json()
  const choice = data.choices?.[0]
  if (!choice) {
    throw new Error(`${provider.name} returned no choices`)
  }

  // Qwen3-Coder sometimes returns thinking blocks — strip <think>...</think>
  let content = choice.message?.content || ''
  content = content.replace(/<think>[\s\S]*?<\/think>/g, '').trim()

  return {
    response: content,
    model: data.model || provider.model,
    tier,
    usage: data.usage,
  }
}

// --- Claude CLI call (premium tier) ---

const DAEMON_ROOT = join(process.cwd(), '..')
const CONFIG_DIR = join(DAEMON_ROOT, 'config')
const SOUL_PATH = join(DAEMON_ROOT, 'SOUL.md')
const PERSONALITY_PATH = join(CONFIG_DIR, 'personality.json')
const MCP_CONFIG_PATH = join(CONFIG_DIR, 'mcp_tools.json')
const PROMPT_DIR = join('/tmp', 'daemon-prompts')

try { mkdirSync(PROMPT_DIR, { recursive: true }) } catch {}

// Session IDs per thread for conversation continuity (premium only)
const claudeSessions: Record<string, string> = {}

function execClaude(args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const claudeBin = process.env.CLAUDE_BIN || '/home/arthur/.local/bin/claude'
    // Unset ANTHROPIC_API_KEY so claude uses Max subscription, not the pay-per-token API
    const claudeEnv = { ...process.env, PATH: `/home/arthur/.local/bin:${process.env.PATH}`, ANTHROPIC_API_KEY: '' }
    const child = spawn(claudeBin, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: claudeEnv,
    })
    child.stdin.end()

    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (d) => { stdout += d.toString() })
    child.stderr.on('data', (d) => { stderr += d.toString() })

    const timer = setTimeout(() => {
      child.kill()
      reject(new Error('Claude timed out after 180s'))
    }, 180000)

    child.on('close', (code) => {
      clearTimeout(timer)
      if (stdout) {
        resolve({ stdout, stderr })
      } else {
        reject(new Error(stderr || `Claude exited with code ${code}`))
      }
    })
  })
}

async function callClaude(
  message: string,
  systemPrompt: string,
  threadId: string,
  needsTools: boolean,
): Promise<RouterResult> {
  const promptFile = join(PROMPT_DIR, `${randomUUID()}.md`)
  writeFileSync(promptFile, systemPrompt)

  const args = [
    '-p', message,
    '--output-format', 'json',
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

  const { stdout } = await execClaude(args)
  try { unlinkSync(promptFile) } catch {}

  const result = JSON.parse(stdout)
  if (result.session_id) claudeSessions[threadId] = result.session_id

  return {
    response: result.result || '',
    model: Object.keys(result.modelUsage || {})[0] || 'claude-opus',
    tier: 'premium',
    sessionId: claudeSessions[threadId],
  }
}

// --- Provider config helpers ---

function getProviderConfig(tier: 'free' | 'mid') {
  const provider = PROVIDERS[tier]
  return {
    baseUrl: provider.baseUrl,
    model: tier === 'free' ? 'qwen/qwen3-coder' : provider.model, // Use paid Qwen for tool use (more reliable)
    apiKey: provider.getApiKey(),
    extraHeaders: provider.extraHeaders as Record<string, string>,
    maxTokens: provider.maxTokens,
  }
}

// --- Main router ---

export async function routeChat(opts: {
  message: string
  tier: ModelTier
  systemPrompt: string
  threadId: string
  needsTools: boolean
  userId?: string
}): Promise<RouterResult> {
  const { message, tier, systemPrompt, threadId, needsTools, userId } = opts

  // Premium tier: Claude CLI handles everything including tools
  if (tier === 'premium') {
    return callClaude(message, systemPrompt, threadId, needsTools)
  }

  // Free/mid with tool use: run the agent loop in a Docker sandbox
  if (needsTools && userId) {
    const providerConfig = getProviderConfig(tier)
    try {
      const agentResult = await runAgentLoop({
        provider: providerConfig,
        systemPrompt,
        userMessage: message,
        userId,
        maxIterations: 10,
      })
      return {
        response: agentResult.response,
        model: agentResult.model,
        tier,
        usage: agentResult.totalUsage,
        toolCalls: agentResult.toolCalls,
      }
    } catch (err: any) {
      // If agent loop fails (e.g. sandbox issue), fall back to plain chat
      console.warn(`[router] Agent loop failed (${err.message}), falling back to plain chat`)
    }
  }

  // Plain chat (no tools)
  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: message },
  ]

  try {
    return await callOpenAICompatible(tier, messages)
  } catch (err: any) {
    // Fallback chain: free → paid Qwen → DeepSeek
    if (tier === 'free') {
      console.warn(`[router] Free tier failed (${err.message}), falling back to mid`)
      try {
        return await callOpenAICompatible('mid', messages)
      } catch (midErr: any) {
        throw new Error(`All tiers failed. Free: ${err.message}. Mid: ${midErr.message}`)
      }
    }
    throw err
  }
}

export { PROVIDERS }
