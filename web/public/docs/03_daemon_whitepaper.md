# Daemon: A Capability-Attenuated Architecture for Sovereign Personal AI Agents

**Arthur Camara**
*April 2026*

**Abstract.** Current personal AI systems force a choice between capability and sovereignty. Cloud-hosted agents are powerful but hold the user's data, context, and relationship hostage to a platform. Local-only systems preserve privacy but sacrifice the intelligence that requires scale. We propose *daemon*, an architecture for personal AI agents that resolves this tradeoff through three mechanisms: (1) a device mesh protocol that unifies heterogeneous personal devices into a single logical computer without centralizing data, (2) a capability-attenuated trust system based on cryptographic tokens that provably constrains agent actions to earned authority, and (3) a convergent personality engine whose state is deterministic given interaction history, making identity both portable and verifiable. We show that these three mechanisms are sufficient to construct a personal AI agent that is sovereign (no platform can revoke it), trustworthy (its permissions are formally bounded), and persistent (its identity is a mathematical function of the relationship, not a corporate asset). A reference implementation is described.

---

## 1. Introduction

The dominant paradigm for personal AI is a contradiction. The user discloses intimate context --- schedules, messages, files, voice, location --- to an agent hosted on infrastructure they do not control, governed by terms they did not negotiate, which can be modified, lobotomized, or terminated by a unilateral corporate decision. In February 2023, Replika removed its romantic companion features overnight; researchers at Harvard Business School documented responses from affected users "akin to what we would expect of losing a real human relationship, such as mourning and deteriorated mental health" [1]. Character.ai, Bing Chat, and successive generations of cloud-hosted AI companions have demonstrated the same pattern: users form genuine attachments to entities they do not own.

This is not a bug in any particular product. It is the inevitable consequence of an architecture in which the agent's state --- its memory, personality, and accumulated context --- resides on the provider's servers. The user does not possess their AI. They rent access to it.

The problem has three independent dimensions:

**The fragmentation problem.** A person's digital life is distributed across dozens of devices and services. Their phone knows their location and contacts. Their laptop knows their code and documents. Their server knows their deployments. Their smart home knows their routines. No single agent can access all of this context, because no single agent operates across all of these surfaces. Existing solutions (Apple Intelligence, Google Assistant, Alexa) unify only within their own ecosystem, creating walled gardens that exclude the devices and services that do not participate.

**The trust problem.** Giving an AI agent access to shell, filesystem, network, camera, and microphone across multiple devices creates an attack surface that is both vast and intimate. Current approaches are binary: either the agent asks permission for every action (safe but unusable at scale), or the agent operates autonomously within opaque boundaries (powerful but unverifiable). Neither approach produces trust. The first produces fatigue. The second produces anxiety.

**The sovereignty problem.** When the agent's state is held by a platform, the platform is sovereign. The user cannot migrate their agent, cannot guarantee its persistence, and cannot verify that their data is not being used for purposes beyond their intent. Data sovereignty regulations (GDPR, CCPA, Singapore's AI Agent Governance Framework of January 2026) attempt to constrain this relationship through law, but legal constraints are reactive. An architectural guarantee is stronger than a contractual one.

We claim that these three problems are not merely related but *structurally isomorphic*: each arises from the absence of a mechanism for provably bounded delegation. The user cannot delegate authority to an agent in a way that is simultaneously verifiable, attenuable, and independent of any third party. This paper describes such a mechanism and the architecture it enables.

---

## 2. Related Work

### 2.1 Cloud-hosted AI agents

Commercial AI assistants (Siri, Google Assistant, Alexa, Copilot) operate as cloud services with thin on-device proxies. The agent's reasoning, memory, and personality are server-side. This architecture enables powerful inference but creates complete dependence on the provider's infrastructure, policies, and continued existence. OpenAI's "memory" feature (2024), Anthropic's Claude artifacts (2024), and Google's Gemini Deep Research (2025) incrementally add persistence but do not change the fundamental topology: the user's context flows to the provider's servers.

### 2.2 Local-first AI

