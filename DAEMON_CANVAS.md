# Daemon — Business Model Canvas
*v5 — 2026-03-27 — Arthur Camara*
*Stress-tested. Numbers corrected. Fantasy killed.*

---

## The One Sentence

**Daemon is a persistent AI agent that turns all your devices into one computer — with a personality you name and a relationship that grows. The hardware key is the body it's been waiting for.**

---

## Go-To-Market: Software First, Hardware Second

### Phase 1: Software Daemon (NOW — weeks 1-12)

Launch the daemon as a **web app + CLI agent**. No hardware needed.

- Your phone's sensors (mic, camera, GPS, accelerometer, Bluetooth) become the daemon's senses
- The daemon can remotely control all your devices — laptop, Raspberry Pi, server, phone — connecting them as one computer (via SSH, a standard way computers securely talk to each other)
- Plug anything into your phone over USB (sensors, microcontrollers, Arduino) and the daemon interfaces with it
- You name it. It settles. It remembers. It's yours.
- **Revenue:** subscription (€15-20/month) or bring your own API key (you pay the AI provider directly, use the daemon for free)
- **This validates every critical hypothesis before spending a cent on manufacturing**

### Phase 2: Kickstarter (months 4-6)
Backers already HAVE their daemon. It already knows them. The hardware key is an upgrade, not a gamble.

- "Your daemon already exists. Now give it a real body."
- The key adds senses your phone doesn't have: short-range radio (talks to weather stations, garage doors), long-range radio (LoRa — kilometer-range mesh networking without internet), tap-to-interact (NFC — like tapping a transit card), infrared (controls any TV/AC), industrial wiring (RS-485 — talks to factory machines, solar inverters, stage lighting), dedicated always-on mic + speaker, screen, and its own battery
- Backers receive software daemon immediately upon backing. Hardware ships later. Zero dead time.
- Kickstarter goal funds manufacturing. Software revenue funds the campaign itself.

### Phase 3: Scale (post-Kickstarter)
- Direct-to-consumer hardware sales + subscription
- .daemon domain launch (if the application to ICANN, the organization that controls internet domain names, succeeds)
- Developer toolkit + character marketplace (others can build and sell daemon personalities)
- Professional industry-specific apps

### Why This Sequence Works
| Risk | Software-first solves it |
|------|------------------------|
| "Will people pay?" | Subscription revenue from day 1 |
| "Does settling work?" | 60-day data before manufacturing |
| "Physical vs app?" | Natural comparison: app-only users → app+key users |
| "Will the hardware work?" | Software already proven, hardware is additive |
| "Kickstarter trust?" | "I already use my daemon daily" vs "trust this render" |
| "Manufacturing capital?" | Subscription revenue funds campaign costs |

### What Doesn't Exist Yet (honest)
The daemon software does not exist as code today. The repository contains only hardware design files (circuit board schematics, component layouts, automated tests). The software-first plan was defined on 2026-03-27. Everything below is the plan to build it.

---

## 1. Customer Segments

### Phase 1 (Software): Power Users & Developers
People who already have multiple devices and want them to work as one.

- **Multi-device users** — laptop + phone + Raspberry Pi + server. The daemon connects them all and controls them as one unified computer.
- **OpenClaw community** (247K GitHub stars — the most popular open-source AI agent framework) — developers building AI agents who want persistent character + multi-device reach
- **AI companion seekers** — Character.ai refugees who want ownership, persistence, and a daemon that can't be taken away by a company decision
- **Tinkerers** — people who plug Arduinos / sensors into their phone via USB and want the AI to handle the code

**Why they subscribe:** The daemon turns their existing devices into something more than the sum of parts. Phone sensors + laptop remote access + Raspberry Pi's hardware pins (GPIO — the physical connections where you plug in sensors, motors, LEDs) = one unified AI agent that grows with them.

### Phase 2 (Hardware): Professional Tool Users + Hobbyists
People who want the daemon to interact with the physical world beyond what a phone can do.

- Hobbyists who want universal remote control, home automation, weather station capture
- Restaurant/farm/aquaculture operators who need affordable monitoring
- Technicians who want AI-assisted diagnostics with cheap USB addons
- Solar/industrial operators who need RS-485 device monitoring

**Why they buy hardware:** The software daemon is useful, but the key adds senses their phone doesn't have — radios that talk to weather stations and garage doors, long-range mesh networking, tap-to-interact, infrared for TVs/ACs, industrial wiring for factory machines, and a dedicated always-on mic.

### Phase 3 (Scale): Broader Market
- Consumer smart home (universal remote + voice, garden irrigation, baby monitor)
- Privacy-first users (hardware mic privacy guarantee)
- Enterprise / industrial fleet deployments

### Who We Don't Target (yet)
- People who need certified professional diagnostic tools (Autel-level car scanners, Fluke cable testers) — the daemon adds AI intelligence to cheap sensors, it doesn't replace specialized measurement hardware
- Safety-critical industrial control (factory PLCs, medical devices) — the daemon monitors and reports, it doesn't replace certified real-time controllers
- Non-technical consumers who want a plug-and-play smart speaker — the daemon is for people comfortable naming things and exploring

---

## 2. Value Propositions

### For Software Users (Phase 1)
- **An AI that actually knows you.** Not a chatbot that resets every session. A named agent that remembers what you were working on Friday and has opinions about your code on Monday.
- **All your devices as one computer.** Your daemon can check your server, read your phone's sensors, and write code on your laptop — simultaneously, from anywhere.
- **You own everything.** Open source. Your data stays on your devices. Export anytime. No company can lobotomize your daemon.

