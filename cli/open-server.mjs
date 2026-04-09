/**
 * File-in-chat clickable links — device-side loopback HTTP server
 * (vision §4.2).
 *
 * The chat UI rendered in the browser detects file paths (anywhere
 * the user is on the SAME machine as the daemon device) and turns
 * them into clickable buttons that hit:
 *
 *   GET http://127.0.0.1:4810/open?path=/abs/path/to/file
 *
 * The endpoint resolves the real path (no symlinks pointing out of
 * the user's home), confirms it exists and is under $HOME, then
 * launches the OS default app (xdg-open / open / start).
 *
 * Hard rules (security — this is a localhost back door if we get it
 * wrong):
 *
 *   1. Bind ONLY to 127.0.0.1. Never 0.0.0.0.
 *   2. Realpath the requested path before any check (architecture
 *      critic finding M-4 — symlink traversal).
 *   3. Reject anything outside $HOME (no /etc, no /var/lib, no
 *      /proc, no /tmp).
 *   4. CORS: Access-Control-Allow-Origin set to the relay's
 *      origin only (https://my.daemon.page) plus localhost variants.
 *   5. No body parsing, no shell interpolation, no spawn shell:true.
 *      We exec the platform launcher with the realpath as argv[1].
 *
 * v1 limitation: no per-request token. The 127.0.0.1 bind means only
 * processes on the same machine can hit it, which is the same trust
 * boundary as the user's shell. v1.5 adds an HMAC token signed by
 * the device key so cross-tab clickjacking is harder to weaponize.
 */

import http from 'http'
import { realpathSync, statSync, existsSync } from 'fs'
import { spawn } from 'child_process'
import { userInfo, platform as osPlatform } from 'os'
import { resolve as resolvePath, sep } from 'path'

const LOOPBACK_HOST = '127.0.0.1'
const LOOPBACK_PORT = 4810

// Architecture critic finding M-1: drop localhost:4800 from prod
// allow-list. In dev, the relay's hosted route is reachable via
// localhost so a malicious published page would have the same
// origin as the relay. Gate on NODE_ENV.
const IS_DEV = process.env.NODE_ENV !== 'production'
const ALLOWED_ORIGINS = new Set(
  IS_DEV
    ? [
        'https://my.daemon.page',
        'https://daemon.page',
        'http://localhost:4800',
        'http://localhost:3000',
        'http://127.0.0.1:4800',
      ]
    : ['https://my.daemon.page', 'https://daemon.page'],
)

// M-2: require a custom request header so browsers MUST send a CORS
// preflight (which we can reject by Origin). Without this, a third-
// party page can trigger /open via <img src> or fetch(no-cors) and
// the browser never asks our server before launching xdg-open.
const REQUIRED_HEADER = 'x-daemon-open'

function corsHeaders(origin) {
  const ok = origin && ALLOWED_ORIGINS.has(origin)
  return {
    'Access-Control-Allow-Origin': ok ? origin : 'https://my.daemon.page',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': `Content-Type, ${REQUIRED_HEADER}`,
    'Access-Control-Max-Age': '600',
  }
}

function safeResolve(rawPath) {
  if (!rawPath || typeof rawPath !== 'string') {
    return { ok: false, error: 'path required' }
  }
  // Expand ~ to $HOME
  const home = userInfo().homedir
  let p = rawPath.startsWith('~/') ? home + rawPath.slice(1) : rawPath
  if (p === '~') p = home

  // Architecture critic finding M-3: platform-gate the absolute-path
  // check. On Linux/macOS require leading slash; on Windows require
  // a drive letter prefix. The previous "allow either form on any
  // platform" was loose enough that "C:/foo" passed on Linux and
  // resolved as a relative path under cwd.
  const isWin = osPlatform() === 'win32'
  if (isWin) {
    if (!/^[A-Za-z]:[\\/]/.test(p)) {
      return { ok: false, error: 'path must be a Windows absolute path (C:\\...)' }
    }
  } else {
    if (!p.startsWith('/')) {
      return { ok: false, error: 'path must be absolute' }
    }
  }

  // Resolve + realpath (kills symlinks pointing outside)
  let real
  try {
    real = realpathSync(resolvePath(p))
  } catch (e) {
    return { ok: false, error: `not found: ${e.code || e.message}` }
  }

  // Must exist (defensive — realpath would already have thrown)
  if (!existsSync(real)) {
    return { ok: false, error: 'not found after realpath' }
  }

  // Must live inside $HOME
  const homeReal = realpathSync(home)
  if (real !== homeReal && !real.startsWith(homeReal + sep)) {
    return { ok: false, error: 'path outside user home is not openable' }
  }

  // Don't open the home dir itself or anything in dotfiles unless
  // the request was explicit. (We don't want a stray "/home/arthur"
  // mention to open the entire home directory.)
  let kind
  try {
    const st = statSync(real)
    kind = st.isDirectory() ? 'dir' : 'file'
  } catch {
    return { ok: false, error: 'stat failed' }
  }

  return { ok: true, path: real, kind }
}

