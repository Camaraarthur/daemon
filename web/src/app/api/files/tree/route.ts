// SLICE-B: file-tree endpoint for @-mention autocomplete.
// Resolves a project's local_path from the relay DB, then asks the user's
// Linux daemon device to glob files under that path. Cached in-memory for
// 30s per project so a busy @-typer doesn't hammer the device.

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, getUserId } from '@/lib/auth'
import { getProject } from '@/lib/db'
import { invokeDeviceTool } from '@/lib/agent-loop'
import getDb from '@/lib/db'

const CACHE_TTL_MS = 30 * 1000
const MAX_PATHS = 5000
const SKIP_DIRS = ['.git', 'node_modules', 'dist', '.next', '.turbo', 'build', 'target', '.venv', '__pycache__']

type CacheEntry = { paths: string[]; expiresAt: number }
const treeCache = new Map<number, CacheEntry>()

// SLICE-B: pick the first Linux/macos daemon device for the user. The file
// tree call should run on whatever device hosts the project's local_path —
// for v0 we trust the user has one daemon device per machine and the
// project's local_path lives on that machine.
function resolveDevDeviceForUser(userId: number): string | null {
  const rows = getDb()
    .prepare(
      `SELECT device_id, platform, last_seen FROM device_tokens
       WHERE user_id = ? AND revoked = 0
       ORDER BY last_seen DESC`,
    )
    .all(userId) as Array<{ device_id: string; platform: string | null; last_seen: string | null }>
  for (const r of rows) {
    const plat = (r.platform || '').toLowerCase()
    if (plat === 'linux' || plat === 'macos' || plat === 'darwin') return r.device_id
  }
  // Fallback: first device of any platform
  return rows[0]?.device_id || null
}

export async function GET(req: NextRequest) {
  const authErr = requireAuth(req); if (authErr) return authErr
  const userId = await getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const url = new URL(req.url)
  const projectIdRaw = url.searchParams.get('project_id')
  const projectId = projectIdRaw ? parseInt(projectIdRaw, 10) : NaN
  if (!projectId || Number.isNaN(projectId)) {
    return NextResponse.json({ error: 'project_id required' }, { status: 400 })
  }

  const project = getProject(userId, projectId)
  if (!project) return NextResponse.json({ error: 'project not found' }, { status: 404 })
  if (!project.local_path) return NextResponse.json({ paths: [] })

  // Cache hit
  const now = Date.now()
  const cached = treeCache.get(projectId)
  if (cached && cached.expiresAt > now) {
    return NextResponse.json({ paths: cached.paths, cached: true })
  }

  const deviceId = resolveDevDeviceForUser(userId)
  if (!deviceId) {
    return NextResponse.json({ paths: [], error: 'no device online' })
  }

  // Invoke `glob` on the device. cli/daemon.mjs's glob tool returns matches
  // under cwd; we pass an absolute base via cwd and a recursive pattern.
  let raw: string
  try {
    raw = await invokeDeviceTool(
      deviceId,
      'glob',
      { pattern: '**/*', path: project.local_path },
      String(userId),
    )
  } catch (e: any) {
    return NextResponse.json({ paths: [], error: e?.message || 'device call failed' }, { status: 502 })
  }

  let paths: string[] = []
  try {
    const parsed = JSON.parse(raw)
    // glob may return { matches: [...] } or { paths: [...] } or an array
    const arr: string[] = Array.isArray(parsed)
      ? parsed
      : (parsed.matches || parsed.paths || parsed.files || [])
    if (Array.isArray(arr)) {
      paths = arr.filter((p: any) => typeof p === 'string')
    }
  } catch {
    paths = []
  }

  // Strip the local_path prefix to get repo-relative paths, and skip noisy dirs.
  const base = project.local_path.endsWith('/') ? project.local_path : project.local_path + '/'
  paths = paths
    .map((p) => (p.startsWith(base) ? p.slice(base.length) : p))
    .filter((p) => {
      const segs = p.split('/')
      return !segs.some((s) => SKIP_DIRS.includes(s))
    })
    .slice(0, MAX_PATHS)

  treeCache.set(projectId, { paths, expiresAt: now + CACHE_TTL_MS })
  return NextResponse.json({ paths })
}
