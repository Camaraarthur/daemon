'use client'

import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { useChatStore, Message } from '@/store/chat'
import { useProjectsStore } from '@/store/projects'
import { MessageBubble } from '@/components/chat/MessageBubble'
import { ActivityIndicator } from '@/components/chat/ActivityIndicator'
import ProjectSidebar from '@/components/ProjectSidebar'
import { filterCommands, matchSlashCommand, type SlashCommand } from '@/lib/slash-commands'
import Image from 'next/image'

function MicButton({ onTranscript }: { onTranscript: (text: string) => void }) {
  const [listening, setListening] = useState(false)
  const [ws, setWs] = useState<WebSocket | null>(null)
  const [mediaRec, setMediaRec] = useState<MediaRecorder | null>(null)

  const toggle = useCallback(async () => {
    if (listening) {
      mediaRec?.stop()
      ws?.close()
      setListening(false)
      setMediaRec(null)
      setWs(null)
      return
    }

    try {
      const keyRes = await fetch('/api/voice')
      const { key } = await keyRes.json()
      if (!key) return

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      })

      const dgWs = new WebSocket(
        `wss://api.deepgram.com/v1/listen?model=nova-3&language=en&smart_format=true&interim_results=false&endpointing=300`,
        ['token', key]
      )

      dgWs.onopen = () => {
        const rec = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' })
        rec.ondataavailable = (e) => {
          if (e.data.size > 0 && dgWs.readyState === WebSocket.OPEN) {
            dgWs.send(e.data)
          }
        }
        rec.start(250)
        setMediaRec(rec)
      }

      dgWs.onmessage = (event) => {
        const data = JSON.parse(event.data)
        const transcript = data?.channel?.alternatives?.[0]?.transcript
        if (transcript?.trim() && data.is_final) {
          onTranscript(transcript.trim())
        }
      }

      dgWs.onerror = () => { setListening(false) }
      dgWs.onclose = () => {
        stream.getTracks().forEach(t => t.stop())
        setListening(false)
      }

      setWs(dgWs)
      setListening(true)
    } catch (e) {
      console.error('Mic error:', e)
      setListening(false)
    }
  }, [listening, mediaRec, ws, onTranscript])

  return (
    <button
      onClick={toggle}
      className={`p-2.5 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-full transition-colors shrink-0 ${
        listening
          ? 'bg-[#ff0505] text-white animate-pulse'
          : 'bg-[#1a1a1a] text-[#888] hover:text-[#ff0505] border border-[#282828]'
      }`}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/>
        <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
        <line x1="12" x2="12" y1="19" y2="22"/>
      </svg>
    </button>
  )
}

export default function DaemonChat() {
  const [authed, setAuthed] = useState<boolean | null>(null)
  const [user, setUser] = useState<any>(null)

  useEffect(() => {
    fetch('/api/me')
      .then(r => {
        if (r.status === 401) {
          setAuthed(false)
          return null
        }
        return r.json()
      })
      .then(d => {
        if (d && !d.error) {
          setAuthed(true)
          setUser(d)
        } else {
          setAuthed(false)
        }
      })
      .catch(() => setAuthed(false))
  }, [])

  if (authed === null) {
    return <div className="min-h-dvh bg-[#0a0a0a] flex items-center justify-center"><div className="text-[#333] text-sm">loading...</div></div>
  }

  if (!authed) {
    return <LoginPage />
  }

  return <AuthedChat user={user} />
}

