import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, getUserId } from '@/lib/auth'
import { deviceListFiles, devicePutFile } from '@/lib/device-files'

export async function GET(req: NextRequest) {
  const authErr = requireAuth(req); if (authErr) return authErr
  const userId = await getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const limit = Math.min(Math.max(parseInt(req.nextUrl.searchParams.get('limit') || '200', 10), 1), 1000)
  const r = await deviceListFiles(userId, limit)
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 502 })
  return NextResponse.json({ files: r.files || [] })
}

export async function POST(req: NextRequest) {
  const authErr = requireAuth(req); if (authErr) return authErr
  const userId = await getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  if (typeof body?.body !== 'string') {
    return NextResponse.json({ error: 'Missing body' }, { status: 400 })
  }
  const r = await devicePutFile(userId, {
    id: body.id,
    title: String(body.title || '').slice(0, 500),
    body: body.body,
    mime: body.mime,
  })
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 502 })
  return NextResponse.json({ file: r.file })
}
