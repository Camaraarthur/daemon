#!/usr/bin/env python3
"""
Import Claude Code conversation history into Daemon's database.
Parses ~/.claude/ JSONL session files, maps them to projects, stores in SQLite.

Usage: python3 import_claude_history.py [--dry-run] [--user-id N]
"""

import json
import sqlite3
import os
import sys
import uuid
from pathlib import Path
from datetime import datetime

DB_PATH = Path("/home/arthur/daemon/data/users.db")
CLAUDE_DIR = Path.home() / ".claude"
PROJECTS_DIR = CLAUDE_DIR / "projects"

# Map Claude Code project directory names to daemon project names and paths
# Directory names use dashes instead of slashes: -home-arthur-daemon -> /home/arthur/daemon
PROJECT_REGISTRY = {
    "daemon": {"path": "/home/arthur/daemon", "display": "Daemon"},
    "arturito": {"path": "/home/arthur/arturito", "display": "Arturito Platform"},
    "arturito-bd-stable": {"path": "/home/arthur/arturito-bd-stable", "display": "Arturito BD (stable)"},
    "arturito-bd-dev": {"path": "/home/arthur/arturito-bd-dev", "display": "Arturito BD (dev)"},
    "press-archiver": {"path": "/home/arthur/press-archiver", "display": "Press Archiver"},
    "gis": {"path": "/home/arthur/gis", "display": "GIS Explorer"},
    "cabinet": {"path": "/home/arthur/cabinet", "display": "Cabinet (Travel)"},
    "frank": {"path": "/home/arthur/frank", "display": "Frank (Civic Intel)"},
    "mirror": {"path": "/home/arthur/mirror", "display": "Mirror"},
    "call-partners": {"path": "/home/arthur/call-partners", "display": "Call Partners"},
    "claudegram": {"path": "/home/arthur/claudegram", "display": "Claudegram"},
    "harpejji": {"path": "/home/arthur/harpejji", "display": "Harpejji"},
    "file-search": {"path": "/home/arthur/file-search", "display": "File Search"},
    "indesign-uxp-server": {"path": "/home/arthur/indesign-uxp-server", "display": "InDesign UXP"},
    "comp-arturito": {"path": "/home/arthur/comp-arturito", "display": "Comp Arturito"},
    "beat": {"path": "/home/arthur/frank", "display": "Frank (Civic Intel)"},  # renamed
}


def dir_name_to_project(dir_name: str) -> tuple[str, dict]:
    """Convert Claude project dir name to project name and info.
    e.g. '-home-arthur-daemon' -> ('daemon', {...})
    """
    # Strip leading dash and convert: -home-arthur-daemon -> home/arthur/daemon
    path_str = dir_name.lstrip("-").replace("-", "/")
    # The actual path
    full_path = "/" + path_str

    # Try to match against registry by checking if the path ends with a known project
    for name, info in PROJECT_REGISTRY.items():
        if full_path == info["path"] or full_path.endswith("/" + name):
            return name, info

    # Fallback: use last path component as name
    last_part = path_str.split("/")[-1] if "/" in path_str else path_str
    return last_part, {"path": full_path, "display": last_part.title()}


def parse_jsonl_session(filepath: Path) -> list[dict]:
    """Parse a Claude Code JSONL session file into messages."""
    messages = []
    try:
        with open(filepath, "r", errors="replace") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    record = json.loads(line)
                except json.JSONDecodeError:
                    continue

                msg_type = record.get("type")
                timestamp = record.get("timestamp", "")

                if msg_type == "user":
                    content_parts = record.get("message", {}).get("content", [])
                    if isinstance(content_parts, str):
                        text = content_parts
                    elif isinstance(content_parts, list):
                        text = " ".join(
                            p.get("text", "") if isinstance(p, dict) else str(p)
                            for p in content_parts
                            if isinstance(p, dict) and p.get("type") == "text"
                            or isinstance(p, str)
                        ).strip()
                    else:
                        continue

                    if text:
                        messages.append({
                            "role": "user",
                            "content": text,
                            "timestamp": timestamp,
                            "model": None,
                        })

                elif msg_type == "assistant":
                    content_parts = record.get("message", {}).get("content", [])
                    model = record.get("message", {}).get("model", "")

                    if isinstance(content_parts, str):
                        text = content_parts
                    elif isinstance(content_parts, list):
                        text = " ".join(
                            p.get("text", "") if isinstance(p, dict) else str(p)
                            for p in content_parts
                            if isinstance(p, dict) and p.get("type") == "text"
                            or isinstance(p, str)
                        ).strip()
                    else:
                        continue

                    if text:
                        messages.append({
                            "role": "assistant",
                            "content": text[:10000],  # Truncate very long responses
                            "timestamp": timestamp,
                            "model": model,
                        })

    except Exception as e:
        print(f"  Error parsing {filepath.name}: {e}", file=sys.stderr)

    return messages


