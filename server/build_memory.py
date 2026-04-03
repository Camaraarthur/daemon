#!/usr/bin/env python3
"""
build_memory.py — Extract structured memory from Daemon conversation threads.

Reads all chat threads from the SQLite DB, sends them to Gemini Flash for
summarization, and stores the results in a `conversation_memory` table.

Usage:
  python3 build_memory.py                  # Process all unprocessed threads
  python3 build_memory.py --dry-run 5      # Preview first 5 threads
  python3 build_memory.py --reprocess      # Reprocess all threads (overwrites)
"""

import os
import sys
import json
import time
import sqlite3
import argparse
import urllib.request
from pathlib import Path

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

DB_PATH = os.path.join(os.path.dirname(__file__), "..", "data", "users.db")

# Load API key from vault
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
    # Prefer ARTHUR key (has Gemini access), fall back to main
    for key_name in ("GOOGLE_API_KEY_ARTHUR", "GOOGLE_API_KEY_CRA_FREE", "GOOGLE_API_KEY"):
        if key_name in keys and keys[key_name]:
            return keys[key_name]
    raise ValueError("No GOOGLE_API_KEY found in vault.env")

GEMINI_MODEL = "gemini-2.0-flash"
GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={key}"

SUMMARY_PROMPT = """Analyze this conversation between a user and an AI assistant. Extract structured memory.

Output valid JSON with these fields:
- "tldr": A 2-3 sentence summary of what this conversation was about and what was accomplished.
- "key_decisions": Array of strings — important decisions made during the conversation.
- "key_facts": Array of strings — factual information learned (project names, URLs, tech choices, people mentioned, etc).
- "problems": Array of strings — problems or bugs encountered.
- "solutions": Array of strings — solutions found or workarounds applied.
- "tags": Array of strings — short tags categorizing the conversation (e.g. "daemon", "hardware", "deployment", "debugging", "kicad").

If a field has no entries, use an empty array [].
Output ONLY the JSON object, no markdown fences or explanation.

CONVERSATION:
{conversation}"""

# ---------------------------------------------------------------------------
# Database setup
# ---------------------------------------------------------------------------

def get_db() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA foreign_keys = ON")
    return conn

def create_memory_table(conn: sqlite3.Connection):
    conn.execute("""
        CREATE TABLE IF NOT EXISTS conversation_memory (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            thread_id TEXT NOT NULL,
            project_id INTEGER,
            user_id INTEGER NOT NULL,
            tldr TEXT NOT NULL,
            key_decisions TEXT,
            key_facts TEXT,
            problems TEXT,
            solutions TEXT,
            tags TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            FOREIGN KEY (thread_id) REFERENCES chat_threads(id),
            FOREIGN KEY (project_id) REFERENCES projects(id)
        )
    """)
    conn.execute("""
        CREATE INDEX IF NOT EXISTS idx_memory_thread ON conversation_memory(thread_id)
    """)
    conn.execute("""
        CREATE INDEX IF NOT EXISTS idx_memory_project ON conversation_memory(project_id)
    """)
    conn.execute("""
        CREATE INDEX IF NOT EXISTS idx_memory_user ON conversation_memory(user_id)
    """)
    conn.commit()

# ---------------------------------------------------------------------------
# Thread loading
# ---------------------------------------------------------------------------

def load_threads(conn: sqlite3.Connection, reprocess: bool = False) -> list[dict]:
    """Load threads that haven't been processed yet (or all if reprocessing)."""
    if reprocess:
        rows = conn.execute("""
            SELECT t.id, t.project_id, t.user_id, t.title, t.created_at,
                   COUNT(m.id) as msg_count
            FROM chat_threads t
            LEFT JOIN chat_messages m ON m.thread_id = t.id
            GROUP BY t.id
            HAVING msg_count > 0
            ORDER BY t.created_at ASC
        """).fetchall()
    else:
        rows = conn.execute("""
            SELECT t.id, t.project_id, t.user_id, t.title, t.created_at,
                   COUNT(m.id) as msg_count
            FROM chat_threads t
            LEFT JOIN chat_messages m ON m.thread_id = t.id
            LEFT JOIN conversation_memory cm ON cm.thread_id = t.id
            WHERE cm.id IS NULL
            GROUP BY t.id
            HAVING msg_count > 0
            ORDER BY t.created_at ASC
        """).fetchall()
    return [dict(r) for r in rows]

def load_messages(conn: sqlite3.Connection, thread_id: str) -> list[dict]:
    """Load all messages for a thread."""
    rows = conn.execute("""
        SELECT role, content, created_at
        FROM chat_messages
        WHERE thread_id = ?
        ORDER BY created_at ASC
    """, (thread_id,)).fetchall()
    return [dict(r) for r in rows]

