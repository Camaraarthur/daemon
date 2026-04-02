#!/usr/bin/env python3
"""
Knowledge Graph — Structured memory for the daemon.

Instead of just storing raw text vectors, we extract structured knowledge:
- Entities: people, projects, organizations, topics, devices, locations
- Facts: things the daemon knows about entities
- Relationships: how entities connect to each other
- Preferences: user likes/dislikes/habits
- Events: timestamped things that happened

Each piece of knowledge is embedded AND stored with structured metadata,
so the daemon can query both semantically ("what do I know about Arthur's hardware?")
and structurally ("list all people mentioned in the last month").
"""

import json
import hashlib
import subprocess
import os
from datetime import datetime, timezone
from typing import Optional
from pathlib import Path

QDRANT_URL = "http://localhost:6333"
EMBEDDING_MODEL = "gemini-embedding-001"
EMBEDDING_DIM = 3072

# Separate collections for different knowledge types
COLLECTIONS = {
    "daemon_entities": "People, projects, orgs, topics — things with names",
    "daemon_facts": "Specific facts about entities",
    "daemon_events": "Timestamped events and interactions",
    "daemon_preferences": "User preferences, habits, opinions",
    "daemon_conversations": "Conversation summaries (not raw history)",
}


def _get_google_key() -> str:
    vault = os.path.expanduser("~/.secrets/vault.env")
    if os.path.exists(vault):
        with open(vault) as f:
            for line in f:
                if line.startswith("GOOGLE_API_KEY="):
                    return line.split("=", 1)[1].strip().strip('"').strip("'")
    return os.environ.get("GOOGLE_API_KEY", "")


def _get_qdrant():
    from qdrant_client import QdrantClient
    return QdrantClient(url=QDRANT_URL)


def _embed(texts: list[str]) -> list[list[float]]:
    from google import genai
    client = genai.Client(api_key=_get_google_key())
    # Batch in chunks of 100
    all_embeddings = []
    for i in range(0, len(texts), 100):
        batch = texts[i:i+100]
        result = client.models.embed_content(model=EMBEDDING_MODEL, contents=batch)
        all_embeddings.extend([e.values for e in result.embeddings])
    return all_embeddings


def _point_id(text: str) -> int:
    h = hashlib.md5(text.encode()).hexdigest()
    return int(h[:16], 16) & 0x7FFFFFFFFFFFFFFF


def ensure_collections():
    """Create all knowledge collections."""
    from qdrant_client.models import VectorParams, Distance

    client = _get_qdrant()
    existing = [c.name for c in client.get_collections().collections]

    for name, desc in COLLECTIONS.items():
        if name not in existing:
            client.create_collection(
                collection_name=name,
                vectors_config=VectorParams(size=EMBEDDING_DIM, distance=Distance.COSINE),
            )
            print(f"[knowledge] Created '{name}': {desc}")
        else:
            info = client.get_collection(name)
            print(f"[knowledge] '{name}': {info.points_count} entries")


def extract_knowledge_from_text(text: str, source: str = "import") -> dict:
    """Use Claude Haiku to extract structured knowledge from text.

    Returns a dict with entities, facts, preferences, events.
    """
    prompt = f"""Extract structured knowledge from this text. Return ONLY valid JSON, no explanation.

Text:
{text[:3000]}

Return this exact JSON structure (fill in what you find, use empty arrays if nothing):
{{
  "entities": [
    {{"name": "entity name", "type": "person|project|org|topic|device|location", "description": "one line"}}
  ],
  "facts": [
    {{"about": "entity name", "fact": "specific factual statement", "confidence": "high|medium|low"}}
  ],
  "preferences": [
    {{"preference": "what the user likes/dislikes/prefers", "strength": "strong|moderate|weak"}}
  ],
  "events": [
    {{"event": "what happened", "when": "date or relative time if mentioned", "who": ["people involved"]}}
  ],
  "summary": "one sentence summary of the key point of this text"
}}"""

    try:
        result = subprocess.run(
            ["claude", "-p", prompt, "--output-format", "json",
             "--model", "haiku", "--no-session-persistence"],
            capture_output=True, text=True, timeout=30,
        )
        if result.returncode == 0:
            output = json.loads(result.stdout)
            response = output.get("result", "")
            # Extract JSON from response
            import re
            json_match = re.search(r'\{[\s\S]*\}', response)
            if json_match:
                return json.loads(json_match.group())
    except Exception as e:
        print(f"[knowledge] Extraction failed: {e}")

    return {"entities": [], "facts": [], "preferences": [], "events": [], "summary": ""}


def store_entity(name: str, entity_type: str, description: str, source: str = "import"):
    """Store an entity in the knowledge graph."""
    from qdrant_client.models import PointStruct

    client = _get_qdrant()
    text = f"{name}: {description}"
    vectors = _embed([text])

    client.upsert(
        collection_name="daemon_entities",
        points=[PointStruct(
            id=_point_id(f"entity:{name}"),
            vector=vectors[0],
            payload={
                "name": name,
                "type": entity_type,
                "description": description,
                "source": source,
                "created_at": datetime.now(timezone.utc).isoformat(),
                "mention_count": 1,
            },
        )],
    )