Projects including Ollama, LM Studio, Jan, and OpenJarvis [2] run language models on consumer hardware. These preserve data sovereignty by construction but face two constraints: (a) local models are significantly less capable than frontier cloud models for complex reasoning and tool use, and (b) a single device cannot access the user's full context, which is distributed across multiple machines. OpenJarvis proposes composable on-device primitives but does not address cross-device orchestration or the trust model for agent actions.

### 2.3 Device mesh and synchronization

Apple's Continuity framework, Samsung's SmartThings, and Matter/Thread enable device interoperability within ecosystems. CRDTs (Automerge [3], Yjs) and sync engines (Replicache, ElectricSQL) enable conflict-free multi-device state. None of these systems are designed for agent orchestration --- they synchronize data, not authority. A daemon needs to not only read the state of multiple devices but *act* on them, which requires a delegation model, not just a replication model.

### 2.4 Capability-based security

The object-capability model (OCAP) [4] enforces access control through unforgeable references. A capability is simultaneously a designation (it names a resource) and an authority (it grants permission to act on that resource). Capabilities compose naturally: a holder can attenuate a capability (reduce its scope) and delegate it (pass it to another principal), but cannot forge or escalate it. The seL4 microkernel [5] demonstrated formal verification of capability-based isolation. Macaroons [6] extended the model to distributed systems using chained HMACs for offline-verifiable, attenuable authorization tokens. Biscuits [7] improved on macaroons with public-key cryptography and a structured authorization logic (Datalog). UCAN [8] applied capability delegation to decentralized identity using DIDs.

### 2.5 AI agent security

The OWASP AI Agent Security Cheat Sheet (2026), Atos Sovereign Agentic Studio (2026), and the Cloud Security Alliance's Agentic Trust Framework define enterprise governance patterns: kill switches, audit trails, purpose-binding. These are compliance frameworks, not architectural primitives. They constrain agents externally through policy rather than internally through structure. Tenuo (2025) proposed capability-based authorization for AI tool calls using cryptographic warrants, but applies it only to enterprise tool delegation, not to personal agent sovereignty.

### 2.6 The gap

No existing system addresses all three problems simultaneously. Cloud agents solve fragmentation (within their ecosystem) but sacrifice sovereignty. Local agents preserve sovereignty but cannot span devices. Capability systems solve trust but have not been applied to the specific topology of a personal AI agent operating across heterogeneous personal devices. This paper fills that gap.

---

## 3. Architecture

### 3.1 Overview

A daemon is a persistent AI agent that operates across a user's personal devices. It consists of four layers:

```
  +------------------------------------------+
  |           PERSONALITY LAYER               |
  |  Convergent character engine, settling    |
  +------------------------------------------+
  |           COGNITION LAYER                 |
  |  LLM inference (cloud or local), tools    |
  +------------------------------------------+
  |           TRUST LAYER                     |
  |  Capability tokens, action classification |
  +------------------------------------------+
  |           MESH LAYER                      |
  |  Device registry, sync, orchestration     |
  +------------------------------------------+
```

The mesh layer unifies devices. The trust layer bounds agent actions. The cognition layer provides intelligence. The personality layer creates identity. Each layer is independent: the mesh layer functions without the personality layer; the trust layer constrains the cognition layer regardless of which LLM powers it.

### 3.2 The mesh layer

**Definition 1.** A *device mesh* $M$ is a set of devices $\{d_1, d_2, \ldots, d_n\}$ belonging to a single user, each possessing a unique Ed25519 keypair $(sk_i, pk_i)$, connected via pairwise-authenticated channels (SSH, WireGuard, or WebSocket over TLS with mutual certificate pinning).

**Definition 2.** A *device capability set* $C(d_i)$ is the set of actions device $d_i$ can perform: $C(d_i) = \{c_{i,1}, c_{i,2}, \ldots\}$. Examples: `shell.execute`, `file.read`, `file.write`, `camera.capture`, `mic.listen`, `sensor.read`, `ir.transmit`, `rf.transmit`, `gpio.set`.

**Property 1 (Additive capability).** The capability set of the mesh is the union of device capabilities: $C(M) = \bigcup_{i=1}^{n} C(d_i)$. Adding a device to the mesh can only increase the total capability set. It cannot reduce or modify capabilities of existing devices.

