# Daemon — Positioning v1

> **Status:** locked.
> **Date:** 2026-04-08
> **Pair with:** vision.md (the WHAT). This doc is the PITCH.

## 1. The wedge — sharper than before

### v1 audience: Claude Code power users (developers)

**Why this audience first:**
- Highest acute pain (already daily users hitting "my agent died when I closed my laptop")
- Lowest CAC: ~5 places to reach them (Anthropic Discord, /r/ClaudeAI, HN, /r/LocalLLaMA, a few Twitter circles)
- Strongest demos (devs film themselves; dev demos go viral)
- They overlap with privacy-conscious people, homelabbers, hardware tinkerers — picking devs gets the others for free
- AGPLv3 actually matters here (only audience that reads licenses)
- Reference customers ARE the artifact (a daemon-built workflow on GitHub is worth 10× a testimonial)

**Why NOT the casual prosumer first:**
- They expect a website, not a daemon process
- They need a trust brand we don't have yet
- Conversion path needs polished onboarding + hand-holding
- Won't pay until they see other people happy first

**Why NOT homelab first either:**
- They want fun, not relief
- Lower density than Claude Code communities
- They overlap with devs anyway — devs is a strict superset

### v1.5 audience: privacy-first knowledge workers + homelabbers

Natural extension of v1. Privacy is the closer for v1 devs, the opener for v1.5 audiences.

### v2 audience: casual prosumers

After the wedge produces organic word of mouth.

## 2. The two seductions

The dev pitch and the casual pitch are *different surfaces of the same product*. They share the same install, same protocol, same architecture — but the framing is different.

### Dev seduction (v1 — lead with this)

> Your Claude Code, on every device you own.

You already live in Claude Code. But your agent dies when you close the lid, forgets when you switch machines, and can't touch your phone. Daemon gives Claude Code a persistent memory, a web UI, and a tool bus that reaches every device you own — laptop, desktop, phone, daemon-key — as one continuous session. Bring your own Anthropic key. Your data never touches our servers.

### Casual seduction (v1.5)

> An AI that searches your computer, runs in the background, and pings you when it's done.

Drop the pendant on your desk. Pair it with your phone. Now an AI agent runs while you sleep — checks your email, watches your sensors, runs jobs, builds you tools. Ask it from your phone to find that file you saved last Tuesday. It does. No upload, no chat-bot UI for the simple stuff. Just a thing that works on your real life.

The bridge between them: the vibe coder's primitive set is the same. The dev uses it to build personal automations on top of their existing Claude Code workflow. The casual user gets pre-built primitives (morning briefing, find-my-file, build-me-a-tool) that come out of the box.

## 3. The "so what" — locked

**One sentence:**
> Daemon is the AI agent that runs on your stuff, not in someone's cloud.

**Hero paragraph:**
> Daemon runs a small agent on every device you own — laptop, desktop, phone, the always-on box on your desk. They join one continuous AI agent that has access to your files, your sensors, your shell, your screen. Your conversations and memory live on those devices, never on our servers. Bring your own model API key. Open source, self-hostable, AGPLv3. The same agent, the same memory, on everything you actually use.

**30-second verbal pitch (memorize, end with URL not a question):**
> "You know Claude Code — the terminal thing? I use it every day but it dies when I close my laptop and it can't touch my phone. So I built daemon — same agent, same memory, but it runs as a tiny process on every device I own. I can ask it from my phone to grep a file on my desktop and it just does it. My data never hits a server, the relay only routes messages. Open source, works with any model. It's at daemon.page."

**The pitch is true.** Anchored in the actual technology (per-device daemon, persistent memory, BYOK relay). Legible to a non-technical person ("ask my phone to do something on my laptop"). Picks a category — "Claude Code" — that everyone in the wedge already knows. **Cursor won by being "VSCode + AI." Daemon wins by being "Claude Code + multi-device."**

