'use client'

import { useMemo } from 'react'
import { ToolCallBlock, type ToolCall } from './ToolCallBlock'
import type { Message } from '@/store/chat'

// Simple markdown-like rendering (no heavy dependency needed)
function renderMarkdown(text: string): (string | React.ReactElement)[] {
  const parts: (string | React.ReactElement)[] = []
  let key = 0

  // Split by code blocks first
  const codeBlockRegex = /```(\w*)\n?([\s\S]*?)```/g
  let lastIndex = 0
  let match

  while ((match = codeBlockRegex.exec(text)) !== null) {
    // Text before code block
    if (match.index > lastIndex) {
      parts.push(...renderInlineMarkdown(text.slice(lastIndex, match.index), key))
      key += 100
    }

    // Code block
    const lang = match[1]
    const code = match[2].trimEnd()
    parts.push(
      <pre
        key={`code-${key++}`}
        className="my-2 rounded-lg bg-[#0a0a0a] border border-[#222] p-3 overflow-x-auto"
      >
        {lang && (
          <div className="text-[9px] text-[#555] uppercase tracking-wider mb-1.5">{lang}</div>
        )}
        <code className="text-[12px] text-[#ccc] font-mono whitespace-pre">{code}</code>
      </pre>
    )

    lastIndex = match.index + match[0].length
  }

  // Remaining text
  if (lastIndex < text.length) {
    parts.push(...renderInlineMarkdown(text.slice(lastIndex), key))
  }

  return parts
}

function renderInlineMarkdown(text: string, baseKey: number): (string | React.ReactElement)[] {
  const parts: (string | React.ReactElement)[] = []
  let key = baseKey

  // Split into lines and process
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i]

    // Headers
    if (line.startsWith('### ')) {
      parts.push(<h4 key={key++} className="text-[13px] font-semibold text-white mt-2 mb-1">{line.slice(4)}</h4>)
      continue
    }
    if (line.startsWith('## ')) {
      parts.push(<h3 key={key++} className="text-sm font-semibold text-white mt-2 mb-1">{line.slice(3)}</h3>)
      continue
    }
    if (line.startsWith('# ')) {
      parts.push(<h2 key={key++} className="text-[15px] font-bold text-white mt-2 mb-1">{line.slice(2)}</h2>)
      continue
    }

    // Bullet points
    if (line.match(/^[\s]*[-*]\s/)) {
      parts.push(
        <div key={key++} className="flex gap-1.5 ml-2">
          <span className="text-[#555] shrink-0">-</span>
          <span>{renderInlineText(line.replace(/^[\s]*[-*]\s/, ''))}</span>
        </div>
      )
      continue
    }

    // Regular text with inline formatting
    if (line.trim()) {
      parts.push(<span key={key++}>{renderInlineText(line)}</span>)
    }
    if (i < lines.length - 1) {
      parts.push(<br key={`br-${key++}`} />)
    }
  }

  return parts
}

// Vision §4.2 — file-in-chat clickable links. Detect tokens that
// look like absolute paths (or ~/foo) and render them as buttons that
// hit the local daemon device's loopback /open endpoint.
//
// We accept a path-like token if it:
//   - starts with "/" or "~/"
//   - has at least 2 path segments
//   - contains no whitespace, no shell metacharacters (>, |, &, ;)
//   - is between 6 and 400 characters
const PATH_TOKEN_RE = /^(?:~\/|\/)[A-Za-z0-9._\-/+@%~]{4,398}$/
const LOOPBACK_OPEN_URL = 'http://127.0.0.1:4810/open'

function looksLikePath(s: string): boolean {
  if (!s || s.length < 6 || s.length > 400) return false
  if (!PATH_TOKEN_RE.test(s)) return false
  // Must contain at least 2 slashes (so "/etc" alone doesn't match,
  // but /etc/hosts does)
  let slashes = 0
  for (let i = 0; i < s.length; i++) if (s[i] === '/') slashes++
  return slashes >= 2
}

function PathButton({ path, label }: { path: string; label?: string }): React.ReactElement {
  const display = label || (path.length > 60 ? '...' + path.slice(-57) : path)
  return (
    <a
      href="#"
      onClick={(e) => {
        e.preventDefault()
        // M-2 fix: POST + custom header so the server-side CORS
        // preflight is the gate. fetch() picks up the page's Origin
        // automatically, and the X-Daemon-Open header forces a
        // preflight that the loopback only honors when the Origin
        // matches the relay's allow-list.
        fetch(LOOPBACK_OPEN_URL, {
          method: 'POST',
          mode: 'cors',
          headers: {
            'Content-Type': 'application/json',
            'X-Daemon-Open': '1',
          },
          body: JSON.stringify({ path }),
        }).catch(() => {
          // Fall back to copying the path to clipboard so the user
          // can paste it into a terminal (e.g. when browsing from a
          // different machine than where the daemon device runs).
          if (navigator.clipboard) navigator.clipboard.writeText(path).catch(() => {})
        })
      }}
      className="inline-flex items-center gap-1 px-2 py-0.5 bg-[#1a1a1a] hover:bg-[#2a2a2a] border border-[#2a2a2a] hover:border-[#ff4a00] rounded text-[#ff8c5a] hover:text-[#ff4a00] text-[12px] font-mono transition-colors no-underline"
      title={`Open ${path} (locally on your daemon device)`}
    >
      <span style={{ fontSize: '10px' }}>📂</span>
      {display}
    </a>
  )
}

