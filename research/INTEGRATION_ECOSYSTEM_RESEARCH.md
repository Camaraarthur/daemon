# Daemon Integration Ecosystem Research
*2026-04-02 — Deep research for MVP planning*

---

## Executive Summary

The daemon needs to connect to users' digital lives. This document maps every major integration ecosystem, ranking by **user value**, **implementation effort**, and **MVP priority**. The key insight from user research: people want agents that **act, not advise** — the integrations that let the daemon take action (send email, create event, play music) are worth 10x more than read-only ones.

**MVP sweet spot**: Gmail + Google Calendar + Telegram + Spotify + Home Assistant + GitHub. These six cover the highest-value daily workflows with the least auth friction, all have MCP servers or simple REST APIs, and most are free-tier friendly.

---

## 1. COMMUNICATION

### 1.1 Email — Gmail
| Aspect | Detail |
|--------|--------|
| **Integration method** | Gmail API (REST) or existing MCP server |
| **Auth** | OAuth 2.0 with refresh tokens (tokens expire hourly, must handle refresh) |
| **Read** | Full inbox, threads, labels, attachments, search |
| **Write** | Send, draft, reply, forward, manage labels, delete |
| **Rate limits** | 250 quota units/second per user; sending limit 500/day (consumer), 2000/day (Workspace) |
| **Cost** | Free (Google Cloud project required, no billing needed for personal use) |
| **MCP servers** | Gmail MCP Server (GongRzhe/Gmail-MCP-Server), Composio Gmail toolkit, Claude AI native Gmail MCP |
| **Privacy** | OAuth scope consent screen; Google requires app verification for sensitive scopes; user data stays between Google and daemon |
| **MVP priority** | **HIGH** — Email is the #2 time sink. Triage, draft replies, extract action items. |

### 1.2 Email — Outlook/Microsoft 365
| Aspect | Detail |
|--------|--------|
| **Integration method** | Microsoft Graph API |
| **Auth** | OAuth 2.0 via Azure AD / Microsoft Entra |
| **Read/Write** | Full email, calendar, contacts, OneDrive, Teams |
| **Rate limits** | 10,000 requests per 10 minutes per app per mailbox |
| **Cost** | Free tier available; Azure AD app registration required |
| **MCP servers** | Community MCP servers exist; Composio has Microsoft 365 toolkit |
| **MVP priority** | **MEDIUM** — Important for enterprise users, but Gmail covers most personal users first. |

### 1.3 Messaging — Telegram
| Aspect | Detail |
|--------|--------|
| **Integration method** | Telegram Bot API (REST + webhooks) |
| **Auth** | Bot token from @BotFather — simplest auth of any platform |
| **Read** | Messages, media, user info, group membership |
| **Write** | Send messages, media, stickers, inline keyboards, polls, locations |
| **Rate limits** | 30 messages/second to different chats; 1 message/second per chat; 20 messages/minute in groups |
| **Cost** | Completely free, no API key costs |
| **MCP servers** | Multiple available; Composio Telegram toolkit |
| **Privacy** | Bot can only see messages sent to it or in groups where it's a member; no access to other users' chats |
| **MVP priority** | **HIGH** — Zero cost, trivial auth, rich media support, Arthur already has bot tokens. Perfect daemon messaging channel. |

### 1.4 Messaging — WhatsApp
| Aspect | Detail |
|--------|--------|
| **Integration method** | WhatsApp Business API (Cloud API via Meta) |
| **Auth** | Meta Business account + app review + phone number verification |
| **Read** | Incoming messages, media, read receipts |
| **Write** | Reply within 24h window (free), template messages (paid), media |
| **Rate limits** | 80 messages/second; daily business-initiated limits based on tier (1K-100K) |
| **Cost** | Service messages free in 24h window; marketing messages $0.01-0.13 each depending on country |
| **Restrictions** | Since Jan 2026: general-purpose AI chatbots BANNED; only task-specific agents with defined purposes allowed |
| **MCP servers** | Limited; mostly through Composio or custom integration |
| **MVP priority** | **LOW for MVP** — Complex approval process, per-message costs, Meta's AI restrictions make this harder. Add post-launch. |

