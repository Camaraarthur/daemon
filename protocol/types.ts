/**
 * Daemon Protocol v0 — Message Types
 *
 * All messages are JSON over WebSocket (WSS), UTF-8 encoded.
 * Every message includes a `v` field for protocol version.
 * Max message size: 10 MB. Larger payloads use HTTP upload.
 *
 * See SPEC.md Section 3 for the full protocol specification.
 */

// ── Protocol Version ────────────────────────────────────────

export const PROTOCOL_VERSION = '0' as const

// ── Device Capabilities ─────────────────────────────────────

export interface DeviceCapabilities {
  shell: boolean
  files: boolean
  clipboard: boolean
  notifications: boolean
  camera: boolean
  browser: boolean
}

// ── Base Message ────────────────────────────────────────────

export interface BaseMessage {
  v: typeof PROTOCOL_VERSION
}

// ── 3.1 Authentication ──────────────────────────────────────

/** Client -> Server: device registration after pairing */
export interface AuthHello extends BaseMessage {
  type: 'auth.hello'
  device_token: string
  device_id: string
  device_name: string
  platform: string
  capabilities: DeviceCapabilities
}

/** Server -> Client: successful authentication */
export interface AuthSession extends BaseMessage {
  type: 'auth.session'
  device_id: string
  user_id: number
  session_id: string
  message: string
}

// ── 3.2 Heartbeat ───────────────────────────────────────────

export interface DeviceState {
  battery: number | null
  online: boolean
  active_project: string | null
}

/** Client -> Server: periodic heartbeat (every 60s) */
export interface DeviceHeartbeat extends BaseMessage {
  type: 'device.heartbeat'
  timestamp: number
  state: DeviceState
}

/** Server -> Client: heartbeat acknowledgment */
export interface HeartbeatAck extends BaseMessage {
  type: 'device.heartbeat_ack'
  server_time: number
}

// ── 3.3 Command Execution ───────────────────────────────────

/** Server -> Device: execute a shell command */
export interface DeviceInvoke extends BaseMessage {
  type: 'device.invoke'
  request_id: string
  command: string
  timeout_ms: number
  permission_tier: number
}

export interface CommandResult {
  stdout: string
  stderr: string
  exit_code: number
  duration_ms: number
}

/** Device -> Server: command execution result */
export interface DeviceResult extends BaseMessage {
  type: 'device.result'
  request_id: string
  result: CommandResult
}

// ── 3.4 MCP Tool Discovery ─────────────────────────────────

export interface ToolInputSchema {
  type: 'object'
  properties: Record<string, { type: string; description?: string }>
  required?: string[]
}

export interface ToolDefinition {
  name: string
  description: string
  inputSchema: ToolInputSchema
}

/** Server -> Device: request tool list */
export interface SkillList extends BaseMessage {
  type: 'skill.list'
}

/** Device -> Server: available tools */
export interface SkillListResult extends BaseMessage {
  type: 'skill.list_result'
  tools: ToolDefinition[]
}

// ── 3.5 MCP Tool Call ───────────────────────────────────────

/** Server -> Device: invoke a tool */
export interface SkillInvoke extends BaseMessage {
  type: 'skill.invoke'
  request_id: string
  name: string
  arguments: Record<string, unknown>
}

/** Device -> Server: tool invocation result */
export interface SkillResult extends BaseMessage {
  type: 'skill.result'
  request_id: string
  result: {
    content: string
    [key: string]: unknown
  }
}

// ── 3.6 Clipboard Sync ─────────────────────────────────────

/** Device -> Server: clipboard content changed */
export interface ClipboardUpdate extends BaseMessage {
  type: 'clipboard.update'
  content: string
  source_device: string
  timestamp: number
}

// ── 3.7 File Transfer ───────────────────────────────────────

/** Metadata message before binary WebSocket frame (files < 1 MB) */
export interface FileTransfer extends BaseMessage {
  type: 'file.transfer'
  request_id: string
  filename: string
  size: number
  target_device: string
}

// ── Error ───────────────────────────────────────────────────

/** Error response for any failed operation */
export interface ErrorMessage extends BaseMessage {
  type: 'error'
  code: string
  message: string
  request_id: string | null
}

// ── Union Type ──────────────────────────────────────────────

/** All possible protocol messages */
export type ProtocolMessage =
  | AuthHello
  | AuthSession
  | DeviceHeartbeat
  | HeartbeatAck
  | DeviceInvoke
  | DeviceResult
  | SkillList
  | SkillListResult
  | SkillInvoke
  | SkillResult
  | ClipboardUpdate
  | FileTransfer
  | ErrorMessage

/** Extract message type string from a ProtocolMessage */
export type MessageType = ProtocolMessage['type']

// ── Helpers ─────────────────────────────────────────────────

/** Create a protocol message with version field pre-set */
export function createMessage<T extends ProtocolMessage>(msg: Omit<T, 'v'>): T {
  return { v: PROTOCOL_VERSION, ...msg } as T
}

/** Validate that a parsed JSON object has the required protocol version */
export function isValidProtocolMessage(obj: unknown): obj is ProtocolMessage {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    'v' in obj &&
    (obj as any).v === PROTOCOL_VERSION &&
    'type' in obj &&
    typeof (obj as any).type === 'string'
  )
}
