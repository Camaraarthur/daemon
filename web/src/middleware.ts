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
  '/api/hosted/',    // Hosted static sites — public (served at subdomains)
  '/api/waitlist',   // Waitlist signup — public on root daemon.page
  '/ws/',            // WebSocket device connections (proxied to WS server)
]

function isPublicRoute(path: string): boolean {
  // Exact match
  if (PUBLIC_ROUTES.includes(path)) return true
  // Prefix match for asset dirs
  if (PUBLIC_ROUTES.some(r => r.endsWith('/') && path.startsWith(r))) return true
  // Public API routes
  if (PUBLIC_API_ROUTES.includes(path)) return true
  // Prefix match for public API routes
  if (PUBLIC_API_ROUTES.some(r => r.endsWith('/') && path.startsWith(r))) return true
  // Next.js internals
  if (path.startsWith('/_next/')) return true
  if (path.startsWith('/favicon')) return true
  return false
}

function isPublicAsset(path: string): boolean {
  const ext = path.split('.').pop()?.toLowerCase()
  return ['png', 'jpg', 'svg', 'ico', 'css', 'js', 'woff', 'woff2', 'json'].includes(ext || '')
}

/**
 * Extract subdomain from host header.
 * Returns the subdomain if it's a user subdomain (e.g., "alice" from "alice.daemon.page"),
 * or null for root domain, www, my, etc.
 */
function getUserSubdomain(host: string): string | null {
  // Match *.daemon.page (production) or *.localhost:PORT (dev)
  let sub: string | null = null
  if (host.endsWith('.daemon.page')) {
    sub = host.replace('.daemon.page', '')
  } else if (host.match(/^[^.]+\.localhost(:\d+)?$/)) {
    sub = host.split('.')[0]
  }
  if (!sub) return null
  // Filter out reserved subdomains
  if (['www', 'api', 'app', 'admin', 'daemon', 'test'].includes(sub)) return null
  // Validate format
  if (!/^[a-z0-9_-]+$/.test(sub)) return null
  return sub
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

  // ── Subdomain hosted site routing ──────────────────────────
  // If a user subdomain has a deployed site, rewrite public requests
  // to the hosted file serving API route.
  const subdomain = getUserSubdomain(host)
  if (subdomain) {
    // These paths are always handled by the Next.js app, not the hosted site
    const appPaths = ['/chat', '/login', '/settings', '/api/', '/_next/', '/canvas', '/download', '/files']
    const isAppPath = appPaths.some(p => path === p || path.startsWith(p + '/') || path.startsWith(p))

    // Daemon-owned root assets — never route these to hosted sites
    const daemonAssets = [
      '/favicon', '/app-icon', '/manifest.json', '/robots.txt', '/sitemap.xml',
      '/daemon.apk', '/daemon-desktop.exe', '/install.sh', '/brand/', '/cli/', '/docs/', '/font/'
    ]
    const isDaemonAsset = daemonAssets.some(p => path === p || path.startsWith(p))

    if (!isAppPath && !isDaemonAsset) {
      // For root path (/), let Next.js handle it (shows DaemonPublicPage which
      // will check for hosted content via client-side fetch).
      // For all other paths, rewrite to the hosted file serving route.
      if (path !== '/') {
        const filePath = path.slice(1) // remove leading /
        const url = request.nextUrl.clone()
        url.pathname = `/api/hosted/${subdomain}/${filePath}`
        return NextResponse.rewrite(url)
      }
    }
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

  // Has token — let through.
  // For SPA-shell pages (the ones whose HTML references content-hashed
  // /_next/static/chunks/* JS), force no-store so Android WebView / Tauri
  // can't keep cached HTML that points at chunk hashes the server has
  // already evicted. Without this, every rebuild risks black-screening
  // existing app installs until they manually clear cache.
  const res = NextResponse.next()
  if (
    path === '/chat' || path.startsWith('/chat/') ||
    path === '/canvas' ||
    path === '/settings' || path.startsWith('/settings/') ||
    path === '/files'
  ) {
    res.headers.set('Cache-Control', 'no-store, must-revalidate')
    res.headers.set('Pragma', 'no-cache')
    res.headers.set('Expires', '0')
  }
  return res
}

export const config = {
  // Match ALL routes except Next.js internals
  matcher: ['/((?!_next/static|_next/image).*)'],
}
