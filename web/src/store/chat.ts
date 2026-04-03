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
}

const generateId = () => Math.random().toString(36).substring(2, 10)

export const useChatStore = create<ChatState>((set, get) => ({
  threads: [],
  activeThreadId: null,
  inputDraft: '',
  isProcessing: false,

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
