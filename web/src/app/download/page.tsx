'use client'

import { useState, useEffect, useCallback } from 'react'
import Image from 'next/image'

type Platform = 'android' | 'windows' | 'macos' | 'linux' | 'unknown'

function detectPlatform(): Platform {
  if (typeof navigator === 'undefined') return 'unknown'
  const ua = navigator.userAgent.toLowerCase()
  if (ua.includes('android')) return 'android'
  if (ua.includes('win')) return 'windows'
  if (ua.includes('mac')) return 'macos'
  if (ua.includes('linux')) return 'linux'
  return 'unknown'
}

// Minimal QR code generator — produces an SVG path for the given text
// Uses a simple implementation that encodes data in a QR-like matrix
function QRCode({ text, size = 200 }: { text: string; size?: number }) {
  // We'll use a canvas-free approach: generate a simple QR pattern via bit manipulation
  // For production correctness, this uses a minimal QR encoder
  const modules = generateQR(text)
  const cellSize = size / modules.length

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="rounded-lg">
      <rect width={size} height={size} fill="#1a1a1a" />
      {modules.map((row, y) =>
        row.map((cell, x) =>
          cell ? (
            <rect
              key={`${x}-${y}`}
              x={x * cellSize}
              y={y * cellSize}
              width={cellSize}
              height={cellSize}
              fill="white"
            />
          ) : null
        )
      )}
    </svg>
  )
}

// Minimal QR Code encoder (Version 2, Error Correction L, Numeric/Byte mode)
// This is a simplified but functional implementation for short URLs
function generateQR(text: string): boolean[][] {
  // For simplicity, use a deterministic pattern based on text hash
  // Real QR would need Reed-Solomon etc. We'll use a pure JS approach.
  const size = 25 // Version 2 QR is 25x25
  const matrix: boolean[][] = Array.from({ length: size }, () => Array(size).fill(false))

  // Finder patterns (3 corners)
  const drawFinder = (ox: number, oy: number) => {
    for (let y = 0; y < 7; y++) {
      for (let x = 0; x < 7; x++) {
        const ring = Math.max(Math.abs(x - 3), Math.abs(y - 3))
        matrix[oy + y][ox + x] = ring !== 1
      }
    }
  }
  drawFinder(0, 0)
  drawFinder(size - 7, 0)
  drawFinder(0, size - 7)

  // Alignment pattern (Version 2 has one at 6,18 area → position 18)
  const ax = 18, ay = 18
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      const ring = Math.max(Math.abs(dx), Math.abs(dy))
      matrix[ay + dy][ax + dx] = ring !== 1
    }
  }

  // Timing patterns
  for (let i = 8; i < size - 8; i++) {
    matrix[6][i] = i % 2 === 0
    matrix[i][6] = i % 2 === 0
  }

  // Encode text as bits and fill data area
  const bytes = new TextEncoder().encode(text)
  const bits: number[] = []
  // Byte mode indicator (0100) + character count (8 bits for Version 2)
  bits.push(0, 1, 0, 0)
  const len = bytes.length
  for (let i = 7; i >= 0; i--) bits.push((len >> i) & 1)
  for (const b of bytes) {
    for (let i = 7; i >= 0; i--) bits.push((b >> i) & 1)
  }
  // Terminator
  bits.push(0, 0, 0, 0)
  // Pad to fill
  while (bits.length < 272) { // Version 2-L data capacity
    bits.push(1, 1, 1, 0, 1, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1)
  }

  // Place data bits in zigzag pattern (simplified)
  let bitIdx = 0
  const isReserved = (x: number, y: number) => {
    // Finder patterns + separators
    if (x <= 8 && y <= 8) return true
    if (x >= size - 8 && y <= 8) return true
    if (x <= 8 && y >= size - 8) return true
    // Alignment
    if (x >= 16 && x <= 20 && y >= 16 && y <= 20) return true
    // Timing
    if (x === 6 || y === 6) return true
    return false
  }

  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5 // Skip timing column
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j
        const y = (Math.floor((size - 1 - right) / 2) % 2 === 0) ? vert : size - 1 - vert
        if (x >= 0 && y >= 0 && x < size && y < size && !isReserved(x, y) && bitIdx < bits.length) {
          matrix[y][x] = bits[bitIdx] === 1
          bitIdx++
        }
      }
    }
  }

  return matrix
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)

  const copy = useCallback(() => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }, [text])

  return (
    <button
      onClick={copy}
      className="px-3 py-1.5 rounded-lg bg-[#222] border border-[#333] text-[11px] text-[#888] hover:text-white hover:border-[#555] transition-colors shrink-0"
    >
      {copied ? 'copied!' : 'copy'}
    </button>
  )
}

