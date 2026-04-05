# Daemon Infrastructure Research

**Date:** 2026-04-05
**Context:** Daemon is a multi-device AI agent platform. Users connect phones, laptops, and servers via WebSocket to a central server that routes AI requests, stores conversations (SQLite + Qdrant), manages device connections, and serves a Next.js web UI. Currently runs on Arthur's home Ubuntu machine (arturito).

**Current resource profile:**
- Server: 24-core CPU, 32GB RAM, 468GB NVMe
- Daemon process footprint: ~120MB RAM, negligible CPU (7.7s total CPU over 1h uptime)
- Qdrant: runs in Docker alongside other services
- Network: residential internet via Cloudflare Tunnel
- Actual load: 1 user (Arthur), ~3 connected devices

---

## 1. Self-Hosted Single Server (Current Setup)

### What we have
- Ubuntu 24.04, 24-core AMD, 32GB RAM, 468GB NVMe
- Cloudflare Tunnel for ingress (bypasses NAT/firewall, provides DDoS protection)
- systemd services for daemon-web, Qdrant Docker, and several other apps
- Total system usage: ~15GB RAM across all services (daemon is only ~120MB)

### Pros
- Zero monthly hosting cost (already owned hardware)
- Full control over everything
- No data leaves the premises (maximum sovereignty)
- 24 cores is massive overkill for current needs -- room to grow
- Can run local AI models (if GPU added)
- No bandwidth limits

### Cons
- **Single point of failure**: power outage, ISP outage, hardware failure = total downtime
- **No SLA**: residential internet typically 95-98% uptime vs 99.9%+ for data centers
- **No redundancy**: disk failure = data loss (unless backed up externally)
- **Latency**: users far from Turin get worse WebSocket latency
- **Scaling ceiling**: one box maxes out eventually
- **Security surface**: home network exposed via tunnel

### Real costs
- Electricity: ~50-80 EUR/month for always-on desktop (varies by local rates)
- Internet: already paying for it (~30-50 EUR/month)
- Replacement hardware: amortize ~1000-1500 EUR over 3-5 years = ~25-40 EUR/month
- **Effective cost: ~100-170 EUR/month** (often invisible because it is already paid for)

### Scaling analysis
- **10 users**: Easily handled. WebSocket connections are lightweight (~50KB each). 120MB RAM barely moves.
- **100 users**: Still fine for connections. Risk is AI API calls creating concurrent load on response processing, and residential internet upload becoming a bottleneck (typically 20-50 Mbps).
- **1000 users**: Residential internet becomes the hard blocker. Upload bandwidth saturates. Need to move to a data center or split the architecture.

### Reliability
- Realistic uptime: ~97-99% (ISP outages, power blips, kernel updates)
- No automatic failover
- Cloudflare Tunnel reconnects automatically after brief outages

### Verdict
**Good for now (1-10 users). Must migrate before 50+ users.** The real risk is not capacity but reliability -- a single ISP outage or power cut takes everything down with no failover.

---

## 2. VPS Providers

### Do we actually need 24 cores?

**No.** Daemon's server is a Node.js WebSocket relay + Next.js frontend + Qdrant. Current CPU usage is negligible. The heavy compute (AI inference) happens at API providers (OpenRouter, Anthropic, DeepSeek). For 10-100 users, **4 vCPU / 8GB RAM** is more than enough. For 1000 users, **8 vCPU / 16GB RAM** with proper connection pooling.

### Provider Comparison

#### Hetzner (Falkenstein/Nuremberg/Helsinki, EU)

**Shared vCPU (CX series, x86):**
| Plan  | vCPU | RAM   | Storage  | Traffic | Price/mo |
|-------|------|-------|----------|---------|----------|
| CX22  | 2    | 4 GB  | 40 GB   | 20 TB   | ~4.50 EUR |
| CX32  | 4    | 8 GB  | 80 GB   | 20 TB   | ~8.50 EUR |
| CX42  | 8    | 16 GB | 160 GB  | 20 TB   | ~16 EUR  |
| CX52  | 16   | 32 GB | 320 GB  | 20 TB   | ~31 EUR  |