function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const login = async () => {
    setLoading(true); setError('')
    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'login', email, password }),
      })
      const data = await res.json()
      if (data.error) { setError(data.error) }
      else { window.location.reload() }
    } catch { setError('Connection error') }
    setLoading(false)
  }

  return (
    <div className="min-h-dvh bg-[#0a0a0a] flex flex-col items-center justify-center px-6">
      <div className="w-full max-w-xs space-y-3">
        <h2 className="text-lg text-white font-medium text-center mb-4">Login to your daemon</h2>
        <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="email"
          className="w-full px-4 py-3 bg-[#141414] border border-[#222] rounded-xl text-white placeholder-[#555] text-sm focus:outline-none focus:border-[#ff0505]/50" />
        <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="password"
          onKeyDown={e => { if (e.key === 'Enter') login() }}
          className="w-full px-4 py-3 bg-[#141414] border border-[#222] rounded-xl text-white placeholder-[#555] text-sm focus:outline-none focus:border-[#ff0505]/50" />
        {error && <p className="text-xs text-[#ff0505] text-center">{error}</p>}
        <button onClick={login} disabled={loading || !email || !password}
          className="w-full py-3 bg-[#ff0505] text-white rounded-2xl text-sm font-medium hover:bg-[#dd0404] disabled:opacity-30">
          {loading ? 'Logging in...' : 'Enter'}
        </button>
        <a href="https://daemon.page" className="block text-center text-xs text-[#555] hover:text-[#888]">back to daemon.page</a>
      </div>
    </div>
  )
}

