import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, getUserId } from '@/lib/auth'
import { getProject, updateProject } from '@/lib/db'

/**
 * POST /api/projects/{id}/parent — set or clear the parent project.
 *
 * Body: { parent_id: number | null }
 *   - number → nest this project under that project in the sidebar tree
 *   - null   → make it top-level again
 *
 * Rejects:
 *   - setting parent to self
 *   - cycles (parent chain ending back at this project)
 *   - setting parent to an archived project
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
  const raw = body?.parent_id
  const parentId: number | null =
    raw === null || raw === undefined || raw === '' ? null : parseInt(String(raw), 10)
  if (parentId !== null && !Number.isFinite(parentId)) {
    return NextResponse.json({ error: 'Invalid parent_id' }, { status: 400 })
  }
  if (parentId === projectId) {
    return NextResponse.json({ error: 'Cannot set project as its own parent' }, { status: 400 })
  }

  // Cycle check: walk up from prospective parent and fail if we hit ourselves.
  if (parentId !== null) {
    const seen = new Set<number>()
    let cur: number | null = parentId
    while (cur !== null) {
      if (cur === projectId) {
        return NextResponse.json({ error: 'Would create a cycle' }, { status: 400 })
      }
      if (seen.has(cur)) break
      seen.add(cur)
      const p = getProject(userId, cur)
      cur = p?.parent_id ?? null
    }
  }

  const ok = updateProject(userId, projectId, { parent_id: parentId as any })
  return NextResponse.json({ ok, parent_id: parentId })
}
