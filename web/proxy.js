/**
 * Lightweight reverse proxy on port 4800.
 * - WebSocket upgrade requests to /ws/* → port 4801 (device WS server)
 * - All HTTP requests → port 4802 (Next.js)
 */

import http from 'http'
import net from 'net'

const PORT = 4800
const NEXT_PORT = 4802
const WS_PORT = 4801
const VOICE_PORT = 4803

const server = http.createServer((req, res) => {
  // Proxy all HTTP to Next.js
  const proxy = http.request({
    hostname: '127.0.0.1',
    port: NEXT_PORT,
    path: req.url,
    method: req.method,
    headers: req.headers,
  }, (proxyRes) => {
    res.writeHead(proxyRes.statusCode || 500, proxyRes.headers)
    proxyRes.pipe(res)
  })
  proxy.on('error', (err) => {
    console.error('[proxy] HTTP error:', err.message)
    res.writeHead(502)
    res.end('Bad gateway')
  })
  req.pipe(proxy)
})

// Handle WebSocket upgrades
server.on('upgrade', (req, socket, head) => {
  // /ws/voice → voice companion server, /ws/* → device WS server, else → Next.js
  const targetPort = req.url?.startsWith('/ws/voice') ? VOICE_PORT
    : req.url?.startsWith('/ws') ? WS_PORT
    : NEXT_PORT

  const proxy = net.connect(targetPort, '127.0.0.1', () => {
    // Reconstruct the HTTP upgrade request
    const reqLine = `${req.method} ${req.url} HTTP/${req.httpVersion}\r\n`
    let headers = ''
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
      headers += `${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}\r\n`
    }
    proxy.write(reqLine + headers + '\r\n')
    if (head.length > 0) proxy.write(head)

    // Bidirectional pipe
    proxy.pipe(socket)
    socket.pipe(proxy)
  })

  proxy.on('error', (err) => {
    console.error(`[proxy] WS upgrade error (port ${targetPort}):`, err.message)
    socket.end()
  })
  socket.on('error', (err) => {
    console.error('[proxy] Socket error:', err.message)
    proxy.end()
  })
})

server.listen(PORT, () => {
  console.log(`[proxy] Listening on :${PORT} — HTTP→:${NEXT_PORT}, WS→:${WS_PORT}`)
})