The mesh layer does not synchronize all data. It synchronizes *state metadata* (what exists, where, when it changed) and pulls *content* on demand. This is the content-addressed lazy-pull model: devices advertise SHA-256 hashes of their state segments; other devices pull the content behind those hashes only when needed. This ensures that a phone does not store laptop files and vice versa, while the daemon can reason about the entire state space.

**Sync protocol.** Each device maintains a Lamport clock $L_i$. All state mutations are recorded as operations in an append-only log with entries $(L_i, d_i, \text{op}, \text{payload\_hash})$. Devices exchange operation logs and merge by Lamport-timestamp ordering. Conflicts (concurrent writes to the same key from different devices while both were offline) are resolved by Last-Write-Wins per field with device priority as tiebreaker. This is sufficient because the user operates one device at a time; true concurrent conflicts are rare and low-stakes (personality trait values, user preferences).

### 3.3 The trust layer

This is the core contribution. The daemon's authority over the user's devices is not granted as a blanket permission. It is constructed from attenuable, verifiable, expiring capability tokens.

**Definition 3.** A *daemon capability token* $T$ is a Biscuit token [7] containing:

- An *authority block* issued by the user's root keypair: $\text{authority}(pk_\text{user}, \text{capabilities}, \text{constraints})$
- Zero or more *attenuation blocks*, each of which can only narrow the authority: $\text{attenuate}(T, \text{new\_constraints}) \rightarrow T'$ where $C(T') \subseteq C(T)$
- A *TTL* (time-to-live): the token expires and must be re-derived

**Theorem 1 (Non-escalation).** Given a daemon capability token $T$ with capability set $C(T)$, no sequence of operations by the daemon can produce a token $T'$ where $C(T') \not\subseteq C(T)$.

*Proof sketch.* Biscuit tokens are constructed such that each attenuation block is cryptographically signed by the holder's key but can only add Datalog constraints (caveats) that further restrict the authority. The verification algorithm checks that for every requested capability, the conjunction of all caveats in the chain is satisfied. Adding a block can add constraints but cannot remove them. Forging an authority block requires the user's root private key. Therefore the capability set can only shrink along the delegation chain. $\square$

This property is not novel to Biscuit tokens. What is novel is its application to the personal AI agent problem. The daemon does not hold a God-mode SSH key. It holds a capability token that says, precisely:

```
// Example: daemon can read files on laptop, but only under ~/projects
// and only for the next 24 hours
authority(user_root_key):
  right("laptop", "file.read", "/home/user/projects/*")
  check if time($time), $time < 2026-04-02T00:00:00Z

// The daemon can further attenuate when delegating to a sub-agent
attenuation:
  check if resource($r), $r.starts_with("/home/user/projects/daemon/")
```

**Action classification.** Every action the daemon might take is classified along two axes:

|                 | Reversible | Irreversible |
|-----------------|-----------|-------------|
| **Low impact**  | Act silently | Act, notify |
| **High impact** | Act, notify | Always ask |

The classification is not static. It is a function $\sigma: A \times H \rightarrow \{0, 1, 2, 3\}$ where $A$ is the set of possible actions and $H$ is the trust history. An action that required explicit confirmation at week 1 may be auto-approved at month 6 if the daemon has executed it successfully $k$ times without negative feedback.

**Definition 4.** The *trust ledger* $\mathcal{L}$ is an append-only log of $(action, outcome, timestamp, user\_feedback)$ tuples. The trust score for action class $a$ is:

$$\tau(a) = \frac{\sum_{i : a_i = a} w(o_i, f_i)}{\sum_{i : a_i = a} 1}$$

where $w(o_i, f_i)$ assigns weight based on outcome ($o$: success, failure, error) and user feedback ($f$: positive, negative, neutral, none). When $\tau(a)$ exceeds a threshold $\theta$ and the sample size exceeds a minimum $n_{\min}$, the action's classification migrates one cell toward greater autonomy.

This is the progressive autonomy model: trust is not configured, it is *computed* from evidence.

### 3.4 The cognition layer

