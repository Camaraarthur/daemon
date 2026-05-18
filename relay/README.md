# daemon-relay

A minimum-trust Cloudflare Worker that proxies daemon phones to OpenRouter
using Daemons' OpenRouter key. This subsidises the **free beta tier** —
users without their own API keys still get all-models access, but
Daemons-the-company pays the bill.

## Trust posture (honest)

This Worker sits **in the data plane** for free-tier requests. That's a
step down from the strict v0.1 promise ("nothing Daemons-operated in the
network path"). Mitigations:

- **Stateless**: nothing persists past the request except a per-device
  daily counter (24h KV TTL).
- **No prompt logging**: the Worker passes the body through unread.
- **Open source**: `~/daemon/relay/src/index.js`.
- **Reproducible**: bit-identical from a tagged commit — verifiable.
- **No user identifier**: the only thing we track per-user is a random
  device-id-string used as a rate-limit key. Rotates daily.
- **Bypassable**: paste your own OpenRouter key in daemon's Settings →
  the phone calls OpenRouter directly, Worker out of path.

For full L1 trust ("no Daemons server in the data plane"), use BYOK.

## Deploying (one-time setup by Arthur)

```bash
cd ~/daemon/relay
npm install -g wrangler   # if not already

# 1. Create the KV namespace for the rate limiter.
npx wrangler kv:namespace create RATE_KV
# → paste the printed id into wrangler.toml under [[kv_namespaces]] id = "..."

# 2. Put the OpenRouter key as a Worker secret.
npx wrangler secret put OPENROUTER_KEY
# → paste $OPENROUTER_API_KEY from ~/.secrets/vault.env

# 3. Deploy.
npx wrangler deploy
# Returns: https://daemon-relay.<your-cf-subdomain>.workers.dev

# 4. (Optional) point relay.daemon.page → daemon-relay in CF dashboard
# Routes → Add → `relay.daemon.page/*` → daemon-relay
```

## Verifying

```bash
# from your laptop, hit the deployed Worker:
curl -X POST https://daemon-relay.<your-subdomain>.workers.dev/v1/chat/completions \
  -H "x-daemon-device-id: 00000000-test-test-test-000000000000" \
  -H "Content-Type: application/json" \
  -d '{"model":"anthropic/claude-sonnet-4.6","messages":[{"role":"user","content":"say hi"}],"max_tokens":50}'
```

You should get a normal OpenRouter / Anthropic response back.

## Daily limit

`DAILY_LIMIT` in `wrangler.toml` defaults to 100 requests/device/day.
Adjust based on how the $30/mo OpenRouter free tier burns. To raise just
for the dev / friend beta, bump the value and redeploy; no schema change
needed.

## Costs to Daemons

OpenRouter charges per-token, billed to the key. As of 2026-05-18 you're
on the $30/month free tier — ~30k short Sonnet replies/month at default
routing, or ~150k Qwen-3.5-Flash replies if the smart router picks the
cheap one for chit-chat. Set the daily cap to keep one bad day from
nuking the month.
