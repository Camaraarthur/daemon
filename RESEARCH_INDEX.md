# Daemon Research Index

Generated overnight April 1, 2026. 26 deep research agents deployed across foundations, frontiers, ethics, novel concepts, and strategy.

## Start Here
1. **Condensed Lessons** — `research/synthesis/01_condensed_lessons.md` — 110 lessons = years of study in 30 min
2. **Daemon Whitepaper** — `research/novel/03_daemon_whitepaper.md` — The Bitcoin-whitepaper-level vision doc

## Critical Findings (read second)

### Architecture & Security
3. **Architecture Critique** — `ARCHITECTURE_CRITIQUE.md` — Brutal honest assessment. Key finding: "data on device" promise is currently false. 20 fixes ordered by impact/effort.
4. **Security Audit** — `SECURITY_ARCHITECTURE_AUDIT.md` — Found shell injection in auth check (line 136 of chat/route.ts), unauthenticated WebSocket, camera leaks to public SSE. Fix immediately.
5. **Threat Model** — `THREAT_MODEL.md` — Full STRIDE analysis, attack vectors, privacy nightmare scenarios, regulatory concerns.
6. **Android Architecture** — `ANDROID_ARCHITECTURE.md` — Companion Device Manager is the key API. Multi-typed foreground service. Camera2 is correct. Play Store incompatible (stay sideloaded).

### Product & Strategy
7. **Product Vision** — `PRODUCT_VISION_RESEARCH.md` — Entry point is emotional (health questions at 10PM), not productivity. Every phone-replacing device died. Settling mechanic is genuinely unique.
8. **Demo Strategy** — `DEMO_STRATEGY.md` — 3-min demo script with 6 beats. Lead with "What's on my laptop?" cross-device moment. 27 ranked features.
9. **Business Model** — `BUSINESS_MODEL_RESEARCH.md` — Break-even at ~300 users. $12/25/50 tiers. D30 retention of named daemons is the one metric. Pre-seed $50-200K realistic.
10. **Competitive Landscape** — `research/strategy/01_competitive_landscape.md` — Every competitor dissected.
11. **Brand Identity** — `research/strategy/02_identity_brand.md` — The daemon manifesto.

### Technical Deep Dives
12. **Sync Architecture** — `SYNC_ARCHITECTURE.md` — Hybrid sync (not full CRDTs). Append-only logs + LWW + version vectors. Server is stateless relay. CBOR wire format. 4-phase implementation.
13. **Personality Engine** — `PERSONALITY_ENGINE_RESEARCH.md` — EWMA with decaying learning rate for settling. Seven specific problems with current implementation. Six-phase migration path.
14. **Voice & Hardware** — `VOICE_HARDWARE_RESEARCH.md` — Deepgram + Cartesia/Voxtral for 500ms voice latency. ESP32-S3 for wake word. LiveKit for infrastructure. $22 BOM for voice node.
15. **Cutting Edge Repos** — `CUTTING_EDGE_RESEARCH.md` — Landscape of agent frameworks, device control, personal AI.

### Philosophical Foundations
16. **Daemon Philosophy** — `DAEMON_PHILOSOPHY.md` — Extended mind thesis, Pullman metaphor, trust accumulation, act-or-ask framework. Seven design beliefs.
17. **Extended Mind Thesis** — `research/foundations/01_extended_mind.md` — Why daemon IS part of the user's mind.
18. **Agency & Autonomy** — `research/foundations/02_agency_autonomy.md` — 10-level autonomy scale for daemon.
19. **Capability Security** — `research/foundations/03_capability_security.md` — The actual permission system design.
20. **Local-First AI** — `research/foundations/04_local_first_ai.md` — Crypto protocols for real data sovereignty.
21. **Ethics from First Principles** — `research/ethics/01_first_principles_ethics.md` — The anti-Thiel manifesto derived from data.

### Novel Contributions
22. **ASI Readiness** — `research/frontiers/01_asi_readiness.md` — Infrastructure for superintelligence.
23. **Fringe to Fundamental** — `research/frontiers/02_fringe_to_fundamental.md` — What's weird today, everywhere tomorrow.
24. **Daemon Mesh Protocol** — `research/novel/01_daemon_mesh_protocol.md` — Novel P2P protocol for daemon-to-daemon communication.
25. **Cognitive Architecture** — `research/novel/02_cognitive_architecture.md` — Beyond LLM+tools+RAG.

## Top 5 Actions (do today)
1. Fix shell injection in `chat/route.ts` line 136 (critical security)
2. Add WebSocket authentication (device pairing with codes)
3. Switch to persistent Claude CLI process (stream-json mode) for <5s responses
4. Implement Companion Device Manager in Android app
5. Decide on the demo script and practice it

## The One Insight
The daemon is not an app. It's a cognitive extension. Design it like you're designing a prosthetic for the mind — latency is pain, downtime is amputation, privacy violation is thought-reading. Everything follows from this.
