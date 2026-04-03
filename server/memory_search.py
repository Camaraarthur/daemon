#!/usr/bin/env python3
"""
memory_search.py — Search Daemon conversation memory via Qdrant vectors + SQLite text.

Exports:
  search_memory(query, limit=10)          — Vector search across memories + messages
  grep_memory(pattern, project_id=None)   — SQLite LIKE text search
  get_project_context(project_id)         — Formatted context block for a project

Can also run standalone for testing:
  python3 memory_search.py search "how did we set up qdrant"
  python3 memory_search.py grep "kicad"
  python3 memory_search.py context 1
"""

import os
import sys
import json
import sqlite3
import urllib.request
from dataclasses import dataclass, asdict
from typing import Optional

from qdrant_client import QdrantClient
from qdrant_client.models import Filter, FieldCondition, MatchValue, models

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

DB_PATH = os.path.join(os.path.dirname(__file__), "..", "data", "users.db")
QDRANT_URL = "http://localhost:6333"

EMBEDDING_MODEL = "gemini-embedding-001"
EMBEDDING_DIM = 768

COLLECTION_MEMORY = "daemon_memory"
COLLECTION_MESSAGES = "daemon_messages"

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
# Embedding
# ---------------------------------------------------------------------------

def embed_query(text: str, api_key: str) -> list[float]:
    """Embed a search query."""
    url = (
        f"https://generativelanguage.googleapis.com/v1beta/models/"
        f"{EMBEDDING_MODEL}:embedContent?key={api_key}"
    )
    payload = {
        "content": {"parts": [{"text": text[:8000]}]},
        "taskType": "RETRIEVAL_QUERY",
        "outputDimensionality": EMBEDDING_DIM,
    }
    data = json.dumps(payload).encode()
    req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        result = json.loads(resp.read())
    return result["embedding"]["values"]

# ---------------------------------------------------------------------------
# Result types
# ---------------------------------------------------------------------------

@dataclass
class MemoryResult:
    type: str             # "conversation_memory" or "message"
    score: float
    thread_id: str
    project_id: Optional[int]
    tldr: Optional[str]   # For conversation memories
    content: Optional[str] # For individual messages
    tags: list[str]
    thread_title: str
    created_at: str
    role: Optional[str] = None  # For messages

    def to_dict(self) -> dict:
        return asdict(self)

# ---------------------------------------------------------------------------
# Clients (lazy init)
# ---------------------------------------------------------------------------

_qdrant: Optional[QdrantClient] = None
_api_key: Optional[str] = None

def _get_qdrant() -> QdrantClient:
    global _qdrant
    if _qdrant is None:
        _qdrant = QdrantClient(url=QDRANT_URL, timeout=15)
    return _qdrant

def _get_api_key() -> str:
    global _api_key
    if _api_key is None:
        _api_key = load_api_key()
    return _api_key

def _get_db() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

# ---------------------------------------------------------------------------
# search_memory — vector search via Qdrant
# ---------------------------------------------------------------------------

def search_memory(query: str, limit: int = 10, project_id: Optional[int] = None,
                  collection: Optional[str] = None) -> list[MemoryResult]:
    """
    Vector search across conversation memories and/or individual messages.

    Args:
        query: Natural language search query
        limit: Max results to return
        project_id: Optional filter by project
        collection: Search specific collection ("memories", "messages", or None for both)
    """
    client = _get_qdrant()
    api_key = _get_api_key()

    query_vec = embed_query(query, api_key)

    results = []

    # Build optional filter
    qdrant_filter = None
    if project_id is not None:
        qdrant_filter = Filter(
            must=[FieldCondition(key="project_id", match=MatchValue(value=project_id))]
        )

    collections_to_search = []
    if collection == "memories":
        collections_to_search = [COLLECTION_MEMORY]
    elif collection == "messages":
        collections_to_search = [COLLECTION_MESSAGES]
    else:
        collections_to_search = [COLLECTION_MEMORY, COLLECTION_MESSAGES]

    for coll_name in collections_to_search:
        try:
            response = client.query_points(
                collection_name=coll_name,
                query=query_vec,
                query_filter=qdrant_filter,
                limit=limit,
                with_payload=True,
            )
            hits = response.points

            for hit in hits:
                p = hit.payload or {}
                result = MemoryResult(
                    type=p.get("type", "unknown"),
                    score=hit.score,
                    thread_id=p.get("thread_id", ""),
                    project_id=p.get("project_id"),
                    tldr=p.get("tldr"),
                    content=p.get("content"),
                    tags=p.get("tags", []),
                    thread_title=p.get("thread_title", ""),
                    created_at=p.get("created_at", ""),
                    role=p.get("role"),
                )
                results.append(result)
        except Exception as e:
            print(f"  Warning: search failed on {coll_name}: {e}", file=sys.stderr)

    # Sort by score descending and limit
    results.sort(key=lambda r: r.score, reverse=True)
    return results[:limit]

# ---------------------------------------------------------------------------
# grep_memory — text search via SQLite
# ---------------------------------------------------------------------------