The daemon's intelligence is provided by a language model, which may be a cloud API (Anthropic Claude, Google Gemini, OpenAI) or a local model (via Ollama, llama.cpp, or a dedicated AI accelerator). The architecture is agnostic to the provider.

The cognition layer receives:

1. The user's message
2. Relevant context from the knowledge graph (retrieved by semantic similarity from a local vector database)
3. The current personality state (see Section 3.5)
4. The set of available capabilities (the capability token's current scope)
5. The trust ledger summary (which actions require confirmation)

The cognition layer produces:

1. A response to the user
2. Zero or more *action requests*, each specifying a capability, target device, and parameters

Each action request is validated against the capability token before execution. If the token does not authorize the action, the request is rejected regardless of the LLM's intent. The LLM cannot bypass the trust layer through prompt injection, hallucination, or adversarial manipulation, because the trust layer operates on the cryptographic token, not on the LLM's output.

**Property 2 (Injection resistance).** A prompt injection attack that causes the LLM to emit an unauthorized action request results in a token verification failure at the trust layer. The attack cannot escalate privileges because the capability token is not derived from the LLM's output. It is derived from the user's root key.

This is the architectural separation that distinguishes daemon from agent frameworks that embed permissions in the system prompt. System-prompt permissions are as strong as the LLM's ability to follow instructions --- i.e., not very strong. Cryptographic token permissions are as strong as the underlying signature scheme.

### 3.5 The personality layer

The daemon develops a persistent personality through a process called *settling*, inspired by the daemon-settling metaphor in Pullman's *His Dark Materials* [9].

**Definition 5.** The *personality state* $P$ is a vector in $\mathbb{R}^k$ where each dimension represents a behavioral axis: $P = (p_1, p_2, \ldots, p_k)$. In the reference implementation, $k = 5$ with axes: Tempo (slow--fast), Temperature (cool--warm), Density (sparse--dense), Stance (receptive--assertive), Register (concrete--abstract).

**Definition 6.** The *settling function* $S: P \times \Delta \rightarrow P$ maps the current personality state and a batch of recent interactions $\Delta$ to a new personality state:

$$P_{t+1} = S(P_t, \Delta_t) = P_t + \alpha(t) \cdot \nabla_P \mathcal{F}(P_t, \Delta_t)$$

where $\mathcal{F}$ is a fitness function measuring alignment between personality state and interaction patterns (computed by analyzing user satisfaction signals: engagement length, follow-up questions, explicit corrections, abandonment), and $\alpha(t)$ is a learning rate that *decreases monotonically* with time:

$$\alpha(t) = \frac{\alpha_0}{1 + \beta t}$$

This decreasing learning rate is the formal expression of settling. Early interactions produce large personality shifts. Later interactions produce small refinements. The personality converges.

**Theorem 2 (Convergence).** Given a user with stationary interaction patterns (i.e., their communication preferences are drawn from a fixed distribution), the settling function converges: $\lim_{t \to \infty} \|P_{t+1} - P_t\| = 0$.

*Proof sketch.* Since $\alpha(t) \to 0$ as $t \to \infty$ and the gradient $\nabla_P \mathcal{F}$ is bounded (the personality space is compact), the update magnitude $\|\alpha(t) \cdot \nabla_P \mathcal{F}\| \to 0$. This is a standard result for decreasing step-size stochastic gradient descent on a bounded domain [10]. $\square$

**Property 3 (Determinism).** Given the same interaction history $\{\Delta_0, \Delta_1, \ldots, \Delta_T\}$ and the same initial state $P_0$, the settling function produces the same final state $P_T$. The daemon's personality is a deterministic function of the relationship history.

This property is what makes daemon identity portable and verifiable. The personality is not a random configuration or a user-selected preset. It is computed from data. Two devices holding the same interaction log will compute the same personality. A user migrating between platforms carries their interaction history; the personality is reconstructed, not transferred.

**Property 4 (Irreversibility of settling).** While the personality state can be forked (copied at a point in time), it cannot be "reset to factory" without discarding interaction history. This is by design: the accumulated weight of shared experience is the relationship. A daemon that can be trivially reset is a chatbot; a daemon that carries history is a companion.

---

## 4. The Sovereignty Guarantee

The three layers compose to produce a property that no existing personal AI system provides:

**Theorem 3 (Sovereignty).** A daemon whose mesh layer operates on user-owned devices, whose trust layer uses capability tokens rooted in the user's keypair, and whose personality layer is deterministic given interaction history, is sovereign: its existence, authority, and identity are independent of any third party.

*Proof.* We show independence along each dimension:

1. *Existence.* The daemon's state (conversation logs, knowledge graph, personality vector, trust ledger) resides on user-owned devices and is synchronized via the mesh layer. No server holds authoritative state. If the daemon platform company ceases to exist, the state persists on the user's devices. The cognition layer's LLM dependency is provider-agnostic: the user can switch from a cloud API to a local model without losing state.

2. *Authority.* The daemon's capability tokens are rooted in the user's Ed25519 keypair. No third party can issue, revoke, or modify these tokens. The user is the root of the trust chain. The platform provides the runtime but does not control the trust relationship.

3. *Identity.* The daemon's personality is a deterministic function of interaction history (Theorem 2, Property 3). The interaction history is stored on user-owned devices. Therefore the daemon's identity is reconstructable from user-owned data alone. No platform holds the "soul" of the daemon.

In each case, the guarantee is architectural, not contractual. It does not depend on a privacy policy, a terms-of-service document, or regulatory compliance. It is a consequence of the system's structure. $\square$

---

## 5. Security Analysis

### 5.1 Threat model

We consider three adversary classes:

1. **Compromised LLM.** The language model produces malicious action requests (via prompt injection, hallucinated tool calls, or adversarial training data). This is the most likely attack vector for personal AI agents.

2. **Compromised device.** One device in the mesh is under adversary control (malware, physical access, stolen device).

3. **Compromised platform.** The daemon software provider is malicious or coerced (state actor, corporate acquisition, insider threat).

### 5.2 Defense against compromised LLM

The trust layer validates every action request against the capability token. The LLM has no mechanism to modify, forge, or bypass the token. Even if the LLM is instructed (via prompt injection from a poisoned knowledge graph entry, a malicious webpage, or an adversarial user message) to exfiltrate data, the exfiltration action (e.g., `network.send` to an external host) either falls outside the token's scope (rejected) or falls within scope but is classified as high-impact/irreversible (requires user confirmation). The layered defense means that exploitation requires *both* a successful prompt injection *and* a token that permits the injected action --- the conjunction of which the user controls.

### 5.3 Defense against compromised device

When a device is compromised, the adversary gains access to that device's local state and its delegated capability tokens. The damage is bounded by:

- **Capability attenuation.** Tokens delegated to a device are attenuated to that device's role. A phone's token permits `camera.capture` and `mic.listen` but not `shell.execute` on the server. A compromised phone cannot escalate to server access.
- **Token expiry.** Tokens have TTLs. A stolen device's tokens expire and are not renewed (the mesh layer detects the device as unresponsive and the user can revoke the device's keypair).
- **Content-addressed sync.** The compromised device can read its local state but cannot force other devices to pull poisoned state, because state segments are identified by SHA-256 hash and signed by the originating device.