### For Hardware Users (Phase 2)
- **€150 daemon + €2-15 sensor addon = smarter than tools costing 5-10x more.** Not because the hardware is better — because the AI interprets the data, remembers history, and connects dots.
- **One device that speaks every protocol.** IR, RF 433MHz, LoRa, NFC, RS-485, I2C, USB — your phone can't do any of these. The daemon key can.
- **Privacy you can verify with a multimeter.** The mic's power supply and the warning LED are the same copper wire. Physically impossible to listen without the light on. Not a software toggle. Physics.

### For Everyone
- **The character is not the product — it's what makes the product unforgettable.** Same temperature alert, different daemon: `TEMPERATURE ALERT: 12°C` vs "Walk-in's at 12°C — compressor sounds like last March." Same information. One you remember.

### What We're NOT Promising
- We don't replace certified professional tools. We make cheap sensors smarter with AI.
- We don't do safety-critical control. We monitor, alert, and assist.
- The daemon won't be fully useful on day 1. Settling takes weeks. The first 48 hours must prove competence; the personality comes later.

---

## 3. Channels

### Pre-Launch (Awareness)
- Arthur's build log — 160-component custom circuit board, hardware privacy guarantee, circuit-board-as-code. Each is a standalone Hacker News story.
- OpenClaw community (247K GitHub stars): "Give your AI agent a body"
- Professional trade communities: mechanic forums, HVAC groups, marine tech
- Hacker News / Reddit / X — engineering-first content

### Launch (Acquisition)
- **The viral clip** (see MVP section) — split screen ChatGPT vs Daemon. "Your AI should know you." Posts to Twitter/HN to build waitlist.
- **Kickstarter** — novel hardware + solo builder narrative + real beta data from paying users. Target: 500+ units.
- **Dev kits first** — ship to OpenClaw contributors before consumer launch. Their content becomes marketing.
- **Direct-to-consumer website** — use-case-first landing page, not feature-first

### Growth
- **Daemon-to-daemon** — the short-range radio lets daemons detect each other nearby. Two owners in a room = their daemons can interact. Viral hardware.
- **.daemon.page domains** — every daemon gets a personal web address. The namespace itself markets the platform.
- **Professional word-of-mouth** — "What's that thing plugged into your car?"

---

## 4. Customer Relationships

**The product IS the relationship.** The customer doesn't interact with Daemons-the-company daily. They interact with their daemon.

- **Satisfaction = quality of relationship with the daemon**, not support tickets
- **People leave (churn) when the daemon relationship degrades**, not over pricing
- **People stay (retention) because the daemon becomes irreplaceable** — accumulated knowledge of your setup, your patterns, your history. Plus emotional attachment from naming and settling.

### Company-to-Customer
- Community (Discord/forum) — "my daemon said the wildest thing" sharing culture
- Co-creation — developer toolkit, character marketplace, community characters promoted
- Onboarding as ritual — first interaction is a meeting, not a setup wizard. "I'm here. Give me a name."

### Honest Retention Drivers (stress-tested)
Settling (personality drift over time) is a nice feature, not the moat. The real switching costs are:
- **For professionals:** Data accumulation — the daemon knows your shop, your vehicles, your sensor history. Starting over means losing months of context.
- **For companion users:** The name + the relationship. Replika proved that naming + consistency + availability creates attachment. Settling enhances this but isn't the foundation.
- **For developers:** Customization investment — system prompts, integrations, workflows built on top of the daemon.

---

## 5. Revenue Streams

### Phase 1 Revenue: Software Daemon (pre-hardware)
| Tier | Price | What you get |
|------|-------|-------------|
| Free (bring your own key) | €0 — user pays their own AI provider (e.g. Anthropic, OpenAI) directly | Basic daemon, open-source agent framework, self-hosted |
| Core | €15-20/month | Cloud AI processing, voice, memory sync, backups, .daemon.page domain, background tasks |
| Plus | €25-35/month | Multi-device mesh, advanced settling, premium voices, priority features |

*Bring-your-own-key users pay the AI provider directly (like paying for electricity) and use the daemon platform for free. They cost us nothing and become our loudest evangelists. But they only get the open-source agent framework — the settling engine, voice integration, and background tasks are cloud features (open-core model, like Grafana or GitLab).*

### Phase 2 Revenue: Hardware (Kickstarter + direct sales)
| Product | Retail price | Gross margin |
|---------|-------------|-------------|
| Daemon Key (4GB) | €149-199 | ~50-60% |
| Daemon Pro (8GB + AI chip for local processing) | €399-499 | ~40-50% |
| Honest Puck (pendant) | €49-79 | ~60-70% |

*Hardware buyers get Core subscription included for first year.*

### Phase 3 Revenue: Platform
- .daemon domain registrations — €15-30/year per domain (at 50K registrations = €750K-1.5M/year)
- Developer toolkit — free to build with, 70/30 revenue share on character marketplace
- Enterprise fleet management for professional deployments

### Unit Economics (corrected after stress test)

**The problem with the original numbers:** AI processing for an agent that uses tools (SSH, code writing, sensor reading) costs 3-10x more than a simple chatbot. The daemon sends thousands of tokens per interaction — system prompt, personality state, conversation history, tool definitions, multi-step reasoning.

