'use client'

// SLICE-B: @-mention popover. Shown above the chat textarea when the user
// types `@<token>`. Mirrors the slash-menu structure in chat/page.tsx
// (L827-858) — same Tailwind classes, no emojis, monospace path.

import { useEffect, useRef } from 'react'

interface AtMentionMenuProps {
  matches: string[]
  selectedIndex: number
  onSelect: (path: string) => void
  onHover: (index: number) => void
}

export function AtMentionMenu({ matches, selectedIndex, onSelect, onHover }: AtMentionMenuProps) {
  const containerRef = useRef<HTMLDivElement>(null)

  // Keep selected item in view when arrow-keying through a long list.
  useEffect(() => {
    const el = containerRef.current?.querySelector(`[data-mention-idx="${selectedIndex}"]`) as HTMLElement | null
    el?.scrollIntoView({ block: 'nearest' })
  }, [selectedIndex])

  if (matches.length === 0) {
    return (
      <div className="absolute bottom-full left-0 right-0 px-3 pb-1">
        <div className="max-w-2xl mx-auto bg-[#161616] border border-[#282828] rounded-xl overflow-hidden shadow-xl">
          <div className="px-3 py-2 text-[10px] text-[#555]">no matching files</div>
        </div>
      </div>
    )
  }

  return (
    <div className="absolute bottom-full left-0 right-0 px-3 pb-1">
      <div
        ref={containerRef}
        className="max-w-2xl mx-auto bg-[#161616] border border-[#282828] rounded-xl overflow-hidden shadow-xl max-h-64 overflow-y-auto"
      >
        {matches.map((path, i) => {
          const slash = path.lastIndexOf('/')
          const name = slash >= 0 ? path.slice(slash + 1) : path
          const dir = slash >= 0 ? path.slice(0, slash + 1) : ''
          const active = i === selectedIndex
          return (
            <button
              key={path}
              data-mention-idx={i}
              onMouseEnter={() => onHover(i)}
              onClick={() => onSelect(path)}
              className={`w-full flex items-center gap-3 px-3 py-2 min-h-[36px] text-left transition-colors ${
                active ? 'bg-[#1a1a1a]' : 'hover:bg-[#1a1a1a]'
              } ${i === 0 ? '' : 'border-t border-[#222]'}`}
            >
              <span className="text-xs text-white font-mono truncate">{name}</span>
              {dir && <span className="text-[10px] text-[#666] font-mono truncate">{dir}</span>}
            </button>
          )
        })}
      </div>
    </div>
  )
}
