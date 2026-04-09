/**
 * GET /api/hosted/{username}/{...path} — Serve static files from deployed sites.
 *
 * Middleware rewrites subdomain requests to this route:
 *   alice.daemon.page/styles.css -> /api/hosted/alice/styles.css
 *   alice.daemon.page/           -> /api/hosted/alice/index.html
 *
 * Files are read from data/sites/{username}/{path}.
 */

import { NextRequest, NextResponse } from 'next/server'
import { readFileSync, existsSync, statSync, realpathSync, mkdirSync } from 'fs'
import { join, extname, resolve as resolvePath } from 'path'

const DAEMON_ROOT = join(process.cwd(), '..')
const SITES_DIR = join(DAEMON_ROOT, 'data', 'sites')

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.eot': 'application/vnd.ms-fontobject',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.pdf': 'application/pdf',
  '.xml': 'application/xml',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json',
  '.wasm': 'application/wasm',
}

function getMimeType(filePath: string): string {
  const ext = extname(filePath).toLowerCase()
  return MIME_TYPES[ext] || 'application/octet-stream'
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path: pathSegments } = await params
  if (!pathSegments || pathSegments.length === 0) {
    return new NextResponse('Not found', { status: 404 })
  }

  // First segment is the username
  const username = pathSegments[0]
  // Validate username: alphanumeric, dash, underscore only
  if (!/^[a-z0-9_-]+$/.test(username)) {
    return new NextResponse('Not found', { status: 404 })
  }

  // Remaining segments form the file path
  let relPath = pathSegments.slice(1).join('/')
  if (!relPath) relPath = 'index.html'

  // Security: no traversal
  const parts = relPath.split('/')
  for (const part of parts) {
    if (part === '..' || part === '.' || part.includes('\0')) {
      return new NextResponse('Forbidden', { status: 403 })
    }
  }

  const filePath = join(SITES_DIR, username, relPath)

  // Architecture critic finding M-4: realpath BOTH sides before
  // comparing. startsWith on raw path strings can be fooled by a
  // symlink pointing out of SITES_DIR. We resolve everything first
  // and then do the prefix check on the canonical paths.
  let realFilePath: string | null = null
  let realSitesRoot: string
  try {
    // SITES_DIR may not exist yet (no sites deployed). Create it
    // lazily so realpathSync below succeeds; otherwise the host
    // primitive is unusable on a fresh install.
    if (!existsSync(SITES_DIR)) {
      mkdirSync(SITES_DIR, { recursive: true, mode: 0o755 })
    }
    realSitesRoot = realpathSync(SITES_DIR)
  } catch {
    return new NextResponse('Not found', { status: 404 })
  }
  try {
    realFilePath = realpathSync(resolvePath(filePath))
  } catch {
    // File doesn't exist yet — that's fine, the SPA fallback below
    // handles it. We just need to make sure that IF a real path
    // resolves later, it stays under realSitesRoot.
    realFilePath = resolvePath(filePath)
  }
  if (realFilePath !== realSitesRoot && !realFilePath.startsWith(realSitesRoot + '/')) {
    return new NextResponse('Forbidden', { status: 403 })
  }

  // Check if path is a directory — serve index.html
  if (existsSync(filePath) && statSync(filePath).isDirectory()) {
    const indexPath = join(filePath, 'index.html')
    if (existsSync(indexPath)) {
      const content = readFileSync(indexPath)
      return new NextResponse(content, {
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'public, max-age=60',
        },
      })
    }
    return new NextResponse('Not found', { status: 404 })
  }

  if (!existsSync(filePath)) {
    // Try with .html extension (clean URLs)
    const htmlPath = filePath + '.html'
    if (existsSync(htmlPath)) {
      const content = readFileSync(htmlPath)
      return new NextResponse(content, {
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'public, max-age=60',
        },
      })
    }

    // SPA fallback: if no file found and index.html exists, serve that
    const spaIndex = join(SITES_DIR, username, 'index.html')
    if (existsSync(spaIndex) && !relPath.includes('.')) {
      const content = readFileSync(spaIndex)
      return new NextResponse(content, {
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'public, max-age=60',
        },
      })
    }

    return new NextResponse('Not found', { status: 404 })
  }

  const content = readFileSync(filePath)
  const contentType = getMimeType(filePath)

  // Cache static assets longer
  const isAsset = /\.(css|js|png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|otf|webp|avif)$/i.test(filePath)
  const cacheControl = isAsset ? 'public, max-age=3600' : 'public, max-age=60'

  return new NextResponse(content, {
    headers: {
      'Content-Type': contentType,
      'Cache-Control': cacheControl,
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
