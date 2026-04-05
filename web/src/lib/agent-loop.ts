/**
 * Agent Loop — gives free/mid tier models Claude-Code-like tool use.
 *
 * Runs tool calls in a per-user Docker sandbox (gVisor isolated).
 * Loop: call model with tools → parse tool_calls → execute in sandbox → append result → repeat.
 */

import { exec } from 'child_process'
import { promisify } from 'util'
import { randomUUID } from 'crypto'

const execAsync = promisify(exec)

// --- Tool definitions (OpenAI function calling format) ---

const AGENT_TOOLS = [
  {
    type: 'function' as const,
    function: {
      name: 'bash',
      description: 'Run a bash command in the sandbox. Returns stdout and stderr. Use this for installing packages, running scripts, compiling, testing, etc.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'The bash command to execute' },
        },
        required: ['command'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'read_file',
      description: 'Read the contents of a file.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Path to the file' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'write_file',
      description: 'Write content to a file. Creates the file if it does not exist, overwrites if it does.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Path to the file' },
          content: { type: 'string', description: 'Content to write' },
        },
        required: ['path', 'content'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'list_files',
      description: 'List files and directories at a path.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Directory path (default: current directory)' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'search',
      description: 'Search for a pattern in files using ripgrep.',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Regex pattern to search for' },
          path: { type: 'string', description: 'Directory or file to search in (default: current directory)' },
        },
        required: ['pattern'],
      },
    },
  },
]

// --- Bubblewrap support (lightweight sandbox fallback) ---

let _bwrapAvailable: boolean | null = null

async function isBwrapAvailable(): Promise<boolean> {
  if (_bwrapAvailable !== null) return _bwrapAvailable
  try {
    await execAsync('which bwrap', { timeout: 3000 })
    _bwrapAvailable = true
    console.log('[agent] bubblewrap (bwrap) available — will use for sandboxed commands')
  } catch {
    _bwrapAvailable = false
    console.warn('[agent] bubblewrap (bwrap) not installed — commands will run without network isolation. Install with: sudo apt install bubblewrap')
  }
  return _bwrapAvailable
}

/**
 * Wrap a command in bubblewrap for network-isolated execution.
 * Falls back to direct execution if bwrap is not available.
 * NOTE: This is NOT used for device bridge commands (those run on the user's device intentionally).
 */