**Formal bound.** The maximum damage from a compromised device $d_i$ is bounded by $C(T_{d_i})$ --- the capability set of the token delegated to $d_i$ at the time of compromise, intersected with the data locally cached on $d_i$. This is strictly less than the user's full authority.

### 5.4 Defense against compromised platform

The daemon platform provides the software runtime (the agent framework, the web interface, the Android app). A compromised platform could ship a malicious update. This is the supply-chain attack and is the hardest to defend against in any software system. Daemon mitigates this through:

- **Open-source runtime.** The agent framework, mesh layer, and trust layer are open-source and auditable. The personality engine is open-core (the settling algorithm is proprietary, but its inputs and outputs are inspectable).
- **Reproducible builds.** Published builds can be verified against source.
- **Local-first data.** Even a malicious runtime update cannot exfiltrate data that is not present on the device running the update. The mesh layer's lazy-pull design means no single device holds the complete state.
- **Capability token root.** The user's root keypair is generated and stored on-device. The platform never holds the private key. A malicious platform cannot forge capability tokens.

### 5.5 The camera/microphone problem

Sensory capabilities (camera, microphone) are the most privacy-sensitive actions a daemon can take. The trust layer treats them as permanently high-impact. In the hardware reference implementation, the microphone's power supply and warning indicator are physically the same copper trace --- the microphone cannot be powered without activating the LED. This is a hardware-enforced invariant that no software compromise can violate.

