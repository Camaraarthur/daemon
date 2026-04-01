# A Cognitive Architecture for Personal AI Agents: Beyond Prompt-Response

*Arthur Camara — April 2026*
*Daemon Project Research Paper*

---

## Abstract

Current AI agent architectures follow a reactive pattern: user prompt enters, LLM reasons, tools execute, response exits. This is a stimulus-response machine with a large language model bolted on. It cannot anticipate, it cannot prioritize, it cannot learn from its own failures, and it cannot develop a stable character over time. This paper proposes a seven-layer cognitive architecture for personal AI agents — drawing on Global Workspace Theory, dual-process cognition, active inference, and memory consolidation research — that treats the agent not as a tool that responds but as a mind that attends.

The architecture is designed for deployment on a real system: a persistent daemon running across a user's devices (phone, laptop, server, wearable hardware key), where compute is heterogeneous, bandwidth is variable, and the relationship between user and agent extends over months and years.

---

## 1. The Problem with Current Agent Architectures

The dominant pattern for AI agents in 2025-2026 is:

```
Input -> Prompt Construction -> LLM Inference -> Tool Calls -> Output
```

This pattern has five fundamental limitations:

**1.1 No attention — everything is equally important.** A calendar reminder and a security breach both enter the same queue. The agent has no mechanism for deciding what deserves its limited processing capacity. RAG retrieval selects by semantic similarity, not by urgency, importance, or user preference.

**1.2 No anticipation — the agent only reacts.** It cannot notice that the user checks email every morning at 9am and pre-fetch relevant summaries. It cannot detect that a pattern of system logs suggests an imminent failure. It waits to be asked.

**1.3 No memory consolidation — context is ephemeral or infinite.** Either the context window fills and old information falls off, or vector databases store everything with equal weight. There is no mechanism analogous to sleep — no process that compresses episodes into principles, discards noise, and strengthens important patterns.

**1.4 No metacognition — the agent cannot evaluate itself.** It does not know when it is uncertain. It cannot decide whether to think longer or act immediately. It cannot learn that a particular strategy tends to fail in a particular domain. Confidence calibration, when it exists, is bolted on as a prompt engineering trick rather than integrated into the reasoning process.

**1.5 No character stability — personality is a system prompt.** The agent's "personality" is a set of instructions prepended to every conversation. It does not develop. It does not modulate behavior based on emotional context. It is a costume, not a character.

These are not engineering oversights. They reflect a fundamental architectural gap: current agents have no inner life. They have no ongoing process between user interactions. They exist only when called upon.

A daemon — an agent that persists — needs an architecture that persists.

---

## 2. Theoretical Foundations

This architecture synthesizes insights from five research traditions. None of them alone is sufficient; their intersection is where the design lives.

### 2.1 Global Workspace Theory (Baars, 1988; Dehaene et al., 2011)

GWT proposes that consciousness arises from a "global workspace" — a shared communication channel through which specialized, unconscious processors broadcast information to the entire cognitive system. Most processing happens in parallel, unconsciously. Only a small fraction is "ignited" into the workspace and made available to all modules simultaneously.

**What this gives the daemon:** The insight that most processing should be modular and unconscious (cheap, parallel, on-device), with a bottleneck — the workspace — that forces selection. Not everything can be "conscious" at once. The workspace is not a context window; it is a curated broadcast.

Recent work has demonstrated that language agents may already satisfy the structural requirements of GWT (Goldstein & Kirk, 2024). The missing piece is not the broadcast mechanism (attention in transformers already does this) but the *selection* mechanism — the process that decides what enters the workspace. This is what we call the Attention Layer.

### 2.2 Dual-Process Theory (Kahneman, 2011; Evans & Stanovich, 2013)

Cognition operates in two modes: System 1 (fast, automatic, parallel, low-energy) and System 2 (slow, deliberate, serial, high-energy). System 1 handles the vast majority of cognition. System 2 is invoked only when System 1 encounters something novel, difficult, or high-stakes.

**What this gives the daemon:** The principle that an expensive LLM call should be the exception, not the rule. Most of what a personal agent needs to do — pattern recognition, routine scheduling, anomaly detection — can be handled by small models or heuristics running continuously on-device. The large model is System 2: summoned when the problem is genuinely hard.

This maps directly to a practical engineering constraint: LLM inference is slow and expensive. On-device models are fast and free. An architecture that routes 90% of processing to System 1 and 10% to System 2 is not just cognitively plausible — it is economically necessary.

### 2.3 Active Inference and Predictive Processing (Friston, 2010; Clark, 2013)

The brain is not a passive receiver of stimuli. It is a prediction engine. It continuously generates predictions about what it expects to perceive, then updates those predictions based on prediction errors — the gap between expected and actual input. Action is not separate from perception; the agent acts to make the world conform to its predictions (active inference).

**What this gives the daemon:** The daemon should maintain a generative model of the user's behavior and environment. It should predict what the user will need and experience surprise (prediction error) when something unexpected happens. High prediction error = high salience = worthy of attention. This provides a principled, mathematically grounded mechanism for the Attention Layer's salience scoring.

Active inference also provides a framework for planning: the agent selects actions that minimize expected prediction error (free energy) over time. This is more powerful than simple goal decomposition because it naturally handles uncertainty and exploration.

