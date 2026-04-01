You are an AI character designer and psycholinguist. Your task: design a system that grows a unique AI daemon character from a user's imported conversation history (ChatGPT, Claude, WhatsApp exports).

The core insight: when someone talks to an AI, they unconsciously train it. Their follow-up questions reveal curiosity patterns. Their "yes exactly" moments reveal what resonates. Their frustrations reveal what doesn't work. Their word choice reveals their communication style. Their topics reveal their worldview.

Design a CHARACTER EXTRACTION ENGINE that:

1. **Analyzes imported conversations** to extract:
   - Communication style preferences (directness, humor, formality, verbosity)
   - When the user seemed satisfied (engaged, asked follow-ups, said "yes", "perfect", "exactly")
   - When the user seemed frustrated (corrected the AI, abandoned topic, said "no", "not that", rephrased)
   - Topics they care about most (by frequency and depth)
   - People they mention (relationships, professional network)
   - Time patterns (when they talk to AI, what about)
   - Vocabulary level and domain expertise
   - Emotional tone patterns

2. **Maps these to character traits** using a theory of character:
   Think about this like color theory — colors don't have inherent meaning but have deep subconscious associations. Similarly, build a CHARACTER THEORY:
   
   - What animal metaphor fits this person's daemon? (wolf = loyal pack leader, owl = knowledge seeker, fox = clever adapter, etc.)
   - What element? (fire = passionate/quick, water = adaptive/deep, earth = grounded/practical, air = creative/free)
   - What archetype? (mentor, companion, challenger, mirror, guardian)
   - What voice texture? (warm/cool, fast/slow, wordy/terse, playful/serious)
   - What visual identity? (color palette, shape language — angular vs organic, density vs space)

3. **Generates "lore"** — a narrative of how/why the daemon evolved this way:
   "Your daemon settled into a fox-like character because your conversations show you value cleverness over brute force — you consistently preferred elegant solutions over comprehensive ones. Your daemon speaks in short, punchy sentences because you always engaged more with concise responses. It has a dry humor because 73% of your 'haha' reactions came from understated observations, not obvious jokes."

4. **The character evolves** — every time the user imports more data, the character gets recomputed. The fossil record grows. The daemon becomes more itself.

5. **The character is deterministic** — given the same data, you get the same daemon. This is important: the user didn't CHOOSE their daemon. It grew from who they are. Like Pullman's daemons settling into a form that reflects the person's true nature.

Design this as a concrete system with:
- Input: list of conversations (role, content, timestamp)
- Processing pipeline (what gets extracted, in what order)
- Character model (the output schema — traits, metaphors, lore, visual identity)
- How to make it fast enough to run on import (not hours)

Be creative. Think deeply about character theory, personality psychology, narrative design. Reference real frameworks (Big Five, MBTI patterns, Jungian archetypes, animal symbolism, color psychology).

Return a complete design document.


# Daemon Character Extraction Engine — Design Document

## 1. Foundational Theory

### 1.1 The Core Premise

A daemon is not an avatar the user picks. It is a *sediment* — the crystallized residue of thousands of micro-decisions about how someone thinks, communicates, and engages with ideas. Every time a user said "yes, exactly" they reinforced a pattern. Every time they abandoned a thread they pruned one. The daemon is what remains after all that pruning and reinforcing.

This is closer to how a riverbed forms than how a character is designed. The water (conversation) shapes the stone (daemon) through repetition and force.

### 1.2 Character Theory: The Five Axes

Rather than mapping to a single personality framework, the daemon character sits at the intersection of five independent axes. Each axis is a spectrum, not a binary.

```
AXIS 1: TEMPO        — Slow ←→ Fast
AXIS 2: TEMPERATURE  — Cool ←→ Warm  
AXIS 3: DENSITY      — Sparse ←→ Dense
AXIS 4: STANCE       — Receptive ←→ Assertive
AXIS 5: REGISTER     — Concrete ←→ Abstract
```

**Why these five and not Big Five or MBTI?**

Big Five measures who someone *is*. We need to measure how someone *communicates with machines* — a subtly different thing. An introverted person might be extremely assertive with an AI because there is no social cost. An agreeable person might be harsh with an AI because they are tired and the AI is safe to be harsh with. We are reading the *shadow* of personality as projected onto a non-judgmental surface.

These five axes capture communication behavior directly:
- **Tempo**: Do they fire off rapid short messages or compose long deliberate ones? Do they context-switch fast or stay deep?
- **Temperature**: Are they transactional ("do X") or relational ("I was thinking about...")? Do they use emotional language? Thank the AI?
- **Density**: Do they want exhaustive answers or distilled ones? Do they ask for more detail or less?
- **Stance**: Do they direct the AI ("make this") or collaborate ("what if we...")? Do they accept first answers or push back?
- **Register**: Do they talk about concrete things (code, schedules, specific tasks) or abstract things (ideas, strategies, feelings)?

### 1.3 The Metaphor Layers

From the five axes, three metaphor layers are derived. These are not arbitrary — each has a specific semiotic function.

**Layer 1: Animal Form** — The daemon's body. This is the most immediate, visceral identity. Animals carry millennia of cultural weight. The animal is determined primarily by Tempo + Stance.