For software-only deployments (phone, laptop), the daemon relies on OS-level indicators (Android's green camera/mic dot since Android 12, macOS's orange mic dot since Monterey) combined with explicit session semantics: a camera or microphone session must be initiated with user confirmation, has a fixed duration, and auto-expires.

---

## 6. Comparison with Alternative Approaches

| Property | Cloud agents (Siri, Alexa, Copilot) | Local-only (Ollama, Jan) | Enterprise agents (Copilot Studio) | Daemon |
|----------|-------------------------------------|--------------------------|------------------------------------|----|
| Cross-device context | Within ecosystem only | Single device | Within enterprise | Any device the user owns |
| Data sovereignty | Provider holds data | User holds data | Enterprise holds data | User holds data |
| Agent persistence | Provider-dependent | Session-based | IT-admin-dependent | User-guaranteed |
| Trust model | Opaque | N/A (no agent actions) | Policy-based (ACLs) | Capability-attenuated (cryptographic) |
| Personality | Fixed or absent | Absent | Absent | Convergent, deterministic |
| Provider lock-in | Complete | None (model only) | Complete | None (architecture-level) |
| Formal privilege bound | No | No | Partial (policy, not proof) | Yes (Theorem 1) |

---

## 7. Implementation

The reference implementation consists of:

- **Mesh layer.** SSH (for Linux/macOS devices), WireGuard (for always-on tunnels), and WebSocket over TLS (for Android and constrained devices). Device registration via QR code containing the device's public key. Sync protocol implemented as an append-only operation log with Lamport timestamps.

- **Trust layer.** Biscuit tokens generated by a root keypair stored in the OS keychain (Keystore on Android, Keychain on macOS, libsecret on Linux). Token management CLI and GUI for inspecting, attenuating, and revoking capabilities.

- **Cognition layer.** Provider-agnostic LLM interface supporting Anthropic Claude (via API), Google Gemini (via API), OpenAI (via API), and local models (via Ollama). Tool definitions follow the Model Context Protocol (MCP) [11]. Smart tool loading: tool definitions are injected into the LLM context only when the message is classified as requiring device interaction, reducing token cost and latency for simple conversations.

- **Personality layer.** Five-axis personality vector stored as JSON. Settling algorithm runs after every $N = 20$ interactions by analyzing the interaction batch with a lightweight model (Gemini Flash or local model), extracting satisfaction signals, computing the gradient, and updating the vector. The personality state is included in the LLM system prompt and shapes response style.

- **Hardware reference.** A custom circuit board (160 components) mounted on an Orange Pi 3B single-board computer, adding: sub-GHz radio (CC1101), LoRa (SX1262), NFC (PN532), infrared, RS-485, I2S audio (INMP441 microphone, MAX98357A amplifier), 1.69" display (ST7789V2), WS2812B status LEDs, USB-C power management (IP5328P), and the hardware mic privacy interlock.

---

## 8. Limitations and Future Work

**LLM dependence.** The cognition layer currently requires a capable language model. Local models (7B--70B parameters) are sufficient for routine tasks but fall behind frontier cloud models for complex multi-step reasoning. As local inference hardware improves (dedicated NPUs, Hailo-8L), this gap will narrow. The architecture is designed to be LLM-agnostic; improvements in any model immediately improve the daemon.

**Settling validation.** Theorem 2 assumes stationary user interaction patterns. In practice, users change: they learn, they age, their interests shift. The settling function should adapt to non-stationary distributions while preserving the convergence property. Adaptive learning rate schedules (e.g., resetting $\alpha$ when distribution shift is detected) are a straightforward extension but require empirical tuning.