def store_fact(about: str, fact: str, confidence: str = "medium", source: str = "import"):
    """Store a fact about an entity."""
    from qdrant_client.models import PointStruct

    client = _get_qdrant()
    text = f"About {about}: {fact}"
    vectors = _embed([text])

    client.upsert(
        collection_name="daemon_facts",
        points=[PointStruct(
            id=_point_id(f"fact:{about}:{fact}"),
            vector=vectors[0],
            payload={
                "about": about,
                "fact": fact,
                "confidence": confidence,
                "source": source,
                "created_at": datetime.now(timezone.utc).isoformat(),
            },
        )],
    )


def store_preference(preference: str, strength: str = "moderate", source: str = "import"):
    """Store a user preference."""
    from qdrant_client.models import PointStruct

    client = _get_qdrant()
    vectors = _embed([preference])

    client.upsert(
        collection_name="daemon_preferences",
        points=[PointStruct(
            id=_point_id(f"pref:{preference}"),
            vector=vectors[0],
            payload={
                "preference": preference,
                "strength": strength,
                "source": source,
                "created_at": datetime.now(timezone.utc).isoformat(),
            },
        )],
    )


def store_event(event: str, when: str = "", who: list = None, source: str = "import"):
    """Store a timestamped event."""
    from qdrant_client.models import PointStruct

    client = _get_qdrant()
    text = f"Event: {event}" + (f" ({when})" if when else "")
    vectors = _embed([text])

    client.upsert(
        collection_name="daemon_events",
        points=[PointStruct(
            id=_point_id(f"event:{event}"),
            vector=vectors[0],
            payload={
                "event": event,
                "when": when,
                "who": who or [],
                "source": source,
                "created_at": datetime.now(timezone.utc).isoformat(),
            },
        )],
    )


def store_conversation_summary(summary: str, user_msg: str, daemon_msg: str, source: str = "daemon"):
    """Store a conversation summary."""
    from qdrant_client.models import PointStruct

    client = _get_qdrant()
    vectors = _embed([summary])

    client.upsert(
        collection_name="daemon_conversations",
        points=[PointStruct(
            id=_point_id(f"conv:{summary}"),
            vector=vectors[0],
            payload={
                "summary": summary,
                "user_excerpt": user_msg[:300],
                "daemon_excerpt": daemon_msg[:300],
                "source": source,
                "created_at": datetime.now(timezone.utc).isoformat(),
            },
        )],
    )


def ingest_conversation_batch(messages: list[dict], source: str = "import", batch_size: int = 5):
    """Ingest a batch of conversation messages into the knowledge graph.

    Groups messages into chunks, extracts knowledge from each chunk,
    and stores entities/facts/preferences/events.
    """
    total_entities = 0
    total_facts = 0
    total_prefs = 0
    total_events = 0

    # Process in chunks
    for i in range(0, len(messages), batch_size):
        chunk = messages[i:i+batch_size]
        # Combine into one text block
        text_block = "\n".join(
            f"{'User' if m.get('role') == 'user' else m.get('sender', 'Other')}: {m['content'][:500]}"
            for m in chunk if m.get("content")
        )

        if len(text_block) < 50:
            continue

        # Extract knowledge
        knowledge = extract_knowledge_from_text(text_block, source=source)

        # Store entities
        for entity in knowledge.get("entities", []):
            try:
                store_entity(entity["name"], entity.get("type", "topic"),
                           entity.get("description", ""), source=source)
                total_entities += 1
            except Exception as e:
                print(f"[knowledge] Entity store failed: {e}")

        # Store facts
        for fact in knowledge.get("facts", []):
            try:
                store_fact(fact["about"], fact["fact"],
                         fact.get("confidence", "medium"), source=source)
                total_facts += 1
            except Exception as e:
                print(f"[knowledge] Fact store failed: {e}")

        # Store preferences
        for pref in knowledge.get("preferences", []):
            try:
                store_preference(pref["preference"],
                               pref.get("strength", "moderate"), source=source)
                total_prefs += 1
            except Exception as e:
                print(f"[knowledge] Pref store failed: {e}")

        # Store events
        for event in knowledge.get("events", []):
            try:
                store_event(event["event"], event.get("when", ""),
                          event.get("who", []), source=source)
                total_events += 1
            except Exception as e:
                print(f"[knowledge] Event store failed: {e}")

        # Store conversation summary
        if knowledge.get("summary"):
            try:
                store_conversation_summary(
                    knowledge["summary"],
                    chunk[0].get("content", "")[:300] if chunk else "",
                    chunk[-1].get("content", "")[:300] if chunk else "",
                    source=source,
                )
            except Exception:
                pass

        progress = min(i + batch_size, len(messages))
        print(f"[knowledge] Processed {progress}/{len(messages)} messages "
              f"(+{total_entities}E +{total_facts}F +{total_prefs}P +{total_events}Ev)")

    return {
        "entities": total_entities,
        "facts": total_facts,
        "preferences": total_prefs,
        "events": total_events,
        "messages_processed": len(messages),
    }