### 1.5 Messaging — Signal
| Aspect | Detail |
|--------|--------|
| **Integration method** | signal-cli wrapper + Signal REST API (self-hosted) |
| **Auth** | Requires spare phone number registered with Signal |
| **Read/Write** | Full messaging including groups, media, reactions |
| **Rate limits** | Self-hosted, so effectively unlimited |
| **Cost** | Free (self-hosted), but requires always-running server |
| **MCP servers** | None official; Home Assistant has a Signal Messenger integration |
| **Privacy** | E2E encrypted; self-hosted relay is the most private messaging option |
| **MVP priority** | **LOW** — Niche audience, requires spare phone number. Privacy-conscious users would love it though. |

### 1.6 Messaging — Slack
| Aspect | Detail |
|--------|--------|
| **Integration method** | Slack API (Web API + Events API + Socket Mode) |
| **Auth** | OAuth 2.0 with granular scopes (bot vs user tokens) |
| **Read** | Channels, messages, threads, files, users, reactions |
| **Write** | Post messages, create channels, upload files, set reminders, manage workflows |
| **Rate limits** | 4 tiers (Tier 1: 1 req/min to Tier 4: 100+ req/min per method); bot users free |
| **Cost** | Free to build; Slack workspace may need paid plan for full features |
| **MCP servers** | Official Slack MCP server available; Composio toolkit |
| **MVP priority** | **MEDIUM** — Critical for work context. Daemon reading Slack = knowing what's happening at work. |

### 1.7 Messaging — Discord
| Aspect | Detail |
|--------|--------|
| **Integration method** | Discord Bot API + Gateway (WebSocket) |
| **Auth** | Bot token from Discord Developer Portal |
| **Read** | Messages, reactions, voice states, server/channel info |
| **Write** | Send messages, embeds, manage channels, voice (limited), slash commands |
| **Rate limits** | 50 requests/second globally; per-route limits vary |
| **Cost** | Free |
| **MCP servers** | Community MCP servers exist; Composio Discord toolkit |
| **MVP priority** | **MEDIUM** — Good for community-oriented daemon users. |

### 1.8 Messaging — iMessage
| Aspect | Detail |
|--------|--------|
| **Integration method** | BlueBubbles (macOS bridge) or mautrix-imessage bridge |
| **Auth** | Requires a Mac signed into iMessage running the bridge |
| **Read/Write** | Full messaging including groups, reactions, tapbacks |
| **Restrictions** | Apple may terminate unofficial API access (June 2026 deadline mentioned). Requires dedicated Mac. |
| **Cost** | Free software, but requires Mac hardware |
| **MVP priority** | **VERY LOW** — Too fragile, Apple-hostile. Not worth the risk for MVP. |

### 1.9 Video Calls — Zoom / Google Meet / Teams
| Aspect | Detail |
|--------|--------|
| **Integration method** | Zoom API, Google Calendar API (for Meet), MS Graph (for Teams); or use Nylas Notetaker API / MeetGeek API for cross-platform bot |
| **Auth** | OAuth 2.0 for each platform |
| **Read** | Meeting schedules, recordings, transcripts (post-meeting), participants |
| **Write** | Schedule/cancel meetings, send invites; joining meetings requires bot SDKs (MeetGeek, Nylas) |
| **Rate limits** | Zoom: varies by plan; Google Meet: through Calendar API limits |
| **Cost** | Zoom free tier exists; Nylas Notetaker API is paid; MeetGeek has free tier |
| **MVP priority** | **LOW** — Scheduling is easy (via Calendar API). Joining/transcribing meetings is complex. Defer transcription to post-MVP. |

---

## 2. PRODUCTIVITY