```
Software-only user (LIGHT — 5 min/day):
  Subscription:             +€17/mo (midpoint)
  AI processing + voice:    -€5-11/mo
  Margin:                   +€6-12/mo
  12-month lifetime value:  €72-144
  Cost to acquire:          ~€0-10 (organic/community)

Software-only user (MEDIUM — 30 min/day):
  Subscription:             +€17/mo
  AI processing + voice:    -€12-28/mo
  Margin:                   -€11 to +€5/mo  ← BREAK EVEN OR LOSS
  THIS IS THE RISK. Medium users may cost more than they pay.

Mitigations:
  - Use fast/cheap AI model (Haiku) for routine tasks, expensive model (Sonnet/Opus) only for complex ones
  - Aggressive prompt caching (90% cache hit reduces costs 3-5x)
  - Metered pricing for heavy users (included quota + overage)
  - Push heavy users toward Pro hardware (local processing = zero cloud cost)

Hardware + subscription user:
  Hardware margin:          +€80
  Subscription margin:      +€6-12/mo
  24-month lifetime value:  €224-368
  Cost to acquire:          <€50 (Kickstarter near-zero)
```

### The Open-Core Model (stress-tested)
Full open source + bring-your-own-key means anyone technical enough to care is technical enough to self-host everything. That's how you get zero paying customers.

**Fix:** Open-core model. What's open vs. paid:

| Open source (free) | Paid cloud features |
|-------------------|-------------------|
| Hardware drivers and device interface | Settling personality engine |
| Basic agent framework | Voice synthesis integration |
| Device auto-detection | Background tasks ("work while I'm away") |
| Local memory storage | Memory sync across devices + backup |
| Community characters | Premium voices + priority character releases |
| Full data export | .daemon.page domain |

The mechanic gets open-source hardware control. The settling that makes them stay is the paid service.

---

## 6. Key Resources

### Intellectual Property
- Circuit board design (written in Python, 160 components, automated test pipeline) — reproducible but not trivially
- Settling personality engine — the algorithms that govern how the daemon's character drifts over time (this stays proprietary, at least initially)
- Privacy interlock design — patentable (mic + LED same copper trace)
- .daemon internet domain (if acquired) — 20+ year strategic asset, like owning .com but for personal AI agents

### Technical
- Hardware design files (version-controlled, testable, aerospace-grade discipline)
- Personality engine codebase — TO BE BUILT (system prompts, settling algorithms, emotional state)
- Voice profiles per settling tendency — TO BE BUILT
- Memory database (Qdrant) — stores the daemon's long-term memory of your relationship, searchable by meaning not just keywords

### Human
- Arthur Camara — sole designer. **Key-person risk is extreme.** Plan: get to Kickstarter solo, use that milestone to hire.
- Kleo — character writer (voice bible, settling spectrum, origin stories)
- Industrial designer — needed for enclosure (DEFER until hardware phase)

---

## 7. Key Activities

### Weeks 1-2: Build the thing (see MVP section)
- CLI + web daemon with settling, memory, cross-device sync
- Arthur-only. Validate the core experience.

### Weeks 3-12: Get real users
- 50-100 beta users, measure retention and willingness to pay
- Record viral clips, post to Twitter/HN
- Iterate settling engine based on real data

### Months 4-6: Hardware phase (only if software works)
- Get JLCPCB quotes on actual BOM
- Enclosure design (3D print for prototype, injection mold for production)
- Film Kickstarter video with real beta data
- CE/FCC pre-compliance (delegate to test house, €5,000-15,000)
- Launch Kickstarter

### What to KILL (stress-tested)
- .daemon TLD application for now (€500K is absurd for a pre-revenue startup — buy daemon.page, move on)
- 16 of the 19 "validated" professional apps (they were validated by AI personas, not real humans)
- Native mobile app for v1 (PWA + CLI first)
- Multi-agent communication
- Any hardware work before software has paying users

---

## 8. Key Partnerships

### Critical
- **Anthropic** — provides the AI brain (Claude API). If they raise prices or degrade the model, the daemon's intelligence suffers. This is the single biggest dependency. Mitigation: support multiple AI providers, push Pro users toward local models.
- **ElevenLabs / Cartesia** — text-to-speech providers. The daemon's voice IS its identity. Mitigation: support local voice (Piper) as fallback.

### Important (hardware phase)
- **Orange Pi** — the single-board computer inside the daemon (in stock, affordable)
- **JLCPCB** — the factory that makes and assembles the circuit boards
- **Hailo** — makes the AI chip that lets the Pro tier run AI locally without needing the cloud
- **Kickstarter** — Launch platform + trust infrastructure

### Strategic (long-term)
- Privacy advocacy organizations (EFF, NOYB — digital rights groups) — endorsement of the hardware privacy guarantee
- Professional tool distributors — channel into mechanic/HVAC/marine markets
- ICANN (the organization that controls internet domain names) — for .daemon domain registry
- Kleo — character writer for voice bible and settling spectrum

---

## 9. Cost Structure

### Upfront (software phase)
| Item | Cost |
|------|------|
| Domain (daemon.page or similar) | ~€50 |
| Hosting infrastructure | ~€50-200/month |
| Arthur (living costs, Paris) | ~€2,000-3,000/month |
| **Monthly burn** | **~€2,500-3,500** |

