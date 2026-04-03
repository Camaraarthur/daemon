'use client'

import { useEffect, useMemo, useState } from 'react'
import { useProjectsStore, Project, Thread } from '@/store/projects'

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
  let color = 'bg-[#333]'
  if (project.service_name) {
    color = 'bg-green-500'
  } else if (project.local_path) {
    color = 'bg-yellow-500'
  }
  return <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${color}`} />
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
      <StatusDot project={project} />
      <span className={`text-[11px] truncate flex-1 ${isActive ? 'text-white' : 'text-[#777]'}`}>
        {project.display_name || project.name}
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
}) {
  const hasChildren = children.length > 0
  const [editing, setEditing] = useState(false)
  const [editName, setEditName] = useState(project.display_name || project.name)

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
              {project.display_name || project.name}
            </span>
          )}
          {/* Edit pencil — visible on hover */}
          {!editing && (
            <button
              onClick={(e) => { e.stopPropagation(); setEditName(project.display_name || project.name); setEditing(true) }}
              className="opacity-0 group-hover:opacity-100 text-[#444] hover:text-[#888] transition-all shrink-0"
              title="Rename"
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
              </svg>
            </button>
          )}
          {project.last_active && !editing && (
            <span className="text-[9px] text-[#333] shrink-0">{timeAgo(project.last_active)}</span>
          )}
        </div>
      </div>

      {/* Expanded: sub-projects + history */}
      {isExpanded && (
        <div className="ml-4 border-l border-[#1a1a1a] pl-1">
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

  const [showNewProject, setShowNewProject] = useState(false)

  useEffect(() => {
    fetchProjects()
  }, [fetchProjects])

  // Group projects: top-level (no parent_id) and children
  const { topLevel, childrenMap } = useMemo(() => {
    const childrenMap: Record<number, Project[]> = {}
    const topLevel: Project[] = []

    for (const p of projects) {
      if (p.parent_id) {
        if (!childrenMap[p.parent_id]) childrenMap[p.parent_id] = []
        childrenMap[p.parent_id].push(p)
      } else {
        topLevel.push(p)
      }
    }

    // Sort top-level by last_active DESC
    topLevel.sort((a, b) => {
      if (!a.last_active) return 1
      if (!b.last_active) return -1
      return b.last_active.localeCompare(a.last_active)
    })

    // Sort children by last_active
    for (const arr of Object.values(childrenMap)) {
      arr.sort((a, b) => {
        if (!a.last_active) return 1
        if (!b.last_active) return -1
        return b.last_active.localeCompare(a.last_active)
      })
    }

    return { topLevel, childrenMap }
  }, [projects])

  const handleSelectProject = (projectId: number) => {
    const wasActive = activeProjectId === projectId
    setActiveProject(projectId)
    setActiveThread(null) // clear any thread selection — show merged timeline
    fetchProjectMessages(projectId)
    // If selecting a new project, ensure it's expanded. If re-clicking active project, toggle.
    const isCurrentlyExpanded = expandedProjects.includes(projectId)
    if (wasActive || !isCurrentlyExpanded) {
      toggleProject(projectId)
    }
    onClose?.()
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
  const [devices, setDevices] = useState<Array<{ id: string; name: string; platform: string; status: string }>>([])

  useEffect(() => {
    fetch('/api/devices')
      .then(r => r.json())
      .then(d => {
        if (d.devices) {
          setDevices(d.devices.map((dev: any) => ({
            id: dev.id,
            name: dev.name,
            platform: dev.platform,
            status: dev.status,
          })))
        }
      })
      .catch(() => {})
  }, [])

  return (
    <div className="flex flex-col h-full bg-[#111]">
      {/* Header */}
      <div className="p-3 border-b border-[#222] flex items-center justify-between shrink-0">
        <span className="text-[10px] font-semibold text-[#555] uppercase tracking-widest">Projects</span>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowNewProject(!showNewProject)}
            className="text-[#555] hover:text-[#ff0505] transition-colors"
            title="New project"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>
          {onClose && (
            <button onClick={onClose} className="sm:hidden text-[#555] hover:text-white text-sm">
              &times;
            </button>
          )}
        </div>
      </div>

      {/* New project form */}
      {showNewProject && (
        <NewProjectForm
          onCreated={() => setShowNewProject(false)}
          onCreate={storeCreateProject}
        />
      )}

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
            />
          ))
        )}
      </div>

      {/* Devices section */}
      {devices.length > 0 && (
        <div className="border-t border-[#222] px-3 py-2 shrink-0">
          <div className="text-[10px] font-semibold text-[#555] uppercase tracking-widest mb-2">Devices</div>
          {devices.map(d => (
            <div key={d.id} className="flex items-center gap-2 py-1">
              <div className={`w-1.5 h-1.5 rounded-full ${d.status === 'online' ? 'bg-green-500' : 'bg-[#333]'}`} />
              <span className="text-[11px] text-[#888]">{d.name}</span>
              <span className="text-[9px] text-[#444]">({d.platform})</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
