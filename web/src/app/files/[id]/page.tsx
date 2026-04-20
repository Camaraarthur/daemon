'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'

interface FileDoc {
  id: string
  title: string
  body: string
  mime: string
  created_at: string
  updated_at: string
}

export default function FileDetailPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const id = params?.id
  const [file, setFile] = useState<FileDoc | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    if (!id) return
    setLoading(true); setErr(null)
    try {
      const r = await fetch(`/api/files/${id}`, { credentials: 'include' })
      const d = await r.json()
      if (!r.ok) { setErr(d.error || `HTTP ${r.status}`); return }
      setFile(d.file); setTitle(d.file.title); setBody(d.file.body)
    } catch (e: any) { setErr(e?.message || 'load failed') }
    finally { setLoading(false) }
  }, [id])

  useEffect(() => { load() }, [load])

  const save = async () => {
    if (!id) return
    setBusy(true); setErr(null)
    try {
      const r = await fetch(`/api/files/${id}`, {
        method: 'PUT', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, body }),
      })
      const d = await r.json()
      if (!r.ok) { setErr(d.error || `HTTP ${r.status}`); return }
      setFile(d.file); setEditing(false)
    } catch (e: any) { setErr(e?.message || 'save failed') }
    finally { setBusy(false) }
  }

  const del = async () => {
    if (!id) return
    if (!confirm('delete this file?')) return
    setBusy(true); setErr(null)
    try {
      const r = await fetch(`/api/files/${id}`, { method: 'DELETE', credentials: 'include' })
      if (!r.ok) { const d = await r.json(); setErr(d.error || `HTTP ${r.status}`); return }
      router.push('/files')
    } catch (e: any) { setErr(e?.message || 'delete failed'); setBusy(false) }
  }

  return (
    <div className="min-h-screen bg-[#0e0e0e] text-neutral-100">
      <header className="sticky top-0 z-10 border-b border-neutral-800 bg-[#0e0e0e]/90 backdrop-blur px-4 py-3 flex items-center justify-between">
        <Link href="/files" className="text-neutral-400 hover:text-neutral-100 text-sm">← /files</Link>
        <div className="text-xs text-neutral-500">{file && new Date(file.updated_at + 'Z').toLocaleString()}</div>
        <div className="flex gap-3 text-xs">
          {editing ? (
            <>
              <button onClick={() => { setEditing(false); if (file) { setTitle(file.title); setBody(file.body) } }} className="text-neutral-500 hover:text-neutral-200">cancel</button>
              <button onClick={save} disabled={busy} className="text-emerald-400 hover:text-emerald-300 disabled:opacity-50">{busy ? 'saving…' : 'save'}</button>
            </>
          ) : (
            <>
              <button onClick={() => setEditing(true)} className="text-neutral-400 hover:text-neutral-100">edit</button>
              <button onClick={del} disabled={busy} className="text-red-400 hover:text-red-300 disabled:opacity-50">delete</button>
            </>
          )}
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-5">
        {loading && <div className="text-sm text-neutral-500">loading…</div>}
        {err && <div className="text-sm text-red-400 border border-red-900/50 bg-red-950/20 rounded-md px-3 py-2 mb-4">{err}</div>}

        {file && !editing && (
          <>
            <h1 className="text-2xl font-semibold mb-4 break-words">{file.title || '(untitled)'}</h1>
            <article className="whitespace-pre-wrap font-mono text-sm leading-relaxed text-neutral-200 break-words">
              {file.body}
            </article>
          </>
        )}

        {file && editing && (
          <div className="space-y-3">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full bg-transparent border-b border-neutral-800 px-0 py-2 text-lg font-semibold outline-none focus:border-neutral-600"
            />
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={28}
              className="w-full bg-transparent border border-neutral-800 rounded-md px-3 py-2 text-sm font-mono whitespace-pre-wrap outline-none focus:border-neutral-600"
            />
            <div className="text-xs text-neutral-600">{body.length.toLocaleString()} chars</div>
          </div>
        )}
      </main>
    </div>
  )
}