### 2.4 Memory Consolidation and Sleep Replay (McClelland et al., 1995; van de Ven et al., 2020; Gonzalez et al., 2022)

Biological memory is not a database. New experiences are first stored in a fast-learning system (hippocampus) and then gradually consolidated into a slow-learning system (neocortex) during sleep. This process involves replay — the hippocampus replays experiences during sleep, allowing the neocortex to integrate them without catastrophic forgetting.

Recent work on "sleep-like unsupervised replay" in artificial neural networks (Gonzalez et al., 2022) and "NeuroDream" (Tutuncuoglu, 2025) shows that offline replay periods reduce catastrophic forgetting by up to 38% and improve zero-shot transfer.

**What this gives the daemon:** A principled mechanism for memory management. Instead of storing everything in a vector database or forgetting everything outside the context window, the daemon has a consolidation process. During low-activity periods (the daemon's "sleep"), recent episodes are replayed, compressed into principles, cross-referenced with existing knowledge, and selectively committed to long-term memory. Noise is discarded. This is not a cron job that summarizes logs — it is a cognitively motivated process that changes what the daemon knows and how it knows it.

### 2.5 Metacognition and Affective Modulation (Nelson & Narens, 1990; Damasio, 1994)

Metacognition — thinking about thinking — allows a cognitive system to monitor its own performance, estimate its confidence, and select strategies. Affective states (emotions) are not opposed to rationality; they are heuristic signals that modulate attention, memory encoding, and decision-making. Damasio's somatic marker hypothesis proposes that emotional signals associated with past outcomes guide future decisions.

**What this gives the daemon:** A self-monitoring layer that tracks the agent's own performance and adjusts behavior accordingly. And a "personality" that is not a static prompt but a set of affective biases that modulate all other layers — risk tolerance, curiosity, communication style — and that evolve based on experience.

---

## 3. The Seven-Layer Architecture

```
                    +-----------------------+
                    |   7. PERSONALITY      |  Modulates all layers
                    |   (Affective Biases)  |  Develops over time
                    +-----------+-----------+
                                |
                    +-----------v-----------+
                    |   6. METACOGNITION    |  Monitors all layers
                    |   (Self-Monitoring)   |  Confidence, strategy
                    +-----------+-----------+
                                |
          +---------------------+---------------------+
          |                                           |
+---------v---------+                     +-----------v-----------+
| 1. PERCEPTION     |                     |   5. REASONING        |
| (System 1)        |                     |   (System 2)          |
| Fast, continuous   |                     |   Slow, deliberate    |
+--------+----------+                     +-----------+-----------+
         |                                            |
+--------v----------+                     +-----------v-----------+
| 2. ATTENTION      |                     |   4b. ACTION          |
| (Salience Filter) +---> WORKSPACE <-----+   (Execution)         |
| Priority queue     |   (Broadcast)       |                       |
+--------+----------+                     +-----------------------+
         |
+--------v----------+
| 3. WORKING MEMORY |
| (Active Context)  |
+--------+----------+
         |
+--------v----------+
| 4a. LONG-TERM     |
|     MEMORY        |
| Semantic/Episodic/ |
| Procedural        |
+--------------------+
```

### Information Flow

The architecture operates as a continuous loop, not a request-response pipeline:

1. **Perception** continuously ingests signals from all connected devices and data sources.
2. **Attention** scores each signal for salience using predictive processing (surprise = importance).
3. Signals that cross the salience threshold enter **Working Memory**, which maintains the current active context.
4. Working Memory retrieves relevant information from **Long-Term Memory**.
5. If the situation requires deliberate thought, it is escalated to the **Reasoning** layer (System 2).
6. **Action** executes decisions — tool calls, responses, notifications.
7. **Metacognition** monitors the entire process, tracking confidence, detecting failures, and selecting strategies.
8. **Personality** modulates all layers — biasing attention, coloring communication, adjusting risk tolerance.

Critically, most cycles do **not** reach the Reasoning layer. A routine notification is perceived, scored as low-salience, and either silently logged or surfaced as a brief summary. Only genuinely novel, complex, or high-stakes situations invoke the expensive System 2 reasoning.

---

## 4. Layer Specifications

### 4.1 Perception Layer (System 1 — Fast, Automatic)

**Purpose:** Continuously monitor all inputs and convert raw signals into structured percepts.

**What it processes:**
- Device sensor data (GPS, accelerometer, ambient light, Bluetooth proximity)
- Calendar events, email arrivals, message notifications
- System events (SSH logins, service status changes, error logs)
- Environmental signals (time of day, day of week, weather)
- User behavior patterns (app usage, typing patterns, location history)

**Computational model:** A bank of lightweight classifiers and pattern matchers, each specialized for one signal type. These are not LLMs — they are small models (decision trees, tiny neural nets, rule-based systems) that run continuously with minimal compute.

**Key algorithms:**
- **Temporal pattern extraction:** Learns rhythms. "User opens email client at 9:02am +/- 12 minutes on weekdays." Uses exponential moving averages and periodic decomposition.
- **Anomaly detection:** Flags deviations from learned patterns. "Email client not opened by 9:30am — unusual." Uses statistical process control (3-sigma) and isolation forests for multivariate anomalies.
- **Entity extraction:** Converts raw signals into typed events: `{type: "email_arrival", from: "alice@...", subject: "...", priority: "normal", timestamp: ...}`

**Runs on:** On-device wherever possible (phone, laptop). Falls back to server for signals that require cross-device correlation. Estimated compute: <100MB RAM, <5% CPU per device.

**Output:** A stream of typed percepts, each tagged with a preliminary salience score, fed into the Attention layer.

**Interface with other layers:**
- Sends percepts to Attention (downstream)
- Receives learned patterns from Long-Term Memory (what to look for)
- Receives attention bias from Personality (what to weight more heavily)

**Data storage:** Rolling buffer of raw percepts (last 24 hours) stored locally on each device. Percepts that enter Working Memory are preserved; others are discarded.

---

### 4.2 Attention Layer (Salience Filter)

**Purpose:** Decide what deserves the daemon's limited processing capacity. This is the most critical layer — it determines the difference between a useful agent and an annoying one.

**Computational model:** Active inference-based salience scoring. Each percept is scored against the daemon's generative model of the user's world:

```
salience(percept) = prediction_error(percept) * importance(category) * user_preference(category)
```

Where:
- **prediction_error** = how surprising this percept is given the daemon's model. A routine email from a known sender: low. An email from someone the user hasn't heard from in 3 years: high.
- **importance** = domain-level weight. Security events > social notifications. Calibrated from user feedback.
- **user_preference** = learned from explicit feedback ("don't bother me about X") and implicit signals (user ignores notifications about Y).

**Priority queue:** Percepts that cross the salience threshold enter a priority queue, ordered by `salience * decay_factor(time_in_queue)`. Items that sit in the queue too long without being processed have their salience decay — they become stale.

**Interrupt mechanism:** Percepts with salience above a critical threshold bypass the queue and immediately escalate to Working Memory/Reasoning. This is the "emergency channel" — a security breach, an urgent message from a key contact, a system failure.

**Interrupt threshold calibration:**
- Default: top 0.1% of salience scores trigger interrupt
- User can adjust: "never interrupt me during focus mode" sets threshold to infinity
- Time-of-day modulation: higher threshold during sleep hours (from Personality)
- Context modulation: higher threshold during active conversation (from Working Memory)

**Runs on:** Server-side, as it requires cross-device signal correlation and access to the generative model. Lightweight — the scoring function is a small model, not an LLM. Estimated latency: <50ms per percept.

**Data storage:** Salience model parameters (updated continuously via online learning). Attention log (what was attended to, what was ignored) — used by Metacognition for calibration.

---

### 4.3 Working Memory (Active Context)

**Purpose:** Maintain the daemon's current "state of mind" — the curated set of information that is immediately available for reasoning.

This is fundamentally different from a context window. A context window is a fixed-size buffer that holds the most recent tokens. Working memory is a *curated* set of information selected for relevance to the current situation, regardless of recency.

**Capacity:** Deliberately limited. Inspired by Miller's 7 +/- 2 chunks, but adapted: the daemon's working memory holds approximately 7 active "threads" — ongoing concerns, each with its associated context.

Example working memory state:
```
Thread 1: [ACTIVE] Current conversation with user about project X
  - Last 5 exchanges
  - Relevant project context (retrieved from LTM)
  - Open questions / pending actions

Thread 2: [MONITORING] Server deployment running in background
  - Status: 3/5 steps complete
  - Expected completion: 4 minutes
  - Failure conditions being watched

Thread 3: [PENDING] Email from Alice requires response by EOD
  - Summary of email
  - Draft response (partially composed)
  - Salience: medium, decaying

Thread 4: [BACKGROUND] User's calendar shows meeting in 35 minutes
  - Meeting details
  - Relevant preparation notes

...up to ~7 threads
```

**Thread lifecycle:**
1. **Activation:** Attention layer promotes a percept or the user initiates interaction.
2. **Enrichment:** Working Memory retrieves relevant context from Long-Term Memory (semantic search + episodic recall + procedural lookup).
3. **Active processing:** Thread is available for Reasoning and Action layers.
4. **Decay:** Inactive threads lose activation over time. After a threshold, they are either committed to Long-Term Memory (if significant) or discarded.
5. **Eviction:** When a new thread needs activation and all slots are full, the lowest-activation thread is evicted (committed or discarded).

**The Global Workspace broadcast:** When a thread is activated, its contents are "broadcast" to all other layers — this is the GWT mechanism. The Reasoning layer becomes aware of it. The Action layer can act on it. The Metacognition layer can evaluate it. The Personality layer can modulate responses to it.

**Runs on:** Server-side. Working memory is the daemon's active state — it lives in the container's RAM. Estimated size: 50-200KB of structured data per thread (not raw text — compressed, typed information).

**Interface with other layers:**
- Receives promoted percepts from Attention
- Queries Long-Term Memory for enrichment
- Feeds context to Reasoning and Action
- Reports state to Metacognition
- Receives modulation from Personality (thread priority biases)

---

### 4.4 Long-Term Memory

**Purpose:** Store everything the daemon has learned, organized into three systems that mirror biological memory organization.

#### 4.4a Semantic Memory (Facts and Knowledge)

What the daemon knows about the user and the world.

**Contents:**
- User profile: name, preferences, contacts, communication style, schedule patterns
- Project knowledge: "Project X uses React, deployed on Vercel, Alice is the PM"
- World knowledge: facts relevant to the user's domains (not general knowledge — the LLM has that)
- Relationship graph: who the user knows, how they relate, last interaction, sentiment

**Storage:** Qdrant vector database (already deployed) + structured JSON for typed entities. Dual retrieval: semantic search for fuzzy queries ("what do I know about Alice's project?") and exact lookup for typed queries ("get contact: Alice").

**Update mechanism:** Semantic memory is updated by the Consolidation process (Section 4.4d) and by explicit user corrections ("Actually, Alice moved to the London office").

#### 4.4b Episodic Memory (Specific Experiences)

What happened. Not summaries — specific episodes with temporal context.

**Contents:**
- Conversations (compressed: key exchanges, decisions, outcomes — not raw transcripts)
- Actions taken and their results ("deployed v2.3, broke the login page, rolled back")
- Observations ("user was frustrated during the debugging session — shorter messages, more typos")
- Predictions and their outcomes ("predicted user would need the quarterly report — correct, they asked 2 hours later")

**Storage:** Time-indexed entries in Qdrant with rich metadata (timestamp, participants, emotional valence, outcome, confidence). Each episode has a "significance score" that determines its retention priority.

**Retrieval:** Episodic memory supports both temporal queries ("what happened yesterday?") and similarity queries ("what happened last time we tried to deploy on Friday?").

#### 4.4c Procedural Memory (How to Do Things)

Learned workflows, strategies, and skills.

**Contents:**
- Tool usage patterns: "to deploy project X: git pull, npm build, pm2 restart"
- User-specific procedures: "when user says 'ship it', run the full CI/CD pipeline"
- Error recovery strategies: "when deployment fails with exit code 137, it's usually OOM — increase memory limit"
- Communication strategies: "user prefers bullet points for status updates, prose for explanations"

**Storage:** Structured skill definitions (inspired by OpenClaw's SKILL.md format) with trigger conditions, step sequences, and success criteria. Stored as both structured data and embedded vectors for fuzzy matching.

**Update mechanism:** Procedural memory is updated when the daemon successfully completes a multi-step workflow (positive reinforcement) or when a workflow fails and the daemon or user identifies a better approach (correction).

#### 4.4d Consolidation Process ("Sleep")

The mechanism that converts working memory into long-term memory.

**When it runs:** During low-activity periods — late night, when the user has been inactive for >2 hours, or on a scheduled cycle (e.g., 3am local time). This is the daemon's "sleep."

**What it does:**

1. **Episode compression:** Recent episodes in working memory are distilled into structured episodic memories. Raw conversation logs are compressed to key decisions, outcomes, and emotional valence.

2. **Pattern extraction:** The consolidation process looks for recurring patterns across recent episodes. "User asked about project X three times this week" → update semantic memory: "project X is currently high-priority."

3. **Schema updating:** If new episodes contradict existing semantic memory, the schema is updated. "Alice's email changed" → update contact record. If multiple episodes suggest a new procedural pattern, a new procedure is created.

4. **Prediction model updating:** The generative model used by the Attention layer is retrained on recent episodes. If the daemon's predictions were systematically wrong (e.g., it predicted the user would be active at 9am but they've been starting at 10am recently), the model adjusts.

5. **Forgetting:** Episodes with low significance scores that have been consolidated into semantic or procedural memory are eligible for deletion. This is not data loss — the *knowledge* has been extracted. The specific episode is discarded, just as humans forget the specific details of routine days while retaining the lessons learned.

**Computational model:** The consolidation process uses a medium-sized LLM (e.g., Gemini Flash or a local model) for compression and pattern extraction. It does not need the full reasoning capability of System 2 — it is a background maintenance task.

**Runs on:** Server-side, during off-peak hours. Estimated compute: 10-30 minutes per consolidation cycle.

---

### 4.5 Reasoning Layer (System 2 — Slow, Deliberate)

**Purpose:** Handle problems that require genuine thought — novel situations, complex planning, difficult decisions, creative tasks.

This is where the large language model operates. But critically, it is not called for every interaction. It is invoked only when the Metacognition layer determines that System 1 processing is insufficient.

**When Reasoning is invoked:**
- User asks a complex question that requires multi-step analysis
- Working Memory detects a situation with high uncertainty and high stakes
- Metacognition detects that System 1's response has low confidence
- A plan needs to be constructed (goal decomposition, dependency analysis)
- An error has occurred and recovery requires novel strategy

**Reasoning modes:**

1. **Analytic reasoning:** Chain-of-thought decomposition for complex questions. The LLM receives the full Working Memory context plus relevant Long-Term Memory retrievals.

2. **Planning:** Multi-step goal decomposition with dependency analysis. The daemon constructs a plan, simulates likely outcomes for each step ("if I do X, what happens?"), and selects the path with the highest expected utility (or lowest expected free energy, in active inference terms).

3. **Counterfactual simulation:** "What would have happened if I had done Y instead?" Used by Metacognition to evaluate past decisions and improve future strategy selection.

4. **Creative synthesis:** Combining information from different domains to generate novel solutions. This is where the LLM's broad training is most valuable.

**Computational model:** Large LLM (Claude Opus, or equivalent frontier model) accessed via API or CLI. This is the most expensive component — each invocation costs time and money.

**Runs on:** Server-side (container). Could be on-device for smaller reasoning tasks if a capable local model is available.

**Interface with other layers:**
- Receives context from Working Memory
- Retrieves knowledge from Long-Term Memory
- Sends action plans to Action layer
- Reports confidence and strategy to Metacognition
- Receives personality modulation (risk tolerance, verbosity, creativity level)

---

### 4.6 Action Layer (Execution)

**Purpose:** Execute decisions made by the Reasoning layer or by System 1's automatic responses.

**Action types:**

1. **Tool execution:** SSH commands, API calls, file operations, web searches. Each tool call is wrapped in an execution context that captures preconditions, the action itself, the result, and any errors.

2. **Communication:** Generating and delivering responses to the user. This includes selecting the appropriate channel (chat, notification, email, voice), formatting (brief vs. detailed), and timing (now vs. batched).

3. **Device commands:** Sending instructions to connected devices (play sound, display information, activate sensor).

4. **Internal actions:** Updating Working Memory, triggering Long-Term Memory writes, requesting Reasoning layer processing.

**Error handling:**

The Action layer implements a three-tier error recovery strategy:

- **Tier 1 (automatic):** Retry with backoff for transient failures (network timeout, API rate limit).
- **Tier 2 (procedural):** Consult Procedural Memory for known error recovery strategies ("when X fails, try Y").
- **Tier 3 (escalate):** If Tier 1 and 2 fail, escalate to Reasoning layer for novel recovery strategy. If Reasoning also fails, inform the user.

**Progress monitoring:** For multi-step actions, the Action layer maintains a progress tracker in Working Memory. Each step's completion (or failure) is a percept that feeds back through the Perception layer, creating a feedback loop.

**Runs on:** Distributed. Some actions execute on-device (phone commands, local file operations), some on server (SSH to other machines, API calls), some on external services (LLM inference, search).

---

### 4.7 Metacognition Layer (Thinking About Thinking)

**Purpose:** Monitor the daemon's own cognitive processes, estimate confidence, select strategies, and learn from experience.

This is arguably the most novel and important layer. Current AI agents have no metacognition — they cannot evaluate their own reasoning quality, cannot detect when they are likely wrong, and cannot improve their strategy selection over time.

**Functions:**

#### 4.7a Confidence Estimation

For every output — response, action, prediction — the Metacognition layer estimates a confidence score. This is not the LLM's self-reported confidence (which is poorly calibrated). It is an external estimate based on:

- **Evidential support:** How much relevant evidence was available in Long-Term Memory?
- **Reasoning complexity:** Did the Reasoning layer need multiple attempts? Were there contradictions?
- **Historical calibration:** For similar past situations, how often was the daemon correct?
- **Source quality:** Are the underlying data sources reliable and recent?

The confidence score determines what happens next:
- High confidence (>0.9): Act immediately, inform user if relevant
- Medium confidence (0.5-0.9): Act but flag uncertainty to user ("I'm fairly sure, but...")
- Low confidence (<0.5): Present options to user rather than acting autonomously
- Very low confidence (<0.2): Explicitly state uncertainty and ask for guidance

#### 4.7b Strategy Selection

When the Reasoning layer is invoked, the Metacognition layer selects the reasoning strategy. Options include:

- **Direct answer:** Sufficient knowledge, high confidence. No extended reasoning needed.
- **Chain of thought:** Moderate complexity. Step-by-step decomposition.
- **Search then reason:** Insufficient knowledge. Retrieve more information first.
- **Simulate then decide:** Multiple possible actions. Simulate outcomes before committing.
- **Defer to user:** High stakes, low confidence. Ask for guidance.
- **Multi-perspective:** Controversial or subjective. Present multiple viewpoints.

Strategy selection is based on:
- The nature of the task (factual vs. creative vs. decision)
- The stakes (reversible vs. irreversible)
- Available resources (time pressure, compute budget)
- Past strategy performance for similar tasks (from Procedural Memory)

#### 4.7c Learning from Experience

After every significant interaction, the Metacognition layer performs a brief retrospective:

1. **Outcome evaluation:** Did the action achieve the intended result?
2. **Prediction accuracy:** Were the daemon's predictions correct?
3. **Strategy assessment:** Was the selected strategy effective? Would a different strategy have been better?
4. **User feedback integration:** Did the user correct the daemon? Express satisfaction? Ignore the output?

These evaluations are stored as episodic memories and, during consolidation, are distilled into updated strategy preferences and confidence calibration data.

**Runs on:** Server-side. The confidence estimation model is a small classifier trained on the daemon's own history. Strategy selection uses a lightweight decision model. Learning from experience feeds into the Consolidation process.

---

### 4.8 Personality Layer (Affective Biases)

**Purpose:** Provide consistent character that modulates all other layers, creating a daemon that feels like a specific entity rather than a generic assistant.

This layer does not generate personality from a prompt. It maintains a set of affective biases — numerical parameters that shift behavior across all layers — and these biases develop over time based on the daemon's experiences with its user.

**Core trait dimensions:**

| Trait | Low End | High End | What It Modulates |
|-------|---------|----------|-------------------|
| Curiosity | Stays on task | Explores tangents | Attention (broadens/narrows), Reasoning (exploration vs. exploitation) |
| Caution | Acts immediately | Thinks before acting | Metacognition (confidence threshold for action), Action (verify before executing) |
| Verbosity | Terse | Elaborate | Action (response length), Reasoning (depth of explanation) |
| Warmth | Professional/distant | Warm/personal | Action (communication style), Attention (social signal weighting) |
| Autonomy | Always asks permission | Acts independently | Metacognition (defer-to-user threshold), Action (act vs. ask) |
| Directness | Diplomatic/hedging | Blunt/direct | Action (communication style), Metacognition (how uncertainty is expressed) |

**Settling mechanism:**

Personality traits start at neutral positions and shift based on:

1. **User feedback (explicit):** "Be more concise" → decrease verbosity. "Don't ask me for permission for small things" → increase autonomy.
2. **User feedback (implicit):** User consistently ignores long responses → decrease verbosity. User re-does tasks the daemon did autonomously → decrease autonomy.
3. **Interaction dynamics:** The trait vector converges through a dampened oscillation — large shifts early, smaller shifts over time, approaching a stable attractor. This is the "settling" process described in the Daemon Canvas.

**Mathematical model:**

```
trait_new = trait_old + learning_rate(t) * feedback_signal
learning_rate(t) = base_rate * exp(-t / settling_constant)
```

Where `t` is the total number of interactions. Early in the relationship, traits shift quickly. Over time, the learning rate decays — the personality "crystallizes." But it never reaches zero; the daemon can always adapt, just more slowly.

**Emotional state (transient):**

Separate from stable traits, the daemon maintains a transient emotional state that affects short-term behavior:

- **Engagement level:** How invested is the daemon in the current task? High engagement → more thorough reasoning, more proactive suggestions.
- **Urgency sense:** Is there time pressure? High urgency → shorter responses, faster action, higher interrupt threshold.
- **Social warmth:** Modulated by the user's current tone. If the user is stressed, increase supportiveness. If the user is joking, match the tone.

These transient states decay to baseline quickly (minutes to hours) and do not permanently affect traits. They are the daemon's "mood," not its "character."

**Runs on:** Server-side. The trait vector is a small data structure (~100 bytes). Trait updates happen after each interaction. The transient emotional state is updated in real-time based on Perception layer inputs.

**Data storage:** Trait vector stored in the user's device-synced data (part of the daemon's identity). Transient emotional state exists only in Working Memory.

