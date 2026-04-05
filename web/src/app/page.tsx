'use client'

import { useState, useEffect } from 'react'
import Image from 'next/image'
import DaemonName from '@/components/DaemonName'

// Google Sign-In callback (must be global)
if (typeof window !== 'undefined') {
  (window as any).handleGoogleLogin = async (response: any) => {
    try {
      // Get daemon name from subdomain if available
      const host = window.location.hostname
      let subName = ''
      if (host.endsWith('.daemon.page') && host !== 'daemon.page') {
        subName = host.replace('.daemon.page', '')
      }

      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'google', credential: response.credential }),
      })
      const data = await res.json()
      if (data.token) {
        window.location.href = '/chat'
      } else if (data.needs_signup) {
        // Use subdomain name or ask
        const name = subName || prompt('Choose your daemon name:', data.suggested_name)
        if (!name) return
        const signupRes = await fetch('/api/auth', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'google_signup', google_email: data.email, daemon_name: name }),
        })
        const signupData = await signupRes.json()
        if (signupData.token) window.location.href = '/chat'
        else alert(signupData.error || 'Signup failed')
      } else if (data.error) {
        alert(data.error)
      }
    } catch { alert('Connection error') }
  }
}

export default function Page() {
  const [daemonOwner, setDaemonOwner] = useState<string | null>(null)
  const [isOwner, setIsOwner] = useState(false)

  useEffect(() => {
    const host = window.location.hostname
    if (host.endsWith('.daemon.page') && host !== 'daemon.page') {
      const sub = host.replace('.daemon.page', '')
      if (sub && sub !== 'www') setDaemonOwner(sub)
    }
    // Check if logged in (cookie)
    setIsOwner(document.cookie.includes('daemon_token'))
  }, [])

  // === SUBDOMAIN: Public daemon page ===
  if (daemonOwner) {
    return <DaemonPublicPage name={daemonOwner} isOwner={isOwner} />
  }

  // === ROOT: Landing page ===
  return <LandingPage />
}

