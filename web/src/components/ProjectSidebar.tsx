'use client'

import { useEffect, useMemo, useState } from 'react'
import { useProjectsStore, Project, Thread } from '@/store/projects'

/**
 * Resolve the human-visible project label. Projects can be created
 * without a name (UX: click "+" → immediately ready); in that case
 * the backend gives them an internal slug like "untitled-abc123".
 * We show a clean "Untitled" placeholder until the user renames or
 * auto-titling fills in display_name.
 */
function projectLabel(project: Project): string {
  // If the name is an auto-slug (untitled-xxxx) we always show "Untitled",
  // even if display_name was filled in with the slug itself (legacy bug).
  // The real test: name starts with "untitled-" AND display_name either
  // is empty or equals the name.
  if (project.name && project.name.startsWith('untitled-')) {
    if (!project.display_name || project.display_name === project.name) {
      return 'Untitled'
    }
  }
  if (project.display_name && project.display_name.trim()) {
    return project.display_name
  }
  return project.name || 'Untitled'
}

/**
 * Quick-access nav for the live canvas + the public daemon page.
 * Shown at the very top of the sidebar so phone users can jump
 * between "what the agent is doing right now" (canvas), the
 * persistent shareable surface (public page), and chat without
 * fishing for URLs.
 */
function SurfaceNav() {
  const [daemonName, setDaemonName] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    fetch('/api/me')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (alive && d?.daemon_name) setDaemonName(d.daemon_name) })
      .catch(() => {})
    return () => { alive = false }
  }, [])

  // Public page lives at <daemon_name>.daemon.page; from inside any
  // hosted Next route we link to "/" on that subdomain. Fall back to
  // the relative root if we don't know the name yet.
  const publicHref = daemonName ? `https://${daemonName}.daemon.page/` : '/'

  return (
    <div className="px-2 pt-2 pb-1 border-b border-[#222] shrink-0 flex gap-1">
      <a
        href="/canvas"
        className="flex-1 text-center text-[11px] text-[#999] hover:text-white bg-[#1a1a1a] hover:bg-[#222] py-1.5 rounded transition-colors"
        title="Live agent surface"
      >
        canvas
      </a>
      <a
        href={publicHref}
        target={daemonName ? '_blank' : undefined}
        rel="noreferrer"
        className="flex-1 text-center text-[11px] text-[#999] hover:text-white bg-[#1a1a1a] hover:bg-[#222] py-1.5 rounded transition-colors"
        title="Public page"
      >
        page
      </a>
      <a
        href="/chat"
        className="flex-1 text-center text-[11px] text-[#999] hover:text-white bg-[#1a1a1a] hover:bg-[#222] py-1.5 rounded transition-colors"
        title="Chat"
      >
        chat
      </a>
      <a
        href="/files"
        className="flex-1 text-center text-[11px] text-[#999] hover:text-white bg-[#1a1a1a] hover:bg-[#222] py-1.5 rounded transition-colors"
        title="Drop / read text files across devices"
      >
        files
      </a>
    </div>
  )
}

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return ''
  const now = Date.now()
  const then = new Date(dateStr).getTime()
  const diff = now - then
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'now'
  if (mins < 60) return `${mins}m`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h`
  const days = Math.floor(hrs / 24)
  if (days < 30) return `${days}d`
  const months = Math.floor(days / 30)
  return `${months}mo`
}

function StatusDot({ project }: { project: Project }) {
  // Only show a dot when the project has an actively running service.
  // The "has local_path" yellow dot was confusing — most projects have
  // a path, the dot doesn't tell the user anything actionable.
  if (!project.service_name) return null
  return <div className="w-1.5 h-1.5 rounded-full shrink-0 bg-green-500" />
}

function HistoryExpander({
  threads,
  projectId,
  activeThreadId,
  onSelectThread,
}: {
  threads: Thread[] | undefined
  projectId: number
  activeThreadId: string | null
  onSelectThread: (threadId: string, projectId: number) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const count = threads?.length || 0

  if (count === 0) return null

  return (
    <div className="mt-1">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1 px-2 py-0.5 text-[10px] text-[#555] hover:text-[#888] transition-colors"
      >
        <svg
          width="8"
          height="8"
          viewBox="0 0 10 10"
          className={`shrink-0 transition-transform ${expanded ? 'rotate-90' : ''}`}
        >
          <path d="M3 1l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.5" />
        </svg>
        <span>History ({count})</span>
      </button>
      {expanded && threads && (
        <div className="ml-3 mt-0.5 border-l border-[#1a1a1a] pl-1">
          {threads.map((t) => (
            <button
              key={t.id}
              onClick={() => onSelectThread(t.id, projectId)}
              className={`w-full text-left px-2 py-1 text-[10px] truncate rounded transition-colors ${
                activeThreadId === t.id
                  ? 'bg-[#ff0505]/10 text-[#ff0505]'
                  : 'text-[#555] hover:bg-[#1a1a1a] hover:text-[#777]'
              }`}
            >
              <span className="truncate">{t.title || 'Untitled'}</span>
              {t.last_message_at && (
                <span className="text-[9px] text-[#333] ml-1">{timeAgo(t.last_message_at)}</span>
              )}
              {t.message_count !== undefined && (
                <span className="text-[9px] text-[#333] ml-1">({t.message_count})</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function SubProject({
  project,
  activeProjectId,
  onSelectProject,
}: {
  project: Project
  activeProjectId: number | null
  onSelectProject: (projectId: number) => void
}) {
  const isActive = activeProjectId === project.id

  return (
    <button
      onClick={() => onSelectProject(project.id)}
      className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left transition-colors ${
        isActive ? 'bg-[#1a1a1a]' : 'hover:bg-[#151515]'
      }`}
    >
      {/* Corner glyph so sub-projects read as visually nested, not just indented */}
      <span className="text-[#444] text-[10px] font-mono shrink-0 select-none">└</span>
      <StatusDot project={project} />
      <span className={`text-[11px] truncate flex-1 ${isActive ? 'text-white' : 'text-[#9a9a9a]'}`}>
        {projectLabel(project)}
      </span>
    </button>
  )
}