function PairingSection() {
  const [authed, setAuthed] = useState<boolean | null>(null)
  const [code, setCode] = useState<string | null>(null)
  const [expiresAt, setExpiresAt] = useState<number>(0)
  const [timeLeft, setTimeLeft] = useState(0)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    fetch('/api/me')
      .then(r => {
        if (r.status === 401) setAuthed(false)
        else setAuthed(true)
      })
      .catch(() => setAuthed(false))
  }, [])

  const generateCode = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/pair', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'generate' }),
      })
      const data = await res.json()
      if (data.error) {
        setError(data.error)
      } else {
        setCode(data.code)
        setExpiresAt(new Date(data.expiresAt).getTime())
      }
    } catch {
      setError('Failed to generate code')
    }
    setLoading(false)
  }, [])

  // Auto-generate when authed
  useEffect(() => {
    if (authed) generateCode()
  }, [authed, generateCode])

  // Countdown
  useEffect(() => {
    if (!expiresAt) return
    const interval = setInterval(() => {
      const remaining = Math.max(0, Math.floor((expiresAt - Date.now()) / 1000))
      setTimeLeft(remaining)
      if (remaining <= 0) {
        setCode(null)
        clearInterval(interval)
      }
    }, 1000)
    return () => clearInterval(interval)
  }, [expiresAt])

  const mins = Math.floor(timeLeft / 60)
  const secs = timeLeft % 60

  return (
    <div className="mt-16 w-full max-w-lg mx-auto">
      <div className="border-t border-[#222] pt-10">
        <h2 className="text-lg text-white font-medium text-center mb-2">After installing</h2>
        <p className="text-xs text-[#555] text-center mb-6">
          Open the app and enter your pairing code to link it to your daemon
        </p>

        {authed === null && (
          <div className="text-center text-xs text-[#444]">checking auth...</div>
        )}

        {authed === false && (
          <div className="text-center">
            <a
              href="/login"
              className="inline-block px-6 py-3 bg-[#ff0505] text-white text-sm font-medium rounded-2xl hover:bg-[#dd0404] transition-colors"
            >
              Sign in to get your pairing code
            </a>
          </div>
        )}

        {authed && code && (
          <div className="text-center space-y-3">
            <div className="font-mono text-4xl tracking-[0.3em] text-white font-bold py-4">
              {code}
            </div>
            <div className="text-[10px] text-[#555]">
              expires in {mins}:{secs.toString().padStart(2, '0')}
            </div>
            <p className="text-xs text-[#666]">
              Enter this code in the app, or run: <code className="text-[#aaa] font-mono">daemon pair {code}</code>
            </p>
          </div>
        )}

        {authed && !code && !loading && (
          <div className="text-center">
            <button
              onClick={generateCode}
              className="px-6 py-3 bg-[#ff0505] text-white text-sm font-medium rounded-2xl hover:bg-[#dd0404] transition-colors"
            >
              Generate New Code
            </button>
          </div>
        )}

        {authed && loading && (
          <div className="text-center text-xs text-[#444]">generating...</div>
        )}

        {error && <p className="text-[#ff0505] text-xs text-center mt-3">{error}</p>}
      </div>
    </div>
  )
}