**ARM (CAX series, Ampere Altra):**
| Plan   | vCPU | RAM   | Storage  | Traffic | Price/mo |
|--------|------|-------|----------|---------|----------|
| CAX11  | 2    | 4 GB  | 40 GB   | 20 TB   | ~3.90 EUR |
| CAX21  | 4    | 8 GB  | 80 GB   | 20 TB   | ~7 EUR   |
| CAX31  | 8    | 16 GB | 160 GB  | 20 TB   | ~13 EUR  |
| CAX41  | 16   | 32 GB | 320 GB  | 20 TB   | ~25 EUR  |

**Dedicated servers (bare metal):**
| Model    | CPU               | Cores | RAM    | Storage       | Price/mo |
|----------|-------------------|-------|--------|---------------|----------|
| AX41     | Ryzen 5 3600      | 6     | 64 GB  | 2x512GB NVMe  | ~39 EUR  |
| AX42-U   | Ryzen 7 PRO 8700GE| 8     | 64 GB  | 2x512GB NVMe  | ~49 EUR  |
| AX102-U  | Ryzen 9 7950X3D   | 16    | 128 GB | 2x1.92TB NVMe | ~99 EUR  |

**GPU:** Hetzner does not offer consumer GPU cloud instances. Their GPU-Line dedicated servers are enterprise-grade (A100/H100 class, pricing on request).

**Why Hetzner stands out:** Unmatched price-to-performance ratio for EU hosting. 20TB included traffic is generous. All data centers in EU (GDPR compliant, not subject to US CLOUD Act). ARM instances (CAX) are the best value in the industry.

#### Vultr (Global, 32+ locations)

| Plan Type        | vCPU | RAM   | Storage  | Traffic | Price/mo |
|------------------|------|-------|----------|---------|----------|
| High Performance | 1    | 1 GB  | 25 GB    | 2 TB    | $6       |
| High Performance | 2    | 4 GB  | 100 GB   | 5 TB    | $24      |
| High Performance | 4    | 8 GB  | 180 GB   | 6 TB    | $48      |
| Optimized        | 8    | 32 GB | 160 GB   | 7 TB    | $240     |
| Bare Metal       | 4c   | 32 GB | -        | -       | $120     |

**GPU:** L40S at $1.67/GPU/hr (~$1,200/mo), AMD MI300X at $1.85/GPU/hr. B200 on request.

**EU locations:** Amsterdam, Frankfurt, London, Paris, Stockholm, Warsaw, Madrid.

#### DigitalOcean (Global)

| Plan    | vCPU | RAM    | Storage | Transfer | Price/mo |
|---------|------|--------|---------|----------|----------|
| Basic   | 1    | 512 MB | 10 GB   | 500 GB   | $4       |
| Basic   | 1    | 1 GB   | 25 GB   | 1 TB     | $6       |
| Basic   | 2    | 4 GB   | 80 GB   | 4 TB     | $24      |
| Basic   | 4    | 8 GB   | 160 GB  | 5 TB     | $48      |

**GPU:** DigitalOcean offers GPU Droplets (H100 class) but pricing is enterprise-tier.

**EU locations:** Amsterdam, Frankfurt, London.

Per-second billing since January 2026.

#### OVHcloud (EU-headquartered, Roubaix/Strasbourg/Warsaw)

- VPS plans start around 3.50 EUR/month
- Unlimited traffic included (unique selling point)
- Strong GDPR stance: "not subject to US CLOUD Act"
- Daily automatic backups included free
- Anti-DDoS included
- Specific plan pricing requires visiting their configurator

#### Linode/Akamai (Global)

