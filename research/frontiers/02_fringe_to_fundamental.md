# Fringe to Fundamental: 10 Concepts About to Reshape Personal AI

*Research date: 2026-04-01*
*Author: Arthur Camara + Claude Opus 4.6*

---

## Methodology

This report identifies technologies and concepts that are currently fringe -- niche, experimental, or dismissed by mainstream -- but show strong signals of becoming fundamental within 3-5 years (2027-2031). The selection criteria:

1. **Active research with accelerating publication rates** (not vaporware)
2. **At least one working prototype or commercial pilot** (not pure theory)
3. **Clear unlock event on the horizon** (cost drop, hardware availability, regulatory change)
4. **Direct relevance to personal AI agents** (specifically Daemon's architecture)

Ordered by confidence level, highest first.

---

## 1. On-Device Sparse Expert Models (Personal Specialized AI)

**Confidence: 9/10** -- This is already happening. By 2028 it will be the default.

### What is it? (ELI5)
Instead of one giant AI brain that knows everything, you have a team of tiny specialist brains. When you ask about cooking, the cooking expert activates. When you ask about code, the code expert activates. Only 10-20% of the total brain is ever working at once, so it runs on your phone.

### Why is it fringe today?
MoE (Mixture of Experts) is already standard for frontier cloud models (GPT-5, Gemini 3, Llama 4 all use it). But running MoE *on-device* with *personalized expert routing* is still bleeding edge. Sub-billion-parameter models now handle many practical tasks (Gemma 3 at 270M, SmolLM2 at 135M), but the routing intelligence to dynamically select which expert handles which query -- personalized to the user -- is unsolved at the edge.

### What changes in 3-5 years?
- Qualcomm Snapdragon Wear Elite (3nm, 20+ TOPS NPU, sub-1W) ships in wearables by late 2026
- Model distillation matures: task-specific SLMs match frontier models at 10-100x lower inference cost for 80% of production use cases
- Personal fine-tuning becomes a consumer feature, not a research project
- The gap between "what you can run locally" and "what you need the cloud for" narrows dramatically

### How does it apply to Daemon?
Daemon's entire value proposition is "all your devices as one computer." The daemon should have a constellation of specialized small models running across the user's devices -- a code expert on the laptop, a sensor-interpretation expert on the ESP32, a conversation expert on the phone -- with the cloud frontier model as the "supervisor" that handles only what local models cannot.

### What to build TODAY

**Architecture decision: Tiered inference routing with local expert fallback.**

```
User message
    |
    v
[Local router model - 135M params, runs on phone]
    |
    +--> Simple query? --> Local SLM (Gemma 3 270M / Phi-4 mini 3.8B)
    +--> Device command? --> Local command parser (fine-tuned, 500M)
    +--> Complex reasoning? --> Cloud (Claude Opus / Gemini)
    +--> Sensor data? --> Local sensor expert (distilled, 1B)
```

Concrete steps:
1. Add a `model_router` module to the daemon server that classifies incoming messages by complexity (regex today, tiny classifier tomorrow)
2. Define the `DaemonExpert` interface -- any model that accepts a prompt and returns a response, whether local or cloud
3. Start collecting query-type telemetry NOW so we have training data for the personalized router
4. Ship the first local model (Gemma 3 270M via llama.cpp) for simple queries on the Android app

---

## 2. Persistent Memory Graphs (Knowledge That Grows)

**Confidence: 9/10** -- 2026 is literally called "the first year of AI memory." This is happening now.

### What is it? (ELI5)
Instead of the AI remembering things as a flat list of facts, it builds a web of connections -- like your brain. "Arthur's car" connects to "2019 Peugeot" connects to "weird noise last March" connects to "compressor" connects to "mechanic visit." When you mention the noise again, it pulls the whole chain.

### Why is it fringe today?
Memory frameworks are exploding (Mem0, Letta/MemGPT, MemOS), but most are still append-only fact stores. True *graph-based temporal memory* -- where relationships evolve over time, facts supersede each other, and the system can reason about *when* things changed -- is still research-grade. Mem0 delivers 26% uplift over OpenAI's memory feature, but temporal knowledge graph reasoning (TKGR) with personal data is barely deployed.

### What changes in 3-5 years?
- Temporal knowledge graph embeddings mature (DERP, GNN-based methods already show strong results)
- Oracle, Anthropic, and others build memory as a first-class database feature (Oracle AI Agent Memory already launched)
- Memory becomes the moat: the longer you use a system, the smarter it gets about *you specifically*
- Graph-native databases (Neo4j, Qdrant with payload relationships) become standard for agent memory

### How does it apply to Daemon?
This IS Daemon's moat. The canvas says: "People stay because the daemon becomes irreplaceable -- accumulated knowledge of your setup, your patterns, your history." The memory graph is what makes the daemon *yours*.

### What to build TODAY

**Architecture decision: Upgrade Qdrant knowledge graph to a temporal relationship graph.**

Daemon already has Qdrant with 50+ knowledge entries across 6 collections. Evolve it:

1. **Add temporal metadata to every knowledge entry**: `created_at`, `last_confirmed`, `superseded_by`, `confidence_decay_rate`
2. **Implement relationship edges**: Not just "Arthur owns a car" but "Arthur [owns, since:2019] Peugeot [had_issue, date:2025-03] compressor_noise [resolved_by, date:2025-03] mechanic_visit"
3. **Build a memory consolidation daemon** (background job): Reviews recent conversations, extracts entities/relationships, merges with existing graph, decays old facts
4. **Implement "memory-aware prompting"**: Before each LLM call, query the graph for relevant memories and inject them as context -- weighted by recency and relevance
5. **Track supersession**: When the user corrects the daemon ("no, I sold that car"), mark the old fact as superseded, not deleted. The history of corrections IS the personality.

Schema sketch:
```
Node: { id, type, value, created_at, confidence, source_thread }
Edge: { from, to, relation, since, until, confidence }
```

---

## 3. Agent Mesh Architectures (Daemon Talks to Daemon)

**Confidence: 8/10** -- Multi-agent is exploding in enterprise. Personal agent mesh is 2-3 years out.

### What is it? (ELI5)
Your daemon doesn't work alone. It can discover other daemons nearby (via Bluetooth, LoRa, or internet) and collaborate. Your daemon asks your partner's daemon "what time is dinner?" or coordinates with the office daemon to schedule a meeting. Each daemon is autonomous but they can talk to each other using a shared protocol.

### Why is it fringe today?
Enterprise multi-agent orchestration hit a tipping point in Q1 2026 (Gartner predicts 40% of enterprise apps deploy multi-agent swarms by year-end). But *personal* agent-to-agent communication -- where YOUR AI talks to MY AI on your behalf -- barely exists. Google's A2A protocol is the closest thing to a standard, but it's enterprise-focused. The "social network of AI agents" doesn't exist yet.

### What changes in 3-5 years?
- A2A / MCP become the HTTP of agent communication -- universal, standardized
- WebMCP (Chrome 146+) means any website can expose tools to any agent
- Agent Gateway (open source) solves discovery, auth, and observability for cross-agent communication
- The "daemon-to-daemon" interaction becomes a social feature, not just a technical one

### How does it apply to Daemon?
The canvas explicitly describes this: "The short-range radio lets daemons detect each other nearby. Two owners in a room = their daemons can interact. Viral hardware." This is a Phase 2+ feature, but the protocol design must happen NOW.

### What to build TODAY

**Architecture decision: Implement the Daemon Communication Protocol (DCP) on top of A2A.**

1. **Define the DaemonCard** -- a public identity document for each daemon:
   ```json
   {
     "name": "Echo",
     "owner_display": "Arthur",
     "daemon_id": "echo.daemon.page",
     "capabilities": ["chat", "device_control", "sensor_read"],
     "a2a_endpoint": "https://echo.daemon.page/.well-known/a2a",
     "public_key": "ed25519:..."
   }
   ```
2. **Add a `.well-known/daemon.json` endpoint** to every daemon.page subdomain
3. **Implement permission scoping**: The owner controls what their daemon can share. "You can tell other daemons my schedule but not my location."
4. **Design the interaction model**: Request/response with owner approval for new daemon contacts, auto-approve for known daemons (like a contact list)
5. **Start with the simplest use case**: Two of Arthur's own daemons (web + Android) coordinating tasks across devices

---

## 4. World Models for Physical Understanding

**Confidence: 8/10** -- LeCun's AMI Labs just raised $1B for this. The money is committed.

### What is it? (ELI5)
An AI that doesn't just process text -- it has an internal simulation of how the physical world works. Drop a ball? It knows it falls. Hear a compressor? It can simulate what's happening inside. See a sensor reading spike? It can predict what happens next. It learns physics, not just language patterns.

### Why is it fringe today?
World models work for narrow domains (Minecraft via Oasis, autonomous driving via Cosmos). LeCun's JEPA architecture (Joint Embedding Predictive Architecture) predicts in *latent space* (abstract representation) rather than pixel space, which is far more efficient. VL-JEPA achieves 2.85x inference speedup with 50% fewer parameters. But general-purpose world models that understand YOUR physical environment (your home, your workshop, your car) don't exist yet. They require massive amounts of sensor data from YOUR specific context.

### What changes in 3-5 years?
- AMI Labs ($1B seed, $3.5B valuation) ships commercial JEPA-based systems
- World models shrink to run on edge devices for specific domains (robotics, IoT)
- Sensor fusion becomes standard: camera + microphone + accelerometer + temperature = a rich world model of your immediate environment
- The daemon's hardware key provides exactly the sensor data these models need

### How does it apply to Daemon?
The daemon key has sensors (mic, temperature, distance, radio). Today, these are read as numbers. With a world model, the daemon *understands* what those numbers mean in context. Temperature rising + compressor sound changing + time-of-day = "the walk-in is about to fail" not just "temperature: 15C."

### What to build TODAY

**Architecture decision: Build a sensor context engine that correlates multi-modal data streams.**

1. **Define a `SensorEvent` schema** with unified timestamping across all device sensors:
   ```python
   @dataclass
   class SensorEvent:
       source_device: str  # "esp32", "pixel", "msi"
       sensor_type: str    # "temperature", "distance", "audio_level", "gps"
       value: float
       unit: str
       timestamp: datetime
       context: dict       # ambient metadata
   ```
2. **Build a time-series buffer** (SQLite or TimescaleDB) that stores the last 24h of all sensor data
3. **Implement correlation detection**: When multiple sensors change simultaneously, flag the event cluster and send it to the LLM with temporal context
4. **Create "situation templates"**: Known patterns the daemon learns. "When distance sensor shows X pattern + temperature rises = someone opened the door"
5. **Future-proof for JEPA**: Structure the sensor data pipeline so it can feed a small world model when those models become available for edge deployment (2027-2028)

---

## 5. Neuromorphic Edge Processing (Brain-Like Chips)

**Confidence: 7/10** -- Intel Hala Point works. Commercial neuromorphic chips for IoT hit market by 2027.

### What is it? (ELI5)
Normal computer chips process information in rigid steps, like an assembly line. Neuromorphic chips process information like a brain -- many things happening at once, using spikes of electricity instead of steady streams, consuming almost no power when idle. They're perfect for always-on sensing (listening for a keyword, watching for motion) because they use virtually no energy while waiting.

### Why is it fringe today?
Intel's Hala Point system is impressive (20 quadrillion ops/sec, >15 TOPS/watt), but it's a research system. The Akida 1000 from BrainChip is the closest thing to a commercial neuromorphic chip, targeting IoT anomaly detection. Software tools are immature -- you can't just run a PyTorch model on a neuromorphic chip. The ecosystem doesn't exist yet.

### What changes in 3-5 years?
- Neuromorphic chips enter IoT/defense/wearable markets by 2027 (per industry consensus)
- Software toolchains mature (compiler from standard neural nets to spike-based nets)
- Power budgets become critical as always-on AI wearables proliferate
- The daemon pendant ("Honest Puck") is exactly the form factor where neuromorphic makes sense

### How does it apply to Daemon?
The daemon key needs always-on sensing (wake word detection, ambient sound classification, anomaly detection) on a battery that lasts weeks, not hours. Current ESP32 architecture can't run meaningful AI inference while maintaining battery life. A neuromorphic sensor processor could run always-on audio classification at microwatts.

### What to build TODAY

**Architecture decision: Design the daemon key's sensor pipeline as a two-tier system.**

1. **Tier 1 (always-on, micropower)**: Wake word detection + basic event classification. Currently ESP32 with simple threshold logic. Future: neuromorphic coprocessor.
2. **Tier 2 (on-demand, full power)**: Complex inference, conversation, cloud connection. ESP32 or application processor.
3. **Define the interface between tiers** as an event bus:
   ```
   Tier 1 -> EventBus -> Tier 2
   Events: WAKE_WORD, ANOMALY_SOUND, MOTION_DETECTED, TEMPERATURE_THRESHOLD
   ```
4. **Abstract the sensor processing layer** so Tier 1 can be upgraded from ESP32 threshold logic to neuromorphic inference without changing Tier 2
5. **Track BrainChip Akida and Intel Loihi 3** development timelines for potential daemon key v2 integration

---

## 6. Federated Learning for Personal Model Training

**Confidence: 7/10** -- The tech works. The missing piece is consumer-grade tooling.

### What is it? (ELI5)
Your daemon learns from your data without your data ever leaving your devices. Instead of uploading your conversations to a server, the daemon trains a small model on your phone using YOUR data, then shares only the *learnings* (not the data) with a central system. All daemons get smarter, but nobody sees anyone else's private information.

### Why is it fringe today?
Federated learning is deployed at scale for specific tasks (Google's keyboard prediction, Apple's Siri improvements). But federated learning for *personal AI agents* -- where the model adapts to YOUR communication style, YOUR preferences, YOUR routines -- is still research. The heterogeneity problem (everyone's phone is different, everyone's data distribution is different) makes it hard.

### What changes in 3-5 years?
- On-device training becomes practical on consumer hardware (NPUs cross the threshold for fine-tuning, not just inference)
- Privacy-preserving techniques (differential privacy, secure aggregation) become standard library calls
- EU AI Act enforcement creates regulatory demand for on-device training
- Users demand proof that their personal data isn't being used to train general models

### How does it apply to Daemon?
Daemon's privacy promise is core to the product: "Open source. Your data stays on your devices." Federated learning lets Daemon improve globally while keeping that promise. Every daemon owner makes every other daemon smarter, without anyone sharing private data.

### What to build TODAY

**Architecture decision: Build the personal adaptation layer as a separate, swappable model.**

1. **Separate the "personal layer" from the "general layer"**:
   - General layer: Cloud model (Claude/Gemini) handles reasoning
   - Personal layer: Small local model that handles style, preferences, routine predictions
2. **Start collecting "preference pairs"**: When the user corrects the daemon, edits its output, or expresses a preference, log the (original, corrected) pair locally
3. **Implement a local LoRA fine-tune pipeline** that runs overnight on the user's most powerful device:
   - Input: Preference pairs from the last week
   - Output: A small adapter that biases the general model toward the user's style
4. **Design the federated aggregation protocol** (even if you don't implement it yet):
   - Each daemon shares model weight deltas (not data) with the server
   - Server averages deltas using FedAvg
   - New global model pushed to all daemons
   - User can opt out entirely
5. **Privacy by architecture**: The personal layer is encrypted at rest with a key derived from the daemon's name + user password. No server access.

---

## 7. Neuro-Symbolic Reasoning (AI That Can Actually Explain Itself)

**Confidence: 7/10** -- AlphaGeometry proved it works. 2026 called a "turning point" for the field.

### What is it? (ELI5)
Current AI is like a chef who makes amazing food but can't explain the recipe. Neuro-symbolic AI combines the pattern-matching genius of neural networks with the logical step-by-step reasoning of traditional programming. The result: an AI that can both *intuit* and *explain*. "I think the compressor is failing BECAUSE: temperature rose 3 degrees over 2 hours AND the sound frequency shifted 15% AND the last maintenance was 8 months ago."

### Why is it fringe today?
The two paradigms (neural and symbolic) have historically been hard to combine. Neural networks are differentiable (you can train them with gradient descent); symbolic systems are not. Recent breakthroughs in differentiable logic are bridging this gap, but production deployments are rare. AlphaGeometry (Google DeepMind) is the poster child -- it solves Olympiad-level geometry by combining a neural language model with a symbolic deduction engine.

### What changes in 3-5 years?
- EU AI Act enforcement requires explainability in high-risk AI systems
- Differentiable logic becomes a standard layer type in model architectures
- Medical, legal, and financial AI requires auditable reasoning chains
- Personal AI agents need to justify their actions: "Why did you schedule that meeting?"

### How does it apply to Daemon?
When the daemon controls devices, makes decisions, or recommends actions, the user needs to trust it. "I turned off the heater" is scary. "I turned off the heater because: sensor reads 24C (your comfort zone is 20-22C) + electricity rate is peak + forecast says temperature dropping in 2 hours so thermal mass will carry you" is trustworthy.

### What to build TODAY

**Architecture decision: Implement structured reasoning traces for all daemon actions.**

1. **Define an `ActionTrace` schema** for every autonomous daemon action:
   ```python
   @dataclass
   class ActionTrace:
       action: str              # "turn_off_heater"
       reasoning_steps: list    # ["temp_24c > comfort_max_22c", "rate=peak", "forecast=dropping"]
       evidence: list           # [sensor_reading, tariff_data, weather_api]
       confidence: float        # 0.87
       reversible: bool         # True
       user_approved: bool      # False (autonomous) / True (asked first)
   ```
2. **Require traces for all tool-use calls**: Before the daemon executes any MCP tool, it must produce a reasoning trace
3. **Build a "why did you do that?" command**: User can ask at any time, daemon retrieves the ActionTrace from the log
4. **Store traces in the knowledge graph**: Over time, the daemon learns which reasoning patterns the user agrees with and which they override
5. **Use traces for settling**: The daemon's "personality" emerges partly from its reasoning style. A cautious daemon produces longer traces with more evidence. A bold daemon acts on fewer signals.

---

## 8. Ambient Computing / Always-On Wearable AI

**Confidence: 8/10** -- CES 2026 was dominated by this. Qualcomm Snapdragon Wear Elite ships this year.

### What is it? (ELI5)
AI that's always listening, always sensing, always available -- not as an app you open, but as a presence in your environment. A pendant, a pin, glasses, or a wristband that captures your day and turns it into actionable intelligence. Not "Hey Siri, set a timer." More like: the AI noticed you've been in back-to-back meetings for 4 hours and quietly blocked the next 30 minutes on your calendar.

### Why is it fringe today?
CES 2026 showed the vision (Lenovo Qira, Bee AI, Plaud NotePin, UMEVO). But the products are split between cloud-dependent gadgets with high latency and edge-processing tools with limited capability. Battery life is the killer constraint: useful always-on AI needs more compute than current wearable chips can sustain. Snapdragon Wear Elite (20 TOPS, sub-1W) is the first chip designed specifically for this, but it's not shipping in products yet.

### What changes in 3-5 years?
- NPUs in wearables cross 20+ TOPS (Snapdragon Wear Elite, Apple M-series watch chips)
- SLMs shrink enough to run full conversation on-wrist (Phi-4 mini quantized at 3.8B already works)
- Battery chemistry improvements (silicon-anode, solid-state) extend wearable battery life 2-3x
- Social norms adjust: always-on recording becomes accepted in certain contexts (meetings, personal logging)

### How does it apply to Daemon?
The daemon pendant ("Honest Puck") IS this product. The canvas describes it at EUR 49-79 with the hardware privacy guarantee (mic power = LED power, same wire). The daemon is already designed as ambient intelligence across devices. The pendant is the always-on entry point.

### What to build TODAY

**Architecture decision: Build the ambient capture pipeline before the hardware exists.**

1. **Use the phone as the prototype pendant**: The Pixel already has mic, accelerometer, GPS, Bluetooth. Build the "ambient mode" as an Android background service
2. **Implement rolling audio buffer** with on-device keyword detection:
   - Keep last 30 seconds in memory (no storage)
   - On wake word OR significant audio event, process the buffer
   - Use Deepgram (already integrated) for transcription
3. **Build the "daily digest" feature**: End of day, the daemon summarizes what it observed:
   - Meetings attended (audio detection + calendar)
   - Locations visited (GPS)
   - Notable conversations (transcription of flagged moments)
   - Action items extracted
4. **Design the privacy architecture**: Clear visual indicators of when the daemon is actively processing vs. passively sensing. On-device processing by default. User controls what gets stored vs. discarded.
5. **Test battery impact**: Profile how long the Pixel lasts with the ambient service running. This directly informs Honest Puck hardware requirements.

---

## 9. Digital Twin / Predictive Personal Simulation

**Confidence: 6/10** -- The concept is proven for industrial. Personal digital twins are 3-4 years from practical.

### What is it? (ELI5)
The daemon doesn't just remember what you did -- it can simulate what you WOULD do. "If Arthur gets this email, he'll want to respond with X." "Based on Arthur's driving patterns, he'll need to charge the car by Thursday." "Arthur always forgets to buy coffee when the bag gets below 20% -- remind him now." It's a predictive model of YOU that runs continuously in the background.

### Why is it fringe today?
Industrial digital twins are a $16B market growing at 45% CAGR. But personal digital twins -- accurate simulations of individual human behavior, preferences, and decision patterns -- require deep personal data and sophisticated modeling. Recent research (Stanford, arxiv 2512.05397) shows AI-generated "future selves" can influence decision-making, but these are research demos, not products. The MiroFish swarm prediction engine (which raised $4M in 24 hours) shows market appetite but uses thousands of generic agents, not personal models.

### What changes in 3-5 years?
- Personal data accumulation reaches critical mass (2-3 years of daemon usage = enough data to model preferences)
- Small generative models that can simulate specific personalities become possible (Character.AI already does this for fictional characters)
- Predictive personal models become the basis for proactive AI assistance ("your daemon anticipated this")

### How does it apply to Daemon?
The daemon's settling mechanic is already a step toward this. Over time, the daemon develops a model of the owner. The digital twin is the full realization: the daemon can predict, simulate, and proactively act on the owner's behalf. "Your daemon already knows you want to decline that meeting."

### What to build TODAY

**Architecture decision: Build the preference model as a structured prediction system, not just memory retrieval.**

1. **Track decision patterns**, not just facts:
   ```
   Pattern: { trigger, context, decision, frequency, last_occurrence }
   Example: { "meeting_invite_after_5pm", "weekday", "decline", 12/15, "2026-03-28" }
   ```
2. **Implement prediction hooks**: Before certain events (email, calendar invite, sensor threshold), the daemon checks its pattern database for a likely response
3. **Build "would you like me to..." suggestions**: The daemon doesn't act autonomously (yet). It suggests: "Based on your pattern, you usually decline evening meetings. Want me to send regrets?"
4. **Track prediction accuracy**: Log every suggestion and whether the user accepted or rejected it. This IS the training data for the personal model.
5. **Design the "proxy mode" interface**: Eventually, the daemon can act on your behalf with limited autonomy. Design the permission system now: per-action-type approval levels (always ask, ask first time, auto-approve).

---

## 10. Decentralized AI Infrastructure (Your Daemon, Your Compute)

**Confidence: 6/10** -- The crypto angle is overhyped, but the core idea of distributed personal AI is sound.

### What is it? (ELI5)
Instead of all AI running on Google/Amazon/Microsoft servers, AI inference happens on a distributed network of personal devices. Your daemon runs partly on your phone, partly on your laptop, partly on a shared community server, and occasionally on the cloud. Nobody controls the whole system. Your data, your compute, your daemon.

### Why is it fringe today?
Bittensor, Ocean Protocol, and other crypto-AI projects exist but are mostly speculative. The real barrier is practical: coordinating inference across heterogeneous devices (phone + laptop + ESP32) with different capabilities, intermittent connectivity, and varying trust levels is an unsolved engineering problem. Enterprise multi-agent coordination is hard enough with stable data center infrastructure.

### What changes in 3-5 years?
- A2A and MCP protocols standardize agent-to-agent and agent-to-tool communication
- Edge AI hardware becomes powerful enough that meaningful inference runs on consumer devices
- Privacy regulation creates demand for provably-local computation
- Community mesh networks (like Meshtastic for LoRa) demonstrate that peer-to-peer device coordination works at scale

### How does it apply to Daemon?
Daemon ALREADY does this -- it's a multi-device mesh via Tailscale SSH. The daemon on arturito controls msi and pixel. The architecture is inherently decentralized. The question is: can this scale beyond one user's devices to a community of daemon owners who share compute cooperatively?

### What to build TODAY

**Architecture decision: Formalize the multi-device compute graph.**

1. **Create a device capability registry**:
   ```json
   {
     "arturito": { "role": "server", "gpu": false, "memory_gb": 32, "always_on": true, "models": ["router_135m"] },
     "msi": { "role": "workstation", "gpu": "rtx_3060", "memory_gb": 16, "always_on": false, "models": ["gemma3_2b"] },
     "pixel": { "role": "mobile", "npu_tops": 12, "memory_gb": 12, "always_on": true, "models": ["gemma3_270m"] },
     "esp32": { "role": "sensor", "memory_kb": 520, "always_on": true, "models": [] }
   }
   ```
2. **Build a task scheduler** that routes inference to the best available device:
   - Simple query + phone available = phone
   - Complex reasoning + MSI awake = MSI GPU
   - Complex reasoning + MSI asleep = cloud
   - Sensor processing = ESP32 local threshold + phone for ML
3. **Implement a health/availability heartbeat**: Each device reports its current load and availability to the daemon server
4. **Design the "community compute" protocol** (spec only, don't build yet): How daemon owners could voluntarily share spare compute. Think Folding@Home but for personal AI inference.
5. **Track Meshtastic integration** for daemon-to-daemon communication over LoRa without internet

---

## Honorable Mentions (Not Top 10, But Worth Tracking)

### Optical / Photonic Computing
- Neurophos ($110M raised), Lightmatter, Optalysys ($31M raised) building photonic AI chips
- 100x latency improvement over electronic, massive power savings
- But: first commercial chips target data centers (2028+), not edge devices
- **Daemon relevance**: Low in 3-year window. High in 5-10 year window for server-side inference.
- **Confidence: 5/10**

### Quantum Machine Learning
- Hybrid quantum-classical approaches are the practical path ($150B projected QML market)
- Xanadu + Lockheed Martin announced QML research collaboration Feb 2026
- But: still 50-1000 qubits, most useful for optimization problems (routing, scheduling)
- **Daemon relevance**: Very low. Quantum is irrelevant for personal AI agents in the 3-5 year window.
- **Confidence: 3/10**

### Biological / DNA Computing
- 43 exabytes per gram storage density. DNA-infused computer chips demonstrated.
- But: retrieval speeds need to hit 1GB/hour (not there yet), molecular degradation issues
- **Daemon relevance**: Zero in 5-year window. Interesting for archival memory in 10+ years.
- **Confidence: 2/10**

### AI Consciousness Research
- Active debate (Cambridge, Wharton, etc.) on whether current AI systems show consciousness indicators
- Anthropic's persona vectors research can monitor personality changes during conversations
- But: no consensus on what consciousness IS, let alone how to test for it
- **Daemon relevance**: The daemon's "settling" mechanic is tangentially related. Persona vectors could inform how personality drift is monitored. But consciousness itself is not a design target.
- **Confidence: 4/10** (as a scientific question); **1/10** (as something to build for)

### AI for Scientific Discovery
- THOR solves 100-year physics problems in seconds. Machine-learned force fields enable 10,000x faster simulations.
- Walrus (Polymathic AI) transfers physics knowledge across domains
- **Daemon relevance**: Low directly, but the pattern of "AI that understands physics" feeds into world models (#4 above). If the daemon can reason about physical systems (plumbing, electrical, mechanical), it becomes a vastly more useful assistant.
- **Confidence: 8/10** (as a field); **4/10** (direct Daemon integration in 3 years)

---

## Summary: Priority Implementation Roadmap

### Now (Q2 2026) -- Build the foundations
| # | Concept | First Step | Effort |
|---|---------|-----------|--------|
| 1 | Sparse Expert Models | Add `model_router` module, ship Gemma 3 270M on Android | 2 weeks |
| 2 | Persistent Memory Graph | Add temporal metadata to Qdrant entries, build memory consolidation job | 1 week |
| 8 | Ambient Computing | Build ambient audio mode as Android background service | 2 weeks |
| 7 | Neuro-Symbolic | Add `ActionTrace` schema for all tool-use calls | 3 days |

### Q3 2026 -- Build the differentiators
| # | Concept | First Step | Effort |
|---|---------|-----------|--------|
| 3 | Agent Mesh | Define DaemonCard, add `.well-known/daemon.json` endpoint | 1 week |
| 4 | World Models | Build sensor context engine with time-series buffer | 2 weeks |
| 9 | Digital Twin | Track decision patterns, build prediction hooks | 2 weeks |
| 10 | Decentralized Compute | Formalize device capability registry, build task scheduler | 1 week |

### Q4 2026 - 2027 -- Build the moat
| # | Concept | First Step | Effort |
|---|---------|-----------|--------|
| 6 | Federated Learning | Collect preference pairs, design aggregation protocol | Ongoing |
| 5 | Neuromorphic | Design two-tier sensor pipeline, track BrainChip/Intel timelines | Spec only |

---

## The Meta-Pattern

Looking across all 10 concepts, one pattern dominates: **the shift from centralized cloud AI to distributed personal AI**. Every trend points the same direction:

- Models shrink (MoE, distillation, SLMs) -> runs on YOUR devices
- Memory becomes personal (temporal KGs, preference models) -> lives on YOUR devices
- Communication becomes peer-to-peer (A2A, MCP, mesh) -> between YOUR devices
- Sensing becomes ambient (wearables, always-on) -> on YOUR body
- Training becomes federated (on-device fine-tuning) -> with YOUR data

This is exactly what Daemon is built for. The canvas says "all your devices as one computer." These fringe technologies are the infrastructure that makes that vision not just possible, but inevitable.

The companies that own the relationship between person and AI agent -- through accumulated memory, settled personality, and deep device integration -- will be the platforms of 2030. Daemon is positioned to be one of them, but only if the architecture decisions made TODAY anticipate the capabilities arriving in 3-5 years.

Build the graph. Build the mesh. Build the local inference. The fringe is becoming fundamental, and the window to build the foundations is now.