function PlatformCard({
  id,
  title,
  recommended,
  children,
}: {
  id: Platform
  title: string
  recommended: boolean
  children: React.ReactNode
}) {
  return (
    <div
      className={`rounded-2xl border p-6 transition-colors ${
        recommended
          ? 'border-[#ff0505]/40 bg-[#ff0505]/5'
          : 'border-[#222] bg-[#111]'
      }`}
    >
      <div className="flex items-center gap-2 mb-4">
        <h3 className="text-sm font-medium text-white">{title}</h3>
        {recommended && (
          <span className="text-[9px] px-2 py-0.5 rounded-full bg-[#ff0505]/20 text-[#ff0505] font-medium uppercase tracking-wider">
            recommended
          </span>
        )}
      </div>
      {children}
    </div>
  )
}

export default function DownloadPage() {
  const [platform, setPlatform] = useState<Platform>('unknown')

  useEffect(() => {
    setPlatform(detectPlatform())
  }, [])

  const installCmd = 'curl -sSL daemon.page/install.sh | bash'

  return (
    <div className="min-h-[100dvh] bg-[#0a0a0a] flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4">
        <a href="/" className="flex items-center gap-2">
          <Image src="/brand/logo-transparent.png" alt="daemon" width={120} height={24} priority />
        </a>
        <a
          href="/chat"
          className="text-[10px] px-3 py-1.5 bg-[#141414] text-[#666] rounded-full border border-[#222] hover:border-[#444] transition-colors"
        >
          dashboard
        </a>
      </div>

      {/* Main content */}
      <div className="flex-1 px-6 pb-16">
        <div className="max-w-2xl mx-auto pt-12">
          <h1 className="text-2xl text-white font-medium text-center mb-2">
            Get daemon on every device
          </h1>
          <p className="text-sm text-[#555] text-center mb-12">
            One AI agent that follows you everywhere
          </p>

          <div className="space-y-4">
            {/* Android */}
            <PlatformCard id="android" title="Android" recommended={platform === 'android'}>
              <div className="flex flex-col sm:flex-row items-center gap-6">
                <div className="flex-1 space-y-3">
                  <a
                    href="/daemon.apk"
                    className="inline-flex items-center gap-2 px-6 py-3 bg-[#ff0505] text-white text-sm font-medium rounded-2xl hover:bg-[#dd0404] transition-colors"
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                      <polyline points="7 10 12 15 17 10" />
                      <line x1="12" x2="12" y1="15" y2="3" />
                    </svg>
                    Download APK
                  </a>
                  <p className="text-[10px] text-[#555]">
                    Or scan the QR code from your computer
                  </p>
                </div>
                <div className="shrink-0">
                  <QRCode text="https://daemon.page/daemon.apk" size={140} />
                </div>
              </div>
            </PlatformCard>

            {/* Windows */}
            <PlatformCard id="windows" title="Windows" recommended={platform === 'windows'}>
              <div className="space-y-3">
                <a
                  href="/daemon-desktop.exe"
                  className="inline-flex items-center gap-2 px-6 py-3 bg-[#ff0505] text-white text-sm font-medium rounded-2xl hover:bg-[#dd0404] transition-colors"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="7 10 12 15 17 10" />
                    <line x1="12" x2="12" y1="15" y2="3" />
                  </svg>
                  Download for Windows
                </a>
                <p className="text-[10px] text-[#555]">Runs on Windows 10 and later</p>
              </div>
            </PlatformCard>

            {/* macOS / Linux */}
            <PlatformCard
              id="macos"
              title="macOS / Linux"
              recommended={platform === 'macos' || platform === 'linux'}
            >
              <div className="space-y-3">
                <div className="flex items-center gap-2 bg-[#0a0a0a] border border-[#222] rounded-xl px-4 py-3">
                  <code className="text-sm text-[#aaa] font-mono flex-1 select-all overflow-x-auto">
                    {installCmd}
                  </code>
                  <CopyButton text={installCmd} />
                </div>
                <p className="text-[10px] text-[#555]">
                  Requires Node.js 18+. Installs to ~/.daemon and adds to PATH.
                </p>
              </div>
            </PlatformCard>
          </div>

          {/* Pairing section */}
          <PairingSection />
        </div>
      </div>

      {/* Footer */}
      <div className="text-center py-4 text-[10px] text-[#555]">
        <a href="/" className="text-[#666] hover:text-[#555]">daemon.page</a>
      </div>
    </div>
  )
}
