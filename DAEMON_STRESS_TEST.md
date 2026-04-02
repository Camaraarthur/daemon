# Daemon — Stress Test & MVP Plan
*2026-03-27 — Ruthless critique + concrete build plan*

---

## The Brutal Truth

**6 out of 10 issues are CRITICAL. The biggest one: no software exists.**

The daemon is a beautiful PCB design (160 components, 164 CI tests, aerospace discipline) attached to two business model documents written today. The ratio of documentation to working software is infinite. There is no prototype. Nobody outside Arthur has used a daemon. The "64 validated interviews" are AI-generated personas, not real humans.

The vision is strong. The engineering is strong. But right now this is a business plan looking for a product, not a product looking for customers.

---

## Issue 1: Unit Economics Are Wrong (CRITICAL)

The canvas says €3/user/month for AI processing + voice. Real numbers:

**AI processing costs (Claude API, per user per month):**

| User type | Daily usage | Real monthly cost |
|-----------|------------|------------------|
| Light (5 min/day) | 3 short conversations | €5-11 |
| Medium (30 min/day) | 10 conversations with tool use | €20-48 |
| Heavy (2 hr/day) | 30 conversations, code writing, hardware control | €100+ |
| Professional (always-on monitoring) | Background alerts + 5 sessions | €50-70 |

Why so high: A daemon isn't a chatbot. Every interaction loads a system prompt (2,000-4,000 tokens), conversation history, personality state, AND tool definitions for SSH/code/sensors. A single "diagnose my car" request might take 5-15 tool calls. Each tool round-trip costs tokens in both directions.

With aggressive caching (90% cache hit on system prompt): light user drops to €2-3/month, medium to €8-12/month. But caching requires engineering work.

**Voice costs (text-to-speech):**
- ElevenLabs at scale: ~€0.18 per 1,000 characters
- 20 spoken responses/day (medium user): ~€22/month
- Cheaper providers (Cartesia, local Piper): €5-10/month
- The canvas said €1/month — that's 27 sentences per month total, less than one per day

**Corrected unit economics:**

| | Canvas estimate | Realistic (light) | Realistic (medium) |
|---|---|---|---|
| AI processing | €2/mo | €3-6/mo | €10-28/mo |
| Voice | €1/mo | €2-5/mo | €10-20/mo |
| Memory database | included | €0.20/mo | €0.20/mo |
| **Total cost** | **€3/mo** | **€5-11/mo** | **€20-48/mo** |

**At €9/month subscription, you LOSE money on every medium user.**

**Fix:** Price subscription at €15-20/month minimum. Use Haiku for routine tasks, Sonnet/Opus only for complex ones. Consider metered pricing (included quota + overage). Or: make the free tier text-only and charge for voice separately.

---

## Issue 2: The Open Source Trap (HIGH)