function ProjectGroup({
  project,
  children,
  threads,
  isExpanded,
  isActive,
  activeProjectId,
  activeThreadId,
  onToggle,
  onSelectProject,
  onSelectThread,
  onRename,
  onArchive,
  onSetParent,
  allProjects,
}: {
  project: Project
  children: Project[]
  threads: Thread[] | undefined
  isExpanded: boolean
  isActive: boolean
  activeProjectId: number | null
  activeThreadId: string | null
  onToggle: () => void
  onSelectProject: (projectId: number) => void
  onSelectThread: (threadId: string, projectId: number) => void
  onRename: (projectId: number, newName: string) => void
  onArchive?: (projectId: number) => void
  onSetParent?: (projectId: number, parentId: number | null) => void
  allProjects?: Project[]
}) {
  const hasChildren = children.length > 0
  const [editing, setEditing] = useState(false)
  const [pickingParent, setPickingParent] = useState(false)
  const [editName, setEditName] = useState(
    projectLabel(project) === 'Untitled' ? '' : projectLabel(project),
  )

  return (
    <div className="mb-0.5">
      {/* Project header — click to select + expand */}
      <div
        onClick={() => !editing && onSelectProject(project.id)}
        className={`w-full flex items-center gap-2 px-2 py-2 rounded-lg text-left transition-colors group cursor-pointer ${
          isActive ? 'bg-[#1a1a1a]' : 'hover:bg-[#151515]'
        }`}
      >
        {/* Chevron */}
        <div className="shrink-0 p-0.5">
          <svg
            width="10"
            height="10"
            viewBox="0 0 10 10"
            className={`text-[#444] transition-transform ${isExpanded ? 'rotate-90' : ''}`}
          >
            <path d="M3 1l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.5" />
          </svg>
        </div>
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <StatusDot project={project} />
          {editing ? (
            <input
              autoFocus
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              onBlur={() => { onRename(project.id, editName); setEditing(false) }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { onRename(project.id, editName); setEditing(false) }
                if (e.key === 'Escape') setEditing(false)
              }}
              onClick={(e) => e.stopPropagation()}
              className="text-xs bg-[#222] text-white border border-[#444] rounded px-1 py-0.5 flex-1 min-w-0 outline-none focus:border-[#ff0505]"
            />
          ) : (
            <span className={`text-xs truncate flex-1 ${isActive ? 'text-white font-medium' : 'text-[#aaa]'}`}>
              {projectLabel(project)}
            </span>
          )}
          {/* Edit pencil — visible on hover */}
          {!editing && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                const current = projectLabel(project)
                setEditName(current === 'Untitled' ? '' : current)
                setEditing(true)
              }}
              className="opacity-0 group-hover:opacity-100 text-[#444] hover:text-[#888] transition-all shrink-0"
              title="Rename"
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
              </svg>
            </button>
          )}
          {/* Move under parent — visible on hover. Opens an inline <select>
               of top-level projects (excluding self and descendants). */}
          {!editing && onSetParent && allProjects && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                setPickingParent(true)
              }}
              className="opacity-0 group-hover:opacity-100 text-[#444] hover:text-[#888] transition-all shrink-0"
              title={project.parent_id ? 'Change / remove parent' : 'Move under a project'}
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                {/* folder-tree-ish icon */}
                <path d="M3 7h6l2 2h10v10H3V7z" />
                <line x1="7" y1="12" x2="17" y2="12" />
              </svg>
            </button>
          )}
          {/* Archive (soft delete) — visible on hover */}
          {!editing && onArchive && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                if (confirm(`Archive "${projectLabel(project)}"? Hidden from the sidebar but threads + history are kept.`)) {
                  onArchive(project.id)
                }
              }}
              className="opacity-0 group-hover:opacity-100 text-[#444] hover:text-[#ff0505] transition-all shrink-0"
              title="Archive (hide from sidebar)"
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          )}
          {/* Parent picker inline — opens below the row when the folder
              icon is clicked. Filters out self + descendants to prevent
              cycles. Pick "— none —" to make this project top-level. */}
          {pickingParent && onSetParent && allProjects && (
            <select
              autoFocus
              onClick={(e) => e.stopPropagation()}
              onBlur={() => setPickingParent(false)}
              onChange={(e) => {
                const v = e.target.value
                const newParent = v === '' ? null : parseInt(v, 10)
                onSetParent(project.id, newParent)
                setPickingParent(false)
              }}
              className="text-[10px] bg-[#222] text-white border border-[#444] rounded px-1 py-0.5 max-w-[120px]"
              defaultValue={project.parent_id ? String(project.parent_id) : ''}
            >
              <option value="">— top-level —</option>
              {allProjects
                .filter((p) => p.id !== project.id)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {projectLabel(p)}
                  </option>
                ))}
            </select>
          )}
          {project.last_active && !editing && (
            <span className="text-[9px] text-[#333] shrink-0">{timeAgo(project.last_active)}</span>
          )}
        </div>
      </div>

      {/* Expanded: sub-projects + history */}
      {isExpanded && (
        <div className="ml-4 border-l-2 border-[#2a2a2a] pl-2">
          {/* Sub-projects */}
          {hasChildren && (
            <div className="mt-0.5">
              {children.map((child) => (
                <SubProject
                  key={child.id}
                  project={child}
                  activeProjectId={activeProjectId}
                  onSelectProject={onSelectProject}
                />
              ))}
            </div>
          )}

          {/* Thread history — collapsed by default */}
          <HistoryExpander
            threads={threads}
            projectId={project.id}
            activeThreadId={activeThreadId}
            onSelectThread={onSelectThread}
          />
        </div>
      )}
    </div>
  )
}