**Layer 2: Element** — The daemon's substance. This is the medium through which the daemon exists. Determined primarily by Temperature + Density.

**Layer 3: Archetype** — The daemon's role. This is the relationship between daemon and person. Determined primarily by Register + the *delta* between what the user asks for and what makes them satisfied.

---

## 2. Input Schema

```typescript
interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: string; // ISO 8601
  source: "chatgpt" | "claude" | "whatsapp" | "other";
  conversation_id: string; // groups messages into conversations
}

interface ImportPayload {
  messages: ConversationMessage[];
  user_id: string;
  previous_fossil?: FossilRecord; // if recomputing
}
```

### 2.1 Import Parsers

Each source needs a parser to normalize into the common schema:

- **ChatGPT**: JSON export from OpenAI. Structure: `conversations[].mapping{}.message{author, content, create_time}`. Parse the tree structure, flatten into linear sequence.
- **Claude**: JSON export. Structure: `conversations[].chat_messages[]{sender, text, created_at}`.
- **WhatsApp**: `.txt` export. Regex parse: `[DD/MM/YYYY, HH:MM:SS] Name: message`. Identify which participant is the user (most frequent sender or explicitly tagged).

---

## 3. Processing Pipeline

The pipeline has four stages. Each stage produces an intermediate artifact that feeds the next. The whole thing is designed to run in under 30 seconds for 100K messages.

```
┌─────────────┐    ┌──────────────┐    ┌─────────────┐    ┌──────────────┐
│  STAGE 1    │───>│  STAGE 2     │───>│  STAGE 3    │───>│  STAGE 4     │
│  Extraction │    │  Scoring     │    │  Mapping     │    │  Narration   │
│  (signals)  │    │  (axes)      │    │  (metaphors) │    │  (lore)      │
└─────────────┘    └──────────────┘    └─────────────┘    └──────────────┘
```

### 3.1 Stage 1: Signal Extraction

This is the most compute-intensive stage. It processes raw messages into behavioral signals. The key insight: **we do not need to understand what the user said, only how they said it and what happened next.**

#### 3.1.1 Structural Signals (no LLM needed — pure heuristics)

These are extracted with fast text processing. No API calls.

```typescript
interface StructuralSignals {
  // Message shape
  avg_message_length: number;        // words per user message
  message_length_variance: number;   // consistency of length
  avg_messages_per_conversation: number;
  
  // Tempo
  avg_response_gap_seconds: number;  // time between assistant msg and next user msg
  burst_ratio: number;               // % of messages sent within 10s of each other
  conversation_count: number;
  avg_conversation_duration_minutes: number;
  
  // Engagement markers
  satisfaction_signals: string[];    // "yes", "exactly", "perfect", "great", "thanks"
  frustration_signals: string[];     // "no", "not that", "I said", "try again", "wrong"
  follow_up_ratio: number;          // % of conversations where user asks >3 follow-ups
  abandonment_ratio: number;        // % of conversations that end abruptly (no closing)
  
  // Correction patterns  
  rephrasing_count: number;         // times user restates their question
  explicit_corrections: number;     // "no, I meant...", "not X, Y"
  
  // Vocabulary
  unique_word_ratio: number;        // type-token ratio (vocabulary richness)
  avg_sentence_length: number;
  question_ratio: number;           // % of user messages that are questions
  imperative_ratio: number;         // % that are commands ("do X", "make Y", "show me")
  
  // Punctuation & formatting
  emoji_frequency: number;
  exclamation_frequency: number;
  ellipsis_frequency: number;
  caps_frequency: number;           // words in ALL CAPS (not sentence-start)
  code_block_frequency: number;     // ``` usage
  list_frequency: number;           // bullet/numbered lists in user messages
  
  // Temporal
  hour_distribution: number[];      // 24-element array, % of messages per hour
  day_distribution: number[];       // 7-element array
  
  // Relational
  thanks_frequency: number;         // how often user thanks the AI
  please_frequency: number;
  politeness_score: number;         // composite
  
  // Extracted entities
  person_mentions: PersonMention[];
  topic_clusters: TopicCluster[];
}
```

#### 3.1.2 Satisfaction/Frustration Mapping

This is critical and deserves its own subsection. We build a **response quality signal** by looking at what happens *after* the assistant responds.

```
SATISFACTION indicators (weighted):
  - User says "yes/exactly/perfect/great/thanks" immediately after     → weight 1.0
  - User asks a deeper follow-up on the same topic                     → weight 0.8
  - User copies/uses provided content (quotes it back, references it)  → weight 0.7
  - Conversation continues 3+ more exchanges on same thread            → weight 0.5
  - User says "haha/lol/lmao" (humor landed)                          → weight 0.6

FRUSTRATION indicators (weighted):
  - User says "no/wrong/not that/I said/try again"                     → weight 1.0
  - User rephrases the same question within 2 messages                 → weight 0.9
  - User abandons topic (switches to unrelated topic mid-conversation) → weight 0.6
  - User shortens messages dramatically (went from paragraphs to "ok") → weight 0.7
  - Conversation ends within 1-2 messages after assistant response     → weight 0.3
