#!/usr/bin/env python3
"""
Memory Engine — Long-term daemon memory using Qdrant + Gemini embeddings.
MemGPT-style: the daemon stores, retrieves, and forgets memories.
Every important interaction gets embedded and stored.
On each turn, relevant memories are retrieved to enrich context.
"""

import json
import os
import hashlib
from datetime import datetime, timezone
from typing import Optional
from pathlib import Path

QDRANT_URL = "http://localhost:6333"
COLLECTION_NAME = "daemon_memory"
EMBEDDING_MODEL = "gemini-embedding-001"
EMBEDDING_DIM = 3072


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
    """Embed texts using Gemini."""
    from google import genai

    key = _get_google_key()
    client = genai.Client(api_key=key)

    result = client.models.embed_content(
        model=EMBEDDING_MODEL,
        contents=texts,
    )
    return [e.values for e in result.embeddings]


def ensure_collection():
    """Create the daemon memory collection if it doesn't exist."""
    from qdrant_client.models import VectorParams, Distance

    client = _get_qdrant()
    collections = [c.name for c in client.get_collections().collections]

    if COLLECTION_NAME not in collections:
        client.create_collection(
            collection_name=COLLECTION_NAME,
            vectors_config=VectorParams(
                size=EMBEDDING_DIM,
                distance=Distance.COSINE,
            ),
        )
        print(f"[memory] Created collection '{COLLECTION_NAME}' (dim={EMBEDDING_DIM})")
    else:
        info = client.get_collection(COLLECTION_NAME)
        print(f"[memory] Collection '{COLLECTION_NAME}': {info.points_count} memories")


def store_memory(
    content: str,
    memory_type: str = "conversation",
    source: str = "daemon",
    metadata: Optional[dict] = None,
) -> str:
    """Store a memory in the vector database.

    Args:
        content: The text to remember
        memory_type: "conversation", "fact", "preference", "event", "imported"
        source: Where this memory came from ("daemon", "chatgpt_import", "user", etc.)
        metadata: Additional metadata

    Returns:
        The point ID
    """
    from qdrant_client.models import PointStruct

    client = _get_qdrant()

    # Generate a deterministic ID from content hash
    content_hash = hashlib.md5(content.encode()).hexdigest()
    point_id = int(content_hash[:16], 16) & 0x7FFFFFFFFFFFFFFF  # Positive int64

    # Embed the content
    vectors = _embed([content])

    payload = {
        "content": content,
        "type": memory_type,
        "source": source,
        "created_at": datetime.now(timezone.utc).isoformat(),
        **(metadata or {}),
    }

    client.upsert(
        collection_name=COLLECTION_NAME,
        points=[
            PointStruct(
                id=point_id,
                vector=vectors[0],
                payload=payload,
            )
        ],
    )

    return str(point_id)


def recall(query: str, limit: int = 10, memory_type: Optional[str] = None) -> list[dict]:
    """Retrieve relevant memories for a query.

    Args:
        query: What to search for (semantic search)
        limit: Max memories to return
        memory_type: Filter by type (optional)

    Returns:
        List of memory dicts with content, type, source, score
    """
    from qdrant_client.models import Filter, FieldCondition, MatchValue

    client = _get_qdrant()

    # Embed the query
    vectors = _embed([query])

    # Build filter
    query_filter = None
    if memory_type:
        query_filter = Filter(
            must=[FieldCondition(key="type", match=MatchValue(value=memory_type))]
        )

    results = client.query_points(
        collection_name=COLLECTION_NAME,
        query=vectors[0],
        limit=limit,
        query_filter=query_filter,
        with_payload=True,
    )

    memories = []
    for point in results.points:
        memories.append({
            "content": point.payload.get("content", ""),
            "type": point.payload.get("type", ""),
            "source": point.payload.get("source", ""),
            "created_at": point.payload.get("created_at", ""),
            "score": point.score,
        })

    return memories


def store_conversation_turn(user_msg: str, daemon_response: str, daemon_name: str = "daemon"):
    """Store a conversation turn as a memory.

    Only stores if the content seems worth remembering (not just greetings).
    """
    # Skip trivial messages
    if len(user_msg) < 20 and len(daemon_response) < 50:
        return

    # Combine user + daemon for context
    combined = f"User said: {user_msg[:500]}\n{daemon_name} responded: {daemon_response[:500]}"

    store_memory(
        content=combined,
        memory_type="conversation",
        source="daemon",
        metadata={
            "user_message": user_msg[:500],
            "daemon_response": daemon_response[:200],
        },
    )


def store_fact(fact: str, source: str = "daemon"):
    """Store a fact about the user."""
    store_memory(content=fact, memory_type="fact", source=source)


def store_preference(preference: str):
    """Store a user preference."""
    store_memory(content=preference, memory_type="preference", source="user")


def import_memories(highlights: list[str], source: str = "import"):
    """Bulk import memory highlights from an external source (ChatGPT, etc.)."""
    if not highlights:
        return 0

    # Batch embed
    vectors = _embed(highlights)

    from qdrant_client.models import PointStruct

    client = _get_qdrant()
    points = []
    for i, (text, vec) in enumerate(zip(highlights, vectors)):
        content_hash = hashlib.md5(text.encode()).hexdigest()
        point_id = int(content_hash[:16], 16) & 0x7FFFFFFFFFFFFFFF

        points.append(PointStruct(
            id=point_id,
            vector=vec,
            payload={
                "content": text,
                "type": "imported",
                "source": source,
                "created_at": datetime.now(timezone.utc).isoformat(),
            },
        ))

    # Upsert in batches of 100
    for i in range(0, len(points), 100):
        batch = points[i:i+100]
        client.upsert(collection_name=COLLECTION_NAME, points=batch)

    return len(points)


def build_memory_context(user_message: str, limit: int = 5) -> str:
    """Build a memory context block for the system prompt.

    Called before each daemon turn to retrieve relevant memories.
    """
    memories = recall(user_message, limit=limit)
    if not memories:
        return ""

    lines = ["## Relevant Memories (from past interactions)"]
    for m in memories:
        score_pct = int(m["score"] * 100)
        lines.append(f"- [{m['type']}] {m['content'][:200]} (relevance: {score_pct}%)")

    return "\n".join(lines)


def get_memory_stats() -> dict:
    """Get memory collection stats."""
    client = _get_qdrant()
    try:
        info = client.get_collection(COLLECTION_NAME)
        return {
            "total_memories": info.points_count,
            "status": info.status.value,
        }
    except Exception:
        return {"total_memories": 0, "status": "not_initialized"}


if __name__ == "__main__":
    """Test memory engine."""
    print("[memory] Ensuring collection exists...")
    ensure_collection()

    print("\n[memory] Storing test memories...")
    store_fact("Arthur is building a hardware AI companion called Daemon")
    store_fact("Arthur works from Paris and manages devices via Tailscale")
    store_preference("Arthur prefers direct, concise responses")
    store_conversation_turn(
        "What's the status of the daemon PCB?",
        "The V1 HAT has 160 components, designed for Orange Pi 3B. Migration from Radxa complete.",
    )

    print("\n[memory] Recalling...")
    results = recall("daemon hardware status")
    for m in results:
        print(f"  [{m['type']}] {m['content'][:100]}... (score: {m['score']:.3f})")

    print(f"\n[memory] Stats: {get_memory_stats()}")
