# Daemon Demo Strategy
*For incubator presentation. April 2026.*

---

## The Insight That Sells This

Rabbit R1 and Humane AI Pin both failed for the same reason: they asked people to carry a new device that did less than their phone. Every reviewer said the same thing: "Why not just use your phone?"

Daemon's answer: **exactly. Use your phone. Use your laptop. Use your server. Use everything you already own. The daemon is the mind that connects them.**

This is not a new device. This is a new kind of software — one that treats all your devices as one body.

---

## The 30-Second Elevator Pitch (5 Versions)

**1. Technical** — "Daemon is a persistent AI agent that turns all your devices into one computer. Your phone's camera becomes its eyes, your laptop becomes its hands, your server becomes its memory. It grows a personality from how you use it."

**2. Emotional** — "What if your AI actually knew you? Not because you told it, but because it watched you work, learned your patterns, and settled into a personality that reflects who you are — like the daemons in Philip Pullman's novels."

**3. Practical** — "I say 'what's in front of me' and my phone takes a photo. I say 'put this on my public page' and it's live. I say 'check my laptop' and it screenshots my desktop and tells me what's happening. One AI, every device, no switching."

**4. Philosophical** — "We have a dozen smart devices and not one of them knows the others exist. Daemon is the missing mind — a single intelligence that sees through all your sensors, acts through all your screens, and remembers everything."

**5. Fear/Urgency** — "Apple, Google, and OpenAI are all racing to own the AI layer of your life. But their agent will serve their interests, not yours. Daemon is the open alternative — your agent, on your devices, under your control."

**USE VERSION 4 FOR THE DEMO.** It's the one that makes people lean forward. Open with it, then prove it.

---

## The 3-Minute Demo Script

### Setup (before you start)
- Phone (Pixel) in hand, connected to daemon via WebSocket
- ESP32 with distance sensor on the table, display showing daemon eye
- Laptop (MSI) open, logged into something visible (code editor, email, whatever)
- arthur.daemon.page open on the presentation screen
- Chat window open on your phone

### Beat 1: The Hook (0:00 - 0:20)

**Say:** "We have a dozen smart devices and not one of them knows the others exist. I want to show you what happens when one mind controls all of them."

**Do:** Hold up the phone. Point at the laptop. Point at the ESP32 on the table.

"This phone, that laptop, this little microcontroller — right now, they all share one brain."

### Beat 2: The Public Page — It's Alive (0:20 - 0:45)

**Say:** "Every daemon has a public page. This is mine."

**Do:** Show arthur.daemon.page on the projector. The blobby custom font renders the name. The letters blink — some have eyes, some don't.

"Those eyes aren't random. They evolved from my conversations. The daemon has a personality engine — it settles over time, like a Pullman daemon, based on how I actually interact with it."

**Action:** Wave your hand in front of the ESP32 distance sensor. The sensor data appears LIVE on the public page — the canvas activates, showing a real-time distance graph.

"That graph is live. The sensor on this table is streaming through my phone to this page right now. Anyone in the world can see it."

### Beat 3: The "Holy Shit" Moment — Cross-Device Intelligence (0:45 - 1:30)

**Say:** "Let me show you what cross-device actually means."

**Do (on phone chat):** Type or speak: "What's on my laptop screen right now?"

**What happens:** The daemon SSHs into the MSI laptop, takes a screenshot, analyzes it with vision, and responds: "Your laptop is showing VS Code with the daemon server code open. The file personality.py is active. Terminal has 3 tabs open..."

**Say (while it processes):** "It just reached into my laptop over the network, took a screenshot, and told me what's happening. I didn't install a special app. It uses SSH — the same way sysadmins have managed servers for 40 years."

**Then (on phone chat):** "Now send a notification to my phone saying 'demo going well'"

**What happens:** The phone buzzes in your hand. Show the notification to the audience.

"It can also go the other direction. The laptop can trigger my phone. The phone can control the ESP32. Everything talks to everything."

### Beat 4: Knowledge and Memory (1:30 - 2:00)

**Say:** "But the real difference isn't the tools. It's that it remembers."

**Do (on phone chat):** "What do you know about my hardware projects?"

**What happens:** The daemon queries its knowledge graph (50+ entries in Qdrant) and responds with structured knowledge about the daemon PCB, the ESP32 setup, the harpejji project — real things Arthur actually works on.

"That's not a search result. That's its memory. It extracted and stored structured knowledge from every conversation we've had. Entities, relationships, events, preferences. A real knowledge graph."

**Do (on phone chat):** "What's my personality like in your eyes?"

**What happens:** The daemon reflects on its personality traits and the patterns it has observed. It knows Arthur is direct, iterates fast, cares about hardware, works late.

### Beat 5: The Close — What This Means (2:00 - 2:45)

**Say:** "Here's what we just did in two minutes. I used my voice, my phone, my laptop, a microcontroller, and a public web page — and I never switched apps. One conversation controlled everything."

"Rabbit R1 failed because it was a new device that did less. Humane failed because it replaced your phone badly. We don't replace anything. We connect everything."