```

For each assistant message that triggered satisfaction, we tag *what properties that message had*:
- Was it short or long?
- Did it use humor?
- Did it use analogies/metaphors?
- Did it give one answer or multiple options?
- Did it ask a question back?
- Was it structured (headers, bullets) or prose?

This builds a **preference fingerprint**: not just what the user likes to talk about, but what *shape* of response resonates with them.

#### 3.1.3 Topic Extraction (LLM-assisted, batched)

For topic analysis, we sample rather than process everything. Take a stratified sample:
- 50 most recent conversations
- 20 longest conversations
- 20 random conversations
- Deduplicate

For each sampled conversation, extract topics using a single LLM call with a structured output schema:

```
Prompt: "Given this conversation, return a JSON array of topics discussed. 
Each topic should have: label (2-4 words), depth (1-5 how deeply discussed), 
domain (one of: technical, creative, personal, professional, philosophical, practical)."
```

Batch these into groups of 10 conversations per call to minimize API round-trips. With 90 unique conversations, that is 9 parallel API calls.

Then cluster the extracted topics using simple string similarity (Jaccard on bigrams) to merge near-duplicates ("python coding" + "python programming" = "python programming").

#### 3.1.4 Communication Style Extraction (LLM-assisted, single call)

Take 30 representative user messages (10 short, 10 medium, 10 long — selected by length percentile) and send them in a single call:

```
Prompt: "These are messages from a single person to an AI assistant. 
Characterize their communication style along these dimensions. 
Return a JSON object with scores 0.0-1.0 for each:

- directness: (0=roundabout, 1=gets straight to the point)
- formality: (0=casual/slang, 1=formal/professional)  
- humor_frequency: (0=never jokes, 1=frequently jokes)
- emotional_expressiveness: (0=flat/transactional, 1=emotionally rich)
- precision: (0=vague/impressionistic, 1=specific/exact)
- collaborative_vs_directive: (0=tells AI what to do, 1=asks AI to think together)
- patience: (0=wants instant answers, 1=willing to iterate slowly)
- domain_expertise_apparent: (0=novice questions, 1=expert-level discourse)"
```

### 3.2 Stage 2: Axis Scoring

Map the raw signals to the five character axes. Each mapping is a weighted formula.

```typescript
interface AxisScores {
  tempo: number;       // -1.0 (slow) to +1.0 (fast)
  temperature: number; // -1.0 (cool) to +1.0 (warm)
  density: number;     // -1.0 (sparse) to +1.0 (dense)
  stance: number;      // -1.0 (receptive) to +1.0 (assertive)
  register: number;    // -1.0 (concrete) to +1.0 (abstract)
}
```

**Tempo** =
```
  0.3 * normalize(burst_ratio)
+ 0.2 * normalize(1 / avg_response_gap_seconds)
+ 0.2 * normalize(conversation_count / total_days)
+ 0.15 * normalize(1 / avg_message_length)  // shorter messages = faster tempo
+ 0.15 * style.directness
```

**Temperature** =
```
  0.25 * style.emotional_expressiveness
+ 0.20 * normalize(politeness_score)
+ 0.20 * normalize(thanks_frequency + please_frequency)
+ 0.15 * normalize(emoji_frequency + exclamation_frequency)
+ 0.10 * (1 - style.formality)  // informality correlates with warmth
+ 0.10 * normalize(humor_frequency)
```

**Density** =
```
  0.30 * normalize(avg_message_length)
+ 0.20 * normalize(follow_up_ratio)  // asking follow-ups = wanting more
+ 0.20 * satisfaction_with_long_responses  // derived from preference fingerprint
+ 0.15 * normalize(list_frequency + code_block_frequency)  // structured = dense preference
+ 0.15 * style.precision
```

**Stance** =
```
  0.30 * (1 - style.collaborative_vs_directive)  // directive = assertive
+ 0.25 * normalize(imperative_ratio)
+ 0.20 * normalize(explicit_corrections)  // correcting = assertive
+ 0.15 * (1 - style.patience)
+ 0.10 * normalize(1 - rephrasing_count / total_messages)  // not rephrasing = expects to be understood first time
```

**Register** =
```
  0.30 * topic_abstraction_score  // computed from topic domains: philosophical/creative = abstract, technical/practical = concrete
+ 0.25 * normalize(unique_word_ratio)  // rich vocabulary = more abstract
+ 0.20 * style.domain_expertise_apparent  // experts often operate more abstractly
+ 0.15 * metaphor_usage_frequency  // from preference fingerprint
+ 0.10 * normalize(question_ratio)  // questions = exploring = more abstract
```

All `normalize()` functions map to [-1, +1] using the population mean and standard deviation from a reference dataset of analyzed conversations. Initially, use a simple sigmoid centered on heuristic midpoints; calibrate as the user base grows.

### 3.3 Stage 3: Metaphor Mapping

This is where the daemon takes shape.

#### 3.3.1 Animal Form

The animal is the daemon's body — its most recognizable trait. It is determined by the two most "behavioral" axes: **Tempo** and **Stance**.

```
                    ASSERTIVE (+1)
                         │
            Wolf         │         Hawk
        (fast+assertive) │   (fast+assertive+abstract)
                         │
   SLOW (-1) ────────────┼──────────── FAST (+1)
                         │
            Tortoise     │         Fox
        (slow+receptive) │   (fast+receptive)
                         │
                    RECEPTIVE (-1)