Redirects to Akamai Cloud Computing. Pricing comparable to DigitalOcean. Linode branding being phased out.

### VPS Recommendation for Daemon

**Phase 1 (1-50 users): Hetzner CAX21 (ARM)**
- 4 vCPU, 8GB RAM, 80GB storage, 20TB traffic
- **~7 EUR/month** (~$7.50)
- Run everything: Node.js server, Next.js, Qdrant, SQLite
- ARM is fine -- Node.js, Qdrant, and Next.js all run natively on aarch64

**Phase 2 (50-500 users): Hetzner CAX41 or AX41 dedicated**
- CAX41: 16 vCPU, 32GB RAM -- ~25 EUR/month
- AX41: 6-core Ryzen, 64GB RAM, bare metal -- ~39 EUR/month
- Bare metal gives better I/O for Qdrant vector search

**Phase 3 (500-1000+ users): AX102-U or multi-server**
- 16-core Ryzen 9, 128GB RAM -- ~99 EUR/month
- Or split: separate WS server + DB server + web server

### Cost at scale

| Users | Recommended Plan      | Monthly Cost |
|-------|-----------------------|-------------|
| 10    | Hetzner CAX21         | ~7 EUR      |
| 100   | Hetzner CAX41         | ~25 EUR     |
| 1000  | Hetzner AX102-U       | ~99 EUR     |

---

## 3. Container Platforms (PaaS)

### Railway

**Pricing:** Pay-per-use after $5/mo (Hobby) or $20/mo (Pro) base.
- CPU: $0.000463/vCPU-min ($20/vCPU-month)
- RAM: $0.000231/GB-min ($10/GB-month)
- Volumes: $0.25/GB-month
- Egress: $0.05/GB

**WebSocket support:** Works. No documented idle timeout for WebSockets. Long-lived connections supported. Railway uses a custom proxy that handles upgrade headers properly.

**Scaling:** Up to 48 vCPU per service (Hobby), 1000 vCPU (Pro). Horizontal replicas up to 42 on Pro.

**Can run Qdrant + SQLite?** Yes. Qdrant as a separate service with a volume. SQLite on a volume (but be careful with concurrent writes across replicas -- stick to single replica for SQLite).

**Cost estimate:**
| Users | Config                          | Monthly Cost |
|-------|---------------------------------|-------------|
| 10    | 1 vCPU, 1GB RAM, 5GB volume    | ~$35        |
| 100   | 2 vCPU, 4GB RAM, 20GB volume   | ~$65        |
| 1000  | 8 vCPU, 16GB RAM, 50GB volume  | ~$220       |

### Fly.io

**Pricing:** Pay-per-second for running machines.
- Shared CPU: from ~$2/mo (shared-cpu-1x, 256MB)
- Performance CPU: from ~$32/mo (performance-1x, 2GB)
- Volumes: $0.15/GB-month
- Egress: $0.02/GB (NA/EU)
- Dedicated IPv4: $2/mo

**WebSocket support:** Full support. Configurable idle timeout (default varies, can be set in fly.toml). Machines stay running as long as connections are active. Fly Proxy handles WebSocket upgrades natively.

**Edge deployment:** Fly runs machines at the edge in 30+ regions. Can run your WebSocket server close to users globally. This is Fly's main advantage.

