/**
 * POST /api/deploy — Build and deploy a project to username.daemon.page
 *
 * Body: { project_id?: number, files?: Record<string, string>, html?: string }
 *
 * Three modes:
 * 1. project_id — finds the project, builds on connected device, deploys output
 * 2. files — direct upload of file map { "index.html": "<html>...", "style.css": "..." }
 * 3. html — shortcut: single HTML string deployed as index.html
 *
 * Response: { url, files_count, size_bytes } or { error }
 */

import { NextRequest, NextResponse } from 'next/server'
import { validateSession } from '@/lib/auth'
import { getProject } from '@/lib/db'
import { existsSync, mkdirSync, writeFileSync, rmSync, readdirSync, statSync } from 'fs'
import { join } from 'path'

const DAEMON_ROOT = join(process.cwd(), '..')
const SITES_DIR = join(DAEMON_ROOT, 'data', 'sites')
const MAX_SITE_SIZE = 50 * 1024 * 1024 // 50 MB per spec

// Patterns that indicate malicious content
const MALICIOUS_PATTERNS = [
  /crypto\.?miner/i,
  /coinhive/i,
  /monero/i,
  /\beval\s*\(\s*atob\s*\(/i,  // eval(atob(...)) — common obfuscation
  /document\.cookie\s*\+.*\.src\s*=/i, // cookie exfiltration
  /new\s+WebSocket\s*\(\s*['"`]wss?:\/\/(?!localhost)/i, // external websocket (not localhost)
]

function scanForMalicious(content: string): string | null {
  for (const pattern of MALICIOUS_PATTERNS) {
    if (pattern.test(content)) {
      return `Blocked: content matches security pattern ${pattern.source}`
    }
  }
  return null
}

function getDirSize(dirPath: string): number {
  let size = 0
  try {
    const entries = readdirSync(dirPath, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = join(dirPath, entry.name)
      if (entry.isDirectory()) {
        size += getDirSize(fullPath)
      } else {
        size += statSync(fullPath).size
      }
    }
  } catch {}
  return size
}

function countFiles(dirPath: string): number {
  let count = 0
  try {
    const entries = readdirSync(dirPath, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.isDirectory()) {
        count += countFiles(join(dirPath, entry.name))
      } else {
        count++
      }
    }
  } catch {}
  return count
}

/** Sanitize a relative file path — no traversal, no absolute paths */
function sanitizeRelPath(p: string): string | null {
  if (!p || typeof p !== 'string') return null
  // No null bytes
  const clean = p.replace(/\0/g, '')
  // No absolute paths
  if (clean.startsWith('/') || clean.startsWith('\\')) return null
  // No traversal
  const parts = clean.split(/[/\\]/)
  for (const part of parts) {
    if (part === '..' || part === '.') return null
  }
  // No hidden files
  if (parts.some(part => part.startsWith('.'))) return null
  return clean
}

export async function POST(req: NextRequest) {
  // Auth
  const token = req.cookies.get('daemon_token')?.value
  if (!token) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }
  const user = await validateSession(token)
  if (!user) {
    return NextResponse.json({ error: 'Invalid session' }, { status: 401 })
  }

  const body = await req.json()
  const { project_id, files, html } = body

  const username = user.daemon_name
  const siteDir = join(SITES_DIR, username)

  // Mode 3: Single HTML string
  if (html && typeof html === 'string') {
    const scanResult = scanForMalicious(html)
    if (scanResult) {
      return NextResponse.json({ error: scanResult }, { status: 400 })
    }

    if (Buffer.byteLength(html) > MAX_SITE_SIZE) {
      return NextResponse.json({ error: 'Site exceeds 50 MB limit' }, { status: 400 })
    }

    // Clean and write
    if (existsSync(siteDir)) rmSync(siteDir, { recursive: true })
    mkdirSync(siteDir, { recursive: true })
    writeFileSync(join(siteDir, 'index.html'), html)

    return NextResponse.json({
      url: `https://${username}.daemon.page`,
      files_count: 1,
      size_bytes: Buffer.byteLength(html),
    })
  }

  // Mode 2: File map upload
  if (files && typeof files === 'object') {
    // Validate total size
    let totalSize = 0
    const fileEntries: [string, string][] = []

    for (const [path, content] of Object.entries(files)) {
      if (typeof content !== 'string') continue
      const cleanPath = sanitizeRelPath(path)
      if (!cleanPath) {
        return NextResponse.json({ error: `Invalid file path: ${path}` }, { status: 400 })
      }
      const size = Buffer.byteLength(content as string)
      totalSize += size
      if (totalSize > MAX_SITE_SIZE) {
        return NextResponse.json({ error: 'Site exceeds 50 MB limit' }, { status: 400 })
      }
      // Security scan
      const scanResult = scanForMalicious(content as string)
      if (scanResult) {
        return NextResponse.json({ error: `${scanResult} in ${path}` }, { status: 400 })
      }
      fileEntries.push([cleanPath, content as string])
    }

    if (fileEntries.length === 0) {
      return NextResponse.json({ error: 'No valid files provided' }, { status: 400 })
    }

    // Clean and write
    if (existsSync(siteDir)) rmSync(siteDir, { recursive: true })
    mkdirSync(siteDir, { recursive: true })

    for (const [path, content] of fileEntries) {
      const fullPath = join(siteDir, path)
      const dir = fullPath.substring(0, fullPath.lastIndexOf('/'))
      if (dir && !existsSync(dir)) mkdirSync(dir, { recursive: true })
      writeFileSync(fullPath, content)
    }

    return NextResponse.json({
      url: `https://${username}.daemon.page`,
      files_count: fileEntries.length,
      size_bytes: totalSize,
    })
  }

  // Mode 1: Build from project
  if (project_id) {
    const project = getProject(user.id, project_id)
    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    }

    // For now, we don't have device build orchestration yet.
    // Return instructions for the agent to build and upload via files mode.
    return NextResponse.json({
      error: 'Project build not yet implemented. Use /deploy with files or html mode, or have the agent build and upload.',
      hint: 'The agent should: 1) build the project locally, 2) read the output files, 3) POST to /api/deploy with { files: { "index.html": "...", ... } }',
    }, { status: 501 })
  }

  return NextResponse.json({ error: 'Provide project_id, files, or html' }, { status: 400 })
}

/** GET /api/deploy — Check deploy status for current user */
export async function GET(req: NextRequest) {
  const token = req.cookies.get('daemon_token')?.value
  if (!token) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }
  const user = await validateSession(token)
  if (!user) {
    return NextResponse.json({ error: 'Invalid session' }, { status: 401 })
  }

  const siteDir = join(SITES_DIR, user.daemon_name)
  if (!existsSync(siteDir)) {
    return NextResponse.json({ deployed: false })
  }

  return NextResponse.json({
    deployed: true,
    url: `https://${user.daemon_name}.daemon.page`,
    files_count: countFiles(siteDir),
    size_bytes: getDirSize(siteDir),
  })
}
