import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, getUserId } from '@/lib/auth'
import { getProject, updateProject } from '@/lib/db'

/**
 * POST /api/projects/{id}/archive — soft-delete the project from the sidebar.
 *
 * The row stays so chat_threads + message history still resolve cleanly. The
 * project just disappears from listProjects unless includeArchived is set.
 *
 * Body: { archived: boolean } — defaults to true. Pass false to un-archive.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const authErr = requireAuth(req); if (authErr) return authErr
  const userId = await getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const { id } = await ctx.params
  const projectId = parseInt(id, 10)
  if (!Number.isFinite(projectId)) {
    return NextResponse.json({ error: 'Invalid project id' }, { status: 400 })
  }

  const project = getProject(userId, projectId)
  if (!project) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 })
  }

  const body = await req.json().catch(() => ({}))
  const archived = body?.archived !== false

  let settings: Record<string, unknown> = {}
  try { settings = JSON.parse(project.settings || '{}') } catch {}
  settings.archived = archived

  const ok = updateProject(userId, projectId, { settings: JSON.stringify(settings) })
  return NextResponse.json({ ok, archived })
}
