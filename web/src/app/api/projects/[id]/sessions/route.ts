import { NextRequest, NextResponse } from 'next/server'
import { readdirSync, readFileSync, statSync } from 'fs'
import { join } from 'path'
import { requireAuth, getUserId } from '@/lib/auth'
import { getProject, getClaudeCodeLink, listThreads } from '@/lib/db'

/**
 * GET /api/projects/{id}/sessions — list every past chat under this project.
 *
 * Merges two sources:
 *   1. DB chat_threads (daemon UI-native conversations)
 *   2. Claude-Code JSONL session files in the linked directory
 *      (~/.claude/projects/-home-arthur-daemon/*.jsonl)
 *
 * Both normalized into the same {id, title, updated_at, message_count,
 * source} shape so the sidebar renders them as siblings. Sorted by
 * updated_at DESC so the most recent bubbles to the top.
 *
 * This is the "all conversations under this project, no clicks" view
 * the user asked for when he said he has many daemon chats he needs to
 * see named and clickable.
 */

interface SessionItem {
  id: string
  title: string
  updated_at: string
  message_count: number
  source: 'db' | 'jsonl'
}

function extractTitleFromJsonl(path: string): { title: string; userMsgs: number; count: number } {
  let title = ''
  let count = 0
  let userMsgs = 0
  // Short-spawn sentinel patterns we skip when picking the title AND don't
  // count as a "real user message" for the filter threshold.
  const isSkippable = (t: string) => (
    !t ||
    t.startsWith('<local-command-caveat>') ||
    t.startsWith('<command-message>') ||
    t.startsWith('<command-name>') ||
    t.startsWith('<user-prompt') ||
    t.startsWith('You are ') ||         // any "You are X" persona/system prompt
    t.startsWith('You classify') ||
    t.startsWith('Classify ') ||
    t.startsWith('Below is') ||         // "Below is the start of a conversation..."
    t.startsWith('Given the following') ||
    t.startsWith('Recent voice conversation') ||
    t.startsWith('Return ONLY JSON') ||
    t.startsWith('[Pasted text') ||
    t.startsWith('Unknown skill') ||
    t.startsWith('<system-reminder>') ||
    t.startsWith('/') ||
    // Substring catch: titler/classifier prompts always demand JSON output.
    // No human types this phrase in chat. Catches "Given X, return ONLY JSON {…}".
    t.includes('Return ONLY JSON') ||
    t.trim().length < 8
  )
  try {
    const fd = readFileSync(path, { encoding: 'utf8' }).slice(0, 400_000)
    const lines = fd.split('\n')
    for (const raw of lines) {
      if (!raw.trim()) continue
      count++
      let obj: any
      try { obj = JSON.parse(raw) } catch { continue }
      if (obj?.type !== 'user') continue
      let text = ''
      const content = obj?.message?.content
      if (typeof content === 'string') text = content
      else if (Array.isArray(content)) {
        for (const block of content) {
          if (block?.type === 'text' && typeof block.text === 'string') {
            text = block.text
            break
          }
        }
      }
      if (isSkippable(text)) continue
      userMsgs++
      if (title) continue
      title = text.replace(/\s+/g, ' ').trim().slice(0, 70)
      if (title.length === 70) title += '…'
    }
  } catch {}
  return { title: title || 'Untitled session', userMsgs, count }
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const authErr = requireAuth(req); if (authErr) return authErr
  const userId = await getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const { id } = await ctx.params
  const projectId = parseInt(id, 10)
  if (!Number.isFinite(projectId)) {
    return NextResponse.json({ error: 'Invalid project id' }, { status: 400 })
  }

  const project = getProject(userId, projectId)
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

  const items: SessionItem[] = []

  // 1. DB-backed threads
  for (const t of listThreads(userId, projectId)) {
    items.push({
      id: t.id,
      title: t.title || 'Untitled',
      updated_at: t.last_message_at || t.created_at,
      message_count: 0, // filled below if we want counts
      source: 'db',
    })
  }

  // 2. Claude-Code JSONL sessions in the linked dir
  const link = getClaudeCodeLink(projectId)
  if (link?.claude_project_dir) {
    try {
      const dir = link.claude_project_dir
      const files = readdirSync(dir).filter((f) => f.endsWith('.jsonl'))
      for (const f of files) {
        const full = join(dir, f)
        let mtime = ''
        try { mtime = statSync(full).mtime.toISOString() } catch {}
        const { title, userMsgs, count } = extractTitleFromJsonl(full)
        // Filter purely-empty sessions (no substantive human prompt at all).
        // Was `< 2` which dropped every single-prompt agentic session: most
        // real coding sessions are 1 human prompt + 40+ turns of agent work,
        // and the strict "substantive user msg" filter inside extract counts
        // only ONE for them. `< 2` emptied the sidebar.
        if (userMsgs < 1) continue
        const sessionId = f.replace(/\.jsonl$/, '')
        if (items.find((i) => i.id === sessionId)) continue
        items.push({
          id: sessionId,
          title,
          updated_at: mtime,
          message_count: count,
          source: 'jsonl',
        })
      }
    } catch (e) {
      console.warn('[sessions] scan failed for', link.claude_project_dir, e)
    }
  }

  items.sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''))

  return NextResponse.json({ sessions: items })
}
