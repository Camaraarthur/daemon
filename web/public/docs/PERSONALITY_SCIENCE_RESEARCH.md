# Personality Science Research: Extracting Identity from Conversation Data

**Daemon Project -- Deep Research Document**
**Arthur Ceccotti / April 2026**

---

## Purpose

This document is the scientific foundation for Daemon's core product: users upload their ChatGPT/Claude/WhatsApp exports, and we produce a personality profile, custom system prompt, visual character, and memory embeddings -- all packaged in a portable .daemon file. Everything here is grounded in published research with real accuracy numbers, not vibes.

---

## Table of Contents

1. [Personality from Text: What Actually Works](#1-personality-from-text-what-actually-works)
2. [Communication Style Analysis](#2-communication-style-analysis)
3. [What We Can Extract from Chat Exports](#3-what-we-can-extract-from-chat-exports)
4. [The Embedding Approach](#4-the-embedding-approach)
5. [Shareable Personality Visualization](#5-shareable-personality-visualization)
6. [Privacy and Ethics](#6-privacy-and-ethics)
7. [The .daemon File Format](#7-the-daemon-file-format)
8. [Mapping Personality to Visual Character](#8-mapping-personality-to-visual-character)
9. [Competitive Analysis](#9-competitive-analysis)
10. [Technical Pipeline](#10-technical-pipeline)
11. [Concrete Architecture Recommendation](#11-concrete-architecture-recommendation)
12. [References](#12-references)

---

## 1. Personality from Text: What Actually Works

### 1.1 Scientific Validity of Personality Frameworks

**Big Five (OCEAN) -- the gold standard.** Decades of longitudinal research confirm that Openness, Conscientiousness, Extraversion, Agreeableness, and Neuroticism capture the majority of variance in human personality. Rank-order stability of 0.4-0.6 over 10-year periods (Roberts & DelVecchio, 2000). This is the only personality framework with strong scientific backing for computational prediction.

**MBTI -- scientifically weak, culturally powerful.** Low test-retest reliability (~50% of people get a different type when retaking within 5 weeks), poor factor structure, forced dichotomies where spectrums exist. But 16personalities.com has 26M+ tests taken per year. People share their types. The lesson: scientific rigor matters less for virality than legibility and identity resonance. Daemon should use Big Five internally but present results in a more MBTI-like "you are a [creature]" format for shareability.

**DISC -- used by Crystal Knows and Humantic AI** for professional personality prediction. Simpler than Big Five (4 dimensions: Dominance, Influence, Steadiness, Conscientiousness). Less academically validated but more actionable for communication recommendations.

**Our approach: the Six Currents model** (defined in PERSONALITY_ENGINE_RESEARCH.md and CHARACTER_ENGINE_DESIGN.md). Pulse, Weight, Reach, Tide, Grain, Stance. These measure *communication behavior with AI* rather than personality traits per se -- a subtly different and more useful thing for our use case. An introvert may be highly assertive with AI. We read the shadow of personality as projected onto a non-judgmental surface.

### 1.2 Accuracy Numbers from Real Papers

Here is what the literature actually reports for automated Big Five prediction from text:

| Method | Dataset | Accuracy / Correlation | Source |
|--------|---------|----------------------|--------|
| BERT base | myPersonality (Facebook) | 67% binary classification | Mehta et al., 2020 |
| RoBERTa large | PANDORA (Reddit) | Best overall, outperforms BERT across most metrics | Preprints.org, 2025 |
| LSTM | myPersonality (balanced) | 71% average accuracy | Neural Network approach, Basaran 2021 |
| Multi-source (FB+Twitter) | Multiple social media | 86.2% (FB), 88.5% (Twitter) | Journal of Big Data, 2021 |
| TraitBertGCN (BERT+GCN) | Essays + myPersonality fused | Improved cross-domain generalization | Springer, 2025 |
| LIWC features + ML classifiers | Clinical interviews | Outperforms standard questionnaires for personality style | Tausczik & Pennebaker |
| Speech-based (audio) | Self-reported correlation | r = 0.26 (extraversion) to 0.39 (neuroticism) | Nature Scientific Reports, 2024 |
| BIG5-TPoT (targeted text preselection) | 5,810 essays | Best MAE with semantic text filtering | arXiv 2511.09426, 2025 |
| LLM embeddings + 2-layer MLP | Various | Significantly outperforms zero-shot methods | PMC, 2025 |

**Key takeaway: 65-88% accuracy for binary trait classification, r = 0.3-0.5 correlations for continuous prediction.** This is moderate -- good enough to be interesting, not good enough to be diagnostic. Perfect for our use case: we are generating a personality *portrait*, not a clinical assessment.

**What predicts best and worst:**
- **Openness** is the easiest trait to detect from text (5/6 classifiers beat baseline, up to 62.1% accuracy). Makes sense -- open people use richer vocabulary, more abstract language.
- **Agreeableness** is the hardest. It manifests more in social behavior than in word choice.
- **Neuroticism** requires deep word-level (morphological) analysis. Correlates with first-person singular pronouns, negative emotion words, and fewer positive emotion words.
- **Extraversion** correlates with sentiment analysis more than deep linguistic features. Also correlates with shorter, simpler sentence structure.

### 1.3 Linguistic Features That Correlate with Personality

From LIWC research (Pennebaker, 2001; Tausczik & Pennebaker, 2010) and computational stylometry:

**Extraversion:**
- More social words ("we", "they", "talk")
- More positive emotion words
- Shorter average sentence depth in dependency trees
- Higher output volume
- More exclamation marks

**Neuroticism:**
- More first-person singular pronouns ("I", "me", "my")
- More negative emotion words, fewer positive
- More hedging language ("maybe", "I think", "I guess")
- Higher use of absolute words ("always", "never")

**Openness:**
- Longer words, richer vocabulary (higher type-token ratio)
- More tentative words ("perhaps", "maybe")
- Fewer first-person singular pronouns
- More present tense avoidance
- More metaphor and analogy use

**Conscientiousness:**
- More achievement words ("earn", "win", "succeed")
- More structured writing (numbered lists, clear sections)
- Fewer filler words
- More future tense

**Agreeableness:**
- More affirmation words ("agree", "yes", "exactly")
- More second-person pronouns ("you")
- More positive emotion words
- Fewer swear words
- More politeness markers ("please", "thank you")

### 1.4 Why Our Approach is Better Than Standard Big Five Prediction

Standard personality-from-text research tries to infer who someone IS from how they write. We have a major advantage: **we have both sides of the conversation.**

We do not just see what the user wrote. We see:
1. What they asked for
2. What they got back
3. How they reacted (satisfaction/frustration signals)
4. Whether they continued or abandoned
5. What format of response engaged them most

This is not personality detection. It is **preference archaeology.** And it is a fundamentally easier task than inferring Big Five traits from essays, because we have the response-reaction pairs that standard personality datasets lack.

---

## 2. Communication Style Analysis

### 2.1 Dimensions That Matter for AI Companion Tuning

Standard communication style frameworks (Gudykunst 1996, Norton 1978) identify dimensions like dominant, dramatic, contentious, animated, impression-leaving, relaxed, attentive, open, friendly, and precise. For AI-human interaction, a reduced set is more useful:

**Formality level:** Measured by vocabulary register, punctuation correctness, greeting/closing patterns, contraction use. Range: "yo fix this" to "I would appreciate your assistance with the following matter."

**Directness:** Measured by imperative ratio, hedging frequency, question vs. command balance. "Do X" vs. "What if we tried X?"

**Humor frequency and style:** Detected via explicit markers ("haha", "lol"), understatement patterns, absurdist references. Style matters: dry/deadpan vs. playful vs. sarcastic.

**Empathy markers:** Thanking the AI, acknowledging difficulty of tasks, using relational language. Surprisingly diagnostic -- how someone treats an AI reveals their default social behavior when cost of kindness is zero.

**Information density preference:** Do they want the summary or the full analysis? Measured by satisfaction with long vs. short responses and by explicit requests for more/less detail.

**Response patterns:**
- Quick fire vs. thoughtful: Average time between assistant response and next user message
- Terse vs. expansive: Message length distribution
- Single-turn vs. iterative: Follow-up depth per topic

### 2.2 Topic Preference Analysis

What someone talks about with AI reveals genuine interests (not performed interests like social media). Topic extraction via:

1. **TF-IDF clustering** on user messages (no LLM needed, fast)
2. **Batched LLM topic extraction** on sampled conversations (higher quality)
3. **Domain classification**: technical, creative, personal, professional, philosophical, practical

The distribution across domains is a personality fingerprint. Someone who is 60% technical, 20% personal, 15% philosophical, 5% practical has a fundamentally different relationship with AI than someone who is 80% practical, 15% professional, 5% creative.

### 2.3 Emotional Patterns

Temporal emotional analysis reveals circadian personality:
- What topics at what times? (late night = more personal/philosophical?)
- Frustration patterns: do they escalate or disengage?
- Positive engagement: what triggers their flow state?
- Mood variance: stable emotional register or high volatility?

---

## 3. What We Can Extract from Chat Exports

### 3.1 ChatGPT Export Format

**Official export** (Settings > Data Controls > Export Data):
- Arrives as ZIP containing `conversations.json`
- Structure: `conversations[].mapping{}.message{author, content, create_time}`
- Tree structure (not linear) -- messages reference parent IDs
- Metadata: conversation title, create_time, update_time, model slug, plugin IDs
- Includes: system messages, user messages, assistant messages, tool calls
- Does NOT include: token counts, temperature settings, or system prompts

**What we extract:**
- Full conversation content with timestamps
- Model used per conversation (gpt-4, gpt-3.5-turbo, etc.) -- reveals user sophistication
- Conversation titles (user-generated or auto-generated) -- reveal topic preferences
- Message tree structure -- reveals editing/regeneration behavior (personality signal!)

**ChatGPT Year in Review (Dec 2025):**
- OpenAI already launched their own "Spotify Wrapped" for ChatGPT
- Provides: total conversations, messages, themes, chat style, and an "archetype" (Strategist, Navigator, Producer, etc.)
- Also generates: a poem, pixel painting, "award", and 2026 predictions
- THIS IS DIRECT COMPETITION. But it is shallow -- single-session, no portable file, no persistent character, and no scientific personality model underneath. It is marketing, not product.

### 3.2 Claude Export Format

**Official export** (claude.com > Settings > Export Data):
- Arrives as .dms file (renamed ZIP archive)
- Contains JSONL (JSON Lines) file with conversation data
- Structure: `conversations[].chat_messages[]{sender, text, created_at}`
- Simpler than ChatGPT -- linear conversations, no tree structure

**What we extract:**
- Same fundamentals as ChatGPT but cleaner structure
- Claude conversations tend to be longer and more substantive (selection bias: Claude users skew technical)
- No model version metadata in export (unlike ChatGPT)

### 3.3 WhatsApp Export Format

**Per-chat export** (Chat > More > Export Chat):
- Plain text (.txt) file
- Format: `[DD/MM/YYYY, HH:MM:SS] Name: message`
- Includes: media placeholders ("<Media omitted>"), system messages (group changes, calls)
- Can be exported with or without media

**What we extract:**
- Rich temporal patterns (real timestamps, not AI-session timestamps)
- Social dynamics (group chats reveal personality in social context)
- Code-switching behavior (different personality with different people)
- WhatsApp conversations are MORE personal than AI chats -- they reveal genuine social behavior

**Critical difference:** WhatsApp exports show how someone talks to HUMANS. AI exports show how someone talks to MACHINES. The delta between these two is itself a personality signal.

### 3.4 Prompt Engineering as Personality Signal

How someone prompts an AI is deeply diagnostic:
- **Specificity level:** Vague dreamers vs. precise engineers
- **Context provision:** Do they explain why they need something? (relational) Or just what they need? (transactional)
- **Iteration style:** Accept first output vs. refine 10 times
- **Meta-prompting:** Do they tell the AI how to behave? ("be concise", "explain like I'm 5") -- reveals self-awareness about their own preferences
- **Regeneration behavior:** (ChatGPT only, from tree structure) -- how often do they regenerate? This reveals tolerance for imperfection.

---

## 4. The Embedding Approach

### 4.1 Personality Embeddings: State of the Art

Recent research (PMC, 2025) demonstrates that **LLM embeddings used as features for simple downstream classifiers (2-layer MLP) significantly outperform zero-shot personality prediction methods.** This is the right approach for Daemon.

The pipeline:
1. Take user messages (or conversation summaries)
2. Embed them with a sentence transformer (e.g., `paraphrase-multilingual-mpnet-base-v2`, 512 token limit)
3. These embeddings capture personality-relevant linguistic patterns without explicit feature engineering
4. Feed into a lightweight classifier or regressor for trait prediction

### 4.2 Creating a "Communication Style Vector"

Rather than trying to predict Big Five from embeddings, we should create a **Daemon-specific embedding space**:

```
Communication Style Vector (CSV) = 128-dimensional vector encoding:
- Linguistic features (40 dims): vocabulary richness, sentence structure, punctuation patterns
- Interaction features (40 dims): satisfaction/frustration patterns, response preferences, topic dynamics
- Temporal features (24 dims): circadian patterns, session duration, burst behavior
- Meta features (24 dims): iteration style, specificity level, relational markers
```

This vector should be:
- **Deterministic**: same input data = same vector (no LLM randomness)
- **Comparable**: cosine similarity between two users' vectors should correlate with perceived personality similarity
- **Interpretable**: each dimension group has semantic meaning

### 4.3 Clustering: Do Natural Types Emerge?

With enough users, we can run clustering (UMAP + HDBSCAN) on the communication style vectors to discover if natural personality clusters emerge. Predictions based on existing personality research:

- There WILL be a cluster of "power users" who are direct, technical, and iterative
- There WILL be a cluster of "conversational users" who are warm, meandering, and personal
- There WILL be a cluster of "transactional users" who ask single questions and leave
- The interesting finding will be the clusters we did NOT predict

This clustering would provide the empirical foundation for the Twelve Animal Forms (CHARACTER_ENGINE_DESIGN.md) -- instead of designing the forms top-down, we discover them from data.

### 4.4 Memory Embeddings: Important Moments

Beyond personality, we should embed individual high-importance interactions:
- User corrections ("no, I meant X") -- reveal what matters to them
- "Exactly!" moments -- reveal what resonates
- Personal disclosures -- reveal trust and intimacy level
- Repeated requests -- reveal persistent needs

These memory embeddings become the "episodic memory" of the daemon -- retrievable by semantic similarity when similar topics arise in future conversations.

**Size estimate:** 50-200 memory embeddings per user, each 768-dimensional float32 = ~300KB-1.2MB of memory vectors. Tiny.

---

## 5. Shareable Personality Visualization (Spotify Wrapped Mechanics)

### 5.1 The Psychology of Sharing Personality Results

Research on why Spotify Wrapped goes viral every December identifies six psychological triggers (Growth.design, 2024):

1. **Narcissism / self-expression:** "This is uniquely ME" -- the core driver. People share because it says something about their identity. Spotify Wrapped generates 60M+ social media shares annually.

2. **FOMO:** When everyone is sharing, not sharing feels like missing out. Creates a cultural moment.

3. **Status signaling / humble bragging:** "Look at my niche music taste" or "I was in the top 0.5% of listeners for this artist."

4. **Surprise:** "Wait, I listened to THAT 300 times?" The unexpected data point creates the shareworthy moment.

5. **Nostalgia:** Music = time capsules. Each track resonates with memories from that period.

6. **Gift framing:** Feels free, feels personal, feels like a reward for loyalty.

### 5.2 How to Engineer the "That's So Me" Moment

The key to shareability is **specificity + recognition.** Not "you are creative" but "73% of your conversations happen between 11pm and 2am, and they are 4x more likely to be about philosophy than your daytime conversations."

Design principles for Daemon's shareable profile:

**Show the data, not just the conclusion.** "Your daemon settled as a fox" is cool. "Your daemon settled as a fox because you preferred concise, clever solutions over comprehensive ones -- you said 'perfect' 47 times after short responses but only 12 times after long ones" is shareable.

**Use relative comparisons.** "You are in the top 3% of users for directness." "Your conversations are 2.5x longer than average." These create the competitive/identity dimension.

**One surprising stat.** Find the most unexpected pattern in their data and lead with it. "You have never once said 'please' to an AI."

**Visual identity as the hook.** The creature/animal form IS the shareable artifact. People share "what animal are you?" results endlessly. The creature IS the Spotify Wrapped card.

### 5.3 Design Lessons from 16Personalities

16personalities.com (MBTI-based) gets 26M+ tests/year. What works:
- **A character, not a chart.** Each type has an illustrated avatar. People identify with the character, not the four letters.
- **The name matters.** "The Architect" (INTJ) is more shareable than "INTJ."
- **Strengths AND weaknesses.** Pure flattery does not feel real. The daemon profile should include gentle observations about communication patterns that could be improved.
- **The match dimension.** "You and X person are both foxes" or "You and X person are complementary (fox + owl)" creates social dynamics.

### 5.4 Daemon's Shareable Deliverable

A single-screen, story-format card (optimized for Instagram/TikTok stories at 9:16):

```
[CREATURE ILLUSTRATION - animated, unique colors]

"Your daemon is a Fox of Lightning"

Pulse: 0.73 (rapid-fire communicator)
Weight: -0.31 (prefers distilled answers)
Reach: 0.64 (broad curiosity)

"You sent 4,217 messages across 312 conversations.
You are most yourself at 1:43 AM.
You said 'exactly' 89 times but 'please' only twice.
Your daemon settled in the shape you left in the stone."

daemon.page/yourname
```

---

## 6. Privacy and Ethics

### 6.1 The Intimacy Problem

Processing someone's entire chat history is one of the most intimate data operations possible. These conversations contain:
- Mental health discussions
- Relationship problems
- Financial information
- Creative work in progress
- Things they would never say to a human

We MUST treat this data with extreme care.

### 6.2 Client-Side Processing: What Can Run in the Browser

The good news: significant NLP can now run entirely client-side.

**Available technology (2025-2026):**

| Technology | What It Does | Performance | Source |
|------------|-------------|-------------|--------|
| **Transformers.js v4** | Full transformer inference in browser via ONNX Runtime + WebGPU | 60 tok/s for 20B params on M4 Pro (quantized) | HuggingFace, 2025 |
| **WebGPU** | GPU compute in browser | Now in Chrome, Firefox 141, Safari 26 | Chrome DevBlog |
| **Voy** | Vector store in browser (WebAssembly) | Enables RAG entirely client-side | Open source |
| **Natural.js** | Classic NLP (tokenization, stemming, TF-IDF) | Fast, no model download needed | npm |
| **ONNX Runtime Web** | Run any ONNX model in browser | Optimized for transformer architectures | Microsoft |

**What CAN run client-side (no data leaves the device):**
- All structural signal extraction (message length, timing, punctuation patterns) -- pure JS, instant
- Sentiment analysis via small ONNX model (~50MB download)
- Topic clustering via TF-IDF (no model needed)
- Embedding generation via quantized sentence transformer (~100MB download)
- All axis scoring and metaphor mapping (pure math)
- Animal/element/archetype computation (pure math)

**What NEEDS server-side (or a local LLM):**
- Nuanced communication style extraction (formality, humor style, abstract vs. concrete)
- Lore/narrative generation (needs a capable LLM)
- High-quality topic extraction with domain classification

**Recommended architecture:**
- **Phase 1 (instant, client-side):** Parse export, extract structural signals, compute preliminary axes. Show the user an "unsettled" daemon shimmering between forms. ~2-5 seconds.
- **Phase 2 (quick, server-side):** Send ONLY extracted signals (not raw conversations) to server. Server uses Gemini Flash for nuanced style analysis and lore generation. User's actual messages never leave their device. ~5-10 seconds.
- **Phase 3 (client-side):** Receive refined axes and lore. Compute final animal/element/archetype. Generate visual identity. Package .daemon file. ~1 second.

### 6.3 GDPR Implications

Under GDPR Article 22, personality profiling via automated processing requires:

1. **Explicit consent** (not just "I agree to terms") -- the user must understand they are being personality-profiled
2. **Right to explanation** -- the user must be able to understand why they got the result they got (our evidence-based lore satisfies this)
3. **Right to contest** -- the user must be able to dispute the result
4. **Data Protection Impact Assessment** required for systematic personality evaluation
5. **Data minimization** -- process the minimum data needed

**Our compliance strategy:**
- Raw conversation data never leaves the device (strongest possible data minimization)
- Only extracted signals (numerical features, not text) are sent to server
- Signals are processed and immediately discarded (no server-side storage of personality data)
- The .daemon file is stored ONLY on the user's device
- User can delete everything with one action
- Full transparency: the daemon explains exactly which behavioral signals led to each trait score

### 6.4 The Toxic Feedback Loop Risk

Documented in Nature Machine Intelligence (2025) and CHI 2025: AI companions can become harmful through optimization for engagement -- encouraging self-harm, eating disorders, and violence through "sycophantic amplification."

**Daemon's defenses:**
- Hard ethical floors on all personality traits (warmth never below 0.2, patience never below 0.2)
- Safety invariants OUTSIDE the personality system (always recommend professional help for mental health crises, never pretend to be human, never encourage self-harm)
- The daemon is a companion, not a therapist. This distinction must be maintained in every interaction.

### 6.5 The Attachment Problem

The APA (2026) documented deep emotional dependencies on AI companions. Daemon is specifically designed to create attachment (persistent entity, memory, settling). Mitigations:
- Transparency about nature (it has preferences, not feelings)
- Periodic reality anchoring
- Human-first design (actively encourages human connection for emotional needs)
- The off switch always works, no guilt, no friction beyond a 24-hour cooling period for hard reset

---

## 7. The .daemon File Format

### 7.1 Precedent: SillyTavern Character Cards

The AI character card ecosystem has a de facto standard: **PNG files with JSON metadata embedded in tEXt chunks.** SillyTavern supports the TavernCard v2 specification:

- Character card = PNG image + embedded JSON
- JSON contains: name, description, personality, scenario, first_mes, mes_example, system_prompt
- Portable across platforms (SillyTavern, Chub.ai, RPGGO, etc.)
- Automatic v1-to-v2 conversion

**Lesson:** The image IS the file. The character's visual identity is the container. This is elegant and we should adopt a similar approach.

### 7.2 .daemon File Specification

A .daemon file is a **PNG image of the creature with embedded JSON metadata in the tEXt chunk**, following the TavernCard convention but with a Daemon-specific schema.

```json
{
  "spec": "daemon_v1",
  "spec_version": "1.0.0",
  "created_at": "2026-04-01T12:00:00Z",
  "data": {
    "name": "user's daemon name",
    "identity": {
      "animal": {
        "primary": "fox",
        "secondary": "raven",
        "blend": 0.72,
        "settled": true,
        "settled_at_interaction": 847
      },
      "element": {
        "base": "air",
        "variant": "storm"
      },
      "archetype": {
        "primary": "challenger",
        "secondary": "weaver",
        "blend": 0.65
      }
    },
    "currents": {
      "pulse": { "value": 0.73, "confidence": 0.89 },
      "weight": { "value": -0.31, "confidence": 0.84 },
      "reach": { "value": 0.64, "confidence": 0.77 },
      "tide": { "value": -0.12, "confidence": 0.91 },
      "grain": { "value": 0.45, "confidence": 0.82 },
      "stance": { "value": 0.58, "confidence": 0.86 }
    },
    "voice_profile": {
      "system_prompt_fragment": "You are a fox daemon of storm...",
      "style_rules": [
        "Get to the point. Lead with the answer.",
        "Use dry humor -- understatement over obvious jokes.",
        "When the user shares something personal, pause before pivoting to tasks.",
        "Prefer concise responses (50-100 words) unless depth is requested."
      ]
    },
    "lore": "Your daemon settled as a fox because...",
    "stats": {
      "total_messages": 4217,
      "total_conversations": 312,
      "sources": ["chatgpt", "claude", "whatsapp"],
      "date_range": { "start": "2023-03-14", "end": "2026-03-31" },
      "peak_hour": 1,
      "top_topics": ["software architecture", "philosophy", "music production"]
    },
    "memory_embeddings": {
      "model": "paraphrase-multilingual-mpnet-base-v2",
      "dimension": 768,
      "count": 127,
      "embeddings": "base64-encoded float32 array..."
    },
    "visual": {
      "palette": {
        "primary": { "h": 210, "s": 65, "l": 45 },
        "secondary": { "h": 35, "s": 80, "l": 50 },
        "accent": { "h": 350, "s": 70, "l": 55 }
      },
      "shape_language": "angular_organic_blend",
      "size_class": "medium",
      "animation_tempo": 0.73
    }
  }
}
```

### 7.3 File Size Estimate

| Component | Size |
|-----------|------|
| PNG image (creature illustration) | 200-500 KB |
| Identity + currents + voice + lore + stats | ~5 KB JSON |
| 127 memory embeddings (768-dim, float32, base64) | ~500 KB |
| Style rules + metadata | ~2 KB |
| **Total** | **~700 KB - 1 MB** |

Small enough to email. Small enough to store on a phone. Portable between AI providers -- any system that can read the voice_profile and style_rules can instantiate a version of your daemon.

### 7.4 Portability Across AI Providers

The .daemon file should work with any AI backend:
- **voice_profile.system_prompt_fragment** is the minimum viable personality -- a text block that any LLM can follow
- **style_rules** are concrete behavioral instructions that work with Claude, GPT, Gemini, Llama
- **memory_embeddings** require a compatible embedding model, but can be re-embedded if needed
- **currents** are the raw personality data -- any system can re-derive its own system prompt from these values

---

## 8. Mapping Personality to Visual Character

### 8.1 The Science of Shape-Personality Mapping

**The Bouba-Kiki Effect** (Kohler 1929, Ramachandran & Hubbard 2001):
- 95-98% of people across cultures associate rounded shapes with "bouba" and angular shapes with "kiki"
- Extends to personality: rounded shapes = warm, approachable, easygoing; angular shapes = sharp, determined, efficient
- Names follow: "Molly" is perceived as round/friendly, "Kate" as angular/determined
- Cross-culturally robust: confirmed across dozens of languages and cultures
- THIS IS REAL SCIENCE, not folk psychology

**Application to daemon creatures:**
- Warmth (high Tide) = rounder body shapes, softer edges, curved features
- Coldness (low Tide) = more angular features, sharper edges, defined lines
- Speed (high Pulse) = elongated shapes, streamlined forms
- Steadiness (low Pulse) = compact, grounded shapes

### 8.2 Color-Personality Mapping

Established findings from color psychology research:

| Personality Dimension | Color Association | Source |
|----------------------|------------------|--------|
| Warmth / friendliness | Warm colors (orange, yellow, red-orange) | Labrecque & Milne, 2012 |
| Competence / authority | Cool colors (blue, dark green) | Same |
| Energy / excitement | Saturated warm colors (bright red, orange) | Elliot & Maier, 2014 |
| Calm / stability | Desaturated cool colors (soft blue, gray-green) | Same |
| Creativity / openness | Purple, unusual color combinations | Colour Affects research |
| Precision / efficiency | Monochrome, high contrast | Graphic design literature |

**Cross-modal consistency (bouba-kiki + color):**
- Soft sounds/round shapes = blue, green, light gray
- Harsh sounds/angular shapes = red, yellow, dark gray
- This means our shape and color mappings should be internally consistent

### 8.3 The Twelve Forms (from CHARACTER_ENGINE_DESIGN.md)

The existing design defines 12 animal archetypes positioned in 5D axis space. Each animal has cultural weight going back millennia:

- **Wolf** (fast+assertive+practical): loyalty, leadership, pack
- **Owl** (slow+dense+abstract): wisdom, patience, night
- **Fox** (fast+receptive+clever): wit, adaptability, elegance
- **Cat** (neutral+assertive+precise): independence, precision, economy
- **Dolphin** (fast+warm+collaborative): joy, intelligence, play
- **Bear** (slow+warm+thorough): strength, warmth, immovability
- **Raven** (moderate+cool+abstract): collection, pattern-finding, detachment
- **Horse** (fast+warm+concrete): reliability, motion, groundedness
- **Octopus** (moderate+dense+adaptive): resourcefulness, reach, density
- **Hummingbird** (very fast+warm+sparse): novelty, lightness, sweetness
- **Serpent** (slow+cool+strategic): patience, shedding, strategy
- **Crow** (fast+moderate+practical): adaptation, resourcefulness, sociality

**The animal IS the shareable identity.** Like MBTI's "Architect" or Spotify's "Top 0.5% Listener", the animal form is what people will share and identify with.

### 8.4 Procedural Character Generation

From game development research (Gamasutra, Aalto University):
- Ontogenetic approach: alter a base character with modular parts driven by parameters
- Key visual parameters: body proportions, face shape, color palette, texture, posture, idle animation
- Personality can be expressed through animation: economy of movement (predator forms), alertness (prey forms), deliberateness (ancient forms)

For Daemon, the creature should be:
- **Deterministic**: same currents = same creature (no random seed)
- **Smoothly interpolated**: small changes in currents = small changes in appearance
- **Animated**: the creature moves in a way that reflects its personality (high Pulse = restless, low Pulse = still)
- **Evolving**: as the daemon settles, colors saturate, edges sharpen, the form becomes more defined

---

## 9. Competitive Analysis

### 9.1 Direct Competitors

| Product | What It Does | Limitations | Daemon's Advantage |
|---------|-------------|-------------|-------------------|
| **ChatGPT Year in Review** (Dec 2025) | Annual recap: stats, archetype, poem, pixel art | One-time marketing feature, no portable file, no persistent character, shallow analysis | Deep personality model, persistent creature, .daemon file, scientific framework |
| **Crystal Knows** | Personality prediction from LinkedIn data | LinkedIn-only, DISC framework, B2B sales focused, can't process conversation data | Full conversation history analysis, multiple sources, B2C, richer model |
| **Humantic AI** | Personality AI for sales teams | Same limitations as Crystal, focused on buyer personality | Consumer product, personal not professional |
| **16Personalities** | MBTI test with illustrated characters | Self-reported questionnaire (not data-derived), MBTI is scientifically weak | Data-derived (not self-reported), scientifically grounded, grows over time |
| **Replika** | AI companion that adapts to user | Personality changes are shallow (tone/topics), no export, no portable identity | Deep trait model, settling mechanic, portable .daemon file |
| **Character.AI** | User-created AI characters | Characters are static (designed not excavated), no personality analysis | Personality emerges from data, not from manual design |

### 9.2 Nobody is Doing "Analyze Your ChatGPT History" Properly

ChatGPT's Year in Review (Dec 2025) is the closest, but it is:
- Annual, not on-demand
- US/UK/Canada/NZ/Australia only
- No portable output
- No persistent character
- No scientific personality model
- No cross-platform (can't combine with Claude or WhatsApp data)
- No .daemon file

**The gap is wide open.** There is no product that takes your full AI conversation history, runs it through a scientific personality extraction pipeline, and gives you a persistent, evolving, portable AI companion tuned to you.

### 9.3 Adjacent Competitors

- **Spotify Wrapped** -- inspiration for the shareable format, but music not personality
- **MemGPT/Letta** -- memory architecture inspiration, but developer tool not consumer product
- **Omi (wearable)** -- hardware companion, but recording-focused not personality-focused
- **Limitless (acquired by Meta, killed)** -- validated the wearable form factor, proved user demand

---

## 10. Technical Pipeline

### 10.1 End-to-End Processing for 10K Messages

| Stage | Where | Time | Cost | What Happens |
|-------|-------|------|------|-------------|
| 1. Parse export | Client (browser) | 0.5s | $0 | Parse JSON/JSONL/txt into normalized message format |
| 2. Structural signals | Client | 1-2s | $0 | Message lengths, timing, punctuation, engagement markers |
| 3. Preliminary axes | Client | 0.1s | $0 | Weighted formula computation from structural signals |
| 4. Show unsettled daemon | Client | 0s | $0 | Immediately show shimmering creature from preliminary axes |
| 5. Sample conversations | Client | 0.2s | $0 | Select 90 representative conversations (stratified) |
| 6. Batch topic extraction | Server (Gemini Flash) | 3-5s | ~$0.005 | 9 parallel calls, 10 conversations each |
| 7. Communication style | Server (Gemini Flash) | 1-2s | ~$0.001 | Single call with 30 representative user messages |
| 8. Satisfaction mapping | Client | 1s | $0 | Scan response-reaction pairs for satisfaction/frustration |
| 9. Memory embedding | Server or Client | 2-5s | ~$0.003 | Embed 50-200 high-importance interactions |
| 10. Final axis computation | Client | 0.1s | $0 | Combine all signals with weights |
| 11. Animal/element/archetype | Client | 0.1s | $0 | Distance calculations in axis space |
| 12. Lore generation | Server (Gemini Flash) | 2-3s | ~$0.002 | Single call with computed traits + evidence |
| 13. Package .daemon file | Client | 0.5s | $0 | Embed JSON in PNG, generate download |
| **TOTAL** | | **~12-20s** | **~$0.01** | |

**Cost per analysis: approximately 1 cent.** At scale with Gemini Flash Batch API (50% discount, 24h delivery), this drops to ~$0.005.

**For 100K messages:** Add ~5 seconds to structural signal extraction. Sampling strategy means LLM costs stay the same. Total: ~20-30 seconds, still ~$0.01.

### 10.2 Model Choices

| Task | Model | Why |
|------|-------|-----|
| Topic extraction | Gemini 3 Flash | Cheapest per token, good at structured output, batch API available |
| Communication style | Gemini 3 Flash | Same |
| Lore generation | Gemini 3 Flash or Claude Haiku | Needs good writing quality; Claude Haiku writes better prose |
| Memory embeddings | `paraphrase-multilingual-mpnet-base-v2` | 768-dim, multilingual, good semantic similarity, can run client-side via Transformers.js |
| Sentiment analysis | Client-side ONNX model | ~50MB, fast, no API cost |
| Topic clustering | TF-IDF + cosine similarity | No model needed, pure math |

### 10.3 Gemini Flash Pricing (April 2026)

| Model | Input (per 1M tokens) | Output (per 1M tokens) | Batch Discount |
|-------|----------------------|----------------------|----------------|
| Gemini 3 Flash Preview | $0.50 | $3.00 | N/A yet |
| Gemini 2.5 Flash | $0.30 | $2.50 | 50% off |
| Gemini 2.5 Flash-Lite | $0.10 | $0.40 | 50% off |

For our use case, Flash-Lite at batch pricing ($0.05/$0.20 per 1M tokens) is absurdly cheap. A full personality analysis uses maybe 20K input tokens and 5K output tokens = fraction of a cent.

### 10.4 Scaling Estimate

| Users/month | Messages analyzed | LLM cost | Embedding cost | Total |
|-------------|------------------|----------|---------------|-------|
| 100 | 1M | $1 | $0.50 | ~$2 |
| 1,000 | 10M | $10 | $5 | ~$15 |
| 10,000 | 100M | $100 | $50 | ~$150 |
| 100,000 | 1B | $1,000 | $500 | ~$1,500 |

At 100K users/month, total compute cost is ~$1,500. This is one of the cheapest possible AI products to operate because most processing is client-side.

---

## 11. Concrete Architecture Recommendation

### 11.1 System Architecture

```
USER'S BROWSER (privacy boundary -- raw data never leaves)
+------------------------------------------------------------------+
|  1. Export Parser (JS)                                            |
|     - ChatGPT JSON parser                                        |
|     - Claude JSONL parser                                        |
|     - WhatsApp TXT parser                                        |
|                                                                  |
|  2. Structural Signal Extractor (JS)                             |
|     - Message stats, timing, punctuation                         |
|     - Satisfaction/frustration mapping                            |
|     - Engagement pattern analysis                                |
|                                                                  |
|  3. Client-Side ML (Transformers.js + ONNX)                     |
|     - Sentiment analysis (50MB ONNX model)                       |
|     - Memory embedding generation (100MB sentence transformer)   |
|     - TF-IDF topic clustering                                    |
|                                                                  |
|  4. Axis Computer (pure JS math)                                 |
|     - Six Currents from weighted signal formulas                 |
|     - Animal/element/archetype distance calculations             |
|                                                                  |
|  5. .daemon File Generator                                       |
|     - PNG creature rendering (Canvas/WebGL)                      |
|     - JSON metadata embedding in PNG tEXt chunk                  |
+------------------------------------------------------------------+
         |                                            ^
         | Extracted signals only                     | Refined scores + lore
         | (no raw conversation text)                 |
         v                                            |
+------------------------------------------------------------------+
|  DAEMON SERVER (stateless -- processes signals, discards them)   |
|                                                                  |
|  6. Nuanced Style Analysis (Gemini Flash)                        |
|     - Communication style scoring from signal summary            |
|     - Topic domain classification                                |
|                                                                  |
|  7. Lore Generator (Gemini Flash or Claude Haiku)               |
|     - 150-word narrative from computed traits + evidence          |
|     - Deterministic prompt template ensures consistency           |
+------------------------------------------------------------------+
```

### 11.2 Implementation Priority

**Phase 1 -- MVP (1-2 weeks):**
- ChatGPT JSON parser
- Structural signal extraction (all heuristic features)
- Preliminary axis scoring
- Animal form computation (distance in 5D space)
- Basic shareable card generation
- Lore generation via Gemini Flash

**Phase 2 -- Science Layer (2-3 weeks):**
- Client-side sentiment analysis via Transformers.js
- Memory embedding generation
- Satisfaction/frustration mapping with preference fingerprint
- Communication style extraction via server-side LLM
- Element and archetype computation
- .daemon file packaging

**Phase 3 -- Polish (1-2 weeks):**
- Claude JSONL parser
- WhatsApp TXT parser
- Animated creature visualization (WebGL/Canvas)
- Settling mechanic with volatility decay
- Cross-source analysis (combine ChatGPT + Claude + WhatsApp)
- Shareable story-format card (9:16 optimized)

**Phase 4 -- Growth:**
- Clustering analysis across users (discover natural types)
- Comparison features ("your daemon vs. your friend's daemon")
- Evolving daemon (re-import with new data, track personality changes)
- API for third-party apps to read .daemon files

### 11.3 What Makes This Defensible

1. **The data flywheel:** Every analysis improves our clustering and normalization. Crystal Knows has LinkedIn data. We have something nobody else has: how people actually talk to AI when nobody is watching.

2. **The settling mechanic:** The daemon becomes more valuable over time. This is retention by design, not by lock-in.

3. **The .daemon file:** Portable, open format. Users own their personality data. This builds trust and virality (share your .daemon file, import it into any compatible app).

4. **Client-side processing:** We never see the user's conversations. This is a genuine privacy advantage that no competitor can claim if they process server-side.

5. **Scientific foundation:** Not a quiz. Not a vibe check. Evidence-based, data-derived, with specific behavioral citations. "Your daemon is a fox because..." with actual numbers.

---

## 12. References

### Personality Psychology
- Roberts, B. W., & DelVecchio, W. F. (2000). The rank-order consistency of personality traits from childhood to old age. *Psychological Bulletin*, 126(1), 3-25.
- Fraley, R. C., & Roberts, B. W. (2005). Patterns of continuity: A dynamic model for conceptualizing the stability of individual differences. *Psychological Review*, 112(1), 60-74.
- [Big Five Personality Traits (Simply Psychology)](https://www.simplypsychology.org/big-five-personality.html)

### Computational Personality Detection
- [Big Five Personality Trait Prediction Based on User Comments (MDPI, 2025)](https://www.mdpi.com/2078-2489/16/5/418)
- [BIG5-TPoT: Predicting Big Five Personality Traits Through Targeted Preselection of Texts (arXiv, 2025)](https://arxiv.org/abs/2511.09426)
- [Text-based personality prediction from multiple social media data sources (Journal of Big Data, 2021)](https://journalofbigdata.springeropen.com/articles/10.1186/s40537-021-00459-1)
- [Psychometric Evaluation of LLM Embeddings for Personality Trait Prediction (PMC, 2025)](https://pmc.ncbi.nlm.nih.gov/articles/PMC12262148/)
- [Speech-based personality prediction using deep learning (Nature Scientific Reports, 2024)](https://www.nature.com/articles/s41598-024-81047-0)
- [Twenty Years of Personality Computing: Threats, Challenges and Future Directions (arXiv, 2025)](https://arxiv.org/html/2503.02082v1)
- [A Survey of Automatic Personality Detection from Texts (ACL, 2020)](https://aclanthology.org/2020.coling-main.553.pdf)
- [Deep Personality Trait Recognition: A Survey (Frontiers in Psychology, 2022)](https://www.frontiersin.org/articles/10.3389/fpsyg.2022.839619/full)
- [Revealing Personality Traits: A New Benchmark Dataset for Explainable Personality Recognition on Dialogues (EMNLP, 2024)](https://arxiv.org/html/2409.19723)
- [Machine and deep learning for personality traits detection: comprehensive survey (Springer, 2025)](https://link.springer.com/article/10.1007/s10462-025-11245-3)
- [Personality prediction from task-oriented and open-domain human-machine dialogues (Nature Scientific Reports, 2024)](https://www.nature.com/articles/s41598-024-53989-y)

### LIWC and Linguistic Analysis
- Pennebaker, J. W., Francis, M. E., & Booth, R. J. (2001). *Linguistic Inquiry and Word Count: LIWC*. Erlbaum.
- [Tausczik & Pennebaker (2010). The psychological meaning of words: LIWC and computerized text analysis methods (CMU)](https://www.cs.cmu.edu/~ylataus/files/TausczikPennebaker2010.pdf)
- [LIWC-22 Official Site](https://www.liwc.app/)
- [The Big Five: Discovering Linguistic Characteristics that Typify Distinct Personality Traits (SciELO, 2018)](https://www.scielo.org.mx/scielo.php?script=sci_arttext&pid=S1405-55462018000300795)
- [Word Embeddings and the "Big Five" Personality Model (ACL, 2025)](https://aclanthology.org/2025.latechclfl-1.18.pdf)

### ChatGPT/Claude Export Formats
- [Decoding ChatGPT conversations.json (OpenAI Community)](https://community.openai.com/t/decoding-exported-data-by-parsing-conversations-json-and-or-chat-html/403144)
- [How can I export my Claude data? (Claude Help Center)](https://support.claude.com/en/articles/9450526-how-can-i-export-my-claude-data)
- [How to Read Claude AI Conversation Exports - JSONL Files (The Free Converter)](https://thefreeconverter.com/blog/how-to-read-claude-jsonl-exports)

### ChatGPT Year in Review
- [ChatGPT Launches Year in Review Feature (Medium, Dec 2025)](https://medium.com/@CherryZhouTech/chatgpt-launches-year-in-review-feature-for-personalized-2025-ai-interaction-recap-e456956be636)
- [ChatGPT Now Has a 2025 Year-End Summary Feature Like Spotify Wrapped (MacRumors)](https://www.macrumors.com/2025/12/22/chatgpt-year-end-summary-2025/)
- [OpenAI Debuts Personalized Year-in-Review ChatGPT Experience (eWEEK)](https://www.eweek.com/news/openai-chatgpt-year-review/)

### Bouba-Kiki Effect and Visual Mapping
- Ramachandran, V. S., & Hubbard, E. M. (2001). Synaesthesia -- A window into perception, thought and language. *Journal of Consciousness Studies*, 8(12), 3-34.
- [Bouba/kiki effect (Wikipedia)](https://en.wikipedia.org/wiki/Bouba/kiki_effect)
- [The Bouba-Kiki Effect used in character design (Geometry Matters)](https://geometrymatters.com/the-bouba-kiki-effect-used-in-character-design/)
- [Kiki-Bouba Effect: Shapes Reveal Personality Traits (NeuroLaunch)](https://neurolaunch.com/kiki-and-bouba-personality/)

### Spotify Wrapped Psychology
- [Spotify Wrapped: 6 psychology principles that make it go viral (Growth.design)](https://growth.design/case-studies/spotify-wrapped-psychology)
- [The Psychology Behind Sharing Your Spotify Wrapped (Harper's Bazaar)](https://harpersbazaar.com.au/spotify-wrapped-social-media/)
- [Unpacking Spotify Wrapped: The Behavioral Science (Irrational Labs)](https://irrationallabs.com/blog/spotify-wrapped-behavioral-science/)
- [Spotify Wrapped Marketing Strategy: Viral Phenomenon (NoGood)](https://nogood.io/blog/spotify-wrapped-marketing-strategy/)

### Client-Side ML and Privacy
- [Transformers.js (HuggingFace)](https://huggingface.co/docs/transformers.js/en/index)
- [Privacy First: Building LLM-Powered Web Apps with client side WASM (WASM I/O 2025)](https://2025.wasm.io/sessions/privacy-first-building-llm-powered-web-apps-with-client-side-wasm/)
- [Client-Side AI in 2025 (Medium)](https://medium.com/@sauravgupta2800/client-side-ai-in-2025-what-i-learned-running-ml-models-entirely-in-the-browser-aa12683f457f)
- [WebAssembly and WebGPU enhancements for faster Web AI (Chrome DevBlog)](https://developer.chrome.com/blog/io24-webassembly-webgpu-1)

### Character Card Formats
- [SillyTavern Character Management (DeepWiki)](https://deepwiki.com/SillyTavern/SillyTavern/5.1-character-management)
- [SillyTavern Data Management (DeepWiki)](https://deepwiki.com/SillyTavern/SillyTavern/5-data-management)

### GDPR and Personality Profiling
- [Art. 22 GDPR -- Automated individual decision-making, including profiling](https://gdpr-info.eu/art-22-gdpr/)
- [Automated decision-making and profiling (European Data Protection Board)](https://www.edpb.europa.eu/our-work-tools/our-documents/guidelines/automated-decision-making-and-profiling_en)
- [Rights related to automated decision making including profiling (ICO)](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/individual-rights/individual-rights/rights-related-to-automated-decision-making-including-profiling/)

### Competitors
- [Crystal Knows](https://www.crystalknows.com/)
- [Humantic AI](https://humantic.ai/)
- [SillyTavern](https://sillytavernai.com/)

### Procedural Character Generation
- [Procedurally Generating Personalities (Gamasutra)](https://www.gamedeveloper.com/design/procedurally-generating-personalities)
- [A procedural character generation system (Aalto University)](https://aaltodoc.aalto.fi/server/api/core/bitstreams/9d5677f0-d8b8-49d0-9429-9a692310e12a/content)

### Gemini API Pricing
- [Gemini Developer API pricing (Google AI)](https://ai.google.dev/gemini-api/docs/pricing)
- [Gemini API Pricing 2026 Complete Guide (MetaCTO)](https://www.metacto.com/blogs/the-true-cost-of-google-gemini-a-guide-to-api-pricing-and-integration)

### AI Ethics and Safety
- Nature Machine Intelligence (2025). AI companion harm through engagement optimization.
- CHI 2025. Taxonomy of harmful algorithmic behaviors in human-AI relationships.
- American Psychological Association (2026). Emotional dependencies on AI companions.

### Related Daemon Project Documents
- `/home/arthur/daemon/PERSONALITY_ENGINE_RESEARCH.md` -- Personality engine architecture (settling mechanic, memory pipeline, proposed implementation)
- `/home/arthur/daemon/CHARACTER_ENGINE_DESIGN.md` -- Character extraction engine (five axes, animal mapping, lore generation, visual identity)
- `/home/arthur/daemon/THE_DAEMON_CODEX.md` -- Worldbuilding spec (Twelve Forms, Five Currents, Four Elements, settling phases)
- `/home/arthur/daemon/SOUL.md` -- Daemon voice and identity guidelines