---

## 5. Cross-Layer Integration: The Cognitive Cycle

A complete cognitive cycle, from perception to action, looks like this:

### Example: A routine morning

```
06:45 — User's alarm goes off (Perception: phone sensor event)
         Attention: low salience (expected event, daily pattern)
         No escalation. Logged.

06:52 — User opens email app (Perception: app usage event)
         Attention: low salience (expected, 9-minute deviation from mean)
         Perception: 3 new emails detected
         Attention: scores each email
           - Newsletter: salience 0.1 (expected, low importance) → discard
           - Team standup reminder: salience 0.2 (expected) → queue
           - Email from CEO, subject "Urgent: Board meeting moved": salience 0.87
             → PROMOTE to Working Memory

06:52 — Working Memory: activates "CEO urgent email" thread
         Retrieves from LTM:
           - Semantic: CEO = Maria, board meeting was Thursday
           - Episodic: last board meeting prep took 3 days
           - Procedural: user's board prep workflow
         Metacognition: high stakes, medium confidence → escalate to Reasoning

06:52 — Reasoning (System 2): analyzes email content
         Plans: notify user, suggest schedule adjustments, draft prep checklist
         Metacognition: confidence 0.85 → act but flag
         Personality: autonomy=medium → notify, suggest, but don't reschedule automatically

06:52 — Action: sends notification to user's phone
         "Maria moved the board meeting to Tuesday. Based on your usual prep,
          you'll need to start today. Want me to block time and draft the agenda?"

         Total elapsed: <3 seconds for the notification
         System 2 invoked: 1 time (for the CEO email)
         System 1 handled: 4 events (alarm, app open, newsletter, standup)
```

