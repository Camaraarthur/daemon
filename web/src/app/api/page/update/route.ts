import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, getUserId } from '@/lib/auth'
import { executePageTool, isPageTool } from '@/lib/page-tools'

/**
 * POST /api/page/update
 *
 * HTTP wrapper around page-tools so non-agent callers (MCP servers,
 * the pendant phone MCP, CLI scripts) can mutate the user's published
 * page at <daemon_name>.daemon.page.
 *
 * Body: { tool: string, args: object }
 *   tool — one of the page_* tools (page_add_section, page_add_photo, ...)
 *   args — passed straight to executePageTool.
 */
export async function POST(req: NextRequest) {
  const unauth = requireAuth(req)
  if (unauth) return unauth

  const userId = await getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  let body: any
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const tool: string = typeof body?.tool === 'string' ? body.tool : ''
  const args = (body?.args && typeof body.args === 'object') ? body.args : {}
  if (!tool) return NextResponse.json({ error: 'tool required' }, { status: 400 })
  if (!isPageTool(tool)) return NextResponse.json({ error: `unknown page tool: ${tool}` }, { status: 400 })

  const result = await executePageTool(tool, args, { userId })
  try {
    const parsed = JSON.parse(result)
    return NextResponse.json(parsed)
  } catch {
    return NextResponse.json({ ok: false, error: result })
  }
}