def ensure_project(db: sqlite3.Connection, user_id: int, name: str, info: dict) -> int:
    """Get or create a project, return its ID."""
    row = db.execute(
        "SELECT id FROM projects WHERE user_id = ? AND name = ?",
        (user_id, name)
    ).fetchone()

    if row:
        return row[0]

    db.execute(
        """INSERT INTO projects (user_id, name, display_name, local_path, created_at)
           VALUES (?, ?, ?, ?, datetime('now'))""",
        (user_id, name, info.get("display", name), info.get("path"))
    )
    db.commit()
    return db.execute("SELECT last_insert_rowid()").fetchone()[0]


def import_session(db: sqlite3.Connection, user_id: int, project_id: int,
                   session_id: str, messages: list[dict]) -> int:
    """Import a session's messages into a thread. Returns message count."""
    # Check if already imported
    row = db.execute(
        "SELECT 1 FROM imported_sessions WHERE source = 'claude_code' AND source_session_id = ?",
        (session_id,)
    ).fetchone()
    if row:
        return 0

    # Create thread
    thread_id = str(uuid.uuid4())
    title = messages[0]["content"][:60] if messages else "Imported session"
    first_ts = messages[0]["timestamp"] if messages else datetime.now().isoformat()

    db.execute(
        """INSERT INTO chat_threads (id, project_id, user_id, title, created_at, last_message_at)
           VALUES (?, ?, ?, ?, ?, ?)""",
        (thread_id, project_id, user_id, title, first_ts, messages[-1]["timestamp"] if messages else first_ts)
    )

    # Insert messages
    for msg in messages:
        db.execute(
            """INSERT INTO chat_messages (id, thread_id, role, content, model, created_at)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (str(uuid.uuid4()), thread_id, msg["role"], msg["content"],
             msg["model"], msg["timestamp"] or datetime.now().isoformat())
        )

    # Mark as imported
    db.execute(
        """INSERT INTO imported_sessions (project_id, source, source_session_id, message_count)
           VALUES (?, 'claude_code', ?, ?)""",
        (project_id, session_id, len(messages))
    )

    db.commit()
    return len(messages)


def main():
    dry_run = "--dry-run" in sys.argv
    user_id = 1  # Arthur's user ID (first user)

    for arg in sys.argv:
        if arg.startswith("--user-id="):
            user_id = int(arg.split("=")[1])

    if not PROJECTS_DIR.exists():
        print(f"Claude projects dir not found: {PROJECTS_DIR}")
        sys.exit(1)

    db = sqlite3.connect(str(DB_PATH))
    db.row_factory = sqlite3.Row

    total_messages = 0
    total_sessions = 0
    total_projects = 0

    # Scan project directories
    for project_dir in sorted(PROJECTS_DIR.iterdir()):
        if not project_dir.is_dir():
            continue

        project_name, project_info = dir_name_to_project(project_dir.name)

        # Find JSONL session files
        jsonl_files = sorted(project_dir.glob("*.jsonl"))
        if not jsonl_files:
            continue

        print(f"\n📁 {project_name} ({len(jsonl_files)} sessions)")

        if not dry_run:
            project_id = ensure_project(db, user_id, project_name, project_info)
        else:
            project_id = 0

        project_msgs = 0
        for jsonl_file in jsonl_files:
            messages = parse_jsonl_session(jsonl_file)
            if not messages:
                continue

            session_id = jsonl_file.stem

            if dry_run:
                print(f"  {session_id}: {len(messages)} messages")
                project_msgs += len(messages)
            else:
                count = import_session(db, user_id, project_id, session_id, messages)
                if count > 0:
                    print(f"  Imported {session_id}: {count} messages")
                    project_msgs += count
                    total_sessions += 1

        if project_msgs > 0:
            total_projects += 1
            total_messages += project_msgs

    print(f"\n{'[DRY RUN] ' if dry_run else ''}Summary:")
    print(f"  Projects: {total_projects}")
    print(f"  Sessions: {total_sessions}")
    print(f"  Messages: {total_messages}")

    db.close()


if __name__ == "__main__":
    main()