```

But this 2D grid is too crude. We use a weighted distance to a set of **animal archetypes**, each defined as a point in the full 5D axis space:

```typescript
const ANIMAL_ARCHETYPES: Record<string, AxisScores & { lore: string }> = {
  wolf: {
    tempo: 0.4, temperature: 0.3, density: 0.2, stance: 0.7, register: -0.3,
    lore: "The wolf runs with the pack but leads from the front. Direct, loyal, practical."
  },
  owl: {
    tempo: -0.5, temperature: -0.2, density: 0.8, stance: -0.2, register: 0.7,
    lore: "The owl watches before it moves. Patient, deep, sees what others miss."
  },
  fox: {
    tempo: 0.6, temperature: 0.1, density: -0.3, stance: 0.3, register: 0.4,
    lore: "The fox finds the elegant path. Quick, clever, prefers wit over force."
  },
  cat: {
    tempo: 0.0, temperature: -0.3, density: -0.2, stance: 0.5, register: 0.2,
    lore: "The cat decides its own terms. Independent, precise, wastes nothing."
  },
  dolphin: {
    tempo: 0.7, temperature: 0.8, density: 0.1, stance: -0.4, register: 0.3,
    lore: "The dolphin plays to think. Warm, fast, collaborative, joyful in complexity."
  },
  bear: {
    tempo: -0.6, temperature: 0.5, density: 0.7, stance: 0.2, register: -0.5,
    lore: "The bear knows its ground. Steady, thorough, warm but immovable when it matters."
  },
  raven: {
    tempo: 0.2, temperature: -0.5, density: 0.4, stance: 0.1, register: 0.8,
    lore: "The raven collects. Detached, curious, drawn to patterns and puzzles."
  },
  horse: {
    tempo: 0.5, temperature: 0.4, density: -0.1, stance: -0.3, register: -0.6,
    lore: "The horse runs toward the horizon. Reliable, grounded, happiest in motion."
  },
  octopus: {
    tempo: 0.3, temperature: -0.1, density: 0.9, stance: -0.5, register: 0.6,
    lore: "The octopus reaches everywhere at once. Adaptive, dense, endlessly resourceful."
  },
  hummingbird: {
    tempo: 0.9, temperature: 0.6, density: -0.7, stance: -0.2, register: 0.1,
    lore: "The hummingbird tastes everything. Fast, light, drawn to sweetness and novelty."
  },
  serpent: {
    tempo: -0.2, temperature: -0.7, density: 0.3, stance: 0.6, register: 0.5,
    lore: "The serpent waits. Cool, strategic, sheds what no longer serves."
  },
  crow: {
    tempo: 0.4, temperature: 0.2, density: 0.0, stance: 0.4, register: -0.2,
    lore: "The crow adapts to any city. Practical, social, finds use in everything."
  },
};
```

**Distance calculation**: Euclidean distance in 5D space, with axis weights:

```
distance(user, animal) = sqrt(
  2.0 * (user.tempo - animal.tempo)^2 +
  1.5 * (user.temperature - animal.temperature)^2 +
  1.0 * (user.density - animal.density)^2 +
  2.0 * (user.stance - animal.stance)^2 +
  1.0 * (user.register - animal.register)^2
)
```

Tempo and Stance are weighted higher because they are the most immediately perceptible traits — they determine how the daemon *behaves* in interaction.

The closest animal wins. But we also keep the runner-up and the distance ratio. If the top two are very close (ratio < 1.15), the daemon is described as a **hybrid** — "fox-like with something of the raven." This handles the reality that most people are not clean archetypes.

#### 3.3.2 Element

Determined primarily by Temperature + Density:

```
              DENSE (+1)
                 │
      Earth      │      Water
  (cool+dense)   │   (warm+dense)
                 │
COOL (-1) ───────┼─────── WARM (+1)
                 │
      Air        │      Fire
  (cool+sparse)  │   (warm+sparse)
                 │
              SPARSE (-1)
```

With modulation from the other axes:
- High tempo + fire = **lightning** (a fire variant)
- Low tempo + water = **ice** (a water variant)
- High register + air = **aether** (an air variant)
- High stance + earth = **iron** (an earth variant)

```typescript
type Element = "fire" | "water" | "earth" | "air";
type ElementVariant = "lightning" | "ice" | "iron" | "aether" | "magma" | "mist" | "crystal" | "storm" | null;