function NewProjectForm({
  onCreated,
  onCreate,
}: {
  onCreated: () => void
  onCreate: (name: string, path?: string) => Promise<any>
}) {
  const [name, setName] = useState('')
  const [path, setPath] = useState('')
  const [creating, setCreating] = useState(false)

  const handleCreate = async () => {
    if (!name.trim() || creating) return
    setCreating(true)
    const project = await onCreate(name.trim(), path.trim() || undefined)
    setCreating(false)
    if (project) {
      setName('')
      setPath('')
      onCreated()
    }
  }

  return (
    <div className="px-2 py-2 border-b border-[#222] space-y-1.5">
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Project name"
        onKeyDown={(e) => { if (e.key === 'Enter') handleCreate() }}
        className="w-full px-2 py-1.5 bg-[#1a1a1a] border border-[#282828] rounded text-[11px] text-white placeholder-[#555] focus:outline-none focus:border-[#ff0505]/40"
        autoFocus
      />
      <input
        type="text"
        value={path}
        onChange={(e) => setPath(e.target.value)}
        placeholder="Path (optional)"
        onKeyDown={(e) => { if (e.key === 'Enter') handleCreate() }}
        className="w-full px-2 py-1.5 bg-[#1a1a1a] border border-[#282828] rounded text-[11px] text-white placeholder-[#555] focus:outline-none focus:border-[#ff0505]/40"
      />
      <button
        onClick={handleCreate}
        disabled={!name.trim() || creating}
        className="w-full py-1.5 bg-[#ff0505] text-white rounded text-[10px] font-medium hover:bg-[#dd0404] disabled:opacity-30 transition-colors"
      >
        {creating ? 'Creating...' : 'Create'}
      </button>
    </div>
  )
}

