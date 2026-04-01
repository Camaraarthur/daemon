# Local-First Architecture for AI Agents

*Research document — 2026-04-01*
*The technical foundation of "your data stays on your devices."*

---

## Table of Contents

1. [The Local-First Manifesto](#1-the-local-first-manifesto)
2. [CRDTs: The Sync Primitive](#2-crdts-the-sync-primitive)
3. [End-to-End Encrypted Sync](#3-end-to-end-encrypted-sync)
4. [The Fundamental Tension: AI Needs Data](#4-the-fundamental-tension-ai-needs-data)
5. [Solution Space](#5-solution-space)
   - 5.1 On-Device AI
   - 5.2 Secure Enclaves / Confidential Computing
   - 5.3 Homomorphic Encryption
   - 5.4 Hybrid Split Inference
   - 5.5 Federated Learning
6. [Apple Private Cloud Compute: The Gold Standard](#6-apple-private-cloud-compute)
7. [Multi-Device Key Management](#7-multi-device-key-management)
8. [Daemon Crypto Protocol Design](#8-daemon-crypto-protocol-design)
9. [What's Practical Today vs. 2028](#9-whats-practical-today-vs-2028)
10. [Architecture Decision for Daemon](#10-architecture-decision-for-daemon)

---

## 1. The Local-First Manifesto

Ink & Switch published "Local-first software: You own your data, in spite of the cloud" in 2019. It defined the philosophical and technical foundation for software that gives users real ownership.

### The Seven Ideals

1. **Fast.** No spinners. Data is local, so reads/writes are instant. No round-trip to a server.
2. **Multi-device.** Your data lives on all your devices and stays in sync.
3. **Offline.** Full read/write capability without network. Sync when reconnected.
4. **Collaboration.** Real-time multi-user editing on par with Google Docs.
5. **Longevity.** Data outlives the software company. No server means no shutdown risk.
6. **Privacy.** End-to-end encryption by default. The server (if any) sees ciphertext only.
7. **User control.** No company can lock you out of your own data.

At Local-First Conf 2024, Martin Kleppmann refined the definition: "In local-first software, the availability of another computer should never prevent you from working."

### Why This Matters for Daemon

Daemon is a multi-device AI agent. The user's conversation history, knowledge graph, device configurations, and personal context are the most sensitive data imaginable — it's literally a map of how someone thinks. If that data lives on a server we control, we become a target and a liability. If it lives on the user's devices, encrypted with keys only they hold, then:

- We can't be compelled to hand over user data (we don't have it)
- A breach of our servers leaks nothing useful (ciphertext only)
- The daemon works offline (local data, local small model)
- Users can leave and take everything with them (data portability)

---

## 2. CRDTs: The Sync Primitive

Conflict-free Replicated Data Types (CRDTs) are data structures that can be modified independently on different devices and merged automatically without conflicts. They are the technical enabler of local-first sync.

### The Three Contenders

| Library | Model | Strengths | Weaknesses |
|---------|-------|-----------|------------|
| **Automerge** | JSON document CRDT | Familiar JSON API, multi-language (Rust core, JS/Python/Swift bindings), v3 achieved 10x memory reduction | Historically slower than Yjs, larger wire format |
| **Yjs** | Composable CRDT primitives | Fastest CRDT library in benchmarks, modular architecture, massive ecosystem (ProseMirror, Monaco, CodeMirror) | JavaScript-first, less natural for non-text data |
| **cr-sqlite** | CRDT-enhanced SQLite | Relational data model, familiar SQL, works with existing SQLite tooling | Newer, smaller community, merging semantics less proven at scale |

### CRDTs + Encryption: The Hard Problem

CRDTs require examining data to merge it. Encryption hides data. This is a fundamental conflict.

**Approaches:**

1. **Encrypt-then-CRDT.** Each device decrypts locally, applies CRDT operations in plaintext, then encrypts before sending updates. The server stores and relays ciphertext but never merges — it's a dumb pipe. Merge happens on each device after decryption. This is the practical approach.

2. **Operation-based CRDTs with encrypted operations.** Send encrypted operations rather than encrypted state. The server can relay operations without understanding them. Each device decrypts and applies. Works if operations are commutative (order doesn't matter).

3. **Metadata-only CRDTs.** Keep CRDT metadata (vector clocks, timestamps) unencrypted for the server to route and order, but encrypt all payload data. Leaks operation timing and frequency but not content.

**For Daemon:** Approach 1 (encrypt-then-CRDT, client-side merge) is the right choice. The server is a relay, not a participant.

### Recommendation for Daemon

**cr-sqlite** is the best fit. Daemon's data is fundamentally relational — conversations, knowledge entries, device records, user preferences. Using SQLite with CRDT extensions means:

- The knowledge graph already uses structured data (Qdrant entries have metadata fields)
- Conversation history is naturally tabular (messages, threads, timestamps)
- SQLite is available on every platform (Android, iOS, Linux, Windows, ESP32 via littlefs)
- Queries work — you can SELECT, JOIN, filter. CRDTs on JSON blobs don't give you that.

**Automerge** is the fallback if cr-sqlite proves immature. Its JSON document model maps well to daemon configuration and preferences.

---

## 3. End-to-End Encrypted Sync

### Signal Protocol

The Signal Protocol is the gold standard for E2EE messaging. Key concepts:

- **Double Ratchet Algorithm:** Each message uses a unique key derived from a ratcheting chain. Compromise of one key doesn't reveal past or future messages (forward secrecy + future secrecy).
- **X3DH (Extended Triple Diffie-Hellman):** Asynchronous key agreement. Devices can establish shared secrets even when the other party is offline, using pre-uploaded "prekeys."
- **PQXDH:** Post-quantum extension (added 2024), adds protection against future quantum computers.
- **Sesame:** Multi-device session management protocol. Each device has its own cryptographic identity. Messages are encrypted separately for each recipient device.

### Matrix Protocol (Olm/Megolm)

- **Olm:** Implementation of the Double Ratchet, similar to Signal's.
- **Megolm:** Optimized for group/room scenarios. One sender key, many recipients. More efficient than pairwise encryption for groups.
- **Federated:** Anyone can run a server. Servers sync with each other. No single point of control.
- **Key backup:** Users can export room keys and store them encrypted (with a passphrase) on the server for recovery.
- **Cross-signing:** Devices verify each other within a user's account, establishing a web of trust.

### What Daemon Needs

Daemon's sync is not messaging — it's state synchronization. But the crypto primitives are the same:

| Requirement | Signal Approach | Matrix Approach | Daemon Need |
|-------------|----------------|-----------------|-------------|
| Device-to-device encryption | Double Ratchet | Olm | Yes, for real-time sync |
| One-to-many broadcast | N/A (pairwise) | Megolm | Yes, user has many devices |
| Offline key exchange | X3DH prekeys | Olm prekeys | Yes, devices go offline |
| Group sync | Sender Keys | Megolm | Not needed (single user) |
| Key recovery | None (by design) | Key backup + cross-signing | Critical (device loss) |

**Daemon's model is simpler than messaging** because there's only one user. We don't need group key agreement or multi-party trust. We need one user's N devices to share a symmetric key set, with the ability to add/remove devices and recover from device loss.

---

## 4. The Fundamental Tension: AI Needs Data

This is the core problem. Local-first means the server can't see your data. But AI inference — especially with large language models — needs to see your data to be useful.

The user says: "Remind me about that conversation I had with Marco about the contract."

To answer, the AI needs access to:
- Conversation history (who is Marco? which conversation?)
- Knowledge graph (what contract? what were the terms?)
- User context (when was this? what was the outcome?)

If all of this is encrypted with keys the server doesn't have, how does the AI process it?

### The Solution Space (ranked by practicality)

| Approach | Latency | Privacy | Practicality (2026) | Practicality (2028) |
|----------|---------|---------|---------------------|---------------------|
| On-device small model | <100ms | Perfect | Medium | High |
| Secure enclave on server | +1-5% | Very high | Medium | High |
| Hybrid (small local + big cloud) | Variable | High | **Best today** | Good |
| Split inference | +10-30% | High | Low | Medium |
| Homomorphic encryption | 100-1000x | Perfect | Unusable | Low |
| Federated learning | N/A (training) | High | Low | Medium |

---

## 5. Solution Space (Deep Dive)

### 5.1 On-Device AI

**State of the art (early 2026):**

Running on a Pixel 8 Pro with 12GB RAM (~4GB available after OS):

| Model | Parameters | Quantized Size | Speed | Quality |
|-------|-----------|----------------|-------|---------|
| Gemma 3 1B | 1B | ~500MB | ~15 tok/s | Basic tasks, routing |
| Phi-4-mini | 3.8B | ~1.5GB | ~5-8 tok/s | Surprisingly good reasoning |
| Llama 3.2 3B | 3B | ~1.5GB | ~5-8 tok/s | Good general capability |
| MobileLLM-R1 | 2-5B | ~1-2GB | ~3-5 tok/s | Reasoning-focused |
| Gemini Nano | 3.25B | Built-in | ~2 words/s | Google-optimized |
| FunctionGemma | 270M | ~150MB | ~50 tok/s | Function calling only |

**Key bottlenecks:**
- **Memory bandwidth:** Mobile devices have 50-90 GB/s vs 2-3 TB/s on data center GPUs. This is a 30-50x gap that makes decode memory-bound.
- **Battery:** Sustained inference drains battery fast and triggers thermal throttling.
- **Context length:** KV cache for long contexts dominates memory. A 3B model with 8K context can fill available RAM.
- **Reasoning depth:** Small models struggle with long chains of reasoning, novel problem types, and tasks requiring broad world knowledge.

**What changes by 2028:**
- Snapdragon X Elite and Apple A-series chips are pushing 100+ GB/s memory bandwidth on mobile
- 4-bit quantization is now standard; 2-bit (with quality-preserving techniques) is emerging
- Speculative decoding gives 2-3x speedups (small model drafts, large model verifies)
- Model distillation is getting dramatically better — 3B models in 2028 will match 7B models from 2025
- On-device 7B models at 10+ tok/s is plausible on flagship phones by 2028

**Verdict for Daemon:** On-device models are essential for routing, summarization, and simple tasks TODAY. They are not sufficient for complex reasoning or long-context tasks. The gap is closing but won't be fully closed by 2028.

### 5.2 Secure Enclaves / Confidential Computing

**The idea:** Run the AI model inside a hardware-isolated enclave on the server. The enclave can decrypt and process user data, but nothing outside the enclave — not the host OS, not the cloud provider, not even a physical attacker with access to the machine — can read the enclave's memory.

**Available hardware (2026):**

| Platform | Technology | Scope | GPU Support | Status |
|----------|-----------|-------|-------------|--------|
| AMD | SEV-SNP | Full VM encryption | Via NVIDIA H100 CC | Production |
| Intel | TDX | Full VM encryption | Via NVIDIA H100 CC | Production |
| Intel | SGX | Process-level enclave | No | Deprecated (except Xeon) |
| ARM | TrustZone | Secure world partition | No | Mobile/embedded only |
| ARM | CCA (Realm) | Full VM encryption | Coming | Announced |
| NVIDIA | H100 CC | GPU memory encryption | Native | Production |

**Performance overhead:**
- CPU TEE (AMD SEV-SNP): <5% overhead for LLM inference
- Large models (32B+) with long inputs: <1% overhead
- Small models (3-8B): 5-22% overhead at typical batch sizes
- NVIDIA H100 Confidential Compute: near-native GPU performance
- Attestation: 2-6 seconds one-time cost per session

**The trust model:**
1. User device performs **remote attestation** — cryptographically verifies the enclave is running expected code on genuine hardware
2. Only after attestation succeeds does the device send an ephemeral session key
3. All data is encrypted in transit with that session key
4. Inside the enclave: data is decrypted, processed by the LLM, response is encrypted
5. After processing: data is cryptographically erased (no persistence)

**The gap:** CPU enclaves are mature but slow for LLM inference. GPU enclaves (NVIDIA H100 CC) are fast but only available on expensive hardware. The structural gap is that many deployments still hand data from CPU enclave to GPU in a less-protected manner — though NVIDIA H100 CC mode addresses this with full GPU encryption.

**What Edgeless Systems proved:** Their open-source "Privatemode" achieves Apple PCC-equivalent privacy guarantees using commodity AMD SEV-SNP + NVIDIA H100 hardware. This means you don't need custom silicon. The architectural pattern is replicable.

**Verdict for Daemon:** This is the strongest near-term solution for server-side AI processing. Run the LLM inference in an attested TEE. User devices verify the enclave before sending data. Data never exists in plaintext outside the enclave. The overhead is acceptable (1-5%).

### 5.3 Homomorphic Encryption

**The idea:** Encrypt data on device. Send ciphertext to server. Server computes on ciphertext without decrypting. Returns encrypted result. Device decrypts.

**Reality check (2026):**

The Safhire framework (ICLR 2025) represents state of the art for hybrid FHE inference:

- ResNet-20 on CIFAR-10: 116-342 seconds per single image (vs milliseconds in plaintext)
- Communication overhead: 170-500 MB per inference request
- ResNet-18: 457-1194 seconds per inference
- Even with GPU acceleration: 14x speedup still leaves inference in the minutes range

For LLM inference specifically: completely impractical. A single forward pass through a 7B model under FHE would take hours to days. The multiplicative depth of transformer attention mechanisms makes this fundamentally hard.

**Where FHE is practical today:**
- Simple ML models (logistic regression, SVM, KNN) — seconds to minutes
- Aggregation queries over encrypted databases
- Not inference on neural networks of any meaningful size

**Verdict for Daemon:** Not viable for AI inference in 2026 or 2028. Maybe 2032+. Ignore for architecture decisions.

### 5.4 Hybrid Split Inference

**The idea:** Run early layers of the model on device, send intermediate activations (not raw data) to the server, server runs remaining layers, sends result back.

**Recent work (2025):**

- **DSSD (Distributed Split Speculative Decoding):** Small model on device generates draft tokens, large model on server verifies. Reduces communication from sending full vocabulary distributions to a single verification signal.
- **SplitLLM:** Optimizes the cut point between device and server layers for throughput.
- **Qualcomm's vision (2023):** "Intelligent workload partitioning between LLMs and SLMs."

**The privacy problem:** Intermediate activations leak information about the input. Research shows you can reconstruct input text from intermediate transformer activations with high fidelity. Adding noise (differential privacy) helps but degrades quality.

**Practical approach — not split layers, but split tasks:**

Instead of splitting the model, split the WORK:

1. **On-device small model (1-3B):** Handles routing, classification, summarization of local data, function calling, simple Q&A
2. **Server-side large model (in TEE):** Handles complex reasoning, code generation, multi-step planning
3. **The small model decides** what context the large model needs and sends only that (encrypted, to the TEE)

This is not split inference in the ML sense — it's **agentic routing**. The small model acts as a privacy-preserving gateway.

**Verdict for Daemon:** The "agentic routing" variant is the right architecture. Not layer splitting. A small on-device model that understands user intent, prepares minimal context, and dispatches to a server-side TEE only when needed.

### 5.5 Federated Learning

**The idea:** Train the model on user devices. Only send model weight updates (gradients) to a central server for aggregation. Raw data never leaves the device.

**State of the field (2026):**
- Market: $0.1B in 2025, projected $1.6B by 2035
- Only 5.2% of federated learning research has reached real-world deployment
- Google uses it for next-word prediction on Gboard
- Apple uses it for Siri improvements

**Relevance for Daemon:**
- Fine-tuning a small on-device model to the user's patterns — yes, this matters
- The user's daemon should get better at predicting their needs over time
- But: fine-tuning even a 1B model on a phone is expensive (battery, time)
- Practical approach: accumulate preference data locally, fine-tune during charging, overnight

**Verdict for Daemon:** Relevant for personalization, not for core inference. The daemon should collect preference signals locally and use them for lightweight fine-tuning (LoRA adapters) on device when conditions allow (plugged in, idle).

---

## 6. Apple Private Cloud Compute

Apple's PCC is the most sophisticated production implementation of privacy-preserving cloud AI. Understanding it is essential because it's the benchmark Daemon must match or exceed.

### Five Security Requirements

1. **Stateless computation.** User data is used only to fulfill the immediate request. Not retained. Not logged. Deleted after response. Data volume encryption keys are randomized on each reboot — cryptographic erasure.

2. **Enforceable guarantees.** Not policy promises — technical controls that make violations physically impossible. Minimal trusted computing base. Every component is auditable.

3. **No privileged runtime access.** No SSH. No remote shell. No debugging tools. No mechanism for Apple employees to escalate privileges. Even during outages.

4. **Non-targetability.** An attacker who compromises a single server cannot target a specific user. "Target diffusion" — requests are routed so no server can predict which user's data it will process.

5. **Verifiable transparency.** Every production PCC build is published in an append-only transparency log. Source code released within 90 days. Independent researchers can verify.

### How It Works

1. User's iPhone sends request
2. Device checks PCC transparency log for current valid software builds
3. Device performs remote attestation against PCC nodes
4. Device wraps request encryption key to only those nodes whose attestation matches the transparency log
5. PCC node decrypts request inside secure enclave (Apple Silicon Secure Enclave)
6. Processes request. Returns encrypted response.
7. All data erased. Memory recycled. Encryption keys destroyed.

### What Daemon Can Learn From This

Apple has custom silicon. We don't. But the architectural patterns are replicable:

| Apple PCC Feature | Daemon Equivalent |
|-------------------|-------------------|
| Custom Apple Silicon | AMD SEV-SNP + NVIDIA H100 CC (commodity) |
| Transparency log | Open-source code + reproducible builds + public attestation log |
| No privileged access | Enclave design with no admin shell, no debug port |
| Stateless computation | Ephemeral containers, memory wiped after each request |
| Non-targetability | Request routing with no user-server affinity |
| Verifiable by researchers | Fully open-source enclave code, anyone can audit |

**Daemon's advantage over Apple:** We can be fully open-source. Apple publishes builds but the full system isn't open. Daemon can publish every line of code that runs in the enclave. Reproducible builds mean anyone can verify the binary matches the source.

---

## 7. Multi-Device Key Management

The hardest practical problem in local-first E2EE systems. A user has a phone, a laptop, a server, and an ESP32 pendant. They all need the same encryption keys. If the phone is lost, the user must not lose access to their data.

### How Others Solve It

**Signal (Sesame Protocol):**
- Each device has its own identity key pair
- Primary device (phone) signs linked device public keys
- Linked devices sign back (mutual authentication)
- Messages encrypted separately for each device (pairwise Double Ratchet sessions)
- Limit: 5 linked devices
- Key recovery: none. Lose all devices = lose all data.

**WhatsApp (HSM Key Vault):**
- E2EE backup key stored in HSM-based vault
- User sets a password; OPAQUE protocol derives the key without ever transmitting the password
- HSM enforces rate limiting (brute-force protection) and permanent lockout after N failures
- Geographically distributed for availability
- WhatsApp knows a key EXISTS but never sees it

**Matrix (Cross-signing + Key Backup):**
- Devices cross-sign each other within an account
- Room keys can be exported and stored encrypted on server (with passphrase)
- SSSS (Secure Secret Storage and Sharing) for key synchronization
- Key recovery via passphrase or recovery key

### The Key Management Problem for Daemon

Daemon devices include:
- Phones (Android, eventually iOS)
- Laptops/desktops (via web app or CLI)
- Servers (always-on, runs the daemon orchestrator)
- ESP32 pendant (extremely constrained — 520KB RAM, no secure enclave)
- Future: any IoT device

**Constraints:**
1. User should never have to manually transfer keys
2. Losing one device must not compromise the system
3. Losing ALL devices must still allow recovery (unlike Signal)
4. The ESP32 cannot do heavy crypto — it needs a lightweight protocol
5. Adding a new device should be seamless (QR code scan or similar)
6. Revoking a device must be instant and irreversible

---

## 8. Daemon Crypto Protocol Design

### 8.1 Key Hierarchy

```
Master Key (MK)
  |
  ├── Device Keys (per device)
  |     ├── Device Identity Key (Ed25519) — signs messages
  |     └── Device Encryption Key (X25519) — encrypts data
  |
  ├── Data Encryption Key (DEK) — symmetric (AES-256-GCM)
  |     ├── Conversation DEK — encrypts chat history
  |     ├── Knowledge DEK — encrypts knowledge graph
  |     └── Config DEK — encrypts device configs / preferences
  |
  └── Recovery Key (derived from MK, never stored on any device)
```

### 8.2 Device Registration

**First device (bootstrapping):**

1. User creates account (email + password, or passkey)
2. Device generates:
   - Device Identity Key pair (Ed25519)
   - Device Encryption Key pair (X25519)
   - Master Key (256-bit random)
3. Master Key derives Data Encryption Keys via HKDF
4. Master Key is encrypted with a key derived from user's password (Argon2id KDF)
5. Encrypted Master Key stored on server (user's password never sent to server — OPAQUE protocol)
6. Device registers its public keys with the server

**Adding a new device:**

1. New device generates its own Identity and Encryption key pairs
2. Existing device displays QR code containing:
   - One-time pairing token
   - Existing device's public key
3. New device scans QR code
4. Devices perform mutual authentication (X3DH-style)
5. Existing device sends Master Key to new device (encrypted with shared secret from step 4)
6. New device derives all DEKs from Master Key
7. Server is notified of new device's public keys (signed by existing device)
8. New device syncs encrypted data from server, decrypts locally

**For the ESP32 pendant:**

The ESP32 cannot perform X25519 or Ed25519 efficiently (it can, but slowly). Optimization:

1. Phone acts as the pendant's "sponsor"
2. Phone generates a symmetric session key for the pendant
3. Session key transferred via BLE pairing (out-of-band, physical proximity)
4. Pendant uses AES-128-GCM (hardware-accelerated on ESP32) for all data
5. Pendant has a limited view — only the data it needs (sensor readings, display content)
6. Pendant cannot access full knowledge graph or conversation history
7. If pendant is lost: phone revokes the session key. Pendant becomes inert.

### 8.3 Data Encryption at Rest

Every device stores data encrypted:

```
Encrypted Record = AES-256-GCM(DEK, plaintext || metadata)
  where:
    DEK = HKDF(MK, purpose || record_type)
    metadata = { created_at, device_id, crdt_clock }
```

- Each record type (conversation, knowledge, config) has its own DEK derived from the Master Key
- CRDT metadata (vector clocks) is stored alongside encrypted data but is itself encrypted
- The local SQLite database is fully encrypted (SQLCipher or similar)
- On Android: DEK protected by Android Keystore (hardware-backed on Pixel 8 Pro)
- On Linux: DEK protected by kernel keyring or TPM if available

### 8.4 Data Encryption in Transit

**Device-to-server (sync):**

```
1. Device encrypts data with DEK (at rest encryption)
2. Encrypted data wrapped in TLS 1.3 for transport
3. Server stores ciphertext — cannot decrypt (doesn't have DEK)
4. Server relays ciphertext to other devices
5. Other devices decrypt with their copy of DEK
```

**Device-to-TEE (AI inference):**

```
1. Device performs remote attestation of TEE
2. TEE provides its ephemeral public key (attested)
3. Device establishes session key via ECDH with TEE's key
4. Device sends: encrypted(session_key, {prompt + context})
5. TEE decrypts inside enclave
6. TEE runs inference
7. TEE encrypts response with session key
8. TEE erases all plaintext data
9. Device decrypts response
```

The critical distinction: the sync server sees ciphertext only. The TEE sees plaintext but is hardware-isolated, attested, stateless, and erases everything after each request.

### 8.5 Server-Side Processing Without Decryption

**What the server CAN do with encrypted data:**
- Store and relay ciphertext
- Route sync updates to the correct devices (using unencrypted device IDs)
- Rate limit and authenticate requests
- Manage device registration metadata (public keys, device names)
- Log aggregate usage metrics (request count, not content)

**What the server CANNOT do:**
- Read any user data
- Search within user data
- Train on user data
- Respond to legal requests for user data (we don't have it)
- Target a specific user's data for extraction

**What the TEE can do (and only the TEE):**
- Decrypt user data for the duration of a single inference request
- Run the LLM on decrypted context
- Generate a response
- NOTHING ELSE — no logging, no persistence, no side channels

### 8.6 Key Recovery When a Device Is Lost

**Scenario 1: One device lost, others remain.**

1. User opens daemon on surviving device
2. Initiates device revocation for lost device
3. Server marks lost device's public keys as revoked
4. Surviving device generates new Device Keys for itself (optional rotation)
5. Master Key remains unchanged (it wasn't on the server in plaintext)
6. No data loss — other devices have full copy

**Scenario 2: All devices lost.**

This is the hard case. Two options:

**Option A: Password-based recovery (like WhatsApp)**

1. At account creation, Master Key was encrypted with password-derived key and stored on server
2. User gets new device, enters email + password
3. Server releases encrypted Master Key (rate-limited, lockout after N failures)
4. Device derives key from password (Argon2id), decrypts Master Key
5. Device syncs encrypted data from server, decrypts locally
6. Full recovery achieved

**Option B: Recovery key (like Matrix)**

1. At account creation, user was given a 24-word recovery phrase (BIP39-style)
2. Recovery phrase deterministically derives the Master Key
3. User enters recovery phrase on new device
4. Device derives Master Key, syncs and decrypts
5. Full recovery achieved

**Recommendation:** Support BOTH. Password recovery for normal users. Recovery key for security-conscious users who want it. Either way, the server never sees the Master Key in plaintext.

**Option C (future): Social recovery**

1. User designates 3-5 trusted contacts (who also use Daemon)
2. Master Key is split via Shamir's Secret Sharing (3-of-5 threshold)
3. Each contact stores one share (encrypted with their own keys)
4. To recover: contact 3+ trusted contacts, each releases their share
5. Shares recombine to produce Master Key
6. Most robust but requires a user base first

---

## 9. What's Practical Today vs. 2028

### Can Build Now (2026)

| Component | Technology | Maturity |
|-----------|-----------|----------|
| Local data encryption | SQLCipher + AES-256-GCM | Production-ready |
| Device key management | Ed25519 + X25519 + HKDF | Production-ready |
| Encrypted sync relay | TLS 1.3 + server stores ciphertext only | Production-ready |
| On-device routing model | Gemma 3 1B / FunctionGemma 270M | Usable today |
| QR-code device pairing | Standard crypto + camera | Production-ready |
| Password recovery | OPAQUE + Argon2id + HSM | Production-ready |
| ESP32 symmetric crypto | AES-128-GCM (hardware accel) | Production-ready |

### Can Build Soon (2027)

| Component | Technology | Maturity |
|-----------|-----------|----------|
| TEE inference | AMD SEV-SNP + NVIDIA H100 CC | Available but expensive |
| Remote attestation | Standard attestation protocols | Available, needs integration |
| On-device 3B model | Phi-4-mini / Llama 3.2 3B quantized | Usable, quality improving |
| Transparency log | Sigstore / Rekor-style | Open-source, needs customization |
| Reproducible builds | Nix / Guix | Mature tooling exists |

### Research Phase (2028+)

| Component | Technology | Timeline |
|-----------|-----------|----------|
| On-device 7B+ at good speed | Next-gen mobile silicon | 2028 |
| Commodity GPU TEEs | AMD, Intel discrete GPUs | 2028 |
| FHE for simple ML tasks | Concrete ML / OpenFHE | 2028+ |
| Social recovery (Shamir) | Needs user base first | 2028+ |
| Federated fine-tuning | On-device LoRA training | 2027-2028 |

---

## 10. Architecture Decision for Daemon

### The Hybrid Architecture

Daemon's privacy architecture is a layered system, not a single solution:

```
┌─────────────────────────────────────────────────────┐
│                    USER DEVICES                      │
│                                                      │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌─────┐ │
│  │  Phone   │  │  Laptop  │  │  Server  │  │ESP32│ │
│  │ (Android)│  │  (Web)   │  │ (Linux)  │  │(BLE)│ │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └──┬──┘ │
│       │              │              │            │    │
│  ┌────┴──────────────┴──────────────┴────────────┘   │
│  │         LOCAL ENCRYPTED STORAGE                │   │
│  │    SQLCipher + cr-sqlite CRDT sync             │   │
│  │    AES-256-GCM with per-type DEKs              │   │
│  └────────────────────┬──────────────────────────┘   │
│                       │                              │
│  ┌────────────────────┴──────────────────────────┐   │
│  │         ON-DEVICE AI (privacy layer 1)        │   │
│  │    Gemma 1B / FunctionGemma for routing        │   │
│  │    Handles: simple Q&A, summarization,         │   │
│  │    intent classification, function calling      │   │
│  │    NEVER sends data to server for these tasks   │   │
│  └────────────────────┬──────────────────────────┘   │
│                       │ (only when needed)            │
└───────────────────────┼──────────────────────────────┘
                        │ encrypted
                        ▼
┌───────────────────────────────────────────────────────┐
│                   DAEMON SERVER                        │
│                                                        │
│  ┌─────────────────────────────────────────────────┐  │
│  │              SYNC RELAY (sees nothing)            │  │
│  │    Stores ciphertext. Routes to devices.          │  │
│  │    Cannot decrypt. Cannot search. Cannot log.     │  │
│  └─────────────────────────────────────────────────┘  │
│                                                        │
│  ┌─────────────────────────────────────────────────┐  │
│  │         TEE INFERENCE (privacy layer 2)          │  │
│  │    AMD SEV-SNP + NVIDIA H100 CC enclave          │  │
│  │    Attested by device before each session         │  │
│  │    Stateless — erases all data after response     │  │
│  │    Runs: Claude / large model for complex tasks   │  │
│  │    Open-source enclave code, reproducible builds  │  │
│  │    Published in transparency log                  │  │
│  └─────────────────────────────────────────────────┘  │
│                                                        │
│  ┌─────────────────────────────────────────────────┐  │
│  │         PUBLIC METADATA (minimal)                │  │
│  │    Device public keys. Account existence.         │  │
│  │    Aggregate usage metrics. Nothing personal.     │  │
│  └─────────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────┘
```

### Implementation Priority

**Phase 1 (NOW — alongside MVP):**
1. SQLCipher for local database encryption on all platforms
2. Device key generation and QR-code pairing
3. Encrypted sync relay (server stores ciphertext, relays to devices)
4. Password-based key recovery via OPAQUE

**Phase 2 (Post-MVP — before hardware Kickstarter):**
5. On-device routing model (Gemma 1B) decides what stays local vs goes to server
6. cr-sqlite CRDT sync for multi-device state convergence
7. ESP32 pendant symmetric key protocol via BLE

**Phase 3 (Scale — post-Kickstarter):**
8. TEE inference deployment (AMD SEV-SNP)
9. Remote attestation protocol
10. Transparency log for enclave builds
11. Recovery key + social recovery options
12. Federated fine-tuning for personalization

### The Promise We Make

"Your daemon's memory — every conversation, every preference, every piece of context — is encrypted with keys that only your devices hold. Our servers store your data but cannot read it. When AI processing requires your data, it happens inside a hardware-isolated enclave that proves its integrity to your device before receiving anything. After each response, everything is erased. We publish every line of code that runs in the enclave. Anyone can verify."

This is not privacy theater. It is a system where extracting user data requires either:
1. Compromising the user's device (their problem, not ours)
2. Breaking AES-256 (not happening)
3. Breaking the TEE hardware isolation (nation-state level, and detectable via attestation)

There is no scenario where a Daemon employee, a court order, or a data breach exposes user data in plaintext. We don't have the keys. The enclave doesn't persist the data. The math is the guarantee.

---

## Sources

### Local-First Software
- [Ink & Switch — Local-first Software](https://www.inkandswitch.com/local-first/)
- [Ink & Switch — Local-first Software (essay)](https://www.inkandswitch.com/essay/local-first/)
- [Tonsky — Local, First, Forever](https://tonsky.me/blog/crdt-filesync/)
- [PowerSync — Local-First Software Origins and Evolution](https://www.powersync.com/blog/local-first-software-origins-and-evolution)

### CRDTs
- [Automerge](https://automerge.org/)
- [Velt — Best CRDT Libraries 2025](https://velt.dev/blog/best-crdt-libraries-real-time-data-sync)
- [CRDT + E2EE Research Notes (Kerkour)](https://kerkour.com/crdt-end-to-end-encryption-research-notes)
- [CRDT Benchmarks](https://github.com/dmonad/crdt-benchmarks)

### Encryption Protocols
- [Signal Protocol — Wikipedia](https://en.wikipedia.org/wiki/Signal_Protocol)
- [Signal — Sesame Protocol (PDF)](https://signal.org/docs/specifications/sesame/sesame.pdf)
- [Signal — A Synchronized Start for Linked Devices](https://signal.org/blog/a-synchronized-start-for-linked-devices/)
- [Matrix vs Signal Comparison](https://stealthcloud.ai/comparisons/matrix-vs-signal/)
- [WhatsApp E2EE Backups Architecture (Meta Engineering)](https://engineering.fb.com/2021/09/10/security/whatsapp-e2ee-backups/)

### Confidential Computing & TEEs
- [Apple — Private Cloud Compute](https://security.apple.com/blog/private-cloud-compute/)
- [Apple — PCC Security Guide](https://security.apple.com/documentation/private-cloud-compute)
- [Edgeless Systems — Apple PCC Concepts and Open Alternative](https://www.edgeless.systems/blog/apple-private-cloud-compute-core-concepts-and-an-open-alternative)
- [Stanford Hazy Research — Local-to-Cloud LLM Chat via TEEs](https://hazyresearch.stanford.edu/blog/2025-05-12-security)
- [Red Hat — AI Inference with Confidential Computing](https://next.redhat.com/2025/10/23/enhancing-ai-inference-security-with-confidential-computing-a-path-to-private-data-inference-with-proprietary-llms/)
- [Azure Confidential Computing: Confidential GPUs and AI](https://thomasvanlaere.com/posts/2025/03/azure-confidential-computing-confidential-gpus-and-ai/)

### Homomorphic Encryption
- [Safhire — Practical Hybrid ML Inference with FHE (arXiv)](https://arxiv.org/abs/2509.01253)
- [Encrypted Intelligence — HE Frameworks Comparison (ScienceDirect)](https://www.sciencedirect.com/science/article/pii/S2949948825000289)

### On-Device LLMs
- [On-Device LLMs: State of the Union, 2026](https://v-chandra.github.io/on-device-llms/)
- [Best Small Language Models 2026](https://localaimaster.com/blog/small-language-models-guide-2026)
- [Awesome Mobile LLM (GitHub)](https://github.com/stevelaskaridis/awesome-mobile-llm)

### Split/Federated Learning
- [DSSD: Distributed Split Speculative Decoding (ICML 2025)](https://icml.cc/virtual/2025/47046)
- [SplitLLM: Collaborative Inference (arXiv)](https://arxiv.org/html/2410.10759v1)
- [Federated Learning's 2026 Moment](https://medium.com/@Praxen/federated-learnings-2026-moment-a10f0c617ad0)

### Key Management
- [WhatsApp E2EE Backup Security Assessment (NCC Group)](https://www.nccgroup.com/media/fzwdxklh/_ncc_group_whatsapp_e001000m_report_2021-10-27_v12.pdf)
- [OMEMO Multi-End Encryption (XEP-0384)](https://xmpp.org/extensions/xep-0384.html)
- [Signal Protocol Security Architecture Deep Dive](https://profincognito.me/blog/security/signal-security-architecture/)