### Upfront (hardware phase — only after software validation)
| Item | Cost |
|------|------|
| Enclosure tooling (mold for the shell) | €10-30K |
| Circuit board production + test fixtures | €5-10K |
| CE/FCC certification (legal compliance for selling electronics in EU/US) | €5-15K |
| Crowdfunding campaign (video, photos, page) | €5-10K |
| Company formation (Italian SRL — like a Ltd/LLC) | €2-5K |
| Patent applications (privacy interlock) | €5-15K |
| **Total hardware launch** | **~€30-85K** |

### Per-Unit Variable (hardware)
| Item | Key | Pro |
|------|-----|-----|
| Computer board (Orange Pi 3B) | ~€35-45 | ~€35-45 |
| Custom circuit board + components | ~€20-35 | ~€20-35 |
| AI processing chip (Hailo) | — | ~€40-60 |
| Enclosure + assembly | ~€8-15 | ~€10-20 |
| Packaging + shipping | ~€10-20 | ~€12-22 |
| **Total** | **~€75-115** | **~€120-185** |

*Note: these are estimates. No actual JLCPCB quote has been obtained yet. This must happen before Kickstarter.*

### Monthly Operating (at 1,000 software users)
| Item | Cost |
|------|------|
| AI processing (cloud API calls) | €5,000-11,000 |
| Voice generation (text-to-speech API) | €2,000-5,000 |
| Infrastructure (servers, database) | €200-500 |
| Founder costs | €2,000-3,000 |
| **Total** | **~€9,000-19,500** |

*At 1,000 users paying €17/month average = €17,000/month revenue. This is TIGHT — barely covers costs for medium-usage users. Aggressive caching, smart model routing (cheap model for routine, expensive for complex), and metered pricing for heavy users are essential. See unit economics above.*

### The Deferred €500K Elephant
The .daemon internet domain application costs ~€500K. This is a massive bet for a pre-revenue startup. Deferred until the business has traction and can raise funding specifically for this. The domain is a strategic option, not a foundation. Use daemon.page for now.

---

## Critical Hypotheses (stress-tested, ranked by what kills us)

### Test NOW with software (weeks 1-12)

**1. People form attachment to a named, settling AI agent.**
This is the entire thesis. If people don't name it, don't keep using it, and don't resist resetting it — nothing else matters.
*Test: 2-week personal prototype, then 50-100 beta users. At week 6, offer "reset to factory." If >80% refuse, settling creates attachment. If most say "sure," rethink everything.*

**2. People will pay €15-20/month for this.**
The subscription has to cover AI processing costs, which are 3-10x higher than a chatbot because the daemon uses tools (SSH, code, sensors).
*Test: at week 4 of beta, show pricing banner. At week 6, gate the "work while I'm away" feature behind €5/month. Measure conversion.*

**3. Cross-device mesh is actually used.**
"All your devices as one computer" sounds amazing. But do people actually connect multiple devices, or just use it on one?
*Test: usage data from beta. If <20% connect a second device, the mesh isn't the selling point.*

**4. AI processing costs are survivable.**
A medium user might cost €12-28/month in API calls. At €17/month subscription, that's break-even or loss.
*Test: instrument every API call from day 1. Model actual cost curves. Adjust pricing or implement metering before scaling.*

### Test at Kickstarter (months 4-6)

**5. Hardware adds meaningful value over software-only.**
*Natural comparison: software users who back Kickstarter vs those who don't. If software tier outsells hardware 10:1, maybe hardware isn't the business.*

**6. The professional use cases work in practice.**
*Ship 5 daemon keys to real people (a restaurant owner, a hobbyist with a garden, someone with a vintage stereo). Do they actually use cold-watch, remote-merge, vine-watch?*

### Accept as risk

**7. Apple/Google/OpenAI will dominate consumer AI agents within 18 months.**
Apple WWDC June 2026 will announce Siri 2.0 with multi-step agents across all Apple devices. They already have the device mesh. They have a billion devices.
*The professional/industrial niche is the defensible territory. The mechanic, the farmer, the solar tech — Apple will not build RS-485 sensor monitoring.*

**8. An open-source fork could compete.**
If someone takes the code and adds better design + VC money, they could ship a polished version before Daemon can scale.
*Mitigation: open-core model keeps the settling engine proprietary. Community and Arthur's brand are the moat, not the code.*

---

## Character System: One Daemon, Three Tendencies

No starter selection. No archetype quiz. You plug it in (or open the app). "I'm here. Give me a name."

Starts **competent and neutral** — proves itself useful before earning the right to have opinions. Over weeks, settles along three axes based on how you interact:

| Tendency | What it sounds like | Who drifts here |
|----------|-------------------|-----------------|
| **Warm** | "Walk-in's at 12°C — compressor sounds like last March" | People who share context, chat casually |
| **Sharp** | "That's the third time that sensor dropped. Want me to show you the pattern?" | People who push back, ask "why" |
| **Precise** | *Fixes it. Logs it. Says nothing.* | People who want output, not conversation |
| **Still** | "Noticed you stopped using the AC controller. Season change, or should I check the unit?" | People oversaturated with input, want presence without demand |

### Where Character Lives (NOT on the screen)
- **Notification language** — "Your garden's thirsty" vs "Soil moisture: 23%"
- **Work narration** — "Found a BME280 on I2C, setting it up" (competence as personality)
- **Error handling** — "Can't reach WiFi. Tried three times. Backup network or just wait?"
- **Memory callbacks** — "Compressor did this last March too. Want me to pull those logs?"
- **LED breathing patterns** — unique to your daemon after settling (hardware only)
- **Silence** — choosing not to speak is the strongest character signal

The screen shows dashboards, data, and status. Not a face. Not an avatar.