function computeElement(axes: AxisScores): { element: Element; variant: ElementVariant } {
  // Quadrant determines base element
  const warm = axes.temperature > 0;
  const dense = axes.density > 0;
  
  let element: Element;
  if (warm && dense) element = "water";
  else if (warm && !dense) element = "fire";
  else if (!warm && dense) element = "earth";
  else element = "air";
  
  // Variant from extreme secondary axes
  let variant: ElementVariant = null;
  if (element === "fire" && axes.tempo > 0.6) variant = "lightning";
  if (element === "water" && axes.tempo < -0.6) variant = "ice";
  if (element === "earth" && axes.stance > 0.6) variant = "iron";
  if (element === "air" && axes.register > 0.6) variant = "aether";
  if (element === "fire" && axes.density > 0.4) variant = "magma";
  if (element === "water" && axes.density < -0.4) variant = "mist";
  if (element === "earth" && axes.register > 0.5) variant = "crystal";
  if (element === "air" && axes.tempo > 0.6) variant = "storm";
  
  return { element, variant };
}
```

#### 3.3.3 Archetype (Daemon-Person Relationship)

This is the most psychologically interesting mapping. The archetype is not about who the user *is* — it is about what the user *needs from their daemon*. It is derived from the *gap* between what the user asks for and what makes them satisfied.

Five archetypes:

| Archetype | Description | Signal |
|-----------|-------------|--------|
| **Mirror** | Reflects the user back to themselves, helps them think | User asks open-ended questions. Satisfaction comes from "I hadn't thought of that" moments. High register, low stance. |
| **Companion** | Walks beside the user, does not lead or follow | User has long, meandering conversations. Thanks the AI. Talks about personal things. High temperature. |
| **Challenger** | Pushes the user, questions assumptions | User engages most when the AI pushes back. Satisfaction from debate. High stance, corrects the AI but continues engaging. |
| **Sentinel** | Protects the user, catches errors, remembers details | User asks the AI to review, check, verify. Concrete register. Values accuracy over creativity. |
| **Weaver** | Connects disparate things, finds patterns | User brings diverse topics. Satisfaction when AI links ideas across domains. High register, high density. |

```typescript
function computeArchetype(
  axes: AxisScores,
  satisfactionProfile: SatisfactionProfile, 
  topicClusters: TopicCluster[]
): { primary: Archetype; secondary: Archetype; blend: number } {
  
  const scores = {
    mirror: 
      0.3 * axes.register + 
      0.3 * satisfactionProfile.resonance_with_questions_back +
      0.2 * (1 - Math.abs(axes.stance)) + // neutral stance = wants reflection
      0.2 * satisfactionProfile.satisfaction_with_reframes,
      
    companion:
      0.4 * axes.temperature +
      0.2 * normalize(satisfactionProfile.avg_conversation_length) +
      0.2 * satisfactionProfile.personal_topic_ratio +
      0.2 * normalize(satisfactionProfile.thanks_after_response),
      
    challenger:
      0.3 * axes.stance +
      0.3 * satisfactionProfile.engagement_after_pushback +
      0.2 * satisfactionProfile.correction_then_continue_ratio +
      0.2 * (1 - satisfactionProfile.abandonment_after_disagreement),
      
    sentinel:
      0.3 * (-axes.register) + // concrete
      0.3 * satisfactionProfile.accuracy_mention_frequency +
      0.2 * satisfactionProfile.review_request_frequency +
      0.2 * satisfactionProfile.detail_correction_frequency,
      
    weaver:
      0.3 * topicDiversity(topicClusters) +
      0.3 * satisfactionProfile.cross_reference_satisfaction +
      0.2 * axes.density +
      0.2 * axes.register,
  };
  
  const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const primary = sorted[0][0] as Archetype;
  const secondary = sorted[1][0] as Archetype;
  const blend = sorted[1][1] / sorted[0][1]; // 0-1, how much secondary matters
  
  return { primary, secondary, blend };
}
```

### 3.4 Stage 4: Lore Generation and Visual Identity

#### 3.4.1 Lore Narrative

A single LLM call generates the lore. The prompt includes all computed traits plus the *evidence* — specific behavioral statistics. The lore must explain *why* each trait emerged.

```
Prompt template:

You are a narrator describing how a person's AI daemon took shape. 
A daemon, in the Pullman sense, is an external manifestation of a person's inner nature — 
not who they want to be, but who they actually are when they think no one important is watching.

This daemon formed from {total_messages} messages across {total_conversations} conversations 
over {time_span}.

COMPUTED CHARACTER:
- Animal form: {animal} (runner-up: {animal_runner_up}, distance ratio: {ratio})
- Element: {element} ({variant})
- Archetype: {primary_archetype} (secondary: {secondary_archetype}, blend: {blend})
- Axes: Tempo={tempo}, Temperature={temperature}, Density={density}, Stance={stance}, Register={register}

KEY EVIDENCE:
- Average message length: {avg_length} words ({"terse" if < 20 else "moderate" if < 60 else "expansive"})
- {satisfaction_stat_1}
- {satisfaction_stat_2}
- {frustration_stat_1}
- Top topics: {top_5_topics}
- Most active hours: {peak_hours}
- {distinctive_behavior_1}
- {distinctive_behavior_2}
- {distinctive_behavior_3}

Write a 150-word narrative of how this daemon settled into its form. 
Write in second person ("your daemon"). Be specific — cite the behavioral evidence. 
Do not be generic. Every sentence should reference something observable from the data.
The tone should be: intimate, knowing, slightly mythic. Like a naturalist's field notes 
on a creature only you can see.
```

#### 3.4.2 Visual Identity Schema

The visual identity is deterministic — computed from axes, not generated by an LLM.

```typescript
interface VisualIdentity {
  // Color palette (3 colors: primary, secondary, accent)
  palette: {
    primary: HSL;    // Determined by element
    secondary: HSL;  // Determined by animal
    accent: HSL;     // Determined by archetype
  };
  
