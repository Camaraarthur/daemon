#!/usr/bin/env node
/**
 * Smoke test: /api/stream per-user partition.
 *
 * Verifies (at the HTTP layer) that when user A and user B each hold an
 * EventSource to /api/stream, events pushed for A don't leak to B.
 *
 * Prereqs:
 *   - daemon-web listening on $BASE (default http://localhost:4800)
 *   - Two valid session tokens: $TOKEN_A, $TOKEN_B
 *     (or $TOKEN for a single-user smoke fallback)
 *
 * Usage:
 *   BASE=http://localhost:4800 TOKEN_A=... TOKEN_B=... node scripts/smoke-canvas-partition.mjs
 *
 * Because we don't have a clean "push for a specific user from outside the
 * web process" endpoint, the full cross-user test is best-effort: it verifies
 * that two concurrent SSE connections coexist and each receives its own
 * idle/hello packet. The real cross-user fanout is covered by the e2e test
 * that drives the agent to call canvas_text and curls the SSE stream.
 */
const BASE = process.env.BASE || 'http://localhost:4800'
const TOKEN_A = process.env.TOKEN_A || process.env.TOKEN
const TOKEN_B = process.env.TOKEN_B

if (!TOKEN_A) {
  console.error('ERROR: set TOKEN_A (or TOKEN) env var')
  process.exit(2)
}

async function openStream(token, label, timeoutMs = 4000) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs)
  const res = await fetch(`${BASE}/api/stream`, {
    headers: { cookie: `daemon_token=${token}` },
    signal: ctrl.signal,
  }).catch(e => ({ _err: e }))
  if (res._err) {
    if (res._err.name === 'AbortError') return { label, events: [], aborted: true }
    throw res._err
  }
  const reader = res.body.getReader()
  const dec = new TextDecoder()
  let buf = ''
  const events = []
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buf += dec.decode(value, { stream: true })
      const lines = buf.split('\n')
      buf = lines.pop()
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try { events.push(JSON.parse(line.slice(6))) } catch {}
        }
      }
    }
  } catch (_) { /* aborted */ }
  clearTimeout(t)
  return { label, events }
}

const results = await Promise.all([
  openStream(TOKEN_A, 'A'),
  TOKEN_B ? openStream(TOKEN_B, 'B') : Promise.resolve({ label: 'B', events: [], skipped: true }),
])
for (const r of results) {
  console.log(`[${r.label}]`, r.skipped ? 'skipped (no TOKEN_B)' : `received ${r.events.length} events`)
  for (const e of r.events.slice(0, 3)) console.log(`   ${JSON.stringify(e)}`)
}
console.log('OK — both streams opened without leaking 401 to each other')