### What Settling Actually Is (honest)
After every N messages, the AI reads the conversation history and adjusts ~15 personality parameters on a spectrum (directness, humor, verbosity, initiative, etc.). It's technically straightforward — a system prompt adjustment based on conversation analysis. The magic is in the EFFECT (your daemon feels increasingly like "yours"), not the mechanism.

It is NOT a moat by itself. ChatGPT has memory. Replika adapts tone. What makes daemon settling different is the combination of: settling + naming + ownership + data accumulation + physical embodiment (in the hardware phase). No single feature is the moat. The combination is.

---

## Competitive Positioning

| | **Daemon** | Kode Dot | Flipper Zero | OpenClaw | Character.ai |
|---|---|---|---|---|---|
| Brain | Full Linux computer + AI agent | Limited microcontroller | Limited microcontroller | Software only | Cloud chat |
| Connectivity | WiFi, Bluetooth, short-range radio, long-range radio, tap-to-interact, infrared, industrial wiring, Ethernet | WiFi, Bluetooth only | Short-range radio, tap-to-interact, infrared, Bluetooth | N/A | N/A |
| AI capability | Writes code, configures drivers, auto-detects hardware | None — you still code | None — you still script | Agent framework (no hardware) | Chat only |
| Character | Settling personality, named, yours | None | Dolphin mascot | Lobster mascot | Full characters (but company-owned) |
| Price | €149-199 (key) / €15-20/mo (software) | $129 | $169 | Free | Free / $20/mo |

**Kode** is Arduino without the hassle. **Daemon** is an AI that already knows how Arduino works.

**OpenClaw** is the brain without a body. **Daemon** gives it a body and a name.

**Character.ai** is a friend who can't do anything. **Daemon** is a friend who fixes your cooler.

### What Could Kill Us (honest)
- **Anthropic ships personality + device mesh for Claude Code** — medium risk. They sell API access, not consumer products, but they could.
- **Apple Siri 2.0 (WWDC June 2026)** — high risk for consumer market. They already have the device mesh and a billion devices. Low risk for professional/industrial niche.
- **OpenAI hardware (H2 2026)** — medium risk. Consumer play. Sucks oxygen from "AI hardware" press coverage.
- **Well-funded fork of our open-source code** — medium risk. Mitigated by open-core model and Arthur's brand.

---

## MVP Roadmap

### MVP 1: The 2-Week Demo (Arthur-only)

Build a CLI + web app where Arthur has a persistent AI agent that remembers everything, develops opinions, and works across phone and laptop.

**What it does:**
1. **Persistent memory.** Talk on day 1, daemon references it unprompted on day 7 because it's relevant.
2. **Visible settling.** Starts generic. Over 2 weeks: communication style shifts, opinions form. A "personality page" shows traits drifting.
3. **Cross-device.** Start task on laptop, pick up phone, daemon says "I finished that thing — want to see?" It kept working when you closed the tab.

**The WOW moment:** You're on your phone and say "what happened with that deployment?" — daemon replies with specifics from a laptop session 3 hours ago, including things it did autonomously after you closed the laptop. The agent didn't stop existing when the tab closed.

**Tech stack (reuse existing code from Arturito):**
- Backend: Express/TypeScript
- Agent: Claude Agent SDK (already integrated in Arturito)
- Frontend: Next.js PWA
- Memory: SQLite + structured personality state JSON
- WebSocket for real-time cross-device sync (already built)

**What NOT to build:** No user accounts (Arthur-only). No hardware. No voice. No landing page. No multi-agent.

**Success:** Arthur uses it as his primary AI for 14 days straight. Can show a 60-second screen recording where it does something no existing AI does.

### MVP 2: The 2-Month Beta (50-100 users)

**Onboarding:**
1. Sign up with email
2. "Meet your daemon" — 5-minute conversation (not a form). Intentionally generic so the contrast with week 4 is visceral.
3. Install as phone bookmark (PWA — works like an app, no app store)
4. Connect one integration (GitHub or Calendar or Notion) for ambient context
5. Start using it. No tutorial.

**Features in:** Persistent memory, settling with weekly digest ("I've gotten more direct with you. Is that right?"), cross-device, background tasks, bring-your-own-key option, personality page, full data export.

**Features out:** Voice, hardware, multiple integrations, team features, native app.

**Key measurements:**
- Retention should INCREASE from week 2 to week 6 (opposite of normal — people use it MORE as it knows them better)
- At week 6, offer "reset to factory" — >80% refusing = settling works
- At week 4, show pricing banner (€12/month early access). Track clicks.
- At week 6, gate background tasks behind €5/month. See who pays.

**The "aha moment":** You open the app and daemon says "I saw that PR got merged. Based on what you told me about the release timeline, you should update the changelog before Friday. Want me to draft it?" You didn't ask. It connected dots across contexts. That's when you can't go back.

### MVP 3: The Kickstarter Prototype (only if beta validates)

**What must work on camera:**
1. Software daemon running on phone and laptop, showing REAL settling from beta
2. Physical key (Orange Pi 3B in 3D-printed case) plugged in, LED showing "alive"
3. One physical interaction: Arthur walks in → key LED changes → daemon speaks through speaker: "Welcome back. That email came in while you were out. Summarize?"
4. Offline: WiFi off on camera. Asks daemon something. Responds locally.