**Can run Qdrant + SQLite?** Yes. Qdrant as a separate Fly Machine with a volume. SQLite with LiteFS for distributed reads (Fly's recommended pattern). Single-region SQLite on a volume is simplest.

**Cost estimate:**
| Users | Config                              | Monthly Cost |
|-------|-------------------------------------|-------------|
| 10    | shared-cpu-2x, 1GB, 10GB vol       | ~$15        |
| 100   | performance-2x, 4GB, 20GB vol      | ~$70        |
| 1000  | performance-4x, 8GB, 50GB vol x2   | ~$200       |

**Key advantage:** If users are global, Fly can run WebSocket servers in multiple regions, reducing latency significantly.

### Render

**Pricing:** Plans from free (Hobby) to $29/user-month (Organization).
- Web services: Free tier available, paid from ~$7/mo (512MB, 0.5 CPU)
- Pro tier: $85/mo (4GB, 2 CPU), Pro Ultra: $450/mo (32GB, 8 CPU)
- Persistent disk: $0.25/GB-month
- Postgres: from $6/mo

**WebSocket support:** Documented and supported across all tiers. No explicit idle timeout documentation found, but generally reliable for WebSocket apps.

**Autoscaling:** Available on Professional tier and above.

**Cost estimate:**
| Users | Config                     | Monthly Cost |
|-------|----------------------------|-------------|
| 10    | Starter ($7) + Postgres    | ~$20        |
| 100   | Pro ($85) + Postgres       | ~$100       |
| 1000  | Pro Ultra ($450) + Postgres| ~$500       |

### PaaS Comparison Summary

| Feature          | Railway    | Fly.io     | Render     |
|------------------|------------|------------|------------|
| WebSocket        | Good       | Excellent  | Good       |
| Edge/Multi-region| No         | Yes (30+)  | No         |
| Qdrant possible  | Yes        | Yes        | Harder     |
| SQLite volumes   | Yes        | Yes (LiteFS)| Yes       |
| Auto-scaling     | Replicas   | Per-region | Horizontal |
| EU regions       | Yes        | Yes        | Frankfurt  |
| Deploy from Git  | Yes        | Yes        | Yes        |
| Docker support   | Yes        | Yes        | Yes        |
| Cost (10 users)  | ~$35       | ~$15       | ~$20       |
| Cost (100 users) | ~$65       | ~$70       | ~$100      |

**Winner for Daemon: Fly.io** -- edge deployment for global WebSocket latency, good pricing, strong Docker/volume support, active development community.

---

## 4. Serverless

### Can Daemon's architecture work serverless?

**Short answer: Not without major refactoring, and it's not worth it.**

#### Vercel
- **No native WebSocket support.** Vercel Functions (both Node.js and Edge runtimes) are request-response only. Maximum duration is 25 seconds before a response must begin, 300 seconds for streaming.
- Could host the Next.js web UI (it is designed for this).
- Cannot host the WebSocket device connection server.
- Cannot run Qdrant.

#### Cloudflare Workers
- No native WebSocket server support in basic Workers.
- **Durable Objects** support WebSocket Hibernation (see section 5).
- Workers have a 30-second CPU time limit.

#### AWS Lambda
- No native WebSocket support. API Gateway WebSocket APIs exist but add complexity and cost.
- Cold starts add latency to every reconnection.
- Lambda has a 15-minute maximum execution time.

### Hybrid Approach (Recommended if going this route)

| Component        | Where              | Why                                      |
|------------------|--------------------|------------------------------------------|
| Web UI (Next.js) | Vercel             | Built for Next.js, global CDN, free tier |
| WS Server        | Fly.io or VPS      | Needs persistent connections             |
| Qdrant           | VPS or Qdrant Cloud| Needs persistent storage + memory        |
| SQLite           | Same as WS server  | Needs local disk                         |
| AI API calls     | Serverless-friendly| Already external (OpenRouter, Anthropic) |

**Cost estimate for hybrid:**
| Users | Vercel + Fly.io WS + Qdrant | Monthly Cost |
|-------|-----------------------------|-------------|
| 10    | Free + $10 + $0             | ~$10        |
| 100   | $20 + $50 + $25             | ~$95        |
| 1000  | $20 + $150 + $95            | ~$265       |

This is architecturally clean but adds operational complexity (two deploy targets, CORS, auth token sharing between frontend and WS server).

---

## 5. Edge Computing

### Cloudflare Durable Objects

**What they are:** Stateful serverless objects that combine compute + storage. Each object has a globally unique name, in-memory state, persistent SQLite storage, and native WebSocket Hibernation support.

**How it maps to Daemon:**
- Each user could be a Durable Object
- The DO manages that user's device connections via WebSocket Hibernation
- Conversations stored in DO's built-in SQLite
- Automatic global distribution -- DO migrates to be close to the user's devices

**Pricing:**
- Requests: 1M/month included, then $0.15/million (WebSocket messages count at 20:1 ratio)
- Duration: 400K GB-s/month included, then $12.50/million GB-s
- SQLite reads: 25B rows/month included, then $0.001/million
- SQLite writes: 50M rows/month included, then $1.00/million

**Cost estimate:**
- With WebSocket Hibernation (connections idle most of the time), duration charges drop dramatically
- 10 users, moderate usage: ~$5-10/month
- 100 users: ~$20-50/month
- 1000 users: ~$100-300/month (heavily depends on message frequency)

**Limitations:**
- Cannot run Qdrant (need external vector DB -- Qdrant Cloud, Pinecone, Turbopuffer)
- Cannot run arbitrary Docker containers
- Must rewrite WS server logic in Workers/DO paradigm
- 128MB memory limit per DO
- Vendor lock-in to Cloudflare

**Verdict:** Architecturally elegant for the WebSocket routing problem. The per-user Durable Object model is a natural fit. But requires significant rewrite and giving up Qdrant self-hosting. Best considered as a future optimization for global scale (1000+ users across continents), not an immediate move.

### Fly.io Edge

Already covered in section 3. Fly's edge deployment is more practical than Durable Objects because it runs standard Docker containers -- no rewrite needed. Deploy the existing Daemon server to Fly in a European region, then add more regions as users spread globally.

---

## 6. User-Hosted (Self-Hosted by Each User)

### The dream
Each user runs their own Daemon server. Complete data sovereignty. No central infrastructure costs. Users own their data, their AI keys, their device connections.

### How realistic is this?

**Docker Compose approach:**
```yaml
# What users would run
services:
  daemon-web:
    image: ghcr.io/daemon/daemon:latest
    ports: ["4800:4800", "4801:4801"]
    volumes: ["./data:/data"]
  qdrant:
    image: qdrant/qdrant:latest
    volumes: ["./qdrant:/qdrant/storage"]
```

**Pros:**
- Zero hosting cost for the project
- Maximum data sovereignty (data never leaves user's machine)
- Users can add their own AI API keys (BYOK)
- No scaling problem -- scales horizontally by definition

**Cons:**
- Most users cannot run Docker. Target audience (vibe coders, power users) might, but it is still friction.
- Port forwarding / NAT traversal is a pain for WebSocket connectivity from mobile devices
- User needs to keep their machine on 24/7 for phone connectivity
- Updates require user action (or auto-update mechanism)
- Debugging user-specific issues is a nightmare

### One-Click Deploy Options

#### Coolify (Self-hosted PaaS)
- Free, open-source alternative to Vercel/Railway
- Users install Coolify on any VPS, then deploy Daemon via Git or Docker
- Manages SSL, deployments, monitoring
- Users still need a VPS ($5-7/month on Hetzner)
- **Best for:** technically-capable users who want their own cloud

#### Dokku (Mini-Heroku)
- Free, open-source, single-host Heroku clone
- Git push to deploy
- Docker-powered, plugin system
- Extremely lightweight (can run on a $4 VPS)
- **Best for:** developers who want Heroku-like simplicity on their own server

#### CapRover
- Free, open-source, web GUI for managing Docker deployments
- Docker Swarm under the hood (can scale to multiple nodes)
- One-click app marketplace
- Setup takes ~10 minutes
- **Best for:** users who prefer a visual dashboard over CLI

### Hybrid: Managed + User-Hosted

The most practical approach is to offer both:
1. **Managed (default):** Users connect to daemon.page, we run the server on Hetzner/Fly
2. **Self-hosted (advanced):** Provide a Docker image + compose file for users who want to run their own instance
3. **Tunnel-based:** Users run Daemon locally but connect through a cloud relay for mobile access (like Tailscale + Cloudflare Tunnel)

**Cost to the project:**
| Model       | 10 users  | 100 users | 1000 users |
|-------------|-----------|-----------|------------|
| Managed     | ~7 EUR    | ~25 EUR   | ~99 EUR    |
| Self-hosted | 0 EUR     | 0 EUR     | 0 EUR      |
| Hybrid 50/50| ~4 EUR    | ~13 EUR   | ~50 EUR    |

---

## Comparison Matrix

| Criterion            | Self-Hosted | Hetzner VPS | Fly.io   | Railway  | CF Durable Objects | User-Hosted |
|----------------------|-------------|-------------|----------|----------|--------------------|-------------|
| **Cost (10 users)**  | ~0*         | ~7 EUR      | ~$15     | ~$35     | ~$5-10             | $0          |
| **Cost (100 users)** | ~0*         | ~25 EUR     | ~$70     | ~$65     | ~$20-50            | $0          |
| **Cost (1000 users)**| Blocked     | ~99 EUR     | ~$200    | ~$220    | ~$100-300          | $0          |
| **Uptime SLA**       | ~97-99%     | 99.9%       | 99.99%   | 99.9%    | 99.99%             | Varies      |
| **WebSocket quality**| Excellent   | Excellent   | Excellent| Good     | Good (DO pattern)  | Excellent   |
| **Data sovereignty** | Full        | EU (GDPR)   | EU avail | Variable | CF (US company)    | Full        |
| **Migration effort** | N/A         | Low (rsync) | Medium   | Medium   | High (rewrite)     | Low (Docker)|
| **GPU for inference** | Add card   | Dedicated only| No     | No       | No                 | User's GPU  |
| **Multi-region**     | No          | Manual      | Yes      | Yes      | Automatic          | N/A         |
| **Ops complexity**   | High        | Medium      | Low      | Low      | Low                | None (user) |

\* Already-owned hardware; real cost ~100-170 EUR/month when accounting for electricity, internet, and depreciation.

---

## Recommendation

### Immediate (now, 1-10 users): Stay on arturito
- Current setup works fine
- Add automated backups to Hetzner Storage Box (~3 EUR/month for 1TB) or B2
- Set up health monitoring (uptime.daemon.page using UptimeRobot or similar, free)

### Short-term (10-50 users): Hetzner CAX21
- **7 EUR/month** for 4 vCPU ARM, 8GB RAM, 80GB storage
- Docker Compose: daemon-web + Qdrant + reverse proxy
- Cloudflare Tunnel or Caddy for HTTPS
- Deploy with Coolify for web UI management, or simple docker compose + systemd
- Keep arturito as backup/staging

### Medium-term (50-500 users): Hetzner AX41 or Fly.io
- If users are EU-concentrated: **Hetzner AX41 dedicated** (~39 EUR/month, bare metal Ryzen, 64GB RAM)
- If users are global: **Fly.io** with regional deployment (~$70-200/month)
- Split architecture: web UI on Vercel (free for Next.js), WS server on Fly/Hetzner

### Long-term (500+ users): Multi-tier
- Vercel for web UI (scales automatically)
- Fly.io for WebSocket servers in multiple regions
- Managed Qdrant (Qdrant Cloud) or self-hosted on dedicated Hetzner
- Offer self-hosted option via Docker for power users (reduces managed infrastructure cost)
- Consider Cloudflare Durable Objects for the WebSocket routing layer if message patterns are mostly idle

### Key principle
**Start with the cheapest thing that works (Hetzner VPS at 7 EUR/month) and only add complexity when actual user numbers demand it.** Premature infrastructure optimization is the enemy of shipping.