def recall_knowledge(query: str, limit: int = 10) -> dict:
    """Search across ALL knowledge collections for relevant info.

    Returns structured knowledge organized by type.
    """
    vectors = _embed([query])
    client = _get_qdrant()
    results = {}

    for collection in COLLECTIONS:
        try:
            hits = client.query_points(
                collection_name=collection,
                query=vectors[0],
                limit=limit,
                with_payload=True,
            )
            if hits.points:
                results[collection] = [
                    {**p.payload, "score": p.score}
                    for p in hits.points
                    if p.score > 0.4  # relevance threshold
                ]
        except Exception:
            pass

    return results


def build_knowledge_context(query: str, limit: int = 5) -> str:
    """Build a knowledge context block for the daemon's system prompt.

    Called before each turn — retrieves relevant knowledge across all types.
    """
    knowledge = recall_knowledge(query, limit=limit)

    if not any(knowledge.values()):
        return ""

    sections = []

    entities = knowledge.get("daemon_entities", [])
    if entities:
        lines = [f"- {e['name']} ({e.get('type','')}) — {e.get('description','')}" for e in entities[:5]]
        sections.append("**Known entities:**\n" + "\n".join(lines))

    facts = knowledge.get("daemon_facts", [])
    if facts:
        lines = [f"- About {f['about']}: {f['fact']}" for f in facts[:5]]
        sections.append("**Relevant facts:**\n" + "\n".join(lines))

    prefs = knowledge.get("daemon_preferences", [])
    if prefs:
        lines = [f"- {p['preference']} (strength: {p.get('strength','')})" for p in prefs[:3]]
        sections.append("**User preferences:**\n" + "\n".join(lines))

    events = knowledge.get("daemon_events", [])
    if events:
        lines = [f"- {e['event']}" + (f" ({e['when']})" if e.get('when') else "") for e in events[:3]]
        sections.append("**Recent events:**\n" + "\n".join(lines))

    convos = knowledge.get("daemon_conversations", [])
    if convos:
        lines = [f"- {c['summary']}" for c in convos[:3]]
        sections.append("**Related past conversations:**\n" + "\n".join(lines))

    if sections:
        return "## Knowledge (from long-term memory)\n\n" + "\n\n".join(sections)
    return ""


def get_knowledge_stats() -> dict:
    """Get stats across all knowledge collections."""
    client = _get_qdrant()
    stats = {}
    for name in COLLECTIONS:
        try:
            info = client.get_collection(name)
            stats[name] = info.points_count
        except Exception:
            stats[name] = 0
    return stats


if __name__ == "__main__":
    print("[knowledge] Initializing collections...")
    ensure_collections()

    print("\n[knowledge] Storing test knowledge...")
    store_entity("Arthur Camara", "person", "Founder of Daemon. Builder. Based in Paris. 23 years old.")
    store_entity("Daemon", "project", "Personal AI agent hardware+software. Orange Pi 3B + custom HAT.")
    store_entity("Kleo", "person", "Character writer for Daemon. Working on voice bible and settling spectrum.")
    store_entity("CRA", "org", "Carlo Ratti Associati — Arthur's employer, architecture/design firm in Turin.")

    store_fact("Arthur", "Prefers direct, concise responses — no hedging", "high")
    store_fact("Arthur", "Works across arturito (server), MSI (laptop), Pixel (phone) via Tailscale", "high")
    store_fact("Daemon", "V1 HAT has 160 components designed for Orange Pi 3B", "high")
    store_fact("Daemon", "Software-first strategy: web app now, Kickstarter later", "high")

    store_preference("Short responses, no trailing summaries", "strong")
    store_preference("Always use latest Gemini models (Gemini 3)", "strong")
    store_preference("Never invent data — ask or search if unknown", "strong")

    store_event("Daemon BMC v5 completed and stress-tested", "2026-03-27", ["Arthur"])
    store_event("Daemon MVP architecture planned", "2026-03-27", ["Arthur"])
    store_event("daemon.page domain configured with Cloudflare tunnel", "2026-03-28", ["Arthur"])

    print("\n[knowledge] Testing recall...")
    results = recall_knowledge("What hardware is daemon using?")
    for collection, items in results.items():
        if items:
            print(f"\n  {collection}:")
            for item in items[:3]:
                payload_str = json.dumps({k: v for k, v in item.items() if k != 'score'}, default=str)[:150]
                print(f"    [{item['score']:.2f}] {payload_str}")

    print(f"\n[knowledge] Stats: {get_knowledge_stats()}")