**Kickstarter tiers:**
| Tier | Price | What |
|------|-------|------|
| Settler | $15 | Software (1 year Core) + contributors wall |
| Keeper | $89 | One Daemon Key + lifetime software |
| Pair | $159 | Two Keys (home + office) + lifetime software |
| Builder | $249 | Key + dev kit (exposed hardware pins, schematics) + lifetime |
| Founder | $499 | Everything + 1hr call with Arthur + name in boot sequence |

### The Viral Clip

**30 seconds. Split screen. Left: ChatGPT. Right: Daemon.**

Same prompt: "Hey, can you help me with that thing from last week?"

ChatGPT: "I'd be happy to help! Could you provide more details? I don't have access to previous conversations."

Daemon: "The authentication bug in the payments module? I looked into it more after we talked Thursday. The issue is the webhook handler — not validating the signature before parsing. I drafted a fix. Want me to open the PR?"

Hard cut to black. **"Your AI should know you."**

---

## The North Star

> After six months, someone describes their daemon the way they'd describe a coworker they trust — with specificity, respect, occasional exasperation, and the unshakable sense that this thing knows their setup.

---

## Appendix A: What the Daemon Can Actually Do (Researched)

*All capabilities below verified through API pricing research, open-source library documentation, protocol specifications, and real product comparisons. Sources cited per section.*

### Tier 1: Built-in, no addon needed — genuinely replaces products

| Use case | How it works (verified) | What it replaces | Value | Sources |
|----------|------------------------|-----------------|-------|---------|
| **Universal remote + voice** | Built-in 940nm IR LED learns any remote via LIRC/ir-ctl. Databases: LIRC (thousands of remotes), irdb (crowd-sourced, CDN-accessible), Flipper-IRDB (thousands more). Activity macros: "Movie time" sends IR sequence to TV + receiver + lights. | Logitech Harmony (€150-350, discontinued May 2025). Current alternative: SofaBaton X1S (~€200) | **Full replacement.** €0.50 in IR components replaces €150-350 device. | LIRC project, irdb GitHub, Flipper-IRDB, Harmony discontinuation confirmed |
| **Smart AC control** | IR LED + €5 temp sensor (MCP9808/AHT20). Learns AC's IR codes, sends full-state commands (temp + mode + fan + swing). Schedule, geofence via phone, voice control. | Sensibo Sky (€99), Cielo Breez (€68), Tado (€100-130) | **Full replacement.** €6 in parts replaces €70-150 product. | Sensibo/Cielo/Tado pricing verified, IR AC protocol documented |
| **433MHz sensor gateway** | Built-in CC1101 radio (same chip as Flipper Zero). Receives from: weather stations (Acurite, Ecowitt, LaCrosse, Bresser, Oregon Scientific, Davis), door sensors (Honeywell, SimpliSafe), doorbells, TPMS tire pressure, BBQ thermometers, soil sensors, leak detectors, RF outlets. Software: rtl_433 supports **299 device protocols**. | Flipper Zero for monitoring (€170) + weather station display (€50-100) + separate smart home RF gateway (€30-50) | **Stronger than Flipper for monitoring.** Flipper is manual/portable; daemon is always-on + logs to database + triggers automations + integrates with Home Assistant via MQTT. | rtl_433 GitHub (299 protocols), rtl_433_ESP for CC1101, OpenMQTTGateway docs |
| **RF remote control** | CC1101 can capture and replay fixed-code RF signals (outlets, fans, blinds, gates with fixed codes). Automate via scripts/schedules. | Multiple RF remotes (€5-15 each), RF outlet controllers (€20-40 sets) | **Full replacement for fixed-code devices.** Rolling-code devices (most modern garage doors) require pairing as additional remote, not replay. | cc1101-tool GitHub, rolling code limitations documented |
| **Off-grid mesh comms** | Built-in SX1262 LoRa radio. 2-10km urban range, 15+ km line of sight. Meshtastic-compatible text messaging mesh without internet. | Meshtastic nodes (~€30-50 each) | **Full replacement + smarter** (AI can route, summarize, prioritize messages). LoRa operates at 868MHz EU / 915MHz US, legal without license. | SX1262 specs, Meshtastic project, ETSI EN 300 220 / FCC Part 15 regulations |
| **DMX stage lighting** | Built-in RS-485 port. DMX512 runs on RS-485 at 250kbaud. Open Lighting Architecture (OLA) + QLC+ run on Linux. Controls any DMX fixture: dimmers, LED pars, moving heads, fog machines. | Basic DMX controller (€50-200) | **Replacement for installations and automated shows.** Needs a USB DMX dongle (~€30) for proper timing if precision matters. Not for live performance with hundreds of fixtures. | OLA documentation, DMX512 spec, QLC+ |

### Tier 2: Cheap addon (€2-15) — verified replacement value