## 4. Strategic NO list (don't say these in v1)

- **Don't lead with "AI agent."** Crowded category, you lose on polish.
- **Don't lead with "privacy" or "AGPLv3."** Privacy is the closer, not the opener. Signals "not for serious work" to devs even though it's true.
- **Don't mention the daemon-key Pi.** Sounds like a Kickstarter, not a product. Park it.
- **Don't say "personal AI."** Rabbit / Humane / Friend poisoned that brand.
- **Don't say "memory for agents."** That's Letta's lane and it describes mechanism, not pain.
- **Don't show a chat window as the primary screenshot.** Show "phone running command on laptop." That's the unique demo.
- **Don't compete on model quality.** BYOK = model-agnostic, don't get drawn into "smarter than GPT-5."
- **Don't use the word "daemon" in the tagline without context.** Half the audience hears the technical term, the other half hears the demon.
- **Don't sell to enterprises in v1.** Long sales cycles, kills the flywheel.
- **Don't add Telegram integration in v1.** Notifications are owned natively.

## 5. Landing page hero spec

**Headline:** Your Claude Code, on every device you own.

**Subhead:** Daemon runs a small agent on your laptop, desktop, and phone, linked by one persistent memory. Ask from your phone, it runs on your laptop. Close the lid, pick up where you left off. Your API key, your files, your data — never ours.

**Primary CTA:** `curl -sSL daemon.page/install | sh` *(click to copy)*

**Secondary CTA:** Watch the 90-second demo

**Three "what it does" cards** (the headline of each card is a verb, not a noun):

1. **Reaches your stuff.** Files, shell, clipboard, camera, sensors — daemon exposes your device's tools to the agent over a local WebSocket. No cloud sandbox.
2. **Survives your laptop closing.** One memory, every device. Start a task on your desktop, finish from your phone on the train. Same conversation, same context.
3. **Stays on your hardware.** The relay routes messages and nothing else. Open source (AGPLv3), self-hostable, verifiable. Bring your own Anthropic, OpenAI, or local model.

**Three social proof slots:**
1. A real quote from a real Claude Code user, shipping daemon-built workflows
2. GitHub stars counter + AGPLv3 badge
3. "Running on N devices this week" — live counter from the relay

## 6. The 90-second demo

**[0:00 – 0:15] Hook.** Camera on Arthur. "I use Claude Code every day. But here's what breaks me." Cut to laptop screen, mid Claude Code session. Close the laptop lid dramatically. "Gone. The session, the memory, all of it. And if I'm on the train and want to keep going on my phone — forget it."

**[0:15 – 0:30] Reveal.** "This is daemon." Type the install command on a fresh terminal. One line. `curl -sSL daemon.page/install | sh`. Run it. Output: *"daemon running. pair at my.daemon.page/pair/ABC123."* Open the phone, scan QR. Phone now shows the daemon chat.

**[0:30 – 0:60] The wow.** On the *phone*, type: "what's the biggest file in ~/Downloads on my laptop and can you delete it?" Cut to laptop screen — daemon process logs `bash: ls -lhS ~/Downloads | head -3`. Back to phone — output appears, then a confirmation prompt. Tap yes. File gone. Arthur says: "That ran on my laptop. Not on a server. On the actual machine where the file lived."

**[0:60 – 0:75] The privacy beat.** Open a second terminal on the laptop: `lsof -p $(pgrep daemon) | grep -i chat`. Nothing. "My chat history is on this laptop. Not on daemon.page. The relay only sees encrypted routing metadata. Open source, AGPLv3, self-hostable. I don't want your data."

**[0:75 – 0:90] The expansion + close.** Quick montage: daemon on a Raspberry Pi in a closet ("always-on node, no laptop required"), daemon on Android with sensors, daemon on the pendant. "One agent. Every device. One memory." End card: `daemon.page` + GitHub link.

## 7. Wedge-by-wedge messaging

