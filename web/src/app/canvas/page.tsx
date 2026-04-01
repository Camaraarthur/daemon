'use client'

import { useEffect, useState, useRef, useCallback } from 'react'

interface CanvasState {
  type: 'idle' | 'sensor' | 'camera' | 'text' | 'image'
  data?: any
}

export default function DaemonCanvas() {
  const [state, setState] = useState<CanvasState>({ type: 'idle' })
  const sensorHistoryRef = useRef<number[]>([])
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const idleCanvasRef = useRef<HTMLCanvasElement>(null)
  const animRef = useRef<number>(0)

  // Connect to SSE for live updates
  useEffect(() => {
    const es = new EventSource('/api/stream')
    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data)
        if (data.type === 'sensor') {
          sensorHistoryRef.current = [...sensorHistoryRef.current.slice(-120), data.distance]
          setState({ type: 'sensor', data })
        } else if (data.type === 'camera') {
          setState({ type: 'camera', data })
        } else if (data.type === 'text') {
          setState({ type: 'text', data })
        } else if (data.type === 'clear') {
          setState({ type: 'idle' })
          sensorHistoryRef.current = []
        }
      } catch {}
    }
    es.onerror = () => {}
    return () => es.close()
  }, [])

  // Idle animation — subtle breathing red dot + waveform
  const drawIdle = useCallback(() => {
    const canvas = idleCanvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // Resize to container
    const rect = canvas.parentElement?.getBoundingClientRect()
    if (rect) {
      canvas.width = rect.width * devicePixelRatio
      canvas.height = rect.height * devicePixelRatio
      ctx.scale(devicePixelRatio, devicePixelRatio)
    }
    const w = rect?.width || 600
    const h = rect?.height || 300
    const t = Date.now() / 1000

    ctx.fillStyle = '#0a0a0a'
    ctx.fillRect(0, 0, w, h)

    // Breathing red dot — center
    const pulse = 0.3 + Math.sin(t * 1.5) * 0.2
    const radius = 3 + Math.sin(t * 1.5) * 1
    ctx.beginPath()
    ctx.arc(w / 2, h / 2, radius, 0, Math.PI * 2)
    ctx.fillStyle = `rgba(255, 5, 5, ${pulse})`
    ctx.fill()

    // Soft glow around dot
    const glow = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, 40)
    glow.addColorStop(0, `rgba(255, 5, 5, ${pulse * 0.15})`)
    glow.addColorStop(1, 'rgba(255, 5, 5, 0)')
    ctx.beginPath()
    ctx.arc(w / 2, h / 2, 40, 0, Math.PI * 2)
    ctx.fillStyle = glow
    ctx.fill()

    animRef.current = requestAnimationFrame(drawIdle)
  }, [])

  useEffect(() => {
    if (state.type === 'idle') {
      animRef.current = requestAnimationFrame(drawIdle)
      return () => cancelAnimationFrame(animRef.current)
    }
  }, [state.type, drawIdle])

  // Draw sensor graph
  useEffect(() => {
    if (state.type !== 'sensor' || !canvasRef.current) return
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const rect = canvas.parentElement?.getBoundingClientRect()
    if (!rect) return
    const dpr = devicePixelRatio || 1
    canvas.width = rect.width * dpr
    canvas.height = rect.height * dpr
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    const w = rect.width
    const h = rect.height
    // Filter out -1 (out of range) for graph, keep only valid readings
    const history = sensorHistoryRef.current
    const valid = history.filter(v => v > 0)

    ctx.fillStyle = '#0a0a0a'
    ctx.fillRect(0, 0, w, h)

    // Grid lines
    ctx.strokeStyle = '#1a1a1a'
    ctx.lineWidth = 0.5
    for (let i = 0; i <= 4; i++) {
      const y = (h / 4) * i
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke()
    }

    // Draw graph with all values, treating -1 as gaps
    if (history.length >= 2 && valid.length >= 1) {
      const padding = 60
      const rawMin = Math.min(...valid)
      const rawMax = Math.max(...valid)
      const range = rawMax - rawMin
      // Add 10% margin above and below, minimum 5cm range
      const margin = Math.max(range * 0.1, 2.5)
      const minVal = Math.max(0, rawMin - margin)
      const maxVal = rawMax + margin
      const valRange = maxVal - minVal || 1

      ctx.strokeStyle = '#ff0505'
      ctx.lineWidth = 2
      ctx.beginPath()
      let started = false
      for (let i = 0; i < history.length; i++) {
        const x = (i / 120) * w
        if (history[i] <= 0) { started = false; continue }
        const y = padding + (h - padding - 10) * (1 - (history[i] - minVal) / valRange)
        if (!started) { ctx.moveTo(x, y); started = true } else { ctx.lineTo(x, y) }
      }
      ctx.stroke()

      // Fill under curve
      if (started) {
        let lastX = 0
        for (let i = history.length - 1; i >= 0; i--) {
          if (history[i] > 0) { lastX = (i / 120) * w; break }
        }
        ctx.lineTo(lastX, h)
        ctx.lineTo(0, h)
        ctx.closePath()
        ctx.fillStyle = 'rgba(255, 5, 5, 0.06)'
        ctx.fill()
      }

      // Scale labels on right — dynamic to actual data range
      ctx.fillStyle = '#333'
      ctx.font = '10px system-ui'
      ctx.textAlign = 'right'
      for (let i = 0; i <= 4; i++) {
        const val = maxVal - (valRange / 4) * i
        const y = padding + ((h - padding - 10) / 4) * i
        ctx.fillText(`${val.toFixed(0)}cm`, w - 8, y + 3)
      }
      ctx.textAlign = 'left'
    }

    // Current value — top left, clearly separated
    const current = history[history.length - 1]
    if (current > 0) {
      ctx.fillStyle = '#ff0505'
      ctx.font = 'bold 28px system-ui'
      ctx.fillText(`${current.toFixed(1)} cm`, 14, 34)
      ctx.fillStyle = '#444'
      ctx.font = '11px system-ui'
      ctx.fillText('distance sensor', 14, 50)
    } else {
      ctx.fillStyle = '#333'
      ctx.font = '14px system-ui'
      ctx.fillText('sensor: out of range', 14, 34)
    }
  }, [state])

  return (
    <div className="w-full h-full bg-[#0a0a0a] overflow-hidden" style={{ minHeight: '100%' }}>
      {state.type === 'idle' && (
        <canvas ref={idleCanvasRef} className="w-full h-full" />
      )}

      {state.type === 'sensor' && (
        <canvas ref={canvasRef} className="w-full h-full" />
      )}

      {state.type === 'camera' && (
        <img src={state.data?.url} alt="camera" className="w-full h-full object-cover" />
      )}

      {state.type === 'text' && (
        <div className="w-full h-full flex items-center justify-center p-8 text-center">
          <p className="text-white text-2xl font-medium">{state.data?.text}</p>
        </div>
      )}
    </div>
  )
}