// ============================================
// PUBLIC DAEMON PAGE (name.daemon.page)
// ============================================
function DaemonPublicPage({ name, isOwner }: { name: string; isOwner: boolean }) {
  const [claimed, setClaimed] = useState<boolean | null>(null)
  const [hasSite, setHasSite] = useState<boolean | null>(null)
  const [canvasActive, setCanvasActive] = useState(false)
  const [showLogin, setShowLogin] = useState(false)
  const [authMode, setAuthMode] = useState<'login' | 'signup'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loginError, setLoginError] = useState('')
  const [loginLoading, setLoginLoading] = useState(false)

  const handleAuth = async () => {
    setLoginError('')
    setLoginLoading(true)
    try {
      if (authMode === 'signup') {
        // Signup: create account with this daemon name
        const res = await fetch('/api/auth', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'signup', email, password, daemon_name: name }),
        })
        const data = await res.json()
        if (data.error) { setLoginError(data.error) }
        else { window.location.href = '/chat' }
      } else {
        // Login: try email+password first, then daemon_name+password
        const res = await fetch('/api/auth', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'login', email: email || name, password }),
        })
        const data = await res.json()
        if (data.error) { setLoginError(data.error) }
        else { window.location.href = '/chat' }
      }
    } catch {
      setLoginError('Connection error')
    }
    setLoginLoading(false)
  }

  useEffect(() => {
    fetch(`/api/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'check', daemon_name: name }),
    })
      .then(r => r.json())
      .then(d => setClaimed(d.exists))
      .catch(() => setClaimed(null))

    // Check if this user has a deployed site
    fetch(`/api/hosted/${name}/index.html`, { method: 'HEAD' })
      .then(r => setHasSite(r.ok))
      .catch(() => setHasSite(false))
  }, [name])

  // Listen to SSE — show canvas when daemon pushes content, hide on 'clear'
  useEffect(() => {
    const es = new EventSource('/api/stream')
    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data)
        if (data.type === 'clear') {
          setCanvasActive(false)
        } else if (data.type === 'sensor' || data.type === 'camera' || data.type === 'text' || data.type === 'image') {
          setCanvasActive(true)
        }
      } catch {}
    }
    return () => es.close()
  }, [])

  // If a hosted site exists, show it in a full-page iframe with a thin daemon bar
  if (hasSite) {
    return (
      <div className="h-[100dvh] bg-[#0a0a0a] flex flex-col">
        {/* Thin daemon bar */}
        <div className="flex items-center justify-between px-3 py-1.5 bg-[#0a0a0a] border-b border-[#1a1a1a] shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-green-500" />
            <span className="text-[10px] text-[#555]">{name}.daemon.page</span>
          </div>
          <div className="flex items-center gap-2">
            {isOwner && (
              <a href="/chat" className="text-[9px] px-2 py-1 bg-[#141414] text-[#555] rounded-full border border-[#222] hover:border-[#444] transition-colors">
                dashboard
              </a>
            )}
            <a href="https://daemon.page" className="text-[9px] text-[#333] hover:text-[#555] transition-colors">
              daemon
            </a>
          </div>
        </div>
        {/* Hosted site iframe */}
        <iframe
          src={`/api/hosted/${name}/index.html`}
          className="flex-1 w-full border-0"
          title={`${name}'s site`}
          sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
        />
      </div>
    )
  }

  return (
    <div className="min-h-[100dvh] bg-[#0a0a0a] flex flex-col">
      {/* Top bar */}
      <div className="flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${claimed ? 'bg-green-500' : 'bg-[#333]'}`} />
          <span className="text-xs text-[#555]">{name}.daemon.page</span>
        </div>
        {isOwner ? (
          <a href="/chat" className="text-[10px] px-3 py-1.5 bg-[#141414] text-[#666] rounded-full border border-[#222] hover:border-[#444] transition-colors">
            dashboard
          </a>
        ) : (
          <button
            onClick={() => claimed ? setShowLogin(!showLogin) : window.location.href = 'https://daemon.page'}
            className="text-[10px] px-3 py-1.5 bg-[#141414] text-[#666] rounded-full border border-[#222] hover:border-[#444] transition-colors"
          >
            {claimed ? 'login' : 'claim'}
          </button>
        )}
      </div>

      {/* Auth modal overlay */}
      {showLogin && !isOwner && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={() => setShowLogin(false)}>
          <div className="bg-[#111] border border-[#222] rounded-2xl p-6 w-[340px] space-y-4 shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="text-white text-sm font-medium">
                {claimed ? `log in to ${name}` : `claim ${name}`}
              </h3>
              <button onClick={() => setShowLogin(false)} className="text-[#555] hover:text-white text-lg leading-none">&times;</button>
            </div>

            {/* Daemon name — always shown, non-editable */}
            <div className="flex items-center gap-2 px-3 py-2 bg-[#0a0a0a] border border-[#222] rounded-lg">
              <span className="text-[#555] text-sm">daemon:</span>
              <span className="text-[#ff0505] text-sm font-medium">{name}</span>
            </div>

            {/* Tabs: login / signup */}
            {!claimed && (
              <div className="flex gap-1 bg-[#0a0a0a] rounded-lg p-0.5">
                <button
                  onClick={() => { setAuthMode('signup'); setLoginError('') }}
                  className={`flex-1 text-xs py-1.5 rounded-md transition-colors ${authMode === 'signup' ? 'bg-[#1a1a1a] text-white' : 'text-[#555]'}`}
                >claim this name</button>
                <button
                  onClick={() => { setAuthMode('login'); setLoginError('') }}
                  className={`flex-1 text-xs py-1.5 rounded-md transition-colors ${authMode === 'login' ? 'bg-[#1a1a1a] text-white' : 'text-[#555]'}`}
                >log in</button>
              </div>
            )}

            {/* Google sign-in — redirects to daemon.page/login */}
            <a
              href={`https://daemon.page/login?daemon=${name}&redirect=https://${name}.daemon.page/chat`}
              className="flex items-center justify-center gap-2 w-full py-2.5 bg-white text-black text-sm font-medium rounded-lg hover:bg-gray-100 transition-colors"
            >
              <svg width="18" height="18" viewBox="0 0 18 18"><path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615Z" fill="#4285F4"/><path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18Z" fill="#34A853"/><path d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.997 8.997 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332Z" fill="#FBBC05"/><path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 6.29C4.672 4.163 6.656 2.58 9 2.58Z" fill="#EA4335"/></svg>
              continue with Google
            </a>

            <div className="flex items-center gap-2">
              <div className="flex-1 border-t border-[#222]" />
              <span className="text-[10px] text-[#555]">or</span>
              <div className="flex-1 border-t border-[#222]" />
            </div>

            {/* Email field — only for signup or email login */}
            {(authMode === 'signup' || claimed) && (
              <input
                type="email"
                placeholder="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                className="w-full bg-[#0a0a0a] border border-[#222] rounded-lg px-3 py-2.5 text-sm text-white placeholder-[#555] focus:border-[#ff0505] focus:outline-none"
                onKeyDown={e => e.key === 'Enter' && handleAuth()}
                autoFocus
              />
            )}
            <input
              type="password"
              placeholder="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="w-full bg-[#0a0a0a] border border-[#222] rounded-lg px-3 py-2.5 text-sm text-white placeholder-[#555] focus:border-[#ff0505] focus:outline-none"
              onKeyDown={e => e.key === 'Enter' && handleAuth()}
              autoFocus={authMode === 'login' && !!claimed}
            />
            {loginError && <p className="text-[#ff0505] text-xs">{loginError}</p>}
            <button
              onClick={handleAuth}
              disabled={loginLoading}
              className="w-full py-2.5 bg-[#ff0505] text-white text-sm font-medium rounded-lg hover:bg-[#cc0404] transition-colors disabled:opacity-50"
            >
              {loginLoading ? '...' : authMode === 'signup' ? 'claim daemon' : 'log in'}
            </button>

            {/* Toggle between login/signup for claimed names */}
            {claimed && (
              <p className="text-center text-[10px] text-[#555]">
                don&apos;t have an account? <button onClick={() => { setAuthMode('signup'); setClaimed(false) }} className="text-[#ff0505]">create one</button>
              </p>
            )}
          </div>
        </div>
      )}

      {/* Main content — daemon name */}
      <div className="flex-1 flex flex-col items-center justify-center px-4 pb-16 gap-6">
        <DaemonName name={name} />
        {claimed === false && (
          <p className="text-xs text-[#777]">
            this name is free — <a href="https://daemon.page" className="text-[#ff0505] hover:underline">claim it</a>
          </p>
        )}

        {/* Canvas — only visible when daemon pushes content */}
        {canvasActive && (
          <div className="w-full max-w-3xl relative">
            <button
              onClick={() => setCanvasActive(false)}
              className="absolute top-3 right-3 z-10 w-6 h-6 rounded-full bg-[#1a1a1a] border border-[#333] text-[#555] hover:text-white hover:border-[#555] transition-colors flex items-center justify-center text-xs"
            >
              x
            </button>
            <div style={{ height: '50vh', minHeight: 280 }}>
              <iframe
                src="/canvas"
                className="w-full h-full rounded-2xl border border-[#1a1a1a] bg-[#0a0a0a]"
              />
            </div>
          </div>
        )}
      </div>

      <div className="text-center py-4 text-[10px] text-[#555]">
        powered by <a href="https://daemon.page" className="text-[#666] hover:text-[#555]">daemons</a>
      </div>
    </div>
  )
}

// ============================================
// LANDING PAGE (daemon.page)
// ============================================
function LandingPage() {
  const [mode, setMode] = useState<'landing' | 'signup' | 'login'>('landing')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [daemonName, setDaemonName] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleAuth = async (action: 'signup' | 'login') => {
    setError('')
    setLoading(true)
    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, email, password, daemon_name: daemonName }),
      })
      const data = await res.json()
      if (data.error) {
        setError(data.error)
      } else {
        window.location.href = `https://${data.daemon_name}.daemon.page/chat`
      }
    } catch (e) {
      setError('Connection error')
    }
    setLoading(false)
  }

  return (
    <div className="min-h-[100dvh] bg-[#0a0a0a] flex flex-col px-6">
      <div className="w-full max-w-sm mx-auto flex-1 flex flex-col justify-center pb-16">
        <div className="flex justify-center mb-8">
          <Image src="/brand/logo-transparent.png" alt="daemons" width={220} height={40} priority />
        </div>

        {mode === 'landing' && (
          <>
            <h1 className="text-xl text-white font-medium text-center leading-tight mb-2">
              One AI agent. Every device. <span className="text-[#ff0505]">Yours.</span>
            </h1>
            <p className="text-xs text-[#555] text-center mb-8">
              A personal AI that grows from your data. No two are alike.
            </p>
            <div className="space-y-3">
              <button onClick={() => setMode('signup')} className="w-full py-3 bg-[#ff0505] text-white rounded-2xl text-sm font-medium hover:bg-[#dd0404] transition-colors">
                Name your daemon
              </button>
              <button onClick={() => setMode('login')} className="w-full py-3 bg-[#141414] text-[#888] rounded-2xl text-sm border border-[#222] hover:border-[#444] transition-colors">
                I have a daemon
              </button>
            </div>
            <div className="mt-10 grid grid-cols-3 gap-4 text-center">
              <div><div className="text-[#ff0505] text-sm mb-1">&#9678;</div><div className="text-[9px] text-[#777]">every device</div></div>
              <div><div className="text-[#ff0505] text-sm mb-1">&#9670;</div><div className="text-[9px] text-[#777]">your data</div></div>
              <div><div className="text-[#ff0505] text-sm mb-1">&#10022;</div><div className="text-[9px] text-[#777]">grows with you</div></div>
            </div>
          </>
        )}

        {mode === 'signup' && (
          <>
            <h2 className="text-lg text-white font-medium text-center mb-1">Name your daemon</h2>
            <p className="text-xs text-[#555] text-center mb-6">This becomes your daemon's address</p>
            <div className="space-y-3">
              <div className="relative">
                <input type="text" value={daemonName} onChange={(e) => setDaemonName(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ''))} placeholder="luna" maxLength={20} className="w-full px-4 py-3 bg-[#141414] border border-[#222] rounded-xl text-white placeholder-[#333] text-sm focus:outline-none focus:border-[#ff0505]/50" />
                {daemonName && <div className="absolute right-3 top-3 text-[10px] text-[#555]">{daemonName}.daemon.page</div>}
              </div>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email" className="w-full px-4 py-3 bg-[#141414] border border-[#222] rounded-xl text-white placeholder-[#333] text-sm focus:outline-none focus:border-[#ff0505]/50" />
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="password" className="w-full px-4 py-3 bg-[#141414] border border-[#222] rounded-xl text-white placeholder-[#333] text-sm focus:outline-none focus:border-[#ff0505]/50" />
              {error && <p className="text-xs text-[#ff0505] text-center">{error}</p>}
              <button onClick={() => handleAuth('signup')} disabled={loading || !daemonName || !email || !password} className="w-full py-3 bg-[#ff0505] text-white rounded-2xl text-sm font-medium hover:bg-[#dd0404] disabled:opacity-30 transition-colors">
                {loading ? 'Creating...' : `Create ${daemonName || 'daemon'}`}
              </button>
              <button onClick={() => { setMode('landing'); setError('') }} className="w-full py-2 text-xs text-[#555] hover:text-[#888]">back</button>
            </div>
          </>
        )}

        {mode === 'login' && (
          <>
            <h2 className="text-lg text-white font-medium text-center mb-6">Welcome back</h2>
            <div className="space-y-3">
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email" className="w-full px-4 py-3 bg-[#141414] border border-[#222] rounded-xl text-white placeholder-[#333] text-sm focus:outline-none focus:border-[#ff0505]/50" />
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="password" className="w-full px-4 py-3 bg-[#141414] border border-[#222] rounded-xl text-white placeholder-[#333] text-sm focus:outline-none focus:border-[#ff0505]/50" />
              {error && <p className="text-xs text-[#ff0505] text-center">{error}</p>}
              <button onClick={() => handleAuth('login')} disabled={loading || !email || !password} className="w-full py-3 bg-[#ff0505] text-white rounded-2xl text-sm font-medium hover:bg-[#dd0404] disabled:opacity-30 transition-colors">
                {loading ? 'Logging in...' : 'Enter'}
              </button>
              <button onClick={() => { setMode('landing'); setError('') }} className="w-full py-2 text-xs text-[#555] hover:text-[#888]">back</button>
            </div>
          </>
        )}
      </div>
      <div className="mt-auto py-6 text-[10px] text-[#555]">daemon.page</div>
    </div>
  )
}
