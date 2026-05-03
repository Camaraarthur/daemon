'use client'

import { useState } from 'react'
import { DiffView } from './DiffView'

export interface ToolCall {
  id?: string
  name: string
  args: Record<string, any>
  output?: string
  /** Live status — set to 'running' when the tool_call event arrives,
   *  'done' when tool_result arrives, 'error' when output starts with "Error". */
  status?: 'running' | 'done' | 'error'
  /** Device that ran the tool (set by the streaming layer when known). */
  device_id?: string
  /** Wall-clock duration in ms (set when status flips to done). */
  duration_ms?: number
}

const TOOL_LABELS: Record<string, string> = {
  // Daemon device tools
  bash: 'Bash',
  read_file: 'Read',
  write_file: 'Write',
  edit_file: 'Edit',
  list_files: 'List',
  glob: 'Glob',
  grep: 'Grep',
  lint_file: 'Lint',
  device_info: 'Device',
  // Memory tools
  remember: 'Remember',
  recall: 'Recall',
  update_memory_block: 'Update memory',
  append_memory_block: 'Append memory',
  list_facts: 'List facts',
  get_memory_block: 'Read memory',
  // Claude Code vocabulary (premium tier)
  Bash: 'Bash',
  Read: 'Read',
  Write: 'Write',
  Edit: 'Edit',
  Glob: 'Glob',
  Grep: 'Grep',
}

// Single-character icon for the tool family. Renders fast, no SVG.
const TOOL_ICONS: Record<string, string> = {
  bash: '$', Bash: '$',
  read_file: '◈', Read: '◈',
  write_file: '✎', Write: '✎',
  edit_file: '✎', Edit: '✎',
  list_files: '☰',
  glob: '✦', Glob: '✦',
  grep: '⌕', Grep: '⌕',
  lint_file: '✓',
  device_info: 'ⓘ',
  remember: '✱',
  recall: '⌕',
  update_memory_block: '✎',
  append_memory_block: '+',
  list_facts: '☰',
  get_memory_block: '◈',
}

function basename(p: string): string {
  if (!p) return ''
  const parts = p.split('/')
  return parts[parts.length - 1] || p
}

function countLines(s: string | undefined): number {
  if (!s) return 0
  // Don't count a trailing empty line.
  const trimmed = s.endsWith('\n') ? s.slice(0, -1) : s
  return trimmed.split('\n').length
}

function getToolSummary(tc: ToolCall): string {
  const label = TOOL_LABELS[tc.name] || tc.name
  if (tc.name === 'bash' || tc.name === 'Bash') {
    const cmd = tc.args?.command || ''
    const short = cmd.length > 80 ? cmd.slice(0, 77) + '...' : cmd
    return `${label}  $ ${short}`
  }
  if (tc.name === 'read_file' || tc.name === 'Read') {
    const path = tc.args?.path || tc.args?.file_path || ''
    const lines = countLines(tc.output)
    return `${label}  ${basename(path)}${lines ? `  (${lines} lines)` : ''}`
  }
  if (tc.name === 'write_file' || tc.name === 'Write') {
    const path = tc.args?.path || tc.args?.file_path || ''
    const lines = countLines(tc.args?.content)
    return `${label}  ${basename(path)}${lines ? `  +${lines} lines` : ''}`
  }
  if (tc.name === 'Edit') {
    const path = tc.args?.file_path || ''
    const newLines = countLines(tc.args?.new_string)
    const oldLines = countLines(tc.args?.old_string)
    const delta = newLines - oldLines
    const sign = delta >= 0 ? '+' : ''
    return `${label}  ${basename(path)}  ${sign}${delta} lines`
  }
  if (tc.name === 'search' || tc.name === 'Grep') {
    const lines = countLines(tc.output)
    return `${label}  /${tc.args?.pattern || ''}/${lines ? `  (${lines} matches)` : ''}`
  }
  if (tc.name === 'list_files' || tc.name === 'Glob') {
    return `${label}  ${tc.args?.path || tc.args?.pattern || '.'}`
  }
  // MCP tools
  if (tc.name.startsWith('mcp__')) {
    const short = tc.name.split('__').pop() || tc.name
    return short.replace(/_/g, ' ')
  }
  return label
}

/** True for edit_file / write_file (and their Claude Code Edit/Write aliases). */
function isFileMutation(name: string): 'edit' | 'write' | null {
  if (name === 'edit_file' || name === 'Edit') return 'edit'
  if (name === 'write_file' || name === 'Write') return 'write'
  return null
}

/** Best-effort: did the tool result indicate success?
 *  daemon.mjs returns {ok: true|false, ...}; the agent loop usually JSON-stringifies it. */
function resultLooksOk(output: string | undefined): boolean {
  if (!output) return true // mid-stream — assume ok
  if (/^\s*Error[: ]/i.test(output)) return false
  // Try to parse JSON; fall back to true if it doesn't parse.
  try {
    const parsed = JSON.parse(output)
    if (parsed && typeof parsed === 'object' && 'ok' in parsed) return parsed.ok !== false
  } catch {
    // not JSON, leave as ok
  }
  return true
}