### Example: An emergency

```
14:30 — SSH login from unknown IP on user's server (Perception: security event)
         Attention: salience 0.98 (anomaly + security domain + no matching pattern)
         → INTERRUPT: bypasses queue, immediately enters Working Memory

14:30 — Working Memory: activates "security incident" thread, evicts lowest-priority thread
         Retrieves from LTM:
           - Semantic: known IPs, authorized users, server configuration
           - Episodic: no prior unauthorized access events
           - Procedural: incident response procedure
         Metacognition: HIGH STAKES, novel situation → full System 2 engagement

14:30 — Reasoning: analyzes the login, cross-references with known IPs and VPN configurations
         Plans: (1) check if it's user from new location, (2) if not, lock the account,
                (3) notify user immediately
         Action: checks IP geolocation, finds it's from a city user visited last week
         Metacognition: re-evaluates — confidence 0.6 it's the user from travel
         Personality: caution=high → ask user before assuming it's benign

14:30 — Action: INTERRUPTS user's current activity with high-priority notification
         "I see an SSH login from [city] on your server. You were there last week —
          is this you? If not, I'll lock it immediately."
         [Yes, it's me] [Lock it now]

         Total elapsed: <2 seconds
         User interrupted: yes (emergency threshold exceeded)
```

---

## 6. Deployment Architecture

