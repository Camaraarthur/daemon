'use client'

import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import styles from './canvas.module.css'

type CanvasEvent =
  | { type: 'idle'; data?: any }
  | { type: 'clear'; data?: any }
  | { type: 'text'; data: { text: string; durationMs?: number } }
  | { type: 'html'; data: { html: string; durationMs?: number } }
  | { type: 'card'; data: { title: string; body: string; image_url?: string } }
  | { type: 'image'; data: { url?: string; image_url?: string; caption?: string; title?: string } }
  | { type: 'camera'; data: { url?: string; image_url?: string; caption?: string; title?: string; ts?: number } }
  | { type: 'sensor'; data: { distance: number } }

// Strip <script>, on* handlers, and javascript: urls from agent-supplied HTML.
// This is intentionally strict — agent output is untrusted.
function sanitizeHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, '')
    .replace(/\son[a-z]+\s*=\s*"[^"]*"/gi, '')
    .replace(/\son[a-z]+\s*=\s*'[^']*'/gi, '')
    .replace(/javascript:/gi, '')
}

// Font-size hint for plain text: scale with length so short lines are huge
// and long blocks stay readable. Range ~ 5vw down to 2.2vw.
function textSize(text: string): string {
  const len = text.trim().length
  if (len <= 24) return 'clamp(2.5rem, 7vw, 6rem)'
  if (len <= 80) return 'clamp(2rem, 5vw, 4rem)'
  if (len <= 200) return 'clamp(1.5rem, 3.2vw, 2.6rem)'
  return 'clamp(1.15rem, 2.2vw, 1.8rem)'
}

