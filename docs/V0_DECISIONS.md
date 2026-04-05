# Daemon v0 — Final Architecture Decisions

## Positioning
**One AI agent. Terminal access to every device you own.**

## What v0 IS
- Device mesh (connect devices, run commands, MCP protocol)
- Chat with free model (Qwen via OpenRouter)
- BYOK (paste your key, use any model)
- Link Claude Code subscription
- Memory (markdown files free, Gemini embeddings paid)
- Hosting on username.daemon.page
- Open source (Apache 2.0 or AGPLv3 — TBD)

## What v0 is NOT
- Billing/credits/Stripe/Coinbase
- Voice companion
- Personality engine
- API broker
- Watch app / ESP32
- Skills marketplace

## Core Protocol
- MCP for all device capabilities
- WebSocket over Cloudflare for connectivity
- 6-char pairing codes for device linking
- Progressive permissions (ask only when needed)

## Security (must-fix before launch)
- Fix shell injection in chat API
- Per-user Docker isolation
- Token expiration (30 days)
- Rate limiting
- Input sanitization
- Automated security scan for hosted apps

## Infrastructure
- Arturito for now, Hetzner €7/mo when scaling
- Cloudflare Tunnel for connectivity
- SQLite now, PostgreSQL at ~50 users
- Gemini Embedding 2 for memory

## User Journey
1. Visit daemon.page → "Connect Device" → detect OS → download app
2. App asks for ZERO permissions upfront, just login
3. Chat with free Qwen model immediately
4. Progressive: "Want to run commands? Allow terminal access"
5. BYOK or link Claude Max for premium models
6. Build apps → host on your daemon.page

## App Distribution
- Website links (not just terminal commands)
- QR code for phone download
- In-app update prompts
- Google Play later

## Sharing Model
- Build for yourself, share if you want
- Apps live on your daemon.page
- Friends can fork via their daemon
- Automated security scan before public hosting
- Not a marketplace — organic sharing like dotfiles
