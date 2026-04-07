# Claude Code → Daemon Gap Analysis

## What Arthur does daily that Daemon CANNOT do yet:

### CRITICAL (blocks switching from terminal)
1. **No /resume** — opening a project doesn't restore full context
2. **No project auto-detection** — Claude Code scores keywords to detect what project you're in
3. **No semantic search** — "find the file that handles auth" doesn't work
4. **No hooks** — no SessionStart/Stop lifecycle for auto-saving/loading state
5. **No cross-device state sync** — project states don't rsync between devices
6. **No CLAUDE.md injection** — Arthur's rules aren't in the system prompt

### IMPORTANT (degrades experience)  
7. No service management UI (systemctl from chat works, no dashboard)
8. No build artifact verification UI
9. No file-history tracking
10. No smart tool selection (always bash, never optimized)

### NICE TO HAVE
11. Git UI (branch switcher)
12. Docker management
13. Session replay

## What Daemon CAN do that Claude Code CANNOT:
- Multi-device mesh (connect phone + laptop + server)
- Clipboard sync
- Auto-deploy to daemon.page
- BYOK + free tier
- Web UI with project sidebar
- Slash commands from any device