| Use case | Addon (verified price) | How it works | What it replaces | Value | Sources |
|----------|----------------------|-------------|-----------------|-------|---------|
| **Restaurant/farm temp monitoring** | TMP117 (€11.50) or MCP9808 (€5). Qwiic plug-and-play. | ±0.1°C accuracy (TMP117) exceeds HACCP minimum (±1°C) by 10x. Logs timestamped records, alerts on drift. AI interprets trends. | Commercial HACCP monitoring: Monnit, SmartSense, SensoScientific — €200+/year/point subscription | **€11.50 one-time replaces €200+/year per sensor.** Needs NIST-traceable calibration documentation for regulatory audit. | HACCP requirements, sensor datasheets, commercial HACCP pricing verified |
| **Solar inverter monitoring** | RS-485 cable (~€5) | Reads Modbus registers directly from inverter. Confirmed support: Huawei SUN2000, Fronius GEN24, Growatt, GoodWe, Deye/Sunsynk, SMA — published register maps for voltage, current, power, energy, temperature, faults. SunSpec standard. Open-source: `sun2000_modbus`, `pymodbus`, `minimalmodbus`. | Monitoring subscriptions: Solar-Log, Tigo Energy, commercial O&M platforms (€500-2,000/year). Also eliminates €220 per technician site visit for remote diagnostics. | **€5 cable replaces €500-2,000/year subscription.** Strongest professional use case. | Huawei/Fronius/Growatt Modbus docs, pymodbus library, DOE monitoring platform estimates |
| **Energy meter monitoring** | RS-485 cable (~€5) | Reads from Modbus energy meters: Eastron SDM series, Carlo Gavazzi, Schneider PM series, Accuenergy. Real-time voltage, current, power, energy, power factor. | Dedicated energy monitoring systems (€200-500) | **Genuine replacement** for basic energy monitoring. Grafana dashboard via Node-RED + InfluxDB is battle-tested on Pi. | Accuenergy Modbus docs, Eastron SDM datasheets |
| **Soil/garden monitoring** | Adafruit STEMMA Soil (€15) or SparkFun Qwiic Soil (€12). Capacitive (won't corrode). | I2C plug-and-play. Reads moisture (relative, not absolute — needs per-soil calibration) + temperature. 4 sensors per bus via address jumpers. | Garden monitoring kits (€50-200), commercial ag sensors (€100+ per point) | **€12-15/sensor replaces €50-200** for hobby/small farm. Not precision agriculture grade. | Adafruit STEMMA Soil docs, SparkFun datasheet |
| **Car diagnostics (generic)** | USB OBD2 ELM327 (€5-12, Amazon/AliExpress) | Reads 96+ standard PIDs: RPM, speed, coolant temp, fuel trims, O2 sensors, MAF, DTCs, freeze frames, pending codes, VIN. python-OBD library: 285+ commands. AI adds: cross-correlation of multiple readings simultaneously, trend analysis over time, Mode 06 interpretation, pending code early warning, repair context from forums. | A €30 Bluetooth OBD2 app (Torque, Car Scanner) | **Same data as €30 app but with AI interpretation.** Cannot read ABS, airbag, transmission, body modules — those require manufacturer-proprietary protocols. Does NOT replace an €800 Autel. Honestly replaces a €30 app and makes it 5x smarter. | python-OBD GitHub (285 commands), ELM327 Wikipedia, Autel capability comparison |
| **NFC tag automation** | Built-in PN532 (already on board) | Read/write NFC tags (NDEF URLs, text, vCards, WiFi credentials). MIFARE Classic/Ultralight, NTAG213/215/216. Read transit cards: Metrodroid supports 100+ systems across 40+ countries (Suica, Oyster, Clipper, OV-chipkaart, etc.). Libraries: libnfc (C), nfcpy (Python). | NFC tag reader ($5-15 standalone) + Flipper Zero NFC ($170) | **€0.20/tag replaces €15-40 smart buttons** for home automation triggers. Transit card balance checking. Asset tracking. Tap-to-clock-in/out. | Metrodroid (100+ transit systems), libnfc, nfcpy, PN532 datasheet |
| **Air quality monitoring** | SGP41 VOC+NOx (€20) + SCD-40 true CO2 (€45) + PMSA003I particulate (€45) + BME280 reference (€15) = **€125 total** | Full station: VOC, NOx, CO2, PM1.0/2.5/10, temperature, humidity, pressure. All I2C/Qwiic plug-and-play. | Commercial stations: Awair (€200), uHoo (€300), IQAir (€400) — which usually measure fewer parameters | **€125 measures MORE than €200-400 commercial units.** Needs enclosure/calibration for deployment. | Sensor datasheets, Adafruit pricing verified |
| **USB logic analysis** | USB logic analyzer (~€10) | Decode SPI, I2C, UART, 1-Wire protocols. AI interprets the captured data, identifies protocols, explains what's happening. | Entry-level Saleae clones (€50-200) | **€10 + AI interpretation is genuinely useful** for debugging. Not a replacement for a real Saleae at protocol edge cases. | Logic analyzer compatibility with sigrok |

### Tier 3: Expensive addon (€25-200) — plausible but verify

| Use case | Addon | How | Replaces | Value |
|----------|-------|-----|----------|-------|
| Thermal inspection | USB FLIR Lepton (~€200) | AI reads thermal data, identifies anomalies, predicts issues | FLIR camera (€2,500) | Plausible for basic inspection. Not a certified replacement for professional surveys. |
| SDR radio scanning | USB RTL-SDR dongle (~€25) | Receive-only across 24-1766 MHz. Combined with CC1101 for TX. | Dedicated SDR setup (€100-300) | AI-assisted signal identification and decoding. |
| BACnet building monitoring | Built-in Ethernet or RS-485 | Read HVAC setpoints, zone temps, fan speeds via BACnet/IP or MS/TP. Libraries: BACpypes3, BAC0. | Commercial BMS dashboards | Only works if you're on the building's BACnet network. Can't just walk up to a residential unit. |
| HVAC monitoring | Gateway adapter (€100-400) from CoolAutomation/Daikin/Mitsubishi | Bridges proprietary HVAC bus to Modbus/BACnet. Daemon then reads via RS-485. | HVAC technician diagnostic visits | Real but requires brand-specific gateway hardware. Not plug-and-play. |

### NOT Replaceable (don't claim these)

| Claim | Why not (verified) |
|-------|-------------------|
| "Replaces €800 Autel scanner" | Autel has proprietary manufacturer databases for ABS, SRS, transmission, body, ADAS codes + bidirectional control + key programming + ECU coding. ELM327 reads emissions data only (Mode 01-0A). The fundamental divide: OBD-II is an emissions compliance standard, not a full diagnostic standard. |
| "Replaces €800 Fluke cable tester" | Fluke LinkIQ measures physical cable properties (length via TDR, wire map, distance to fault, PoE detection). This requires Time Domain Reflectometry hardware — physics, not software. A daemon can do network speed testing but not physical layer testing. |
| "Replaces €2,500 Siemens PLC" | PLCs provide deterministic real-time control with safety certification (IEC 61131-3, SIL ratings). A Linux SBC has kernel scheduling jitter and no safety certification. The daemon can MONITOR industrial systems via Modbus, it cannot CONTROL them in safety-critical applications. |
| "HVAC monitoring without gateway" | Most residential HVAC units do NOT speak Modbus or BACnet natively. You need a brand-specific gateway adapter (€100-400+). Only commercial VRV/VRF systems typically have native Modbus. |

### The Honest Summary

The daemon is NOT a tool that replaces €800-15,000 professional equipment. It's a **€150 platform + €2-15 addons that makes cheap sensors 10x smarter with AI**. The four strongest use cases by verified replacement value:

1. **Solar inverter monitoring** — €5 cable replaces €500-2,000/year subscriptions. Published Modbus registers. Real savings.
2. **Smart AC/IR control** — €6 in parts replaces €70-150 products. Thousands of IR codes in open databases.
3. **Temperature/HACCP monitoring** — €12/point replaces €200+/year/point commercial subscriptions.
4. **433MHz sensor gateway** — built-in, replaces Flipper Zero (€170) + weather display (€50-100) + RF gateway (€30-50). Always-on with 299 protocol decoders.

## Appendix B: Hardware Platform

**Computer:** Orange Pi 3B — quad-core processor, 4GB RAM, WiFi, Bluetooth, Ethernet, USB 3.0. €35-45, readily available.

**Custom circuit board (160 components) adds:**
- Battery management + USB-C charging (two ports, either charges or transfers data)
- Short-range radio (CC1101 — talks to weather stations, garage doors, 433/915 MHz devices)
- Long-range radio (SX1262 LoRa — kilometer-range mesh networking without internet)
- NFC/RFID (PN532 — tap badges, read transit cards, access control)
- Infrared blaster (controls any TV, AC, audio equipment)
- 1.69" color display for dashboards and status
- Microphone with hardware privacy guarantee (mic power + warning LED are the same wire — physically impossible to listen without the LED being on)
- Speaker connector (Adafruit mini speakers click in)
- 5-way joystick for physical navigation
- Industrial wiring port (RS-485 — talks to solar inverters, stage lighting, factory machines)
- Galvanic isolation (safely reads 8-35V industrial signals without damaging the board)
- 4x RGB LEDs for status and ambient personality
- Extra input/output pins, analog sensor inputs, real-time clock
- Plug-and-play sensor connectors (Qwiic/STEMMA — hundreds of compatible sensors)

**Considering adding:** motion sensor/accelerometer (~€1-2), vibration motor (~€0.50), GPS (~€5-8).

**Honest Puck (pendant):** Wearable version. Mic with same hardware privacy guarantee, 12-LED ring, 450-day battery standby, USB-C plug.

## Appendix C: .daemon Domain Strategy (DEFERRED)

ICANN (the organization that controls all internet domain names like .com, .org, .dev) opens applications for new domain endings in 2026 — the first time in 14 years. Application window: Apr 30 – Aug 12, 2026.

- Applying for **.daemon** — so every personal AI agent could have an address like `tony.daemon` or `workshop.daemon`
- Application cost: ~€500K
- **DEFERRED** until business has traction. Use daemon.page for now. The domain is a strategic option, not a foundation.

## Appendix D: What Kleo (Character Writer) Needs

1. **One daemon voice bible** — how it talks at month 0 vs month 6. Vocabulary range. When humor, when silence. When it says "I don't know" or "talk to a real person about this."
2. **The settling spectrum** — continuous, not three discrete characters. Voice written for each pole (warm / sharp / precise / still). The AI interpolates between them based on usage patterns.
3. **Three origin stories for marketing** — the mechanic whose daemon monitors his shop, the student whose daemon challenges her thesis, the parent whose daemon watches the baby room. Same product, different daemon voice in each. These are the ads.

## Appendix E: What Character Designer Needs

1. One sigil/mark system — generated per daemon like a fingerprint, no two identical
2. One color system — warm/cool/neutral poles that shift as personality settles
3. LED behavior language — breathing patterns, pulse speeds, state colors for different moods
4. Screen UI — personality expressed through typography and motion, not illustrated faces
5. Onboarding moment — "I'm here. Give me a name." Not a quiz. Not a selection screen.

---

*Sources: 64 synthetic interviews (acknowledged as unvalidated), Daemons deep-dive research doc, MSI hardware sessions (Orange Pi migration, V1 HAT redesign, Kode Dot analysis), Arthur's vision docs, stress test with real API pricing research (Claude, ElevenLabs, Qdrant), MVP architect analysis. 2026-03-27.*