function wrapWithBwrap(cmd: string): string {
  // Escape single quotes in the command for the sh -c wrapper
  const escaped = cmd.replace(/'/g, "'\\''")
  return `bwrap --unshare-net --ro-bind / / --dev /dev --proc /proc --tmpfs /tmp --die-with-parent -- sh -c '${escaped}'`
}

// --- Sandbox management ---

// Active sandboxes: sandboxId → { containerId, lastUsed }
const activeSandboxes = new Map<string, { containerId: string; lastUsed: number }>()

// Cleanup idle sandboxes every 5 minutes
setInterval(() => {
  const now = Date.now()
  for (const [key, sandbox] of activeSandboxes) {
    if (now - sandbox.lastUsed > 30 * 60 * 1000) { // 30 min idle
      destroySandbox(sandbox.containerId).catch(() => {})
      activeSandboxes.delete(key)
    }
  }
}, 5 * 60 * 1000)

// Special container ID indicating bubblewrap fallback mode
const BWRAP_SANDBOX_ID = '__bwrap__'

async function getOrCreateSandbox(userId: string): Promise<string> {
  const existing = activeSandboxes.get(userId)
  if (existing) {
    if (existing.containerId === BWRAP_SANDBOX_ID) {
      existing.lastUsed = Date.now()
      return BWRAP_SANDBOX_ID
    }
    // Verify Docker container is still running
    try {
      await execAsync(`docker inspect --format='{{.State.Running}}' ${existing.containerId}`, { timeout: 5000 })
      existing.lastUsed = Date.now()
      return existing.containerId
    } catch {
      activeSandboxes.delete(userId)
    }
  }

  // Try Docker first
  try {
    const containerId = `daemon-sandbox-${userId.slice(0, 8)}-${randomUUID().slice(0, 8)}`
    await execAsync([
      'docker', 'run', '-d',
      '--name', containerId,
      '--runtime=runsc',
      '--memory=512m',
      '--cpus=1',
      '--pids-limit=128',
      '--network=none',
      '--read-only',
      '--tmpfs', '/tmp:size=100m',
      '--tmpfs', '/home/user:size=200m',
      '-u', '1000:1000',
      'daemon-sandbox:latest',
    ].join(' '), { timeout: 30000 })

    activeSandboxes.set(userId, { containerId, lastUsed: Date.now() })
    return containerId
  } catch {
    // Docker unavailable — fall back to bubblewrap or direct execution
    const hasBwrap = await isBwrapAvailable()
    if (hasBwrap) {
      console.log(`[agent] Docker unavailable for user ${userId}, using bubblewrap sandbox`)
    } else {
      console.warn(`[agent] WARNING: Neither Docker nor bubblewrap available for user ${userId} — commands will run unsandboxed`)
    }
    activeSandboxes.set(userId, { containerId: BWRAP_SANDBOX_ID, lastUsed: Date.now() })
    return BWRAP_SANDBOX_ID
  }
}

async function destroySandbox(containerId: string): Promise<void> {
  if (containerId === BWRAP_SANDBOX_ID) return // Nothing to destroy for bwrap
  try {
    await execAsync(`docker rm -f ${containerId}`, { timeout: 10000 })
  } catch {
    // Container may already be gone
  }
}

async function execInSandbox(containerId: string, cmd: string, timeout: number = 30, stdin?: string): Promise<string> {
  return new Promise((resolve) => {
    let fullCmd: string
    if (containerId === BWRAP_SANDBOX_ID) {
      // Bubblewrap or direct execution fallback
      if (_bwrapAvailable) {
        fullCmd = `timeout ${timeout} ${wrapWithBwrap(cmd)}`
      } else {
        // No sandbox available — run directly with timeout
        const escapedCmd = cmd.replace(/'/g, "'\\''")
        fullCmd = `timeout ${timeout} bash -c '${escapedCmd}'`
      }
    } else {
      // Docker sandbox
      const escapedCmd = cmd.replace(/'/g, "'\\''")
      fullCmd = `docker exec -i ${containerId} timeout ${timeout} bash -c '${escapedCmd}'`
    }

    const child = exec(
      fullCmd,
      { maxBuffer: 1024 * 1024, timeout: (timeout + 5) * 1000 },
      (err, stdout, stderr) => {
        if (err && !stdout && !stderr) {
          resolve(`Error: ${err.message}`)
        } else {
          const out = stdout + (stderr ? `\nSTDERR: ${stderr}` : '')
          // Truncate large output to avoid blowing up context
          resolve(out.length > 10000 ? out.slice(0, 10000) + '\n... (truncated)' : out)
        }
      },
    )
    if (stdin) {
      child.stdin?.write(stdin)
      child.stdin?.end()
    }
  })
}

// --- Lint-on-edit: after writing a file, run a quick lint check ---

async function lintFile(containerId: string, filePath: string): Promise<string | null> {
  const ext = filePath.split('.').pop()?.toLowerCase()
  let lintCmd: string | null = null

  if (ext === 'ts' || ext === 'tsx' || ext === 'js' || ext === 'jsx') {
    lintCmd = `npx tsc --noEmit "${filePath}" 2>&1 || true`
  } else if (ext === 'py') {
    lintCmd = `python3 -m py_compile "${filePath}" 2>&1 || true`
  }

  if (!lintCmd) return null

  const output = await execInSandbox(containerId, lintCmd, 15)
  // Only return if there are actual errors (not empty or just warnings)
  const trimmed = output.trim()
  if (!trimmed || trimmed === 'true') return null
  // Filter out "error TS" lines or "SyntaxError" for real errors
  if (/error TS|SyntaxError|IndentationError|NameError|ImportError/i.test(trimmed)) {
    return trimmed
  }
  return null
}

async function executeTool(containerId: string, toolName: string, args: Record<string, string>): Promise<string> {
  switch (toolName) {
    case 'bash':
      return execInSandbox(containerId, args.command)
    case 'read_file':
      return execInSandbox(containerId, `cat "${args.path}"`)
    case 'write_file': {
      // Write via heredoc to handle special characters
      const b64 = Buffer.from(args.content).toString('base64')
      const writeResult = await execInSandbox(containerId, `echo "${b64}" | base64 -d > "${args.path}" && echo "Written ${args.path}"`)

      // Lint-on-edit: check for syntax errors after writing
      const lintErrors = await lintFile(containerId, args.path)
      if (lintErrors) {
        return `${writeResult}\n\n[LINT ERRORS detected — fix before continuing]\n${lintErrors}`
      }
      return writeResult
    }
    case 'list_files':
      return execInSandbox(containerId, `ls -la ${args.path || '.'}`)
    case 'search':
      return execInSandbox(containerId, `rg --color=never -n "${args.pattern}" ${args.path || '.'} 2>/dev/null || echo "No matches found"`)
    default:
      return `Unknown tool: ${toolName}`
  }
}

// --- Device MCP tool discovery and execution ---

interface DeviceTool {
  name: string           // namespaced: "device-id.tool_name"
  device_id: string
  device_name: string
  platform: string
  tool_name: string      // original tool name for routing
  description: string
  inputSchema: Record<string, unknown>
}

const WS_SERVER_URL = process.env.WS_SERVER_URL || 'http://localhost:4801'

async function fetchDeviceTools(userId?: string): Promise<DeviceTool[]> {
  try {
    const url = userId
      ? `${WS_SERVER_URL}/tools?user_id=${encodeURIComponent(userId)}`
      : `${WS_SERVER_URL}/tools`
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) })
    if (!res.ok) return []
    const data = await res.json()
    return data.tools || []
  } catch {
    // WS server unreachable — no device tools available
    return []
  }
}

