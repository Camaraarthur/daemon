#!/usr/bin/env python3
"""
embed_conversations.py — Embed conversation memories + important messages into Qdrant.

Two collections:
- `daemon_memory`: Conversation-level summaries (TLDRs, facts, decisions)
- `daemon_messages`: Individual important messages (>200 chars, not tool output)

Usage:
  python3 embed_conversations.py                     # Embed all unembedded entries
  python3 embed_conversations.py --dry-run 5         # Preview first 5
  python3 embed_conversations.py --rebuild            # Rebuild collections from scratch
  python3 embed_conversations.py --messages-only      # Only embed individual messages
  python3 embed_conversations.py --memories-only      # Only embed conversation summaries
"""

import os
import sys
import json
import time
import sqlite3
import argparse
import urllib.request
from pathlib import Path
from typing import Optional

from qdrant_client import QdrantClient
from qdrant_client.models import (
    Distance, VectorParams, PointStruct,
    Filter, FieldCondition, MatchValue,
)

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

DB_PATH = os.path.join(os.path.dirname(__file__), "..", "data", "users.db")
QDRANT_URL = "http://localhost:6333"

EMBEDDING_MODEL = "gemini-embedding-001"
EMBEDDING_DIM = 768

COLLECTION_MEMORY = "daemon_memory"
COLLECTION_MESSAGES = "daemon_messages"

BATCH_SIZE = 20  # Texts per embedding API call
API_DELAY = 0.5  # Seconds between batches

# ---------------------------------------------------------------------------
# API key
# ---------------------------------------------------------------------------

def load_api_key() -> str:
    """Load a working Google API key from vault. Tries GOOGLE_API_KEY_ARTHUR first."""
    vault_path = os.path.expanduser("~/.secrets/vault.env")
    keys = {}
    with open(vault_path) as f:
        for line in f:
            line = line.strip()
            if line.startswith("GOOGLE_API_KEY") and "=" in line and not line.startswith("#"):
                name, val = line.split("=", 1)
                keys[name.strip()] = val.strip().strip('"').strip("'")
    for key_name in ("GOOGLE_API_KEY_ARTHUR", "GOOGLE_API_KEY_CRA_FREE", "GOOGLE_API_KEY"):
        if key_name in keys and keys[key_name]:
            return keys[key_name]
    raise ValueError("No GOOGLE_API_KEY found in vault.env")

# ---------------------------------------------------------------------------
# Gemini embeddings (same pattern as file-search)
# ---------------------------------------------------------------------------

def embed_batch(texts: list[str], api_key: str, task_type: str = "RETRIEVAL_DOCUMENT") -> list[list[float]]:
    """Embed a batch of texts using Gemini text-embedding-004."""
    url = (
        f"https://generativelanguage.googleapis.com/v1beta/models/"
        f"{EMBEDDING_MODEL}:batchEmbedContents?key={api_key}"
    )

    requests_body = []
    for text in texts:
        requests_body.append({
            "model": f"models/{EMBEDDING_MODEL}",
            "content": {"parts": [{"text": text[:8000]}]},
            "taskType": task_type,
            "outputDimensionality": EMBEDDING_DIM,
        })

    data = json.dumps({"requests": requests_body}).encode()
    req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"})

    with urllib.request.urlopen(req, timeout=60) as resp:
        result = json.loads(resp.read())

    if "embeddings" not in result:
        raise ValueError(f"Embedding failed: {json.dumps(result)[:500]}")

    return [e["values"] for e in result["embeddings"]]


def embed_single(text: str, api_key: str, task_type: str = "RETRIEVAL_QUERY") -> list[float]:
    """Embed a single text (for queries)."""
    url = (
        f"https://generativelanguage.googleapis.com/v1beta/models/"
        f"{EMBEDDING_MODEL}:embedContent?key={api_key}"
    )

    payload = {
        "content": {"parts": [{"text": text[:8000]}]},
        "taskType": task_type,
        "outputDimensionality": EMBEDDING_DIM,
    }

    data = json.dumps(payload).encode()
    req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"})

    with urllib.request.urlopen(req, timeout=30) as resp:
        result = json.loads(resp.read())

    return result["embedding"]["values"]

# ---------------------------------------------------------------------------
# Database
# ---------------------------------------------------------------------------

def get_db() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

# ---------------------------------------------------------------------------
# Qdrant setup
# ---------------------------------------------------------------------------

def get_qdrant() -> QdrantClient:
    return QdrantClient(url=QDRANT_URL, timeout=30)

def ensure_collection(client: QdrantClient, name: str):
    """Create collection if it doesn't exist."""
    collections = [c.name for c in client.get_collections().collections]
    if name not in collections:
        client.create_collection(
            collection_name=name,
            vectors_config=VectorParams(
                size=EMBEDDING_DIM,
                distance=Distance.COSINE,
            ),
        )
        print(f"  Created Qdrant collection: {name}")
    else:
        print(f"  Collection exists: {name}")

# ---------------------------------------------------------------------------
# Embed conversation memories
# ---------------------------------------------------------------------------