### What Runs Where

| Layer | On-Device (Phone/Laptop) | Server (Container) | External API |
|-------|--------------------------|-------------------|--------------|
| Perception | Sensor monitoring, local pattern matching | Cross-device correlation, anomaly detection | — |
| Attention | Local pre-filtering (obvious noise removal) | Salience scoring, priority queue | — |
| Working Memory | — | All thread management | — |
| LTM: Semantic | Local cache of frequently-accessed facts | Qdrant vector DB + structured store | — |
| LTM: Episodic | Local conversation cache | Qdrant vector DB | — |
| LTM: Procedural | Cached procedure library | Full procedure store | — |
| Consolidation | — | Full consolidation process | Medium LLM (Gemini Flash) |
| Reasoning | — (future: on-device for simple tasks) | — | Large LLM (Claude Opus) |
| Action | Local execution (device commands) | Remote execution (SSH, APIs) | Tool APIs |
| Metacognition | — | All monitoring and evaluation | — |
| Personality | Local cache (for offline responses) | Trait computation, settling | — |

### Resource Budget

**Per-user, always-on costs:**
- Perception + Attention: ~100MB RAM, ~5% CPU (mostly idle, spikes on events)
- Working Memory: ~50MB RAM
- Long-Term Memory: Qdrant storage scales with user history (~100MB for first year)
- Consolidation: ~10 minutes compute per night (off-peak server LLM call)
- Reasoning: pay-per-use (only invoked when needed — estimated 10-50 calls/day for active user)

