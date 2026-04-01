import { NextRequest, NextResponse } from 'next/server'
import { spawn, execFile } from 'child_process'
import { promisify } from 'util'
import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from 'fs'

const execFileAsync = promisify(execFile)
import { join } from 'path'
import { randomUUID } from 'crypto'

function execClaude(args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn('claude', args, {
      stdio: ['pipe', 'pipe', 'pipe'],  // Explicit pipe for stdin — prevents "no stdin" warning
    })

    // Close stdin immediately so Claude doesn't wait
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

const DAEMON_ROOT = join(process.cwd(), '..')
const CONFIG_DIR = join(DAEMON_ROOT, 'config')
const SOUL_PATH = join(DAEMON_ROOT, 'SOUL.md')
const PERSONALITY_PATH = join(CONFIG_DIR, 'personality.json')
const MCP_CONFIG_PATH = join(CONFIG_DIR, 'mcp_tools.json')
const VENV_PYTHON = join(DAEMON_ROOT, '.venv', 'bin', 'python3')
const PROMPT_DIR = join('/tmp', 'daemon-prompts')

// Ensure prompt temp dir exists
try { mkdirSync(PROMPT_DIR, { recursive: true }) } catch {}

// Session IDs per thread for conversation continuity
const sessions: Record<string, string> = {}

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
  /**
   * Call the Python knowledge module to get relevant context.
   * Returns a formatted knowledge block for the system prompt.
   */
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
  /**
   * Store the conversation turn in the knowledge graph (background, non-blocking).
   */
  try {
    execFileAsync(VENV_PYTHON, [
      '-c',
      `import sys,os; sys.path.insert(0, os.environ["DAEMON_SERVER"])
from memory import store_conversation_turn
store_conversation_turn(os.environ["USER_MSG"], os.environ["DAEMON_MSG"])`,
    ], { timeout: 15000, env: { ...process.env, PYTHONPATH: join(DAEMON_ROOT, 'server'), DAEMON_SERVER: join(DAEMON_ROOT, 'server'), USER_MSG: userMsg.slice(0, 300), DAEMON_MSG: daemonMsg.slice(0, 300) } })
  } catch {
    // Non-critical, don't block
  }
}

export async function POST(req: NextRequest) {
  try {
    // AUTH CHECK — require valid token
    const token = req.cookies.get('daemon_token')?.value
    if (!token) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }
    // Verify token is valid (quick check) — token passed via env to prevent injection
    const authCheck = await execFileAsync(VENV_PYTHON, ['-c', `
import sys,json,os; sys.path.insert(0,os.environ["DAEMON_SERVER"])
from users import get_user_by_token
u=get_user_by_token(os.environ["AUTH_TOKEN"])
print(json.dumps({"ok":True} if u else {"ok":False}))
`], { timeout: 3000, env: { ...process.env, PYTHONPATH: join(DAEMON_ROOT, 'server'), DAEMON_SERVER: join(DAEMON_ROOT, 'server'), AUTH_TOKEN: token } })
    if (!JSON.parse(authCheck.stdout.trim()).ok) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 })
    }

    const { message, threadId } = await req.json()

    if (!message) {
      return NextResponse.json({ error: 'No message provided' }, { status: 400 })
    }

    const personality = loadPersonality()
    let systemPrompt = buildSystemPrompt(personality)

    // Retrieve relevant knowledge for this message
    const knowledgeContext = await getKnowledgeContext(message)
    if (knowledgeContext) {
      systemPrompt += '\n\n' + knowledgeContext
    }

    // Write system prompt to temp file (avoids shell arg length limits)
    const promptFile = join(PROMPT_DIR, `${randomUUID()}.md`)
    writeFileSync(promptFile, systemPrompt)

    const args = [
      '-p', message,
      '--output-format', 'json',
      '--model', 'opus',
      '--system-prompt-file', promptFile,
      '--dangerously-skip-permissions', '--allow-dangerously-skip-permissions',
    ]

    // Only load MCP tools when message likely needs device/hardware access
    const needsTools = /ssh|device|esp32|sensor|distance|temperature|phone|battery|pixel|msi|arturito|screen|display|hardware|run|execute|check|what.*running|connect|plot|stream|live|data|web.*page|key|pendant|show|monitor/i.test(message)

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

    const threadKey = threadId || 'default'
    if (sessions[threadKey]) {
      args.push('--resume', sessions[threadKey])
    }

    const { stdout } = await execClaude(args)

    // Clean up temp prompt file
    try { unlinkSync(promptFile) } catch {}

    const result = JSON.parse(stdout)
    if (result.session_id) sessions[threadKey] = result.session_id

    const responseText = result.result || ''

    // Update personality
    if (personality) {
      personality.interaction_count = (personality.interaction_count || 0) + 1
      writeFileSync(PERSONALITY_PATH, JSON.stringify(personality, null, 2))
    }

    // Store in knowledge graph (async, non-blocking)
    storeKnowledge(message, responseText)

    return NextResponse.json({
      response: responseText,
      sessionId: sessions[threadKey],
      model: Object.keys(result.modelUsage || {})[0] || 'unknown',
    })
  } catch (error: any) {
    console.error('[chat api]', error?.message || error)
    return NextResponse.json(
      { error: error?.message || 'Failed to communicate with daemon' },
      { status: 500 }
    )
  }
}
