#!/usr/bin/env python3
"""
Bridge helper: lets cli/daemon.mjs call file-search's semantic search
without owning the indexing pipeline.

Reuses /home/arthur/file-search (Gemini Embedding 2 + LanceDB),
which is already indexed and live as an MCP server. We just import
its search() function and print JSON.

Vision §4.3 — semantic file search wired as a daemon tool.
The agent calls semantic_search(query, top_k?, file_types?, directories?)
on its current device; the device shells out here; the relay never
sees raw file content.

Args (positional or via JSON on stdin):
  argv[1]  query string  (required)
  argv[2]  top_k          (default 10, max 30)
  argv[3]  JSON file_types  (optional, e.g. '[".py", ".ts"]')
  argv[4]  JSON directories (optional, e.g. '["~/daemon"]')

Outputs JSON to stdout:
  {"ok": true, "count": N, "results": [{path, kind, size, snippet, ext}, ...]}
  {"ok": false, "error": "..."}
"""

import json
import os
import sys

# file-search lives at a fixed path; we don't own its venv. Add to
# sys.path and import directly.
FILE_SEARCH_DIR = "/home/arthur/file-search"
if FILE_SEARCH_DIR not in sys.path:
    sys.path.insert(0, FILE_SEARCH_DIR)

try:
    from indexer import search, load_config  # type: ignore
except Exception as e:
    print(json.dumps({"ok": False, "error": f"file-search import failed: {e}"}))
    sys.exit(1)


def get_config():
    """Mirror server.py's get_config — load + apply env overrides."""
    cfg = load_config()
    if "GOOGLE_API_KEY" in os.environ:
        cfg.setdefault("api_key", os.environ["GOOGLE_API_KEY"])
    return cfg


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"ok": False, "error": "query argument required"}))
        sys.exit(1)
    query = sys.argv[1]
    top_k = 10
    file_types = None
    directories = None
    if len(sys.argv) >= 3:
        try:
            top_k = max(1, min(30, int(sys.argv[2])))
        except ValueError:
            pass
    if len(sys.argv) >= 4 and sys.argv[3]:
        try:
            file_types = json.loads(sys.argv[3])
        except Exception:
            pass
    if len(sys.argv) >= 5 and sys.argv[4]:
        try:
            directories = json.loads(sys.argv[4])
        except Exception:
            pass

    try:
        cfg = get_config()
        results = search(
            query, cfg, top_k=top_k,
            file_types=file_types, directories=directories,
        )
    except Exception as e:
        print(json.dumps({"ok": False, "error": f"search failed: {e}"}))
        sys.exit(0)  # Exit 0 so the calling Node sees the JSON, not a crash.

    home = os.path.expanduser("~")
    out = []
    for r in results:
        path = r.get("path") or ""
        # Always full path; the chat UI's PathButton will tilde-collapse
        # for display.
        out.append({
            "path": path,
            "kind": "directory" if r.get("entry_type") == "directory" else "file",
            "size": int(r.get("size") or 0),
            "extension": r.get("extension") or "",
            "snippet": (r.get("snippet") or "").strip()[:300] or None,
            "description": (r.get("description") or "").strip()[:300] or None,
            "score": float(r.get("_distance") or 0.0),
        })

    print(json.dumps({"ok": True, "count": len(out), "results": out}))


if __name__ == "__main__":
    main()
