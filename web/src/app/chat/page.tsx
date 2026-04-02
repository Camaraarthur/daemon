'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { useChatStore, Message } from '@/store/chat'
import { useDeviceStore, Device } from '@/store/devices'
import { VoiceClient } from '@/lib/voice-client'
import Image from 'next/image'

interface DeviceInfo {
  id: string
  name: string
  platform: string
  ip: string
  status: string
  capabilities: string[]
  network: string
}

function DevicePanel() {
  const [devices, setDevices] = useState<DeviceInfo[]>([])
  const [expanded, setExpanded] = useState(false)
  const [wsDevices, setWsDevices] = useState<any[]>([])

  useEffect(() => {
    fetch('/api/devices')
      .then(r => r.json())
      .then(d => {
        if (d.devices) {
          setDevices(d.devices.map((dev: any) => ({
            id: dev.id,
            name: dev.name,
            platform: dev.platform,
            ip: dev.ip,
            status: dev.status,
            network: dev.connection,
            capabilities: dev.capabilities || [],
          })))
        }
      })
      .catch(() => {})
  }, [])

  // Use the real device data from API — no hardcoded devices
  const allDevices = devices

  return (
    <div className="p-2 space-y-2">
      <div className="text-[10px] text-[#444] px-1 mb-2">
        {allDevices.filter(d => d.status === 'online').length}/{allDevices.length} online
      </div>
      {allDevices.map(d => (
        <div key={d.id} className="bg-[#111] border border-[#222] rounded-xl p-3">
          <div className="flex items-center justify-between mb-1.5">
            <div className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${d.status === 'online' ? 'bg-green-500' : 'bg-[#333]'}`} />
              <span className="text-xs font-medium text-white">{d.name}</span>
            </div>
            <span className="text-[9px] text-[#333]">{d.platform}</span>
          </div>
          <div className="flex items-center gap-1 mb-1">
            <span className="text-[9px] text-[#444]">{d.network}</span>
            <span className="text-[9px] text-[#333]">·</span>
            <span className="text-[9px] text-[#333]">{d.ip}</span>
          </div>
          <div className="flex flex-wrap gap-1">
            {d.capabilities.map(c => (
              <span key={c} className="text-[9px] px-1.5 py-0.5 bg-[#1a1a1a] text-[#555] rounded">{c}</span>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function MicButton({ onTranscript }: { onTranscript: (text: string) => void }) {
  const [listening, setListening] = useState(false)
  const [ws, setWs] = useState<WebSocket | null>(null)
  const [mediaRec, setMediaRec] = useState<MediaRecorder | null>(null)

  const toggle = useCallback(async () => {
    if (listening) {
      // Stop
      mediaRec?.stop()
      ws?.close()
      setListening(false)
      setMediaRec(null)
      setWs(null)
      return
    }

    try {
      // Get Deepgram key
      const keyRes = await fetch('/api/voice')
      const { key } = await keyRes.json()
      if (!key) return

      // Get mic
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      })

      // Connect to Deepgram
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
      className={`p-2.5 rounded-full transition-colors shrink-0 ${
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

function ChatBubble({ message }: { message: Message }) {
  const isUser = message.role === 'user'
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-2.5`}>
      <div className={`max-w-[85%] sm:max-w-[70%] rounded-2xl px-4 py-2.5 text-[13px] leading-relaxed ${
        isUser
          ? 'bg-[#ff0505] text-white'
          : 'bg-[#181818] text-[#ddd] border border-[#252525]'
      }`}>
        <p className="whitespace-pre-wrap">{message.content}</p>
      </div>
    </div>
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

  // Not loaded yet
  if (authed === null) {
    return <div className="min-h-[100dvh] bg-[#0a0a0a] flex items-center justify-center"><div className="text-[#333] text-sm">loading...</div></div>
  }

  // Not authenticated — show login form
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
    <div className="min-h-[100dvh] bg-[#0a0a0a] flex flex-col items-center justify-center px-6">
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
    getActiveThread, addMessage, setInputDraft, inputDraft,
    isProcessing, setProcessing, createThread, activeThreadId, threads,
    setActiveThread,
  } = useChatStore()
  const endRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const [statusText, setStatusText] = useState('')
  const [showSidebar, setShowSidebar] = useState(false)

  const thread = getActiveThread()

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [thread?.messages])

  const send = useCallback(async () => {
    const text = inputDraft.trim()
    if (!text || isProcessing) return

    let tid = activeThreadId
    if (!tid) tid = createThread()

    addMessage(tid!, {
      id: crypto.randomUUID(),
      role: 'user',
      content: text,
      timestamp: new Date().toISOString(),
    })
    setInputDraft('')
    setProcessing(true)
    setStatusText('thinking...')

    // Animate status
    const steps = ['thinking...', 'reasoning...', 'checking devices...', 'processing...']
    let i = 0
    const interval = setInterval(() => { setStatusText(steps[++i % steps.length]) }, 3000)

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, threadId: tid }),
      })
      const data = await res.json()
      addMessage(tid!, {
        id: crypto.randomUUID(),
        role: 'daemon',
        content: data.response || data.error || 'No response',
        timestamp: new Date().toISOString(),
      })
    } catch (err) {
      addMessage(tid!, {
        id: crypto.randomUUID(),
        role: 'system',
        content: `Connection error: ${err}`,
        timestamp: new Date().toISOString(),
      })
    } finally {
      clearInterval(interval)
      setProcessing(false)
      setStatusText('')
      inputRef.current?.focus()
    }
  }, [inputDraft, isProcessing, activeThreadId, createThread, addMessage, setInputDraft, setProcessing])

  const [showDevices, setShowDevices] = useState(true)

  return (
    <div className="flex h-[100dvh] bg-[#0a0a0a] text-[#bfbfbf]">
      {/* Left sidebar — chat threads, hidden on mobile */}
      {showSidebar && (
        <div className="fixed inset-0 z-50 flex sm:relative sm:inset-auto">
          <div className="w-56 bg-[#111] border-r border-[#222] flex flex-col">
            <div className="p-4 flex items-center justify-between border-b border-[#222]">
              <Image src="/brand/favicon.png" alt="d" width={24} height={24} />
              <button onClick={() => createThread()} className="text-[10px] px-2 py-1 bg-[#1a1a1a] rounded-md text-[#888] hover:text-white">+ new</button>
            </div>
            <div className="flex-1 overflow-y-auto p-2">
              {threads.map((t) => (
                <button
                  key={t.id}
                  onClick={() => { setActiveThread(t.id); setShowSidebar(false) }}
                  className={`w-full text-left p-2.5 rounded-xl text-xs mb-1 truncate ${
                    activeThreadId === t.id ? 'bg-[#1a1a1a] text-white' : 'text-[#888] hover:bg-[#181818]'
                  }`}
                >
                  {t.title}
                </button>
              ))}
            </div>
          </div>
          <div className="flex-1 bg-black/50 sm:hidden" onClick={() => setShowSidebar(false)} />
        </div>
      )}

      {/* Main chat area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <div className="h-12 border-b border-[#222] flex items-center justify-between px-3 bg-[#111] shrink-0">
          <div className="flex items-center gap-3">
            <button onClick={() => setShowSidebar(!showSidebar)} className="p-1">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#666" strokeWidth="2"><path d="M3 12h18M3 6h18M3 18h18"/></svg>
            </button>
            <Image src="/brand/favicon.png" alt="daemon" width={20} height={20} />
            <span className="text-sm font-medium text-white">My</span>
            <span className="text-xs text-[#888]">daemon</span>
          </div>
          <button onClick={() => setShowDevices(!showDevices)} className="p-1 sm:hidden">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={showDevices ? '#ff0505' : '#666'} strokeWidth="2"><circle cx="12" cy="12" r="3"/><path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83"/></svg>
          </button>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-4">
          {!thread || thread.messages.length === 0 ? (
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                <Image src="/brand/app-icon.png" alt="daemon" width={60} height={60} className="mx-auto mb-4" />
                <p className="text-xs text-[#777]">say something</p>
              </div>
            </div>
          ) : (
            <>
              {thread.messages.map((m) => (
                <ChatBubble key={m.id} message={m} />
              ))}
              {isProcessing && (
                <div className="flex items-center gap-2 mb-2.5 px-1">
                  <div className="flex gap-1">
                    {[0, 1, 2].map((i) => (
                      <div key={i} className="w-1.5 h-1.5 bg-[#ff0505] rounded-full animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />
                    ))}
                  </div>
                  <span className="text-[10px] text-[#777]">{statusText}</span>
                </div>
              )}
              <div ref={endRef} />
            </>
          )}
        </div>

        {/* Input */}
        <div className="border-t border-[#222] p-3 bg-[#111] shrink-0">
          <div className="flex items-end gap-2 max-w-2xl mx-auto">
            <textarea
              ref={inputRef}
              value={inputDraft}
              onChange={(e) => setInputDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
              placeholder="Message your daemon..."
              rows={1}
              className="flex-1 resize-none rounded-2xl border border-[#282828] bg-[#161616] px-4 py-2.5 text-sm text-white placeholder-[#666] focus:outline-none focus:border-[#ff0505]/40"
            />
            <MicButton onTranscript={(text) => setInputDraft(inputDraft + (inputDraft ? ' ' : '') + text)} />
            <button
              onClick={send}
              disabled={isProcessing || !inputDraft.trim()}
              className="p-2.5 rounded-full bg-[#ff0505] text-white disabled:opacity-40 hover:bg-[#dd0404] transition-colors shrink-0"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="m5 12 7-7 7 7"/><path d="M12 19V5"/></svg>
            </button>
          </div>
        </div>
      </div>

      {/* Right sidebar — devices (always visible on desktop, toggleable on mobile) */}
      <div className={`${showDevices ? 'block' : 'hidden'} sm:block w-full sm:w-72 border-l border-[#222] bg-[#111] fixed right-0 top-0 h-full sm:relative sm:right-auto z-40 overflow-y-auto`}>
        <div className="p-3 border-b border-[#222] flex items-center justify-between">
          <span className="text-xs font-semibold text-[#888] uppercase tracking-wider">Devices</span>
          <button onClick={() => setShowDevices(false)} className="sm:hidden text-[#555]">✕</button>
        </div>
        <DevicePanel />
      </div>
    </div>
  )
}
