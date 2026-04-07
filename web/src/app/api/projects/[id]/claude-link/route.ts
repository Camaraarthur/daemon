import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, getUserId } from '@/lib/auth'
import { getProject, getClaudeCodeLink, disableClaudeCodeLink } from '@/lib/db'
import { linkProject, syncFromJsonl } from '@/lib/claude-sync'

/**
 * POST /api/projects/{id}/claude-link
 *   Body: { local_path?: string }
 *   Links the project to a Claude Code project directory. If local_path is
 *   omitted, uses the project's existing local_path.
 *
 * GET /api/projects/{id}/claude-link
 *   Returns the current link status.
 *
 * DELETE /api/projects/{id}/claude-link
 *   Disables the link (does not delete the JSONL files).
 */

export async function GET(req: NextRequest, ctx: RouteContext<'/api/projects/[id]/claude-link'>) {
  const authErr = requireAuth(req); if (authErr) return authErr
  const userId = await getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const { id } = await ctx.params
  const projectId = parseInt(id, 10)
  if (isNaN(projectId)) return NextResponse.json({ error: 'Invalid project id' }, { status: 400 })

  const proj = getProject(userId, projectId)
  if (!proj) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

  const link = getClaudeCodeLink(projectId)
  return NextResponse.json({
    linked: !!link?.enabled,
    claude_project_dir: link?.claude_project_dir || null,
    active_session_id: link?.active_session_id || null,
    last_synced_at: link?.last_synced_at || null,
  })
}

export async function POST(req: NextRequest, ctx: RouteContext<'/api/projects/[id]/claude-link'>) {
  const authErr = requireAuth(req); if (authErr) return authErr
  const userId = await getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const { id } = await ctx.params
  const projectId = parseInt(id, 10)
  if (isNaN(projectId)) return NextResponse.json({ error: 'Invalid project id' }, { status: 400 })

  const proj = getProject(userId, projectId)
  if (!proj) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

  let body: any = {}
  try { body = await req.json() } catch {}
  const localPath = body.local_path || proj.local_path
  if (!localPath) {
    return NextResponse.json({ error: 'Project has no local_path; provide one in the body' }, { status: 400 })
  }

  // Reject paths outside the user's home as a basic safety check
  const home = process.env.HOME || '/home/arthur'
  if (!localPath.startsWith(home)) {
    return NextResponse.json({ error: 'local_path must be inside your home directory' }, { status: 400 })
  }

  const result = linkProject(projectId, localPath)

  // Find the project's canonical thread to sync into
  const dbm = (await import('@/lib/db')).default
  const thread = dbm().prepare('SELECT id FROM chat_threads WHERE project_id = ? LIMIT 1').get(projectId) as { id: string } | undefined
  let imported = 0
  if (thread) {
    try { imported = syncFromJsonl(projectId, thread.id) } catch {}
  }

  return NextResponse.json({
    linked: true,
    claude_project_dir: result.claudeProjectDir,
    active_session_id: result.sessionId,
    directory_exists: result.exists,
    messages_imported: imported,
  })
}

export async function DELETE(req: NextRequest, ctx: RouteContext<'/api/projects/[id]/claude-link'>) {
  const authErr = requireAuth(req); if (authErr) return authErr
  const userId = await getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const { id } = await ctx.params
  const projectId = parseInt(id, 10)
  if (isNaN(projectId)) return NextResponse.json({ error: 'Invalid project id' }, { status: 400 })

  const proj = getProject(userId, projectId)
  if (!proj) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

  disableClaudeCodeLink(projectId)
  return NextResponse.json({ linked: false })
}
