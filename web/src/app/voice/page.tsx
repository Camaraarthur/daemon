'use client'

import { useState, useRef, useEffect, useCallback } from 'react'

interface TranscriptEntry {
  role: 'user' | 'model'
  text: string
  timestamp: number
}

interface BrainStatus {
  action: string
  count: number
}

// PCM16 audio playback via Web Audio API
class PCMPlayer {
  private ctx: AudioContext | null = null
  private queue: Float32Array[] = []
  private playing = false
  private nextTime = 0

  start() {
    this.ctx = new AudioContext({ sampleRate: 24000 })
    this.nextTime = 0
    this.playing = true
  }

  feed(pcm16: ArrayBuffer) {
    if (!this.ctx || !this.playing) return
    const int16 = new Int16Array(pcm16)
    const float32 = new Float32Array(int16.length)
    for (let i = 0; i < int16.length; i++) {
      float32[i] = int16[i] / 32768
    }

    const buffer = this.ctx.createBuffer(1, float32.length, 24000)
    buffer.getChannelData(0).set(float32)

    const source = this.ctx.createBufferSource()
    source.buffer = buffer
    source.connect(this.ctx.destination)

    const now = this.ctx.currentTime
    const startTime = Math.max(now, this.nextTime)
    source.start(startTime)
    this.nextTime = startTime + buffer.duration
  }

  stop() {
    this.playing = false
    if (this.ctx) {
      this.ctx.close()
      this.ctx = null
    }
  }
}

// PCM16 audio capture via Web Audio API
class PCMCapture {
  private stream: MediaStream | null = null
  private ctx: AudioContext | null = null
  private processor: ScriptProcessorNode | null = null
  onData: ((data: ArrayBuffer) => void) | null = null

  async start() {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        sampleRate: 16000,
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    })

    this.ctx = new AudioContext({ sampleRate: 16000 })
    const source = this.ctx.createMediaStreamSource(this.stream)

    // Use ScriptProcessorNode for raw PCM access
    // (AudioWorklet would be cleaner but more setup)
    this.processor = this.ctx.createScriptProcessor(4096, 1, 1)
    this.processor.onaudioprocess = (e) => {
      const float32 = e.inputBuffer.getChannelData(0)
      const int16 = new Int16Array(float32.length)
      for (let i = 0; i < float32.length; i++) {
        const s = Math.max(-1, Math.min(1, float32[i]))
        int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff
      }
      this.onData?.(int16.buffer)
    }

    source.connect(this.processor)
    this.processor.connect(this.ctx.destination)
  }

  stop() {
    this.processor?.disconnect()
    this.stream?.getTracks().forEach(t => t.stop())
    this.ctx?.close()
    this.stream = null
    this.ctx = null
    this.processor = null
  }
}

