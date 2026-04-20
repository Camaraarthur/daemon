import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, getUserId } from '@/lib/auth'
import { deviceGetFile, devicePutFile, deviceDeleteFile } from '@/lib/device-files'

type Ctx = { params: Promise<{ id: string }> }

export async function GET(req: NextRequest, ctx: Ctx) {
  const authErr = requireAuth(req); if (authErr) return authErr
  const userId = await getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  const { id } = await ctx.params
  const r = await deviceGetFile(userId, id)
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.error === 'not found' ? 404 : 502 })
  return NextResponse.json({ file: r.file })
}

export async function PUT(req: NextRequest, ctx: Ctx) {
  const authErr = requireAuth(req); if (authErr) return authErr
  const userId = await getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  const { id } = await ctx.params
  const body = await req.json().catch(() => ({}))
  const r = await devicePutFile(userId, {
    id,
    title: typeof body.title === 'string' ? body.title.slice(0, 500) : undefined,
    body: typeof body.body === 'string' ? body.body : undefined,
    mime: typeof body.mime === 'string' ? body.mime : undefined,
  })
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 502 })
  return NextResponse.json({ file: r.file })
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const authErr = requireAuth(req); if (authErr) return authErr
  const userId = await getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  const { id } = await ctx.params
  const r = await deviceDeleteFile(userId, id)
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.error === 'not found' ? 404 : 502 })
  return NextResponse.json({ ok: true })
}