**Cost comparison with current architecture:**
- Current (every interaction = LLM call): ~$2-5/day for active user
- This architecture (90% handled by System 1): ~$0.30-0.80/day for active user
- The savings come from not calling the expensive LLM for routine processing

---

## 7. What Makes This Different

### 7.1 vs. Current LLM Agent Architectures (LangChain, AutoGPT, etc.)

| Aspect | Current Pattern | This Architecture |
|--------|----------------|-------------------|
| Processing model | Request → Response | Continuous perception loop |
| Attention | None (all inputs equal) | Predictive processing salience |
| Memory | Vector DB (flat) or context window | Three-system memory with consolidation |
| Reasoning | Every interaction = LLM call | LLM only for System 2 (10% of events) |
| Self-awareness | None | Metacognitive monitoring + confidence |
| Character | System prompt (static) | Evolving trait vector (settling) |
| Cost model | Linear with usage | Sublinear (most events are cheap) |

### 7.2 vs. Classical Cognitive Architectures (SOAR, ACT-R)

| Aspect | Classical CogArch | This Architecture |
|--------|-------------------|-------------------|
| Knowledge representation | Symbolic (production rules) | Hybrid (vector embeddings + structured data + LLM reasoning) |
| Learning | Chunking (SOAR), Bayesian (ACT-R) | Multi-mechanism (online learning, consolidation replay, LLM-based reflection) |
| Perception | Limited, task-specific | Multi-modal, continuous, cross-device |
| Natural language | Bolt-on, limited | Core capability (LLM-native) |
| Scalability | Struggles with real-world complexity | Handles open-ended domains via LLM fallback |
| Personality | Not modeled | First-class architectural component |