function PairingModal({ onClose }: { onClose: () => void }) {
  const [code, setCode] = useState<string | null>(null)
  const [expiresAt, setExpiresAt] = useState<number>(0)
  const [timeLeft, setTimeLeft] = useState(0)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const generateCode = async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/pair', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'generate' }),
      })
      const data = await res.json()
      if (data.error) {
        setError(data.error)
      } else {
        setCode(data.code)
        setExpiresAt(new Date(data.expiresAt).getTime())
      }
    } catch {
      setError('Failed to generate code')
    }
    setLoading(false)
  }

  // Auto-generate on mount
  useEffect(() => {
    generateCode()
  }, [])

  // Countdown timer
  useEffect(() => {
    if (!expiresAt) return
    const interval = setInterval(() => {
      const remaining = Math.max(0, Math.floor((expiresAt - Date.now()) / 1000))
      setTimeLeft(remaining)
      if (remaining <= 0) {
        setCode(null)
        clearInterval(interval)
      }
    }, 1000)
    return () => clearInterval(interval)
  }, [expiresAt])

  const mins = Math.floor(timeLeft / 60)
  const secs = timeLeft % 60

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-[#111] border border-[#222] rounded-2xl p-6 w-[380px] space-y-4 shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-white text-sm font-medium">Link a Device</h3>
          <button onClick={onClose} className="text-[#555] hover:text-white text-lg leading-none">&times;</button>
        </div>

        {error && <p className="text-[#ff0505] text-xs">{error}</p>}

        {code ? (
          <>
            <div className="text-center py-4">
              <div className="font-mono text-3xl tracking-[0.3em] text-white font-bold">{code}</div>
              <div className="text-[10px] text-[#555] mt-2">
                expires in {mins}:{secs.toString().padStart(2, '0')}
              </div>
            </div>

            <div className="space-y-3">
              <div className="bg-[#0a0a0a] border border-[#222] rounded-lg p-3">
                <div className="text-[10px] text-[#555] uppercase tracking-wider mb-1.5">macOS / Linux</div>
                <code className="text-[11px] text-[#aaa] break-all select-all">
                  curl -sSL daemon.page/install.sh | bash && daemon pair {code}
                </code>
              </div>
              <div className="bg-[#0a0a0a] border border-[#222] rounded-lg p-3">
                <div className="text-[10px] text-[#555] uppercase tracking-wider mb-1.5">Windows</div>
                <code className="text-[11px] text-[#aaa] break-all select-all">
                  daemon pair {code}
                </code>
              </div>
              <div className="bg-[#0a0a0a] border border-[#222] rounded-lg p-3">
                <div className="text-[10px] text-[#555] uppercase tracking-wider mb-1.5">Android</div>
                <span className="text-[11px] text-[#aaa]">
                  Enter code <span className="text-white font-mono">{code}</span> in the Daemon app
                </span>
              </div>
            </div>
          </>
        ) : (
          <div className="text-center py-6">
            <button
              onClick={generateCode}
              disabled={loading}
              className="px-4 py-2 bg-[#ff0505] text-white text-sm rounded-lg hover:bg-[#dd0404] disabled:opacity-50 transition-colors"
            >
              {loading ? 'Generating...' : 'Generate New Code'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

export default function ProjectSidebar({
  onClose,
}: {
  onClose?: () => void
}) {
  const {
    projects,
    threads,
    activeProjectId,
    activeThreadId,
    expandedProjects,
    loadingProjects,
    fetchProjects,
    fetchThreads,
    fetchMessages,
    fetchProjectMessages,
    setActiveProject,
    setActiveThread,
    toggleProject,
    createProject: storeCreateProject,
  } = useProjectsStore()

  // showNewProject / NewProjectForm removed — new projects are now
  // created in one click with an auto-generated name. The form
  // function is kept further up for future rename UI.

  useEffect(() => {
    fetchProjects()
  }, [fetchProjects])

  // Tree by parent_id. Projects with parent_id are nested under their
  // parent; everything else is top-level.
  const { topLevel, childrenMap } = useMemo(() => {
    const childrenMap: Record<number, Project[]> = {}
    const topLevel: Project[] = []
    for (const p of projects) {
      const parent = (p as any).parent_id
      if (parent && projects.some((q) => q.id === parent)) {
        ;(childrenMap[parent] ||= []).push(p)
      } else {
        topLevel.push(p)
      }
    }
    const byRecent = (a: Project, b: Project) => {
      if (!a.last_active) return 1
      if (!b.last_active) return -1
      return b.last_active.localeCompare(a.last_active)
    }
    topLevel.sort(byRecent)
    for (const k of Object.keys(childrenMap)) childrenMap[Number(k)].sort(byRecent)
    return { topLevel, childrenMap }
  }, [projects])

  const handleSelectProject = (projectId: number) => {
    // If the project has children (sub-projects), clicking it should ONLY
    // toggle the sub-project tree — don't load messages, don't close the
    // sidebar. The user clarified they use parent projects as grouping
    // folders (Daemon contains Daemon Firmware, Daemon Main, etc.), not
    // as chattable projects themselves. To chat in a project, click a
    // leaf (no children) or a thread under History.
    const children = childrenMap[projectId] || []
    if (children.length > 0) {
      toggleProject(projectId)
      return
    }

    const wasActive = activeProjectId === projectId
    setActiveProject(projectId)
    setActiveThread(null) // clear any thread selection — show merged timeline
    fetchProjectMessages(projectId)
    const isCurrentlyExpanded = expandedProjects.includes(projectId)
    if (wasActive || !isCurrentlyExpanded) {
      toggleProject(projectId)
    }
    // Sidebar NOTE: intentionally NOT calling onClose() here. Selecting
    // a project shouldn't collapse the sidebar — user loses context on
    // narrow windows. Only thread-select closes the sidebar.
  }

  const handleSelectThread = (threadId: string, projectId: number) => {
    setActiveProject(projectId)
    setActiveThread(threadId)
    fetchMessages(threadId)
    onClose?.()
  }

  const handleToggleProject = (projectId: number) => {
    toggleProject(projectId)
  }

  // Devices section
  const [devices, setDevices] = useState<Array<{ id: string; name: string; platform: string; status: string; token_id?: number }>>([])
  const [showPairing, setShowPairing] = useState(false)

  // Reorganize / auto-indexer state
  const [indexing, setIndexing] = useState(false)
  const [indexSummary, setIndexSummary] = useState<string | null>(null)

  const handleReorganize = async () => {
    if (indexing) return
    setIndexing(true)
    setIndexSummary(null)
    try {
      const res = await fetch('/api/admin/indexer/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dry: false }),
      })
      const data = await res.json()
      if (data?.summary) {
        const s = data.summary
        setIndexSummary(`${s.applied ?? 0} applied / ${s.classified ?? 0} classified`)
      } else if (data?.error) {
        setIndexSummary(`error: ${String(data.error).slice(0, 60)}`)
      } else {
        setIndexSummary('done')
      }
      // Refresh the sidebar so moved / renamed projects show up.
      fetchProjects()
    } catch (e: any) {
      setIndexSummary(`error: ${e?.message || 'failed'}`)
    } finally {
      setIndexing(false)
      setTimeout(() => setIndexSummary(null), 6000)
    }
  }

  const refreshDevices = () => {
    fetch('/api/devices')
      .then(r => r.json())
      .then(d => {
        if (d.devices) {
          setDevices(d.devices.map((dev: any) => ({
            id: dev.id,
            name: dev.name,
            platform: dev.platform,
            status: dev.status,
            token_id: dev.token_id,
          })))
        }
      })
      .catch(() => {})
  }

  const revokeDevice = async (tokenId: number) => {
    await fetch('/api/devices', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token_id: tokenId }),
    })
    refreshDevices()
  }

  useEffect(() => {
    refreshDevices()
  }, [])

  return (
    <div className="flex flex-col h-full bg-[#111]">
      {/* Surfaces — quick access to canvas + public page from anywhere */}
      <SurfaceNav />

      {/* Header */}
      <div className="p-3 border-b border-[#222] flex items-center justify-between shrink-0">
        <span className="text-[10px] font-semibold text-[#555] uppercase tracking-widest">Projects</span>
        <div className="flex items-center gap-2">
          <button
            onClick={async () => {
              // One-click new project. No name prompt — projects are
              // created with a generated placeholder name and the
              // display_name fills in over the first few messages via
              // auto-titling. Rename manually anytime by clicking the
              // project name in the sidebar.
              const created = await storeCreateProject('', undefined)
              if (created) {
                handleSelectProject(created.id)
              }
            }}
            className="text-[#555] hover:text-[#ff0505] transition-colors"
            title="New project"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>
          {onClose && (
            <button onClick={onClose} className="text-[#555] hover:text-white transition-colors" title="Collapse sidebar">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M11 19l-7-7 7-7" />
                <line x1="18" y1="4" x2="18" y2="20" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Project list */}
      <div className="flex-1 overflow-y-auto p-2">
        {loadingProjects ? (
          <div className="text-[10px] text-[#444] px-2 py-4 text-center">loading...</div>
        ) : topLevel.length === 0 ? (
          <div className="text-[10px] text-[#444] px-2 py-4 text-center">no projects</div>
        ) : (
          topLevel.map((project) => (
            <ProjectGroup
              key={project.id}
              project={project}
              children={childrenMap[project.id] || []}
              threads={threads[project.id]}
              isExpanded={expandedProjects.includes(project.id)}
              isActive={activeProjectId === project.id}
              activeProjectId={activeProjectId}
              activeThreadId={activeThreadId}
              onToggle={() => handleToggleProject(project.id)}
              onSelectProject={handleSelectProject}
              onSelectThread={handleSelectThread}
              onRename={async (id, name) => {
                await fetch('/api/projects', {
                  method: 'PUT',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ id, display_name: name }),
                })
                fetchProjects()
              }}
              onArchive={async (id) => {
                await fetch(`/api/projects/${id}/archive`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ archived: true }),
                })
                fetchProjects()
              }}
              onSetParent={async (id, parentId) => {
                await fetch(`/api/projects/${id}/parent`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ parent_id: parentId }),
                })
                fetchProjects()
              }}
              allProjects={projects}
            />
          ))
        )}
      </div>

      {/* Reorganize — runs the chat->project auto-indexer for orphan /
          untitled threads. Cheap Haiku classification, moves threads
          under the right parent project or renames the auto-untitled
          placeholder. */}
      <div className="border-t border-[#222] px-2 py-1.5 shrink-0">
        <button
          onClick={handleReorganize}
          disabled={indexing}
          className="w-full text-left text-[10px] text-[#555] hover:text-[#ff0505] disabled:opacity-40 transition-colors flex items-center gap-1.5 px-2 py-1 rounded hover:bg-[#151515]"
          title="Auto-classify untitled/orphan threads into the right project"
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
          </svg>
          <span className="flex-1">{indexing ? 'reorganizing…' : 'reorganize threads'}</span>
          {indexSummary && <span className="text-[9px] text-[#444]">{indexSummary}</span>}
        </button>
      </div>

      {/* Devices section */}
      <div className="border-t border-[#222] px-3 py-2 shrink-0">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] font-semibold text-[#555] uppercase tracking-widest">Devices</span>
          <button
            onClick={() => setShowPairing(true)}
            className="text-[10px] text-[#555] hover:text-[#ff0505] transition-colors"
            title="Link a device"
          >
            + link
          </button>
        </div>
        {devices.map(d => (
          <div key={d.id} className="flex items-center gap-2 py-1 group">
            <div className={`w-1.5 h-1.5 rounded-full ${d.status === 'online' ? 'bg-green-500' : 'bg-[#333]'}`} />
            <span className="text-[11px] text-[#888] flex-1 truncate">{d.name}</span>
            <span className="text-[9px] text-[#444]">{d.platform}</span>
            {d.token_id && (
              <button
                onClick={() => revokeDevice(d.token_id!)}
                className="opacity-0 group-hover:opacity-100 text-[9px] text-[#555] hover:text-[#ff0505] transition-all"
                title="Unlink device"
              >
                x
              </button>
            )}
          </div>
        ))}
        {devices.length === 0 && (
          <div className="text-[10px] text-[#444] py-1">no devices linked</div>
        )}
      </div>

      {/* Pairing Modal */}
      {showPairing && (
        <PairingModal onClose={() => { setShowPairing(false); refreshDevices() }} />
      )}
    </div>
  )
}