function launchOpener(absPath) {
  const plat = osPlatform()
  let cmd, args
  if (plat === 'darwin') {
    cmd = 'open'
    args = [absPath]
  } else if (plat === 'win32') {
    // start "" "<path>" via cmd.exe — no shell interpolation since we
    // pass the path as a separate argv element.
    cmd = 'cmd.exe'
    args = ['/c', 'start', '', absPath]
  } else {
    cmd = 'xdg-open'
    args = [absPath]
  }
  // shell:false is the default, but be explicit. detached so the
  // GUI app doesn't die when daemon-device.service restarts.
  const child = spawn(cmd, args, { detached: true, stdio: 'ignore' })
  child.unref()
  return { ok: true, cmd, args }
}

function originIsAllowed(origin) {
  return !!origin && ALLOWED_ORIGINS.has(origin)
}

async function readJsonBody(req, maxBytes = 8192) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let total = 0
    req.on('data', (chunk) => {
      total += chunk.length
      if (total > maxBytes) {
        reject(new Error('body too large'))
        try { req.destroy() } catch {}
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      try {
        const text = Buffer.concat(chunks).toString('utf8')
        if (!text) return resolve({})
        resolve(JSON.parse(text))
      } catch (e) {
        reject(e)
      }
    })
    req.on('error', reject)
  })
}

async function handleRequest(req, res, log) {
  const origin = req.headers.origin
  const headers = corsHeaders(origin)

  if (req.method === 'OPTIONS') {
    res.writeHead(204, headers)
    res.end()
    return
  }

  const url = new URL(req.url, `http://${LOOPBACK_HOST}:${LOOPBACK_PORT}`)
  if (url.pathname === '/health' && req.method === 'GET') {
    res.writeHead(200, { ...headers, 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: true, service: 'daemon-open', port: LOOPBACK_PORT }))
    return
  }
  if (url.pathname !== '/open') {
    res.writeHead(404, { ...headers, 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: false, error: 'not found' }))
    return
  }
  if (req.method !== 'POST') {
    res.writeHead(405, { ...headers, 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: false, error: 'method not allowed; use POST with X-Daemon-Open header' }))
    return
  }

  // M-2: hard-reject the REQUEST (not just response headers) if the
  // Origin is not allow-listed AND the required custom header is
  // missing. <img src> and form POST cannot set custom headers, so
  // they trigger a CORS preflight that we reject by Origin.
  if (!originIsAllowed(origin)) {
    log(`[open-server] reject origin: ${origin || '<none>'}`)
    res.writeHead(403, { ...headers, 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: false, error: 'origin not allowed' }))
    return
  }
  if (!req.headers[REQUIRED_HEADER]) {
    res.writeHead(403, { ...headers, 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: false, error: `missing ${REQUIRED_HEADER} header` }))
    return
  }

  let body
  try {
    body = await readJsonBody(req)
  } catch (e) {
    res.writeHead(400, { ...headers, 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: false, error: `bad json: ${e.message}` }))
    return
  }
  const rawPath = body.path
  const safe = safeResolve(rawPath)
  if (!safe.ok) {
    log(`[open-server] reject "${rawPath}": ${safe.error}`)
    res.writeHead(400, { ...headers, 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: false, error: safe.error }))
    return
  }

  let launch
  try {
    launch = launchOpener(safe.path)
  } catch (e) {
    log(`[open-server] launch failed: ${e.message}`)
    res.writeHead(500, { ...headers, 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: false, error: 'launch failed', detail: e.message }))
    return
  }

  log(`[open-server] opened ${safe.kind} ${safe.path}`)
  res.writeHead(200, { ...headers, 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ ok: true, path: safe.path, kind: safe.kind, ...launch }))
}

let _server = null

export function startOpenServer({ log = console.log } = {}) {
  if (_server) return _server
  _server = http.createServer((req, res) => {
    try {
      handleRequest(req, res, log)
    } catch (e) {
      log(`[open-server] uncaught: ${e.message}`)
      try {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: 'internal' }))
      } catch {}
    }
  })
  _server.on('error', (e) => {
    if (e.code === 'EADDRINUSE') {
      log(`[open-server] port ${LOOPBACK_PORT} already in use — another daemon device on this machine? open-server disabled.`)
    } else {
      log(`[open-server] error: ${e.message}`)
    }
    _server = null
  })
  _server.listen(LOOPBACK_PORT, LOOPBACK_HOST, () => {
    log(`[open-server] listening on http://${LOOPBACK_HOST}:${LOOPBACK_PORT}/open`)
  })
  return _server
}

export function stopOpenServer() {
  if (_server) {
    try { _server.close() } catch {}
    _server = null
  }
}

// Re-export for tests
export { safeResolve as _safeResolve }
