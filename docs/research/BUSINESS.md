# Daemon: Business Model & Distribution Strategy Research

**Research date:** April 5, 2026
**Context:** Open-source multi-device AI agent platform. Solo founder (Arthur), based in Milan. Target: vibe coders. Current model: free tier (Qwen) + Pro ($10/mo + $5 credits) + BYOK (free).

---

## Table of Contents

1. [Open-Source Business Models](#1-open-source-business-models)
2. [Pricing Psychology for Developer Tools](#2-pricing-psychology-for-developer-tools)
3. [Distribution Channels](#3-distribution-channels)
4. [Competitive Positioning](#4-competitive-positioning)
5. [Legal Structure & Licensing](#5-legal-structure--licensing)
6. [Fundraising Landscape](#6-fundraising-landscape)
7. [Community Building](#7-community-building)
8. [Daemon-Specific Recommendations](#8-daemon-specific-recommendations)

---

## 1. Open-Source Business Models

### What Works in 2026

The open-source business model landscape has matured significantly. The winners share one trait: **they monetize the convenience layer, not the code itself.**

#### Model A: Open Core (best fit for Daemon)

Open source the core platform, charge for enterprise/team features.

| Company | License | What's Free | What's Paid | ARR |
|---------|---------|-------------|-------------|-----|
| **Supabase** | Apache 2.0 | Database, auth, storage, APIs | Team features ($599/mo), enterprise compliance | $70M ARR, $5B valuation |
| **PostHog** | MIT + /ee | Analytics, feature flags, session replay | ClickHouse scale, SSO, enterprise features | ~$15M ARR, $1.4B valuation |
| **Cal.com** | AGPLv3 + /ee | Core scheduling (99% of code) | Team/org features ($15/user/mo), platform API ($2,499/mo) | Undisclosed |
| **GitLab** | MIT + EE | CI/CD, repos, issue tracking | Security scanning, compliance, advanced DevOps | $580M+ ARR |

**PostHog's approach is the most replicable for Daemon:**
- Usage-based pricing (not per-seat) aligned with actual value
- Generous free tier drives adoption
- "Buyer-based open core" -- charge for features executives care about (audit logs, SSO, compliance), not what developers care about
- Target: $100M ARR by end of 2026 with ~7% monthly growth

#### Model B: Managed Hosting / Cloud

Open source the code, monetize running it for people.

- **Supabase**: Self-host free, or pay $25-$599/mo for managed
- **Railway**: Open-source templates, charge for compute ($20/mo Pro + usage)
- **Fly.io**: Pay-as-you-go compute, soft free tier (~$5/mo waived)

**For Daemon:** This maps to the API broker model -- users can self-host with BYOK (free), or pay Daemon to handle everything (managed keys, routing, device mesh hosting).

#### Model C: Usage-Based (the AI-native model)

Charge per unit of consumption. Becoming the dominant AI pricing model in 2026.

- **Cursor**: $20/mo for 500 fast requests, $60/mo Pro+, $200/mo Ultra
- **Intercom Fin**: $0.99 per AI resolution
- Companies with usage-based see **40% higher gross margins** and **2.3x lower churn** than per-seat

**Key insight from Bessemer:** AI companies see 50-60% gross margins vs 80-90% for traditional SaaS. Usage-based pricing is the only way to align cost structure with revenue.

### What Doesn't Work

- **Pure donations/sponsorships**: Not a business model. Supplement at best.
- **Support-only**: Red Hat model requires massive enterprise sales team.
- **Per-seat for AI tools**: "Charging per-seat for an agent is like charging per-parking-space for a self-driving car fleet." AI agents don't log in.

### Recommendation for Daemon

**Hybrid: Open Core + Usage-Based + BYOK**

```
Free Tier (BYOK):       $0  -- bring your own API keys, self-host, full platform
Pro (Usage-Based):     $15/mo -- includes $10 in API credits, managed keys, auto-routing
Team:                  $30/user/mo -- shared workspaces, team memory, admin controls
Enterprise:            Custom -- SSO, audit logs, on-prem deployment, SLA
```

The BYOK tier is the growth engine. The Pro tier is the conversion target. Team/Enterprise is where the real money is long-term.

---

## 2. Pricing Psychology for Developer Tools

### Conversion Rate Benchmarks

| Metric | Rate |
|--------|------|
| Visitor to freemium signup | 13.3% |
| Freemium to paid (average SaaS) | 2-5% |
| Freemium to paid (top quartile) | 8-15% |
| Developer tools (estimated) | 3-6% |
| If below 2-3%, free tier is too generous | -- |

**Source:** First Page Sage 2026 SaaS Freemium Report (80+ SaaS clients, 2021-2025 data)

### The Competitive Price Landscape

| Product | Price | What You Get |
|---------|-------|--------------|
| GitHub Copilot Free | $0 | 2,000 completions/mo |
| GitHub Copilot Pro | $10/mo | Unlimited completions |
| Claude Code Pro | $20/mo | CLI agent access |
| Cursor Pro | $20/mo | 500 fast requests, IDE |
| Cursor Pro+ | $60/mo | More requests |
| Windsurf Pro | $20/mo | Quota-based IDE |
| Claude Max | $100/mo | Unlimited Claude usage |
| Cursor Ultra | $200/mo | Heavy usage tier |

**The $20/mo price point is the new standard for AI dev tools.** Cursor validated this at scale ($2B ARR, 1M+ paying customers).

### BYOK: Growth Engine, Not Revenue Killer

BYOK is increasingly standard. Key findings:
- **Up to 65% cost reduction** for users vs. bundled subscriptions
- Enterprises prefer BYOK because they have negotiated rates with providers
- Eliminates unpredictable API cost risk for the platform operator
- **The winning strategy is dual-offering**: BYOK for cost-conscious users + managed subscriptions for convenience seekers

**BYOK does NOT kill revenue if you monetize the platform layer:**
- Device mesh management
- Memory/context persistence
- Multi-model routing intelligence
- Team collaboration features
- Cost analytics and optimization dashboards

### What Price for Daemon?

**Recommendation: $15/mo Pro (not $10)**

Reasoning:
- $10/mo is below the psychological floor for "serious tool" -- it signals "side project"
- $15/mo positions between Copilot ($10) and Cursor/Claude ($20), signaling "better value"
- Include $10 in API credits so the effective platform fee is $5/mo -- extremely accessible
- **Charm pricing**: $14.99/mo or $149/year (annual saves ~17%)
- The "reverse trial" model works well: give full Pro access for 14 days, then downgrade to free. This beats traditional freemium by showing users what they lose.

### Pricing Psychology Tactics

1. **Center-stage positioning**: Show 3 tiers, make Pro the visual center
2. **Loss aversion**: After trial, show "you'll lose: device mesh, smart routing, memory sync"
3. **Annual discount**: $149/year vs $15/mo -- captures commitment, reduces churn
4. **Usage visibility**: Show users exactly how much they'd spend on API keys without Daemon's routing optimization

---

## 3. Distribution Channels

### Priority 1: Hacker News (Week 1)

HN is the single highest-leverage channel for developer tools. Open-source, privacy-first, self-hostable products massively overindex.

**Best practices:**
- **Title format**: "Show HN: Daemon -- open-source platform to run AI agents across all your devices"
- **Link to GitHub repo**, not landing page. README is the landing page for HN.
- **Post Monday morning PT** (highest engagement)
- **No marketing-speak.** Talk as a fellow builder. "I built this because Claude Code in a terminal was driving me crazy"
- **Engage with every comment.** Agree with critics first, then explain. You're convincing the audience, not the critic.
- **Do NOT email-wall** the GitHub repo (HN rules prohibit it)
- **Prepare for traffic**: ensure demo is stable, README is polished, GitHub has good first issues

**Target**: 200+ upvotes, front page for 6+ hours. Top Show HN posts get 10K-50K unique visitors.

### Priority 2: Reddit (Week 1-2)

Key subreddits ranked by relevance:

| Subreddit | Members | Why |
|-----------|---------|-----|
| r/LocalLLaMA | 658K+ | Core audience: people running local AI models. BYOK resonates hard here. |
| r/selfhosted | 400K+ | Self-hosting enthusiasts. Multi-device angle is compelling. |
| r/programming | 6M+ | General dev audience. Needs strong technical angle. |
| r/opensource | 100K+ | Open-source community. License choice matters here. |
| r/artificial | 500K+ | AI enthusiasts. Broader audience. |
| r/ChatGPT, r/ClaudeAI | Large | Users frustrated with single-device limitations. |

**Strategy**: Don't post the same thing everywhere. Tailor the pitch:
- r/LocalLLaMA: "Run Qwen/DeepSeek/Llama across all your devices with one UI"
- r/selfhosted: "Self-hosted AI agent that connects your phone, laptop, and server"
- r/programming: Technical deep-dive on the architecture

### Priority 3: GitHub Trending (Week 1-2)

**What it takes to trend:**
- ~500 stars in 24 hours for a reliable trending appearance
- Coordinate: HN post + Reddit + Twitter all in the same 24-48 hour window
- Morning PT hours on weekdays
- Traffic from at least 2 sources
- Strong README with clear value prop, install instructions, screenshots/GIFs
- Relevant topic tags on the repo

**Sustain momentum**: Don't just spike and fade. Regular releases, good changelogs, responsive to issues.

### Priority 4: Product Hunt (Week 2-3)

Still relevant in 2026, but requires preparation:
- Pre-launch momentum matters more than launch day
- Focus on conversion, not ranking -- have a 30-day post-launch plan
- Hunter reputation matters less than your narrative and assets
- Prepare: product video, clear screenshots, strong first comment
- Have a structured conversion funnel ready (GitHub -> install -> Pro trial)

### Priority 5: Twitter/X (Ongoing)

- Dev AI community is very active on X
- Thread format: "I quit my terminal and built this instead" with before/after
- Tag relevant accounts: AI tool reviewers, dev influencers
- Consistent posting: weekly dev updates, architecture decisions, user stories

### Priority 6: YouTube (Month 2-3)

Developer content creators who review AI coding tools drive significant adoption. Categories:
- "Cursor vs Claude Code vs Daemon" comparison videos
- Setup tutorials: "Connect your phone to your AI agent in 5 minutes"
- Architecture deep-dives for technical credibility

### Priority 7: Conferences (Month 3-6)

| Conference | When | Why |
|------------|------|-----|
| AI DevWorld | Feb 2026 (next: 2027) | 2,500 attendees, 250 speakers, developer-focused |
| AI Dev 26 | 2026 | Focus on AI coding agents specifically |
| AI DevSummit | 2026 | Premier AI engineering conference |
| Local meetups (Milan, European) | Ongoing | Lower barrier, face-to-face, build reputation |

**For a solo founder**: Start with lightning talks at local meetups and online conferences. Apply to speak at AI DevWorld 2027 once you have traction numbers.

### Priority 8: Discord/Slack Communities

Join existing communities first, contribute genuinely, then share when relevant:
- Anthropic Discord
- OpenRouter Discord
- Various AI coding communities
- Self-hosted communities

---

## 4. Competitive Positioning (April 2026)

### The Complete Competitor Map

#### Tier 1: Big Tech (massive resources, different focus)

| Competitor | Type | Price | Users | Status |
|------------|------|-------|-------|--------|
| **Cursor** | AI IDE (VS Code fork) | $20-200/mo | 1M+ paying, $2B ARR | Market leader. IDE-centric. No multi-device. |
| **Claude Code** | Terminal CLI | $20/mo (Pro) / $100/mo (Max) | Large | Anthropic's own. Terminal-only. 80.8% SWE-bench. |
| **Google Antigravity** | AI IDE (VS Code fork) | Free (preview) -> tiered | Growing fast | Multi-agent, free Opus access during preview. Massive threat. |
| **GitHub Copilot** | IDE extension | $0-19/mo | Millions | Ubiquitous but shallow. Autocomplete, not agent. |
| **Windsurf** | AI IDE | $20/mo | Large | Budget-friendly, agentic. Quota-based pricing. |

#### Tier 2: Open Source Competitors (direct competition)

| Competitor | Stars | License | What It Does | Gap vs Daemon |
|------------|-------|---------|--------------|---------------|
| **OpenCode** | 126K+ | MIT | Terminal-first AI coding | No web UI, no multi-device, no memory |
| **OpenHands** | 70K+ | MIT | Full agent platform | Heavy, complex. Not focused on multi-device. |
| **Bolt.diy** | 19K+ | MIT | Browser web app builder | Different use case (app generation, not agent workflow) |
| **Aider** | Large | Apache | CLI pair programming | Terminal-only, single-device, single-model |
| **Continue** | Large | Apache | VS Code extension | Extension, not platform. IDE-dependent. |
| **CloudCLI** | 9.3K | AGPL | Multi-agent web UI | No multi-device mesh, no memory |
| **Opcode** | 21.3K | AGPL | Desktop GUI wrapper | Single-device, no API broker |

#### Tier 3: Acquired/Absorbed

| Competitor | Status | Relevance |
|------------|--------|-----------|
| **OpenClaw** | Acquired by OpenAI (Feb 2026, reportedly ~$5B) | Proved the "vibe coder agent" market is real. Moving to foundation model. OpenAI will integrate into ChatGPT. |

### The Gap Daemon Fills

**No existing tool combines all four:**
1. **Multi-device mesh** (phone + laptop + server + watch as one computer)
2. **Persistent memory** (project, global, session memory across devices)
3. **Model-agnostic routing** (free Qwen -> DeepSeek -> Claude Opus, auto-routed)
4. **BYOK + managed** (bring your own keys OR let us handle everything)

Cursor is an IDE. Claude Code is a terminal. Antigravity is an IDE. OpenCode is a terminal. None of them think about your phone, your server, or your watch. None of them let you bring your own keys AND offer managed routing.

### Positioning Statement

> **Daemon is the open-source platform that connects all your devices to one AI agent -- with the memory, stability, and model flexibility that IDE-locked tools can't offer.**

### Competitive Risks

1. **Google Antigravity** is the biggest threat. Free, multi-agent, backed by Google. But: it's an IDE, not a multi-device platform. It doesn't do phone/watch/server mesh.
2. **Anthropic could build multi-device Claude Code.** Mitigate by being model-agnostic.
3. **OpenAI + OpenClaw** will likely become the dominant agent platform for ChatGPT users. Daemon's angle: open-source, self-hostable, model-agnostic.
4. **Cursor at $2B ARR** has resources to add features fast. But they're IDE-locked.

### Daemon's Defensible Advantages

- **Open source**: Users can self-host, fork, inspect. Trust advantage over proprietary tools.
- **Multi-device mesh**: Genuinely novel. Nobody else connects phone + laptop + server + watch.
- **Model agnostic**: Not locked to one provider. Smart routing across tiers.
- **BYOK**: Zero lock-in. Users keep their own keys and relationships with providers.
- **Solo founder speed**: No committee decisions. Ship daily. Iterate on user feedback instantly.

---

## 5. Legal Structure & Licensing

### License Choice

| License | Pros | Cons | Who Uses It |
|---------|------|------|-------------|
| **MIT** | Maximum adoption, zero friction | Zero protection. Anyone can fork and compete (including big tech) | OpenCode, OpenHands, PostHog (core) |
| **Apache 2.0** | Good adoption + patent protection | Same fork risk as MIT | Supabase, TensorFlow, PyTorch |
| **AGPLv3** | Forces competitors to open-source modifications. Strong copyleft protection for SaaS | Scares some enterprises. Reduces adoption ~10-20% | Cal.com, CloudCLI, Opcode, MongoDB (pre-SSPL) |
| **BSL (Business Source License)** | Source-available, prevents competing hosted services. Converts to open source after 2-4 years | Not truly "open source." Community pushback. | Sentry, MariaDB, HashiCorp |

**Trend in 2026:** Permissive licenses dropped from 82% (2022) to 73% (2025). AGPL is making a comeback among commercial open-source companies. 4 of the top 10 highest-valued open-source companies use copyleft (GPL/AGPL/CPAL).

**Recommendation for Daemon: AGPLv3 + Commercial License (/ee folder)**

Why:
- AGPLv3 forces anyone hosting Daemon as a service to open-source their modifications
- Prevents AWS/Google/Azure from offering "Managed Daemon" without contributing back
- Cal.com proved this model works: 99% open under AGPL, 1% enterprise features under commercial license
- Enterprise features (SSO, audit logs, team admin, SLA) go in `/ee` with commercial license
- BYOK/self-hosters get the full platform for free (drives adoption)
- Enterprises who want managed + premium features pay

**The Cal.com playbook:**
- All "singleplayer" features: AGPLv3 (free for individuals)
- All "multiplayer" features: commercial license (teams pay)

### Company Structure

**Phase 1 (Now): Italian Partita IVA**
- Already in place. Fine for initial revenue and EU grants.
- Simple, low overhead.

**Phase 2 (When raising from US investors): Delaware C-Corp**
- The standard for VC-backed startups. Investors require it.
- Use **Stripe Atlas** ($500) for formation -- handles registered agent, EIN, bank account.
- Keeps Italian tax residency via PE (permanent establishment).
- QSBS qualification: up to $10M federal capital gains tax exclusion if stock held 5+ years.

**Phase 3 (If targeting UK grants/EIS): UK Ltd subsidiary**
- CIC (Community Interest Company) for Call Partners (non-profit angle)
- Ltd for Daemon UK subsidiary if pursuing SEIS/EIS investment (~$250K tax relief for angel investors)
- "Delaware flip" from UK Ltd is well-documented -- investors can keep EIS relief with HMRC pre-clearance

**Recommendation**: Stay on Partita IVA until you have traction (1K+ users, any revenue). Then Delaware C-Corp via Stripe Atlas when pursuing US investors or crossing $10K MRR.

---

## 6. Fundraising Landscape

### Are VCs Still Funding AI Agent Startups? Yes, Aggressively.

- **Q1 2026**: $178B raised across 24 foundational AI deals (2x all of 2025)
- **AI agents market**: $7.84B in 2025, projected $52.62B by 2030 (41% CAGR)
- **OpenClaw acquisition** (~$5B) proved solo-founder AI agent projects can reach massive outcomes
- **LangChain**: $125M at $1.25B valuation (Oct 2025)
- **Cursor**: $2B ARR, reportedly valued at $10B+

### What Metrics Do Investors Want?

**Pre-seed (what you need):**
- Working prototype (you have this)
- Technical depth and defensible angle (multi-device mesh is novel)
- Early users/stars (target: 1K+ GitHub stars, 100+ active users)
- Vision clarity (one sentence: "AI agent across all your devices")
- Investors forgive missing revenue if expertise and vision are strong

**Seed ($1-3M):**
- 500+ active users
- Some revenue signal (even $1K MRR)
- Community traction (Discord, contributors, GitHub activity)
- Clear path to $1M ARR

**Series A ($5-15M):**
- $1M+ ARR or strong growth rate (10%+ MoM)
- Net revenue retention >100%
- Enterprise customers or clear enterprise path

### Pre-Seed: What Can a Solo Founder Raise?

- AI infrastructure investors typically invest **$500K-$8M** at pre-seed through Series A
- For a solo founder with a working product: **$500K-$1.5M pre-seed** is realistic
- Key investors for AI pre-seed: Y Combinator, a16z SPEEDRUN, Sequoia Arc, Initialized Capital

### Grants (Non-Dilutive Funding)

| Grant | Amount | Fit for Daemon | Status |
|-------|--------|----------------|--------|
| **Mozilla Foundation Incubator** | $50K base, up to $300K | Medium -- "Democracy x AI" focus. Daemon's open-source angle could fit civic tech narrative. | Applications closed March 16, 2026. Watch for next cohort. |
| **EU GenAI4EU** | Part of ~$700M across Horizon Europe + Digital Europe | High -- supports open-source AI startups in EU. Generative AI is a focus area for 2026-2027. | Rolling calls via Funding & Tenders Portal |
| **EIC Challenges 2026** | Varies | Medium -- "Generative AI" is one of 5 focus areas | Check EC portal for deadlines |
| **Italy CDP Venture Capital** | Varies | High -- Italy's national innovation fund, supports digital transition | Agreements must be signed by June 30, 2026 |
| **Italy Domani (PNRR)** | Part of $400M digital transition | High -- Italian startup, digital innovation | Active through 2026 |

### Alternative Financing

| Option | Pros | Cons | Recommendation |
|--------|------|------|----------------|
| **Bootstrapping** | Full control, no dilution. Building has never been cheaper (AI tools, cloud free tiers) | Slow. Hard for infra companies that need scale. | Do this first. Prove the model. |
| **Revenue-based financing** (Pipe, Clearco) | Non-dilutive, based on recurring revenue | Need existing revenue ($5K+ MRR typically). Not available pre-revenue. | After hitting $5K MRR |
| **Angel investors** | Fast, flexible, small checks ($25K-$100K) | Time-consuming to manage many small investors | Good for $100K-$300K bridge |
| **Y Combinator** | $500K + network + brand. Best launchpad for dev tools. | Competitive. Must relocate to SF for 3 months. | Apply when you have GitHub traction |

### Recommended Fundraising Path

1. **Now (April 2026)**: Bootstrap. Ship the product. Get users.
2. **Q3 2026**: Apply to EU grants (GenAI4EU, Italy CDP). Non-dilutive.
3. **Q4 2026**: If traction (1K+ stars, 100+ users), pursue angel round ($200K-$500K)
4. **Q1 2027**: Apply to YC S27 batch with traction numbers
5. **Q2 2027**: Pre-seed ($1M-$2M) from AI-focused VCs

---

## 7. Community Building

### Platform Choice: Discord + GitHub Discussions

**Discord** for real-time community:
- Standard for open-source dev tool communities
- Screen sharing for debugging
- Channels: #general, #support, #feature-requests, #show-your-setup, #contributing
- Target: 100 members in month 1, 500 by month 3, 1,000 by month 6
- Discord's open-source directory requires 1K members OR 1K GitHub stars

**GitHub Discussions** for async, documented collaboration:
- Feature proposals, architecture decisions, RFCs
- Searchable (unlike Discord)
- Integrated with the repo (issues, PRs, code)

**Don't use Discourse/Slack**: Discourse is heavy to manage solo. Slack kills discoverability.

### Getting Contributors

1. **Good first issues**: Label 10+ issues as "good first issue" with clear descriptions
2. **CONTRIBUTING.md**: Step-by-step setup guide, coding standards, PR process
3. **Architecture docs**: Help people understand the codebase before diving in
4. **Respond to every PR within 24 hours**: Speed of response is the #1 factor in contributor retention
5. **Public roadmap**: Let contributors see what's planned and claim items
6. **Credit contributors**: Shout-outs in changelogs, contributor wall in README

### Developer Evangelism in 2026

What works:
- **Building in public**: Tweet/post about decisions, tradeoffs, architecture choices
- **Comparison content**: "Daemon vs Cursor vs Claude Code" -- honest, factual comparisons
- **Tutorial content**: "How to connect your phone to your AI agent" step-by-step
- **Problem-first content**: "Why I stopped using terminal AI and built a multi-device platform"
- **Release notes as content**: Every release is a blog post opportunity

What doesn't work:
- Corporate blog posts nobody reads
- Paid influencer campaigns (dev community sees through them)
- Spamming communities with self-promotion

### Content Marketing Calendar (First 3 Months)

| Week | Content | Channel |
|------|---------|---------|
| 1 | Launch post: "Show HN: Daemon" | HN, Reddit, Twitter |
| 2 | "Why multi-device AI agents matter" | Blog, Twitter thread |
| 3 | Setup tutorial + video | YouTube, blog |
| 4 | "Daemon vs Cursor vs Claude Code" comparison | Blog, Reddit |
| 5-6 | User stories / case studies | Blog, Twitter |
| 7-8 | Architecture deep-dive | Blog, HN |
| 9-10 | "Running AI agents on your phone" | Reddit (r/selfhosted, r/LocalLLaMA) |
| 11-12 | Monthly metrics transparency report | Blog, Twitter |

### Preventing Hostile Forks

- **AGPLv3 license**: Anyone who forks and hosts must open-source their modifications
- **Trademark protection**: Register "Daemon" trademark for software
- **Community trust**: Be transparent, responsive, fair. Forks happen when maintainers stop listening.
- **Ship faster than anyone can fork**: Solo founder advantage -- no committee, no politics
- **Data moat**: Memory/context data stays with the user's instance, but the platform intelligence (routing optimization, cost analytics) improves with scale

---

## 8. Daemon-Specific Recommendations

### Summary: The Daemon Playbook

#### Business Model (Final Recommendation)

```
BYOK (Free):          $0/mo -- Full platform, bring your own API keys
                      -- Self-host or use daemon.page
                      -- Growth engine. Convert to Pro via reverse trial.

Pro:                  $15/mo ($149/year)
                      -- $10 in API credits included
                      -- Managed API keys, smart multi-model routing
                      -- Device mesh hosting (up to 5 devices)
                      -- Priority support in Discord

Team:                 $30/user/mo
                      -- Shared workspaces, team memory
                      -- Admin controls, usage analytics
                      -- 10+ devices per team

Enterprise:           Custom pricing
                      -- SSO, audit logs, SLA
                      -- On-prem deployment support
                      -- Custom model routing rules
                      -- Dedicated support
```

#### License

**AGPLv3** for core platform + **/ee commercial license** for enterprise features (SSO, audit, team admin).

#### Company Structure

Stay on Italian Partita IVA now. Delaware C-Corp via Stripe Atlas when pursuing US investment or crossing $10K MRR.

#### Fundraising Path

Bootstrap -> EU grants (Q3 2026) -> Angels ($200-500K, Q4 2026) -> YC application (Q1 2027) -> Pre-seed ($1-2M, Q2 2027)

#### Launch Sequence

| Week | Action | Target |
|------|--------|--------|
| **Pre-launch** | Polish README, GIFs, install docs. Set up Discord. Label good-first-issues. | Ready for traffic |
| **Week 1 (Monday AM PT)** | Show HN + Reddit (r/selfhosted, r/LocalLLaMA) + Twitter thread | 500+ GitHub stars, 100+ Discord members |
| **Week 2** | Product Hunt launch. YouTube setup tutorial. | 1K+ stars, PH top 5 |
| **Week 3-4** | Comparison blog posts. Engage with all community feedback. | First 10 Pro subscribers |
| **Month 2** | Regular release cadence. Content marketing. Conference CFPs. | 50+ Pro subscribers, 2K+ stars |
| **Month 3** | Apply to EU grants. Start angel investor outreach. | $1K+ MRR |
| **Month 6** | YC application with metrics. Team features launch. | $5K+ MRR, 5K+ stars |

#### The One Thing That Matters Most

**Stability.** In a market full of flashy, buggy AI tools, the one that just works wins. Cursor's $2B ARR wasn't built on features alone -- it was built on reliability. Daemon's positioning as "the stable, boring, it-just-works multi-device AI agent platform" is the wedge.

Don't add features. Make the existing features unbreakable. Then add features.

### Key Metrics to Track

| Metric | Target (Month 1) | Target (Month 6) | Why |
|--------|-------------------|-------------------|-----|
| GitHub stars | 1,000 | 5,000 | Social proof, trending potential |
| Discord members | 100 | 500 | Community health |
| Weekly active users | 50 | 500 | Product-market fit signal |
| Free-to-Pro conversion | 3% | 5% | Revenue model validation |
| MRR | $500 | $5,000 | Business viability |
| Contributors | 5 | 20 | Community sustainability |
| NPS | 40+ | 50+ | User satisfaction |

---

## Sources

### Open-Source Business Models
- [PostHog: How we monetized our open source devtool](https://posthog.com/blog/open-source-business-models)
- [Supabase $5B Valuation](https://techcrunch.com/2025/10/03/supabase-nabs-5b-valuation-four-months-after-hitting-2b/)
- [PostHog Revenue & Valuation (Sacra)](https://sacra.com/c/posthog/)
- [Supabase Revenue & Valuation (Sacra)](https://sacra.com/c/supabase/)
- [PostHog: Lessons from a Billion Dollar Open Source Company](https://medium.com/posthog/lessons-from-a-billion-dollar-open-source-company-f9489a840bbb)
- [PostHog Unconventional Growth](https://www.plg.news/p/posthog-unconventional-growth)

### Pricing Psychology
- [SaaS Freemium Conversion Rates: 2026 Report](https://firstpagesage.com/seo-blog/saas-freemium-conversion-rates/)
- [How to Price AI Products: Complete Guide (2026)](https://www.news.aakashg.com/p/how-to-price-ai-products)
- [Bessemer: The AI Pricing and Monetization Playbook](https://www.bvp.com/atlas/the-ai-pricing-and-monetization-playbook)
- [Why AI Companies Adopted Usage-Based Pricing](https://flexprice.io/blog/why-ai-companies-have-adopted-usage-based-pricing)
- [AI Coding Tools Pricing Comparison 2026](https://www.nxcode.io/resources/news/ai-coding-tools-pricing-comparison-2026)
- [Why BYOK Is the Strategic Choice for AI in 2026](https://geekflare.com/guides/byok-ai-business-strategy/)
- [Software Pricing Playbook 2026](https://www.goldendoorasset.com/software/pricing)

### Competitive Landscape
- [Cursor $2B ARR (TechCrunch)](https://techcrunch.com/2026/03/02/cursor-has-reportedly-surpassed-2b-in-annualized-revenue/)
- [Cursor AI Statistics 2026](https://www.getpanto.ai/blog/cursor-ai-statistics)
- [Cursor vs Windsurf vs Claude Code 2026](https://dev.to/pockit_tools/cursor-vs-windsurf-vs-claude-code-in-2026-the-honest-comparison-after-using-all-three-3gof)
- [Google Antigravity Review 2026](https://vibecoding.app/blog/google-antigravity-review)
- [Google Antigravity: Agent-First IDE](https://www.heyuan110.com/posts/ai/2026-03-10-google-antigravity-review/)
- [OpenAI Acquires OpenClaw (VentureBeat)](https://venturebeat.com/technology/openais-acquisition-of-openclaw-signals-the-beginning-of-the-end-of-the)
- [Top AI Agent Frameworks 2026](https://www.firecrawl.dev/blog/best-open-source-agent-frameworks)
- [AI Dev Tool Power Rankings (LogRocket)](https://blog.logrocket.com/ai-dev-tool-power-rankings/)

### Distribution
- [How to Launch a Dev Tool on Hacker News](https://www.markepear.dev/blog/dev-tool-hacker-news-launch)
- [How to Crush Your HN Launch](https://dev.to/dfarrell/how-to-crush-your-hacker-news-launch-10jk)
- [Product Hunt Launch Strategy 2026](https://hackmamba.io/developer-marketing/how-to-launch-on-product-hunt/)
- [Product Hunt Launch Guide 2026 (Purshology)](https://www.purshology.com/2026/04/how-to-launch-on-product-hunt-successfully-in-2026-a-founders-playbook/)
- [How to Get GitHub Stars: 33K Stars Case Study](https://dev.to/iris1031/how-to-get-more-github-stars-the-definitive-guide-33k-stars-case-study-11h8)
- [How to Trend on GitHub](https://medium.com/@manoj.radhakrishnan/how-to-trend-on-github-dcdda9055f8)

### Legal & Licensing
- [Open Source Licenses 2026 Guide](https://dev.to/juanisidoro/open-source-licenses-which-one-should-you-pick-mit-gpl-apache-agpl-and-more-2026-guide-p90)
- [State of Open Source Licensing 2026 (RedMonk)](https://redmonk.com/sogrady/2026/03/25/open-source-licensing-2026/)
- [Founders Guide to Open Source Licenses](https://blog.scalingdevtools.com/founders-guide-to-open-source-licenses/)
- [Cal.com GitHub (AGPLv3 model)](https://github.com/calcom/cal.com)
- [Delaware C-Corp Formation Guide 2026](https://www.njbusiness-attorney.com/delaware-c-corp-formation-guide-2026-the-complete-startup-playbook/)
- [Stripe Atlas](https://stripe.com/atlas)
- [Delaware Flip (SeedLegals)](https://seedlegals.com/grow/delaware-flip/)

### Fundraising
- [AI Startup Funding Trends 2026](https://qubit.capital/blog/ai-startup-fundraising-trends)
- [Top AI Agent Startups 2026 (Funding & Valuation)](https://aifundingtracker.com/top-ai-agent-startups/)
- [Foundational AI Funding Doubled in Q1 2026 (Crunchbase)](https://news.crunchbase.com/venture/foundational-ai-startup-funding-doubled-openai-anthropic-xai-q1-2026/)
- [OpenAI 2026 Acquisitions (Crunchbase)](https://news.crunchbase.com/ma/data-openai-2023-2026-acquisitions-open-source-astral-promptfoo/)
- [Top Pre-Seed AI Investors (NFX)](https://signal.nfx.com/investor-lists/top-ai-pre-seed-investors)
- [Best US Pre-Seed Investors for AI Startups (Redbud VC)](https://redbud.vc/latest/best-us-pre-seed-investors-for-ai-startups)

### Grants
- [Mozilla Democracy x AI Cohort 2026](https://www.mozillafoundation.org/en/what-we-do/grantmaking/incubator/democracy-ai-cohort/)
- [GenAI4EU Funding](https://digital-strategy.ec.europa.eu/en/policies/genai4eu)
- [EU Grants for Startups 2026](https://www.grantsfinder.eu/blog/eu-grants-for-startups-2026)
- [EU Grants for AI Startups 2025](https://pitchbob.io/blog/eu-grants-for-ai-startups-whats-available-in-2025)

### Community
- [Four Steps Toward Building an Open Source Community (GitHub Blog)](https://github.blog/open-source/maintainers/four-steps-toward-building-an-open-source-community/)
- [PostHog Marketing Engine](https://theplaybookbysuzanna.substack.com/p/how-posthog-built-a-marketing-engine)
- [Bootstrapping vs VC Funding 2026](https://foundersdailyg.com/finance/bootstrapped-vs-funded-2026-startup-economics)
- [Railway $100M Funding (VentureBeat)](https://venturebeat.com/infrastructure/railway-secures-usd100-million-to-challenge-aws-with-ai-native-cloud)
