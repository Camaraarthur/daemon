import { create } from 'zustand'

export interface Project {
  id: number
  name: string
  display_name: string | null
  local_path: string | null
  service_name: string | null
  domain: string | null
  last_active: string | null
  parent_id: number | null
  settings: string
}

export interface Thread {
  id: string
  project_id: number | null
  title: string
  created_at: string
  last_message_at: string | null
  message_count?: number
}

export interface ThreadMessage {
  id: string
  thread_id: string
  role: string
  content: string | null
  model: string | null
  created_at: string
  thread_title?: string
}

interface ProjectsState {
  projects: Project[]
  threads: Record<number, Thread[]> // keyed by project_id
  activeProjectId: number | null
  activeThreadId: string | null
  expandedProjects: number[]
  threadMessages: ThreadMessage[]
  projectMessages: ThreadMessage[] // merged timeline for active project
  projectMessagesTotal: number
  projectMessagesHasMore: boolean
  loadingProjects: boolean
  loadingThreads: boolean
  loadingMessages: boolean
  loadingMoreMessages: boolean

  fetchProjects: () => Promise<void>
  fetchThreads: (projectId: number) => Promise<void>
  fetchMessages: (threadId: string) => Promise<void>
  fetchProjectMessages: (projectId: number, offset?: number, limit?: number) => Promise<void>
  loadMoreMessages: () => Promise<void>
  createProject: (name: string, path?: string) => Promise<Project | null>
  setActiveProject: (id: number | null) => void
  setActiveThread: (id: string | null) => void
  toggleProject: (id: number) => void
  createThread: (projectId: number) => Promise<string | null>
}

export const useProjectsStore = create<ProjectsState>((set, get) => ({
  projects: [],
  threads: {},
  activeProjectId: null,
  activeThreadId: null,
  expandedProjects: [],
  threadMessages: [],
  projectMessages: [],
  projectMessagesTotal: 0,
  projectMessagesHasMore: false,
  loadingProjects: false,
  loadingThreads: false,
  loadingMessages: false,
  loadingMoreMessages: false,

  fetchProjects: async () => {
    set({ loadingProjects: true })
    try {
      const res = await fetch('/api/projects')
      const data = await res.json()
      if (data.projects) {
        set({ projects: data.projects })
      }
    } catch (e) {
      console.error('Failed to fetch projects:', e)
    } finally {
      set({ loadingProjects: false })
    }
  },

  fetchThreads: async (projectId: number) => {
    set({ loadingThreads: true })
    try {
      const res = await fetch(`/api/threads?projectId=${projectId}`)
      const data = await res.json()
      if (data.threads) {
        set((s) => ({
          threads: { ...s.threads, [projectId]: data.threads },
        }))
      }
    } catch (e) {
      console.error('Failed to fetch threads:', e)
    } finally {
      set({ loadingThreads: false })
    }
  },

  fetchMessages: async (threadId: string) => {
    set({ loadingMessages: true })
    try {
      const res = await fetch(`/api/threads/${threadId}/messages`)
      const data = await res.json()
      if (data.messages) {
        set({ threadMessages: data.messages })
      }
    } catch (e) {
      console.error('Failed to fetch messages:', e)
    } finally {
      set({ loadingMessages: false })
    }
  },

  fetchProjectMessages: async (projectId: number, offset = 0, limit = 100) => {
    set({ loadingMessages: true })
    try {
      const res = await fetch(`/api/projects/${projectId}/messages?limit=${limit}&offset=${offset}`)
      const data = await res.json()
      if (data.messages) {
        set({
          projectMessages: data.messages,
          projectMessagesTotal: data.total,
          projectMessagesHasMore: data.hasMore,
        })
      }
    } catch (e) {
      console.error('Failed to fetch project messages:', e)
    } finally {
      set({ loadingMessages: false })
    }
  },

  loadMoreMessages: async () => {
    const { activeProjectId, projectMessages, projectMessagesHasMore, loadingMoreMessages } = get()
    if (!activeProjectId || !projectMessagesHasMore || loadingMoreMessages) return

    set({ loadingMoreMessages: true })
    try {
      // Current offset = total messages loaded so far (excluding dividers)
      const currentCount = projectMessages.filter(m => m.role !== 'divider').length
      const res = await fetch(`/api/projects/${activeProjectId}/messages?limit=100&offset=${currentCount}`)
      const data = await res.json()
      if (data.messages && data.messages.length > 0) {
        set((s) => ({
          // Prepend older messages before current ones
          projectMessages: [...data.messages, ...s.projectMessages],
          projectMessagesTotal: data.total,
          projectMessagesHasMore: data.hasMore,
        }))
      }
    } catch (e) {
      console.error('Failed to load more messages:', e)
    } finally {
      set({ loadingMoreMessages: false })
    }
  },

  createProject: async (name: string, path?: string) => {
    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, display_name: name, local_path: path || null }),
      })
      const data = await res.json()
      if (data.project) {
        set((s) => ({
          projects: [data.project, ...s.projects],
        }))
        return data.project
      }
      if (data.error) {
        console.error('Failed to create project:', data.error)
      }
    } catch (e) {
      console.error('Failed to create project:', e)
    }
    return null
  },

  setActiveProject: (id) => set({ activeProjectId: id }),

  setActiveThread: (id) => set({ activeThreadId: id }),

  toggleProject: (id) => {
    const { expandedProjects, fetchThreads, threads } = get()
    if (expandedProjects.includes(id)) {
      set({ expandedProjects: expandedProjects.filter(x => x !== id) })
    } else {
      set({ expandedProjects: [...expandedProjects, id] })
      if (!threads[id]) {
        fetchThreads(id)
      }
    }
  },

  createThread: async (projectId: number) => {
    try {
      const res = await fetch('/api/threads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId }),
      })
      const data = await res.json()
      if (data.thread) {
        // Add to local state
        set((s) => ({
          threads: {
            ...s.threads,
            [projectId]: [data.thread, ...(s.threads[projectId] || [])],
          },
          activeProjectId: projectId,
          activeThreadId: data.thread.id,
          threadMessages: [],
        }))
        return data.thread.id
      }
    } catch (e) {
      console.error('Failed to create thread:', e)
    }
    return null
  },
}))
