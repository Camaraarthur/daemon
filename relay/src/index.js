// daemon-relay — minimum-trust proxy from daemon phones to OpenRouter.
//
// What this does:
//   POST /v1/chat/completions  →  https://openrouter.ai/api/v1/chat/completions
//   adds Authorization: Bearer <env.OPENROUTER_KEY>
//   per-device rate-limit via KV (DAILY_LIMIT requests/day)
//
// What this does NOT do:
//   - log prompt bodies
//   - log assistant responses
//   - retain any user identifier beyond a daily rate counter (rotates 24h)
//   - inspect / modify message content
//
// Source: github.com/Camaraarthur/daemon  (~/daemon/relay/src/index.js).
// Reproducible: bit-identical deploy from a tagged commit lets users verify
// the Worker running at relay.daemon.page matches this file.

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') return cors(new Response(null, { status: 204 }));
    if (request.method !== 'POST') {
      return cors(json({ error: 'method not allowed' }, 405));
    }
    const url = new URL(request.url);
    if (url.pathname !== '/v1/chat/completions') {
      return cors(json({ error: 'not found' }, 404));
    }

    // ─── Device id required for rate limit ────────────────────────────
    const deviceId = request.headers.get('x-daemon-device-id');
    if (!deviceId || deviceId.length < 8 || deviceId.length > 128) {
      return cors(json({ error: 'missing or invalid x-daemon-device-id' }, 401));
    }

    // ─── Daily rate limit per device ──────────────────────────────────
    const today = new Date().toISOString().slice(0, 10);
    const rlKey = `rl:${deviceId}:${today}`;
    const limit = parseInt(env.DAILY_LIMIT || '100', 10);
    const current = parseInt((await env.RATE_KV.get(rlKey)) || '0', 10);
    if (current >= limit) {
      return cors(json({
        error: `daily limit of ${limit} reached for this device. ` +
          `paste your own OpenRouter key in Settings to bypass.`,
      }, 429));
    }
    // Increment before we forward (fail open: if forwarding fails the
    // counter is still bumped — acceptable trade-off vs leakage).
    await env.RATE_KV.put(rlKey, String(current + 1), { expirationTtl: 90000 });

    // ─── Forward to OpenRouter (body passes through unchanged) ────────
    const orResp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.OPENROUTER_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://daemon.page',
        'X-Title': 'daemon-relay',
      },
      body: request.body,
    });

    // Stream the response back. We don't read the body so we don't see it.
    // (If users want token-count visibility from us, they have it in the
    // response itself — `usage` field — and the phone surfaces it.)
    return cors(new Response(orResp.body, {
      status: orResp.status,
      headers: {
        'Content-Type': orResp.headers.get('Content-Type') || 'application/json',
        // Forward OpenRouter's rate-limit signals upstream too.
        'X-OpenRouter-Status': String(orResp.status),
      },
    }));
  },
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function cors(resp) {
  resp.headers.set('Access-Control-Allow-Origin', '*');
  resp.headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  resp.headers.set('Access-Control-Allow-Headers', 'content-type, x-daemon-device-id');
  return resp;
}