def grep_memory(pattern: str, project_id: Optional[int] = None,
                limit: int = 50) -> list[MemoryResult]:
    """
    Text search across conversation memories using SQLite LIKE.
    Searches TLDRs, key_facts, key_decisions, problems, solutions.
    """
    conn = _get_db()
    like = f"%{pattern}%"

    params: list = [like, like, like, like, like]
    project_clause = ""
    if project_id is not None:
        project_clause = "AND cm.project_id = ?"
        params.append(project_id)
    params.append(limit)

    rows = conn.execute(f"""
        SELECT cm.*, t.title as thread_title
        FROM conversation_memory cm
        LEFT JOIN chat_threads t ON t.id = cm.thread_id
        WHERE (
            cm.tldr LIKE ? OR
            cm.key_facts LIKE ? OR
            cm.key_decisions LIKE ? OR
            cm.problems LIKE ? OR
            cm.solutions LIKE ?
        )
        {project_clause}
        ORDER BY cm.created_at DESC
        LIMIT ?
    """, params).fetchall()

    results = []
    for row in rows:
        row = dict(row)
        results.append(MemoryResult(
            type="conversation_memory",
            score=1.0,  # Text match — no score
            thread_id=row["thread_id"],
            project_id=row["project_id"],
            tldr=row["tldr"],
            content=None,
            tags=json.loads(row["tags"] or "[]"),
            thread_title=row.get("thread_title", ""),
            created_at=row["created_at"],
        ))

    conn.close()
    return results

# ---------------------------------------------------------------------------
# get_project_context — formatted context for a project
# ---------------------------------------------------------------------------

def get_project_context(project_id: int) -> str:
    """
    Returns a formatted context block with all TLDRs and key facts for a project.
    Useful for injecting into system prompts.
    """
    conn = _get_db()

    # Get project info
    project = conn.execute(
        "SELECT * FROM projects WHERE id = ?", (project_id,)
    ).fetchone()

    if not project:
        conn.close()
        return f"No project found with id {project_id}"

    project = dict(project)

    # Get all memories for this project
    rows = conn.execute("""
        SELECT cm.*, t.title as thread_title
        FROM conversation_memory cm
        LEFT JOIN chat_threads t ON t.id = cm.thread_id
        WHERE cm.project_id = ?
        ORDER BY cm.created_at ASC
    """, (project_id,)).fetchall()

    conn.close()

    if not rows:
        return f"# {project.get('display_name', project['name'])}\n\nNo conversation history indexed yet."

    # Build context
    parts = [
        f"# Project: {project.get('display_name', project['name'])}",
        f"Path: {project.get('local_path', 'N/A')} | Stack: {project.get('stack', 'N/A')} | Domain: {project.get('domain', 'N/A')}",
        f"\n## Conversation History ({len(rows)} sessions)\n",
    ]

    all_facts = []
    all_decisions = []

    for row in rows:
        row = dict(row)
        title = row.get("thread_title", "Untitled")
        date = row["created_at"][:10] if row["created_at"] else "?"
        parts.append(f"### [{date}] {title}")
        parts.append(row["tldr"])

        facts = json.loads(row["key_facts"] or "[]")
        decisions = json.loads(row["key_decisions"] or "[]")
        problems = json.loads(row["problems"] or "[]")
        solutions = json.loads(row["solutions"] or "[]")

        if problems:
            parts.append(f"  Problems: {'; '.join(problems)}")
        if solutions:
            parts.append(f"  Solutions: {'; '.join(solutions)}")

        all_facts.extend(facts)
        all_decisions.extend(decisions)
        parts.append("")

    # Deduplicated key facts and decisions at the top
    if all_facts:
        unique_facts = list(dict.fromkeys(all_facts))  # Preserve order, remove dupes
        parts.insert(3, "## Key Facts\n" + "\n".join(f"- {f}" for f in unique_facts) + "\n")

    if all_decisions:
        unique_decisions = list(dict.fromkeys(all_decisions))
        insert_pos = 4 if all_facts else 3
        parts.insert(insert_pos, "## Key Decisions\n" + "\n".join(f"- {d}" for d in unique_decisions) + "\n")

    return "\n".join(parts)

# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main():
    if len(sys.argv) < 2:
        print("Usage:")
        print("  python3 memory_search.py search 'query'")
        print("  python3 memory_search.py grep 'pattern' [project_id]")
        print("  python3 memory_search.py context <project_id>")
        sys.exit(1)

    cmd = sys.argv[1]

    if cmd == "search":
        query = sys.argv[2] if len(sys.argv) > 2 else ""
        if not query:
            print("Usage: memory_search.py search 'query'")
            sys.exit(1)
        results = search_memory(query, limit=10)
        for r in results:
            print(f"[{r.score:.3f}] [{r.type}] {r.thread_title}")
            if r.tldr:
                print(f"  TLDR: {r.tldr[:120]}...")
            if r.content:
                print(f"  Content: {r.content[:120]}...")
            print(f"  Thread: {r.thread_id} | Project: {r.project_id} | {r.created_at}")
            print()

    elif cmd == "grep":
        pattern = sys.argv[2] if len(sys.argv) > 2 else ""
        project_id = int(sys.argv[3]) if len(sys.argv) > 3 else None
        if not pattern:
            print("Usage: memory_search.py grep 'pattern' [project_id]")
            sys.exit(1)
        results = grep_memory(pattern, project_id=project_id)
        for r in results:
            print(f"[text] {r.thread_title}")
            print(f"  TLDR: {r.tldr[:120]}...")
            print(f"  Thread: {r.thread_id} | Project: {r.project_id} | {r.created_at}")
            print()

    elif cmd == "context":
        project_id = int(sys.argv[2]) if len(sys.argv) > 2 else None
        if project_id is None:
            print("Usage: memory_search.py context <project_id>")
            sys.exit(1)
        print(get_project_context(project_id))

    else:
        print(f"Unknown command: {cmd}")
        sys.exit(1)

if __name__ == "__main__":
    main()