def build_memory_text(row: dict) -> str:
    """Build the text to embed for a conversation memory entry."""
    tldr = row["tldr"]
    facts = json.loads(row["key_facts"] or "[]")
    decisions = json.loads(row["key_decisions"] or "[]")
    problems = json.loads(row["problems"] or "[]")
    solutions = json.loads(row["solutions"] or "[]")
    tags = json.loads(row["tags"] or "[]")

    parts = [tldr]
    if facts:
        parts.append(f"Key facts: {'; '.join(facts)}")
    if decisions:
        parts.append(f"Decisions: {'; '.join(decisions)}")
    if problems:
        parts.append(f"Problems: {'; '.join(problems)}")
    if solutions:
        parts.append(f"Solutions: {'; '.join(solutions)}")
    if tags:
        parts.append(f"Tags: {', '.join(tags)}")

    return "\n\n".join(parts)

def embed_memories(conn: sqlite3.Connection, client: QdrantClient, api_key: str,
                   dry_run: int = 0, rebuild: bool = False):
    """Embed conversation_memory entries into Qdrant."""
    print("\n[memories] Loading conversation memories...")

    if rebuild:
        rows = conn.execute("""
            SELECT cm.*, t.title as thread_title
            FROM conversation_memory cm
            LEFT JOIN chat_threads t ON t.id = cm.thread_id
            ORDER BY cm.created_at ASC
        """).fetchall()
    else:
        # Get existing point IDs from Qdrant to skip
        existing_thread_ids = set()
        try:
            # Scroll through all points to get thread_ids
            offset = None
            while True:
                result = client.scroll(
                    collection_name=COLLECTION_MEMORY,
                    limit=100,
                    offset=offset,
                    with_payload=True,
                    with_vectors=False,
                )
                points, next_offset = result
                for p in points:
                    if p.payload and "thread_id" in p.payload:
                        existing_thread_ids.add(p.payload["thread_id"])
                if next_offset is None:
                    break
                offset = next_offset
        except Exception:
            pass  # Collection might be empty

        rows = conn.execute("""
            SELECT cm.*, t.title as thread_title
            FROM conversation_memory cm
            LEFT JOIN chat_threads t ON t.id = cm.thread_id
            ORDER BY cm.created_at ASC
        """).fetchall()

        # Filter out already-embedded
        rows = [r for r in rows if r["thread_id"] not in existing_thread_ids]

    rows = [dict(r) for r in rows]
    print(f"  Found {len(rows)} memories to embed")

    if dry_run:
        rows = rows[:dry_run]
        print(f"  [DRY RUN] Processing {len(rows)}")

    if not rows:
        return

    # Embed in batches
    points = []
    failed = 0

    for i in range(0, len(rows), BATCH_SIZE):
        batch = rows[i:i + BATCH_SIZE]
        texts = [build_memory_text(r) for r in batch]

        try:
            vectors = embed_batch(texts, api_key)

            for row, vec in zip(batch, vectors):
                tags = json.loads(row["tags"] or "[]")
                point = PointStruct(
                    id=row["id"],  # Use the SQLite auto-increment ID
                    vector=vec,
                    payload={
                        "thread_id": row["thread_id"],
                        "project_id": row["project_id"],
                        "user_id": row["user_id"],
                        "tldr": row["tldr"],
                        "tags": tags,
                        "thread_title": row.get("thread_title", ""),
                        "created_at": row["created_at"],
                        "type": "conversation_memory",
                    }
                )
                points.append(point)

        except Exception as e:
            err = str(e)
            if "429" in err:
                print(f"\n  Rate limited, waiting 30s...")
                time.sleep(30)
                continue
            print(f"\n  Batch error at {i}: {err[:100]}")
            failed += len(batch)

        done = min(i + BATCH_SIZE, len(rows))
        print(f"\r  Embedded: {done}/{len(rows)} ({failed} failed)", end="", flush=True)
        time.sleep(API_DELAY)

    print()

    if points and not dry_run:
        # Upsert in chunks of 100
        for i in range(0, len(points), 100):
            chunk = points[i:i + 100]
            client.upsert(collection_name=COLLECTION_MEMORY, points=chunk)
        print(f"  Stored {len(points)} points in {COLLECTION_MEMORY}")
    elif dry_run:
        print(f"  [DRY RUN] Would store {len(points)} points")

# ---------------------------------------------------------------------------
# Embed individual important messages
# ---------------------------------------------------------------------------

