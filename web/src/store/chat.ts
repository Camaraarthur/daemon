import { create } from 'zustand'

export interface ToolCallData {
  id?: string
  name: string
  args: Record<string, any>
  output?: string
}

export interface Message {
  id: string
  role: 'user' | 'daemon' | 'system'
  content: string
  timestamp: string
  isStreaming?: boolean
  toolCalls?: ToolCallData[]
  model?: string
  isError?: boolean
}

export interface ChatThread {
  id: string
  title: string
  messages: Message[]
  createdAt: string
}

interface ChatState {
  threads: ChatThread[]
  activeThreadId: string | null
  inputDraft: string
  isProcessing: boolean
  loadingHistory: boolean

  // Actions
  setActiveThread: (id: string) => void
  createThread: () => string
  addMessage: (threadId: string, message: Message) => void
  appendToLastDaemon: (threadId: string, text: string) => void
  updateLastDaemon: (threadId: string, updates: Partial<Message>) => void
  addToolCallToLastDaemon: (threadId: string, toolCall: ToolCallData) => void
  updateToolCallResult: (threadId: string, toolCallId: string, output: string) => void
  setInputDraft: (text: string) => void
  setProcessing: (processing: boolean) => void
  getActiveThread: () => ChatThread | null
  loadThreadFromDB: (threadId: string, messages: Message[]) => void
  loadProjectThread: (projectId: number) => Promise<string | null>
}

const generateId = () => Math.random().toString(36).substring(2, 10)

export const useChatStore = create<ChatState>((set, get) => ({
  threads: [],
  activeThreadId: null,
  inputDraft: '',
  isProcessing: false,
  loadingHistory: false,

  setActiveThread: (id) => set({ activeThreadId: id }),

  createThread: () => {
    const id = generateId()
    const thread: ChatThread = {
      id,
      title: 'New conversation',
      messages: [],
      createdAt: new Date().toISOString(),
    }
    set((s) => ({
      threads: [thread, ...s.threads],
      activeThreadId: id,
    }))
    return id
  },

  // Load an existing thread from the DB into the Zustand store
  loadThreadFromDB: (threadId: string, messages: Message[]) => {
    const { threads } = get()
    const existing = threads.find((t) => t.id === threadId)
    if (existing) {
      // Thread already in store — replace messages
      set({
        threads: threads.map((t) =>
          t.id === threadId ? { ...t, messages } : t
        ),
        activeThreadId: threadId,
      })
    } else {
      // Create thread entry in store with loaded messages
      const thread: ChatThread = {
        id: threadId,
        title: messages[0]?.content?.slice(0, 40) || 'Conversation',
        messages,
        createdAt: messages[0]?.timestamp || new Date().toISOString(),
      }
      set((s) => ({
        threads: [thread, ...s.threads],
        activeThreadId: threadId,
      }))
    }
  },

  // Fetch the most recent thread for a project from DB and load it
  loadProjectThread: async (projectId: number): Promise<string | null> => {
    set({ loadingHistory: true })
    try {
      // Get most recent thread for this project
      const threadsRes = await fetch(`/api/threads?projectId=${projectId}`)
      const threadsData = await threadsRes.json()
      const dbThreads = threadsData.threads || []

      if (dbThreads.length === 0) {
        // No existing thread — clear active so user sees empty state
        set({ activeThreadId: null, loadingHistory: false })
        return null
      }

      // Most recent thread (already sorted by last_message_at DESC from the API)
      const latestThread = dbThreads[0]

      // Fetch the LAST 200 messages (most recent — what /resume shows)
      const msgsRes = await fetch(`/api/threads/${latestThread.id}/messages?limit=200&mode=recent`)
      const msgsData = await msgsRes.json()
      const dbMessages = msgsData.messages || []

      // Convert DB messages to chat store Message format
      const messages: Message[] = dbMessages.map((m: any) => ({
        id: m.id,
        role: m.role === 'assistant' ? 'daemon' : m.role,
        content: m.content || '',
        timestamp: m.created_at,
        model: m.model || undefined,
        toolCalls: m.tool_calls ? JSON.parse(m.tool_calls) : undefined,
      }))

      // Load into store
      get().loadThreadFromDB(latestThread.id, messages)
      set({ loadingHistory: false })
      return latestThread.id
    } catch (e) {
      console.error('Failed to load project thread:', e)
      set({ loadingHistory: false })
      return null
    }
  },

  addMessage: (threadId, message) =>
    set((s) => ({
      threads: s.threads.map((t) =>
        t.id === threadId
          ? {
              ...t,
              messages: [...t.messages, message],
              title:
                t.messages.length === 0 && message.role === 'user'
                  ? message.content.slice(0, 40)
                  : t.title,
            }
          : t
      ),
    })),

  appendToLastDaemon: (threadId, text) =>
    set((s) => ({
      threads: s.threads.map((t) =>
        t.id === threadId
          ? {
              ...t,
              messages: t.messages.map((m, i) =>
                i === t.messages.length - 1 && m.role === 'daemon'
                  ? { ...m, content: m.content + text }
                  : m
              ),
            }
          : t
      ),
    })),

  updateLastDaemon: (threadId, updates) =>
    set((s) => ({
      threads: s.threads.map((t) =>
        t.id === threadId
          ? {
              ...t,
              messages: t.messages.map((m, i) =>
                i === t.messages.length - 1 && m.role === 'daemon'
                  ? { ...m, ...updates }
                  : m
              ),
            }
          : t
      ),
    })),

  addToolCallToLastDaemon: (threadId, toolCall) =>
    set((s) => ({
      threads: s.threads.map((t) =>
        t.id === threadId
          ? {
              ...t,
              messages: t.messages.map((m, i) =>
                i === t.messages.length - 1 && m.role === 'daemon'
                  ? { ...m, toolCalls: [...(m.toolCalls || []), toolCall] }
                  : m
              ),
            }
          : t
      ),
    })),

  updateToolCallResult: (threadId, toolCallId, output) =>
    set((s) => ({
      threads: s.threads.map((t) =>
        t.id === threadId
          ? {
              ...t,
              messages: t.messages.map((m, i) =>
                i === t.messages.length - 1 && m.role === 'daemon'
                  ? {
                      ...m,
                      toolCalls: (m.toolCalls || []).map((tc) =>
                        tc.id === toolCallId ? { ...tc, output } : tc
                      ),
                    }
                  : m
              ),
            }
          : t
      ),
    })),

  setInputDraft: (text) => {
    set({ inputDraft: text })
    // Persist draft to localStorage so it survives refresh
    try { localStorage.setItem('daemon_draft', text) } catch {}
  },
  setProcessing: (processing) => set({ isProcessing: processing }),

  getActiveThread: () => {
    const { threads, activeThreadId } = get()
    return threads.find((t) => t.id === activeThreadId) || null
  },
}))