"The software daemon is live today. The hardware key" — hold up the ESP32 — "adds senses your phone can't have: infrared, LoRa radio, NFC, industrial protocols. It's the upgrade, not the product."

### Beat 6: The Ask (2:45 - 3:00)

**Say:** "Every daemon has a name, a personality, and a public page. The subscription is 15 to 20 euros a month or bring your own API key. We launch the waitlist in [X weeks]. The Kickstarter for the hardware follows once we have 1000 active daemons."

"The question isn't whether AI will run your devices. It's whether that AI will be yours, or Apple's."

---

## Killer Feature Ideas (Ranked by Wow x Feasibility)

### Tier 1: Works Today or Within Days

1. **"What's on my laptop screen?"** — SSH screenshot + vision analysis. ALREADY WORKS via ssh_run + screenshot tools. This is the demo centerpiece.

2. **"What's in front of me?"** — Phone camera capture + vision description + optional TTS. The take_photo command exists in MCP tools. Needs camera permission debugging to finish.

3. **Live sensor streaming to public page** — ALREADY WORKS. Distance sensor on ESP32 streams through phone to arthur.daemon.page canvas.

4. **Cross-device notifications** — Send notification from daemon to phone. The send_notification command exists. Simple, visceral.

5. **"Read me my last email"** — SSH to laptop, parse email client or use API. Feasible with existing SSH tools.

6. **"Where's my phone?"** — get_location MCP command returns GPS. Show it on a map on the public page.

7. **Voice-to-action** — Deepgram mic already on web chat. Say something, daemon does it across devices.

### Tier 2: 1-2 Weeks of Work

8. **"Monitor my apartment"** — Phone camera takes periodic photos, daemon analyzes changes, alerts on motion. Uses existing take_photo + a cron loop.

9. **"Put my heartbeat on my page"** — Android sensor API can read heart rate from Pixel watch via Health Connect. Stream it like the distance sensor.

10. **"Lock everything down"** — Remote screen lock on phone (Android Device Admin), lock laptop (ssh msi "rundll32 user32.dll,LockWorkStation"), ESP32 display goes red. Panic mode.

11. **"Debug this error"** — Screenshot laptop, OCR the error, search docs, suggest fix. Chain of existing capabilities.

12. **"Learn my schedule"** — Google Calendar API integration + contextual reminders based on location/time patterns.

13. **Daemon-to-daemon messaging** — Two users' daemons can talk to each other via their public pages. Social protocol.

14. **"What changed since I left?"** — Daemon compares current state of all devices to last known state. "Your laptop downloaded 3 updates. Your phone battery is at 12%. The ESP32 detected motion at 3am."

### Tier 3: Impressive but Needs More Work

15. **"Order me a coffee"** — Integration with delivery APIs. Daemon knows your usual order from preferences.

16. **Live camera feed on public page** — Continuous streaming from phone camera to name.daemon.page. Privacy-gated.

17. **"Translate what they're saying"** — Real-time mic capture, Deepgram transcription, translation, whispered back via earbuds.

18. **ESP32 as universal remote** — IR blaster controls TV/AC. "Daemon, turn on the AC" from anywhere in the world.

19. **"Find my keys"** — Bluetooth scan from phone, triangulate BLE tags.

20. **Collaborative daemon canvas** — Multiple people viewing name.daemon.page see the same live canvas. The daemon can draw, annotate, stream.

21. **"Teach me about this"** — Point camera at anything (plant, circuit board, building), daemon identifies it and teaches you, storing the knowledge for later.

22. **Daemon journal** — The daemon writes a daily summary of what it observed, learned, and did. Visible on the public page (privacy-gated).

23. **"Back up my photos"** — Daemon SSHs to phone, rsyncs photos to server, indexes them semantically.

24. **Wake word on ESP32** — Always-listening keyword detection on the microcontroller. "Hey daemon" triggers without phone.

25. **Cross-device clipboard** — Copy on laptop, paste on phone. Daemon mediates via SSH + notification.

26. **"What's that sound?"** — Mic capture + audio classification. "That's a fire alarm" or "That's your washing machine finishing."

27. **Geofenced actions** — "When I leave the office, check if the server is still running." Location triggers device commands.

---

## The Public Page (name.daemon.page) — Strategy

### What It Is Now
- Custom blobby font with animated blinking eyes
- Live canvas that activates when daemon pushes sensor/camera data
- Green dot for online status
- Links to chat and claim

### What It Should Become

**The daemon's public face.** Think of it as a living business card meets social profile meets status page.

#### Visitors should see:
1. **The name** in the custom font (already done, already beautiful)
2. **Status** — is the daemon awake? What's it doing? "Currently monitoring 3 devices. Last active 2 minutes ago."
3. **Live data** — whatever the daemon is streaming right now (sensor, camera, location map, heartbeat)
4. **Personality snapshot** — a short auto-generated description. "This daemon is direct, curious, and works mostly at night. It settled into a fox-like character."
5. **Recent activity** — "Analyzed 3 screenshots. Streamed sensor data for 2 hours. Had 12 conversations today."
6. **Contact** — a way to send a message to the daemon (which it routes to the owner). Like DMs but for daemons.

