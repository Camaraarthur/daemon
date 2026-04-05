/**
 * Streaming variant of the agent loop — emits SSE events as tool calls happen.
 * Re-uses sandbox management from agent-loop.ts.
 */

import type { SSEEvent } from './streaming'
import { getOrCreateSandbox, AGENT_TOOLS } from './agent-loop'
import { exec } from 'child_process'

// --- Sandbox exec (duplicated to avoid tight coupling) ---

function execInSandbox(containerId: string, cmd: string, timeout: number = 30, stdin?: string): Promise<string> {
  return new Promise((resolve) => {
    const escapedCmd = cmd.replace(/'/g, "'\\''")
    const child = exec(
      `docker exec -i ${containerId} timeout ${timeout} bash -c '${escapedCmd}'`,
      { maxBuffer: 1024 * 1024, timeout: (timeout + 5) * 1000 },
      (err, stdout, stderr) => {
        if (err && !stdout && !stderr) {
          resolve(`Error: ${err.message}`)
        } else {
          const out = stdout + (stderr ? `\nSTDERR: ${stderr}` : '')
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
  const trimmed = output.trim()
  if (!trimmed || trimmed === 'true') return null
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

// --- Types ---

interface ToolCallMessage {
  role: 'assistant'
  content: string | null
  tool_calls?: Array<{
    id: string
    type: 'function'
    function: { name: string; arguments: string }
  }>
}

type Message = { role: string; content: string | null; tool_calls?: ToolCallMessage['tool_calls']; tool_call_id?: string }

interface ProviderConfig {
  baseUrl: string
  model: string
  apiKey: string
  extraHeaders: Record<string, string>
  maxTokens: number
}

// --- Provider call with tools ---

async function callProviderWithTools(
  provider: ProviderConfig,
  messages: Message[],
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
      tools: AGENT_TOOLS,
      max_tokens: provider.maxTokens,
      temperature: 0.3,
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

// --- Streaming agent loop ---

export async function runAgentLoopStreaming(opts: {
  provider: ProviderConfig
  systemPrompt: string
  userMessage: string
  userId: string
  maxIterations?: number
  onEvent: (event: SSEEvent) => void
}): Promise<{ response: string; model: string; toolCalls: Array<{ tool: string; args: Record<string, string>; result: string }> }> {
  const { provider, systemPrompt, userMessage, userId, maxIterations = 10, onEvent } = opts
  const containerId = await getOrCreateSandbox(userId)

  const messages: Message[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userMessage },
  ]

  const allToolCalls: Array<{ tool: string; args: Record<string, string>; result: string }> = []
  let finalResponse = ''
  let modelName = provider.model

  for (let i = 0; i < maxIterations; i++) {
    onEvent({ type: 'thinking', data: { text: i === 0 ? 'Reasoning...' : `Iteration ${i + 1}...` } })

    const { message, model } = await callProviderWithTools(provider, messages)
    modelName = model

    // Strip thinking blocks
    let content = message.content || ''
    content = content.replace(/<think>[\s\S]*?<\/think>/g, '').trim()

    // No tool calls — done
    if (!message.tool_calls || message.tool_calls.length === 0) {
      finalResponse = content
      if (content) {
        onEvent({ type: 'text', data: { text: content } })
      }
      break
    }

    // Emit any intermediate text
    if (content) {
      onEvent({ type: 'text', data: { text: content } })
    }

    // Add assistant message to history
    messages.push({
      role: 'assistant',
      content: message.content,
      tool_calls: message.tool_calls,
    })

    // Execute each tool call with streaming events
    for (const tc of message.tool_calls) {
      let args: Record<string, string>
      try {
        args = JSON.parse(tc.function.arguments)
      } catch {
        args = { error: `Failed to parse arguments: ${tc.function.arguments}` }
      }

      // Emit tool_call event
      onEvent({
        type: 'tool_call',
        data: { id: tc.id, name: tc.function.name, args },
      })

      const result = await executeTool(containerId, tc.function.name, args)
      allToolCalls.push({ tool: tc.function.name, args, result })

      // Emit tool_result event
      onEvent({
        type: 'tool_result',
        data: { id: tc.id, name: tc.function.name, output: result },
      })

      messages.push({
        role: 'tool',
        tool_call_id: tc.id,
        content: result,
      })
    }

    // Last iteration — force response
    if (i === maxIterations - 1) {
      finalResponse = content || '[Agent reached maximum iterations]'
    }
  }

  return {
    response: finalResponse,
    model: modelName,
    toolCalls: allToolCalls,
  }
}
