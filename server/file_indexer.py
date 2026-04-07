#!/usr/bin/env python3
"""
file_indexer.py — Semantic file search for Daemon projects.

Indexes files in a project directory using Gemini embeddings stored in
Qdrant (one collection per project: daemon_files_p<project_id>).

Usage:
  python3 file_indexer.py index  --project-id N --path /abs/path
  python3 file_indexer.py search --project-id N --query "..." [--limit 10]

Mirrors the HTTP-API embedding pattern in embed_conversations.py so the
script depends only on stdlib + qdrant-client (already in the venv).
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.request
import urllib.error
from pathlib import Path

from qdrant_client import QdrantClient
from qdrant_client.models import Distance, PointStruct, VectorParams

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

EMBEDDING_MODEL = "gemini-embedding-001"
EMBEDDING_DIM = 768
QDRANT_URL = os.environ.get("QDRANT_URL", "http://localhost:6333")

INDEX_EXTENSIONS = {
    ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
    ".py", ".kt", ".java", ".rs", ".go", ".rb", ".php", ".swift", ".c", ".h",
    ".cpp", ".hpp", ".cs",
    ".html", ".css", ".scss", ".vue", ".svelte",
    ".md", ".mdx", ".txt", ".json", ".yaml", ".yml", ".toml", ".ini",
    ".sh", ".bash", ".zsh", ".fish", ".sql",
}

SKIP_DIRS = {
    "node_modules", ".next", ".git", "target", "build", "dist", "out",
    "__pycache__", ".venv", "venv", ".gradle", ".idea", ".vscode",
    ".turbo", ".cache", "coverage", ".mypy_cache", ".pytest_cache",
    "vendor", "Pods", ".tox", ".nuxt", "site-packages",
}

MAX_FILE_BYTES = 500_000          # skip files larger than this
MAX_FILES_PER_PROJECT = 5000      # safety cap
EMBED_INPUT_CHARS = 10_000        # how much of each file we embed
PREVIEW_CHARS = 500
BATCH_SIZE = 20
API_DELAY = 0.3                   # seconds between batches

# ---------------------------------------------------------------------------
# API key (vault.env)
# ---------------------------------------------------------------------------

def load_api_key() -> str:
    vault_path = os.path.expanduser("~/.secrets/vault.env")
    keys: dict[str, str] = {}
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
# Gemini embeddings (HTTP, no extra deps)
# ---------------------------------------------------------------------------

def embed_batch(texts: list[str], api_key: str, task_type: str = "RETRIEVAL_DOCUMENT") -> list[list[float]]:
    url = (
        f"https://generativelanguage.googleapis.com/v1beta/models/"
        f"{EMBEDDING_MODEL}:batchEmbedContents?key={api_key}"
    )
    body = {
        "requests": [
            {
                "model": f"models/{EMBEDDING_MODEL}",
                "content": {"parts": [{"text": t[:8000]}]},
                "taskType": task_type,
                "outputDimensionality": EMBEDDING_DIM,
            }
            for t in texts
        ]
    }
    data = json.dumps(body).encode()
    req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=120) as resp:
        result = json.loads(resp.read())
    if "embeddings" not in result:
        raise ValueError(f"Embedding failed: {json.dumps(result)[:500]}")
    return [e["values"] for e in result["embeddings"]]


def embed_single(text: str, api_key: str, task_type: str = "RETRIEVAL_QUERY") -> list[float]:
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
# Qdrant
# ---------------------------------------------------------------------------

def get_qdrant() -> QdrantClient:
    return QdrantClient(url=QDRANT_URL, timeout=30)


def collection_name(project_id: int) -> str:
    return f"daemon_files_p{int(project_id)}"


def ensure_collection(client: QdrantClient, name: str) -> None:
    existing = [c.name for c in client.get_collections().collections]
    if name not in existing:
        client.create_collection(
            collection_name=name,
            vectors_config=VectorParams(size=EMBEDDING_DIM, distance=Distance.COSINE),
        )

# ---------------------------------------------------------------------------
# File collection
# ---------------------------------------------------------------------------

def collect_files(root_path: str, max_files: int = MAX_FILES_PER_PROJECT) -> list[Path]:
    root = Path(root_path).resolve()
    if not root.exists() or not root.is_dir():
        raise ValueError(f"Path does not exist or is not a directory: {root}")

    out: list[Path] = []
    for path in root.rglob("*"):
        if not path.is_file():
            continue
        if path.suffix.lower() not in INDEX_EXTENSIONS:
            continue
        if any(part in SKIP_DIRS for part in path.parts):
            continue
        try:
            if path.stat().st_size > MAX_FILE_BYTES:
                continue
        except OSError:
            continue
        out.append(path)
        if len(out) >= max_files:
            break
    return out

# ---------------------------------------------------------------------------
# Indexing
# ---------------------------------------------------------------------------

def _stable_id(path: str) -> int:
    # Deterministic positive 63-bit id from the file path.
    import hashlib
    h = hashlib.sha1(path.encode("utf-8")).digest()
    return int.from_bytes(h[:8], "big") >> 1


def index_project(project_id: int, project_path: str) -> dict:
    api_key = load_api_key()
    client = get_qdrant()
    coll = collection_name(project_id)
    ensure_collection(client, coll)

    files = collect_files(project_path)
    print(f"[indexer] project={project_id} path={project_path} files={len(files)}", file=sys.stderr)

    pending_points: list[PointStruct] = []
    pending_texts: list[str] = []
    pending_meta: list[dict] = []
    indexed = 0
    skipped = 0
    errors = 0

    def flush() -> None:
        nonlocal indexed, errors, pending_points, pending_texts, pending_meta
        if not pending_texts:
            return
        try:
            vectors = embed_batch(pending_texts, api_key, task_type="RETRIEVAL_DOCUMENT")
        except Exception as e:
            errors += len(pending_texts)
            print(f"[indexer] embed batch error: {e}", file=sys.stderr)
            pending_points = []
            pending_texts = []
            pending_meta = []
            return
        for vec, meta in zip(vectors, pending_meta):
            pending_points.append(
                PointStruct(id=meta["id"], vector=vec, payload=meta["payload"])
            )
        if pending_points:
            client.upsert(collection_name=coll, points=pending_points)
            indexed += len(pending_points)
        pending_points = []
        pending_texts = []
        pending_meta = []
        time.sleep(API_DELAY)

    for fpath in files:
        try:
            content = fpath.read_text(errors="replace")
        except Exception as e:
            errors += 1
            print(f"[indexer] read error {fpath}: {e}", file=sys.stderr)
            continue
        if len(content.strip()) < 50:
            skipped += 1
            continue

        rel = str(fpath)
        embed_text = f"File: {fpath.name}\nPath: {rel}\n\n{content[:EMBED_INPUT_CHARS]}"

        try:
            stat = fpath.stat()
        except OSError:
            skipped += 1
            continue

        pending_texts.append(embed_text)
        pending_meta.append({
            "id": _stable_id(rel),
            "payload": {
                "path": rel,
                "name": fpath.name,
                "extension": fpath.suffix,
                "size": stat.st_size,
                "mtime": int(stat.st_mtime),
                "preview": content[:PREVIEW_CHARS],
                "project_id": int(project_id),
            },
        })

        if len(pending_texts) >= BATCH_SIZE:
            flush()
            print(f"[indexer]   {indexed}/{len(files)} indexed", file=sys.stderr)

    flush()

    print(f"[indexer] done. collection={coll} indexed={indexed} skipped={skipped} errors={errors}", file=sys.stderr)
    return {
        "collection": coll,
        "files_seen": len(files),
        "indexed": indexed,
        "skipped": skipped,
        "errors": errors,
    }

# ---------------------------------------------------------------------------
# Search
# ---------------------------------------------------------------------------

def search(project_id: int, query: str, limit: int = 10) -> list[dict]:
    api_key = load_api_key()
    client = get_qdrant()
    coll = collection_name(project_id)

    # If collection doesn't exist, return empty.
    existing = [c.name for c in client.get_collections().collections]
    if coll not in existing:
        return []

    qvec = embed_single(query, api_key, task_type="RETRIEVAL_QUERY")
    res = client.query_points(collection_name=coll, query=qvec, limit=limit, with_payload=True)

    out: list[dict] = []
    for pt in res.points:
        payload = pt.payload or {}
        out.append({
            "path": payload.get("path"),
            "name": payload.get("name"),
            "preview": payload.get("preview"),
            "size": payload.get("size"),
            "extension": payload.get("extension"),
            "score": float(pt.score) if pt.score is not None else None,
        })
    return out

# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main() -> int:
    parser = argparse.ArgumentParser(description="Daemon semantic file indexer")
    parser.add_argument("action", choices=["index", "search"])
    parser.add_argument("--project-id", type=int, required=True)
    parser.add_argument("--path", type=str, help="Project path to index")
    parser.add_argument("--query", type=str, help="Search query")
    parser.add_argument("--limit", type=int, default=10)
    args = parser.parse_args()

    if args.action == "index":
        if not args.path:
            print("--path required for index", file=sys.stderr)
            return 1
        stats = index_project(args.project_id, args.path)
        print(json.dumps(stats))
        return 0

    if args.action == "search":
        if not args.query:
            print("--query required for search", file=sys.stderr)
            return 1
        results = search(args.project_id, args.query, args.limit)
        print(json.dumps(results, indent=2))
        return 0

    return 1


if __name__ == "__main__":
    raise SystemExit(main())
