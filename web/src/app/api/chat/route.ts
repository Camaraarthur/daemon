import { NextRequest, NextResponse } from 'next/server'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import { routeChat, type ModelTier } from '@/lib/model-router'

const execFileAsync = promisify(execFile)

const DAEMON_ROOT = join(process.cwd(), '..')
const CONFIG_DIR = join(DAEMON_ROOT, 'config')
const SOUL_PATH = join(DAEMON_ROOT, 'SOUL.md')
const PERSONALITY_PATH = join(CONFIG_DIR, 'personality.json')
const VENV_PYTHON = join(DAEMON_ROOT, '.venv', 'bin', 'python3')

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

async function getUserTier(token: string): Promise<{ tier: ModelTier; email: string }> {
  try {
    const { stdout } = await execFileAsync(VENV_PYTHON, ['-c', `
import sys,json,os; sys.path.insert(0,os.environ["DAEMON_SERVER"])
from users import get_user_by_token
u=get_user_by_token(os.environ["AUTH_TOKEN"])
if u:
    import json as j
    settings = j.loads(u.get("settings","{}") or "{}")
    print(j.dumps({"ok":True,"email":u["email"],"tier":settings.get("model_tier","free")}))
else:
    print(j.dumps({"ok":False}))
`], { timeout: 3000, env: { ...process.env, PYTHONPATH: join(DAEMON_ROOT, 'server'), DAEMON_SERVER: join(DAEMON_ROOT, 'server'), AUTH_TOKEN: token } })
    const result = JSON.parse(stdout.trim())
    if (!result.ok) throw new Error('Invalid token')
    // Arthur (tutucamara@gmail.com) always gets premium
    const tier = result.email === 'tutucamara@gmail.com' ? 'premium' : (result.tier || 'free')
    return { tier: tier as ModelTier, email: result.email }
  } catch {
    throw new Error('Authentication failed')
  }
}

const TOOLS_REGEX = /ssh|device|esp32|sensor|distance|temperature|phone|battery|pixel|msi|arturito|screen|display|hardware|run|execute|check|what.*running|connect|plot|stream|live|data|web.*page|key|pendant|show|monitor/i

export async function POST(req: NextRequest) {
  try {
    const token = req.cookies.get('daemon_token')?.value
    if (!token) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    const { tier, email } = await getUserTier(token)
    const { message, threadId, modelOverride } = await req.json()

    if (!message) {
      return NextResponse.json({ error: 'No message provided' }, { status: 400 })
    }

    // Allow explicit tier override via request (for testing or user preference)
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

    const result = await routeChat({
      message,
      tier: effectiveTier,
      systemPrompt,
      threadId: threadKey,
      needsTools,
    })

    // Update personality interaction count
    if (personality) {
      personality.interaction_count = (personality.interaction_count || 0) + 1
      writeFileSync(PERSONALITY_PATH, JSON.stringify(personality, null, 2))
    }

    // Store in knowledge graph (async, non-blocking)
    storeKnowledge(message, result.response)

    return NextResponse.json({
      response: result.response,
      sessionId: result.sessionId,
      model: result.model,
      tier: result.tier,
      usage: result.usage,
    })
  } catch (error: any) {
    console.error('[chat api]', error?.message || error)
    return NextResponse.json(
      { error: error?.message || 'Failed to communicate with daemon' },
      { status: 500 }
    )
  }
}