function renderInlineText(text: string): (string | React.ReactElement)[] {
  const parts: (string | React.ReactElement)[] = []
  let key = 0

  // Process inline code, bold, italic, and links
  const regex = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|https?:\/\/[^\s)]+)/g
  let lastIdx = 0
  let match

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIdx) {
      parts.push(text.slice(lastIdx, match.index))
    }

    const token = match[0]
    if (token.startsWith('`') && token.endsWith('`')) {
      // Inline code — but if the contents look like a file path,
      // promote to a clickable PathButton instead.
      const inner = token.slice(1, -1)
      if (looksLikePath(inner)) {
        parts.push(<PathButton key={`pb-${key++}`} path={inner} />)
      } else {
        parts.push(
          <code key={`ic-${key++}`} className="px-1 py-0.5 bg-[#1a1a1a] rounded text-[#e8a0bf] text-[12px] font-mono">
            {inner}
          </code>
        )
      }
    } else if (token.startsWith('**') && token.endsWith('**')) {
      parts.push(<strong key={`b-${key++}`} className="text-white font-semibold">{token.slice(2, -2)}</strong>)
    } else if (token.startsWith('*') && token.endsWith('*')) {
      parts.push(<em key={`i-${key++}`}>{token.slice(1, -1)}</em>)
    } else if (token.startsWith('http')) {
      // URL
      parts.push(
        <a
          key={`a-${key++}`}
          href={token}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[#ff4a00] underline underline-offset-2 hover:text-[#ff6a30]"
        >
          {token.length > 50 ? token.slice(0, 47) + '...' : token}
        </a>
      )
    }

    lastIdx = match.index + match[0].length
  }

  if (lastIdx < text.length) {
    parts.push(text.slice(lastIdx))
  }

  return parts
}

// Parse tool calls from message metadata
function parseToolCalls(message: Message): ToolCall[] {
  if (!(message as any).toolCalls) return []
  try {
    const calls = typeof (message as any).toolCalls === 'string'
      ? JSON.parse((message as any).toolCalls)
      : (message as any).toolCalls
    return Array.isArray(calls)
      ? calls.map((tc: any) => ({
          id: tc.id,
          name: tc.tool || tc.name,
          args: tc.args || tc.input || {},
          output: tc.result || tc.output,
        }))
      : []
  } catch {
    return []
  }
}

interface MessageBubbleProps {
  message: Message
  /** Inline tool calls received via streaming (not yet in message.toolCalls) */
  streamingToolCalls?: ToolCall[]
  /** When false, hide bash/edit/read blocks behind a compact pill. Default true. */
  showToolDetails?: boolean
}

export function MessageBubble({ message, streamingToolCalls, showToolDetails = true }: MessageBubbleProps) {
  const isUser = message.role === 'user'
  const isSystem = message.role === 'system'
  const toolCalls = useMemo(() => {
    const parsed = parseToolCalls(message)
    return parsed.length > 0 ? parsed : (streamingToolCalls || [])
  }, [message, streamingToolCalls])

  if (isSystem) {
    return (
      <div className="flex justify-center mb-2.5">
        <div className="max-w-[85%] rounded-xl px-3 py-1.5 text-[11px] text-[#666] bg-[#111] border border-[#1a1a1a]">
          {message.content}
        </div>
      </div>
    )
  }

  if (isUser) {
    return (
      <div className="flex justify-end mb-2.5">
        <div className="max-w-[85%] sm:max-w-[70%] rounded-2xl px-4 py-2.5 text-[13px] leading-relaxed bg-[#ff0505] text-white overflow-hidden">
          <p className="whitespace-pre-wrap break-all">{message.content}</p>
        </div>
      </div>
    )
  }

  // Assistant / daemon message
  const isErrorMessage = !!(message as any).isError
  return (
    <div className="flex justify-start mb-2.5">
      <div className={`max-w-[85%] sm:max-w-[70%] rounded-2xl px-4 py-2.5 text-[13px] leading-relaxed border overflow-hidden ${
        isErrorMessage
          ? 'bg-[#2a1010] text-[#ff8888] border-[#4a2020]'
          : 'bg-[#181818] text-[#ddd] border-[#252525]'
      }`}>
        {/* Error icon for error messages */}
        {isErrorMessage && (
          <div className="flex items-center gap-1.5 mb-1.5 text-[#ff6666]">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10"/>
              <line x1="12" y1="8" x2="12" y2="12"/>
              <line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
            <span className="text-[11px] font-medium uppercase tracking-wider">Error</span>
          </div>
        )}

        {/* Tool calls rendered inline before the text response */}
        {toolCalls.length > 0 && showToolDetails && (
          <div className="mb-2">
            {toolCalls.map((tc, i) => (
              <ToolCallBlock key={tc.id || `tc-${i}`} toolCall={tc} />
            ))}
          </div>
        )}
        {toolCalls.length > 0 && !showToolDetails && (
          <div className="mb-2 text-[10px] text-[#555] italic">
            {toolCalls.length} tool call{toolCalls.length === 1 ? '' : 's'} hidden
            {' · '}
            {toolCalls
              .slice(0, 4)
              .map(tc => tc.name)
              .join(', ')}
            {toolCalls.length > 4 ? '...' : ''}
          </div>
        )}

        {/* Message content with markdown rendering */}
        <div className="whitespace-pre-wrap break-all overflow-hidden">
          {renderMarkdown(message.content)}
        </div>
      </div>
    </div>
  )
}