function formatTime(ts?: number): string {
  const d = ts ? new Date(ts) : new Date()
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

export default function DaemonCanvas() {
  const [event, setEvent] = useState<CanvasEvent>({ type: 'idle' })
  const [daemonName, setDaemonName] = useState<string>('')
  const [renderKey, setRenderKey] = useState(0) // force re-trigger fade-in on repeat

  // Small FIFO queue so bursts of events don't stomp each other / flicker.
  const queueRef = useRef<CanvasEvent[]>([])
  const playingRef = useRef(false)
  const sensorHistoryRef = useRef<number[]>([])
  const sensorCanvasRef = useRef<HTMLCanvasElement>(null)

  // Drain queue, one event at a time, with a small gap so the fade can play.
  const drain = useCallback(() => {
    if (playingRef.current) return
    const next = queueRef.current.shift()
    if (!next) return
    playingRef.current = true
    setEvent(next)
    setRenderKey((k) => k + 1)
    // Minimum dwell so the fade-in is visible even if events arrive fast.
    const dwell = next.type === 'sensor' ? 60 : 260
    window.setTimeout(() => {
      playingRef.current = false
      if (queueRef.current.length > 0) drain()
    }, dwell)
  }, [])

  const enqueue = useCallback(
    (ev: CanvasEvent) => {
      // Sensor events compress — only keep the latest one in queue.
      if (ev.type === 'sensor') {
        const q = queueRef.current
        const last = q[q.length - 1]
        if (last && last.type === 'sensor') {
          q[q.length - 1] = ev
        } else {
          q.push(ev)
        }
      } else {
        queueRef.current.push(ev)
      }
      drain()
    },
    [drain],
  )

  // Connect to SSE
  useEffect(() => {
    const es = new EventSource('/api/stream')
    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data) as CanvasEvent
        if (data.type === 'sensor' && data.data) {
          sensorHistoryRef.current = [
            ...sensorHistoryRef.current.slice(-120),
            (data.data as any).distance,
          ]
        }
        if (data.type === 'clear') {
          queueRef.current = []
          sensorHistoryRef.current = []
        }
        enqueue(data)
      } catch {}
    }
    es.onerror = () => {}
    return () => es.close()
  }, [enqueue])

  // Fetch daemon name (optional, graceful fallback)
  useEffect(() => {
    let alive = true
    fetch('/api/me', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!alive || !j) return
        if (typeof j.daemon_name === 'string' && j.daemon_name) {
          setDaemonName(j.daemon_name)
        }
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [])

  // Sensor graph
  useEffect(() => {
    if (event.type !== 'sensor' || !sensorCanvasRef.current) return
    const canvas = sensorCanvasRef.current
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const rect = canvas.parentElement?.getBoundingClientRect()
    if (!rect) return
    const dpr = window.devicePixelRatio || 1
    canvas.width = rect.width * dpr
    canvas.height = rect.height * dpr
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    const w = rect.width
    const h = rect.height
    const history = sensorHistoryRef.current
    const valid = history.filter((v) => v > 0)

    ctx.clearRect(0, 0, w, h)

    // Grid
    ctx.strokeStyle = '#1a1a1a'
    ctx.lineWidth = 0.5
    for (let i = 0; i <= 4; i++) {
      const y = (h / 4) * i
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke()
    }

    if (history.length >= 2 && valid.length >= 1) {
      const padding = 72
      const rawMin = Math.min(...valid)
      const rawMax = Math.max(...valid)
      const range = rawMax - rawMin
      const margin = Math.max(range * 0.1, 2.5)
      const minVal = Math.max(0, rawMin - margin)
      const maxVal = rawMax + margin
      const valRange = maxVal - minVal || 1

      ctx.strokeStyle = '#7c3aed'
      ctx.lineWidth = 2
      ctx.beginPath()
      let started = false
      for (let i = 0; i < history.length; i++) {
        const x = (i / 120) * w
        if (history[i] <= 0) { started = false; continue }
        const y = padding + (h - padding - 20) * (1 - (history[i] - minVal) / valRange)
        if (!started) { ctx.moveTo(x, y); started = true } else { ctx.lineTo(x, y) }
      }
      ctx.stroke()

      if (started) {
        let lastX = 0
        for (let i = history.length - 1; i >= 0; i--) {
          if (history[i] > 0) { lastX = (i / 120) * w; break }
        }
        ctx.lineTo(lastX, h)
        ctx.lineTo(0, h)
        ctx.closePath()
        ctx.fillStyle = 'rgba(124, 58, 237, 0.10)'
        ctx.fill()
      }

      ctx.fillStyle = '#525252'
      ctx.font = '11px var(--font-geist), system-ui'
      ctx.textAlign = 'right'
      for (let i = 0; i <= 4; i++) {
        const val = maxVal - (valRange / 4) * i
        const y = padding + ((h - padding - 20) / 4) * i
        ctx.fillText(`${val.toFixed(0)} cm`, w - 12, y + 4)
      }
      ctx.textAlign = 'left'
    }

    const current = history[history.length - 1]
    if (current > 0) {
      ctx.fillStyle = '#f5f5f5'
      ctx.font = '600 36px var(--font-geist), system-ui'
      ctx.fillText(`${current.toFixed(1)} cm`, 22, 48)
      ctx.fillStyle = '#a3a3a3'
      ctx.font = '12px var(--font-geist), system-ui'
      ctx.fillText('DISTANCE SENSOR', 22, 68)
    } else {
      ctx.fillStyle = '#525252'
      ctx.font = '14px var(--font-geist), system-ui'
      ctx.fillText('sensor: out of range', 22, 40)
    }
  }, [event, renderKey])

  const body = useMemo(() => {
    switch (event.type) {
      case 'idle':
      case 'clear':
        return (
          <div className={styles.idle}>
            <div className={styles.breath}>
              <div className={styles.breathCore} />
            </div>
            <div className={styles.idleLabel}>listening</div>
          </div>
        )

      case 'text': {
        const t = (event.data?.text || '').toString()
        return (
          <div className={styles.textBox} style={{ fontSize: textSize(t) }}>
            {t}
          </div>
        )
      }

      case 'card': {
        const d = event.data || ({} as any)
        const hasImg = !!d.image_url
        return (
          <div className={`${styles.card} ${hasImg ? styles.cardWithImage : ''}`}>
            <div>
              <div className={styles.cardAccent}>Daemon</div>
              <h2 className={styles.cardTitle}>{d.title}</h2>
              <p className={styles.cardBody}>{d.body}</p>
            </div>
            {hasImg && (
              <div className={styles.cardImageWrap}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={d.image_url} alt="" className={styles.cardImage} />
              </div>
            )}
          </div>
        )
      }

      case 'html':
        return (
          <div
            className={styles.prose}
            ref={(el) => {
              if (!el) return
              el.querySelectorAll('a').forEach((a) => {
                a.setAttribute('target', '_blank')
                a.setAttribute('rel', 'noopener noreferrer')
              })
            }}
            dangerouslySetInnerHTML={{
              __html: sanitizeHtml((event.data as any)?.html || ''),
            }}
          />
        )

      case 'image':
      case 'camera': {
        const d = (event.data || {}) as any
        const src = d.url || d.image_url
        if (!src) return null
        const caption = d.caption || d.title || (event.type === 'camera' ? 'Camera' : 'Image')
        return (
          <div className={styles.mediaWrap}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={src} alt={caption} className={styles.media} />
            <div className={styles.mediaCaption}>
              <strong>{caption}</strong>
              <span>{formatTime(d.ts)}</span>
            </div>
          </div>
        )
      }

      case 'sensor':
        return (
          <div className={styles.sensorWrap}>
            <canvas ref={sensorCanvasRef} className={styles.sensorCanvas} />
          </div>
        )

      default:
        return null
    }
  }, [event])

  return (
    <div className={styles.root}>
      <div className={styles.stage}>
        <div key={renderKey} className={styles.frame}>
          {body}
        </div>
      </div>

      <div className={styles.footer}>
        <span className={styles.live}>
          <span className={styles.liveDot} />
          live
        </span>
        <span className={styles.name}>
          {daemonName ? <>daemon <span>/ {daemonName}</span></> : 'daemon'}
        </span>
      </div>
    </div>
  )
}
