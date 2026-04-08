/**
 * Agent Loop — model API calls + tool dispatch.
 *
 * No local execution. No Docker sandbox. No bubblewrap. The relay process
 * is a pure router: it calls the model API, parses tool_calls, dispatches
 * each tool to the user's chosen device via the WS hub, and feeds results
 * back to the model. The user's device is the sandbox boundary.
 *
 * Loop: call model with tools → parse tool_calls → invoke on device →
 * append result → repeat. Idempotent tools run in parallel via Promise.all.
 */

// Idempotent tools can be dispatched in parallel within a single turn.
// Stateful tools (anything that touches a persistent shell session, mutates
// the filesystem, or has side effects) MUST run serially because they
// share the device's pty session and could race.
const IDEMPOTENT_TOOLS = new Set([
  'read_file',
  'list_files',
  'glob',
  'grep',
  'lint_file',
  'device_info',
])

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
  tools: ToolDefinition[],
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
  /** Conversation id for persistent shell sessions on the device side. */
  conversationId?: string
}): Promise<AgentResult> {
  const { provider, systemPrompt, userMessage, userId, maxIterations = 10, conversationId } = opts

  // Discover the user's device tools. The relay holds NO local sandbox —
  // every tool runs on the user's own device via the WS hub.
  const deviceTools = await fetchDeviceTools(userId)

  // Dedupe by short tool name (read_file, bash, etc.) — present ONE entry
  // per tool to the model with a clean name. The deviceToolMap routes
  // each short name to the actual (device_id, tool_name). When multiple
  // devices expose the same tool, the most recently registered wins
  // (later devices in the list overwrite earlier).
  // Multi-device per-tool routing is a later optimization (Phase v1.1).
  const deviceToolMap: DeviceToolMap = new Map()
  const dedupedTools: Map<string, DeviceTool> = new Map()
  for (const dt of deviceTools) {
    deviceToolMap.set(dt.tool_name, {
      device_id: dt.device_id,
      tool_name: dt.tool_name,
    })
    dedupedTools.set(dt.tool_name, dt)
  }

  // Convert to OpenAI tool defs with the SHORT names the model expects.
  const allTools = Array.from(dedupedTools.values()).map(t => ({
    type: 'function' as const,
    function: {
      name: t.tool_name,
      description: t.description,
      parameters: t.inputSchema,
    },
  }))

  // Plan/Act separation: first iteration plans, subsequent iterations execute
  const planPrefix = `## Instructions
You are a coding agent with access to tools that run on the user's devices.
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
    enrichedSystemPrompt += `\n\nYour devices:\n${deviceSummary}\n\nEvery tool you call runs on one of these devices via the daemon WebSocket. Same conversation_id keeps shell state (cwd, env vars) across bash calls.`
  } else {
    enrichedSystemPrompt += `\n\n⚠️ No devices online for this user. Tool calls will fail. Tell the user to pair a device at /settings/devices.`
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

    // Dispatch tool calls. Idempotent tools (read_file, glob, grep, etc.)
    // run in parallel via Promise.all. Anything else (bash, write_file,
    // edit_file) runs serially because it can mutate state on the device.
    type DispatchedCall = { tc: typeof message.tool_calls[0]; args: Record<string, unknown>; result: string }

    const dispatchOne = async (tc: typeof message.tool_calls[0]): Promise<DispatchedCall> => {
      let args: Record<string, unknown>
      try {
        args = JSON.parse(tc.function.arguments)
      } catch {
        return {
          tc, args: {},
          result: `Error: failed to parse arguments: ${tc.function.arguments}`,
        }
      }
      const deviceRoute = deviceToolMap.get(tc.function.name)
      if (!deviceRoute) {
        return {
          tc, args,
          result: `Error: no device online with tool "${tc.function.name}". Pair a device at /settings/devices.`,
        }
      }
      // Inject conversation_id for stateful bash sessions
      if (deviceRoute.tool_name === 'bash' && conversationId && !args.conversation_id) {
        args.conversation_id = conversationId
      }
      const result = await invokeDeviceTool(
        deviceRoute.device_id,
        deviceRoute.tool_name,
        args,
        userId,
      )
      return { tc, args, result }
    }

    // Partition into idempotent (parallel-safe) and stateful (serial).
    const idempotentBatch: typeof message.tool_calls = []
    const statefulBatch: typeof message.tool_calls = []
    for (const tc of message.tool_calls) {
      const route = deviceToolMap.get(tc.function.name)
      if (route && IDEMPOTENT_TOOLS.has(route.tool_name)) {
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

    // Re-order results to match the original tool_calls order so the
    // model sees them in the order it emitted them.
    const byId = new Map<string, DispatchedCall>()
    for (const r of [...idempotentResults, ...statefulResults]) {
      byId.set(r.tc.id, r)
    }
    for (const tc of message.tool_calls) {
      const r = byId.get(tc.id)
      if (!r) continue
      allToolCalls.push({ tool: tc.function.name, args: r.args as Record<string, string>, result: r.result })
      messages.push({
        role: 'tool',
        tool_call_id: tc.id,
        content: r.result,
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

export { fetchDeviceTools, invokeDeviceTool }