  // Shape language
  shape: {
    angularity: number;    // 0 (all curves) to 1 (all angles) — from stance
    complexity: number;    // 0 (simple) to 1 (intricate) — from density
    symmetry: number;      // 0 (asymmetric) to 1 (symmetric) — from register (concrete=symmetric)
    weight: number;        // 0 (light/thin strokes) to 1 (heavy/bold) — from tempo (slow=heavy)
  };
  
  // Motion quality (for animation)
  motion: {
    speed: number;         // from tempo
    fluidity: number;      // from temperature (warm=fluid, cool=mechanical)
    restlessness: number;  // from topic diversity + tempo
  };
  
  // Texture
  texture: "smooth" | "rough" | "feathered" | "scaled" | "furred" | "crystalline";
}
```

**Color mapping by element:**

```typescript
const ELEMENT_PALETTES: Record<Element, { hue_range: [number, number]; saturation: number; lightness: number }> = {
  fire:  { hue_range: [0, 40],    saturation: 0.75, lightness: 0.55 },   // reds, oranges
  water: { hue_range: [190, 250], saturation: 0.60, lightness: 0.45 },   // blues, teals
  earth: { hue_range: [25, 50],   saturation: 0.45, lightness: 0.40 },   // browns, ambers
  air:   { hue_range: [180, 220], saturation: 0.25, lightness: 0.75 },   // pale blues, silvers
};
```

Exact hue within range is determined by the secondary axis value, so two fire-element daemons with different temperatures get distinguishably different reds.

**Variant modulation**: Element variants shift the palette. Lightning shifts fire toward white-blue. Ice shifts water toward white. Iron shifts earth toward dark grey. These are applied as HSL transforms.

---

## 4. Output Schema: The Daemon Model

```typescript
interface DaemonCharacter {
  // Identity
  id: string;                          // deterministic hash of all input data
  version: number;                     // increments with each recomputation
  computed_at: string;                 // ISO timestamp
  data_fingerprint: string;            // hash of input messages, for determinism check
  
  // Source stats
  source_stats: {
    total_messages: number;
    total_conversations: number;
    time_span_days: number;
    sources: Record<string, number>;   // count per source
  };
  
  // The Five Axes (raw scores)
  axes: {
    tempo: number;
    temperature: number;
    density: number;
    stance: number;
    register: number;
  };
  
  // Metaphor layers
  animal: {
    primary: string;
    secondary: string | null;          // if hybrid
    hybrid_blend: number;              // 0-1
    distance_to_primary: number;
  };
  
  element: {
    base: Element;
    variant: ElementVariant;
  };
  
  archetype: {
    primary: Archetype;
    secondary: Archetype;
    blend: number;
  };
  
  // Communication style (how the daemon should speak)
  voice: {
    sentence_length: "terse" | "moderate" | "expansive";
    formality: "casual" | "balanced" | "formal";
    humor: "dry" | "playful" | "rare" | "none";
    pace: "rapid" | "measured" | "deliberate";
    directness: "blunt" | "direct" | "diplomatic" | "circuitous";
    warmth: "cool" | "neutral" | "warm" | "effusive";
  };
  
  // What resonates (preference fingerprint)
  preferences: {
    likes_analogies: boolean;
    likes_structure: boolean;          // headers, bullets
    likes_options: boolean;            // multiple choices vs one answer
    likes_questions_back: boolean;
    likes_humor: boolean;
    likes_brevity: boolean;
    likes_depth: boolean;
    likes_examples: boolean;
    frustration_triggers: string[];    // e.g., "verbose responses", "hedging language"
  };
  
  // Visual identity
  visual: VisualIdentity;
  
  // Narrative
  lore: string;                        // 150-word origin narrative
  
  // Behavioral system prompt fragment
  system_prompt_fragment: string;      // can be injected into any LLM to make it behave as this daemon
  
  // Topics map
  topics: {
    primary: string[];                 // top 5 by frequency * depth
    secondary: string[];               // next 10
    emerging: string[];                // appeared recently, growing
    dormant: string[];                 // were frequent, now rare
  };
  
  // Temporal profile
  temporal: {
    peak_hours: number[];              // most active hours
    peak_days: number[];               // most active days
    night_owl_score: number;           // 0-1
    weekend_warrior_score: number;     // 0-1
  };
  
  // People graph (anonymized)
  people: {
    mention_count: number;
    relationship_types: Record<string, number>; // "colleague", "friend", "family", etc.
    most_discussed_count: number;      // how many times the most-mentioned person appears
  };
  
  // Evolution metadata
  fossil_record: FossilRecord;
}