### 2.1 Calendar — Google Calendar
| Aspect | Detail |
|--------|--------|
| **Integration method** | Google Calendar API (REST) or MCP server |
| **Auth** | OAuth 2.0 (same Google auth flow as Gmail — get both at once) |
| **Read** | Events, availability, attendees, recurring events |
| **Write** | Create/update/delete events, manage calendars, set reminders |
| **Rate limits** | 1,000,000 queries/day (project); 500 events created per calendar/day |
| **Cost** | Free |
| **MCP servers** | Google Calendar MCP Server available; Claude AI native Calendar MCP; Composio toolkit |
| **MVP priority** | **HIGH** — Calendar awareness is fundamental. "What's my day look like?" is the killer daily query. Get this with Gmail in the same OAuth flow. |

### 2.2 Notes — Notion
| Aspect | Detail |
|--------|--------|
| **Integration method** | Notion API (REST) or official Notion MCP server |
| **Auth** | OAuth 2.0 or internal integration token |
| **Read** | Pages, databases, blocks, comments, users |
| **Write** | Create/update pages, append blocks, manage databases, create comments |
| **Rate limits** | 3 requests/second per integration |
| **Cost** | Free (Notion API is free regardless of Notion plan) |
| **MCP servers** | Official Notion MCP server (developers.notion.com/docs/mcp); multiple community servers |
| **MVP priority** | **MEDIUM** — Popular with power users. The official MCP server makes integration trivial. |

### 2.3 Notes — Obsidian
| Aspect | Detail |
|--------|--------|
| **Integration method** | Obsidian Local REST API plugin + MCP server |
| **Auth** | API key from Obsidian plugin (local only) |
| **Read** | Notes, tags, frontmatter, file tree, search |
| **Write** | Create/update notes, manage tags, append content |
| **Rate limits** | Local — unlimited |
| **Cost** | Free |
| **MCP servers** | obsidian-mcp-server (cyanheads), MCPVault (bitbonsai), obsidian-api-mcp-server — all mature |
| **Privacy** | Fully local, no cloud. Perfect for privacy-conscious users. |
| **MVP priority** | **MEDIUM** — Very popular with the developer/power user target audience. Fully local = great privacy story. |

### 2.4 Tasks — Todoist
| Aspect | Detail |
|--------|--------|
| **Integration method** | Todoist REST API v2 or MCP server |
| **Auth** | OAuth 2.0 or personal API token |
| **Read** | Tasks, projects, labels, comments, activity log |
| **Write** | Create/update/complete/delete tasks, manage projects |
| **Rate limits** | 450 requests per 15 minutes |
| **Cost** | Free API access |
| **MCP servers** | todoist-mcp-server-extended available |
| **MVP priority** | **MEDIUM** — Task management is high value but many users use different tools. |

### 2.5 Documents — Google Docs / Drive
| Aspect | Detail |
|--------|--------|
| **Integration method** | Google Docs API + Google Drive API |
| **Auth** | OAuth 2.0 (same flow as Gmail/Calendar) |
| **Read** | Document content, comments, revision history, file metadata |
| **Write** | Create/edit documents, manage sharing, upload files |
| **Rate limits** | Drive: 12,000 queries per 100 seconds; Docs: 600 requests per 60 seconds per project |
| **Cost** | Free |
| **MCP servers** | Google Drive MCP available; Composio Google Drive toolkit |
| **MVP priority** | **MEDIUM** — Get for free when you do the Google OAuth flow for Gmail+Calendar. |

---

## 3. SOCIAL MEDIA

### 3.1 Twitter/X
| Aspect | Detail |
|--------|--------|
| **Integration method** | X API v2 (REST + streaming) |
| **Auth** | OAuth 2.0 PKCE for user actions; API key for app-only |
| **Read** | Tweets, timelines, search, followers, lists (paid tiers only for substantive read access) |
| **Write** | Post, reply, retweet, like, DM; AI reply bots require explicit approval from X |
| **Rate limits** | Free: ~500 posts/month, minimal reads. Basic ($200/mo): 10K tweets. Pro ($5K/mo): 1M tweets |
| **Cost** | Pay-per-use model as of Feb 2026. Light usage (~500 posts + 10K reads) ~$100/mo |
| **MCP servers** | Community X/Twitter MCP servers; Composio Twitter toolkit |
| **MVP priority** | **LOW** — Expensive for read access, X requires approval for AI bots. Arthur has API keys but the cost/value ratio is poor for MVP. |