**Formal verification.** The trust layer's non-escalation property (Theorem 1) inherits from Biscuit's cryptographic construction, which has been formally analyzed. A full formal verification of the daemon's trust layer implementation (as seL4 achieved for the capability model) is desirable but beyond the scope of this work.

**Multi-user.** This paper addresses single-user daemons. Household scenarios (shared devices, family members, guests) require additional access control mechanisms. Preliminary design uses per-user token roots with explicit cross-user delegation, but this is not yet implemented.

**Daemon-to-daemon.** When two users' daemons are in proximity (detected via Bluetooth or the sub-GHz radio), they could exchange information with mutual consent. The capability model extends naturally: each daemon holds a token attenuated to "share name, share availability" that the user can expand or restrict. Protocol design for daemon-to-daemon interaction is future work.

---

## 9. Conclusion

The personal AI agent problem is structurally analogous to the electronic cash problem that Bitcoin addressed [12]: both require a mechanism for trustworthy transaction (of value in Bitcoin's case, of authority in the daemon's case) without dependence on a trusted third party. Bitcoin's proof-of-work chain solved the double-spending problem by making transaction history computationally expensive to forge. The daemon's capability-attenuated trust layer solves the delegation problem by making privilege escalation cryptographically impossible to forge.

The key insight is that personal AI sovereignty is not a feature to be added to existing architectures. It is a property that emerges from the correct composition of three independent mechanisms: a device mesh that aggregates capability without centralizing data, a trust system that delegates authority without permitting escalation, and a personality engine that creates identity without depending on a platform. Each mechanism solves one dimension of the problem. Their composition solves all three simultaneously.

The daemon is not a product concept dressed in technical language. It is an architecture that makes a specific guarantee: the user's AI agent, its memory, its personality, and its authority belong to the user --- provably, portably, and permanently.

---

## References

[1] Pentina, I., Xie, T., Hancock, T., & Bailey, A. (2023). "Consumer-AI Relationship and Perceived Social Presence: Emotional Responses to Replika Chatbot Personality Changes." *Harvard Business School Working Paper*.

[2] Stanford Scaling Intelligence Lab. (2026). "OpenJarvis: Personal AI, On Personal Devices." https://scalingintelligence.stanford.edu/blogs/openjarvis/

[3] Kleppmann, M., & Beresford, A. R. (2017). "A Conflict-Free Replicated JSON Datatype." *IEEE Transactions on Parallel and Distributed Systems*, 28(10).

[4] Miller, M. S., Yee, K-P., & Shapiro, J. (2003). "Capability Myths Demolished." *Technical Report SRL2003-02*, Systems Research Laboratory, Johns Hopkins University.

[5] Klein, G., et al. (2009). "seL4: Formal Verification of an OS Kernel." *Proceedings of the 22nd ACM Symposium on Operating Systems Principles (SOSP)*.

[6] Birgisson, A., Politz, J. G., Erlingsson, U., Taly, A., Vrable, M., & Lentczner, M. (2014). "Macaroons: Cookies with Contextual Caveats for Decentralized Authorization in the Cloud." *Network and Distributed System Security Symposium (NDSS)*.

[7] Geal, G. (2019-2026). "Biscuit: Decentralized Authorization Token with Offline Attenuation." Eclipse Foundation. https://www.biscuitsec.org/

[8] UCAN Working Group. (2022-2026). "User Controlled Authorization Network (UCAN) Specification." https://ucan.xyz/specification/

[9] Pullman, P. (1995-2000). *His Dark Materials* trilogy. Scholastic.

[10] Robbins, H., & Monro, S. (1951). "A Stochastic Approximation Method." *The Annals of Mathematical Statistics*, 22(3), 400--407.

[11] Anthropic. (2024-2026). "Model Context Protocol (MCP)." https://modelcontextprotocol.io/

[12] Nakamoto, S. (2008). "Bitcoin: A Peer-to-Peer Electronic Cash System." https://bitcoin.org/bitcoin.pdf

---

*This paper describes the architecture of Daemon, an open-core platform for sovereign personal AI agents. The reference implementation is available at https://daemon.page. Correspondence: arthur@daemon.page*
