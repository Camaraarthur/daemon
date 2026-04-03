'use client'

interface ActivityIndicatorProps {
  status: string
  active: boolean
}

const STATUS_LABELS: Record<string, string> = {
  bash: 'Running command...',
  Bash: 'Running command...',
  read_file: 'Reading file...',
  Read: 'Reading file...',
  write_file: 'Writing file...',
  Write: 'Writing file...',
  Edit: 'Editing file...',
  list_files: 'Listing files...',
  Glob: 'Finding files...',
  search: 'Searching...',
  Grep: 'Searching...',
}

export function ActivityIndicator({ status, active }: ActivityIndicatorProps) {
  if (!active && !status) return null

  // Map tool names to readable labels
  const display = STATUS_LABELS[status] || status || 'Thinking...'

  return (
    <div className="flex items-center gap-2 px-1 mb-2.5">
      {active ? (
        <>
          <div className="flex gap-1">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="w-1.5 h-1.5 rounded-full animate-bounce"
                style={{
                  animationDelay: `${i * 0.15}s`,
                  backgroundColor: '#ff4a00',
                }}
              />
            ))}
          </div>
          <span className="text-[10px] text-[#ff4a00] font-mono">{display}</span>
        </>
      ) : (
        <span className="text-[10px] text-[#444] font-mono">{display}</span>
      )}
    </div>
  )
}