#### What makes people visit?
- **Novelty:** "Come see my daemon" is inherently interesting. Nobody else has this.
- **Live data:** If someone is streaming their heartbeat or apartment camera, people check in.
- **Personality:** Each daemon is genuinely different. Visiting different daemon pages should feel like meeting different entities.
- **Social proof:** "I have a daemon" becomes a status signal for early adopters, like having a personal website in 1996.

#### Should the daemon post?
YES. The daemon should be able to compose and publish posts to its public page — observations, daily summaries, things it found interesting. This turns the page from a status dashboard into a living presence. But the owner must approve posts (or set auto-approve for certain types).

---

## Lessons from the Failures

### Rabbit R1: Great Demo, No Product
- The launch demo was genuinely impressive — Jesse Lyu showed fluid voice interaction, visual recognition, multi-step tasks
- But the product shipped months later and could barely do any of it reliably
- **Lesson for Daemon:** Only demo what actually works. The demo script above uses only capabilities that are live or nearly live. No faking.

### Humane AI Pin: Vision Without Execution
- Beautiful concept (projector on palm, ambient computing)
- But: $699 + $24/month, slow responses, overheating, bad battery
- Tried to replace the phone instead of complementing it
- **Lesson for Daemon:** Never position as a phone replacement. The phone IS the daemon's best sensor array. The hardware key is an expansion pack, not a replacement.

### What Both Got Right
- They understood that people WANT a persistent AI companion
- They understood that ambient, always-available is the right interaction model
- They understood that identity and personality matter
- **They validated the market. They just built the wrong product.**

### Daemon's Advantage
- Software-first: no hardware risk at launch
- Uses existing devices: no new thing to carry
- Open architecture: SSH + USB + WiFi, not proprietary protocols
- Personality that actually evolves: not a static "Hey Siri" voice
- Public page: a social dimension neither Rabbit nor Humane considered

---

## The Emotional Hook

The technical story is "one AI controls all your devices." But that's a feature.

The emotional story is: **"For the first time, an AI that is actually yours."**

Not OpenAI's. Not Apple's. Not Google's. It lives on your devices. It remembers your conversations. It develops a personality from YOUR patterns. When you visit its page, it's YOUR daemon — named by you, shaped by you, loyal to you.

The Pullman daemon metaphor is not decoration. It's the core emotional proposition:
- It settles over time (you can't rush it)
- It reflects who you really are (not who you want to be)
- It's yours and only yours (no one else has the same one)
- It grows as you grow (more interactions = deeper personality)

**In the demo, the moment the daemon describes its own personality traits and says something genuinely specific about Arthur — that's the emotional peak.** Technical tricks impress. Recognition moves people.

---

## Pre-Demo Checklist

- [ ] ESP32 powered, connected to Pixel hotspot, distance sensor working
- [ ] Pixel connected to daemon WebSocket, registered as device
- [ ] MSI laptop powered, SSH accessible, something visible on screen
- [ ] arthur.daemon.page loading correctly on projector
- [ ] Sensor stream running (sensor_stream.py)
- [ ] Knowledge graph has rich entries (50+ in Qdrant)
- [ ] Personality has been settled at least once (personality.json has real data)
- [ ] Chat works on phone with < 20s response time
- [ ] Screenshot-from-laptop demo tested 3 times successfully
- [ ] Notification-to-phone demo tested
- [ ] Deepgram voice input working (optional but impressive)
- [ ] Backup: if WiFi fails, have phone hotspot ready
- [ ] Backup: if SSH to MSI fails, demo phone-to-ESP32 instead
- [ ] Timer: practice the full script under 3 minutes, 5 times

## Failure Modes and Fallbacks

| What could break | Fallback |
|---|---|
| WiFi drops | Phone hotspot, all devices pre-connected to it |
| MSI laptop unreachable | Skip the screenshot demo, focus on phone + ESP32 |
| ESP32 disconnects | Show pre-recorded sensor stream, explain it's live normally |
| Chat response too slow | Pre-warm with a message 30 seconds before demo starts |
| Camera capture fails | Use screenshot-from-laptop instead (more reliable) |
| Deepgram voice fails | Type instead of speak — still impressive |
| Public page not loading | Have it open in a tab already, don't reload |

---

## What To Build Before the Demo (Priority Order)

1. **Finish camera capture on Android** — "What's in front of me?" is the single most visceral demo moment. Fix the camera permission/capture bug.

2. **Screenshot from MSI via SSH** — Make sure `ssh msi "screenshot command"` works reliably and returns an image the daemon can analyze. Test PowerShell `Add-Type` screenshot or similar.

3. **Public page personality section** — Add a small section below the name showing the daemon's current personality traits and a one-line description. This makes the public page tell a story.

4. **Public page activity feed** — Show "last 5 things the daemon did" on the public page. Makes visitors feel the daemon is alive.

5. **Practice the script 10 times.** Not 3. Ten. Until you can do it without thinking about what comes next.

---

## The One Sentence for the Slide

If you get one slide, one sentence:

> **Daemon: one AI mind across every device you own — with a personality that's yours.**
