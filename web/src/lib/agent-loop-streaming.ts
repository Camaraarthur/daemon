/**
 * Streaming variant of the agent loop. Same model as agent-loop.ts:
 * NO local execution. NO sandbox. All tool calls dispatched to the user's
 * device via the WS hub. The relay is a router, never an executor.
 */

import type { SSEEvent } from './streaming'
import { fetchDeviceTools, invokeDeviceTool } from './agent-loop'
import {
  MEMORY_TOOLS,
  MEMORY_TOOL_NAMES,
  IDEMPOTENT_MEMORY_TOOLS,
  executeMemoryTool,
} from './memory-tools'
import {
  SECRETS_TOOLS,
  SECRETS_TOOL_NAMES,
  IDEMPOTENT_SECRETS_TOOLS,
  executeSecretsTool,
} from './secrets-tools'

// Idempotent device tools can run in parallel within a single turn.
// Stateful device tools (bash with shared pty session, write_file,
// edit_file) must run serially.
const IDEMPOTENT_DEVICE_TOOLS = new Set([
  'read_file',
  'list_files',
  'glob',
  'grep',
  'lint_file',
  'device_info',
])

function isIdempotent(toolName: string): boolean {
  return (
    IDEMPOTENT_DEVICE_TOOLS.has(toolName) ||
    IDEMPOTENT_MEMORY_TOOLS.has(toolName) ||
    IDEMPOTENT_SECRETS_TOOLS.has(toolName)
  )
}

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