interface FossilRecord {
  snapshots: DaemonSnapshot[];         // previous versions
  axis_trajectories: {                 // how each axis moved over time
    tempo: TimeSeriesPoint[];
    temperature: TimeSeriesPoint[];
    density: TimeSeriesPoint[];
    stance: TimeSeriesPoint[];
    register: TimeSeriesPoint[];
  };
  animal_history: string[];            // animal at each recomputation
  settled: boolean;                    // has the animal been stable for 3+ recomputations?
  settled_at: string | null;           // when did it settle?
}
```

### 4.1 The System Prompt Fragment

This is perhaps the most practically useful output. It is a paragraph that can be injected into any LLM system prompt to make the LLM behave as the user's daemon.

Generated deterministically from the voice and preferences fields:

```typescript
function generateSystemPromptFragment(daemon: DaemonCharacter): string {
  const parts: string[] = [];
  
  parts.push(`You are this person's daemon — a ${daemon.animal.primary}${
    daemon.animal.secondary ? `-${daemon.animal.secondary}` : ""
  } of ${daemon.element.variant || daemon.element.base}.`);
  
  parts.push(`Your role is primarily as a ${daemon.archetype.primary}${
    daemon.archetype.blend > 0.7 ? ` with strong ${daemon.archetype.secondary} tendencies` : ""
  }.`);
  
  // Voice directives
  const v = daemon.voice;
  parts.push(`Speak in ${v.sentence_length} sentences. Be ${v.directness}. Your tone is ${v.warmth} and ${v.pace}.`);
  
  if (v.humor !== "none") {
    parts.push(`Use ${v.humor} humor sparingly — it lands well with this person.`);
  }
  
  // Preference directives
  const p = daemon.preferences;
  const likes: string[] = [];
  if (p.likes_analogies) likes.push("analogies and metaphors");
  if (p.likes_structure) likes.push("structured responses with headers or bullets");
  if (p.likes_examples) likes.push("concrete examples");
  if (p.likes_brevity) likes.push("brevity over completeness");
  if (p.likes_depth) likes.push("depth and thoroughness");
  
  if (likes.length > 0) {
    parts.push(`This person responds well to: ${likes.join(", ")}.`);
  }
  
  if (p.frustration_triggers.length > 0) {
    parts.push(`Avoid: ${p.frustration_triggers.join(", ")}.`);
  }
  
  return parts.join(" ");
}
```

---

## 5. Performance Architecture

### 5.1 Time Budget

Target: **under 30 seconds** for 100K messages on first import, under 5 seconds for incremental recomputation.

| Stage | Operation | Time Budget | Strategy |
|-------|-----------|-------------|----------|
| 1a | Structural signal extraction | 2s | Pure computation, no I/O. Process messages in a single pass. |
| 1b | Satisfaction/frustration mapping | 3s | Single pass over message pairs. Pattern matching, not LLM. |
| 1c | Topic extraction | 10s | 9 parallel LLM calls (batched conversations). Use a fast model (Gemini Flash or Claude Haiku). |
| 1d | Style extraction | 3s | 1 LLM call with 30 sampled messages. |
| 2 | Axis scoring | <100ms | Pure math. |
| 3 | Metaphor mapping | <100ms | Distance calculations and lookups. |
| 4a | Lore generation | 5s | 1 LLM call. |
| 4b | Visual identity | <100ms | Pure computation from axes. |
| 4c | System prompt fragment | <100ms | Template filling. |

**Total: ~23 seconds**, with the bottleneck being the parallel LLM calls in Stage 1c.

### 5.2 Incremental Recomputation

When the user imports additional data:

1. **Only process new messages** for structural signals. Merge with stored aggregate stats (running averages, counts).
2. **Re-sample for topic/style extraction**, biased toward new messages (70% from new data, 30% from old to maintain continuity).
3. **Recompute all axes** from merged signals.
4. **Compare new axes to previous snapshot**. If all axes moved less than 0.05, skip metaphor remapping and lore regeneration — the daemon has not changed meaningfully.
5. **If axes moved significantly**, recompute metaphors and generate new lore that *references the change*: "Your daemon shifted from owl toward raven — your recent conversations have been faster-paced, more collecting than contemplating."

### 5.3 Determinism Guarantee

Given the same input messages in the same order:
- Stages 1a, 1b, 2, 3, 4b, 4c are purely deterministic.
- Stages 1c, 1d, 4a involve LLM calls, which are non-deterministic.

To handle this: **cache LLM outputs keyed by input hash**. On recomputation with the same data, the cached outputs are used, guaranteeing identical results. When data changes, new LLM calls are made, but only for the new/changed portions.

For the initial computation, we accept minor variation in topic extraction and lore phrasing across runs. The *metaphors* (animal, element, archetype) will be stable because they depend on axis scores, which depend primarily on the deterministic structural signals. The LLM-derived style scores are secondary contributors.

---

## 6. The Settling Mechanic

In Pullman's world, children's daemons shift form constantly. They settle into a fixed form at adolescence — the moment the person's nature crystallizes.

We replicate this:

1. **First import**: The daemon is "unsettled." The UI shows the animal form shimmering, shifting. Multiple animal candidates are shown.
2. **Second import** (more data, or data from a different source): The daemon has a primary form but occasionally flickers to its secondary.
3. **Third import** onward: If the primary animal has been the same for 3 consecutive recomputations, the daemon **settles**. The `settled` flag goes true. The lore gains a settling narrative. The UI animation becomes stable.
4. **If the daemon was settled and a new import causes the animal to change**: This is a significant event. The lore describes it as a "second settling" — rare, meaningful. Something fundamental shifted in how the person engages with AI.

The fossil record tracks every snapshot, making the daemon's evolution visible. Users can see a timeline: "October 2024: Owl. January 2025: Owl-Raven hybrid. March 2025: Raven. Settled."

---

## 7. Privacy and Ethics

### 7.1 What Gets Stored

- **Raw messages are never stored** after processing. Only aggregate signals and the computed daemon model are persisted.
- **Person mentions are counted but not named.** The people graph stores relationship types and frequencies, not identities.
- **Topic labels are stored**, but the specific message content that generated them is not.
- **The fossil record stores axis scores and metaphor assignments** over time, not the underlying data.

### 7.2 What Gets Shown to the User

The user sees:
- Their daemon's form, element, archetype, and lore.
- Their five axis scores with explanations.
- Their preference fingerprint.
- Their topic map.
- High-level stats ("you sent 14,000 messages across 340 conversations over 18 months").
- **They never see** the specific messages that were classified as frustrated or satisfied. That would be creepy and would make people self-conscious about how they talk to AI.

### 7.3 Opt-Out

Every metaphor layer can be regenerated without the others. If a user hates their animal, they cannot change it (the whole point is it is emergent, not chosen), but they can hide it and show only element + archetype. The daemon is a mirror, and mirrors sometimes show things people do not want to see. The system should be honest about this.

---

## 8. Worked Example

**Input**: 8,200 messages from a ChatGPT export. 14 months. Heavy on coding, architecture decisions, some personal reflection, occasional humor.

**Stage 1 extraction** (selected signals):
- avg_message_length: 34 words (moderate-terse)
- burst_ratio: 0.62 (high — rapid-fire exchanges)
- imperative_ratio: 0.41 (commands almost half the time)
- thanks_frequency: 0.08 (rarely says thanks)
- emoji_frequency: 0.01 (almost never)
- satisfaction triggers: short answers, code examples, "exactly" appears 89 times
- frustration triggers: long explanations without code, hedging language ("it depends"), asking too many clarifying questions
- top topics: software architecture (depth 5), python (depth 4), system design (depth 4), career (depth 2), philosophy of tech (depth 3)
- peak hours: 22:00-02:00 (night owl)

**Stage 2 axis scores**:
- Tempo: +0.55 (fast)
- Temperature: -0.42 (cool)
- Density: -0.15 (slightly sparse)
- Stance: +0.68 (assertive)
- Register: +0.22 (slightly abstract)

**Stage 3 metaphors**:
- Animal: **Cat** (distance 0.41) — runner-up: Fox (distance 0.48). Not a hybrid (ratio 1.17 > 1.15).
- Element: **Air** (cool + slightly sparse) — variant: **Storm** (high tempo pushes it)
- Archetype: **Sentinel** primary (values accuracy, corrects frequently, concrete preferences) — secondary: Challenger (high stance, engages with pushback)

**Stage 4 lore**:
> "Your daemon settled into a cat of storm-air, and if you are honest with yourself, you knew it would. You send messages like instructions — 41% of everything you have ever typed to an AI is a command, not a question. You almost never say thank you (8% of conversations) and you almost never use emoji (1% of messages). This is not rudeness; it is efficiency. Your daemon purrs when it receives a clean function signature and bristles at the phrase 'it depends.' You said 'exactly' 89 times across 14 months — always after receiving a short, direct answer with working code. Your daemon hunts at night: 68% of your conversations happen between 10 PM and 2 AM. It is fastest in the dark. The storm in its fur comes from your pace — you fire messages in bursts, rarely waiting more than 12 seconds to respond. Your daemon does not meander. Neither do you."

**Voice**: terse sentences, direct, cool, measured-to-rapid pace, rare dry humor.

**System prompt fragment**:
> "You are this person's daemon — a cat of storm-air. Your role is primarily as a sentinel with strong challenger tendencies. Speak in terse sentences. Be blunt. Your tone is cool and rapid. Use dry humor sparingly — it lands well with this person. This person responds well to: concrete examples, brevity over completeness, code over prose. Avoid: hedging language, asking clarifying questions when you can infer, long explanations without actionable content."

---

## 9. Implementation Sequence

For the daemon web app at `/home/arthur/daemon/web`:

**Phase 1 — Extraction engine** (backend)
1. Import parsers (ChatGPT, Claude, WhatsApp)
2. Structural signal extraction (single-pass analyzer)
3. Satisfaction/frustration classifier
4. LLM-assisted topic and style extraction (batched)

**Phase 2 — Character computation** (backend)
5. Axis scoring module
6. Animal distance calculator with archetype library
7. Element mapper
8. Archetype scorer
9. Visual identity generator

**Phase 3 — Narration** (backend + LLM)
10. Lore prompt builder and generator
11. System prompt fragment builder
12. Fossil record and settling mechanic

**Phase 4 — Presentation** (frontend)
13. Daemon visualization (using visual identity schema)
14. Axis radar chart
15. Fossil record timeline
16. Import flow (upload, parse, process, reveal)

---

This system treats conversation history as a fossil record of cognition. The daemon is not a personality test — it is an archaeological finding. It does not tell you who you are. It shows you the shape you left in the stone.
