'use client'

import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { Suspense } from 'react'

function LoginInner() {
  const params = useSearchParams()
  const daemonName = params.get('daemon') || ''
  const redirect = params.get('redirect') || ''
  const [status, setStatus] = useState('')

  useEffect(() => {
    // Define Google callback
    ;(window as any).handleGoogleAuth = async (response: any) => {
      setStatus('signing in...')
      try {
        const res = await fetch('/api/auth', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'google', credential: response.credential }),
        })
        const data = await res.json()

        if (data.token) {
          // Already has account — redirect
          window.location.href = redirect || `https://${data.daemon_name}.daemon.page/chat`
        } else if (data.needs_signup) {
          // New user — create with daemon name from URL or suggested
          const name = daemonName || data.suggested_name
          const signupRes = await fetch('/api/auth', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'google_signup', google_email: data.email, daemon_name: name }),
          })
          const signupData = await signupRes.json()
          if (signupData.token) {
            window.location.href = redirect || `https://${signupData.daemon_name}.daemon.page/chat`
          } else {
            setStatus(signupData.error || 'Signup failed')
          }
        } else {
          setStatus(data.error || 'Auth failed')
        }
      } catch {
        setStatus('Connection error')
      }
    }

    // Render Google button + auto-prompt One Tap
    const interval = setInterval(() => {
      if ((window as any).google?.accounts?.id) {
        clearInterval(interval)
        ;(window as any).google.accounts.id.initialize({
          client_id: '1023759738343-ttdbos5so4nof6698o3l3ies6e40gku2.apps.googleusercontent.com',
          callback: (window as any).handleGoogleAuth,
          auto_select: true,  // Auto-select if only one Google account
        })
        // Auto-trigger One Tap popup (one click instead of two)
        ;(window as any).google.accounts.id.prompt()
        // Also render button as fallback
        const container = document.getElementById('google-btn')
        if (container) {
          ;(window as any).google.accounts.id.renderButton(container, {
            theme: 'filled_black',
            size: 'large',
            width: 300,
            text: 'continue_with',
            shape: 'pill',
          })
        }
      }
    }, 100)

    return () => clearInterval(interval)
  }, [daemonName, redirect])

  return (
    <div className="min-h-[100dvh] bg-[#0a0a0a] flex items-center justify-center">
      <div className="w-[360px] space-y-6 text-center">
        {daemonName && (
          <div className="space-y-1">
            <p className="text-[#555] text-xs">claiming daemon</p>
            <p className="text-[#ff0505] text-2xl font-bold">{daemonName}</p>
          </div>
        )}
        {!daemonName && (
          <div className="space-y-1">
            <p className="text-white text-lg font-medium">sign in to daemons</p>
            <p className="text-[#555] text-xs">one AI agent. every device. yours.</p>
          </div>
        )}

        <div id="google-btn" className="flex justify-center" />

        {status && <p className="text-xs text-[#ff0505]">{status}</p>}

        <p className="text-[10px] text-[#333]">
          by signing in you agree to the daemons terms of service
        </p>
      </div>
    </div>
  )
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-[100dvh] bg-[#0a0a0a]" />}>
      <LoginInner />
    </Suspense>
  )
}