The canvas offers bring-your-own-key as free tier AND the platform is open source. A technical user gets:
- Full daemon personality + settling (it's open source code)
- Their own memory (local database, trivially self-hosted)
- SSH mesh (just SSH config + agent code)
- Voice (their own ElevenLabs key or free local voice like Piper)

What do they lose by NOT subscribing? Basically nothing essential. A .daemon.page domain. Memory backup. That's it.

**The Home Assistant precedent:** Fully open source, charges $5/month for remote access. Conversion to paid: ~5-10%. They survive because they have MILLIONS of users. At 1,000 users with 10% conversion at €9/month = €900/month. That doesn't cover rent in Paris.

**Fix:** Don't make the personality engine fully open source on day one. Open source the hardware drivers, device interface layer, and basic agent framework. Keep settling dynamics, personality engine, and voice as paid cloud features. This is the "open core" model that actually works (Grafana, GitLab, etc.).

---

## Issue 3: No Software Exists (CRITICAL)

The /home/arthur/daemon/ repository contains:
- KiCad PCB files (7+ board iterations)
- SKiDL Python netlists
- Layout scripts, simulation scripts
- BOM documentation, 3D models

It does NOT contain:
- Zero lines of daemon agent software
- Zero personality engine code
- Zero settling algorithm
- Zero voice integration
- Zero SSH mesh
- Zero phone/web app
- Zero prototype of any kind

The "launch software NOW" plan was written today. The software doesn't exist.

**Fix:** See MVP plan below.

---

## Issue 4: Settling Isn't Proven (HIGH)

The retention thesis rests on "settling creates emotional switching costs." But:

- How is it different from ChatGPT's memory feature? (Both remember facts about you)
- How is it different from Replika? (Both adapt tone over time)
- Can you FEEL settling? It's designed to be gradual over weeks/months — by definition imperceptible day-to-day
- What if pros DON'T WANT personality drift? A mechanic with 20 years experience doesn't want condescension from "Sharp" mode

**The honest difference:** ownership + naming + physical embodiment. The settling itself is a system prompt adjustment based on conversation analysis. Technically straightforward. Not a moat.

**Fix:** Stop treating settling as THE moat. The real retention drivers are:
- For professionals: DATA ACCUMULATION (the daemon knows your shop, your vehicles, your history)
- For companions: NAME + RELATIONSHIP (Replika proved this)
- Settling is a nice touch, not a foundation

---

## Issue 5: Professional Apps Are Fantasy (CRITICAL)

Zero of the 19 apps have been built. Zero tested with real users. "Validated" means AI personas said yes.

**Reality checks on the top claims:**

**auto-scan "replaces €800 Autel scanner":**
- An Autel has proprietary databases covering thousands of vehicle-specific codes, bidirectional control, key programming, ECU coding
- A daemon reading OBD2 gets generic codes (P0xxx) only
- Manufacturer-specific codes require proprietary databases licensed from OEMs
- **The daemon replaces a €30 Bluetooth OBD2 dongle, not an €800 Autel.** Claim is off by 25x.

**net-trace "replaces €800 Fluke LinkIQ":**
- A Fluke does physical layer testing: cable length, wire map, distance to fault
- That requires TDR hardware. Software cannot measure cable length.
- **The daemon cannot replace the physical layer testing that makes a Fluke worth €800.**

**factory-logic "replaces €2,500 Siemens TIA":**
- Siemens TIA does deterministic real-time control for safety-critical applications
- An AI agent on Linux cannot provide this
- **Fantasy. No factory will replace safety-certified PLC software with an AI agent.**

**cold-watch "replaces €45/month monitoring":**
- Actually plausible. Temperature monitoring + alerts is simple.
- But needs HACCP compliance logging for health inspections.
- **Buildable with caveats.**

**Liability:** If auto-scan misdiagnoses a car and the mechanic misses a safety issue, who is liable?

**Fix:** Stop claiming 19 validated apps. Pick 2-3 simple ones (cold-watch, remote-merge, sensor-scan) where liability is minimal. Build those. Get 5 real users on each. THEN talk about validation.

---

## Issue 6: Big Tech Will Eat the Consumer Market (HIGH)

- **Apple WWDC June 2026:** Siri 2.0 with multi-step agent capabilities, on-device processing, deep integration across all Apple devices. They already have the device mesh (Handoff, Universal Control). They already have a billion devices.
- **OpenAI hardware (H2 2026):** Smart speaker or earbuds targeting 40-50 million units year one
- **Anthropic:** Claude Code already does SSH, code writing, tool use, and memory. Adding personality would take them weeks.

**Fix:** Accept that Apple/Google/OpenAI will dominate consumer AI agents within 18 months. Double down on the professional/industrial niche where big tech will not go. The mechanic, the HVAC tech, the network installer — that's defensible territory. But only if you actually build working professional tools.

---

## Issue 7: Kickstarter Risks (HIGH)

- 160-component board from a solo founder with no manufacturing engineer
- No enclosure design exists (tooling = 3-5 months)
- Mid-migration from Radxa to Orange Pi (PCB needs rework)
- CE/FCC certification: €5,000-15,000 and 4-8 weeks
- Global shipping from an Italian freelancer (customs, VAT, WEEE compliance)
- No actual JLCPCB quote obtained

**Fix:** Do NOT launch Kickstarter until: (a) working software with paying users, (b) fully quoted BOM, (c) enclosure design, (d) CE/FCC pre-compliance, (e) a manufacturing advisor.

---

## Issue 8: Solo Founder Doing 5+ Jobs (CRITICAL)

The canvas requires 15-25 person-months across 7+ skillsets before Kickstarter. Arthur is one person.

**What Arthur MUST do himself:** Vision, product decisions, core settling algorithm, hardware architecture, first 10 user relationships.

**What to DEFER:** Mobile app (CLI + web first), CE/FCC (test house), manufacturing.

**What to DELEGATE:** Enclosure design, voice bible (Kleo), legal.

**What to KILL:** .daemon TLD for now (€500K is absurd for pre-revenue). 16 of the 19 professional apps. Multi-device mesh for v1.

---

# THE MVP PLAN

## MVP 1: The 2-Week Demo (Arthur-only)

**What it is:** A CLI + web app where Arthur has a persistent AI agent that remembers everything, develops opinions, and works across his phone and laptop.

**What it DOES:**
1. Persistent memory conversation. Talk on day 1, reference it unprompted on day 7 because it's relevant.
2. Visible settling. Starts generic. Over 2 weeks: communication style shifts, opinions form, preferences develop. A "personality page" shows traits drifting on a radar chart.
3. Cross-device continuity. Start a task on laptop, pick up phone, daemon says "I finished that thing — want to see?" Agent state syncs, not just chat history. It kept working when you closed the tab.

**The WOW moment:** Arthur is on his phone and says "what happened with that deployment?" and the daemon replies with specifics from a laptop session 3 hours ago — including things it did autonomously in the background after Arthur closed the laptop.

**Tech stack (reuse existing code):**
- Backend: Express/TypeScript (reuse from Arturito/Mirror)
- Agent: Claude Agent SDK (already integrated)
- Frontend: Next.js PWA (reuse patterns from Arturito)
- Memory: SQLite + structured personality state JSON
- WebSocket for cross-device sync (already built)

**What NOT to build:** No user accounts (Arthur-only). No hardware. No voice. No multi-agent. No onboarding. No landing page.

**Settling v1:** After every 20 messages, Claude reads full history and updates a personality JSON with ~15 traits on a spectrum. Dead simple. The magic is in the effect, not the mechanism.

**Success:** Arthur uses it as his primary AI for 14 days. Can show a 60-second recording where it does something no existing AI does. At least 3 moments where settling produces genuinely better responses.

---

## MVP 2: The 2-Month Beta (50-100 users)

**Onboarding:**
1. Sign up with email
2. "Meet your daemon" — 5-minute conversation (not a form) where daemon asks about you. Intentionally generic at this stage so contrast with week 4 is visceral.
3. Install PWA on phone
4. Connect one integration (GitHub or Calendar or Notion) for ambient context
5. Start using it. No tutorial.

**Features IN:**
- Persistent memory, settling with weekly digest ("I've gotten more direct with you. I skip caveats now. Is that right?")
- Cross-device sync (browser + phone PWA)
- Background tasks ("look into X and tell me when I'm back")
- One integration for ambient context
- Bring-your-own-key option for power users
- Personality page (trait radar, memory highlights)
- Full data export anytime

**Features OUT:** Voice, hardware, multiple integrations, team features, native mobile app.

**Measuring settling:**
- Retention should INCREASE from week 2 to week 6 (opposite of normal decay)
- Session length should DECREASE (daemon gets more efficient)
- At week 6, offer "reset to factory" — if >80% refuse, settling works

**Measuring willingness to pay:**
- Week 4: show banner "Plans start at €20/mo. Lock in €12/mo early access." Track clicks.
- Week 6: gate background tasks behind €5/month. See who pays.
- Exit survey for churned users.

**The "aha moment":** You open the app and the daemon says "I saw that PR got merged. Based on what you told me about the release timeline, you probably want to update the changelog before Friday. Want me to draft it?" You didn't ask. It connected dots. That's when you can't go back.

**Success:** 30+ daily actives by week 4. Week 6 retention > week 2. >60% refuse reset. >15% convert on €5/month gate. >25% click on early pricing.

---

## MVP 3: The Kickstarter Prototype

**What must work on camera:**
1. Software daemon running on phone and laptop, showing real settling from beta
2. Physical key (Orange Pi 3B in 3D-printed enclosure) plugged in, LED showing "alive"
3. One physical interaction: Arthur walks in, key's LED changes (BLE from phone), daemon speaks through speaker: "Welcome back. That email came in while you were out. Summarize?"
4. Offline demo: WiFi turned off on camera. Asks daemon something. It responds locally.

**What can be faked:** Final enclosure (3D print is fine). Multi-key mesh (described, not shown). Full offline capability (aspirational). Battery life (just specs).

**Kickstarter tiers:**
| Tier | Price | What |
|------|-------|------|
| Settler | $15 | Software (1 year Pro) + contributors wall |
| Keeper | $89 | One Daemon Key + lifetime software |
| Pair | $159 | Two Keys (home + office mesh) + lifetime software |
| Builder | $249 | Key + dev kit (exposed GPIO, docs, schematics) + lifetime |
| Founder | $499 | Everything + 1hr call with Arthur + name in boot sequence |

If software tier outsells hardware 10:1 — that's a signal. If hardware outsells — different signal.

---

## The Viral Clip (30 seconds, 100K+ views)

**Split screen. Left: ChatGPT. Right: Daemon.**

Same prompt typed into both: "Hey, can you help me with that thing from last week?"

ChatGPT: "I'd be happy to help! Could you provide more details? I don't have access to previous conversations."

Daemon: "The authentication bug in the payments module? I looked into it more after we talked Thursday. The issue is the webhook handler — it's not validating the signature before parsing. I drafted a fix. Want me to open the PR?"

Hard cut to black. Text: **"Your AI should know you."**

---

## The Critical Path

| Week | What ships | What you learn |
|------|-----------|---------------|
| 1-2 | CLI daemon, Arthur-only | Does settling feel real? |
| 3-4 | Record viral clips, post to Twitter/HN | Is there organic demand? |
| 5-6 | Beta launch, 50-100 users | Do strangers retain? |
| 7-12 | Beta runs, measure everything | Willingness to pay, settling validation |
| 13-16 | Physical prototype, film Kickstarter video | — |
| 17 | Kickstarter with real beta data | Does hardware add value? |

**The one rule: Do NOT touch hardware until software proves settling creates retention.**

---

*Generated from stress test by ruthless startup critic + MVP architect, 2026-03-27.*
