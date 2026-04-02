import { requireAuth } from '@/lib/auth'
import { NextRequest, NextResponse } from 'next/server'
import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'fs'
import { join } from 'path'

const SHARE_DIR = '/home/arthur/daemon/data/shared'

export async function POST(req: NextRequest) {
  const authErr = requireAuth(req); if (authErr) return authErr
  const { filename, data } = await req.json()
  if (!filename || !data) return NextResponse.json({ error: 'Missing filename or data' }, { status: 400 })
  if (!existsSync(SHARE_DIR)) mkdirSync(SHARE_DIR, { recursive: true })
  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_')
  const ts = Date.now()
  const path = join(SHARE_DIR, `${ts}_${safeName}`)
  const bytes = Buffer.from(data, 'base64')
  writeFileSync(path, bytes)
  const metaPath = join(SHARE_DIR, 'index.json')
  let index: any[] = []
  try { index = JSON.parse(readFileSync(metaPath, 'utf-8')) } catch {}
  index.unshift({ filename: safeName, path, size: bytes.length, timestamp: ts, originalName: filename })
  writeFileSync(metaPath, JSON.stringify(index, null, 2))
  return NextResponse.json({ ok: true, filename: safeName, size: bytes.length })
}

export async function GET(req: NextRequest) {
  const authErr = requireAuth(req); if (authErr) return authErr
  const metaPath = join(SHARE_DIR, 'index.json')
  try {
    const index = JSON.parse(readFileSync(metaPath, 'utf-8'))
    return NextResponse.json({ files: index.slice(0, 50) })
  } catch {
    return NextResponse.json({ files: [] })
  }
}