### 3.2 LinkedIn
| Aspect | Detail |
|--------|--------|
| **Integration method** | LinkedIn Marketing API / Community Management API |
| **Auth** | OAuth 2.0; requires LinkedIn Partner approval (weeks to months) |
| **Read** | Limited to own profile data; company page analytics |
| **Write** | Company page posts only; **personal profile automated posting is explicitly prohibited** |
| **Restrictions** | No sales automation, no profile scraping, no automated messaging, no automated personal posting |
| **Cost** | Free API, but approval is the bottleneck |
| **MVP priority** | **VERY LOW** — LinkedIn actively fights automation. The API doesn't support what users want (personal posting). |

### 3.3 Instagram
| Aspect | Detail |
|--------|--------|
| **Integration method** | Instagram Graph API (via Meta) |
| **Auth** | Meta app review (2-8 weeks, frequent rejection); Business/Creator account required |
| **Read** | Own account metrics (likes, reach); cannot read other users' content via API |
| **Write** | Publish photos/stories/carousels to own account; reply to comments |
| **Rate limits** | 200 API calls per hour per user |
| **Cost** | Free |
| **MVP priority** | **VERY LOW** — Painful approval, Business account required, limited capabilities. |

### 3.4 YouTube
| Aspect | Detail |
|--------|--------|
| **Integration method** | YouTube Data API v3 |
| **Auth** | OAuth 2.0 via Google (same flow as Gmail) |
| **Read** | Videos, channels, playlists, comments, search, subscriptions, watch history (limited) |
| **Write** | Upload videos, manage playlists, post comments, update video metadata |
| **Rate limits** | 10,000 quota units/day (search = 100 units; upload = 1600 units) |
| **Cost** | Free within quota |
| **MCP servers** | YouTube MCP servers available; Composio YouTube toolkit |
| **MVP priority** | **LOW** — Useful but not daily-driver for most users. |

### 3.5 Reddit
| Aspect | Detail |
|--------|--------|
| **Integration method** | Reddit API (REST + OAuth) |
| **Auth** | OAuth 2.0 |
| **Read** | Posts, comments, subreddits, user profiles, search |
| **Write** | Post, comment, vote, manage subreddits |
| **Rate limits** | 100 requests/minute with OAuth |
| **Cost** | Free for non-commercial use; commercial requires approval |
| **MVP priority** | **LOW** |

---

## 4. MUSIC & MEDIA

### 4.1 Spotify
| Aspect | Detail |
|--------|--------|
| **Integration method** | Spotify Web API (REST) + MCP server |
| **Auth** | OAuth 2.0 PKCE |
| **Read** | Listening history, top tracks/artists, playlists, currently playing, library, search |
| **Write** | Control playback (play, pause, skip, seek, volume, device transfer), create/edit playlists, save to library, manage queue |
| **Rate limits** | Dynamic rate limiting; roughly 180 requests/minute for most endpoints |
| **Cost** | Free API (user needs Spotify Premium for playback control) |
| **MCP servers** | Spotify MCP Server (well-maintained, built on Spotipy); Composio Spotify toolkit |
| **Privacy** | Only accesses data the user explicitly authorizes |
| **MVP priority** | **HIGH** — Music control is visceral and delightful. "Play something for focus" is the kind of daemon interaction that makes people smile. Low effort, high wow factor. Existing MCP server makes this near-trivial. |

### 4.2 Apple Music
| Aspect | Detail |
|--------|--------|
| **Integration method** | MusicKit / Apple Music API |
| **Auth** | Apple Developer token + user authorization; requires Apple Developer Program ($99/year) |
| **Read** | Library, playlists, recently played, recommendations |
| **Write** | Create playlists, add to library; **no playback control via API** |
| **Cost** | $99/year Apple Developer Program |
| **MVP priority** | **VERY LOW** — No playback control kills the main use case. Spotify covers this. |