export default function VoicePage() {
  const [status, setStatus] = useState<'idle' | 'connecting' | 'connected' | 'error'>('idle')
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([])
  const [brainStatus, setBrainStatus] = useState<BrainStatus>({ action: '', count: 0 })
  const [error, setError] = useState<string>('')

  const wsRef = useRef<WebSocket | null>(null)
  const captureRef = useRef<PCMCapture | null>(null)
  const playerRef = useRef<PCMPlayer | null>(null)
  const transcriptEndRef = useRef<HTMLDivElement>(null)

  // Auto-scroll transcript
  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [transcript])

  const connect = useCallback(async () => {
    try {
      setStatus('connecting')
      setError('')
      setTranscript([])

      // Connect WebSocket to voice companion server
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      // Direct to voice companion server, or through proxy via /ws/voice
      const wsUrl = window.location.port === '4803'
        ? `${protocol}//${window.location.host}/ws`
        : `${protocol}//${window.location.hostname}:4803/ws`
      const ws = new WebSocket(wsUrl)
      wsRef.current = ws

      // Start audio player
      const player = new PCMPlayer()
      player.start()
      playerRef.current = player

      ws.onopen = () => {
        // Tell server to start Gemini session
        ws.send(JSON.stringify({ type: 'connect' }))
      }

      ws.onmessage = (event) => {
        const data = JSON.parse(event.data)

        switch (data.type) {
          case 'audio':
            // Decode base64 PCM and play
            const raw = atob(data.data)
            const bytes = new Uint8Array(raw.length)
            for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i)
            player.feed(bytes.buffer)
            break

          case 'transcript':
            setTranscript(prev => [...prev, {
              role: data.role,
              text: data.text,
              timestamp: Date.now() / 1000,
            }])
            break

          case 'status':
            if (data.state === 'connected') {
              setStatus('connected')
              // Start mic capture
              startCapture(ws)
            } else if (data.state === 'disconnected') {
              setStatus('idle')
            } else if (data.state === 'error') {
              setStatus('error')
              setError(data.message || 'Connection failed')
            }
            break

          case 'brain_update':
            setBrainStatus({ action: data.action, count: data.count })
            break
        }
      }

      ws.onerror = () => {
        setStatus('error')
        setError('WebSocket connection failed. Is the voice companion server running?')
      }

      ws.onclose = () => {
        setStatus('idle')
        captureRef.current?.stop()
        playerRef.current?.stop()
      }
    } catch (e: any) {
      setStatus('error')
      setError(e.message || 'Failed to connect')
    }
  }, [])

  const startCapture = useCallback(async (ws: WebSocket) => {
    const capture = new PCMCapture()
    capture.onData = (pcm) => {
      if (ws.readyState === WebSocket.OPEN) {
        // Send as binary for efficiency
        ws.send(pcm)
      }
    }
    await capture.start()
    captureRef.current = capture
  }, [])

  const disconnect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'disconnect' }))
    }
    wsRef.current?.close()
    captureRef.current?.stop()
    playerRef.current?.stop()
    setStatus('idle')
  }, [])

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-[#bfbfbf] flex flex-col">
      {/* Header */}
      <header className="border-b border-[#1a1a1a] px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <a href="/chat" className="text-[#555] hover:text-[#888] text-sm">← chat</a>
          <h1 className="text-lg font-medium text-white">voice companion</h1>
        </div>
        <div className="flex items-center gap-3">
          {brainStatus.count > 0 && (
            <div className="flex items-center gap-2 text-xs">
              <div className={`w-2 h-2 rounded-full ${
                brainStatus.action === 'THINKING' ? 'bg-yellow-500 animate-pulse' :
                brainStatus.action === 'UPDATED' ? 'bg-green-500' :
                'bg-[#333]'
              }`} />
              <span className="text-[#666]">
                brain: {brainStatus.count} update{brainStatus.count !== 1 ? 's' : ''}
              </span>
            </div>
          )}
        </div>
      </header>

      {/* Transcript */}
      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
        {transcript.length === 0 && status === 'idle' && (
          <div className="flex flex-col items-center justify-center h-full text-center text-[#444] space-y-4 pt-32">
            <div className="w-20 h-20 rounded-full border-2 border-[#222] flex items-center justify-center">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                <line x1="12" y1="19" x2="12" y2="23" />
                <line x1="8" y1="23" x2="16" y2="23" />
              </svg>
            </div>
            <p className="text-sm max-w-md">
              Talk to your daemon. It knows you — your messages, notes, recordings, years of history.
              Claude runs in the background, feeding context to the conversation in real-time.
            </p>
          </div>
        )}

        {transcript.map((entry, i) => (
          <div
            key={i}
            className={`flex ${entry.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div className={`max-w-[75%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
              entry.role === 'user'
                ? 'bg-[#1a1a1a] text-[#ccc] border border-[#282828]'
                : 'bg-[#111] text-[#999] border border-[#1a1a1a]'
            }`}>
              <div className="text-[10px] text-[#444] mb-1">
                {entry.role === 'user' ? 'you' : 'companion'}
              </div>
              {entry.text}
            </div>
          </div>
        ))}

        {status === 'connected' && (
          <div className="flex justify-center">
            <div className="flex items-center gap-2 text-xs text-[#444]">
              <div className="flex gap-1">
                <div className="w-1.5 h-1.5 rounded-full bg-[#ff0505] animate-pulse" />
                <div className="w-1.5 h-1.5 rounded-full bg-[#ff0505] animate-pulse" style={{ animationDelay: '0.2s' }} />
                <div className="w-1.5 h-1.5 rounded-full bg-[#ff0505] animate-pulse" style={{ animationDelay: '0.4s' }} />
              </div>
              <span>listening</span>
            </div>
          </div>
        )}

        <div ref={transcriptEndRef} />
      </div>

      {/* Controls */}
      <div className="border-t border-[#1a1a1a] px-6 py-6 flex flex-col items-center gap-4">
        {error && (
          <p className="text-xs text-red-400 max-w-md text-center">{error}</p>
        )}

        <button
          onClick={status === 'connected' ? disconnect : connect}
          disabled={status === 'connecting'}
          className={`w-20 h-20 rounded-full flex items-center justify-center transition-all ${
            status === 'connected'
              ? 'bg-[#ff0505] text-white shadow-[0_0_30px_rgba(255,5,5,0.3)] hover:shadow-[0_0_40px_rgba(255,5,5,0.4)]'
              : status === 'connecting'
                ? 'bg-[#1a1a1a] text-[#555] border border-[#282828] animate-pulse cursor-wait'
                : 'bg-[#1a1a1a] text-[#888] border border-[#282828] hover:border-[#ff0505] hover:text-[#ff0505]'
          }`}
        >
          {status === 'connected' ? (
            // Stop icon
            <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
              <rect x="6" y="6" width="12" height="12" rx="2" />
            </svg>
          ) : status === 'connecting' ? (
            // Loading
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="animate-spin">
              <circle cx="12" cy="12" r="10" strokeOpacity="0.2" />
              <path d="M12 2a10 10 0 0 1 10 10" />
            </svg>
          ) : (
            // Mic icon
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              <line x1="12" y1="19" x2="12" y2="23" />
              <line x1="8" y1="23" x2="16" y2="23" />
            </svg>
          )}
        </button>

        <p className="text-xs text-[#444]">
          {status === 'connected' ? 'tap to end session' :
           status === 'connecting' ? 'connecting to gemini live...' :
           'tap to start talking'}
        </p>
      </div>
    </div>
  )
}