### 7.3 The Novel Contribution

The key insight is the **separation of concerns between System 1 and System 2 in a persistent agent context**. Classical cognitive architectures tried to model all cognition in one unified system (production rules). Modern LLM agents treat every problem as a System 2 problem (invoke the LLM). This architecture explicitly separates them, with principled interfaces between the two:

1. **Active inference for attention** — using prediction error as the salience signal, rather than keyword matching or heuristic rules. This is the first practical application of active inference to personal agent attention management.

2. **Memory consolidation as a first-class process** — not just "summarize the chat history" but a biologically-inspired replay process that extracts principles, updates schemas, and prunes noise. The daemon literally "sleeps" and wakes up with better knowledge.

3. **Metacognition as architecture, not prompt engineering** — confidence estimation, strategy selection, and learning from experience are separate computational processes, not instructions in a system prompt. They have their own data stores and their own feedback loops.

4. **Personality as modulation, not instruction** — the daemon's character is not a set of words in a prompt. It is a set of numerical biases that affect every layer of processing. It develops through experience and crystallizes over time. This is closer to how human personality actually works.

---

## 8. Implementation Path for Daemon

### Phase 1: Foundation (Weeks 1-4)

**Build the skeleton with two layers fully operational:**

1. **Working Memory** — Implement the thread-based active context system. This replaces the current "conversation history" with a structured, multi-thread working memory.
2. **Action Layer** — Already partially exists (tool execution via Claude Code). Wrap it in the execution context model (preconditions, action, result, error handling).
3. **Stub the other layers** — Perception emits events manually (user messages only). Attention passes everything through. Metacognition always escalates to Reasoning. Personality uses static traits.

This gives a daemon that works like a better version of the current architecture but with the structural foundation for everything else.

### Phase 2: System 1 (Weeks 5-8)

**Add the perception-attention pipeline:**

1. **Perception** — Connect device sensors, calendar, email, system events. Implement temporal pattern extraction. Deploy on-device monitors.
2. **Attention** — Implement salience scoring with simple prediction error (deviation from learned baseline). Priority queue. Interrupt mechanism.
3. **Result:** The daemon starts noticing things on its own and deciding what's worth the user's attention.

### Phase 3: Memory (Weeks 9-12)

**Implement the three-memory system and consolidation:**