function deviceToolsToOpenAI(deviceTools: DeviceTool[]) {
  return deviceTools.map(t => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.inputSchema,
    },
  }))
}

async function invokeDeviceTool(
  deviceId: string,
  toolName: string,
  args: Record<string, unknown>,
  userId?: string,
): Promise<string> {
  try {
    const res = await fetch(`${WS_SERVER_URL}/skill/invoke`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        device_id: deviceId,
        tool_name: toolName,
        arguments: args,
        user_id: userId,
      }),
      signal: AbortSignal.timeout(35000),
    })
    const data = await res.json()
    if (!res.ok) return `Error: ${data.error || res.statusText}`
    return JSON.stringify(data, null, 2)
  } catch (e: unknown) {
    return `Error invoking device tool: ${e instanceof Error ? e.message : String(e)}`
  }
}

// Map of namespaced tool name -> { device_id, tool_name }
// Rebuilt each agent loop iteration
type DeviceToolMap = Map<string, { device_id: string; tool_name: string }>

// --- Types for OpenAI-compatible tool calling ---

interface ToolCallMessage {
  role: 'assistant'
  content: string | null
  tool_calls?: Array<{
    id: string
    type: 'function'
    function: { name: string; arguments: string }
  }>
}

interface ToolResultMessage {
  role: 'tool'
  tool_call_id: string
  content: string
}

type Message = { role: string; content: string | null; tool_calls?: ToolCallMessage['tool_calls']; tool_call_id?: string }

// --- Provider call with tools ---

interface ProviderConfig {
  baseUrl: string
  model: string
  apiKey: string
  extraHeaders: Record<string, string>
  maxTokens: number
}

type ToolDefinition = { type: 'function'; function: { name: string; description: string; parameters: Record<string, unknown> } }

