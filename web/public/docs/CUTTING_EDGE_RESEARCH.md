# Daemon: Cutting-Edge AI Agent Landscape Research

**Last updated: April 2026**
**Purpose: Competitive intelligence and architecture decisions for Daemon -- personal AI agent platform**

---

## Table of Contents

1. [Agent Frameworks](#1-agent-frameworks)
2. [Device Control and IoT AI](#2-device-control-and-iot-ai)
3. [Personal AI and Memory](#3-personal-ai-and-memory)
4. [Multi-Device AI](#4-multi-device-ai)
5. [Skills and Plugin Ecosystems](#5-skills-and-plugin-ecosystems)
6. [Protocols and Interoperability](#6-protocols-and-interoperability)
7. [Safety and Security](#7-safety-and-security)
8. [Key Takeaways for Daemon](#8-key-takeaways-for-daemon)

---

## 1. Agent Frameworks

The agent framework space has exploded. Every major AI lab now ships one. Here is the landscape ranked by relevance to Daemon.

### Tier 1: Frameworks Daemon Should Study Deeply

#### Claude Agent SDK (Anthropic)
- **What it is**: SDK for building agents with Claude Code's capabilities. Renamed from "Claude Code SDK" to reflect broader scope.
- **Stars**: Not independently starred (part of Anthropic ecosystem)
- **Key innovation**: The agent gets a sandboxed shell and real filesystem access. This is *proactive* execution (agent drives the loop), not reactive function calling. Supports structured outputs, fallback models, extended context windows.
- **Pattern**: ReAct-style with tool use, but the "tools" are real shell commands and file operations.
- **What Daemon should steal**: The execution model. Daemon already uses Claude Code CLI under the hood -- this is the right call. The smart MCP loading pattern (only load tools when the message needs them) is something Daemon already does and should keep.
- **What to avoid**: Tight coupling to a single model provider. Daemon needs model-agnostic orchestration.
- **Trajectory**: Rapidly maturing. Python SDK actively maintained with frequent releases.

#### LangGraph (LangChain)
- **What it is**: Low-level orchestration framework for stateful, long-running agents as directed graphs.
- **Stars**: ~40k+ (LangChain ecosystem: 126k)
- **Key innovation**: Graph-based state machines with durable execution. Checkpointing lets agents persist through failures and resume exactly where they left off. Reducer-driven state schemas prevent data loss in multi-agent systems.
- **Pattern**: Graph nodes + edges with explicit state transitions. Supports cycles, conditional branching, parallel execution. Human-in-the-loop built in.
- **What Daemon should steal**: The checkpointing and durable execution model. Daemon's conversation memory (per-thread session resume via --resume flag) is a simpler version of this. LangGraph's approach to state persistence is more robust for long-running tasks.
- **What to avoid**: LangGraph is complex and over-engineered for simple workflows. The LangChain ecosystem has a reputation for abstraction bloat.
- **Trajectory**: v1.1 (Dec 2025) added middleware for retry, content moderation. LangGraph Platform is now GA for cloud deployment. Dominant in Python multi-agent orchestration.

#### Letta (formerly MemGPT)
- **What it is**: Platform for building stateful agents with self-managing memory. The "LLM as Operating System" paradigm.
- **Stars**: ~35k+
- **Key innovation**: Virtual context management inspired by OS memory hierarchy. Agents manage their own memory using tools -- deciding what to keep in context (core memory) vs. store externally (archival/recall storage). Self-editing memory is the breakthrough.
- **Pattern**: Two-tier memory: Tier 1 (in-context core memories) and Tier 2 (out-of-context recall + archival storage). Agent uses tool calls to read/write its own memory.
- **What Daemon should steal**: THIS IS CRITICAL FOR DAEMON. The self-editing memory pattern. Daemon's Qdrant knowledge graph (50+ entries across 6 collections) is the right foundation, but Daemon should let the agent itself decide what to remember, forget, and promote to core context. Letta's architecture is the gold standard here.
- **What to avoid**: Letta is heavy infrastructure. For a personal agent like Daemon, the memory management can be simpler -- no need for multi-tenant complexity.
- **Trajectory**: Actively developed, optimized for frontier reasoning models. Works well with Claude Sonnet 4.5+.

### Tier 2: Worth Monitoring

#### OpenAI Agents SDK
- **What it is**: Lightweight, Python-first framework for agentic workflows. Provider-agnostic despite the name.
- **Stars**: ~30k+
- **Key features**: Tool calling with automatic schema generation from Python functions. Handoffs between specialized agents. Guardrails that run in parallel with execution and fail fast. Built-in MCP server integration.
- **Pattern**: Agent-to-agent handoffs for specialization. Input/output guardrails.
- **What Daemon should steal**: The handoff pattern is elegant for Daemon's multi-device use case. Different "sub-agents" for different devices (MSI agent, Pixel agent, ESP32 agent) that the main daemon hands off to.
- **What to avoid**: Guardrails only apply to first/last agent in chain -- gap in the middle.

#### Microsoft Agent Framework (Semantic Kernel + AutoGen)
- **What it is**: Unified framework merging AutoGen's multi-agent orchestration with Semantic Kernel's enterprise features. Python and .NET.
- **Stars**: AutoGen ~35k, Semantic Kernel ~25k
- **Key features**: Session-based state management, graph-based workflows, A2A protocol support, MCP support. Targets GA Q1 2026.
- **Pattern**: Conversational multi-agent with enterprise middleware (telemetry, type safety).
- **What Daemon should steal**: The A2A and MCP dual-protocol support. If Daemon wants to be interoperable with other agents, it needs both.
- **What to avoid**: Enterprise complexity. This is built for Azure, not for a personal pendant.

#### Google ADK (Agent Development Kit)
- **What it is**: Google's open-source, code-first agent framework. Optimized for Gemini but model-agnostic.
- **Stars**: ~25k+
- **Multi-language**: Python, Java, Go, TypeScript.
- **Key features**: Workflow agents (Sequential, Parallel, Loop), Gemini Live API for bidirectional streaming (text + audio), A2A protocol support, built-in eval tools.
- **What Daemon should steal**: The bidirectional streaming for voice. Daemon already has Deepgram for STT -- Google's approach to real-time audio agent interaction is worth studying for the pendant's voice interface.
- **What to avoid**: Heavy Google Cloud coupling for deployment.

#### CrewAI
- **What it is**: Role-based multi-agent framework. Agents have roles, backstories, and goals.
- **Stars**: ~25k+
- **Pattern**: "Crew" of agents with defined roles collaborating on tasks.
- **What Daemon should steal**: The role-based abstraction is good UX for explaining what different device agents do. "Your MSI agent handles development tasks. Your Pixel agent handles on-the-go queries."
- **What to avoid**: Limited for complex stateful workflows. Better for batch processing than real-time interaction.

### Tier 3: Interesting But Different Focus

#### Mastra (TypeScript)
- **What it is**: TypeScript agent framework from the Gatsby team. YC W25, $13M funding.
- **Stars**: 22k+, 300k+ weekly npm downloads
- **Key features**: 40+ model providers, built-in evals, observability. Code-first TypeScript.
- **Relevance to Daemon**: If Daemon's web frontend needs agent capabilities directly (not just calling the Python backend), Mastra could be the TypeScript counterpart.

#### smolagents (Hugging Face)
- **What it is**: Minimalist agent library. Core logic fits in ~1,000 lines of code.
- **Stars**: 26k+
- **Key innovation**: Code agents (agents write Python code as actions, not JSON tool calls). Sandboxed execution via E2B, Docker, or WebAssembly.
- **Relevance to Daemon**: The "code as action" pattern is powerful. Instead of defining 50 tools, let the agent write code to accomplish what it needs. Daemon already does this via Claude Code CLI.

#### n8n
- **What it is**: Visual workflow automation with native AI agent nodes.
- **Stars**: 182k (massive)
- **Key features**: 400+ app integrations, visual workflow editor, self-hostable. AI Agent node with ReAct-style reasoning.
- **Relevance to Daemon**: n8n could be the "action layer" that Daemon triggers for complex multi-step automations. Rather than building every integration, connect Daemon to n8n for the long tail.

#### Dify
- **What it is**: Open-source LLM app platform with visual workflow builder, RAG, agent capabilities.
- **Stars**: 93k+
- **Key features**: No-code/low-code agent building, 50+ built-in tools, prompt IDE, model comparison.
- **Relevance to Daemon**: Good reference for the web UI/chat experience. Dify's observability features (log monitoring, performance analysis) are worth studying.

#### OpenClaw
- **What it is**: Open-source autonomous AI agent. Viral growth in early 2026.
- **Stars**: 247k (largest AI project on GitHub as of March 2026)
- **Key innovation**: ClawHub skills marketplace with 13,729 community-built skills. Messaging platforms as primary UI.
- **What Daemon should steal**: The skills marketplace model. Daemon should be able to install community-created skills from a registry.
- **What to avoid**: MAJOR SECURITY ISSUES. 41% of popular ClawHub skills had vulnerabilities. 99.3% shipped without permissions manifests. Daemon MUST have a permissions model for skills.

### Framework Patterns Summary

| Pattern | Used By | Daemon Relevance |
|---------|---------|-----------------|
| ReAct (Reason + Act) | Most frameworks | Already using via Claude Code CLI |
| Graph-based state machines | LangGraph, Microsoft | Good for complex multi-step device tasks |
| Agent handoffs | OpenAI SDK | Perfect for multi-device delegation |
| Self-editing memory | Letta/MemGPT | Critical -- Daemon needs this |
| Code-as-action | smolagents, Claude Agent SDK | Already doing this |
| Role-based agents | CrewAI | Good UX abstraction |
| Visual workflow | n8n, Dify | Could complement Daemon for power users |
| Skills marketplace | OpenClaw | Daemon should build toward this |

---

## 2. Device Control and IoT AI

### Home Assistant AI Integration
- **What it is**: The dominant open-source home automation platform, now with deep LLM integration.
- **Key development (Sep 2025)**: Home Assistant built AI directly into its core. LLMs can now recognize rooms and devices, with different LLMs assignable per device. Voice assistants run locally.
- **What Daemon should steal**: The device discovery and room-awareness model. HA's approach to exposing device capabilities to LLMs is mature.
- **What to avoid**: HA is home-focused. Daemon is personal-device-focused (laptop, phone, pendant). Different scope.

### SAGE (Smart home Agent with Grounded Execution)
- **Academic research**: LLM-controlled sequence of discrete actions via dynamically constructed prompt trees.
- **Key idea**: User request triggers a tree of LLM prompts that can retrieve info, interact with user, or manipulate device states.
- **Relevance**: Daemon's multi-device commands (SSH to MSI, SSH to Pixel) are a simpler version of this. The prompt-tree approach could make complex multi-device workflows more reliable.

### IoTGPT
- **Academic research**: LLM-based smart home agent using task decomposition and memorization.
- **Results**: 85% higher success rate, 78% lower latency, 44% lower cost vs. baselines.
- **Key insight**: Task decomposition + memorization is the winning formula. Break complex device commands into steps, remember which approaches worked.

### SwitchBot AI Hub (Feb 2026)
- **What it is**: First local home AI agent with native OpenClaw support. Runs on-device.
- **Key innovation**: AI agent running locally on a hub device, controlling physical hardware without cloud dependency.
- **Relevance**: This is closer to Daemon's hardware vision. The ESP32 pendant could eventually run a local agent that handles time-sensitive device commands without roundtripping to the cloud.

### Key Gap Daemon Can Fill
Most IoT AI solutions are home-centric (lights, thermostats, locks). **Nobody is doing personal-device AI well** -- an agent that seamlessly controls your laptop, phone, wearable, and home devices as a unified system. This is Daemon's unique position.

---

## 3. Personal AI and Memory

### Wearable AI Devices

#### Limitless (formerly Rewind)
- **What it was**: Wearable pendant that recorded, transcribed, and summarized conversations in real-time.
- **Acquired by Meta (Dec 2025)**: Meta immediately stopped selling the pendant. Existing users got free unlimited plans but no new features.
- **Key lesson**: The market validated the form factor (wearable pendant for AI memory). But pure recording/transcription without agency is not enough. Users want an AI that acts, not just remembers.
- **What Daemon should steal**: The always-on ambient recording concept. But Daemon's pendant should also be able to take action.
- **What to avoid**: Vendor lock-in. Meta killed the product immediately after acquisition.

#### Omi (omi.me)
- **What it is**: Open-source wearable AI assistant. Records and transcribes throughout the day, generates summaries/reminders/tasks.
- **Key advantage**: Fully open-source hardware AND software. No vendor lock-in. Many Limitless refugees migrated here.
- **Stars**: Growing rapidly post-Limitless acquisition.
- **What Daemon should steal**: The open-source hardware approach. Daemon's ESP32 pendant should have open firmware. Omi proves there is demand for open wearable AI.
- **What to avoid**: Omi is still primarily a recording device. Daemon should go further with full device control.

#### Plaud Note ($159)
- Best in class for portability and software polish. Better organization tools. But passive -- records, does not act.

#### Market Dynamics (2026)
- Meta acquired Limitless, Amazon acquired Bee
- OpenAI reportedly developing a pocket-sized context-aware device
- Apple reportedly developing an AI wearable pin with microphones and cameras
- **This means**: Big tech sees wearable AI as the next battleground. Daemon needs to move fast on the pendant form factor.

### Memory Architectures

#### Letta/MemGPT (detailed above)
The most important project for Daemon's memory system. Key architecture:
- **Core Memory**: Always in context. User preferences, key facts, current goals.
- **Recall Storage**: Searchable conversation history. Agent retrieves relevant past conversations.
- **Archival Storage**: Long-term knowledge base. Agent stores and retrieves facts, documents, learned patterns.
- Agent uses tool calls (`core_memory_append`, `core_memory_replace`, `archival_memory_insert`, `archival_memory_search`, `conversation_search`) to manage its own memory.

#### How Daemon Should Implement Memory

Daemon already has:
- Qdrant knowledge graph (50+ entries, 6 collections)
- Per-thread conversation memory via --resume flag
- Smart MCP loading based on message content

What Daemon needs to add (learning from Letta):
1. **Self-editing core memory**: A structured block the agent can read/write. Contains: user preferences, device states, current goals, recent learnings.
2. **Semantic recall**: When a new message comes in, automatically search past conversations for relevant context before responding.
3. **Archival promotion**: Agent decides what is worth remembering long-term vs. ephemeral.
4. **Memory compaction**: Periodically summarize old conversations into facts, then archive the raw conversations.

---

## 4. Multi-Device AI

### Apple + Google Partnership (Jan 2026)
- Apple will pay Google ~$1B/year for custom Gemini models to power Siri and Apple Intelligence.
- Apple can distill Gemini into smaller on-device models for iPhones/iPads.
- Gemini will power Siri, Safari, Spotlight -- unified AI across Apple's ecosystem.
- Expected at WWDC 2026 with iOS 27.
- **Key insight**: Even Apple cannot build frontier AI alone. The future is hybrid: cloud models for complex reasoning, distilled on-device models for latency-sensitive tasks.

### Google Gemini Multi-Device
- Gemini is expanding across Android, ChromeOS, Google Home, Pixel Watch.
- Gemini Live for real-time conversation across devices.
- **Key insight**: Google has the deepest cross-device reach (phone, laptop, watch, home, car) but it is still siloed by app/surface.

### Gaps That Daemon Can Fill

1. **Cross-OS**: Apple Intelligence is Apple-only. Google is Android/Chrome-only. **Nobody does Linux + Windows + Android seamlessly.** Daemon does this today via Tailscale SSH mesh.

2. **User-owned**: Apple and Google's multi-device AI runs on their infrastructure. The user has no ownership of the agent's memory, preferences, or conversation history. Daemon is self-hosted.

3. **True agency**: Apple/Google assistants can answer questions and control a few settings. They cannot SSH into your laptop, run a git command, edit a file, deploy a service. Daemon can.

4. **Hardware-agnostic**: Daemon works with any device that has SSH. It does not require a specific vendor ecosystem.

5. **Developer-first**: No existing multi-device AI targets people who write code. Daemon's sweet spot is technical users who want an agent that understands their dev environment.

---

## 5. Skills and Plugin Ecosystems

### OpenClaw and ClawHub
- **Scale**: 13,729 community-built skills as of Feb 2026.
- **Model**: Anyone with a GitHub account (>1 week old) can publish skills.
- **Security crisis**: 41% of popular skills had vulnerabilities. 99.3% had no permissions manifest.
- **Creator acquired by OpenAI** (Feb 2026): Project moved to open-source foundation.
- **Lesson for Daemon**: Skills marketplaces work for growth but need security from day one. A permissions manifest should be mandatory.

### MCP (Model Context Protocol) Ecosystem
- **Scale**: 1,200+ quality-verified MCP servers. Tens of thousands total.
- **Adoption**: OpenAI, Anthropic, Google, HuggingFace, LangChain all standardized on MCP.
- **2026 Roadmap**: MCP Server Cards (.well-known URL for capability discovery), registry improvements.
- **Relevance**: Daemon already uses MCP (smart MCP loading for device access tools). The MCP ecosystem is the richest source of pre-built integrations.

### A2A (Agent2Agent Protocol)
- **What it is**: Google-led protocol for agent-to-agent communication. Launched April 2025.
- **Scale**: 150+ organizations support it. Now under Linux Foundation governance.
- **Key features**: Agent Cards (JSON capability discovery), task lifecycle management, context sharing between agents.
- **Relevance**: If Daemon wants to communicate with other AI agents (e.g., a customer's agent negotiating with your agent), A2A is the protocol.

### ChatGPT Plugins -- Post-Mortem
- OpenAI launched the plugin ecosystem in 2023, then effectively abandoned it in favor of GPTs and then the Agents SDK.
- **What failed**: Plugins were too limited (HTTP-only, no state, no persistence). Discovery was poor. Users did not want to manually select plugins.
- **What worked**: The concept of extending AI with external capabilities is sound.
- **Lesson for Daemon**: Skills should be automatically discovered and loaded based on context (which Daemon already does with smart MCP loading), not manually selected by the user.

### Composio
- **What it is**: 1,000+ tool integrations with OAuth handling, sandboxed execution, parallel execution.
- **Key value**: Handles authentication end-to-end. Just-in-time tool calls.
- **Relevance**: If Daemon needs to integrate with SaaS tools (Slack, GitHub, Google Calendar), Composio provides pre-built authenticated integrations rather than building from scratch.

### E2B
- **What it is**: Open-source sandboxed cloud runtime for AI-generated code execution. Firecracker microVMs.
- **Key features**: ~150ms startup, sessions up to 24 hours, Python/JS SDKs.
- **Relevance**: When Daemon needs to execute untrusted code (e.g., from a community skill), E2B provides safe sandboxing.

### What Skills Would Be Most Valuable for a Personal Device Agent

Based on ecosystem analysis, the highest-value skills for Daemon would be:

1. **File management** -- search, organize, backup across devices
2. **Communication** -- email triage, message drafting, calendar management
3. **Development** -- git operations, deploy, debug, code review
4. **System administration** -- process management, monitoring, updates
5. **Knowledge management** -- save articles, summarize documents, maintain notes
6. **Media** -- photo organization, music control, screen capture
7. **Smart home** -- if/when Daemon expands to home devices
8. **Travel** -- booking, itinerary management (Daemon already has Cabinet for this)
9. **Finance** -- expense tracking, invoice management
10. **Health/wellness** -- activity tracking, sleep data, reminders

---

## 6. Protocols and Interoperability

### The Two-Protocol World

The AI agent ecosystem has converged on two complementary protocols:

| Protocol | Purpose | Governs |
|----------|---------|---------|
| **MCP** (Model Context Protocol) | Agent-to-tool communication | How agents access tools, data sources, and external capabilities |
| **A2A** (Agent2Agent Protocol) | Agent-to-agent communication | How agents discover, communicate with, and delegate to other agents |

**Daemon should support both.** MCP is already in use. A2A should be on the roadmap for when Daemon needs to interact with other people's agents.

### What This Means Architecturally

Daemon's current architecture (Python orchestrator + Claude Code CLI + MCP tools) maps well to this:
- MCP tools = the agent's capabilities (SSH, file access, device control, knowledge graph)
- A2A = future capability for Daemon-to-Daemon communication (e.g., Arthur's Daemon talks to a collaborator's Daemon)

---

## 7. Safety and Security

### State of AI Agent Safety (2026)

Key findings from research:
- **62% of cases**: State-of-the-art LLMs exhibit safety risks during tool use with malicious inputs.
- **Pressure increases misbehavior**: Realistic pressures (deadlines, urgency) dramatically increase rates of harmful tool use by agents.
- **77% vulnerability detection**: AI agents can discover software vulnerabilities in real software -- meaning malicious agents are a real threat.

### OWASP AI Agent Security Top 10 (2026)
OWASP released an agent-specific security risk framework. Key risks:
- Prompt injection via tool outputs
- Excessive permissions / capability scope
- Insufficient audit logging
- Uncontrolled code execution

### HAICOSYSTEM
- Academic framework for sandboxing safety risks in interactive AI agents.
- Simulates seven domains to test agent safety.
- Key finding: Tool use is the most dangerous surface area.

### Recommended Security Patterns for Daemon

1. **Sandboxed execution**: All community/untrusted skills run in isolated environments (E2B or Docker).
2. **Scoped credentials**: Short-lived, minimal-privilege credentials for each tool invocation. Daemon already has this partially (SSH keys are device-specific).
3. **Audit logging**: Every tool call, every device command logged with timestamp, intent, and result.
4. **Permissions manifest**: Any skill/plugin must declare what it needs access to. User approves on install.
5. **Runtime policy enforcement**: Hard limits on what the agent can do without human confirmation (e.g., never delete files without asking, never send money without confirmation).
6. **Anomaly detection**: Monitor for unusual patterns (agent suddenly accessing devices it never accesses, making network requests to unknown hosts).

---

## 8. Key Takeaways for Daemon

### What Daemon Already Gets Right

1. **Real device control via SSH mesh** -- No other personal AI does this. Cross-OS (Linux + Windows + Android) is unique.
2. **Claude Code as the execution engine** -- The proactive, shell-based execution model is exactly what the Claude Agent SDK formalizes. Daemon was ahead of the curve.
3. **Smart MCP loading** -- Context-aware tool loading (15s simple, 27s with tools) is a pattern that even major frameworks are just now adopting.
4. **Self-hosted, user-owned** -- In a world where Meta acquires and kills Limitless, user ownership is a real differentiator.
5. **Hardware pendant (ESP32)** -- The wearable AI device market is exploding. Having open hardware is the right bet.

### What Daemon Should Build Next (Priority Order)

1. **Self-editing memory (from Letta/MemGPT)**
   - Let the agent manage its own core memory block
   - Semantic search over past conversations before responding
   - Archival promotion for long-term facts
   - This is the single highest-impact improvement

2. **Agent handoff pattern (from OpenAI Agents SDK)**
   - Define sub-agents for each device (MSI specialist, Pixel specialist, ESP32 specialist)
   - Main daemon routes to the right sub-agent based on intent
   - Each sub-agent has device-specific tools and knowledge

3. **Durable execution / checkpointing (from LangGraph)**
   - For long-running tasks (deploy a service, backup files across devices), save state
   - If the task fails midway, resume from the last checkpoint
   - Critical for reliability

4. **Skills/plugin system with permissions (from OpenClaw, avoiding its mistakes)**
   - Define a skill format (MCP server + manifest)
   - Mandatory permissions declaration
   - Sandboxed execution for untrusted skills (via E2B or Docker)
   - Start with 10-20 first-party skills, open to community later

5. **A2A protocol support (from Google A2A)**
   - Daemon-to-Daemon communication
   - Agent Card for capability discovery
   - Enables multi-user collaboration scenarios

6. **On-device inference for the pendant (from SwitchBot AI Hub, Apple distillation approach)**
   - Run a small model on ESP32-S3 for latency-sensitive responses
   - Cloud model for complex reasoning
   - Hybrid approach: on-device for wake word detection, intent classification; cloud for full reasoning

### The Competitive Landscape in One Sentence

Big tech (Apple, Google, Meta) is converging on wearable AI and multi-device assistants, but they are locked into their own ecosystems, privacy-hostile, and cannot offer true agency (SSH, code execution, system administration). **Daemon's moat is being the open, cross-platform, developer-first personal AI agent that actually controls your devices instead of just answering questions about them.**

### Architecture Recommendation

```
                    +------------------+
                    |   Daemon Core    |
                    |  (Orchestrator)  |
                    +--------+---------+
                             |
              +--------------+--------------+
              |              |              |
     +--------v--+   +------v-----+  +-----v------+
     | MSI Agent |   |Pixel Agent |  | ESP32 Agent|
     | (Windows) |   | (Android)  |  | (Pendant)  |
     +-----------+   +------------+  +------------+
              |              |              |
              v              v              v
         SSH/PowerShell  SSH/Termux    WiFi/TCP

    Memory Layer:
    +--------------------------------------------+
    | Core Memory (always in context)            |
    | Recall Storage (semantic search over past) |
    | Archival Storage (Qdrant knowledge graph)  |
    +--------------------------------------------+

    Protocol Layer:
    +-------------------+-------------------+
    | MCP (tool access) | A2A (agent comms) |
    +-------------------+-------------------+

    Skill Layer:
    +--------------------------------------------+
    | First-party skills | Community skills      |
    | (trusted, direct)  | (sandboxed, permitted)|
    +--------------------------------------------+
```

### Projects to Watch

| Project | Why | Check Back |
|---------|-----|------------|
| Letta | Memory architecture evolution | Monthly |
| OpenClaw | Skills ecosystem + security lessons | Monthly |
| Google ADK | Gemini Live bidirectional streaming | Quarterly |
| A2A Protocol | Spec maturity for agent interop | Quarterly |
| MCP Registry | New servers relevant to Daemon | Monthly |
| Omi | Open-source wearable hardware reference | Quarterly |
| Mastra | TypeScript agent framework if web needs it | Quarterly |
| Apple AI wearable pin | Competitor in pendant space | When announced |
| OpenAI pocket device | Competitor in personal AI device | When announced |

---

## Sources

### Agent Frameworks
- [Top 10 AI Agent Frameworks 2026 (o-mega)](https://o-mega.ai/articles/langgraph-vs-crewai-vs-autogen-top-10-agent-frameworks-2026)
- [Top 10 Most Starred AI Agent Frameworks on GitHub 2026](https://techwithibrahim.medium.com/top-10-most-starred-ai-agent-frameworks-on-github-2026-df6e760a950b)
- [From MCP to Multi-Agents: Top 10 Open Source AI Projects (GitHub Blog)](https://github.blog/open-source/maintainers/from-mcp-to-multi-agents-the-top-10-open-source-ai-projects-on-github-right-now-and-why-they-matter/)
- [Awesome AI Agents (e2b-dev)](https://github.com/e2b-dev/awesome-ai-agents)
- [120+ Agentic AI Tools Mapped (StackOne)](https://www.stackone.com/blog/ai-agent-tools-landscape-2026/)

### Claude Agent SDK
- [Agent SDK Overview (Anthropic Docs)](https://platform.claude.com/docs/en/agent-sdk/overview)
- [Building Agents with Claude Agent SDK (Anthropic Engineering)](https://www.anthropic.com/engineering/building-agents-with-the-claude-agent-sdk)
- [Claude Agent SDK Python (GitHub)](https://github.com/anthropics/claude-agent-sdk-python)

### OpenAI Agents SDK
- [OpenAI Agents SDK Docs](https://openai.github.io/openai-agents-python/)
- [Guardrails](https://openai.github.io/openai-agents-python/guardrails/)
- [Handoffs](https://openai.github.io/openai-agents-python/handoffs/)

### LangGraph
- [LangGraph Platform GA](https://blog.langchain.com/langgraph-platform-ga/)
- [LangGraph GitHub](https://github.com/langchain-ai/langgraph)

### Microsoft Agent Framework
- [Introducing Microsoft Agent Framework (Azure Blog)](https://azure.microsoft.com/en-us/blog/introducing-microsoft-agent-framework/)
- [Semantic Kernel + AutoGen Convergence](https://visualstudiomagazine.com/articles/2025/10/01/semantic-kernel-autogen--open-source-microsoft-agent-framework.aspx)

### Google ADK
- [ADK Overview (Google Cloud)](https://docs.cloud.google.com/agent-builder/agent-development-kit/overview)
- [ADK GitHub](https://github.com/google/adk-python)

### A2A Protocol
- [Announcing A2A (Google Developers Blog)](https://developers.googleblog.com/en/a2a-a-new-era-of-agent-interoperability/)
- [Linux Foundation A2A Launch](https://www.linuxfoundation.org/press/linux-foundation-launches-the-agent2agent-protocol-project-to-enable-secure-intelligent-communication-between-ai-agents)
- [A2A GitHub](https://github.com/a2aproject/A2A)

### MCP
- [MCP Roadmap 2026](http://blog.modelcontextprotocol.io/posts/2026-mcp-roadmap/)
- [MCP Awesome Directory (1,200+ servers)](https://mcp-awesome.com/)
- [MCP Ecosystem 2026 Analysis](https://www.contextstudios.ai/blog/mcp-ecosystem-in-2026-what-the-v127-release-actually-tells-us)

### Device Control / IoT
- [Home Assistant AI Agents](https://www.home-assistant.io/blog/2024/06/07/ai-agents-for-the-smart-home/)
- [Building AI-Powered Local Smart Home (Home Assistant)](https://www.home-assistant.io/blog/2025/09/11/ai-in-home-assistant/)
- [AIoT Smart Home via LLM Agents (IEEE)](https://ieeexplore.ieee.org/document/10729865/)
- [IoTGPT Paper](https://arxiv.org/abs/2601.04680)

### Personal AI / Memory
- [Letta/MemGPT GitHub](https://github.com/letta-ai/letta)
- [MemGPT Research](https://research.memgpt.ai/)
- [Letta Agent Memory Blog](https://www.letta.com/blog/agent-memory)
- [Meta Acquires Limitless (TechCrunch)](https://techcrunch.com/2025/12/05/meta-acquires-ai-device-startup-limitless/)
- [Omi AI](https://www.omi.me/)
- [AI Wearable Devices 2026 (Plaud)](https://www.plaud.ai/blogs/articles/9-life-changing-ai-wearable-devices-in-2026)

### Multi-Device AI
- [Apple-Google Gemini Deal (TechCrunch)](https://techcrunch.com/2026/01/12/googles-gemini-to-power-apples-ai-features-like-siri/)
- [Apple Distilling Gemini On-Device (Winbuzzer)](https://winbuzzer.com/2026/03/26/apple-distill-google-gemini-on-device-siri-models-xcxwbn/)

### Skills/Plugins
- [OpenClaw Wikipedia](https://en.wikipedia.org/wiki/OpenClaw)
- [OpenClaw Skills Docs](https://docs.openclaw.ai/tools/skills)
- [Awesome OpenClaw Skills (5,400+ curated)](https://github.com/VoltAgent/awesome-openclaw-skills)
- [Composio](https://composio.dev/)
- [E2B GitHub](https://github.com/e2b-dev/E2B)

### Safety
- [International AI Safety Report 2026](https://internationalaisafetyreport.org/publication/international-ai-safety-report-2026/)
- [OWASP AI Agent Security Top 10 2026](https://medium.com/@oracle_43885/owasps-ai-agent-security-top-10-agent-security-risks-2026-fc5c435e86eb)
- [HAICOSYSTEM Sandboxing Paper](https://arxiv.org/abs/2409.16427)
- [AI Agents Under Pressure (IEEE Spectrum)](https://spectrum.ieee.org/ai-agents-safety)

### Other Frameworks
- [Mastra GitHub](https://github.com/mastra-ai/mastra)
- [smolagents GitHub (HuggingFace)](https://github.com/huggingface/smolagents)
- [n8n GitHub](https://github.com/n8n-io/n8n)
- [Dify GitHub](https://github.com/langgenius/dify)
