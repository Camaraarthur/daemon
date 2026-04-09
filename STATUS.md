# Where we are with Daemon

Plain English. No jargon. Updated as I go.

## The big picture

Daemon is the thing every "AI on your stuff" gets built on top of. Instead of every app reinventing the basics, daemon hands the agent a starter kit out of the box: places to store keys, a way to remember things, a way to schedule itself, a way to send you a notification, a place to put a webpage, links to your files, etc. The agent just picks them up.

We're building those basics one by one.

## What I just finished

### 1. The secrets vault (done, shipped)

Think of it like a tiny safe that lives on your computer. The agent can stash things in it ("here's my OpenAI key, remember it") and pull them back later. Nothing leaves your machine. Even if someone steals the file, they can't read what's inside without a second key file that only your computer has.

I also built a second layer on top of it: a shared free-keys cabinet. You ask for "brave_search_api_key" and if you don't have your own, daemon hands you ours, free. So every agent on daemon can search the web with zero setup. Later we can charge for the fancy ones, but for now everything is free.

Both layers look identical to the agent — it just calls "give me the key named X" and the right one comes back. Done, tested end-to-end, committed.

### 2. The vision document

I locked in two short documents (`docs/vision.md` and `docs/positioning.md`) that say what daemon is, who it's for, and what it will never become. So future-me and future-agents stop drifting.

## What I'm building right now

### 3. The scheduler (half done)

This is the "agent that runs while you sleep" piece. You tell it: "every morning at 8, summarize my unread emails." It writes that down in a little list, and then a tiny clock inside daemon ticks every 30 seconds checking if anything is due. When 8am hits, it pokes the agent and says "go do this now," and the result lands in your chat.

**What's done:**
- The list of schedules (saved in the local database). ✅
- A tiny clock parser — I can give it "every weekday at 9am" or "every 30 minutes" and it knows when to fire next. Tested, works. ✅
- The tick loop that wakes up every 30 seconds and looks for due items. ✅
- Phone-home function: when something is due, the device calls back to the daemon website to wake the agent. ✅
- Buttons for the agent to add / list / delete / pause schedules. ✅

**What's left:**
- The other end of the phone call — the daemon website needs an endpoint that *receives* the "wake up" call and actually runs the agent. ⏳
- Hand the agent the right shape of buttons so it knows these tools exist. ⏳
- Make sure the website knows these new commands are allowed. ⏳
- Test the whole thing end to end (create a schedule for 1 minute from now, watch it fire, watch the agent reply land in chat). ⏳
- Commit. ⏳

## What's next after the scheduler

In rough order:

### 4. Notifications
Right now if the agent finishes something while you're not looking, you don't know. We need the daemon to be able to tap you on the shoulder — first via a web browser notification, eventually via the phone app.

### 5. Sub-page hosting
Let the agent build you a tiny webpage at *yourname*.daemon.page without you setting up a server. Useful for "make me a dashboard" / "host this thing you just generated."

### 6. File-in-chat clickable links
When the agent finds a file on your computer, the chat should show a real button you can click to open it. Right now it just prints the path.

### 7. Semantic file search as a built-in tool
Wire up the file-search thing (already exists separately on this machine) so any daemon agent can find your files by meaning, not just by name.

### 8. The system prompt scaffolding
The thing that tells the agent, every single time it wakes up, "here's your devices, here's your secrets, here's your schedules, here's your important paths." So the agent never starts from zero. This is the meta-primitive that ties all the others together.

### 9. The pendant firmware
The wearable mic necklace I found on the SSD ("Honest Puck v3.2"). Needs the actual code that runs on the chip. Hardware is real, schematic is read, just need to write the firmware.

## Things I'm explicitly NOT doing

- No telegram bandaid. Notifications go through real native channels.
- No copying what other agents do. We're picking the small set of basics nobody else has bothered to build properly.
- No paywall or visible API broker UI yet — just the plumbing.
- No cloud lock-in. Your data stays on your devices.

## Weird stuff I had to figure out

- The pendant was on the SSD, not the server's main drive. Took a few wrong turns to find it.
- The cron parser broke at first because I had `*/N` in a comment, and the `*/` accidentally ended the comment. Fixed.
- The secrets file needed a master key generated lazily on first use, not on startup.

## Where to read the actual stuff

- Source of truth for the product: `docs/vision.md`
- Pitch / target audience: `docs/positioning.md`
- This file: `STATUS.md`