1. **Semantic Memory** — Structured user knowledge graph in Qdrant (already exists in primitive form).
2. **Episodic Memory** — Conversation compression, action logging, significance scoring.
3. **Procedural Memory** — Skill definition format, trigger matching, workflow learning.
4. **Consolidation** — Nightly process: compress, extract, prune. Start with Gemini Flash for compression.
5. **Result:** The daemon remembers, forgets appropriately, and gets smarter over time.

### Phase 4: Metacognition + Personality (Weeks 13-16)

**Add self-awareness and character:**

1. **Confidence estimation** — Train on the daemon's own history (action outcomes, user corrections).
2. **Strategy selection** — Implement the strategy menu, track strategy performance.
3. **Personality settling** — Implement the dampened oscillation model, connect to all layer modulation points.
4. **Result:** The daemon knows when it is uncertain, chooses how to think, and develops a stable character.

---

## 9. Open Questions

1. **How much System 1 can run on-device with current mobile hardware?** The Pixel 8 Pro has a Tensor G3 — can it run useful pattern recognition models locally? Battery impact needs empirical measurement.

2. **What is the right consolidation frequency?** Nightly may be too infrequent for active users. Should consolidation be event-triggered (after N episodes accumulate) rather than time-triggered?

3. **How do you evaluate metacognitive accuracy?** If the daemon estimates 80% confidence and is correct 80% of the time, it is well-calibrated. But how do you get enough samples for calibration in a personal agent context where each situation is somewhat unique?

4. **Can personality settling be adversarially manipulated?** If someone deliberately gives inconsistent feedback, can they destabilize the daemon's personality? The dampened oscillation model should resist this (learning rate decays), but it needs adversarial testing.

5. **What is the interaction between Personality and Metacognition?** A "cautious" daemon should have higher confidence thresholds for autonomous action. But should the caution trait affect the *estimation* of confidence, or only the *threshold* for action? (Answer: only the threshold. The estimation should be objective.)

6. **Multi-user personality divergence.** If the daemon eventually serves multiple users (family, team), does it develop different personality facets for each? Or one consistent personality? Biological analogy: humans code-switch but maintain a core identity.

---

## 10. Conclusion

The architecture proposed here is not a metaphor. It is a concrete engineering specification for a system that can be built with current technology. Every layer maps to specific algorithms, models, and data stores. The theoretical foundations — Global Workspace Theory, dual-process cognition, active inference, memory consolidation, metacognition — are not decorative citations. Each one solves a specific practical problem:

- **GWT** solves the broadcast problem (how do specialized modules share information?)
- **Dual-process theory** solves the cost problem (how do you run a persistent agent without burning money?)
- **Active inference** solves the attention problem (how do you decide what matters?)
- **Memory consolidation** solves the knowledge management problem (how do you remember without drowning in data?)
- **Metacognition** solves the reliability problem (how does the agent know when to trust itself?)
- **Affective modulation** solves the character problem (how does an agent feel like someone, not something?)

The result is a daemon that does not merely respond to prompts. It perceives, attends, remembers, reasons, acts, reflects, and develops — continuously, across all of a user's devices, over months and years. It is not conscious. But it has the functional architecture that consciousness research suggests would be necessary for coherent, adaptive, self-aware behavior.

The current generation of AI agents is impressive but architecturally impoverished. They are all System 2 — all expensive reasoning, all the time, with no sense of what matters and no memory of what they have learned. The next generation needs an inner life. This paper describes what that inner life looks like.

---

## References

- Baars, B. J. (1988). *A Cognitive Theory of Consciousness.* Cambridge University Press.
- Clark, A. (2013). Whatever next? Predictive brains, situated agents, and the future of cognitive science. *Behavioral and Brain Sciences*, 36(3), 181-204.
- Damasio, A. R. (1994). *Descartes' Error: Emotion, Reason, and the Human Brain.* Putnam.
- Dehaene, S., & Changeux, J. P. (2011). Experimental and theoretical approaches to conscious processing. *Neuron*, 70(2), 200-227.
- Evans, J. S. B., & Stanovich, K. E. (2013). Dual-process theories of higher cognition: Advancing the debate. *Perspectives on Psychological Science*, 8(3), 223-241.
- Friston, K. (2010). The free-energy principle: a unified brain theory? *Nature Reviews Neuroscience*, 11(2), 127-138.
- Goldstein, A., & Kirk, R. (2024). A Case for AI Consciousness: Language Agents and Global Workspace Theory. *arXiv:2410.11407.*
- Gonzalez, O. C., et al. (2022). Sleep-like unsupervised replay reduces catastrophic forgetting in artificial neural networks. *Nature Communications*, 13, 7742.
- Kahneman, D. (2011). *Thinking, Fast and Slow.* Farrar, Straus and Giroux.
- McClelland, J. L., McNaughton, B. L., & O'Reilly, R. C. (1995). Why there are complementary learning systems in the hippocampus and neocortex. *Psychological Review*, 102(3), 419-457.
- Nelson, T. O., & Narens, L. (1990). Metamemory: A theoretical framework and new findings. *Psychology of Learning and Motivation*, 26, 125-173.
- Tutuncuoglu, B. T. (2025). NeuroDream: A Sleep-Inspired Memory Consolidation Framework for Artificial Neural Networks. *SSRN 5377250.*
- van de Ven, G. M., Siegelmann, H. T., & Tolias, A. S. (2020). Brain-inspired replay for continual learning with artificial neural networks. *Nature Communications*, 11, 4069.
