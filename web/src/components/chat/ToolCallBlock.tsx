'use client'

import { useState } from 'react'

export interface ToolCall {
  id?: string
  name: string
  args: Record<string, any>
  output?: string
}

const TOOL_LABELS: Record<string, string> = {
  bash: 'Command',
  read_file: 'Read file',
  write_file: 'Write file',
  list_files: 'List files',
  search: 'Search',
  Bash: 'Command',
  Read: 'Read file',
  Write: 'Write file',
  Edit: 'Edit file',
  Glob: 'Find files',
  Grep: 'Search',
}

function getToolSummary(tc: ToolCall): string {
  const label = TOOL_LABELS[tc.name] || tc.name
  if (tc.name === 'bash' || tc.name === 'Bash') {
    const cmd = tc.args?.command || ''
    const short = cmd.length > 60 ? cmd.slice(0, 57) + '...' : cmd
    return `${label}: ${short}`
  }
  if (tc.name === 'read_file' || tc.name === 'Read') {
    return `${label}: ${tc.args?.path || tc.args?.file_path || ''}`
  }
  if (tc.name === 'write_file' || tc.name === 'Write') {
    return `${label}: ${tc.args?.path || tc.args?.file_path || ''}`
  }
  if (tc.name === 'search' || tc.name === 'Grep') {
    return `${label}: ${tc.args?.pattern || ''}`
  }
  if (tc.name === 'Edit') {
    return `${label}: ${tc.args?.file_path || ''}`
  }
  // MCP tools
  if (tc.name.startsWith('mcp__')) {
    const short = tc.name.split('__').pop() || tc.name
    return short.replace(/_/g, ' ')
  }
  return label
}

export function ToolCallBlock({ toolCall }: { toolCall: ToolCall }) {
  const [expanded, setExpanded] = useState(false)
  const summary = getToolSummary(toolCall)
  const hasOutput = !!toolCall.output

  return (
    <div className="my-1.5 rounded-lg border border-[#252525] bg-[#0f0f0f] overflow-hidden text-xs">
      {/* Collapsed header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-[#151515] transition-colors"
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#666"
          strokeWidth="2"
          className={`shrink-0 transition-transform ${expanded ? 'rotate-90' : ''}`}
        >
          <polyline points="9 18 15 12 9 6" />
        </svg>
        <span className="text-[#888] font-mono truncate">{summary}</span>
        {hasOutput && (
          <span className="ml-auto text-[10px] text-[#444] shrink-0">
            {toolCall.output!.split('\n').length} lines
          </span>
        )}
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
