/**
 * Phase 6a — device_send_file agent tool (vision §6).
 *
 * The agent calls device_send_file({from, to, src, dst}) and the
 * relay orchestrates: read from source via skill.invoke read_file,
 * write to destination via skill.invoke write_file. The relay
 * holds the bytes momentarily IN MEMORY ONLY — never persisted to
 * disk, never logged, never broadcast.
 *
 * Limits (v1):
 *   - 1 MB per file (matches the device-side read_file cap).
 *   - UTF-8 text only. Binary files need Phase 6b (WebRTC P2P).
 *
 * What this gives us right now:
 *   - "Move my notes.md from arturito to msi" works in chat.
 *   - "Copy the build log from msi to pixel" works.
 *   - The relay-mediated path is the **fallback** for Phase 6b.
 *     When WebRTC ships, the agent tool stays the same; the
 *     transport layer underneath swaps to a direct P2P data
 *     channel and the 1 MB cap is removed.
 *
 * Threat model:
 *   - Bytes flow relay → memory → relay → memory → device.
 *   - The relay never writes the bytes to disk.
 *   - The bytes are visible to the same Node process that runs the
 *     agent loop. Same trust boundary as agent_loop.ts's tool
 *     dispatch — the relay is already a router for plaintext
 *     instructions, so adding plaintext file content doesn't widen
 *     the threat surface meaningfully.
 *   - For files that contain real secrets, use Phase 6b (P2P)
 *     instead. Document this in the tool description so the agent
 *     knows.
 */

interface InvokeFn {
  (deviceId: string, toolName: string, args: Record<string, unknown>, userId?: string): Promise<string>
}

export interface TransferToolDef {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

export const TRANSFER_TOOLS: TransferToolDef[] = [
  {
    type: 'function',
    function: {
      name: 'device_send_file',
      description:
        'Copy a file from one of the user\'s devices to another. Use this for "move my notes from my server to my laptop", "copy the build log from msi to pixel", "send this PDF to my Mac". The transfer goes through the daemon relay (encrypted in transit, never written to relay disk). v1 limit: 1 MB, UTF-8 text only. Larger files and binaries will work transparently in v1.5 once WebRTC P2P ships.',
      parameters: {
        type: 'object',
        properties: {
          from_device_id: {
            type: 'string',
            description: 'The device id to read from. See your device list in the system prompt scaffold for valid ids. If omitted and there is exactly one device online, use that one.',
          },
          to_device_id: {
            type: 'string',
            description: 'The device id to write to. Required.',
          },
          src_path: {
            type: 'string',
            description: 'Absolute path on the source device.',
          },
          dst_path: {
            type: 'string',
            description: 'Absolute path on the destination device.',
          },
        },
        required: ['to_device_id', 'src_path', 'dst_path'],
      },
    },
  },
]

export const TRANSFER_TOOL_NAMES = new Set(TRANSFER_TOOLS.map((t) => t.function.name))

const MAX_BYTES = 1_000_000 // matches the device read_file cap

interface ReadFileResult {
  ok: boolean
  path: string
  content?: string
  size?: number
  error?: string
}

interface WriteFileResult {
  ok: boolean
  path: string
  size?: number
  error?: string
}

interface DeviceCommandResponse {
  result?: ReadFileResult | WriteFileResult
  ok?: boolean
  error?: string
}

function parseDeviceResult(raw: string): unknown {
  try {
    const top = JSON.parse(raw) as DeviceCommandResponse
    return top.result ?? top
  } catch {
    return null
  }
}

export async function executeTransferTool(
  toolName: string,
  args: Record<string, unknown>,
  ctx: { userId: string; invokeDeviceTool: InvokeFn; pickFromDevice?: () => string | null },
): Promise<string> {
  if (toolName !== 'device_send_file') {
    return `Error: unknown transfer tool: ${toolName}`
  }
  const fromIdRaw = typeof args.from_device_id === 'string' ? args.from_device_id : ''
  const toId = typeof args.to_device_id === 'string' ? args.to_device_id : ''
  const srcPath = typeof args.src_path === 'string' ? args.src_path : ''
  const dstPath = typeof args.dst_path === 'string' ? args.dst_path : ''

  if (!toId || !srcPath || !dstPath) {
    return JSON.stringify({
      ok: false,
      error: 'to_device_id, src_path, and dst_path are required',
    })
  }

  const fromId = fromIdRaw || ctx.pickFromDevice?.() || ''
  if (!fromId) {
    return JSON.stringify({
      ok: false,
      error: 'from_device_id required (or no device online to default to)',
    })
  }
  if (fromId === toId) {
    return JSON.stringify({
      ok: false,
      error: 'from_device_id and to_device_id are the same — use bash cp instead',
    })
  }

  // Step 1: read from source device
  const readRaw = await ctx.invokeDeviceTool(
    fromId,
    'read_file',
    { path: srcPath },
    ctx.userId,
  )
  const readResult = parseDeviceResult(readRaw) as ReadFileResult | null
  if (!readResult || !readResult.ok || typeof readResult.content !== 'string') {
    return JSON.stringify({
      ok: false,
      stage: 'read',
      from_device_id: fromId,
      src_path: srcPath,
      error: readResult?.error || 'read failed',
    })
  }
  const content = readResult.content
  const size = Buffer.byteLength(content, 'utf8')
  if (size > MAX_BYTES) {
    return JSON.stringify({
      ok: false,
      stage: 'read',
      error: `file too large (${size} bytes > ${MAX_BYTES}). v1.5 P2P will lift this cap.`,
    })
  }

  // Step 2: write to destination device
  const writeRaw = await ctx.invokeDeviceTool(
    toId,
    'write_file',
    { path: dstPath, content },
    ctx.userId,
  )
  const writeResult = parseDeviceResult(writeRaw) as WriteFileResult | null
  if (!writeResult || !writeResult.ok) {
    return JSON.stringify({
      ok: false,
      stage: 'write',
      to_device_id: toId,
      dst_path: dstPath,
      error: writeResult?.error || 'write failed',
    })
  }

  return JSON.stringify({
    ok: true,
    from_device_id: fromId,
    to_device_id: toId,
    src_path: srcPath,
    dst_path: dstPath,
    bytes: size,
    transport: 'relay-mediated',
    note: 'v1.5 will use WebRTC P2P for files > 1 MB and binary content',
  })
}
