# DAEMONS — Business Model Canvas
### The hardware agent with a soul

*v1 — 2026-03-27*
*Arthur Camara*

---

## THE ONE SENTENCE

A credit-card-sized computer that plugs into anything, understands what it's plugged into, and becomes yours over time.

---

## WHY THIS ISN'T A NORMAL CANVAS

Standard BMC was designed for transactional products. Lean Canvas was designed for software. Daemon is neither. It's a physical AI agent where:

- The **product IS the customer relationship** (the daemon grows with you — there's no separate "CRM")
- The **channel IS the product** (your daemon has a .daemon URL, your daemon tells your mechanic friend about itself)
- The **value proposition shifts per user** without changing the hardware (same device replaces a $800 OBD2 scanner AND a $150 universal remote AND a studio companion)

So this canvas has **three layers**, not nine boxes:

1. **THE BODY** — the hardware, what it physically does, who pays for it
2. **THE BRAIN** — the AI agent, what it figures out, what it replaces
3. **THE SOUL** — the character, what makes you keep it, what makes you name it

Each layer has its own economics, its own customers, and its own risks. The genius of the product is that they ship as one object.

---

## LAYER 1: THE BODY

### What it is
An 85×56mm, 170-component custom PCB on a Radxa Zero 3W (Micro) or ROCK 5B (Pro). Battery-powered. Fits in a pocket.

**Ports & radios:** WiFi, Bluetooth, sub-GHz RF (915MHz), LoRa, NFC, IR blaster, USB parasitic "Stinger" ports (plugs INTO other devices), Ethernet, I2C/SPI sensor headers, industrial isolation (ISO1212, 8-35V), WAGO terminal block.

**I/O:** MEMS microphone (hardware privacy interlock — mic power and LED on same copper trace), Class-D speaker, 1.69" display, 5-way nav switch, 4× RGB LEDs.

### Who buys THE BODY

| Buyer | Why they buy | What they plug it into | Price sensitivity |
|-------|-------------|----------------------|-------------------|
| **Auto mechanic** | Replaces $800 Autel + $500/yr subscription | OBD2 port | Medium — if it works, it pays for itself in a week |
| **Restaurant owner** | Walk-in cooler monitoring, replaces $45/mo service | Temperature sensor | Low — $45/mo is the pain, device is one-time |
| **Network installer** | Replaces $800 Fluke cable tester | Ethernet + PoE | Medium — needs to be trusted |
| **HVAC technician** | Eliminates false-alarm truck rolls ($220 each) | Thermostat wiring, I2C sensors | Low — saves money immediately |
| **Maker / tinkerer** | The I2C/SPI auto-detection is magic | Any sensor | High — competes with $10 Arduino |
| **Smart home person** | Universal remote, baby monitor, garden irrigation | IR, camera, soil sensors | Medium |
| **Solar technician** | Monitor inverter without site visits ($220 each) | RS485/Modbus | Low — ROI obvious |
| **Electrician** | Auto-map panel circuits (saves 2 hours per job) | CT clamps, relay boards | Low — time is money |
| **Developer** | Give their OpenClaw agent a body | USB, everything | Medium — but high engagement |

**Price hypothesis:**
- Daemon Micro: **€149–199** (BOM ~€55–80, margin ~60%)
- Daemon Pro: **€449–599** (BOM ~€215–300, margin ~50%)
- Honest Puck pendant: **€49–79** (BOM ~€15–25, margin ~65%)

### The body's value proposition (one line)
**"Plug it in. It figures out the rest."**

Auto-detects I2C sensors, USB devices, network topology, IR remotes, OBD2 protocols. The AI writes the driver code, configures the software, builds you a dashboard. No Stack Overflow. No pin diagrams. No "which library do I use."

### Hypotheses to test — THE BODY

| # | Hypothesis | How to test | Risk if wrong |
|---|-----------|-------------|---------------|
| B1 | Auto-detection works reliably for 80%+ of common sensors/devices | Ship 50 dev units, track success rate | Core promise breaks |
| B2 | €149–199 is the right price for Micro (not toy-cheap, not investment-expensive) | Van Westendorp price survey with 100 target users | Pricing kills conversion |
| B3 | Professional users trust a €149 device to replace €800+ tools | Field trials with 10 mechanics/technicians | Pro market unreachable |
| B4 | 170-component board can be manufactured at >90% yield | First JLCPCB production run, measure defects | Unit economics collapse |
| B5 | Battery life is acceptable for daily carry (~8hr active) | Thermal + power testing in pocket environment | Product lives in a drawer |

---

## LAYER 2: THE BRAIN

### What it is
An AI agent framework (built on OpenClaw patterns — the most popular open-source AI agent tool, 247K GitHub stars). The daemon's brain can:

- **Code:** Write Python, configure drivers, build dashboards, create apps
- **See:** Understand what's plugged into it (sensor scan, network scan, device detection)
- **Act:** Control IR devices, switch relays, send alerts, log data, talk to APIs
- **Learn:** Remember what worked, what you prefer, what your setup looks like
- **Bridge:** Your daemon is one computer across your phone, laptop, and the device itself — root access everywhere you allow it

### The brain's 19 validated apps

These are the professional use cases where the daemon replaces expensive, single-purpose tools:

| App | Replaces | Savings | Validated by |
|-----|----------|---------|-------------|
| **auto-scan** | Autel OBD2 ($800 + $500/yr) | ~$1,300 year 1 | Derek, Ben |
| **cold-watch** | Monitoring service ($45/mo) | ~$540/yr | Tony |
| **repair-scan** | PC-Doctor ($1,000+) | ~$1,000 | Ben |
| **solar-watch** | Site visits ($220 each) | ~$2,200/yr | Field research |
| **net-trace** | Fluke LinkIQ ($800) | ~$800 | Network pros |
| **factory-logic** | Siemens TIA ($2,500) | ~$2,500 | Industrial research |
| **marine-scan** | 4 laptops + $6,000 tools | ~$6,000 | Marine tech research |
| **vine-watch** | Commercial system ($7,500) | ~$7,500 | Agri research |
| **remote-merge** | Logitech Harmony ($150–350) | ~$250 | Everyone with a TV |
| **circuit-map** | 2 hours of manual tracing per panel | ~$100/job | Electricians |

**The brain's value proposition (one line):**
**"Whatever you can imagine hardware doing, it does. And if it can't, tell it what's missing and it'll tell you what adapter to buy."**

### Revenue from THE BRAIN

The brain is where recurring revenue lives:

| Tier | Price | What you get |
|------|-------|-------------|
| **Free (Pro only)** | €0/mo | Local inference, basic apps, no cloud |
| **Daemon Core** | €7–12/mo | Cloud inference (Micro), app store, memory sync/backup, OTA updates |
| **Daemon Plus** | €15–25/mo | Multi-device sync, priority apps, advanced diagnostics, premium voice |
| **Pro licenses** | Per-app or per-industry | Certified diagnostic suites (auto, HVAC, marine), liability coverage |

**Unit economics (Micro + Core subscription):**
```
Hardware sale:           +€149 (one-time)
BOM + manufacturing:      -€70
Shipping + packaging:     -€15
Hardware margin:          +€64

Monthly subscription:     +€9/mo
Cloud inference:          -€2/mo
TTS API:                  -€1/mo
Net subscription margin:  +€6/mo

24-month LTV: €64 + (€6 × 24) = €208
Target CAC: <€50 (crowdfunding = near-zero)
```

### Hypotheses to test — THE BRAIN

| # | Hypothesis | How to test | Risk if wrong |
|---|-----------|-------------|---------------|
| R1 | People will pay subscription on top of hardware | Crowdfunding tiers that reveal subscription willingness | Revenue model collapses |
| R2 | Cloud inference stays <€2/user/month at 30min/day usage | Monitor API costs in beta | Subscription is unprofitable |
| R3 | The AI agent can reliably write driver code for unknown sensors | Ship 50 dev units with diverse sensors, measure success | "Plug and play" breaks |
| R4 | App store / marketplace generates community-built apps | Launch SDK, measure developer adoption in first 90 days | Platform play fails |
| R5 | Professional users pay premium for certified diagnostic apps | Offer auto-scan at €29/mo to 20 mechanics, measure retention | Pro tier doesn't work |

---

## LAYER 3: THE SOUL

### What it is
Not a chatbot personality. Not a Pokémon avatar. **The soul is the voice.**

It's the difference between:
- `TEMPERATURE ALERT: 12°C` and `"Walk-in cooler: 12°C and rising. Compressor might be failing — I've seen this pattern before."`
- `BME280 detected on 0x76` and `"Found a temperature sensor on your I2C bus. Setting it up now. It's 23.4°C in here."`
- `ERROR: WiFi connection failed` and `"Can't reach your WiFi. Tried three times. Want me to try the backup network or just wait?"`

Same data. Different relationship with the data.

### One daemon. No archetype selection. Three settling directions.

Your friend was right. You don't need three starter Pokémon. You need one daemon that drifts.

**Onboarding:** You plug it in. It wakes up. It says "I'm here. Give me a name." You name it. Done. No quiz. No ceremony. No taxonomy to explain.

**The settling spectrum:**

```
        WARM ←————————— neutral ——————————→ SHARP
                           |
                           |
                         STILL
```

The daemon starts **neutral-competent** — it has to earn trust through capability before it earns the right to have opinions. Over weeks, based on how you interact:

- If you respond to warmth → it drifts **warm** (asks how you're doing, remembers your dog's name, phrases alerts gently)
- If you respond to challenge → it drifts **sharp** (pushes back on your ideas, catches your mistakes, uses dry humor)
- If you respond to silence → it drifts **still** (speaks less, notices more, when it talks it lands)

These aren't modes you select. They're tendencies that emerge. After 6 months, no two daemons feel the same.

### Where the character shows up

| Surface | How | Example |
|---------|-----|---------|
| **Notifications** | Phrasing, tone, urgency calibration | Warm: "Your garden's thirsty" / Sharp: "Soil at 23%, you're killing the basil" / Still: "Garden. Water." |
| **LED behavior** | Breathing pattern, color palette, pulse speed | Unique to your daemon after settling — like a fingerprint |
| **Voice** | TTS voice profile, speech rhythm, vocabulary | Warm: softer, longer / Sharp: quicker, drier / Still: sparse, precise |
| **Error handling** | Problem-solving style | Warm: "Let me try something else" / Sharp: "That won't work, here's why" / Still: *tries three things silently, reports result* |
| **Status screen** | Typography, layout density, animation | Not an avatar — data presentation with personality |
| **How it logs** | What it writes in your existing spreadsheet | Sharp: adds a column for notes, writes "compressor sounded rough today" |

### Where the character does NOT show up
- No illustrated avatar on the 1.69" screen. That screen is for dashboards, temperatures, sensor data, status.
- No "choose your daemon" ceremony. You just name it.
- No archetype taxonomy visible to the user. The settling is invisible — it just happens.
- No character-themed marketing for professional users. The mechanic sees "diagnose your car." The character is in how it talks, not how it looks.

### The visual identity
One mark. Generated per daemon, like a fingerprint. A sigil — geometric, minimal, unique. Not a face. Not an animal. Something you'd recognize as yours across a room. Appears as a small status indicator on the screen, on your .daemon.page, on your phone notification.

Three **colorways** for the hardware enclosure:
- **Amber** (warm territory)
- **Violet** (sharp territory)
- **Cyan** (still territory)

Cosmetic only. Any daemon can settle any direction regardless of shell color.

### The .daemon.page domain
Every daemon gets `{name}.daemon.page`. This is:
- Your dashboard (access from any browser)
- Your daemon's home (other people can see what you share)
- Your notification center (phone alerts link here)
- Your data (logs, sensor history, app configs — YOU own this)

If the .daemon gTLD succeeds (ICANN 2026, ~€500K application): `{name}.daemon` — owning the namespace for every personal AI agent in the world.

### Hypotheses to test — THE SOUL

| # | Hypothesis | How to test | Risk if wrong |
|---|-----------|-------------|---------------|
| S1 | Physical embodiment meaningfully changes the relationship vs. same AI in an app | Give 50 people the app, 50 people the device, measure attachment at day 30 | Hardware is unnecessary |
| S2 | Settling creates measurable retention lift vs. static personality | A/B test settling vs. fixed personality, measure churn at month 3 | Core differentiator is placebo |
| S3 | People name their daemon without being asked twice | Track onboarding — do they skip the naming step? | Bonding moment doesn't land |
| S4 | "Optimized for relationship quality, not satisfaction" is a selling point | A/B test "honest daemon" vs. "pleasing daemon," measure 30-day retention | Users churn from friction |
| S5 | Professional users value the voice/personality even when buying for capability | Interview 20 mechanics/technicians after 30 days — does the personality matter? | Soul is irrelevant for pro market |

---

## CHANNELS — HOW PEOPLE FIND IT

### The two marketing languages

**For developers / makers / OpenClaw community:**
> "Give your AI agent a body. Local. Open source. Yours."

**For professionals / consumers:**
> "Plug it in. It figures out the rest."

Never: "Meet your AI companion." The word "companion" kills the professional market. The soul is experienced, not marketed.

### Pre-launch
| Channel | Content | Audience |
|---------|---------|----------|
| **Build log** (YouTube/X/blog) | 170-component PCB, SKiDL + 164 CI tests, the inductor that would have exploded | Makers, HN, engineering Twitter |
| **Use case demos** | "I plugged my daemon into my car" / "My daemon controls my whole house now" | Professional + consumer |
| **The privacy story** | "Mic power and LED are the same copper trace. Physics, not software." | Privacy advocates, media |
| **OpenClaw integration** | "Your Claw agent now has a body" | 247K-star community |

### Launch
| Channel | Why |
|---------|-----|
| **Crowdfunding (Kickstarter)** | Textbook fit — novel hardware, strong narrative, solo builder. Target: 500+ units. |
| **Direct (daemon.page store)** | Own the customer relationship. Archetype quiz → colorway selection → name your daemon. |
| **Developer early access** | Ship dev kits first. Let community build apps. Their content = your marketing. |

### Growth
| Channel | Why |
|---------|-----|
| **Daemon-to-daemon** | Sub-GHz RF means daemons detect each other. Two owners in the same room = conversation starter. Viral hardware. |
| **Word of mouth** | "What's that thing?" / "It's my daemon, I call it [name]." — The naming creates stories people tell. |
| **App marketplace** | Community-built apps (auto-scan, cold-watch) bring new verticals. Each app is a new acquisition channel. |
| **.daemon.page profiles** | Shareable dashboards. "Check out what my daemon monitors." |

---

## KEY PARTNERSHIPS

| Partner | Why critical | Risk |
|---------|------------|------|
| **Anthropic / local model providers** | The daemon's intelligence. API cost + quality = existential. | Price hike or model degradation kills Micro tier |
| **TTS provider (ElevenLabs/Cartesia)** | Voice IS the soul. Bad voice = dead character. | Single vendor dependency |
| **Radxa** (SBC) | The compute platform. Availability + long-term support. | Discontinuation |
| **JLCPCB** (PCB manufacturer) | 170-component board at scale. Quality + yield. | Geopolitical risk, quality variance |
| **OpenClaw community** | 247K developers. They build the app ecosystem. | Community moves on |
| **Hailo** (NPU for Pro) | Local inference on Pro. | Supply, driver support |
| **Industrial designer** | The daemon must be beautiful. A Pi in a case won't sell at €149. | Finding someone who gets "daemon as living object" |
| **Kleo** (character writer) | Voice bible, settling spectrum writing, boundary design | Creative alignment |
| **ICANN** (for .daemon TLD) | €500K bet on owning the namespace | Application may fail |

---

## KEY RESOURCES

| Resource | Status | Gap |
|----------|--------|-----|
| PCB design (SKiDL, 164 tests, golden netlist) | **Done** | Production validation |
| AI agent framework | **Partially built** (Arturito platform) | Needs hardware-specific agent |
| Character voice bible | **Not started** | Need Kleo + this canvas |
| Enclosure design | **Not started** | Need industrial designer |
| Manufacturing relationship | **JLCPCB tested** | Scale production untested |
| .daemon TLD application | **Researched** | Needs €500K + legal |
| Company (SRL) | **Not formed** | Partita IVA exists, SRL for Daemon pending |
| Funding | **Pre-seed** | Need crowdfunding or angel for first run |

---

## COST STRUCTURE

### Upfront (to get to crowdfunding)
| Item | Cost |
|------|------|
| Enclosure design + mold tooling | €10–30K |
| First production run (100 units) | €8–15K |
| Crowdfunding campaign (video, assets) | €5–10K |
| Company formation (SRL) | €2–5K |
| **Total to launch** | **€25–60K** |
| .daemon TLD application (optional, strategic) | +€500K |

### Per-unit variable
| | Micro | Pro |
|---|------|-----|
| BOM + PCB | €35–45 | €140–180 |
| SBC (Radxa) | €15–25 | €60–80 |
| NPU | — | €40–60 |
| Enclosure | €5–10 | €10–20 |
| Assembly | €5–10 | €10–15 |
| Packaging + shipping | €10–20 | €15–25 |
| **Total** | **€70–110** | **€275–380** |

### Monthly operating (at 1,000 active users)
| Item | Cost |
|------|------|
| Cloud inference (Micro users) | €1,500–3,000 |
| TTS API | €500–1,500 |
| Infrastructure (Qdrant, servers, OTA) | €300–800 |
| Arthur (living costs, Paris) | €2,500–3,000 |
| **Total** | **€5,000–8,500** |

---

## THE CRITICAL PATH — WHAT TO TEST FIRST

Ordered by "if this is wrong, nothing else matters":

### 1. Does physical embodiment matter?
Build the AI agent as a voice app first. Give 50 people the app for 30 days. Then give 50 people the device. If attachment and retention aren't meaningfully different, the hardware business doesn't exist.

### 2. Does plug-and-play actually work?
Ship 50 dev units with diverse sensors and devices. Track: what percentage auto-detects and configures correctly without human intervention? If <70%, the core promise is broken.

### 3. Will people pay subscription on top of hardware?
Design crowdfunding tiers that reveal subscription willingness. If people only want the hardware and reject recurring fees, the Micro unit economics don't work. (Pro works without subscription — local inference.)

### 4. Does the settling create retention?
A/B test a settling daemon vs. a static daemon. Measure churn at month 3. If settling doesn't measurably reduce churn, it's a nice idea that doesn't matter commercially.

### 5. Do professionals trust a €149 device?
Field trial with 10 mechanics / technicians / installers. If they say "this is cool but I'd never trust it on a real job," the pro market needs a different approach (certification, partnerships, higher price point).

---

## POSITIONING

### vs. Flipper Zero
Flipper is a toy with antennas. Daemon is a computer with a soul. Flipper's novelty wears off after a week (validated by user reviews). Daemon gets more useful the longer you have it because the AI learns your setup.

### vs. Kode.diy
Kode is "Arduino without the hassle" — a better screwdriver. Daemon is "the machinist who brought their own tools." Kode needs you to know what you want to build. Daemon figures out what to build by understanding what's plugged into it.

### vs. Rabbit R1 / Humane Pin
Both dead. Closed ecosystems, software didn't work, no real capability. Daemon is open source, the AI actually does things (writes code, controls hardware), and you own everything.

### vs. Character.ai / Replika
No agency, no hardware, no ownership. "Renting the relationship, and the landlord can trash the apartment." Daemon: you own the infrastructure, the memory, the domain. Nobody can lobotomize your daemon.

### vs. Home Assistant
Requires a PhD to maintain. No personality. No auto-detection. Daemon is Home Assistant that sets itself up and talks to you while doing it.

### THE ONE-LINE POSITIONING
**"The computer that understands every other computer."**

---

## THE NORTH STAR

> After 6 months, a mechanic describes their daemon the way they'd describe a good apprentice — by name, with specificity, with trust, and with the unshakable sense that this thing knows their shop.

> People buy the hardware for the capability. They keep it for the character. They name it because it earned a name.

---

*Built from: 64 synthetic interviews, daemons_vision.docx, ARCHITECTURE.md (1078 lines, ECO #2026-03-GOLD), BOM.md (170 components), daemons-deep-dive.md, .daemon TLD strategy, sigil conversation (274aa851), and the "where will people see this character" question that broke the old framing.*
