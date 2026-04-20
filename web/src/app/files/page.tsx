'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

interface FileRow {
  id: string
  title: string
  mime: string
  size?: number
  created_at: string
  updated_at: string
}

export default function FilesPage() {
  const router = useRouter()
  const [files, setFiles] = useState<FileRow[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true); setErr(null)
    try {
      const r = await fetch('/api/files', { credentials: 'include' })
      if (!r.ok) { setErr((await r.json()).error || `HTTP ${r.status}`); return }
      const d = await r.json()
      setFiles(d.files || [])
    } catch (e: any) {
      setErr(e?.message || 'load failed')
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  const onPaste = async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    if (!title) {
      const text = e.clipboardData.getData('text')
      const first = text.split('\n', 1)[0].trim().slice(0, 120)
      if (first) setTitle(first)
    }
  }

  const save = async () => {
    if (!body.trim()) return
    setSaving(true); setErr(null)
    try {
      const r = await fetch('/api/files', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: title || 'Untitled', body }),
      })
      const d = await r.json()
      if (!r.ok) { setErr(d.error || `HTTP ${r.status}`); return }
      setTitle(''); setBody('')
      if (d.file?.id) router.push(`/files/${d.file.id}`)
      else load()
    } catch (e: any) {
      setErr(e?.message || 'save failed')
    } finally { setSaving(false) }
  }

  return (
    <div className="min-h-screen bg-[#0e0e0e] text-neutral-100">
      <header className="sticky top-0 z-10 border-b border-neutral-800 bg-[#0e0e0e]/90 backdrop-blur px-4 py-3 flex items-center justify-between">
        <Link href="/chat" className="text-neutral-400 hover:text-neutral-100 text-sm">← daemon</Link>
        <h1 className="text-sm font-medium tracking-wide">/files</h1>
        <button onClick={load} className="text-xs text-neutral-500 hover:text-neutral-200">reload</button>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-5 space-y-6">
        <section className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-4">
          <div className="text-xs uppercase tracking-wider text-neutral-500 mb-2">paste a file</div>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="title (or first line on paste)"
            className="w-full bg-transparent border-b border-neutral-800 px-0 py-2 mb-2 text-sm outline-none focus:border-neutral-600"
          />
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onPaste={onPaste}
            placeholder="paste content here…"
            rows={10}
            className="w-full bg-transparent border border-neutral-800 rounded-md px-3 py-2 text-sm font-mono whitespace-pre-wrap outline-none focus:border-neutral-600"
          />
          <div className="flex items-center justify-between mt-3">
            <div className="text-xs text-neutral-600">{body.length.toLocaleString()} chars</div>
            <button
              onClick={save}
              disabled={!body.trim() || saving}
              className="bg-neutral-200 text-neutral-900 disabled:opacity-40 text-sm font-medium px-4 py-1.5 rounded-md hover:bg-white"
            >{saving ? 'saving…' : 'save'}</button>
          </div>
        </section>

        {err && (
          <div className="text-sm text-red-400 border border-red-900/50 bg-red-950/20 rounded-md px-3 py-2">
            {err}
          </div>
        )}

        <section>
          <div className="text-xs uppercase tracking-wider text-neutral-500 mb-2">
            {loading ? 'loading…' : `${files.length} file${files.length === 1 ? '' : 's'}`}
          </div>
          <ul className="divide-y divide-neutral-900 border border-neutral-900 rounded-xl overflow-hidden">
            {files.map((f) => (
              <li key={f.id}>
                <Link
                  href={`/files/${f.id}`}
                  className="block px-4 py-3 hover:bg-neutral-900/60"
                >
                  <div className="text-sm font-medium text-neutral-100 truncate">{f.title || '(untitled)'}</div>
                  <div className="text-xs text-neutral-500 mt-0.5">
                    {(f.size ?? 0).toLocaleString()} chars · {new Date(f.updated_at + 'Z').toLocaleString()}
                  </div>
                </Link>
              </li>
            ))}
            {!loading && files.length === 0 && (
              <li className="px-4 py-6 text-sm text-neutral-500 text-center">empty. paste something above.</li>
            )}
          </ul>
        </section>
      </main>
    </div>
  )
}
