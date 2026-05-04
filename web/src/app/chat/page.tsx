'use client'

import { useState, useRef, useEffect, useLayoutEffect, useCallback, useMemo } from 'react'
import { useChatStore, Message } from '@/store/chat'
import { useProjectsStore } from '@/store/projects'
import { MessageBubble } from '@/components/chat/MessageBubble'
import { ActivityIndicator } from '@/components/chat/ActivityIndicator'
import ProjectSidebar from '@/components/ProjectSidebar'
import { filterCommands, matchSlashCommand, type SlashCommand } from '@/lib/slash-commands'
// SLICE-B: @-mention popover
import { AtMentionMenu } from '@/components/chat/AtMentionMenu'
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
    loadProjectThread, loadingHistory, applyThreadEvent,
    // SLICE-A: queued-followup slot for "Enter while streaming"
    queuedFollowup, setQueuedFollowup,
  } = useChatStore()

  const {
    activeProjectId,
    setActiveProject,
    projects,
  } = useProjectsStore()

  const endRef = useRef<HTMLDivElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  // Autosize input: grow up to 500px, shrink back to 36px (one line) when cleared.
  // useLayoutEffect so DOM measurement happens synchronously after commit — avoids
  // stale scrollHeight reads when inputDraft is cleared in the same batch as other
  // state updates (e.g. after send: setInputDraft('') + setProcessing(true) together).
  // Also: when cleared, skip the scrollHeight dance and force the floor directly.
  useLayoutEffect(() => {
    const ta = inputRef.current
    if (!ta) return
    if (inputDraft === '') {
      ta.style.height = '36px'
      return
    }
    ta.style.height = 'auto'
    ta.style.height = Math.min(Math.max(ta.scrollHeight, 36), 500) + 'px'
  }, [inputDraft])
  const [statusText, setStatusText] = useState('')
  // SLICE-B: @-mention popover state. `atQuery` is the token after `@` at the
  // textarea caret (null when no active mention). `atMatches` is the cached
  // file-tree filtered to the query. `atSelected` is the keyboard-highlighted
  // index. Project-tree fetch is debounced via projectTreeCache.
  const [atQuery, setAtQuery] = useState<string | null>(null)
  const [atMatches, setAtMatches] = useState<string[]>([])
  const [atSelected, setAtSelected] = useState(0)
  const projectTreeCache = useRef<{ projectId: number | null; paths: string[]; fetchedAt: number }>({ projectId: null, paths: [], fetchedAt: 0 })
  // SLICE-D: live WebSocket connection-state for the chat header badge.
  // 'connecting' on first mount, 'online' once /ws/client opens,
  // 'reconnecting' during backoff, 'offline' after 3 missed heartbeats.
  const [wsState, setWsState] = useState<'connecting' | 'online' | 'reconnecting' | 'offline'>('connecting')
  const [wsLastSeen, setWsLastSeen] = useState<number | null>(null)
  // SLICE-D: tick once a minute so the "last seen Xm ago" string stays fresh
  // without re-rendering the whole tree on every event.
  const [wsNowTick, setWsNowTick] = useState<number>(() => Date.now())
  // Pendant connection state — populated by polling /api/pendant/state every
  // 10s. Latest-wins from ws-server's per-user cache. `null` = unknown
  // (no device has reported yet, or last report >90s old).
  const [pendant, setPendant] = useState<{
    connected: boolean | null
    batteryPercent: number | null
    stale: boolean
  } | null>(null)
  useEffect(() => {
    let cancelled = false
    const tick = async () => {
      try {
        const r = await fetch('/api/pendant/state', { cache: 'no-store' })
        if (!r.ok) return
        const data = await r.json()
        if (!cancelled) setPendant({
          connected: data?.stale ? null : data?.connected,
          batteryPercent: data?.batteryPercent ?? null,
          stale: !!data?.stale,
        })
      } catch {}
    }
    tick()
    const id = setInterval(tick, 10_000)
    return () => { cancelled = true; clearInterval(id) }
  }, [])
  // Default open on desktop, closed on mobile (set in effect after mount to avoid hydration mismatch)
  const [showSidebar, setShowSidebar] = useState(true)
  const [initialScrollDone, setInitialScrollDone] = useState(false)
  const [showModelPicker, setShowModelPicker] = useState(false)
  // Default to claude-opus — premium tier routes to local `claude` CLI
  // using the Max subscription (no API key, no per-call billing). Qwen
  // was the old default but it ran via OpenRouter and confused users
  // who thought daemon was using their Claude subscription. Persisted
  // user preference (loaded from /api/settings below) overrides this.
  const [currentModel, setCurrentModel] = useState('claude-opus')
  // Show tool call details (bash commands, file edits, line counts, output).
  // Persisted in localStorage. Default ON — devs need to see what the agent is doing.
  const [showToolDetails, setShowToolDetails] = useState(true)
  useEffect(() => {
    try {
      const v = localStorage.getItem('daemon_show_tool_details')
      if (v !== null) setShowToolDetails(v === '1')
    } catch {}
  }, [])
  const toggleToolDetails = useCallback(() => {
    setShowToolDetails(prev => {
      const next = !prev
      try { localStorage.setItem('daemon_show_tool_details', next ? '1' : '0') } catch {}
      return next
    })
  }, [])

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

  // Restore project from URL/sessionStorage on mount
  // Sources: sessionStorage (set by /chat/[name]) > localStorage (last-active) > nothing
  useEffect(() => {
    if (typeof window === 'undefined') return
    // 1. Pending project from /chat/[name] redirect
    const pending = sessionStorage.getItem('daemon_pending_project')
    if (pending) {
      sessionStorage.removeItem('daemon_pending_project')
      const pid = parseInt(pending, 10)
      if (!isNaN(pid)) { setActiveProject(pid); return }
    }
    // 2. Last active project (persists across refreshes even on bare /chat)
    const lastActive = localStorage.getItem('daemon_last_project')
    if (lastActive) {
      const pid = parseInt(lastActive, 10)
      if (!isNaN(pid)) setActiveProject(pid)
    }
  }, []) // run once on mount

  // Sync URL to /chat/{name} when active project changes
  useEffect(() => {
    if (typeof window === 'undefined' || !activeProjectId) return
    localStorage.setItem('daemon_last_project', String(activeProjectId))
    // Find project name → update URL
    const proj = projects.find(p => p.id === activeProjectId)
    if (proj) {
      const slug = encodeURIComponent(proj.name)
      const newPath = `/chat/${slug}`
      if (window.location.pathname !== newPath) {
        window.history.replaceState({}, '', newPath)
      }
    }
  }, [activeProjectId, projects])

  // Load most recent thread when switching projects
  useEffect(() => {
    if (activeProjectId) {
      loadProjectThread(activeProjectId)
    } else {
      setChatActiveThread('')
    }
  }, [activeProjectId, loadProjectThread, setChatActiveThread])

  // Live thread updates over WebSocket. The server's chat route writes
  // streaming assistant messages directly to the DB and broadcasts
  // message.created/updated/completed events as they happen — we just apply
  // them to the store. No polling, no race guards, no stale reads.
  useEffect(() => {
    if (!chatActiveThreadId) return
    let cancelled = false
    let unsub: (() => void) | null = null
    import('@/lib/thread-ws').then(({ getThreadWS }) => {
      if (cancelled) return
      const ws = getThreadWS()
      ws.subscribe(chatActiveThreadId)
      unsub = ws.on(applyThreadEvent)
    })
    return () => {
      cancelled = true
      if (unsub) unsub()
    }
  }, [chatActiveThreadId, applyThreadEvent])

  // SLICE-D: subscribe to the WS client's connection-state observable so the
  // header badge always reflects truth. Independent of thread subscription —
  // even with no active thread we want to show "agent home offline" if the
  // relay's WS is unreachable.
  useEffect(() => {
    let cancelled = false
    let unsub: (() => void) | null = null
    import('@/lib/thread-ws').then(({ getThreadWS }) => {
      if (cancelled) return
      const ws = getThreadWS()
      unsub = ws.onConnectionState((state, lastSeenAt) => {
        setWsState(state)
        setWsLastSeen(lastSeenAt)
      })
    })
    return () => {
      cancelled = true
      if (unsub) unsub()
    }
  }, [])

  // SLICE-D: re-render the badge once a minute so the "last seen Xm ago"
  // label stays fresh without coupling to message events.
  useEffect(() => {
    if (wsState !== 'offline') return
    const t = setInterval(() => setWsNowTick(Date.now()), 30_000)
    return () => clearInterval(t)
  }, [wsState])

  // When the active project changes, kick the JSONL sync once via the
  // messages GET. This is a one-time pull-on-open; live updates after that
  // arrive via the WS subscription above.
  useEffect(() => {
    if (!chatActiveThreadId) return
    fetch(`/api/threads/${chatActiveThreadId}/messages?limit=1&t=${Date.now()}`, { cache: 'no-store' })
      .catch(() => {})
  }, [chatActiveThreadId])

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

  // Track whether user has scrolled up from the bottom
  const userScrolledUp = useRef(false)

  // Build a stable "tail key" that only changes when the actual last message
  // changes (new id, or content grew during streaming). The polling refresh
  // creates new array references on every tick — depending on the array
  // itself would re-fire this effect (and re-scroll) every 6s for no reason.
  const tail = displayMessages[displayMessages.length - 1]
  const tailKey = `${displayMessages.length}|${tail?.id || ''}|${tail?.content?.length || 0}`

  // Scroll to bottom on new messages — but only if user hasn't scrolled up
  useEffect(() => {
    if (!initialScrollDone) {
      // First load: always jump to bottom instantly
      endRef.current?.scrollIntoView({ behavior: 'instant' })
      if (displayMessages.length > 0) {
        setInitialScrollDone(true)
      }
    } else if (!userScrolledUp.current) {
      endRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tailKey, initialScrollDone])

  // Reset scroll on project switch
  useEffect(() => {
    setInitialScrollDone(false)
    userScrolledUp.current = false
  }, [activeProjectId])

  const handleScroll = useCallback(() => {
    const el = scrollContainerRef.current
    if (!el) return
    // "Near bottom" = within 150px of the bottom edge
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    userScrolledUp.current = distFromBottom > 150
  }, [])

  // SLICE-B: parse the `@<token>` immediately to the left of the caret.
  // Returns the token (without `@`) and the start index of the `@`,
  // or null if no active mention. Word-boundary so emails like
  // "user@host.com" don't trigger the menu.
  const parseAtMentionAtCaret = useCallback((value: string, caret: number): { token: string; start: number } | null => {
    if (caret <= 0) return null
    // Walk back from caret looking for `@` preceded by start-of-string or whitespace.
    let i = caret - 1
    while (i >= 0) {
      const ch = value[i]
      if (ch === '@') {
        const prev = i > 0 ? value[i - 1] : ' '
        if (i === 0 || /\s/.test(prev)) {
          const token = value.slice(i + 1, caret)
          // Stop if the token contains a space — that means the mention ended
          if (/\s/.test(token)) return null
          return { token, start: i }
        }
        return null
      }
      if (/\s/.test(ch)) return null
      i--
    }
    return null
  }, [])

  // SLICE-B: fetch the active project's file tree (with 30s in-memory cache
  // mirroring the server cache so a busy `@` typer doesn't even hit the API).
  const fetchProjectTree = useCallback(async (projectId: number): Promise<string[]> => {
    const now = Date.now()
    const cache = projectTreeCache.current
    if (cache.projectId === projectId && now - cache.fetchedAt < 30_000) {
      return cache.paths
    }
    try {
      const res = await fetch(`/api/files/tree?project_id=${projectId}`)
      if (!res.ok) return []
      const data = await res.json()
      const paths: string[] = Array.isArray(data?.paths) ? data.paths : []
      projectTreeCache.current = { projectId, paths, fetchedAt: now }
      return paths
    } catch {
      return []
    }
  }, [])

  // SLICE-B: when input or caret changes, recompute @-mention state.
  // Caret tracking via onSelect on the textarea (wired below).
  const updateAtMention = useCallback(async (value: string, caret: number) => {
    const m = parseAtMentionAtCaret(value, caret)
    if (!m) {
      setAtQuery(null)
      setAtMatches([])
      setAtSelected(0)
      return
    }
    setAtQuery(m.token)
    setAtSelected(0)
    if (!activeProjectId) {
      setAtMatches([])
      return
    }
    const paths = await fetchProjectTree(activeProjectId)
    const q = m.token.toLowerCase()
    // Match by basename startsWith first, then full-path contains
    const lower = paths.map((p) => p.toLowerCase())
    const startsWith: string[] = []
    const contains: string[] = []
    for (let i = 0; i < paths.length; i++) {
      const lp = lower[i]
      const slash = lp.lastIndexOf('/')
      const base = slash >= 0 ? lp.slice(slash + 1) : lp
      if (q === '' || base.startsWith(q)) startsWith.push(paths[i])
      else if (lp.includes(q)) contains.push(paths[i])
    }
    setAtMatches([...startsWith, ...contains].slice(0, 8))
  }, [activeProjectId, fetchProjectTree, parseAtMentionAtCaret])

  // SLICE-B: insert the chosen filename into the input where the @-token started.
  const insertMention = useCallback((path: string) => {
    const ta = inputRef.current
    if (!ta) return
    const caret = ta.selectionStart ?? inputDraft.length
    const m = parseAtMentionAtCaret(inputDraft, caret)
    if (!m) return
    // Replace `@<token>` with `@<path> ` (trailing space for ergonomics)
    const before = inputDraft.slice(0, m.start)
    const after = inputDraft.slice(caret)
    const next = `${before}@${path} ${after}`
    setInputDraft(next)
    setAtQuery(null)
    setAtMatches([])
    setAtSelected(0)
    // Restore caret after the inserted token
    requestAnimationFrame(() => {
      const newCaret = before.length + 1 + path.length + 1
      try { ta.setSelectionRange(newCaret, newCaret); ta.focus() } catch {}
    })
  }, [inputDraft, parseAtMentionAtCaret, setInputDraft])

  // SLICE-B: extract every `@<path>` mention from a message body. Same
  // word-boundary rule as parseAtMentionAtCaret. Used by send() to populate
  // mentionedFiles in the API request.
  const extractMentions = useCallback((text: string): string[] => {
    const matches: string[] = []
    const re = /(^|\s)@([^\s@]+)/g
    let m: RegExpExecArray | null
    while ((m = re.exec(text)) !== null) {
      const path = m[2]
      // Strip trailing punctuation that's almost certainly not part of a path
      const cleaned = path.replace(/[.,;:!?)]+$/, '')
      if (cleaned && !matches.includes(cleaned)) matches.push(cleaned)
    }
    return matches
  }, [])

  const send = useCallback(async () => {
    const text = inputDraft.trim()
    if (!text) return

    // SLICE-A: if a stream is in flight, queue the followup instead of firing a parallel POST.
    // Auto-fires ~200ms after the current stream finalizes (see effect below).
    // Last-write-wins: a second Enter while queued replaces the queued text.
    if (isProcessing) {
      setQueuedFollowup(text)
      setInputDraft('')
      return
    }

    // User just sent a message — they want to see the response
    userScrolledUp.current = false

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
      // SLICE-A: /restart prints the systemctl command into the chat as a local-only daemon msg.
      // No API call — auto-restart is deferred (DOGFOOD_BUILD_PLAN.md §7).
      if (slashMatch.command.actionId === 'print_restart_command') {
        let tid = chatActiveThreadId
        if (!tid) tid = createChatThread()
        addMessage(tid!, {
          id: crypto.randomUUID(),
          role: 'user',
          content: text,
          timestamp: new Date().toISOString(),
        })
        addMessage(tid!, {
          id: crypto.randomUUID(),
          role: 'daemon',
          content: 'To restart the relay, run from your terminal: `sudo systemctl restart daemon-web.service`. (Auto-restart deferred — see DOGFOOD_BUILD_PLAN.md §7.)',
          timestamp: new Date().toISOString(),
        })
        setInputDraft('')
      }
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

    // Generate the user-message id client-side and pass it to the API so the
    // server's broadcast (`message.created` via WS) is idempotent with the
    // local row we just added. Without this, every sent message shows twice
    // — the local one (client UUID) and the WS one (server UUID). Very
    // obvious with long pasted text.
    const userMsgId = crypto.randomUUID()
    addMessage(tid!, {
      id: userMsgId,
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
          // SLICE-B: extract `@<path>` mentions from the original (untrimmed-of-mentions)
          // user text and include in the body so the relay can pre-fetch their content
          // and inject as system context (saves the agent a round-trip read_file).
          body: JSON.stringify({ message: actualMessage, threadId: tid, projectId: activeProjectId, stream: true, userMessageId: userMsgId, daemonMessageId: daemonMsgId, mentionedFiles: extractMentions(text) }),
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
  // SLICE-B: extractMentions added to deps for mentionedFiles POST
  }, [inputDraft, isProcessing, chatActiveThreadId, createChatThread, addMessage, appendToLastDaemon, addToolCallToLastDaemon, updateToolCallResult, updateLastDaemon, setInputDraft, setProcessing, setQueuedFollowup, activeProjectId, setChatActiveThread, extractMentions])

  // SLICE-A: ref to latest send() so the auto-fire effect doesn't capture a stale closure.
  const sendRef = useRef(send)
  useEffect(() => { sendRef.current = send }, [send])

  // SLICE-A: when the in-flight stream finalizes and we have a queued followup,
  // hydrate the input with it and auto-fire ~200ms later. The 200ms beat is
  // perceptible to Arthur ("yes, my queued message is going") without lagging.
  useEffect(() => {
    if (isProcessing) return
    if (!queuedFollowup) return
    const queued = queuedFollowup
    setQueuedFollowup(null)
    setInputDraft(queued)
    const t = setTimeout(() => {
      // Re-check: if user typed over it or we're streaming again, skip.
      const state = useChatStore.getState()
      if (state.isProcessing) return
      if (state.inputDraft.trim() !== queued.trim()) return
      sendRef.current()
    }, 200)
    return () => clearTimeout(t)
  }, [isProcessing, queuedFollowup, setQueuedFollowup, setInputDraft])

  return (
    <div className="flex bg-[#0a0a0a] text-[#bfbfbf] chat-container overflow-hidden" style={{ height: '100dvh', minHeight: '-webkit-fill-available', maxWidth: '100vw' }}>
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
            {/* SLICE-D: WS health badge. Shows online (muted dot), reconnecting
                (yellow + label), or offline (red + relative-last-seen).
                Truth-on-disconnect per project_daemon_web_ux.md invariant 1. */}
            {(() => {
              // SLICE-D: render-time format helper. Inline so it doesn't
              // collide with anything else in chat/page.tsx.
              const ago = (() => {
                if (!wsLastSeen) return null
                const ms = Math.max(0, wsNowTick - wsLastSeen)
                if (ms < 60_000) return `${Math.floor(ms / 1000)}s ago`
                if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`
                return `${Math.floor(ms / 3_600_000)}h ago`
              })()
              if (wsState === 'online') {
                return (
                  <div
                    className="hidden sm:flex items-center gap-1.5 px-2 py-1 rounded-full bg-[#1a1a1a] border border-[#282828]"
                    title="Relay WebSocket online"
                  >
                    <span className="inline-block w-2 h-2 rounded-full bg-emerald-500" />
                    <span className="text-[10px] text-[#666]">online</span>
                  </div>
                )
              }
              if (wsState === 'connecting' || wsState === 'reconnecting') {
                return (
                  <div
                    className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-[#1a1a1a] border border-yellow-500/40"
                    title={wsState === 'connecting' ? 'Connecting to relay...' : 'Reconnecting to relay...'}
                  >
                    <span className="inline-block w-2 h-2 rounded-full bg-yellow-500 animate-pulse" />
                    <span className="text-[10px] text-yellow-400">{wsState === 'connecting' ? 'connecting...' : 'reconnecting...'}</span>
                  </div>
                )
              }
              // offline
              return (
                <div
                  className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-[#1a1a1a] border border-red-500/50"
                  title="Daemon relay unreachable. Heartbeat watchdog tripped."
                >
                  <span className="inline-block w-2 h-2 rounded-full bg-red-500" />
                  <span className="text-[10px] text-red-400">
                    agent home offline{ago ? ` (last seen ${ago})` : ''}
                  </span>
                </div>
              )
            })()}
            {/* Pendant badge — connection + battery, polled every 10s.
                Hidden when state is unknown (no device has reported yet)
                so it doesn't render a misleading dot pre-pairing. */}
            {pendant && pendant.connected !== null && (
              <div
                className="hidden sm:flex items-center gap-1.5 px-2 py-1 rounded-full bg-[#1a1a1a] border border-[#282828]"
                title={pendant.connected
                  ? `Pendant connected${pendant.batteryPercent != null ? ` · ${pendant.batteryPercent}%` : ''}`
                  : 'Pendant disconnected'}
              >
                <span
                  className={`inline-block w-2 h-2 rounded-full ${
                    pendant.stale ? 'bg-zinc-500'
                      : pendant.connected ? 'bg-emerald-500'
                      : 'bg-red-500'
                  }`}
                />
                <span className="text-[10px] text-[#666]">
                  pendant{pendant.batteryPercent != null ? ` ${pendant.batteryPercent}%` : ''}
                </span>
              </div>
            )}
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
            {/* Show/hide tool details (bash, edits, line counts) */}
            <button
              onClick={toggleToolDetails}
              className={`tap-target transition-colors ${showToolDetails ? 'text-[#ff0505]' : 'text-[#555] hover:text-[#888]'}`}
              title={showToolDetails ? 'Hide tool details' : 'Show tool details'}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="4 17 10 11 4 5" />
                <line x1="12" y1="19" x2="20" y2="19" />
              </svg>
            </button>
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
          className="flex-1 overflow-y-auto overflow-x-hidden px-4 py-4 min-h-0"
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
                  <MessageBubble key={m.id} message={m} showToolDetails={showToolDetails} />
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
            {/* SLICE-A: queued-followup badge — visible when user pressed Enter while streaming. */}
            {queuedFollowup && (
              <div className="max-w-2xl mx-auto mb-1 flex items-center gap-2 px-3 py-1 rounded-lg bg-[#161616] border border-[#282828]">
                <span className="text-[10px] font-mono uppercase tracking-wider text-[#ff0505]">queued</span>
                <span className="text-xs text-[#888] truncate flex-1">{queuedFollowup}</span>
                <button
                  onClick={() => setQueuedFollowup(null)}
                  className="text-[10px] text-[#666] hover:text-white"
                  title="Cancel queued followup"
                >cancel</button>
              </div>
            )}
            {/* SLICE-B: @-mention popover. Shown only when there's an active @<token>
                at the caret AND the input doesn't start with `/` (slash menu wins). */}
            {atQuery !== null && !inputDraft.startsWith('/') && (
              <AtMentionMenu
                matches={atMatches}
                selectedIndex={atSelected}
                onSelect={(p) => insertMention(p)}
                onHover={(i) => setAtSelected(i)}
              />
            )}
            <div className="flex items-end gap-2 max-w-2xl mx-auto">
              <textarea
                ref={inputRef}
                value={inputDraft}
                onChange={(e) => {
                  setInputDraft(e.target.value)
                  // SLICE-B: refresh @-mention state on every change
                  const c = e.target.selectionStart ?? e.target.value.length
                  updateAtMention(e.target.value, c)
                }}
                onSelect={(e) => {
                  // SLICE-B: caret moved (click / arrow) — re-evaluate @-mention.
                  const t = e.currentTarget
                  updateAtMention(t.value, t.selectionStart ?? t.value.length)
                }}
                onKeyDown={(e) => {
                  // SLICE-B: when the @-mention popover is open with matches,
                  // intercept ArrowUp/Down/Enter/Escape/Tab.
                  if (atQuery !== null && atMatches.length > 0 && !inputDraft.startsWith('/')) {
                    if (e.key === 'ArrowDown') {
                      e.preventDefault()
                      setAtSelected((i) => (i + 1) % atMatches.length)
                      return
                    }
                    if (e.key === 'ArrowUp') {
                      e.preventDefault()
                      setAtSelected((i) => (i - 1 + atMatches.length) % atMatches.length)
                      return
                    }
                    if (e.key === 'Enter' || e.key === 'Tab') {
                      e.preventDefault()
                      insertMention(atMatches[atSelected])
                      return
                    }
                    if (e.key === 'Escape') {
                      e.preventDefault()
                      setAtQuery(null)
                      setAtMatches([])
                      return
                    }
                  }
                  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
                }}
                placeholder="Message your daemon... (type / for commands, @ for files)"
                rows={1}
                className="flex-1 resize-none rounded-2xl border border-[#282828] bg-[#161616] px-4 py-1.5 text-sm text-white placeholder-[#666] focus:outline-none focus:border-[#ff0505]/40"
                style={{ minHeight: 36, maxHeight: 500, overflowY: 'auto', lineHeight: '1.4' }}
              />
              <MicButton onTranscript={(text) => setInputDraft(inputDraft + (inputDraft ? ' ' : '') + text)} />
              <button
                onClick={send}
                disabled={!inputDraft.trim()}
                className="p-2 min-w-[36px] min-h-[36px] flex items-center justify-center rounded-full bg-[#ff0505] text-white disabled:opacity-40 hover:bg-[#dd0404] transition-colors shrink-0"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="m5 12 7-7 7 7"/><path d="M12 19V5"/></svg>
              </button>
            </div>
        </div>
      </div>
    </div>
  )
}