def format_conversation(messages: list[dict], max_chars: int = 30000) -> str:
    """Format messages into a readable conversation string, truncated to max_chars."""
    lines = []
    total = 0
    for msg in messages:
        content = msg.get("content") or ""
        if not content:
            continue
        role = msg["role"].upper()
        line = f"{role}: {content}"
        if total + len(line) > max_chars:
            remaining = max_chars - total
            if remaining > 100:
                lines.append(line[:remaining] + "... [truncated]")
            break
        lines.append(line)
        total += len(line)
    return "\n\n".join(lines)

# ---------------------------------------------------------------------------
# Gemini summarization
# ---------------------------------------------------------------------------

def summarize_conversation(conversation_text: str, api_key: str) -> dict:
    """Send conversation to Gemini Flash and get structured summary."""
    url = GEMINI_URL.format(model=GEMINI_MODEL, key=api_key)

    prompt = SUMMARY_PROMPT.format(conversation=conversation_text)

    payload = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {
            "temperature": 0.2,
            "maxOutputTokens": 2048,
            "responseMimeType": "application/json",
        }
    }

    data = json.dumps(payload).encode()
    req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"})

    with urllib.request.urlopen(req, timeout=60) as resp:
        result = json.loads(resp.read())

    # Extract text from response
    text = result["candidates"][0]["content"]["parts"][0]["text"]

    # Parse JSON (strip markdown fences if present)
    text = text.strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[1]
        if text.endswith("```"):
            text = text[:-3]
        text = text.strip()

    parsed = json.loads(text)

    # Validate required fields
    if "tldr" not in parsed:
        raise ValueError("Missing 'tldr' in response")

    # Ensure all array fields exist
    for field in ("key_decisions", "key_facts", "problems", "solutions", "tags"):
        if field not in parsed:
            parsed[field] = []

    return parsed

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def process_threads(threads: list[dict], conn: sqlite3.Connection, api_key: str,
                    dry_run: int = 0, reprocess: bool = False):
    """Process threads and store memory."""
    if dry_run:
        threads = threads[:dry_run]
        print(f"\n[DRY RUN] Processing {len(threads)} threads\n")

    total = len(threads)
    success = 0
    failed = 0

    for i, thread in enumerate(threads):
        thread_id = thread["id"]
        title = (thread.get("title") or "untitled")[:60]
        msg_count = thread["msg_count"]

        print(f"[{i+1}/{total}] {title} ({msg_count} msgs)...", end=" ", flush=True)

        # Load and format conversation
        messages = load_messages(conn, thread_id)
        conversation = format_conversation(messages)

        if len(conversation) < 50:
            print("SKIP (too short)")
            continue

        try:
            summary = summarize_conversation(conversation, api_key)

            if not dry_run:
                # Delete existing if reprocessing
                if reprocess:
                    conn.execute("DELETE FROM conversation_memory WHERE thread_id = ?", (thread_id,))

                conn.execute("""
                    INSERT INTO conversation_memory
                    (thread_id, project_id, user_id, tldr, key_decisions, key_facts, problems, solutions, tags)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (
                    thread_id,
                    thread["project_id"],
                    thread["user_id"],
                    summary["tldr"],
                    json.dumps(summary["key_decisions"]),
                    json.dumps(summary["key_facts"]),
                    json.dumps(summary["problems"]),
                    json.dumps(summary["solutions"]),
                    json.dumps(summary["tags"]),
                ))
                conn.commit()

            tldr_preview = summary["tldr"][:80]
            print(f"OK — {tldr_preview}...")
            success += 1

        except Exception as e:
            err = str(e)[:100]
            print(f"FAIL — {err}")
            failed += 1

            # Rate limit handling
            if "429" in str(e):
                print("  Rate limited, waiting 60s...")
                time.sleep(60)
                continue

        # Delay between API calls to avoid rate limits
        time.sleep(1.0)

    print(f"\nDone: {success} processed, {failed} failed, {total - success - failed} skipped")

def main():
    parser = argparse.ArgumentParser(description="Build conversation memory from chat threads")
    parser.add_argument("--dry-run", type=int, metavar="N", default=0,
                        help="Process only N threads without saving")
    parser.add_argument("--reprocess", action="store_true",
                        help="Reprocess all threads (overwrites existing)")
    args = parser.parse_args()

    print("[build_memory] Loading API key...")
    api_key = load_api_key()

    print("[build_memory] Connecting to database...")
    conn = get_db()
    create_memory_table(conn)

    print("[build_memory] Loading threads...")
    threads = load_threads(conn, reprocess=args.reprocess)
    print(f"  Found {len(threads)} threads to process")

    if not threads:
        print("  Nothing to process!")
        return

    process_threads(threads, conn, api_key, dry_run=args.dry_run, reprocess=args.reprocess)

    conn.close()

if __name__ == "__main__":
    main()