function inferStatus(tc: ToolCall): 'running' | 'done' | 'error' {
  if (tc.status) return tc.status
  if (!tc.output) return 'running'
  if (typeof tc.output === 'string' && /^\s*Error[: ]|^\{.*"ok"\s*:\s*false/i.test(tc.output)) return 'error'
  return 'done'
}

const STATUS_DOT = {
  running: 'bg-amber-400 animate-pulse',
  done: 'bg-emerald-500',
  error: 'bg-red-500',
}

export function ToolCallBlock({ toolCall }: { toolCall: ToolCall }) {
  const [expanded, setExpanded] = useState(false)
  const summary = getToolSummary(toolCall)
  const status = inferStatus(toolCall)
  const hasOutput = !!toolCall.output
  const icon = TOOL_ICONS[toolCall.name] || '•'

  // Detect file-mutation tools and prep the before/after for DiffView.
  const mutation = isFileMutation(toolCall.name)
  const mutationOk = mutation ? resultLooksOk(toolCall.output) : false
  let diff: { before: string; after: string; path?: string; isNewFile: boolean } | null = null
  if (mutation && mutationOk) {
    if (mutation === 'edit') {
      // edit_file args carry the exact replaced spans — diff those directly.
      const before = String(toolCall.args?.old_string ?? '')
      const after = String(toolCall.args?.new_string ?? '')
      const path = String(toolCall.args?.path || toolCall.args?.file_path || '')
      if (before || after) diff = { before, after, path, isNewFile: false }
    } else if (mutation === 'write') {
      // write_file always sends the full content. Treat as "(new file)" — we don't
      // have the prior content here, and even when overwriting an existing file
      // showing the new content as additions is the most truthful render.
      const after = String(toolCall.args?.content ?? '')
      const path = String(toolCall.args?.path || toolCall.args?.file_path || '')
      if (after) diff = { before: '', after, path, isNewFile: true }
    }
  }

  return (
    <div className={`my-1.5 rounded-lg border overflow-hidden text-xs ${
      status === 'error' ? 'border-red-900/50 bg-[#1a0f0f]' :
      status === 'running' ? 'border-amber-900/40 bg-[#161310]' :
      'border-[#252525] bg-[#0f0f0f]'
    }`}>
      {/* Collapsed header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-[#151515] transition-colors"
      >
        {/* Status dot — live indicator */}
        <span className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${STATUS_DOT[status]}`} />

        {/* Tool icon */}
        <span className="text-[#666] font-mono shrink-0 w-3 text-center">{icon}</span>

        {/* Expand chevron */}
        <svg
          width="10"
          height="10"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#444"
          strokeWidth="2"
          className={`shrink-0 transition-transform ${expanded ? 'rotate-90' : ''}`}
        >
          <polyline points="9 18 15 12 9 6" />
        </svg>

        {/* Summary line */}
        <span className={`font-mono truncate ${
          status === 'error' ? 'text-red-300' :
          status === 'running' ? 'text-amber-200' :
          'text-[#888]'
        }`}>{summary}</span>

        {/* Right-side metadata: device, duration, output line count */}
        <span className="ml-auto flex items-center gap-2 shrink-0">
          {toolCall.device_id && (
            <span className="text-[9px] text-[#555] font-mono">{toolCall.device_id.split('-')[0]}</span>
          )}
          {toolCall.duration_ms != null && (
            <span className="text-[9px] text-[#555]">{Math.round(toolCall.duration_ms)}ms</span>
          )}
          {hasOutput && (
            <span className="text-[10px] text-[#444]">
              {toolCall.output!.split('\n').length} lines
            </span>
          )}
        </span>
      </button>

      {/* Expanded content */}
      {expanded && (
        <div className="border-t border-[#1a1a1a]">
          {/* Args */}
          {Object.keys(toolCall.args).length > 0 && (
            <div className="px-3 py-2 border-b border-[#1a1a1a]">
              <div className="text-[10px] text-[#555] mb-1 uppercase tracking-wider">Input</div>
              <pre className="text-[#999] font-mono whitespace-pre-wrap break-all text-[11px] max-h-40 overflow-y-auto">
                {Object.entries(toolCall.args).map(([k, v]) => {
                  const val = typeof v === 'string' ? v : JSON.stringify(v)
                  // Truncate long values
                  const display = val.length > 500 ? val.slice(0, 497) + '...' : val
                  return `${k}: ${display}`
                }).join('\n')}
              </pre>
            </div>
          )}

          {/* Inline diff for edit_file / write_file */}
          {diff && (
            <div className="px-3 py-2 border-b border-[#1a1a1a]">
              <div className="text-[10px] text-[#555] mb-1 uppercase tracking-wider">Diff</div>
              <DiffView
                before={diff.before}
                after={diff.after}
                path={diff.path}
                isNewFile={diff.isNewFile}
              />
            </div>
          )}

          {/* Output */}
          {hasOutput && (
            <div className="px-3 py-2">
              <div className="text-[10px] text-[#555] mb-1 uppercase tracking-wider">Output</div>
              <pre className="text-[#aaa] font-mono whitespace-pre-wrap break-all text-[11px] max-h-60 overflow-y-auto">
                {toolCall.output}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