async function callProviderWithTools(
  provider: ProviderConfig,
  messages: Message[],
  tools: ToolDefinition[] = AGENT_TOOLS,
): Promise<{ message: ToolCallMessage; usage: { prompt_tokens: number; completion_tokens: number }; model: string }> {
  const res = await fetch(provider.baseUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${provider.apiKey}`,
      ...provider.extraHeaders,
    },
    body: JSON.stringify({
      model: provider.model,
      messages,
      tools,
      max_tokens: provider.maxTokens,
      temperature: 0.3, // Lower temp for tool use — more deterministic
    }),
  })

  if (!res.ok) {
    const errBody = await res.text()
    throw new Error(`API error (${res.status}): ${errBody}`)
  }

  const data = await res.json()
  const choice = data.choices?.[0]
  if (!choice) throw new Error('No choices in response')

  return {
    message: choice.message,
    usage: data.usage || { prompt_tokens: 0, completion_tokens: 0 },
    model: data.model || provider.model,
  }
}

// --- The agent loop ---

export interface AgentResult {
  response: string
  model: string
  toolCalls: Array<{ tool: string; args: Record<string, string>; result: string }>
  totalUsage: { prompt_tokens: number; completion_tokens: number }
  iterations: number
}

export async function runAgentLoop(opts: {
  provider: ProviderConfig
  systemPrompt: string
  userMessage: string
  userId: string
  maxIterations?: number
}): Promise<AgentResult> {
  const { provider, systemPrompt, userMessage, userId, maxIterations = 10 } = opts
  const containerId = await getOrCreateSandbox(userId)

  // Discover device tools from connected devices
  const deviceTools = await fetchDeviceTools(userId)
  const deviceToolMap: DeviceToolMap = new Map()
  for (const dt of deviceTools) {
    deviceToolMap.set(dt.name, { device_id: dt.device_id, tool_name: dt.tool_name })
  }

  // Merge sandbox tools with device tools
  const allTools = [
    ...AGENT_TOOLS,
    ...deviceToolsToOpenAI(deviceTools),
  ]

  // Plan/Act separation: first iteration plans, subsequent iterations execute
  const planPrefix = `## Instructions
You are a coding agent with access to tools. Follow this process:
1. PLAN: Before making any changes, briefly describe what you will do (2-3 sentences max).
2. ACT: Then execute the plan using your tools.
3. VERIFY: After changes, verify they work (run the code, check for errors).

If a lint error is reported after writing a file, fix it before moving on.
`

  // Build system prompt with device context
  let enrichedSystemPrompt = planPrefix + '\n' + systemPrompt
  if (deviceTools.length > 0) {
    const deviceSummary = deviceTools
      .reduce((acc, t) => {
        if (!acc.find(d => d.id === t.device_id)) {
          acc.push({ id: t.device_id, name: t.device_name, platform: t.platform })
        }
        return acc
      }, [] as Array<{ id: string; name: string; platform: string }>)
      .map(d => `- ${d.name} (${d.platform}) [${d.id}]`)
      .join('\n')
    enrichedSystemPrompt += `\n\nConnected devices:\n${deviceSummary}\n\nYou can use device tools (prefixed with device ID) to run commands, read/write files, and get info on the user's devices. Use sandbox tools (bash, read_file, write_file, etc.) for server-side work.`
  }

  const messages: Message[] = [
    { role: 'system', content: enrichedSystemPrompt },
    { role: 'user', content: userMessage },
  ]

  const allToolCalls: AgentResult['toolCalls'] = []
  const totalUsage = { prompt_tokens: 0, completion_tokens: 0 }
  let finalResponse = ''
  let modelName = provider.model

  for (let i = 0; i < maxIterations; i++) {
    const { message, usage, model } = await callProviderWithTools(provider, messages, allTools)
    modelName = model
    totalUsage.prompt_tokens += usage.prompt_tokens
    totalUsage.completion_tokens += usage.completion_tokens

    // Strip thinking blocks from content
    let content = message.content || ''
    content = content.replace(/<think>[\s\S]*?<\/think>/g, '').trim()

    // No tool calls — we're done
    if (!message.tool_calls || message.tool_calls.length === 0) {
      finalResponse = content
      break
    }

    // Add assistant message with tool calls to history
    messages.push({
      role: 'assistant',
      content: message.content,
      tool_calls: message.tool_calls,
    })

    // Execute each tool call
    for (const tc of message.tool_calls) {
      let args: Record<string, string>
      try {
        args = JSON.parse(tc.function.arguments)
      } catch {
        args = { error: `Failed to parse arguments: ${tc.function.arguments}` }
      }

      let result: string
      const deviceRoute = deviceToolMap.get(tc.function.name)
      if (deviceRoute) {
        // Route to device via WS server
        result = await invokeDeviceTool(deviceRoute.device_id, deviceRoute.tool_name, args, userId)
      } else {
        // Execute in sandbox
        result = await executeTool(containerId, tc.function.name, args)
      }

      allToolCalls.push({ tool: tc.function.name, args, result })

      messages.push({
        role: 'tool',
        tool_call_id: tc.id,
        content: result,
      })
    }

    // If this was the last iteration, force a response
    if (i === maxIterations - 1) {
      finalResponse = content || '[Agent reached maximum iterations]'
    }
  }

  return {
    response: finalResponse,
    model: modelName,
    toolCalls: allToolCalls,
    totalUsage,
    iterations: allToolCalls.length > 0 ? Math.ceil(allToolCalls.length / 3) + 1 : 1,
  }
}

export { AGENT_TOOLS, getOrCreateSandbox, destroySandbox, fetchDeviceTools, invokeDeviceTool }
