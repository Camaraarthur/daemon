import { NextRequest, NextResponse } from 'next/server'

// SECURITY: EVERYTHING IS PROTECTED BY DEFAULT.
// Only routes listed here are public. Everything else requires auth.
const PUBLIC_ROUTES = [
  '/',           // Landing page / public daemon page
  '/canvas',     // Canvas iframe (embedded in public page)
  '/login',      // Google OAuth login page
  '/apk',        // APK download
  '/download',    // Download + pairing page
  '/logos',       // Logo gallery
  '/creature.html', // Creature generator
  '/live.html',  // Live sensor page
  '/brand/',     // Brand assets
  '/docs/',      // Research docs
  '/font/',      // Font assets
  '/favicon.png',
  '/app-icon.png',
  '/manifest.json',
  '/daemon.apk',
  '/daemon-desktop.exe',
  '/watch.apk',
]

const PUBLIC_API_ROUTES = [
  '/api/auth',       // Login/signup/check — obviously public
  '/api/health',     // Health check — public
  '/api/stream',     // SSE stream (canvas reads this, public)
  '/ws/',            // WebSocket device connections (proxied to WS server)
]

function isPublicRoute(path: string): boolean {
  // Exact match
  if (PUBLIC_ROUTES.includes(path)) return true
  // Prefix match for asset dirs
  if (PUBLIC_ROUTES.some(r => r.endsWith('/') && path.startsWith(r))) return true
  // Public API routes
  if (PUBLIC_API_ROUTES.includes(path)) return true
  // Next.js internals
  if (path.startsWith('/_next/')) return true
  if (path.startsWith('/favicon')) return true
  return false
}

function isPublicAsset(path: string): boolean {
  const ext = path.split('.').pop()?.toLowerCase()
  return ['png', 'jpg', 'svg', 'ico', 'css', 'js', 'woff', 'woff2', 'json'].includes(ext || '')
}

export function middleware(request: NextRequest) {
  const host = request.headers.get('host') || ''
  const path = request.nextUrl.pathname

  // Root domain (daemon.page) — landing page and signup are public
  if (host === 'daemon.page') {
    if (path === '/chat' || path.startsWith('/chat/')) {
      return NextResponse.redirect('https://daemon.page/')
    }
    return NextResponse.next()
  }

  // Static assets are always public
  if (isPublicAsset(path)) return NextResponse.next()

  // Public routes — no auth needed
  if (isPublicRoute(path)) return NextResponse.next()

  // EVERYTHING ELSE requires authentication via cookie token
  const token = request.cookies.get('daemon_token')?.value
  if (!token) {
    // No token — 401 for ALL API routes, redirect for pages
    if (path.startsWith('/api/')) {
      return new NextResponse(JSON.stringify({ error: 'Not authenticated' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    // Redirect pages to login
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  // Has token — let through
  return NextResponse.next()
}

export const config = {
  // Match ALL routes except Next.js internals
  matcher: ['/((?!_next/static|_next/image).*)'],
}