interface DeviceTool {
  name: string
  device_id: string
  device_name: string
  platform: string
  tool_name: string
  description: string
  inputSchema: Record<string, unknown>
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

async function callProviderWithTools(
  provider: ProviderConfig,
  messages: Message[],
  tools: ReturnType<typeof deviceToolsToOpenAI>,
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
  history?: Array<{ role: string; content: string }>
  /** Conversation id for persistent shell sessions on the device side. */
  conversationId?: string
  /** Project id — required to enable memory tools. */
  projectId?: number
}): Promise<{ response: string; model: string; toolCalls: Array<{ tool: string; args: Record<string, string>; result: string }> }> {
  const { provider, systemPrompt, userMessage, userId, maxIterations = 10, onEvent, history, conversationId, projectId } = opts

  // Discover the user's device tools. NO local sandbox.
  // Dedupe by short tool name so the model sees clean names like "bash"
  // instead of "arturito-linux-x64__bash" (which models tend to ignore
  // because the format is unfamiliar). Routing happens by short name.
  const deviceTools = await fetchDeviceTools(userId)
  const deviceToolMap = new Map<string, { device_id: string; tool_name: string }>()
  const dedupedByShortName = new Map<string, DeviceTool>()
  for (const dt of deviceTools) {
    deviceToolMap.set(dt.tool_name, { device_id: dt.device_id, tool_name: dt.tool_name })
    dedupedByShortName.set(dt.tool_name, dt)
  }
  // Tool surface = device tools + memory tools (when project context exists)
  const deviceToolDefs = Array.from(dedupedByShortName.values()).map(t => ({
    type: 'function' as const,
    function: { name: t.tool_name, description: t.description, parameters: t.inputSchema },
  }))
  // Tool surface = device tools + memory tools (when project context exists) + secrets tools (always)
  const tools = projectId
    ? [...deviceToolDefs, ...MEMORY_TOOLS, ...SECRETS_TOOLS]
    : [...deviceToolDefs, ...SECRETS_TOOLS]

  // Inject device context into the system prompt
  let enrichedSystemPrompt = systemPrompt
  if (deviceTools.length > 0) {
    const deviceSummary = Array.from(
      new Map(deviceTools.map(t => [t.device_id, { id: t.device_id, name: t.device_name, platform: t.platform }])).values(),
    ).map(d => `- ${d.name} (${d.platform}) [${d.id}]`).join('\n')
    enrichedSystemPrompt += `\n\nYour devices:\n${deviceSummary}\n\nEvery tool you call runs on one of these devices via the daemon WebSocket. Pass the same conversation_id to bash to keep shell state (cwd, env vars) across calls.`
  } else {
    enrichedSystemPrompt += `\n\n⚠️ No devices online for this user. Tool calls will fail. Tell the user to pair a device at /settings/devices.`
  }

  const messages: Message[] = [
    { role: 'system', content: enrichedSystemPrompt },
    // Include conversation history for continuity
    ...(history || []).slice(-20).map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })),
    { role: 'user', content: userMessage },
  ]

  const allToolCalls: Array<{ tool: string; args: Record<string, string>; result: string }> = []
  let finalResponse = ''
  let modelName = provider.model

  type DispatchedCall = {
    tc: NonNullable<ToolCallMessage['tool_calls']>[0]
    args: Record<string, unknown>
    result: string
  }

  const dispatchOne = async (
    tc: NonNullable<ToolCallMessage['tool_calls']>[0],
  ): Promise<DispatchedCall> => {
    let args: Record<string, unknown>
    try {
      args = JSON.parse(tc.function.arguments)
    } catch {
      return { tc, args: {}, result: `Error: failed to parse arguments: ${tc.function.arguments}` }
    }

    // Memory tool? Route to the device's local store via WS.
    if (MEMORY_TOOL_NAMES.has(tc.function.name)) {
      onEvent({ type: 'tool_call', data: { id: tc.id, name: tc.function.name, args } })
      const result = projectId
        ? await executeMemoryTool(tc.function.name, args, { projectId, userId: parseInt(userId, 10) || 0 })
        : 'Error: memory tools require a project context.'
      onEvent({ type: 'tool_result', data: { id: tc.id, name: tc.function.name, output: result } })
      return { tc, args, result }
    }

    // Secrets tool? Route through device-secrets (vault → platform broker fallback).
    if (SECRETS_TOOL_NAMES.has(tc.function.name)) {
      onEvent({ type: 'tool_call', data: { id: tc.id, name: tc.function.name, args } })
      const result = await executeSecretsTool(tc.function.name, args, {
        userId: parseInt(userId, 10) || 0,
      })
      onEvent({ type: 'tool_result', data: { id: tc.id, name: tc.function.name, output: result } })
      return { tc, args, result }
    }

    // Otherwise it's a device tool — dispatch to the user's device via WS.
    const route = deviceToolMap.get(tc.function.name)
    if (!route) {
      return {
        tc, args,
        result: `Error: no device online with tool "${tc.function.name}". Pair a device at /settings/devices.`,
      }
    }
    // Inject conversation_id for stateful bash sessions
    if (route.tool_name === 'bash' && conversationId && !args.conversation_id) {
      args.conversation_id = conversationId
    }
    onEvent({ type: 'tool_call', data: { id: tc.id, name: tc.function.name, args } })
    const result = await invokeDeviceTool(route.device_id, route.tool_name, args, userId)
    onEvent({ type: 'tool_result', data: { id: tc.id, name: tc.function.name, output: result } })
    return { tc, args, result }
  }

  for (let i = 0; i < maxIterations; i++) {
    onEvent({ type: 'thinking', data: { text: i === 0 ? 'Reasoning...' : `Iteration ${i + 1}...` } })

    const { message, model } = await callProviderWithTools(provider, messages, tools)
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

    // Add assistant message with tool calls to history
    messages.push({
      role: 'assistant',
      content: message.content,
      tool_calls: message.tool_calls,
    })

    // Partition into idempotent (parallel) and stateful (serial) tool calls
    const idempotentBatch: typeof message.tool_calls = []
    const statefulBatch: typeof message.tool_calls = []
    for (const tc of message.tool_calls) {
      if (isIdempotent(tc.function.name)) {
        idempotentBatch.push(tc)
      } else {
        statefulBatch.push(tc)
      }
    }

    const idempotentResults = idempotentBatch.length > 0
      ? await Promise.all(idempotentBatch.map(dispatchOne))
      : []
    const statefulResults: DispatchedCall[] = []
    for (const tc of statefulBatch) {
      statefulResults.push(await dispatchOne(tc))
    }

    // Re-order results to match the model's emitted order
    const byId = new Map<string, DispatchedCall>()
    for (const r of [...idempotentResults, ...statefulResults]) {
      byId.set(r.tc.id, r)
    }
    for (const tc of message.tool_calls) {
      const r = byId.get(tc.id)
      if (!r) continue
      allToolCalls.push({
        tool: tc.function.name,
        args: r.args as Record<string, string>,
        result: r.result,
      })
      messages.push({
        role: 'tool',
        tool_call_id: tc.id,
        content: r.result,
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
