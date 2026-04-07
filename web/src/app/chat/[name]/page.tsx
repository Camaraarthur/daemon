'use client'

import { use, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import ChatPage from '../page'

/**
 * Dynamic chat route: /chat/{project-name}
 * Resolves the project name slug to a project ID and renders the chat page
 * with that project pre-selected. Refreshing this URL keeps you in the same
 * conversation.
 */
export default function ChatNamedPage({ params }: { params: Promise<{ name: string }> }) {
  const { name } = use(params)
  const router = useRouter()

  useEffect(() => {
    // Resolve project name → id, then store in sessionStorage so the chat page can pick it up
    let cancelled = false
    fetch('/api/projects')
      .then(r => r.json())
      .then(d => {
        if (cancelled) return
        const projects = d.projects || []
        const lower = decodeURIComponent(name).toLowerCase()
        const match = projects.find(
          (p: any) => p.name?.toLowerCase() === lower || p.display_name?.toLowerCase() === lower
        )
        if (match) {
          // Stash for the chat page to pick up
          sessionStorage.setItem('daemon_pending_project', String(match.id))
          // Reload the base /chat which will read it
          window.location.replace('/chat')
        } else {
          // Unknown project — go to chat home
          router.replace('/chat')
        }
      })
      .catch(() => router.replace('/chat'))
    return () => { cancelled = true }
  }, [name, router])

  return (
    <div className="min-h-[100dvh] bg-[#0a0a0a] flex items-center justify-center">
      <div className="text-[#555] text-xs">opening {name}...</div>
    </div>
  )
}