### 4.3 Photos — Immich (self-hosted)
| Aspect | Detail |
|--------|--------|
| **Integration method** | Immich REST API (OpenAPI spec) |
| **Auth** | API key |
| **Read** | Photos, albums, search (including AI-powered semantic search), faces, metadata |
| **Write** | Upload, organize albums, manage tags |
| **Rate limits** | Self-hosted — unlimited |
| **Cost** | Free (self-hosted) |
| **Privacy** | Fully local, no cloud dependency |
| **MVP priority** | **MEDIUM** — Arthur already runs Immich with an API key. "Show me photos from last summer" is a great daemon capability. |

### 4.4 Photos — Google Photos
| Aspect | Detail |
|--------|--------|
| **Integration method** | Google Photos Library API |
| **Auth** | OAuth 2.0 (same Google flow) |
| **Read** | Albums, media items, search by date/category |
| **Write** | Upload (images up to 200MB, videos up to 20GB), create albums |
| **Rate limits** | 10,000 requests/day |
| **Cost** | Free |
| **MVP priority** | **LOW** — Immich covers the privacy-first story; Google Photos is a nice-to-have. |

---

## 5. SMART HOME

### 5.1 Home Assistant
| Aspect | Detail |
|--------|--------|
| **Integration method** | Home Assistant REST API + official MCP server |
| **Auth** | Long-lived access token (generated in HA UI) |
| **Read** | All entity states (lights, sensors, climate, locks, media players), automations, history |
| **Write** | Call any service (turn on/off, set temperature, lock/unlock, trigger automations) |
| **Rate limits** | Self-hosted — unlimited |
| **Cost** | Free |
| **MCP servers** | Official Home Assistant MCP integration (home-assistant.io/integrations/mcp_server); ha-mcp community server |
| **Privacy** | Fully local, data stays on network |
| **MVP priority** | **HIGH** — The daemon controlling your home is magical and aligns perfectly with the "devices as one computer" vision. HA's MCP server is mature and official. |

### 5.2 Google Home / Alexa / HomeKit
| Aspect | Detail |
|--------|--------|
| **Integration method** | Google Home: Device Access API (limited); Alexa: Smart Home Skill API; HomeKit: no public API |
| **Auth** | Various OAuth flows; all require device manufacturer partnerships |
| **Read/Write** | Limited compared to Home Assistant |
| **Cost** | Google Device Access: $5 one-time; Alexa: free with Amazon Developer account |
| **MVP priority** | **VERY LOW** — Home Assistant is the universal hub. If users have Google Home/Alexa, they can bridge through HA. |

---

## 6. FINANCE

### 6.1 Banking — Plaid
| Aspect | Detail |
|--------|--------|
| **Integration method** | Plaid API (REST) + MCP server available |
| **Auth** | Plaid Link (user-facing widget) + API keys |
| **Read** | Account balances, transactions, recurring transactions, investment holdings, identity verification |
| **Write** | Initiate transfers (with additional compliance); categorize transactions |
| **Rate limits** | Varies by endpoint; generally generous |
| **Cost** | Production: pay-per-connection ($0.30-$0.50/user/month estimated); Sandbox free |
| **MCP servers** | plaid-mcp (arjabbar/plaidmcp) available |
| **Privacy** | Heavily regulated (SOC2, bank-grade security); Plaid acts as intermediary |
| **MVP priority** | **LOW for MVP** — High value but high compliance burden. "What did I spend this month?" is great but regulatory complexity is real. Phase 2. |

