'use client'

import { useMemo, useState } from 'react'
import { diffLines } from 'diff'

export interface DiffViewProps {
  /** Original text. Use empty string for new files. */
  before: string
  /** New text after the change. */
  after: string
  /** Optional path label rendered as a tiny header. */
  path?: string
  /** Mark this as a brand-new file (renders "(new file)" header, all additions). */
  isNewFile?: boolean
  /** First N lines shown before "show more" toggle. Default 50. */
  collapseAt?: number
}

type Row = { kind: 'add' | 'del' | 'ctx'; text: string }

function buildRows(before: string, after: string, isNewFile: boolean): Row[] {
  if (isNewFile) {
    const lines = after.split('\n')
    // Strip trailing blank from a final newline so we don't render a phantom row.
    if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
    return lines.map((text) => ({ kind: 'add', text }))
  }
  const parts = diffLines(before, after)
  const rows: Row[] = []
  for (const part of parts) {
    const value = part.value
    const lines = value.split('\n')
    if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
    const kind: Row['kind'] = part.added ? 'add' : part.removed ? 'del' : 'ctx'
    for (const text of lines) rows.push({ kind, text })
  }
  return rows
}

export function DiffView({
  before,
  after,
  path,
  isNewFile = false,
  collapseAt = 50,
}: DiffViewProps) {
  const rows = useMemo(() => buildRows(before, after, isNewFile), [before, after, isNewFile])
  const [expanded, setExpanded] = useState(false)
  const total = rows.length
  const overflow = total > collapseAt
  const shown = expanded || !overflow ? rows : rows.slice(0, collapseAt)
  const hidden = overflow && !expanded ? total - collapseAt : 0

  const adds = rows.reduce((n, r) => n + (r.kind === 'add' ? 1 : 0), 0)
  const dels = rows.reduce((n, r) => n + (r.kind === 'del' ? 1 : 0), 0)

  return (
    <div className="rounded border border-[#1a1a1a] bg-[#0b0b0b] overflow-hidden font-mono text-[11px]">
      <div className="flex items-center gap-2 px-2 py-1 border-b border-[#1a1a1a] bg-[#0f0f0f] text-[10px] text-[#666]">
        {isNewFile ? (
          <span className="text-emerald-400">(new file)</span>
        ) : (
          <span className="text-[#888]">diff</span>
        )}
        {path && <span className="truncate text-[#999]">{path}</span>}
        <span className="ml-auto flex items-center gap-2">
          {adds > 0 && <span className="text-emerald-400">+{adds}</span>}
          {dels > 0 && <span className="text-red-400">-{dels}</span>}
        </span>
      </div>
      <div className="max-h-[480px] overflow-y-auto">
        {shown.map((r, i) => (
          <div
            key={i}
            className={
              r.kind === 'add'
                ? 'flex bg-emerald-950/40 text-emerald-200'
                : r.kind === 'del'
                ? 'flex bg-red-950/40 text-red-200'
                : 'flex text-[#888]'
            }
          >
            <span
              className={
                'w-4 shrink-0 text-center select-none ' +
                (r.kind === 'add'
                  ? 'text-emerald-500'
                  : r.kind === 'del'
                  ? 'text-red-500'
                  : 'text-[#444]')
              }
            >
              {r.kind === 'add' ? '+' : r.kind === 'del' ? '-' : ' '}
            </span>
            <pre className="whitespace-pre-wrap break-all flex-1 pr-2">{r.text || ' '}</pre>
          </div>
        ))}
        {hidden > 0 && (
          <button
            onClick={() => setExpanded(true)}
            className="w-full text-left px-3 py-1.5 text-[10px] text-[#888] hover:text-[#ccc] hover:bg-[#151515] border-t border-[#1a1a1a]"
          >
            show {hidden} more {hidden === 1 ? 'line' : 'lines'}
          </button>
        )}
      </div>
    </div>
  )
}
