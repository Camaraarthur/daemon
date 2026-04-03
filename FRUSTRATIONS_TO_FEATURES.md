# Arthur's Frustrations → Daemon Features

Extracted from 2322+ messages across 40+ Claude Code sessions (Feb-Apr 2026).
Arthur is the first user — these are real pain points, not hypothetical.

---

## 1. CONNECTION DROPS / SSH BROKEN PIPE
**Frustration**: "Read from remote host: Software caused connection abort - Connection closed. client_loop: send disconnect: Broken pipe"
This happened mid-message while Arthur was typing requirements for daemon.

**Feature**: WebSocket with auto-reconnect + message queue. If connection drops, daemon buffers unsent messages and resumes when back. No work lost. Ever. Status indicator shows connection state. Works from any device — no SSH needed.

---

## 2. TERMINAL RENDERING GLITCHES
**Frustration**: "i need a nice not buggy ui no glitches like on terminal claude code"
Terminal over SSH mangles formatting, tables render broken, colors are wrong, scrollback is limited.

**Feature**: Native web rendering. Markdown rendered properly. Tables formatted. Code blocks with syntax highlighting. Tool calls shown in collapsible blocks. No ANSI escape code hell.

---

## 3. DARK/INVISIBLE UI ELEMENTS
**Frustration**: "the /chat page still looks suuper dark" (5 messages about this), "even the sidebar text etc all seem too dark"

**Feature**: High-contrast default theme. Text is clearly readable. No invisible-on-dark-background elements. Light theme option. Tested on phone screens in sunlight.

---

## 4. LOST SESSIONS / CAN'T GO BACK
**Frustration**: "i cant go back to a chat", "this was already ran a long time ago this is not the conversation i want rn", "cn you sumarize this conversation? where did you arrive at this"

**Feature**: All sessions saved with searchable titles. Session list shows last message preview + timestamp. Resume any session instantly. Sessions auto-titled from first message. Session export.

---

## 5. WRONG CONTEXT / WRONG PROJECT
**Frustration**: "wait what are you on arturito or daemon? im talking about daemon here", "wrong chat forget about the recordings focus on arturito bd"

**Feature**: Projects are first-class. Each project has its own chat history, memory, and file context. Clear project indicator in header. Switch projects with one click. Default project set in settings. Never ambiguous which project you're in.

---

## 6. NO FOLDER MANAGEMENT / ALWAYS ASKING WHICH DIR
**Frustration**: "no choosing of what folder im in its all on one default folder"

**Feature**: One default workspace directory (e.g., /home/arthur). Projects are subdirectories. Never asks "which directory?" — it knows. User can change default in settings. Project auto-detected from subdirectory structure.

---

## 7. MEMORY DOESN'T PERSIST
**Frustration**: "cant you use the fucking thing we did yesterday???? look through the chat from before", "better memory in between sessions"

**Feature**: Three-tier memory:
- **Session memory**: full conversation within a thread
- **Project memory**: facts, decisions, architecture per project (persists forever)
- **Global memory**: user preferences, patterns, who you are (persists forever)
Memory is searchable and editable by user. Agent automatically remembers important decisions.

---

## 8. EDITING WRONG FILE
**Frustration**: "YOU ARE EDITING THE WRONG PLACE IT IS NOT BEING UPDATED ON THE URL" (all caps, happened 7 times)

**Feature**: Before editing, daemon checks: what process serves this URL? What file does that process serve? Shows the user which file it's about to edit and which URL it affects. File → URL mapping is tracked per project.

---

## 9. REBUILDING INSTEAD OF REUSING
**Frustration**: "WHATT?? I SAID USE THE STUFF THAT IS MADE ALREADY" (all caps)

**Feature**: Daemon knows all repos and their contents. Before writing new code, it searches existing codebases. Shows user: "Found similar code in arturito-bd/src/utils.ts — reuse this?" Project memory includes list of existing implementations.

---

## 10. STREAMING INTERRUPTED BY USER INPUT
**Frustration**: "i wrote while it was streaming and the send button didn't change / enter doesn't work as send do i need to refresh the page?"

**Feature**: Input always available, even during streaming. Messages queue if sent while agent is responding. No need to wait for response to finish before typing next message. Send button always works.

---

## 11. BROKEN TABLE/MARKDOWN RENDERING
**Frustration**: "the agent created a table that was broken and badly formatted in the chat, can you research a formatting library"

**Feature**: Full GitHub-flavored markdown rendering. Tables, code blocks, lists, headers all render correctly. Use remark/rehype pipeline. Code blocks have copy button + language label.

---

## 12. PAGE REQUIRES REFRESH TO WORK
**Frustration**: "still says disconnected when i refresh", "it's still the same after refreshing the page"

**Feature**: No refresh needed. Ever. WebSocket reconnects automatically. State is reactive. If something breaks, the app self-heals. Offline indicator if actually offline.

---

## 13. MULTI-DEVICE HASSLE
**Frustration**: "this way i am doing w termux and ssh on different machines is that something people use? because its a bit annoying"

**Feature**: One URL (my.daemon.page) works from any device. Phone, tablet, laptop, desktop. Same conversations, same projects, same memory. No SSH. No Termux. Just open the browser.

---

## 14. COST BLINDNESS
**Frustration**: Not explicit but Arthur constantly manages API keys across services and monitors costs.

**Feature**: Real-time cost counter. Shows per-message cost, daily total, monthly total. Budget alerts. Model auto-routing optimizes cost (free Qwen for simple, DeepSeek for medium, Claude for complex).

---

## 15. CAN'T CONTROL DEVICES FROM CHAT
**Frustration**: "the daemon needs to be able to use it when i ask it to, make it super simple like connect to esp turn the sensor on"

**Feature**: Device panel shows all connected devices. Natural language device control. "Take a photo on my phone." "What's running on arturito?" "Screenshot my MSI." Permissions per device.

---

## 16. UNRELIABLE AGENTS / HALLUCINATED DATA
**Frustration**: "the biggest problem with arturito is unreliability now. it cannot under any circumstance make up stuff"

**Feature**: Confidence indicators on factual claims. Citations for data pulled from APIs. "I'm not sure about this — should I search?" rather than inventing. All API data sourced and timestamped.

---

## 17. SIDEBAR/LAYOUT ISSUES
**Frustration**: "the files tab overrides everything", "sidebar cant collapse", "completely different ui wise has a different logo"

**Feature**: Consistent layout everywhere. Sidebar collapses. Panels are resizable by dragging. Layout preferences persist. Same design language across all pages.

---

## Priority Order for Implementation

**Must have for Arthur to switch from terminal Claude Code:**
1. Reliability — never loses messages, auto-reconnects (Features 1, 12)
2. Project separation with memory (Features 5, 6, 7)
3. Clean markdown/tool rendering (Features 2, 11)
4. Session management (Feature 4)
5. Input always works (Feature 10)

**Nice to have for v1:**
6. Device panel (Feature 15)
7. Cost tracking (Feature 14)
8. Multi-device (Feature 13)

**Can come later:**
9. File→URL mapping (Feature 8)
10. Code reuse detection (Feature 9)
11. Confidence indicators (Feature 16)