| Audience | Hook | Conversion artifact | Time-to-value |
|---|---|---|---|
| Claude Code daily users | "Your Claude Code, on every device" | 90-second demo | 30 seconds (curl install) |
| Privacy-first KW | "Verifiable: read the code, run a packet capture" | AGPLv3 source + audit doc | 1 day (read + audit) |
| Homelabbers | "Self-hostable AI agent for your homelab" | Docker compose + Pi image | 10 minutes |
| Casual prosumer (v2) | "An AI that knows your files and runs while you sleep" | Pendant + pre-built primitives | 5 minutes (plug pendant in) |

## 8. The five things every demo must show

1. **Install in one line.** Not a sign-up form. A `curl | sh`.
2. **Pair a phone in 30 seconds.** QR scan, no typing.
3. **Phone reaches laptop.** A tool call originates on the phone, executes on the laptop, result returns to the phone.
4. **Memory survives the laptop closing.** Open something, close laptop, ask phone "what did we just do," it remembers.
5. **`lsof` proves no data on the relay.** This is the privacy beat. Show, don't tell.

## 9. Brand and voice

**Voice rules:**
- Direct, technical, no marketing jargon.
- Ship language, not "empower" / "unleash" / "transform."
- "Your stuff" / "your devices" / "your agent" — not "the user's data."
- One verb per sentence. No nested clauses in landing copy.
- Emojis only in the chat product UI itself, never in marketing.

**Tone:**
- Confident, not defensive about privacy. Don't apologize for being open source. Don't justify being self-hostable.
- Specific examples beat abstractions. "Grep a file on your laptop from your phone" beats "tool dispatch primitive."
- Tell the user what daemon is BEFORE you tell them what it isn't.

**Anti-patterns:**
- "Revolutionary." "Unprecedented." "Transform how you work." → cut every time.
- "AI agent platform" / "agentic infrastructure" → "AI agent that does X."
- "Privacy-first" as a tagline → make it a verifiable claim instead.

## 10. The asks bar (what we ask for, when)

| Stage | Ask | Why |
|---|---|---|
| Landing page | Email for waitlist OR `curl install` | Two paths: cautious or eager |
| Installed daemon | Optional sign-in to `my.daemon.page` | Get the multi-device experience |
| Three days in | "Star us on GitHub if this works for you" | Social proof |
| Active user | "Tell us one thing daemon could do that it can't" | Roadmap signal |
| Power user | "Self-host if you care about that" | Zero-trust path for the paranoid |
| Never | "Pay us money" (in v1) | Free and open. Charge later if and when. |

## 11. The 30-day proof points

What we need to be true 30 days from launch:

1. ≥ 100 active daemons running across the user base (relay-side counter, public)
2. ≥ 5 Claude Code users on Twitter/HN saying "this is what I wished Claude Code did"
3. ≥ 1 viral demo clip (>10k views) showing the phone-reaches-laptop flow
4. Zero security incidents that would invalidate the privacy claim
5. The install command works on a fresh Linux/Mac box without a single follow-up step
6. The pendant prototype is on Arthur's bench, soldered, paired, taking commands

If any of those are missing at day 30, the wedge isn't working — pivot the messaging, not the product.

## 12. The three questions every visitor will ask

1. **"Is this safe?"** → "Open source, packet-capture-verifiable. Your data lives on your machines. Read the code."
2. **"How is this different from Claude Code?"** → "Claude Code runs on one machine. Daemon runs on every machine you own, with one shared memory, reachable from any of them."
3. **"Why would I install something instead of using a website?"** → "Because the website can't read your files, run your shell, or talk to your sensors. Daemon does all three by being on your hardware."

Have all three answers in the FAQ. Have all three answers memorized for verbal pitches.

---

**This doc is the source of truth for messaging.** When the product changes, update this doc first, then the website. When the website contradicts this doc, the website is wrong.