### 6.2 Expense Tracking / Invoicing — Stripe
| Aspect | Detail |
|--------|--------|
| **Integration method** | Stripe API (REST) |
| **Auth** | API key (secret key + publishable key) |
| **Read** | Payments, invoices, customers, subscriptions, balance |
| **Write** | Create invoices, charges, refunds, manage subscriptions |
| **Rate limits** | 100 reads/second, 25 writes/second (live mode) |
| **Cost** | Free API; Stripe charges transaction fees (2.9% + $0.30) |
| **MCP servers** | Stripe MCP server available |
| **MVP priority** | **LOW** — Useful for daemon's own billing, not for user finance management. |

---

## 7. HEALTH & FITNESS

### 7.1 Wearable Data — Open Wearables / Terra
| Aspect | Detail |
|--------|--------|
| **Integration method** | Open Wearables API or Terra API (unified wearable API) |
| **Auth** | OAuth per wearable manufacturer |
| **Read** | Steps, heart rate, sleep, HRV, SpO2, workouts, calories — from Apple Health, Garmin, Fitbit, Oura, Whoop, etc. |
| **Write** | Very limited (mostly read-only health data) |
| **Rate limits** | Depends on upstream APIs |
| **Cost** | Open Wearables: open-source, free. Terra: paid plans starting ~$50/mo |
| **MCP servers** | Open Wearables has an MCP server for Claude/ChatGPT |
| **Privacy** | Health data is HIPAA-sensitive in US, GDPR-sensitive in EU. Must handle with extreme care. |
| **MVP priority** | **LOW** — "How did I sleep?" is nice but the data normalization challenge is significant. Phase 2. |

### 7.2 Apple Health / Google Health Connect
| Aspect | Detail |
|--------|--------|
| **Integration method** | Apple HealthKit (iOS only, on-device); Google Health Connect (Android SDK) |
| **Auth** | On-device permission prompts |
| **Read** | Steps, heart rate, sleep, workouts, nutrition, vitals |
| **Write** | Write data back (steps, workouts, etc.) |
| **Restriction** | Apple HealthKit is iOS-only and on-device only — cannot be accessed from a server. Google Health Connect replaces Google Fit (deprecated 2026). |
| **MVP priority** | **LOW** — Requires native mobile integration. The daemon Android app could access Health Connect. |

---

## 8. TRAVEL

