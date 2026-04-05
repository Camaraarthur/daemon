# AI Architecture Research: Model Routing, Memory, and Personalization

**Date**: April 2026
**Context**: Daemon multi-device agent platform
**Current stack**: 3-tier routing (Qwen/DeepSeek/Claude), Gemini summarization, Qdrant vector search

---

## Table of Contents

1. [Model Routing Strategies](#1-model-routing-strategies)
2. [Context Window Management](#2-context-window-management)
3. [Memory Architectures](#3-memory-architectures)
4. [Personalization and Character](#4-personalization-and-character)
5. [Agent Loop Design](#5-agent-loop-design)
6. [Tool Execution and Sandboxing](#6-tool-execution-and-sandboxing)
7. [Embedding Models Comparison](#7-embedding-models-comparison)
8. [Recommendations for Daemon](#8-recommendations-for-daemon)

---

## 1. Model Routing Strategies

### Current State: Static Tier Assignment

Daemon currently uses static routing: free tier -> Qwen3-Coder (OpenRouter), mid tier -> DeepSeek, premium tier -> Claude Opus. The user's subscription level determines the model. This leaves money on the table -- many "premium" queries could be handled by cheaper models, and some "free" queries genuinely need a better model.

### Dynamic Routing: The Landscape

#### OpenRouter (the gateway approach)

- **Architecture**: Unified API gateway for 290+ models. Not a router per se -- it's a proxy with smart provider selection.
- **Suffixes**: `:floor` selects lowest-cost provider for a model. `:nitro` selects fastest provider (highest tokens/sec). These are provider-level routing, not model-level routing.
- **Markup**: No per-inference markup. 5.5% fee on credit purchases ($27.50 on a $500/month bill).
- **Latency overhead**: Claims ~25-40ms, independent benchmarks show 100-150ms in practice.
- **Cost examples** (April 2026):
  - Claude Opus 4.6: $5.00/$25.00 per 1M tokens (input/output)
  - Claude Sonnet 4.5: $3.00/$15.00
  - DeepSeek Chat: $0.32/$0.89
  - GPT-5: $1.25/$10.00
- **Verdict for Daemon**: Use OpenRouter as the default gateway. The 5.5% markup is worth the unified billing, instant model switching, automatic failover, and `cost` field in responses for tracking. Only go direct API for Claude (where we want Agent SDK features) or if latency is critical.

#### Martian (YC-backed, $9M raised)

- **Architecture**: Uses "Model Mapping" -- mechanistic interpretability to convert model internals into human-readable programs. Small local classification model routes each request to the cheapest model that can handle it.
- **Claims**: Up to 98% cost savings by routing to cheaper models when quality is equivalent.
- **Reality check**: Newer product, less battle-tested than OpenRouter. Intent classification routers require evaluation pipelines -- teams that skip this report silent quality degradation.
- **Savings profile**: 30-50% cost savings from intent classification routing.
- **Verdict**: Interesting but risky for v0. We'd need eval pipelines to catch quality regressions.

#### Unify.ai (the learned router)

- **Architecture**: Neural scoring function predicts per-model quality for each prompt. Balances quality/speed/cost based on user preferences. Benchmarks refresh every 10 minutes.
- **Differentiator**: The router itself is a learned neural network, not just rules.
- **Verdict**: More sophisticated than Martian but adds another dependency. Consider for v2 when we have traffic to justify it.

#### Not Diamond (optimization layer)

- **Architecture**: Sits on top of existing gateways. Adds prompt adaptation -- rewrites prompts per-model for better results. Uses RoRF (random forest) for pairwise model comparison.
- **Key fact**: OpenRouter uses Not Diamond to power its intelligent routing feature.
- **Open source**: Maintains awesome-ai-model-routing repo on GitHub with open-source routing approaches.
- **Verdict**: If we use OpenRouter, we already get Not Diamond routing for free.

#### LiteLLM (self-hosted gateway)

- **Architecture**: Open-source OpenAI-compatible proxy. Supports 100+ providers including Azure, AWS Bedrock, self-hosted models.
- **Cost**: Free, but shifts cost to engineering time and infrastructure.
- **Verdict**: Good option if we want full control and can invest in DevOps. Could run alongside OpenRouter.

### Routing Strategy Cost Savings Summary

| Strategy | Typical Savings | Quality Risk | Implementation Effort |
|----------|----------------|--------------|----------------------|
| Static tier (current) | 0% (baseline) | None | Done |
| OpenRouter :floor | 10-15% | None | 1 day |
| Intent classification (Martian-style) | 30-50% | Medium (needs eval) | 2-3 weeks |
| Hybrid caching + routing | 50-65% | Low | 1-2 weeks |
| Full learned router (Unify-style) | 40-60% | Low-Medium | Build vs buy |

### Cost at Scale: OpenRouter vs Direct API

| Scale | Monthly Token Cost | OpenRouter Fee (5.5%) | Total Overhead |
|-------|-------------------|----------------------|----------------|
| 1K msg/mo | ~$5-20 | $0.28-1.10 | Negligible |
| 10K msg/mo | ~$50-200 | $2.75-11.00 | Negligible |
| 100K msg/mo | ~$500-2,000 | $27.50-110.00 | Worth it for convenience |

**Decision for Daemon v0**: Use OpenRouter for all models except Claude (direct API via Agent SDK). This gives us unified billing, the `cost` field for per-user tracking, automatic failover, and access to every model instantly. The 5.5% fee is trivial at our scale. Add simple message-complexity classification later (v1) to route between tiers dynamically.

---

## 2. Context Window Management

### The State of Context in April 2026

- Claude 4.6: 1M tokens (this model)
- Claude Sonnet 4.5: 200K tokens
- Gemini 3: 2M tokens
- GPT-5: 256K tokens
- DeepSeek: 128K tokens
- Qwen3-Coder: 128K tokens

### Does 1M Context Eliminate Complex Management?

**No, but it simplifies it significantly.** Key findings:

1. **Effective capacity is 60-70% of advertised maximum.** A 200K model becomes unreliable around 130K tokens. Performance drops are sudden, not gradual.
2. **"Lost in the middle" problem persists.** Accuracy drops 10-20+ percentage points when relevant information is in the middle of long contexts vs beginning/end.
3. **Cost scales linearly with context.** Sending 100K tokens of context costs 100x more than sending 1K tokens of relevant context.
4. **Latency scales with context.** RAG pipeline: ~1 second end-to-end. Long context: 30-60 seconds for the same workload.

### Optimal Strategy: Hybrid (RAG + Long Context)

The 2026 consensus is clear: use retrieval to decide WHAT goes into context, then use long context to reason OVER that evidence set.

**Five-layer context management:**

1. **RAG for selective retrieval** -- pull only relevant memories/docs
2. **Sliding window with summarization** -- compress old conversation turns
3. **Context compression** -- summarize verbose tool outputs
4. **Prompt caching** -- reuse system prompt, tool definitions across turns (Claude does this automatically)
5. **Subagents for isolation** -- each subtask gets a fresh context window

### What Claude Code Does (and we should copy)

Claude Agent SDK's approach:
- **Automatic compaction**: When context approaches the limit, older messages are summarized. A `compact_boundary` event fires so you can archive the full transcript.
- **Persistent rules in CLAUDE.md**: These are re-injected on every request, surviving compaction. User personality/preferences should live here, not in conversation history.
- **Subagents**: Each subagent starts with a fresh context. Only its final response returns to the parent as a tool result. This prevents context explosion on multi-step tasks.
- **Prompt caching**: System prompt and tool definitions are cached, so only the first request pays full cost.

### Daemon Context Strategy

| Component | Strategy | Why |
|-----------|----------|-----|
| System prompt + personality | Always in context (cached) | Defines the character. ~2-5K tokens. |
| Recent conversation | Full messages, last N turns | Direct context for current task |
| Older conversation | Summarized | Saves tokens, preserves key decisions |
| User memories | RAG retrieval, top-K relevant | Only inject what's relevant |
| Tool outputs | Truncate/summarize large outputs | Prevent context pollution |
| Long tasks | Subagent delegation | Fresh context per subtask |

**Target**: Keep active context under 30K tokens for free tier (Qwen), 60K for mid tier (DeepSeek), unlimited for premium (Claude). This keeps costs low and responses fast.

---

## 3. Memory Architectures

### Current State

Daemon uses Gemini-based summarization to extract memories from conversations, stored in Qdrant for vector search. This is basic but functional.

### The Memory Framework Landscape (April 2026)

#### Mem0 (most adopted, 48K GitHub stars)

- **Architecture**: Hybrid datastore combining vector DB (semantic search), knowledge graph (relationships), and key-value store (facts/preferences).
- **Memory types**: Episodic (what happened), semantic (what is known), procedural (how to do things).
- **Self-hosted**: Three Docker containers (FastAPI + PostgreSQL/pgvector + Neo4j). `docker compose up` to run.
- **Cloud pricing**: $19/mo (vector only), $249/mo (with graph features). The jump is steep.
- **Self-hosted cost**: ~$30/mo (t3.medium) for the infrastructure.
- **Benchmark**: 49.0% on LongMemEval -- significantly below other dedicated systems.
- **Production concerns (self-hosted)**: No auth system, uses SQLite for history, questionable production-readiness of OSS version.
- **Verdict**: Biggest ecosystem but mediocre benchmarks. Graph features locked behind expensive tier. Self-hosted version is incomplete.

#### Letta (formerly MemGPT)

- **Architecture**: OS-inspired three-tier memory:
  - **Core memory**: Always in context (like RAM). Size-limited blocks for persona/user info. Agent reads AND writes directly.
  - **Recall memory**: Searchable conversation history (like disk cache). Full history preserved, searchable.
  - **Archival memory**: Long-term storage in vector DB (like cold storage). Agent queries via tool calls.
- **Key innovation**: The agent ITSELF decides what to remember. It has tools like `core_memory_replace`, `archival_memory_insert`, `conversation_search`.
- **Sleep-time agents**: Handle memory management asynchronously (not during conversation), improving response times.
- **Cloud pricing**: $20-200/mo.
- **Verdict**: Most elegant architecture. Agent-managed memory is powerful but requires the model to be good at deciding what to save. Works well with capable models (Claude, GPT-5), less so with smaller models.

#### Zep (temporal knowledge graphs)

- **Architecture**: Built on Graphiti -- a temporally-aware knowledge graph engine. Every fact carries validity windows (when it became true, when superseded).
- **Key differentiator**: Temporal reasoning. "Who was the user's employer in January?" vs "Who is their employer now?" are different queries.
- **Entity resolution**: Automatic deduplication of entities across conversations.
- **Pricing**: $25/mo Flex tier includes full Graphiti engine. Graphiti is open source.
- **SOC 2 Type 2 / HIPAA**: Certified for compliance-sensitive deployments.
- **Benchmark**: 63.8% on LongMemEval -- decent.
- **Verdict**: Best for CRM-like use cases where temporal context matters. Overkill for v0 but excellent architecture to learn from.

#### Hindsight (highest benchmarks)

- **Architecture**: Four parallel retrieval strategies: semantic search, BM25 keyword matching, entity graph traversal, temporal filtering.
- **Key innovation**: `reflect` synthesis -- LLM reasoning across retrieved memories to produce coherent context.
- **Benchmark**: 91.4% on LongMemEval -- highest published score.
- **Pricing**: MIT licensed, free self-hosted.
- **Verdict**: Highest quality but newer. Worth watching. Four retrieval strategies might be overkill for our scale.

#### SuperMemory

- **Architecture**: Memory graph + built-in RAG + automatic contradiction resolution.
- **Benchmark**: 81.6% on LongMemEval.
- **Pricing**: Free tier with 1M tokens. Closed-source, enterprise-only self-hosting.
- **Verdict**: Good benchmarks but closed-source is a risk for a product like Daemon.

#### LangMem

- **Architecture**: Flat key-value + vector storage, tightly coupled to LangGraph.
- **Pricing**: MIT, free.
- **Community**: Smallest (~1.3K stars). Severe LangGraph lock-in.
- **Verdict**: Only if we go all-in on LangGraph (we shouldn't).

### Memory System Latency Profiles

| Operation | Latency |
|-----------|---------|
| Vector-only retrieval | 10-50ms |
| Multi-strategy retrieval | 100-600ms |
| LLM synthesis/reflection | 800-3000ms |
| Memory ingestion | 500-2000ms |

### What Claude Code Does for Memory

Claude Code's memory is dead simple and works:
- **CLAUDE.md files**: Persistent instructions loaded every request. User can edit directly.
- **Project memory**: Auto-generated observations stored in markdown files. Loaded per-project.
- **No vector search**: Just text files included in the system prompt.
- **Why it works**: The model is good enough that including relevant text in the system prompt is sufficient for personalization.

### Minimum Viable Memory System for Daemon

**Phase 0 (now)**: Keep Qdrant vector search. Add structured extraction (facts, preferences, relationships) from conversations. Store as JSON alongside embeddings.

**Phase 1**: Add Letta-style core memory blocks. Give the agent tools to manage its own memory:
- `remember(key, value)` -- save a fact/preference
- `forget(key)` -- remove outdated information
- `recall(query)` -- search memories semantically
- `update_persona(trait, value)` -- update personality based on interactions

**Phase 2**: Add temporal awareness (Zep/Graphiti-inspired). Track when facts became true and when they were superseded.

**Gold standard** (Phase 3): Multi-strategy retrieval (semantic + keyword + graph + temporal) with LLM reflection synthesis. This is what Hindsight does.

### Cost at Scale

| Scale | Mem0 Cloud | Mem0 Self-Hosted | Qdrant + Custom |
|-------|-----------|-----------------|----------------|
| 1K users | $19-249/mo | ~$30/mo infra | ~$20/mo (Qdrant Cloud free tier) |
| 10K users | $249+/mo | ~$100/mo infra | ~$50/mo |
| 100K users | Enterprise | ~$500/mo infra | ~$200/mo |

**Decision**: Don't adopt Mem0 or Letta as dependencies. Build a simple memory layer inspired by Letta's architecture on top of our existing Qdrant. The core insight -- agent-managed memory with structured extraction -- is easy to implement. The infra (Qdrant) is already running.

---

## 4. Personalization and Character

### Current State

Daemon has a five-axis personality system (directness, humor, warmth, initiative, formality) with a "settling" mechanic where personality evolves based on conversations. Good foundation.

### How the Industry Does It

#### Character.AI (the gold standard for personality)

Three interlocking layers:
1. **Persona Graph Architecture**: Maps traits, values, and relationship rules into structured embeddings.
2. **Constraint-Aware Inference**: Output logits are dynamically penalized against off-character behavior. This is model-level, not prompt-level.
3. **Memory-Indexed Context Windows**: Long-term recall of user-defined facts without compromising privacy.

Additional components:
- **Persona Initialization Layer**: Lightweight adapter network loads pre-trained trait vectors into the model's attention heads.
- **Context Anchoring Engine**: Identifies user-provided anchors (names, dates, preferences) stored in encrypted ephemeral vector cache.
- **CARE Framework**: Context, Attitude, Response Style, Examples -- structured character definitions.

**What Daemon can borrow**: The CARE framework for system prompt structure. The five-axis personality can map to Attitude + Response Style. Context = user memories. Examples = few-shot dialogue samples that demonstrate the character.

#### Replika (emotional companionship)

- Learns from interactions to build personalized connection
- 3D avatar system + voice chat
- Remembers personal details over time
- Focus on emotional intelligence and relationship dynamics

#### Pi.ai (conversational depth)

- Built by Inflection AI
- Less eager to please than Replika, less theatrical than Character.AI
- Focuses on being a thoughtful conversational partner
- Limited memory and no character customization -- personality is baked into the model weights
- **Key insight**: Pi's approach proves that a strong base conversational style can compensate for limited personalization features

### What Data is Most Useful for Personalization?

Ranked by impact:

1. **Explicit preferences** (stated directly): "I prefer concise answers" -- highest signal, lowest noise
2. **Communication style patterns**: Message length, vocabulary complexity, emoji usage, formality level
3. **Recurring topics**: What the user talks about most reveals interests and priorities
4. **Correction patterns**: When the user corrects the AI, that's gold-standard feedback
5. **Time patterns**: When they message, how long sessions are, response speed expectations
6. **Relationship dynamics**: How they address the AI, what role they expect it to play

### Importing WhatsApp/ChatGPT Exports

**WhatsApp**:
- Export: Settings > Chats > Export Chat (produces .txt file with timestamps)
- Format: `[DD/MM/YYYY, HH:MM:SS] Sender: Message`
- Processing pipeline: Parse -> extract user's messages -> analyze writing style (avg length, vocabulary, common phrases, topics) -> generate personality profile -> store as structured memories
- Privacy: Process locally, extract patterns only, don't store raw messages

**ChatGPT**:
- Export: Settings > Data Controls > Export Data (ZIP with conversations.json)
- Format: JSON with role/content pairs, timestamps, model info
- Processing: Extract user messages -> analyze interaction patterns -> identify preferences, corrections, topic interests
- Bonus: The model responses show what the user found satisfactory (they continued the conversation)

**Processing architecture**: Use Gemini Flash (cheap, fast) to extract structured personality data from chat exports. Store as:
```json
{
  "communication_style": {
    "avg_message_length": 45,
    "formality": 0.3,
    "emoji_frequency": 0.1,
    "vocabulary_complexity": "moderate"
  },
  "topics_of_interest": ["technology", "travel", "cooking"],
  "preferences": {
    "response_length": "concise",
    "humor_level": "moderate"
  },
  "correction_patterns": [
    {"what": "too verbose", "frequency": 5},
    {"what": "too formal", "frequency": 3}
  ]
}
```

### Gemini Multimodal Embeddings for Personal Data

Gemini Embedding 2 supports five modalities: text, image, video, audio, PDF. This enables:
- **Photos**: Embed user's photos to understand visual preferences, life context
- **Voice**: Embed voice recordings to understand communication style
- **Documents**: Embed personal docs to understand professional context

**Cost**: $0.20/MTok. For 1000 photos with captions, ~$0.50. Cheap enough to run on import.

### Daemon Personalization Architecture

```
User Data Import (WhatsApp/ChatGPT/Photos)
    |
    v
Extraction Pipeline (Gemini Flash)
    |
    v
Structured Profile (JSON) + Embeddings (Qdrant)
    |
    v
Core Memory Block (always in system prompt)
    - Name, key preferences, communication style
    - Five-axis personality state
    - Relationship history summary
    |
    v
Dynamic Context (RAG from Qdrant)
    - Relevant memories for current conversation
    - Topic-specific knowledge
    |
    v
System Prompt Assembly
    = Base character + Core memory + Dynamic context + Conversation history
```

---

## 5. Agent Loop Design

### Current State

Daemon has a simple loop: call model -> parse tool calls -> execute -> repeat, max 10 iterations. This works but lacks error handling, parallel execution, budget controls, and subagent delegation.

### Claude Agent SDK (the reference implementation)

The Claude Agent SDK runs the exact same loop as Claude Code. Key architecture:

**Loop cycle**:
1. Receive prompt (with system prompt, tool definitions, conversation history)
2. Evaluate and respond (text, tool calls, or both)
3. Execute tools (SDK runs each tool, collects results)
4. Repeat until no tool calls in response
5. Return result with cost, usage, session ID

**Key features we should adopt**:
- **max_turns**: Cap tool-use round trips to prevent runaway sessions
- **max_budget_usd**: Cap cost per interaction
- **Effort levels**: low/medium/high/max -- controls reasoning depth (and token cost)
- **Parallel tool execution**: Read-only tools run concurrently, write tools run sequentially
- **Permission modes**: default, acceptEdits, plan, dontAsk, bypassPermissions, auto
- **Automatic compaction**: Summarize old context when approaching limits
- **Session continuity**: Resume sessions with full context restoration via session ID
- **Hooks**: PreToolUse, PostToolUse, Stop, SubagentStart/Stop -- intercept without consuming context
- **Subagents**: Fresh context per subtask, only final response returns to parent

**Message types**: SystemMessage (init, compact_boundary), AssistantMessage, UserMessage, StreamEvent, ResultMessage (with subtype: success, error_max_turns, error_max_budget_usd, error_during_execution)

**Implementation**: Available as `@anthropic-ai/claude-agent-sdk` (TypeScript) and `claude_agent_sdk` (Python).

### LangGraph (graph-based state machines)

- **Architecture**: Explicit state machine with nodes and edges. Each node is a function, edges are conditions.
- **Key feature**: Durable execution with checkpointing. Can pause, resume, fork, and rewind agent state.
- **Production strength**: Best observability via LangSmith (token counts per node, detailed traces).
- **Human-in-the-loop**: Built-in support for approval steps.
- **Weakness**: Rigid state management requirements. Verbose boilerplate.
- **Verdict**: Overkill for Daemon v0. The graph model adds complexity without clear benefit for a single-agent system. Consider if we need multi-step workflows with branching logic.

### CrewAI (role-based multi-agent)

- **Architecture**: Agents with defined roles, goals, and backstories. Tasks assigned to agents. Agents collaborate.
- **Strength**: Fastest time-to-production for team-based workflows (40% faster than LangGraph).
- **Weakness**: Poor logging/debugging, tough to refine for complex systems.
- **Verdict**: Wrong model for Daemon. We have ONE agent (the daemon), not a team.

### AutoGen (conversational multi-agent)

- **Architecture**: Agents communicate via conversation. Microsoft product.
- **Status**: Shifted to maintenance mode in favor of broader Microsoft Agent Framework.
- **Verdict**: Dead project, don't use.

### Simplest Loop That Works Reliably

```
async function agentLoop(messages, tools, options) {
  let turns = 0;
  let totalCost = 0;

  while (turns < options.maxTurns) {
    // 1. Call model
    const response = await callModel(messages, tools, {
      effort: classifyEffort(messages),  // low/medium/high based on query
    });

    totalCost += response.cost;
    if (totalCost > options.maxBudget) break;

    // 2. Check for tool calls
    if (!response.toolCalls?.length) {
      return { result: response.text, cost: totalCost, turns };
    }

    // 3. Execute tools (parallel for read-only, sequential for writes)
    const readOnly = response.toolCalls.filter(t => t.readOnly);
    const writes = response.toolCalls.filter(t => !t.readOnly);

    const readResults = await Promise.all(readOnly.map(exec));
    const writeResults = [];
    for (const tool of writes) {
      writeResults.push(await exec(tool));
    }

    // 4. Add results to messages
    messages.push(response.message);
    messages.push({ role: 'user', content: [...readResults, ...writeResults] });

    // 5. Check context size, compact if needed
    if (tokenCount(messages) > options.contextLimit * 0.8) {
      messages = await compactMessages(messages);
    }

    turns++;
  }

  return { result: null, error: 'max_turns', cost: totalCost, turns };
}
```

This is ~50 lines. It covers: turn limits, budget limits, parallel execution, context compaction. Error handling and retry logic add another ~30 lines. Total: ~80 lines for a production-quality agent loop.

**What's overkill for v0**: Graph-based state machines, multi-agent orchestration, durable execution with checkpointing, human-in-the-loop approval flows. All of these can be added later.

---

## 6. Tool Execution and Sandboxing

### Current State

Daemon uses Docker containers with gVisor for free/mid tiers. This provides hardware-level isolation.

### The Sandbox Landscape

#### E2B (the standard for AI sandboxes)

- **Architecture**: Firecracker microVMs. Hardware-level isolation.
- **Cold start**: ~150ms
- **Pricing**: $0.05/hr (1 vCPU). Free tier with $100 credit.
- **Pro plan**: $150/mo for 24-hour sessions, higher concurrency.
- **Features**: Any language, custom templates, file system persistence, Python/JS SDKs.
- **GPU**: No.
- **Self-hosting**: Open source, BYOC on AWS for enterprise.
- **Who uses it**: Widely adopted for coding agents.

#### Daytona ($24M Series A, Feb 2026)

- **Architecture**: Docker containers (default), Kata Containers/Sysbox for enhanced isolation.
- **Cold start**: ~90ms (fastest)
- **Pricing**: $0.08/hr. $200 free credits. Startups get up to $50K credits.
- **Features**: Full Git integration, LSP support, Computer Use sandboxes (desktop automation).
- **GPU**: Yes.
- **Differentiator**: Stateful sandboxes -- pause, fork, snapshot, resume. Built for development, not just execution.
- **Self-hosting**: Enterprise only.

#### Modal (GPU powerhouse)

- **Architecture**: gVisor isolation, massive autoscaling (0 to 20,000+ containers).
- **Cold start**: Sub-second.
- **Pricing**: $0.12/hr (with multipliers). Free tier with $30/mo credits.
- **GPU**: Extensive (A100, H100, etc.).
- **Features**: Python-centric, snapshot-based, no BYOC.
- **Best for**: GPU-intensive workloads, ML inference.

#### Comparison Summary

| Feature | Docker+gVisor (current) | E2B | Daytona | Modal |
|---------|------------------------|-----|---------|-------|
| Cold start | ~500ms | ~150ms | ~90ms | sub-1s |
| Price/hr | $0 (self-hosted) | $0.05 | $0.08 | $0.12 |
| Isolation | gVisor | Firecracker | Docker/Kata | gVisor |
| GPU | If available | No | Yes | Yes |
| Persistence | Manual | Yes | Yes (stateful) | Snapshots |
| Self-host | Yes | Yes (OSS) | Enterprise | No |
| Max runtime | Unlimited | 24hr (Pro) | Unlimited | 24hr |

### How Claude Code Executes Tools

Claude Code runs tools **directly on the host machine** with a permission system:
- Read-only tools (Read, Glob, Grep): Always allowed, run in parallel
- Write tools (Edit, Write): Require permission or pre-approval
- Execution (Bash): Gated by allow rules (e.g., `Bash(npm:*)`)
- Permission modes control the approval flow

**No sandboxing at all.** Claude Code trusts the user to set appropriate permissions. The model's own safety training prevents dangerous commands.

### Is Sandboxing the Right Model for Daemon?

**It depends on the tier:**

| Tier | Sandboxing | Why |
|------|-----------|-----|
| Free (Qwen) | Yes, Docker+gVisor | Untrusted model, limit blast radius |
| Mid (DeepSeek) | Optional | Semi-trusted, user can opt out |
| Premium (Claude) | No, direct execution | Trusted model with its own safety. Like Claude Code. |
| "Full sudo" product | No | This IS the product. User wants full access. |

**Decision for Daemon**: Keep Docker+gVisor for free tier. Add a "trust level" setting per user. Premium users who want Claude Code-style direct execution get it. This is a competitive differentiator -- "your daemon has full access to your machine, like Claude Code but always-on."

For scale (if we need cloud sandboxes): E2B is the default choice. $0.05/hr, great SDKs, open source. Daytona if we need stateful long-running environments. Modal only if we need GPUs.

---

## 7. Embedding Models Comparison

### Current State

Daemon uses Gemini embedding-001 (text-only, 768 dims, 2048 token limit).

### April 2026 Benchmark Results

#### Top Models by Task

**Cross-Modal Retrieval (text <-> image):**
1. Qwen3-VL-2B: 0.945 (open source, 2B params)
2. Gemini Embedding 2: 0.928
3. Voyage MM-3.5: 0.900

**Cross-Lingual Retrieval:**
1. Gemini Embedding 2: 0.997 (perfect on idioms)
2. Qwen3-VL-2B: 0.988
3. Jina v4: 0.985

**Long Document (Needle-in-Haystack):**
1. Gemini Embedding 2: Perfect 1.0 across full 32K range (only model to do this)
2. OpenAI 3-large: 1.0 (up to 8K)
3. Jina v4: 1.0 (up to 8K)

**Dimension Compression (MRL at 256 dims):**
1. Voyage MM-3.5: 0.7% degradation
2. Jina v4: 0.6% degradation
3. Gemini Embedding 2: Last place (0.668)

#### Pricing Comparison

| Model | Cost/1M tokens | Dimensions | Context | Modalities | Local? |
|-------|---------------|-----------|---------|------------|--------|
| Gemini Embedding 2 | $0.20 | 3072 | 32K | Text/Image/Video/Audio/PDF | No |
| Gemini embedding-001 | $0.15 | 768 | 2048 | Text | No |
| OpenAI text-embedding-3-large | $0.13 | 3072 | 8192 | Text | No |
| OpenAI text-embedding-3-small | $0.02 | 1536 | 8192 | Text | No |
| Mistral Embed | $0.01 | 1024 | 8192 | Text | No |
| Cohere embed-v4 | ~$0.10 | Fixed | 512 | Text | No |
| Nomic embed-text | Free | 768 | 8192 | Text | Yes (137M, CPU) |
| BGE-M3 | Free | 1024 | 8192 | Text (100+ langs) | Yes (568M) |
| Jina v4 | ~$0.15 | 2048 | 32K | Text/Image/PDF | No |
| Qwen3-VL-2B | Free | 2048 | N/A | Text/Image/Video | Yes (2B, GPU) |

#### Free Tier Costs (Google)

Gemini embedding-001: 1,500 requests/day free. That's ~45K requests/month. Sufficient for early users.

### Dimension Analysis

- **768 dims** (nomic, current Gemini): Sufficient for basic similarity search. Smallest storage footprint.
- **1024 dims** (BGE-M3, Voyage, mxbai): Good balance of quality and storage. ~33% more storage than 768.
- **2048 dims** (Jina v4, Qwen): High quality, 2.6x storage vs 768.
- **3072 dims** (Gemini 2, OpenAI 3-large): Maximum quality. 4x storage vs 768.

For Qdrant at our scale (thousands, not millions of vectors), storage is irrelevant. Use higher dims.

### Can We Run Embeddings Locally?

**Yes, and it makes sense for Daemon:**

- **Nomic embed-text** (137M params): Runs on CPU. Outperforms OpenAI ada-002 and text-embedding-3-small. Supports 8192 tokens. Zero cost after hardware.
- **BGE-M3** (568M params): Needs ~2GB RAM. 100+ languages. Best open-source multilingual option.
- **Qwen3-VL-2B**: Needs GPU (2B params). Best open-source multimodal.

Running locally via Ollama:
```bash
ollama pull nomic-embed-text
# Then query via HTTP API at localhost:11434
```

**Cost comparison for 100K messages/month:**

| Approach | Monthly Cost | Latency | Quality |
|----------|-------------|---------|---------|
| Gemini embedding-001 (free tier) | $0 (within limits) | ~100ms | Good |
| Gemini Embedding 2 (API) | ~$20 | ~100ms | Excellent |
| OpenAI 3-small (API) | ~$2 | ~50ms | Good |
| Nomic local (CPU) | $0 | ~20ms | Good |
| BGE-M3 local | $0 | ~50ms | Good+ |

### Decision for Daemon

**Phase 0 (now)**: Upgrade from Gemini embedding-001 to Gemini Embedding 2. It's the best all-rounder (cross-lingual, long documents, multimodal). Cost is $0.20/MTok which is ~$20/month at scale.

**Phase 1**: Add local Nomic embed-text via Ollama for free-tier users and on-device embedding on MSI/arturito. Zero marginal cost.

**Phase 2**: If we need multimodal (photos, voice, docs), Gemini Embedding 2 is the only option that does text + image + audio + video + PDF in one model. Use it selectively for media imports.

---

## 8. Recommendations for Daemon

### Priority-Ordered Implementation Plan

#### Immediate (this week)

1. **Switch to OpenRouter** for Qwen and DeepSeek routing. Keep direct Anthropic API for Claude (Agent SDK). Get unified billing and the `cost` field for per-user tracking.

2. **Upgrade embeddings** from Gemini embedding-001 to Gemini Embedding 2 (3072 dims, 32K context, multimodal). Update Qdrant collection accordingly.

3. **Add agent loop controls**: max_turns (default 15), max_budget_usd (configurable per tier), effort classification based on message complexity.

#### Short-term (next 2 weeks)

4. **Implement Letta-style memory tools**: Give the agent `remember()`, `recall()`, `forget()`, `update_persona()` tools. Store structured memories in Qdrant alongside embeddings.

5. **Add context management**: Automatic compaction when approaching context limits. Persistent rules (personality, preferences) in a CLAUDE.md-style block that survives compaction.

6. **Build data import pipeline**: WhatsApp/ChatGPT export parser -> Gemini Flash extraction -> structured profile + embeddings. Store in Qdrant.

#### Medium-term (next month)

7. **Simple dynamic routing**: Classify message complexity (regex + heuristics, not ML) and route to cheapest capable model. This alone should save 30-40% on costs.

8. **Add parallel tool execution**: Read-only tools run concurrently, write tools sequentially. Copy Claude Agent SDK's approach.

9. **Improve personality system**: Adopt CARE framework (Context, Attitude, Response Style, Examples). Generate few-shot examples from user's chat history.

#### Long-term (v1)

10. **Temporal memory** (Zep/Graphiti-inspired): Track when facts became true and when superseded. Important for a personal AI that knows you over months/years.

11. **Local embeddings**: Nomic via Ollama for on-device embedding. Zero cost, lower latency, works offline.

12. **Learned routing**: Train a small classifier on our actual traffic to predict model quality per query. This is what Unify/Not Diamond do.

### Architecture Summary

```
User Message
    |
    v
[Message Classifier] -- complexity/intent/effort
    |
    v
[Model Router] -- OpenRouter (Qwen/DeepSeek) or Direct (Claude)
    |
    v
[Context Assembly]
    |-- System prompt (cached)
    |-- Core memory block (personality + key facts)
    |-- RAG results from Qdrant (relevant memories)
    |-- Recent conversation (last N turns)
    |-- Summarized older conversation
    |
    v
[Agent Loop]
    |-- Call model
    |-- Parse tool calls
    |-- Execute tools (parallel read, sequential write)
    |-- Check budget/turns/context limits
    |-- Compact if needed
    |-- Repeat until done
    |
    v
[Post-Processing]
    |-- Extract memories (async, Gemini Flash)
    |-- Update personality axes (settling mechanic)
    |-- Log cost for billing
    |-- Return response to user
```

### What NOT to Build

- **Don't adopt a framework** (LangGraph, CrewAI, etc.). Our agent loop is ~80 lines. Frameworks add dependency risk and cognitive overhead without clear benefit at our scale.
- **Don't use Mem0 or Letta as dependencies**. Build the memory tools yourself on Qdrant. The architecture is simple; the value is in the implementation, not the library.
- **Don't build sandboxing infrastructure**. Docker+gVisor works. If we need cloud sandboxes later, buy E2B ($0.05/hr).
- **Don't build a model router**. Use OpenRouter. If we need smarter routing later, add a classifier in front.
- **Don't over-index on benchmarks**. LongMemEval scores don't predict user satisfaction. Ship something, measure retention, iterate.

---

## Sources

### Model Routing
- [Martian: LLM Router](https://work.withmartian.com/)
- [Martian Model Mapping Technique](https://finance.yahoo.com/news/martian-invents-model-router-beats-190000381.html)
- [Best AI Model Routers 2026](https://www.artifilog.com/posts/best-ai-model-routers)
- [OpenRouter Nitro and Floor Shortcuts](https://openrouter.ai/announcements/introducing-nitro-and-floor-price-shortcuts)
- [OpenRouter Pricing 2026](https://brainroad.com/openrouter-pricing-explained-the-complete-2026-breakdown/)
- [OpenRouter vs Direct API vs Subscriptions](https://docs.bswen.com/blog/2026-03-06-openrouter-vs-api-vs-subscriptions/)
- [Unify AI Router](https://xnavi.ai/tools/unify)
- [Not Diamond](https://www.notdiamond.ai/)
- [Not Diamond Awesome AI Model Routing](https://github.com/Not-Diamond/awesome-ai-model-routing)
- [Felicis: Routing the Future](https://www.felicis.com/insight/model-routing)

### Context Window
- [RAG vs Long Context 2026](https://alphacorp.ai/blog/is-rag-still-worth-it-in-the-age-of-million-token-context-windows)
- [RAG vs Large Context Window Trade-offs](https://redis.io/blog/rag-vs-large-context-window-ai-apps/)
- [LLM Context Window Limitations](https://atlan.com/know/llm-context-window-limitations/)
- [Long Context vs RAG: 1M Token Windows](https://www.sitepoint.com/long-context-vs-rag-1m-token-windows/)
- [LLM Context Management Strategies](https://zylos.ai/research/2026-01-19-llm-context-management)

### Memory
- [Letta/MemGPT Memory Architecture](https://docs.letta.com/concepts/memgpt/)
- [Letta Memory Management](https://docs.letta.com/advanced/memory-management/)
- [Mem0 State of AI Agent Memory 2026](https://mem0.ai/blog/state-of-ai-agent-memory-2026)
- [Mem0 Research: 26% Accuracy Boost](https://mem0.ai/research)
- [Mem0 Platform vs Open Source](https://docs.mem0.ai/platform/platform-vs-oss)
- [Mem0 Self-Host Docker Guide](https://mem0.ai/blog/self-host-mem0-docker)
- [Zep Temporal Knowledge Graph](https://arxiv.org/abs/2501.13956)
- [Best AI Agent Memory Systems 2026](https://vectorize.io/articles/best-ai-agent-memory-systems)
- [Best AI Agent Memory Frameworks 2026](https://atlan.com/know/best-ai-agent-memory-frameworks-2026/)
- [AI Agent Memory Systems Compared 2026](https://blog.devgenius.io/ai-agent-memory-systems-in-2026-mem0-zep-hindsight-memvid-and-everything-in-between-compared-96e35b818da8)

### Personalization
- [Character.AI Features 2026](https://characterai.uk/character-ai-official-website-and-features/)
- [AI Chatbot Persona Design 2026](https://skywork.ai/skypage/en/ai-chatbot-character-design/2028655878860857344)
- [How to Create an AI That Chats Like You](https://towardsdatascience.com/how-to-create-an-ai-that-chats-like-you-cb3484824797/)
- [Best AI Companion Apps 2026](https://aicompanionguides.com/blog/best-ai-companion-apps-2026/)
- [WhatsApp Chat Language Model](https://github.com/bernhard-pfann/lad-gpt)

### Agent Loops
- [Claude Agent SDK: How the Loop Works](https://platform.claude.com/docs/en/agent-sdk/agent-loop)
- [Claude Agent SDK Overview](https://platform.claude.com/docs/en/agent-sdk/overview)
- [LangGraph vs CrewAI vs AutoGen 2026](https://www.datacamp.com/tutorial/crewai-vs-langgraph-vs-autogen)
- [AI Agent Frameworks Comparison 2026](https://medium.com/data-science-collective/langgraph-vs-crewai-vs-autogen-which-agent-framework-should-you-actually-use-in-2026-b8b2c84f1229)

### Sandboxing
- [E2B Pricing](https://e2b.dev/pricing)
- [AI Code Sandbox Benchmark 2026](https://www.superagent.sh/blog/ai-code-sandbox-benchmark-2026)
- [Daytona](https://www.daytona.io/)
- [Daytona $24M Raise](https://www.alleywatch.com/2026/02/daytona-ai-agent-infrastructure-sandbox-computing-developer-tools-ivan-burazin/)
- [Modal Sandboxes](https://modal.com/products/sandboxes)
- [Best Code Execution Sandboxes 2026](https://fast.io/resources/best-code-execution-sandboxes-ai-agents/)

### Embeddings
- [Embedding Models Benchmark 2026](https://dev.to/chen_zhang_bac430bc7f6b95/which-embedding-model-should-you-actually-use-in-2026-i-benchmarked-10-models-to-find-out-58bc)
- [Best Embedding Models 2026](https://www.openxcell.com/blog/best-embedding-models/)
- [Best Embedding Models for RAG 2026](https://blog.premai.io/best-embedding-models-for-rag-2026-ranked-by-mteb-score-cost-and-self-hosting/)
- [Embedding Models Pricing 2026](https://awesomeagents.ai/pricing/embedding-models-pricing/)
- [Gemini Embedding 2 Pricing](https://tokencost.app/blog/gemini-embedding-2-pricing)
- [Open Source Embedding Models](https://www.bentoml.com/blog/a-guide-to-open-source-embedding-models)