def embed_messages(conn: sqlite3.Connection, client: QdrantClient, api_key: str,
                   dry_run: int = 0, rebuild: bool = False):
    """Embed important individual messages into Qdrant."""
    print("\n[messages] Loading important messages...")

    # Important messages: >200 chars, not tool output, have actual content
    rows = conn.execute("""
        SELECT m.id, m.thread_id, m.role, m.content, m.created_at,
               t.project_id, t.user_id, t.title as thread_title
        FROM chat_messages m
        JOIN chat_threads t ON t.id = m.thread_id
        WHERE m.content IS NOT NULL
          AND LENGTH(m.content) > 200
          AND m.tool_call_id IS NULL
          AND m.role IN ('user', 'assistant')
        ORDER BY m.created_at ASC
    """).fetchall()
    rows = [dict(r) for r in rows]

    if not rebuild:
        # Get existing message IDs from Qdrant
        existing_ids = set()
        try:
            offset = None
            while True:
                result = client.scroll(
                    collection_name=COLLECTION_MESSAGES,
                    limit=100,
                    offset=offset,
                    with_payload=True,
                    with_vectors=False,
                )
                points, next_offset = result
                for p in points:
                    if p.payload and "message_id" in p.payload:
                        existing_ids.add(p.payload["message_id"])
                if next_offset is None:
                    break
                offset = next_offset
        except Exception:
            pass

        rows = [r for r in rows if r["id"] not in existing_ids]

    print(f"  Found {len(rows)} important messages to embed")

    if dry_run:
        rows = rows[:dry_run]
        print(f"  [DRY RUN] Processing {len(rows)}")

    if not rows:
        return

    # Build texts: role + content, truncated
    texts_and_rows = []
    for row in rows:
        content = row["content"][:4000]
        role_label = "User" if row["role"] == "user" else "Assistant"
        text = f"{role_label}: {content}"
        texts_and_rows.append((text, row))

    # Embed in batches
    points = []
    failed = 0
    point_id = 1  # Qdrant needs integer or UUID IDs

    # Get max existing ID
    try:
        info = client.get_collection(COLLECTION_MESSAGES)
        point_id = info.points_count + 1
    except Exception:
        point_id = 1

    for i in range(0, len(texts_and_rows), BATCH_SIZE):
        batch = texts_and_rows[i:i + BATCH_SIZE]
        texts = [t for t, _ in batch]

        try:
            vectors = embed_batch(texts, api_key)

            for (_, row), vec in zip(batch, vectors):
                point = PointStruct(
                    id=point_id,
                    vector=vec,
                    payload={
                        "message_id": row["id"],
                        "thread_id": row["thread_id"],
                        "project_id": row["project_id"],
                        "user_id": row["user_id"],
                        "role": row["role"],
                        "content": row["content"][:2000],  # Store truncated for display
                        "thread_title": row.get("thread_title", ""),
                        "created_at": row["created_at"],
                        "type": "message",
                    }
                )
                points.append(point)
                point_id += 1

        except Exception as e:
            err = str(e)
            if "429" in err:
                print(f"\n  Rate limited, waiting 30s...")
                time.sleep(30)
                continue
            print(f"\n  Batch error at {i}: {err[:100]}")
            failed += len(batch)

        done = min(i + BATCH_SIZE, len(texts_and_rows))
        print(f"\r  Embedded: {done}/{len(texts_and_rows)} ({failed} failed)", end="", flush=True)
        time.sleep(API_DELAY)

    print()

    if points and not dry_run:
        for i in range(0, len(points), 100):
            chunk = points[i:i + 100]
            client.upsert(collection_name=COLLECTION_MESSAGES, points=chunk)
        print(f"  Stored {len(points)} points in {COLLECTION_MESSAGES}")
    elif dry_run:
        print(f"  [DRY RUN] Would store {len(points)} points")

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="Embed conversation memories into Qdrant")
    parser.add_argument("--dry-run", type=int, metavar="N", default=0,
                        help="Process only N entries without storing")
    parser.add_argument("--rebuild", action="store_true",
                        help="Rebuild collections from scratch")
    parser.add_argument("--memories-only", action="store_true",
                        help="Only embed conversation summaries")
    parser.add_argument("--messages-only", action="store_true",
                        help="Only embed individual messages")
    args = parser.parse_args()

    print("[embed] Loading API key...")
    api_key = load_api_key()

    print("[embed] Connecting to database and Qdrant...")
    conn = get_db()
    client = get_qdrant()

    # Ensure collections exist
    if args.rebuild:
        print("[embed] Rebuilding collections...")
        for name in (COLLECTION_MEMORY, COLLECTION_MESSAGES):
            try:
                client.delete_collection(name)
                print(f"  Deleted {name}")
            except Exception:
                pass

    do_memories = not args.messages_only
    do_messages = not args.memories_only

    if do_memories:
        ensure_collection(client, COLLECTION_MEMORY)
        embed_memories(conn, client, api_key, dry_run=args.dry_run, rebuild=args.rebuild)

    if do_messages:
        ensure_collection(client, COLLECTION_MESSAGES)
        embed_messages(conn, client, api_key, dry_run=args.dry_run, rebuild=args.rebuild)

    # Print stats
    print("\n[embed] Collection stats:")
    for name in (COLLECTION_MEMORY, COLLECTION_MESSAGES):
        try:
            info = client.get_collection(name)
            print(f"  {name}: {info.points_count} points")
        except Exception as e:
            print(f"  {name}: {e}")

    conn.close()

if __name__ == "__main__":
    main()
