import { create } from 'zustand'

export interface ToolCallData {
  id?: string
  name: string
  args: Record<string, any>
  output?: string
  status?: 'running' | 'done' | 'error'
  device_id?: string
  duration_ms?: number
  /** Internal: when the tool_call event arrived (for duration calc). */
  started_at?: number
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

/** Live thread update event delivered via WebSocket from the server. */
export interface ThreadEvent {
  type: 'message.created' | 'message.updated' | 'message.completed' | 'message.error'
  message_id: string
  thread_id: string
  role?: string
  content?: string | null
  tool_calls?: any[]
  model?: string | null
  created_at?: string
  source_session_id?: string | null
  complete?: boolean
  error?: string
}

interface ChatState {
  threads: ChatThread[]
  activeThreadId: string | null
  inputDraft: string
  isProcessing: boolean
  loadingHistory: boolean
  // SLICE-A: queued followup — text typed while a stream is in flight.
  // Auto-fires ~200ms after isProcessing flips false. See chat/page.tsx send().
  queuedFollowup: string | null

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
  // SLICE-A: setter for the queued-followup slot.
  setQueuedFollowup: (text: string | null) => void
  getActiveThread: () => ChatThread | null
  loadThreadFromDB: (threadId: string, messages: Message[]) => void
  loadProjectThread: (projectId: number) => Promise<string | null>
  /** Apply a live thread event from the WebSocket subscription. */
  applyThreadEvent: (event: ThreadEvent) => void
}

const generateId = () => Math.random().toString(36).substring(2, 10)

export const useChatStore = create<ChatState>((set, get) => ({
  threads: [],
  activeThreadId: null,
  inputDraft: '',
  isProcessing: false,
  loadingHistory: false,
  // SLICE-A: queued followup default null
  queuedFollowup: null,

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
      // Get most recent thread for this project. cache:'no-store' is critical
      // here — Next/browsers will happily serve a stale list and we'd miss
      // any thread the user opened in another tab.
      const threadsRes = await fetch(`/api/threads?projectId=${projectId}`, { cache: 'no-store' })
      const threadsData = await threadsRes.json()
      const dbThreads = threadsData.threads || []

      if (dbThreads.length === 0) {
        // No existing thread — clear active so user sees empty state
        set({ activeThreadId: null, loadingHistory: false })
        return null
      }

      // Most recent thread (already sorted by last_message_at DESC from the API)
      const latestThread = dbThreads[0]

      // Fetch the LAST 200 messages (most recent — what /resume shows).
      // The server triggers Claude Code JSONL sync on this GET, so the
      // response includes anything the user just typed in `claude` CLI.
      // Bypass HTTP cache so refreshes always pull the live JSONL.
      const msgsRes = await fetch(
        `/api/threads/${latestThread.id}/messages?limit=200&mode=recent&t=${Date.now()}`,
        { cache: 'no-store' },
      )
      const msgsData = await msgsRes.json()
      const dbMessages = msgsData.messages || []

      // Convert DB messages to chat store Message format. The `complete`
      // column drives the isStreaming flag — if a row is in flight when the
      // page loads, render it as streaming and let the WS push update it.
      const messages: Message[] = dbMessages.map((m: any) => ({
        id: m.id,
        role: m.role === 'assistant' ? 'daemon' : m.role,
        content: m.content || '',
        timestamp: m.created_at,
        model: m.model || undefined,
        toolCalls: m.tool_calls ? JSON.parse(m.tool_calls) : undefined,
        isStreaming: m.complete === 0,
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
                  ? { ...m, toolCalls: [...(m.toolCalls || []), {
                      ...toolCall,
                      status: 'running',
                      started_at: Date.now(),
                    }] }
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
                      toolCalls: (m.toolCalls || []).map((tc) => {
                        if (tc.id !== toolCallId) return tc
                        const isError = typeof output === 'string' && /^\s*Error[: ]|^\{.*"ok"\s*:\s*false/i.test(output)
                        const duration = tc.started_at ? Date.now() - tc.started_at : undefined
                        return {
                          ...tc,
                          output,
                          status: isError ? 'error' : 'done',
                          duration_ms: duration,
                        }
                      }),
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
  // SLICE-A: setter
  setQueuedFollowup: (text) => set({ queuedFollowup: text }),

  getActiveThread: () => {
    const { threads, activeThreadId } = get()
    return threads.find((t) => t.id === activeThreadId) || null
  },

  // Apply a live WebSocket event for a thread. Single source of truth: the
  // server-side DB row drives the state, the WS push relays each change.
  // Polling and refreshActiveThread are gone; this function replaces them.
  applyThreadEvent: (event: ThreadEvent): void => {
    const { activeThreadId, threads } = get()
    // Only apply events for whatever thread the user is currently looking at.
    // Background threads stay un-mutated until the user opens them (initial
    // load via loadProjectThread will pull the current state from DB).
    if (event.thread_id !== activeThreadId) return

    const thread = threads.find(t => t.id === event.thread_id)
    if (!thread) return

    if (event.type === 'message.created') {
      // Idempotent: if a row with this id already exists, treat as update.
      const exists = thread.messages.some(m => m.id === event.message_id)
      const newMsg: Message = {
        id: event.message_id,
        role: event.role === 'assistant' ? 'daemon' : (event.role as Message['role']) || 'daemon',
        content: event.content || '',
        timestamp: event.created_at || new Date().toISOString(),
        model: event.model || undefined,
        toolCalls: event.tool_calls,
        isStreaming: event.complete === false,
      }
      set({
        threads: threads.map(t => t.id === event.thread_id
          ? { ...t, messages: exists
              ? t.messages.map(m => m.id === event.message_id ? { ...m, ...newMsg } : m)
              : [...t.messages, newMsg] }
          : t),
      })
      return
    }

    if (event.type === 'message.updated' || event.type === 'message.completed' || event.type === 'message.error') {
      // Update existing row in place. If we don't know about it yet (e.g. an
      // older message that scrolled out of the limit window), insert it.
      const exists = thread.messages.some(m => m.id === event.message_id)
      const isComplete = event.type !== 'message.updated'
      const isError = event.type === 'message.error'
      if (exists) {
        set({
          threads: threads.map(t => t.id === event.thread_id
            ? { ...t, messages: t.messages.map(m =>
                m.id === event.message_id
                  ? {
                      ...m,
                      content: event.content ?? m.content,
                      toolCalls: event.tool_calls ?? m.toolCalls,
                      model: event.model ?? m.model,
                      isStreaming: !isComplete,
                      isError: isError || m.isError,
                    }
                  : m
              ) }
            : t),
        })
      } else {
        // Synthesize a row for an unknown message_id (rare — out-of-window edits)
        const newMsg: Message = {
          id: event.message_id,
          role: event.role === 'assistant' ? 'daemon' : (event.role as Message['role']) || 'daemon',
          content: event.content || '',
          timestamp: event.created_at || new Date().toISOString(),
          model: event.model || undefined,
          toolCalls: event.tool_calls,
          isStreaming: !isComplete,
          isError,
        }
        set({
          threads: threads.map(t => t.id === event.thread_id
            ? { ...t, messages: [...t.messages, newMsg] }
            : t),
        })
      }
    }
  },

  // (legacy — kept for backwards-compat with anything still calling it)
  refreshActiveThread: async (): Promise<void> => {
    const { activeThreadId } = get()
    if (!activeThreadId) return
    try {
      const res = await fetch(
        `/api/threads/${activeThreadId}/messages?limit=200&mode=recent&t=${Date.now()}`,
        { cache: 'no-store' },
      )
      if (!res.ok) return
      const data = await res.json()
      const dbMessages: any[] = data.messages || []
      const messages: Message[] = dbMessages.map((m: any) => ({
        id: m.id,
        role: m.role === 'assistant' ? 'daemon' : m.role,
        content: m.content || '',
        timestamp: m.created_at,
        model: m.model || undefined,
        toolCalls: m.tool_calls ? JSON.parse(m.tool_calls) : undefined,
      }))
      // Only replace if the message tail actually changed — avoids needless
      // re-renders when nothing has been added.
      const current = get().threads.find(t => t.id === activeThreadId)
      const lastCur = current?.messages[current.messages.length - 1]
      const lastNew = messages[messages.length - 1]

      // Never overwrite while a message is actively streaming or showing an
      // error that only lives in state (not yet persisted to DB).
      if (lastCur?.isStreaming || lastCur?.isError) return

      // Race guard: if the server returned FEWER messages than we already
      // have in memory, the assistant response just finished streaming but
      // hasn't been persisted to SQLite yet. Skipping the replace prevents
      // the just-streamed message from disappearing on the next poll tick.
      if (current && messages.length < current.messages.length) return

      const changed =
        !current ||
        current.messages.length !== messages.length ||
        lastCur?.id !== lastNew?.id
      if (changed) {
        get().loadThreadFromDB(activeThreadId, messages)
      }
    } catch {
      // Network blip — leave the current view in place.
    }
  },
}))