### 8.1 Flights — Duffel
| Aspect | Detail |
|--------|--------|
| **Integration method** | Duffel API (REST) |
| **Auth** | API key (already in Arthur's vault) |
| **Read** | Flight search, offers, seat maps, order details |
| **Write** | Book flights, manage orders, add baggage/seats |
| **Rate limits** | Generous (rate limited per API key) |
| **Cost** | Free to search; booking commission varies by airline |
| **MCP servers** | Duffel MCP available; SerpAPI Google Flights for search |
| **MVP priority** | **LOW** — Arthur already has Cabinet for this. Daemon can delegate to Cabinet. |

### 8.2 Maps — Google Maps / Places
| Aspect | Detail |
|--------|--------|
| **Integration method** | Google Maps Platform APIs (Places, Directions, Geocoding) |
| **Auth** | API key |
| **Read** | Places, directions, distances, geocoding, reviews |
| **Write** | N/A (read-only) |
| **Rate limits** | Varies; Places: 100 requests/second |
| **Cost** | $200 free credit/month; then pay-per-use (Geocoding: $5/1000; Places: $17-40/1000) |
| **MVP priority** | **LOW** — Useful but not a daily integration. |

---

## 9. DEVELOPMENT

### 9.1 GitHub
| Aspect | Detail |
|--------|--------|
| **Integration method** | GitHub REST/GraphQL API + official GitHub MCP server |
| **Auth** | Personal Access Token (PAT) or GitHub App |
| **Read** | Repos, issues, PRs, commits, code search, actions, releases |
| **Write** | Create issues/PRs, push code, manage branches, trigger workflows, merge PRs |
| **Rate limits** | Authenticated: 5,000 requests/hour (REST), 5,000 points/hour (GraphQL) |
| **Cost** | Free for public repos; free tier includes private repos |
| **MCP servers** | Official GitHub MCP server (83 tools); Composio GitHub toolkit |
| **Security note** | MCP server has NO built-in rate limits — agent in a loop can create dozens of repos/issues. Must implement guardrails. |
| **MVP priority** | **HIGH for developer users** — The target audience (multi-device power users, developers) lives in GitHub. "Create an issue for that bug" is natural daemon language. |

---

## 10. SHOPPING & COMMERCE

### 10.1 Food Delivery — DoorDash / Uber Eats
| Aspect | Detail |
|--------|--------|
| **Integration method** | DoorDash Drive API, Uber Consumer Delivery API |
| **Auth** | OAuth 2.0; partner approval required |
| **Read** | Menus, restaurants, order status |
| **Write** | Place orders, track delivery |
| **Restrictions** | APIs primarily for merchant/partner integration, not consumer apps. ChatGPT has direct partnerships (Instacart, DoorDash, Uber). |
| **MVP priority** | **VERY LOW** — Requires partner agreements. Alexa+ just launched Grubhub/Uber Eats voice ordering. Daemon can't compete here without partnerships. |

### 10.2 Amazon
| Aspect | Detail |
|--------|--------|
| **Integration method** | No public consumer shopping API. Product Advertising API (affiliate links only). |
| **Read** | Product search, prices, reviews (via PA-API) |
| **Write** | Cannot place orders via API |
| **MVP priority** | **VERY LOW** — Amazon has no API for "buy this for me." Would require browser automation. |

---

## COMPETITOR DEVICE ANALYSIS

### Rabbit R1 (2024-2026)
- **Status**: Survived initial criticism; RabbitOS 2 (Sept 2025) added real agent capabilities
- **Integrations**: DLAM (controls your computer over USB without installing software), OpenClaw integration for voice-controlled automation
- **Key learning**: Narrow, well-executed integrations beat broad shallow ones. DLAM (computer control) is their killer feature.

### Humane AI Pin (2024-2025)
- **Status**: Dead. Acquired by HP for $116M (Feb 2025) after returns exceeded sales.
- **Key learning**: A device that tries to replace the phone fails. Daemon's "augment, don't replace" approach is correct.

### Meta AI Glasses
- **Status**: Successful — glasses that look normal with built-in camera/mic + Meta AI
- **Integrations**: Meta AI for visual understanding, photo/video capture, Meta social ecosystem
- **Key learning**: The form factor that doesn't look weird wins. Software companion > hardware gadget.

### OpenAI / ChatGPT Actions
- **Status**: Plugins killed (March 2024), replaced by Custom GPTs with "actions" (API calls)
- **Current**: ChatGPT integrates Google Drive, Instacart, DoorDash, Uber, Shopify
- **Standards**: OpenAI co-created AGENTS.md spec, adopted MCP, launched Apps SDK (MCP + UI)
- **Key learning**: The industry converged on MCP as the standard. Building on MCP is the right bet.

---

## COMPOSIO ECOSYSTEM

Composio offers 1000+ toolkits as a unified integration layer:

**What it provides:**
- Managed OAuth for 500+ apps
- Pre-built tool schemas optimized for LLM function calling
- MCP gateway (every integration auto-exposed via MCP)
- Framework support: LangChain, CrewAI, OpenClaw, Claude, custom

**Key categories covered:**
- Communication: Gmail, Slack, Discord, MS Teams
- Productivity: Notion, Google Calendar, Todoist, Asana, Linear
- CRM: Salesforce, HubSpot, Pipedrive
- Dev: GitHub, GitLab, Jira, Confluence
- Social: Twitter, YouTube
- Commerce: Shopify, Stripe
- Music: Spotify

**Arthur already has a COMPOSIO_API_KEY.** This is the single fastest path to broad integration coverage. Rather than building each OAuth flow from scratch, use Composio for the long tail and build native MCP connections for the top 5-6 most critical integrations.

---

## MCP ECOSYSTEM STATUS (April 2026)

- **593+ MCP servers** listed in directories; 5,800+ total in ecosystem
- **Universal adoption**: OpenAI (Apr 2025), Microsoft (Jul 2025), AWS Bedrock (Nov 2025), Google all support MCP
- **MCP Registry** (official, curated, security-audited) planned for Q4 2026
- **Key MCP servers with production quality:**
  - Gmail, Google Calendar, Google Drive
  - GitHub (official, 83 tools)
  - Slack
  - Home Assistant (official)
  - Notion (official)
  - Obsidian (multiple mature options)
  - Spotify
  - Todoist
  - Plaid (banking)

---

## MVP INTEGRATION PRIORITY MATRIX

### Tier 1 — Launch (weeks 1-4)
These give the most daily value with the least effort:

| Integration | Why | Effort | Auth |
|------------|-----|--------|------|
| **Gmail** | Email triage, draft replies, extract actions | Low (MCP server exists) | Google OAuth (do once) |
| **Google Calendar** | "What's my day?" is the #1 morning query | Low (same OAuth) | Same Google OAuth |
| **Telegram** | Daemon's messaging channel, zero cost | Very low (bot token) | Bot token |
| **Spotify** | Music control = instant delight | Low (MCP server exists) | Spotify OAuth |
| **Home Assistant** | Control home = magic | Low (official MCP) | HA access token |
| **GitHub** | Developer users' daily workflow | Low (official MCP) | PAT token |

**Total auth flows needed: 3** (Google OAuth, Spotify OAuth, tokens for Telegram/HA/GitHub)

### Tier 2 — Growth (weeks 5-12)
| Integration | Why | Effort |
|------------|-----|--------|
| **Notion** | Official MCP, popular with target users | Low |
| **Obsidian** | Local-first, privacy story, developer favorite | Low |
| **Slack** | Work context awareness | Medium |
| **Todoist** | Task management | Low |
| **Google Drive/Docs** | Free with existing Google OAuth | Low |
| **Immich** | Photo search, Arthur already runs it | Low |

### Tier 3 — Expansion (post-launch)
| Integration | Why | Effort |
|------------|-----|--------|
| **Composio bridge** | Unlock 500+ integrations at once | Medium |
| **Microsoft 365** | Enterprise users | Medium |
| **Discord** | Community users | Low |
| **Plaid** | Financial awareness | High (compliance) |
| **Health data** | Wellness features | Medium |
| **Twitter/X** | Social posting | Medium (cost) |

### Tier 4 — Don't Build
| Integration | Why Not |
|------------|---------|
| **LinkedIn** | Prohibits automated personal posting |
| **Instagram** | Painful approval, Business account required |
| **iMessage** | Apple actively hostile, fragile bridges |
| **Amazon shopping** | No consumer API exists |
| **Food delivery** | Requires partnership agreements |
| **Apple Music** | No playback control |

---

## ARCHITECTURAL RECOMMENDATION

1. **Build a unified MCP client** in the daemon server that can load MCP servers dynamically (you already have smart MCP loading — extend it)
2. **Use Composio as the long-tail integration layer** — Arthur already has the API key. Don't reimplement OAuth for 500 apps.
3. **Build native MCP connections** for the Tier 1 integrations where you want deep control and offline capability
4. **Store integration credentials** in the existing vault pattern (per-user encrypted, scoped tokens)
5. **Implement action confirmation** — daemon should ask before sending emails, posting, or spending money. Read-only actions can be autonomous.

---

## KEY SECURITY PRINCIPLES

1. **Principle of least privilege**: Request minimum OAuth scopes. Don't ask for send permission until the user actually wants to send.
2. **Action confirmation**: Write actions (send email, post tweet, buy flight) require explicit user approval. Read actions (check calendar, show inbox) can be autonomous.
3. **Token storage**: All OAuth tokens encrypted at rest, never in logs, refresh handled automatically.
4. **Audit trail**: Log every action the daemon takes on behalf of the user, with timestamps.
5. **Kill switch**: User can revoke all integrations instantly from the daemon settings.
6. **Data residency**: Health and finance data never leaves the user's daemon instance (no cloud relay).