function AuthedChat({ user }: { user: any }) {
  const {
    getActiveThread, addMessage, appendToLastDaemon, addToolCallToLastDaemon,
    updateToolCallResult, updateLastDaemon,
    setInputDraft, inputDraft,
    isProcessing, setProcessing, createThread: createChatThread, activeThreadId: chatActiveThreadId,
    setActiveThread: setChatActiveThread,
    loadProjectThread, loadingHistory,
  } = useChatStore()

  const {
    activeProjectId,
    setActiveProject,
    projects,
  } = useProjectsStore()

  const endRef = useRef<HTMLDivElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const [statusText, setStatusText] = useState('')
  // Default open on desktop, closed on mobile (set in effect after mount to avoid hydration mismatch)
  const [showSidebar, setShowSidebar] = useState(true)
  const [initialScrollDone, setInitialScrollDone] = useState(false)
  const [showModelPicker, setShowModelPicker] = useState(false)
  const [currentModel, setCurrentModel] = useState('qwen3-coder')

  // Load model preference
  useEffect(() => {
    fetch('/api/settings')
      .then(r => {
        if (r.status === 401) { window.location.href = '/login'; return null }
        return r.json()
      })
      .then(d => { if (d?.model) setCurrentModel(d.model) })
      .catch(() => {})
  }, [])

  const MODEL_SHORT_NAMES: Record<string, string> = {
    'qwen3-coder': 'Qwen',
    'deepseek-v3': 'DeepSeek',
    'claude-sonnet': 'Sonnet',
    'claude-opus': 'Opus',
    'gemini-3-flash': 'Flash',
    'gemini-3-pro': 'Gemini Pro',
  }

  const QUICK_MODELS = [
    { id: 'qwen3-coder', label: 'Qwen3-Coder', tag: 'FREE' },
    { id: 'deepseek-v3', label: 'DeepSeek V3', tag: '$' },
    { id: 'claude-sonnet', label: 'Claude Sonnet', tag: '$$' },
    { id: 'claude-opus', label: 'Claude Opus', tag: '$$$' },
    { id: 'gemini-3-flash', label: 'Gemini Flash', tag: '$' },
  ]

  const switchModel = useCallback((modelId: string) => {
    setCurrentModel(modelId)
    setShowModelPicker(false)
    fetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: modelId }),
    }).catch(() => {})
  }, [])

  // Restore draft from localStorage on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem('daemon_draft')
      if (saved) setInputDraft(saved)
    } catch {}
  }, [])

  // Every view is a live chat. Imported history lives in memory, not the chat.
  const chatThread = getActiveThread()
  const displayMessages: Message[] = chatThread?.messages || []

  // Restore project from URL on mount (so refresh keeps you in the right conversation)
  useEffect(() => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    const urlProjectId = params.get('p')
    if (urlProjectId && !activeProjectId) {
      const pid = parseInt(urlProjectId, 10)
      if (!isNaN(pid)) {
        setActiveProject(pid)
      }
    }
  }, []) // run once on mount

  // Sync URL when active project changes (so the page is bookmarkable / refresh-safe)
  useEffect(() => {
    if (typeof window === 'undefined') return
    const url = new URL(window.location.href)
    if (activeProjectId) {
      url.searchParams.set('p', String(activeProjectId))
    } else {
      url.searchParams.delete('p')
    }
    // Use replaceState so we don't pollute browser history
    window.history.replaceState({}, '', url.toString())
  }, [activeProjectId])

  // Load most recent thread when switching projects
  useEffect(() => {
    if (activeProjectId) {
      loadProjectThread(activeProjectId)
    } else {
      setChatActiveThread('')
    }
  }, [activeProjectId, loadProjectThread, setChatActiveThread])

  // Load project context when switching projects
  const [projectContext, setProjectContext] = useState<string | null>(null)
  useEffect(() => {
    if (activeProjectId) {
      fetch(`/api/memory?action=context&projectId=${activeProjectId}`)
        .then(r => r.json())
        .then(d => setProjectContext(d.context || null))
        .catch(() => setProjectContext(null))
    } else {
      setProjectContext(null)
    }
  }, [activeProjectId])

  // Get active project name for header
  const activeProjectName = useMemo(() => {
    if (!activeProjectId) return null
    return projects.find(p => p.id === activeProjectId)?.display_name || null
  }, [activeProjectId, projects])

  // Scroll to bottom on new messages
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: initialScrollDone ? 'smooth' : 'instant' })
    if (!initialScrollDone && displayMessages.length > 0) {
      setInitialScrollDone(true)
    }
  }, [displayMessages, initialScrollDone])

  // Reset scroll on project switch
  useEffect(() => {
    setInitialScrollDone(false)
  }, [activeProjectId])

  const handleScroll = useCallback(() => {}, [])

  const send = useCallback(async () => {
    const text = inputDraft.trim()
    if (!text || isProcessing) return

    // Handle slash commands
    const slashMatch = matchSlashCommand(text)
    let actualMessage = text
    if (slashMatch && slashMatch.command.type === 'prompt') {
      // Inject prompt template — the user sees their slash command, the model gets the template + args
      const args = slashMatch.args
      actualMessage = `${slashMatch.command.promptTemplate}\n\n${args ? `User request: ${args}` : ''}`.trim()
    } else if (slashMatch && slashMatch.command.type === 'action') {
      // Handle action commands client-side
      if (slashMatch.command.actionId === 'open_settings') window.location.href = '/settings'
      if (slashMatch.command.actionId === 'clear_chat') { setChatActiveThread(''); setInputDraft('') }
      return
    }

    let tid = chatActiveThreadId
    if (!tid) {
      // If we have an active project, create a thread in the DB via API
      if (activeProjectId) {
        try {
          const res = await fetch('/api/threads', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ projectId: activeProjectId, title: text.slice(0, 40) }),
          })
          const data = await res.json()
          if (data.thread?.id) {
            tid = data.thread.id as string
            // Create thread in the Zustand store with this DB ID
            const { loadThreadFromDB } = useChatStore.getState()
            loadThreadFromDB(tid!, [])
          }
        } catch {
          // Fallback to local thread
        }
      }
      if (!tid) tid = createChatThread()
    }

    addMessage(tid!, {
      id: crypto.randomUUID(),
      role: 'user',
      content: text,
      timestamp: new Date().toISOString(),
    })

    const daemonMsgId = crypto.randomUUID()
    addMessage(tid!, {
      id: daemonMsgId,
      role: 'daemon',
      content: '',
      timestamp: new Date().toISOString(),
      isStreaming: true,
    })

    setInputDraft('')
    setProcessing(true)
    setStatusText('Thinking...')

    const MAX_RETRIES = 2
    let retryCount = 0

    const attemptSend = async (): Promise<void> => {
      try {
        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: actualMessage, threadId: tid, projectId: activeProjectId, stream: true }),
        })

        // Auth expiry — redirect to login
        if (res.status === 401) {
          updateLastDaemon(tid!, {
            content: 'Session expired. Redirecting to login...',
            isStreaming: false,
            isError: true,
          })
          setTimeout(() => { window.location.href = '/login' }, 1500)
          return
        }

        if (!res.ok) {
          const errData = await res.json().catch(() => ({ error: 'Request failed' }))
          const friendlyMsg = res.status === 429
            ? 'Rate limit reached. Please try again later.'
            : res.status >= 500
              ? 'The AI service is temporarily unavailable. Please try again in a moment.'
              : errData.error || 'Something went wrong. Please try again.'
          updateLastDaemon(tid!, { content: friendlyMsg, isStreaming: false, isError: true })
          return
        }

        const reader = res.body?.getReader()
        if (!reader) {
          updateLastDaemon(tid!, { content: 'No response received from server.', isStreaming: false, isError: true })
          return
        }

        const decoder = new TextDecoder()
        let buffer = ''

        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n\n')
          buffer = lines.pop() || ''

          for (const chunk of lines) {
            if (!chunk.startsWith('data: ')) continue
            const payload = chunk.slice(6).trim()
            if (!payload) continue

            try {
              const event = JSON.parse(payload)
              switch (event.type) {
                case 'thinking':
                  setStatusText(event.data.text || 'Thinking...')
                  break
                case 'text':
                  appendToLastDaemon(tid!, event.data.text || '')
                  break
                case 'tool_call':
                  setStatusText(event.data.name || 'Running tool...')
                  addToolCallToLastDaemon(tid!, {
                    id: event.data.id,
                    name: event.data.name,
                    args: event.data.args || {},
                  })
                  break
                case 'tool_result':
                  updateToolCallResult(tid!, event.data.id, event.data.output || '')
                  setStatusText('Thinking...')
                  break
                case 'done':
                  if (event.data.response) {
                    updateLastDaemon(tid!, {
                      content: event.data.response,
                      model: event.data.model,
                      isStreaming: false,
                    })
                  } else {
                    updateLastDaemon(tid!, { isStreaming: false })
                  }
                  break
                case 'error': {
                  // Check if it's a device disconnection error
                  const errMsg = event.data.message || 'An error occurred'
                  const isDeviceError = /disconnect|device.*lost|connection.*reset|timed?\s*out/i.test(errMsg)
                  updateLastDaemon(tid!, {
                    content: isDeviceError
                      ? 'Device disconnected. Attempting to reconnect...'
                      : `Something went wrong: ${errMsg}`,
                    isStreaming: false,
                    isError: true,
                  })
                  break
                }
              }
            } catch {
              // Skip malformed SSE events
            }
          }
        }

        updateLastDaemon(tid!, { isStreaming: false })

      } catch (err) {
        // Network error — auto-retry with backoff
        if (retryCount < MAX_RETRIES) {
          retryCount++
          setStatusText(`Connection lost — retrying (${retryCount}/${MAX_RETRIES})...`)
          await new Promise(resolve => setTimeout(resolve, 5000))
          return attemptSend()
        }

        updateLastDaemon(tid!, {
          content: 'Connection lost. Please check your network and try again.',
          isStreaming: false,
          isError: true,
        })
      }
    }

    try {
      await attemptSend()
    } finally {
      setProcessing(false)
      setStatusText('')
      inputRef.current?.focus()
    }
  }, [inputDraft, isProcessing, chatActiveThreadId, createChatThread, addMessage, appendToLastDaemon, addToolCallToLastDaemon, updateToolCallResult, updateLastDaemon, setInputDraft, setProcessing])

  return (
    <div className="flex bg-[#0a0a0a] text-[#bfbfbf] chat-container" style={{ height: '100dvh', minHeight: '-webkit-fill-available' }}>
      {/* Left sidebar — toggleable on ALL screen sizes */}
      {showSidebar && (
        <>
          {/* Mobile backdrop */}
          <div
            className="fixed inset-0 z-40 bg-black/50 sm:hidden"
            onClick={() => setShowSidebar(false)}
          />
          <div className="w-64 border-r border-[#222] shrink-0 bg-[#111] fixed sm:relative inset-y-0 left-0 z-50 sm:z-auto">
            <ProjectSidebar onClose={() => setShowSidebar(false)} />
          </div>
        </>
      )}

      {/* Main chat area */}
      <div className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden">
        {/* Header */}
        <div className="h-12 border-b border-[#222] flex items-center justify-between px-3 bg-[#111] shrink-0">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowSidebar(!showSidebar)}
              className="tap-target text-[#666] hover:text-white transition-colors"
              title={showSidebar ? "Hide sidebar" : "Show sidebar"}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 12h18M3 6h18M3 18h18"/></svg>
            </button>
            <Image src="/favicon.png" alt="daemon" width={20} height={20} />
            {activeProjectName ? (
              <span className="text-sm font-medium text-white">{activeProjectName}</span>
            ) : (
              <>
                <span className="text-sm font-medium text-white">My</span>
                <span className="text-xs text-[#888]">daemon</span>
              </>
            )}
          </div>
          <div className="flex items-center gap-2">
            {/* Connect Device button */}
            <a
              href="/download"
              className="hidden sm:flex items-center gap-1 px-2 py-1 rounded-full bg-[#1a1a1a] border border-[#282828] hover:border-[#ff0505]/40 transition-colors"
              title="Connect a new device"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#888" strokeWidth="2">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              <span className="text-[11px] text-[#888] font-medium">Device</span>
            </a>
            {/* Model picker pill */}
            <div className="relative">
              <button
                onClick={() => setShowModelPicker(!showModelPicker)}
                className="flex items-center gap-1 px-3 py-2 min-h-[44px] rounded-full bg-[#1a1a1a] border border-[#282828] hover:border-[#444] transition-colors"
              >
                <span className="text-[11px] text-[#888] font-medium">{MODEL_SHORT_NAMES[currentModel] || currentModel}</span>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#666" strokeWidth="2.5"><path d="m6 9 6 6 6-6"/></svg>
              </button>
              {showModelPicker && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowModelPicker(false)} />
                  <div className="absolute right-0 top-full mt-1 z-50 w-52 bg-[#161616] border border-[#282828] rounded-xl shadow-xl overflow-hidden">
                    {QUICK_MODELS.map(m => (
                      <button
                        key={m.id}
                        onClick={() => switchModel(m.id)}
                        className={`w-full text-left px-3 py-3 min-h-[44px] flex items-center justify-between hover:bg-[#222] transition-colors ${
                          m.id === currentModel ? 'bg-[#ff0505]/5' : ''
                        }`}
                      >
                        <span className={`text-xs ${m.id === currentModel ? 'text-white' : 'text-[#888]'}`}>{m.label}</span>
                        <span className="text-[9px] text-[#555] font-mono">{m.tag}</span>
                      </button>
                    ))}
                    <a
                      href="/settings"
                      className="block w-full text-left px-3 py-2 text-[10px] text-[#555] hover:text-[#888] hover:bg-[#1a1a1a] border-t border-[#222] transition-colors"
                    >
                      All models & API keys...
                    </a>
                  </div>
                </>
              )}
            </div>
            {/* Settings gear */}
            <a href="/settings" className="tap-target text-[#555] hover:text-[#888] transition-colors">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="3"/>
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
              </svg>
            </a>
          </div>
        </div>

        {/* Messages */}
        <div
          ref={scrollContainerRef}
          onScroll={handleScroll}
          className="flex-1 overflow-y-auto px-4 py-4 min-h-0"
        >
          {loadingHistory ? (
            <div className="flex items-center justify-center h-full">
              <div className="text-xs text-[#555]">loading history...</div>
            </div>
          ) : displayMessages.length === 0 ? (
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                {projectContext && (
                  <div className="mb-6 max-w-md text-left bg-[#161616] border border-[#222] rounded-lg p-3">
                    <div className="text-[10px] text-[#555] uppercase tracking-wider mb-1">Project context</div>
                    <p className="text-[11px] text-[#888] whitespace-pre-wrap">{projectContext.slice(0, 500)}</p>
                  </div>
                )}
                <Image src="/favicon.png" alt="daemon" width={48} height={48} className="mx-auto mb-3 opacity-30" />
                <p className="text-xs text-[#555]">
                  {activeProjectId
                    ? `start working on ${activeProjectName || 'this project'}`
                    : projects.length === 0
                      ? 'Create your first project or connect a device to get started.'
                      : 'Select a project or start chatting'}
                </p>
              </div>
            </div>
          ) : (
            <>
              {displayMessages.map((m) => (
                m.role === ('divider' as any) ? (
                  <div key={m.id} className="flex items-center gap-3 my-4">
                    <div className="flex-1 h-px bg-[#222]" />
                    <span className="text-[10px] text-[#555] whitespace-nowrap">{m.content}</span>
                    <div className="flex-1 h-px bg-[#222]" />
                  </div>
                ) : (
                  <MessageBubble key={m.id} message={m} />
                )
              ))}
              {isProcessing && (
                <ActivityIndicator status={statusText} active={true} />
              )}
              <div ref={endRef} />
            </>
          )}
        </div>

        {/* Input — always live */}
        <div className="border-t border-[#222] p-3 bg-[#111] shrink-0 relative">
            {/* Slash command dropdown */}
            {inputDraft.startsWith('/') && !inputDraft.includes(' ') && (
              <div className="absolute bottom-full left-0 right-0 px-3 pb-1">
                <div className="max-w-2xl mx-auto bg-[#161616] border border-[#282828] rounded-xl overflow-hidden shadow-xl max-h-64 overflow-y-auto">
                  {filterCommands(inputDraft).map((cmd, i) => (
                    <button
                      key={cmd.name}
                      onClick={() => {
                        if (cmd.type === 'action') {
                          if (cmd.actionId === 'open_settings') window.location.href = '/settings'
                          if (cmd.actionId === 'clear_chat') { setChatActiveThread(''); setInputDraft('') }
                          if (cmd.actionId === 'show_pairing') setInputDraft('')
                        } else {
                          setInputDraft(`/${cmd.name} `)
                          inputRef.current?.focus()
                        }
                      }}
                      className={`w-full flex items-center gap-3 px-3 py-3 min-h-[44px] text-left hover:bg-[#1a1a1a] transition-colors ${i === 0 ? '' : 'border-t border-[#222]'}`}
                    >
                      <span className="text-sm">{cmd.icon}</span>
                      <div>
                        <span className="text-xs text-white font-mono">/{cmd.name}</span>
                        <span className="text-[10px] text-[#666] ml-2">{cmd.description}</span>
                      </div>
                    </button>
                  ))}
                  {filterCommands(inputDraft).length === 0 && (
                    <div className="px-3 py-2 text-[10px] text-[#555]">no matching commands</div>
                  )}
                </div>
              </div>
            )}
            <div className="flex items-end gap-2 max-w-2xl mx-auto">
              <textarea
                ref={inputRef}
                value={inputDraft}
                onChange={(e) => setInputDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
                placeholder="Message your daemon... (type / for commands)"
                rows={1}
                className="flex-1 resize-none rounded-2xl border border-[#282828] bg-[#161616] px-4 py-2.5 text-sm text-white placeholder-[#666] focus:outline-none focus:border-[#ff0505]/40"
              />
              <MicButton onTranscript={(text) => setInputDraft(inputDraft + (inputDraft ? ' ' : '') + text)} />
              <button
                onClick={send}
                disabled={isProcessing || !inputDraft.trim()}
                className="p-2.5 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-full bg-[#ff0505] text-white disabled:opacity-40 hover:bg-[#dd0404] transition-colors shrink-0"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="m5 12 7-7 7 7"/><path d="M12 19V5"/></svg>
              </button>
            </div>
        </div>
      </div>
    </div>
  )
}
