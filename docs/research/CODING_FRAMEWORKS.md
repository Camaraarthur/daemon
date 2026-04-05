# Making Cheap Models Code Like Expensive Ones

> Research: frameworks, tools, and techniques that make a free/cheap AI model (Qwen3-Coder) code as well as Claude Opus when wrapped in the right infrastructure.
>
> Core thesis: **a smart framework around a cheap model beats a dumb wrapper around an expensive model.**
>
> Last updated: 2026-04-05

---

## Table of Contents

1. [The Evidence: Scaffolding > Raw Model](#1-the-evidence-scaffolding--raw-model)
2. [Agent Coding Frameworks That Amplify Weak Models](#2-agent-coding-frameworks-that-amplify-weak-models)
3. [Spec-Driven Development](#3-spec-driven-development)
4. [Test-Driven AI Coding](#4-test-driven-ai-coding)
5. [Context Enhancement Techniques](#5-context-enhancement-techniques)
6. [Prompt Engineering for Coding](#6-prompt-engineering-for-coding)
7. [Tool Use That Amplifies Coding Ability](#7-tool-use-that-amplifies-coding-ability)
8. [OpenClaw Skills Worth Integrating](#8-openclaw-skills-worth-integrating)
9. [What Vibe Coders Actually Need](#9-what-vibe-coders-actually-need)
10. [Quick Wins for v0](#10-quick-wins-for-v0)
11. [The Daemon Coding Agent Architecture](#11-the-daemon-coding-agent-architecture)

---

## 1. The Evidence: Scaffolding > Raw Model

### Qwen3-Coder-Next benchmarks prove the thesis

- **SWE-Bench Verified**: 70.6% with SWE-Agent scaffold (3B active parameters)
- **DeepSeek V3.2**: 70.2% with 37B active params — **12x more compute for 0.4% less performance**
- **SWE-Bench Pro**: 44.3%, competitive with models 10-20x larger
- **SecCodeBench**: 61.2% secure code generation — beats Claude Opus 4.5 (52.5%) by 8.7 points

The scaffolding matters more than the model. Mini-SWE-Agent (100 lines of Python) achieves 65-74% on SWE-Bench Verified. The full SWE-Agent framework pushes models significantly higher. Teams investing in scaffolding get better returns than those chasing marginal model improvements.

**Key insight**: Qwen3-Coder is already competitive at raw coding. What it needs is the right harness to channel that ability effectively.

### What the architecture comparison reveals

A leaked analysis of Claude Code, Codex, Cline, and OpenCode found: **"The harness beats the API call."** What differentiates these tools is everything surrounding the LLM invocation — permission systems, context strategies, tool orchestration, and extensibility — not the model integration itself.

---

## 2. Agent Coding Frameworks That Amplify Weak Models

### OpenHands (formerly OpenDevin) — 70K+ stars

**Architecture**: Event-stream model creating continuous feedback loops between agent actions and environment observations. Central loop: receive task → create plan → execute steps in sandboxed Docker container.

**What makes models better**:
- Sandboxed execution environment (Docker) — model can safely try things
- Composable Python SDK for defining agents
- File modification + command execution + web browsing + API calling
- Results: 87% of bug tickets solved same day

**Patterns to steal**:
- Event-stream architecture (action → observation → action)
- Docker sandbox for safe code execution
- Plan-then-execute workflow

### SWE-Agent (Princeton) — NeurIPS 2024

**Core innovation**: Agent-Computer Interface (ACI) — custom commands and feedback formats designed for LLMs.

**ACI components**:
1. **Search/Navigation**: Custom commands for browsing repos
2. **File Viewer**: Controlled window into files (not dumping entire files)
3. **File Editor**: Edit with integrated linting — invalid edits are discarded, linter errors shown with context
4. **Context Management**: Built atop Linux shell, allowing standard utilities

**Why it works**: The ACI makes it easier for the LM to browse, view, edit, and execute code. A code linter integrated into the edit function alerts the agent of mistakes immediately, with invalid edits discarded.

**Mini-SWE-Agent (100 lines)**: Proves minimal scaffolding works:
- Bash-only tools (no custom tool-calling interface)
- Linear message history (just append to messages)
- Stateless subprocess execution (subprocess.run, not persistent shell)
- LiteLLM integration (works with any model)
- Result: 65-74% SWE-Bench with ~100 lines of logic

**Patterns to steal**:
- Lint-on-edit (reject invalid edits immediately)
- Bash-only tooling (simpler, more flexible than custom tools)
- Stateless execution (easier to sandbox and debug)

### Aider — Terminal-based AI pair programming

**Key techniques**:
1. **Repo Map**: Tree-sitter parses all source files → directed graph (files as nodes, dependencies as edges) → PageRank ranking → top files fit into token budget
2. **Edit Format**: In-place file editing with diffs shown for review
3. **Auto-commit**: Descriptive commit messages after each change
4. **Architect Mode**: Planning phase before implementation
5. **Multi-file**: 78% of real coding sessions involve multi-file edits

**Repo Map details**:
- Tree-sitter extracts symbol definitions from 130+ languages
- NetworkX PageRank algorithm ranks files by relevance
- Personalization based on chat context (files mentioned)
- Shows full function signatures, not just file names
- Token budget optimization — only most important parts fit

**Patterns to steal**:
- Tree-sitter repo map with PageRank ranking
- Architect mode (plan before code)
- Auto-commit after successful changes

### Cline — VS Code extension, 5M+ developers

**Key patterns**:
- **Plan/Act Mode**: Read-only exploration first (Plan), then execution (Act)
- **Human-in-the-loop**: Diff preview before edits, command preview before execution
- **Model agnostic**: Works with any model via OpenAI-compatible endpoints
- **MCP integration**: Can create new tools and extend its own capabilities
- **Browser automation**: Puppeteer for testing web apps

**Patterns to steal**:
- Plan/Act mode separation
- Model-agnostic architecture
- MCP for extensibility

### Devin (Cognition) — First "AI software engineer"

**Architecture**: Shell + code editor + browser in sandboxed compute environment. Multiple parallel instances in isolated VMs.

**Key learnings from 18 months in production**:
- "Senior-level at codebase understanding, junior at execution"
- Clear-cut tasks with verifiable outcomes work best (4-8 hour junior tasks)
- Test coverage rises from 50-60% to 80-90% with AI
- Documentation generation is a killer feature (DeepWiki)
- Parallel execution is the superpower humans don't have

**Patterns to steal**:
- Parallelizable task execution
- Auto-documentation generation
- Clear task boundaries with verifiable outcomes

### Bolt.diy — Browser-based for non-technical users

**Architecture**: WebContainers (in-browser Node.js runtime) + chat-based prompting + 19+ LLM support.

**What works for non-technical users**:
- Zero local environment setup
- AI controls entire environment (filesystem, node server, package manager, terminal)
- Real-time preview in browser
- File locking during AI generation + diff view
- Export as ZIP or deploy to Netlify/Cloudflare

**Patterns to steal**:
- Zero-config development environment
- Real-time preview of changes
- One-click deployment

---

## 3. Spec-Driven Development

### The Pattern: Spec → Tests → Implementation → Validation

The more complete the spec and the closer test cases align with requirements, the more autonomously the agent can work and the higher the code quality.

### GPT-Pilot (Pythagora) — Multi-agent workflow

**Agent chain**:
1. **Specification Writer**: Asks clarifying questions, produces detailed spec
2. **Architect**: Selects technologies, checks installations
3. **Tech Lead**: Breaks spec into development tasks
4. **Developer**: Plans implementation for each task
5. **Code Monkey**: Implements changes based on Developer's description
6. **Troubleshooter**: Helps diagnose issues
7. **Debugger**: Fixes broken implementations
8. **Technical Writer**: Generates documentation

**Key innovation**: Context rewinding — for each development task, conversation rewinds to first message to maintain consistent context size. Prevents context degradation over long sessions.

**Patterns to steal**:
- Multi-agent specialization (planner vs coder vs reviewer)
- Context rewinding for long tasks
- Step-by-step implementation with testing at each step

### Smol Developer — Minimal spec-to-code

- <200 lines of Python and prompts
- User provides spec in Markdown (mixing English and code)
- Model obeys spec "to the letter"
- debugger.py reads whole codebase for targeted fix suggestions

**Pattern**: Markdown spec → file list → implement each file. Simple but effective.

### Smolagents (HuggingFace) — Code agents

- ~1,000 lines core code
- Agents write and execute Python code snippets (not JSON/text blobs)
- **30% fewer steps and LLM calls** compared to standard tool-calling

**Key insight**: Code agents are more efficient than tool-calling agents because code is a more natural and flexible action space.

### The Spec-Test-Lint Workflow

Best practice synthesis from multiple sources:

```
1. SPEC: User describes feature → system generates detailed spec
2. TEST: Generate test suite from spec (100% coverage target)
3. IMPLEMENT: Code to pass tests, one function at a time
4. LINT: Auto-lint + type-check after every edit
5. VALIDATE: Run test suite
6. ITERATE: If tests fail → feed errors back → retry
7. REVIEW: Human reviews before commit
```

**Tools that implement this**:
- **Kiro (AWS)**: Spec-driven development with agent hooks
- **Superpowers (Jesse Vincent)**: TDD plugin for Claude Code, 42K+ GitHub stars
- **GitHub spec-kit**: Toolkit for spec-driven development

---

## 4. Test-Driven AI Coding

### Why TDD is a force multiplier for AI

- "Build me a login page" is vague
- A set of tests that define exactly how the login page should behave gives AI a **concrete target**
- Tests catch subtle bugs and edge cases that aren't obvious from AI output
- The tight feedback loop of `write code → run tests → fix` is something AI excels at

### The Pattern

```
1. User describes desired behavior
2. Agent generates test suite FIRST
3. Agent implements code to pass tests
4. Tests run automatically after each change
5. Failures feed back as debugging prompts
6. Iterate until all tests pass
7. Human reviews both tests and implementation
```

### Evidence

- AWS Kiro implements this as "spec-driven development" — specs come first, code follows
- Addy Osmani: "Strong test suites enable agents to fly through projects"
- CodeScene research: non-linear performance gains above Code Health 9.5+
- Simon Willison: "Maintaining high-quality tests helps because LLMs follow the style they see"

### Self-improving agents (Addy Osmani)

Key techniques for agents that improve over time:
1. **Atomic tasks**: "Add nav bar with links to Home, About, Contact" not "Build the dashboard"
2. **Git as memory**: Each iteration committed, next iteration reads repo history
3. **Progress log**: Append what happened each cycle (task, pass/fail, errors)
4. **Quality through examples**: Existing good tests → LLM produces similar quality tests
5. **The 80% problem**: AI gets you 80% to MVP; last 20% needs engineering judgment

---

## 5. Context Enhancement Techniques

### Repo Map (Aider-style) — HIGH IMPACT

**How it works**:
1. Tree-sitter parses all source files in repo
2. Extracts symbol definitions (functions, classes, methods, variables)
3. Builds directed graph: files as nodes, cross-file references as edges
4. Runs PageRank algorithm (personalized to current chat context)
5. Selects top-ranked files/symbols that fit token budget
6. Presents as condensed map showing signatures and relationships

**Why it works**: Model knows what exists before coding. Prevents hallucinating nonexistent APIs, duplicating existing functions, or breaking dependencies.

**Implementation**: Aider's RepoMapper has been extracted as a standalone tool (pdavis68/RepoMapper) and can be replicated.

### RAG Over Codebase — MEDIUM IMPACT

**Modern best practices**:
- **Syntax-aware chunking**: Use Tree-sitter to chunk by code structure, not arbitrary lines
- **Enhanced embeddings**: Generate natural language descriptions for each chunk, embed descriptions alongside code
- **Hybrid search**: Combine keyword (grep) and semantic (vector) retrieval
- **Hierarchical retrieval**: Broad context → focused analysis → dependency traversal

**Key insight**: Pure vector RAG is often outperformed by hybrid search. Code has explicit structural relationships (imports, function calls, types) that embeddings miss. grep + semantic search together > either alone.

**We already have this**: Daemon uses Qdrant for memory. Can extend to codebase indexing.

### Tree-sitter Parsing — HIGH IMPACT, LOW EFFORT

- Understand code structure at AST level
- Extract function signatures, class hierarchies, import graphs
- 130+ language support via py-tree-sitter-languages
- Can be used for: repo map, smart chunking, edit validation, symbol search

### LSP Integration — MEDIUM IMPACT

- OpenCode includes LSP diagnostic tool — queries language servers directly
- Type checking without running full build
- Hover information, go-to-definition, find-references
- Can surface type errors and suggestions to the model in real-time

### Minimum Context for Good Coding

Based on research:
1. **Essential**: Current file + immediately related files
2. **Very helpful**: Repo map (function signatures across repo)
3. **Helpful**: Test files for current module, README/docs
4. **Nice to have**: Git history for current files, CI output
5. **Diminishing returns**: Full file contents of distant modules

---

## 6. Prompt Engineering for Coding

### System Prompt Techniques That Work

**Chain-of-Thought**: Models that think step-by-step before coding produce better code. Tell the model: "Think through the approach before writing code."

**Role Assignment**: "You are an expert software engineer" consistently improves output. Be specific: "You are an expert in TypeScript, React, and Next.js App Router."

**Structured Output**: Request specific formats: "Respond with the file path, then the complete code. No explanations unless asked."

**Few-Shot Examples**: Include 1-2 examples of desired edit format in the system prompt. Shows the model exactly what output format you expect.

### CLAUDE.md / Project Rules — 5-10% improvement

Research shows:
- Prompt Learning on past issues boosted Claude Code accuracy 5.19% general, 10.87% in-repo
- ~150-200 instruction budget before compliance drops off
- Focus on instructions where the model would make a mistake WITHOUT them
- Use progressive disclosure (@docs/file.md imports for deep context)

**What to include**:
- Tech stack and project structure
- Code style conventions (naming, patterns)
- Testing commands and expectations
- Common mistakes to avoid
- Architecture boundaries ("never import X from Y")

### The "Thinking" Pattern

Models with explicit reasoning (extended thinking, chain-of-thought) produce significantly better code. Qwen3-Coder supports thinking mode. **Always enable it for complex tasks.**

### Coding-Specific Prompt Patterns

1. **Incremental implementation**: "Implement only function X. Do not modify other files."
2. **Error-first debugging**: "Read the error message carefully. What is the root cause?"
3. **Spec reference**: "Implement according to the spec in spec.md. The tests in test_X.py must pass."
4. **Constraint enforcement**: "Use only standard library. No new dependencies."
5. **Review request**: "Review this code for bugs, security issues, and performance problems."

---

## 7. Tool Use That Amplifies Coding Ability

### Ranked by Impact/Effort

| Tool | Impact | Effort | Notes |
|------|--------|--------|-------|
| **Lint on every edit** | Very High | Low | Immediate error feedback, reject bad edits |
| **Run tests after changes** | Very High | Low | Concrete pass/fail signal |
| **File search (ripgrep/glob)** | High | Very Low | Model can find what exists before coding |
| **Auto-formatting** | Medium | Very Low | Consistent output, fewer style debates |
| **Type checking** | High | Medium | Catches whole classes of bugs |
| **Git diff review** | Medium | Low | Catch unintended changes |
| **Auto-commit** | Medium | Low | Save points, reversibility |
| **LSP integration** | Medium | High | IDE-level understanding |
| **Browser preview** | High | High | Visual validation for web apps |

### Lint-on-Edit (The #1 Quick Win)

From SWE-Agent: integrate a code linter into the edit function. When the model edits a file:
1. Run linter on the result
2. If errors: show errors + context to model, discard the edit
3. Model retries with error feedback
4. Only accept lint-clean edits

This single technique prevents a huge class of syntax errors, undefined variables, and import mistakes.

### Using Linters to Encode Architecture

From Factory.ai research — 7 categories of effective lint rules for AI agents:
1. **Grep-ability**: Named exports, absolute imports (code is searchable)
2. **Glob-ability**: Predictable file structures (agent knows where to put things)
3. **Architectural boundaries**: Block cross-layer imports
4. **Security**: Ban plaintext secrets, require input validation
5. **Testability**: Colocate tests, no network calls in unit tests
6. **Observability**: Structured logging with metadata
7. **Documentation**: TSDoc on public APIs

**Key insight**: "Lint passing" becomes an executable specification. The agent generates code, gets automatic feedback from linters, and self-corrects until clean. Quality now depends on how thoroughly standards are codified into machine-checkable rules.

---

## 8. OpenClaw Skills Worth Integrating

### Format

OpenClaw skills are **Markdown files** with YAML frontmatter + step-by-step instructions. Each skill is a folder with a `SKILL.md` file. Skills can bundle scripts, MCP servers, or config files.

```yaml
---
name: my-skill
description: What it does
metadata:
  emoji: "🔧"
  os: [linux, macos]
  required_binaries: [node, npm]
---

# Instructions for the agent...
```

### Skills vs MCP Servers

- **MCP server**: Running process providing tool capabilities via Model Context Protocol
- **Skill**: Markdown instructions + optional MCP server
- Most modern skills combine both: MCP for tools, skill for logic
- MCP servers work with any compatible host; Skills are OpenClaw-specific

### Categories Worth Integrating

**Coding & DevOps (45.5% of all skills)**:
- `commit-commands`: Clean git workflow (commit, branch, merge patterns)
- `code-review`: Automated review with specific criteria
- `feature-dev`: Guided feature implementation (spec → test → code)
- `hookify`: Lifecycle hooks for pre/post actions

**Top downloaded that are relevant**:
- Capability Evolver (35K downloads): Agent capability auto-evolution
- Web Browsing (180K downloads): Web navigation and extraction

### Conversion to Daemon Format

OpenClaw skills can be converted to Daemon's system by:
1. Extract the instruction markdown → use as system prompt additions
2. If skill bundles an MCP server → integrate as MCP tool
3. If skill has scripts → convert to Daemon tool functions
4. Metadata (required binaries, OS compat) → pre-flight checks

---

## 9. What Vibe Coders Actually Need

### Their Top Frustrations (from Reddit, HN, Stack Overflow)

1. **"Almost right" code** — 66% of developers hit this. AI output is 80% correct, debugging the remaining 20% requires the skills they don't have
2. **The 80/20 wall** — First 80% of project is magic. Last 20% (edge cases, integrations, production hardening) is where projects die
3. **Error loops** — Bolt users report "endless error loops." Lovable users burn 400 credits/hour. Platforms profit from their own bugs
4. **No understanding** — They can't review AI-generated PRs because they don't understand the code
5. **Security vulnerabilities** — AI-generated code has 2.74x more security vulnerabilities than human-written code
6. **Maintenance debt** — AI generates fast but creates invisible technical debt

### What Would Make Them Say "This Is Better"

**Must-haves**:
1. **Auto-error-recovery**: When code breaks, agent fixes it automatically without user intervention
2. **One-click deployment**: From "it works locally" to "it's live on a URL" in one step
3. **Auto-git**: User never thinks about version control. Agent commits, branches, deploys
4. **Visual preview**: See what the app looks like before accepting changes
5. **Plain English error explanation**: "The login page crashed because the database isn't connected" not stack traces

**Differentiators**:
6. **Incremental building**: Build one piece, test it, then next — not one-shot generation that falls apart
7. **Spec-to-app pipeline**: Describe what you want → see a plan → approve → watch it build
8. **Auto-testing**: Agent writes and runs tests. User sees green checkmarks, not code
9. **Persistent context**: Agent remembers the project across sessions (we already have this via Qdrant)
10. **Multi-device**: Start on phone, continue on laptop (our core differentiator)

### The Disillusionment Wave

As of early 2026, there's a "vibe coding disillusionment" — many builders are returning to no-code tools because vibe coding produced unmaintainable code. The opportunity: **a framework that makes vibe-coded projects actually maintainable** by enforcing testing, linting, and architecture from the start.

---

## 10. Quick Wins for v0

### Tier 1: Implement Immediately (<50 lines each, massive impact)

| # | Technique | Lines | Impact | How |
|---|-----------|-------|--------|-----|
| 1 | **Lint after every edit** | ~30 | Very High | Run linter on file after each model edit. Show errors to model. Reject bad edits. |
| 2 | **Run tests after changes** | ~20 | Very High | Execute test suite after implementation. Feed failures back as debugging context. |
| 3 | **File search tools** | ~20 | High | Give model ripgrep/glob as tools. It can find existing code before writing new. |
| 4 | **Auto-format on save** | ~10 | Medium | Run prettier/black after each edit. Consistent output, zero effort. |
| 5 | **Project rules file** | ~0 | Medium | Support DAEMON.md (like CLAUDE.md) for per-project instructions. Load into system prompt. |

### Tier 2: Implement in v0.1 (~100-200 lines each, high impact)

| # | Technique | Lines | Impact | How |
|---|-----------|-------|--------|-----|
| 6 | **Repo map** | ~150 | Very High | Tree-sitter parse → function signatures → rank by relevance → include in context |
| 7 | **Spec-first workflow** | ~100 | High | User describes feature → agent generates spec + test plan → user approves → agent implements |
| 8 | **Auto-commit** | ~30 | Medium | After each successful change (tests pass, lint clean), auto-commit with descriptive message |
| 9 | **Error recovery loop** | ~50 | High | On failure: read error → diagnose → fix → retry (max 3 attempts) |
| 10 | **Plan/Act mode** | ~80 | High | Read-only exploration phase before any edits. Model plans approach, user approves, then executes |

### Tier 3: Implement in v0.2 (significant effort, differentiating)

| # | Technique | Effort | Impact | How |
|---|-----------|--------|--------|-----|
| 11 | **Multi-agent review** | Medium | High | Second model instance reviews first's code changes before commit |
| 12 | **Codebase RAG** | Medium | High | Embed all code with Tree-sitter chunking, semantic search for relevant context |
| 13 | **One-click deploy** | Medium | Very High | Detect framework → build → deploy to Cloudflare/Vercel/Railway |
| 14 | **Visual preview** | High | Very High | WebContainer or local dev server with iframe preview |
| 15 | **Skill system** | Medium | Medium | OpenClaw-compatible skill format, community contributions |

---

## 11. The Daemon Coding Agent Architecture

### Recommended Architecture (synthesized from all research)

```
User Input (natural language)
    │
    ▼
┌─────────────────────────────┐
│  DAEMON.md / Project Rules  │  ← Per-project instructions
│  + System Prompt            │  ← Role, constraints, thinking mode
│  + Repo Map (Tree-sitter)   │  ← What exists in the codebase
└─────────────┬───────────────┘
              │
              ▼
┌─────────────────────────────┐
│  PLAN MODE (read-only)      │
│  - Explore codebase         │
│  - Read relevant files      │
│  - Generate spec + test plan│
│  - User approves plan       │
└─────────────┬───────────────┘
              │
              ▼
┌─────────────────────────────┐
│  ACT MODE (implementation)  │
│  For each task in plan:     │
│  1. Generate tests first    │
│  2. Implement code          │
│  3. Lint check (reject bad) │
│  4. Run tests               │
│  5. If fail → retry (3x)   │
│  6. Auto-format             │
│  7. Auto-commit             │
└─────────────┬───────────────┘
              │
              ▼
┌─────────────────────────────┐
│  REVIEW (optional)          │
│  - Diff summary for user    │
│  - Second model review      │
│  - Security scan            │
└─────────────┬───────────────┘
              │
              ▼
┌─────────────────────────────┐
│  DEPLOY (one-click)         │
│  - Detect framework         │
│  - Build                    │
│  - Deploy to URL            │
└─────────────────────────────┘
```

### Tool Set (minimal but effective)

Based on Mini-SWE-Agent's success with bash-only, plus SWE-Agent's ACI improvements:

**Core tools** (must have):
1. `bash` — Execute any shell command (stateless, subprocess.run)
2. `read_file` — Read file contents with line numbers
3. `edit_file` — Edit file with lint validation (reject bad edits)
4. `search` — ripgrep-based content search
5. `glob` — File pattern matching
6. `list_dir` — Directory listing

**Enhancement tools** (high value):
7. `run_tests` — Execute test suite, return pass/fail + output
8. `lint` — Run project linter, return errors
9. `repo_map` — Generate tree-sitter repo map
10. `git` — Commit, diff, log, branch operations

**Vibe coder tools** (differentiating):
11. `preview` — Start dev server, return URL
12. `deploy` — One-click deployment
13. `explain_error` — Translate stack traces to plain English

### Model-Agnostic Design

The framework should work with any model. Key abstractions:
- **LiteLLM** for model routing (already used by Mini-SWE-Agent)
- **Thinking mode** toggled per model capability
- **Tool format** adapts: XML for older models, function-calling for newer
- **Context budget** adjusts to model's context window

### The Free Tier Advantage

With Qwen3-Coder-Next via OpenRouter (free):
- 3B active parameters, 70.6% SWE-Bench
- Strong code security (61.2% SecCodeBench)
- Competitive with models 10-20x larger
- The scaffolding we build around it is the differentiator

**What the scaffolding adds**:
- Repo map → model knows what exists (prevents hallucination)
- Lint-on-edit → immediate error feedback (prevents accumulation)
- Test-after-change → concrete validation (prevents "almost right")
- Spec-first → clear targets (prevents scope creep)
- Auto-commit → reversibility (prevents fear of breaking things)
- Error recovery loop → self-healing (prevents user frustration)

### Priority Implementation Order

1. **Week 1**: Lint-on-edit + test runner + file search + auto-format
2. **Week 2**: Repo map (Tree-sitter) + project rules (DAEMON.md) + plan/act mode
3. **Week 3**: Spec-first workflow + auto-commit + error recovery loop
4. **Week 4**: One-click deploy + visual preview + plain English errors
5. **Month 2**: Multi-agent review + codebase RAG + skill system

---

## Sources

### Frameworks & Tools
- [OpenHands (OpenDevin)](https://github.com/OpenHands/OpenHands) — Event-stream architecture, Docker sandbox, 87% bug fix rate
- [SWE-Agent](https://arxiv.org/abs/2405.15793) — Agent-Computer Interface, lint-on-edit, NeurIPS 2024
- [Mini-SWE-Agent](https://github.com/SWE-agent/mini-swe-agent/) — 100 lines, 65-74% SWE-Bench, bash-only
- [Aider](https://aider.chat/2023/10/22/repomap.html) — Tree-sitter repo map with PageRank
- [Aider Repo Map Deep Dive](https://deepwiki.com/Aider-AI/aider/4.1-repository-mapping) — Repository mapping system details
- [Cline](https://github.com/cline/cline) — Plan/Act mode, 5M+ developers, model-agnostic
- [Bolt.diy](https://github.com/stackblitz-labs/bolt.diy) — Browser-based, WebContainers, 19+ LLM support
- [GPT-Pilot (Pythagora)](https://github.com/Pythagora-io/gpt-pilot) — Multi-agent spec-driven development
- [Smol Developer](https://github.com/smol-ai/developer) — Minimal spec-to-code (<200 lines)
- [Smolagents (HuggingFace)](https://github.com/huggingface/smolagents) — Code agents, 30% fewer LLM calls

### Architecture Analysis
- [AI Coding Agent Architecture Analysis](https://gist.github.com/Haseeb-Qureshi/2213cc0487ea71d62572a645d7582518) — Claude Code vs Codex vs Cline vs OpenCode
- [Claude Code Source Leak Analysis](https://read.engineerscodex.com/p/diving-into-claude-codes-source-code) — 40+ tools, 3-layer memory, feature flags
- [Devin 2025 Performance Review](https://cognition.ai/blog/devin-annual-performance-review-2025) — Learnings from 18 months of agents at work

### Workflows & Techniques
- [Spec-Test-Lint Workflow](https://adlrocha.substack.com/p/adlrocha-taming-the-agents-my-spec) — Complete workflow for taming AI agents
- [Addy Osmani's LLM Coding Workflow 2026](https://addyosmani.com/blog/ai-coding-workflow/) — Specs, skills, MCPs, incremental chunks
- [Self-Improving Coding Agents](https://addyosmani.com/blog/self-improving-agents/) — Atomic tasks, git as memory, progress logs
- [Using Linters to Direct Agents](https://factory.ai/news/using-linters-to-direct-agents) — 7 categories of lint rules for AI
- [Agentic AI Coding Best Practices](https://codescene.com/blog/agentic-ai-coding-best-practice-patterns-for-speed-with-quality) — 6 patterns ranked by ROI
- [CLAUDE.md Best Practices](https://arize.com/blog/claude-md-best-practices-learned-from-optimizing-claude-code-with-prompt-learning/) — 5-10% accuracy improvement from project rules

### Benchmarks & Models
- [Qwen3-Coder-Next Technical Report](https://arxiv.org/html/2603.00729v1) — 70.6% SWE-Bench, 3B active params
- [Best AI for Coding 2026 SWE-Bench Breakdown](https://www.marc0.dev/en/blog/best-ai-for-coding-2026-swe-bench-breakdown-opus-4-6-qwen3-coder-next-gpt-5-3-and-what-actually-matters-1770387434111)
- [Spec-Driven Development Guide 2026](https://prommer.net/en/tech/guides/spec-driven-development/)

### Vibe Coding & User Research
- [Vibe Coding Disillusionment 2026](https://appbuilderguides.com/news/vibe-coding-disillusionment-2026/) — Builders returning to no-code
- [Stack Overflow: Vibe Coding Without Code Knowledge](https://stackoverflow.blog/2026/01/02/a-new-worst-coder-has-entered-the-chat-vibe-coding-without-code-knowledge/)
- [Why TDD Works for AI-Assisted Programming](https://codemanship.wordpress.com/2026/01/09/why-does-test-driven-development-work-so-well-in-ai-assisted-programming/)

### Skills & Extensibility
- [OpenClaw Skills Documentation](https://docs.openclaw.ai/tools/skills) — Format specification
- [Awesome OpenClaw Skills](https://github.com/VoltAgent/awesome-openclaw-skills) — 5,400+ categorized skills
- [OpenClaw Skills Guide](https://openclawmcp.com/blog/openclaw-skills-guide) — How to find, install, build skills
- [GitHub spec-kit](https://github.com/github/spec-kit) — Toolkit for spec-driven development
