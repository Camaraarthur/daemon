#!/usr/bin/env python3
"""
Memory Import — Parse conversation exports from ChatGPT, Claude, Gemini, WhatsApp, Telegram.
Extracts distilled memory highlights, not raw history.
"""

import json
import re
import zipfile
import io
from pathlib import Path
from typing import Optional
from datetime import datetime


def import_chatgpt(file_path: str) -> list[dict]:
    """Import ChatGPT export (ZIP containing conversations.json).

    ChatGPT exports use a TREE structure (mapping) with parent/child nodes.
    We traverse from current_node backward to reconstruct linear conversation.
    """
    conversations = []

    # Handle ZIP or direct JSON
    if file_path.endswith(".zip"):
        with zipfile.ZipFile(file_path) as z:
            with z.open("conversations.json") as f:
                data = json.load(f)
    else:
        with open(file_path) as f:
            data = json.load(f)

    for conv in data:
        title = conv.get("title", "Untitled")
        create_time = conv.get("create_time")
        mapping = conv.get("mapping", {})
        current_node = conv.get("current_node")

        # Traverse tree backward from current_node to reconstruct linear history
        messages = []
        node_id = current_node
        while node_id and node_id in mapping:
            node = mapping[node_id]
            msg = node.get("message")
            if msg and msg.get("content"):
                content = msg["content"]
                parts = content.get("parts", [])
                text_parts = [p for p in parts if isinstance(p, str)]
                text = " ".join(text_parts).strip()
                if text:
                    role = msg.get("author", {}).get("role", "unknown")
                    messages.append({
                        "role": "user" if role == "user" else "assistant",
                        "content": text,
                        "timestamp": msg.get("create_time"),
                        "model": msg.get("metadata", {}).get("model_slug"),
                    })
            node_id = node.get("parent")

        messages.reverse()  # Was backward, now chronological

        if messages:
            conversations.append({
                "title": title,
                "source": "chatgpt",
                "created_at": datetime.fromtimestamp(create_time).isoformat() if create_time else None,
                "message_count": len(messages),
                "messages": messages,
            })

    return conversations


def import_claude(file_path: str) -> list[dict]:
    """Import Claude export (.dms file = renamed ZIP containing conversations.json).

    Claude exports are flat arrays — much simpler than ChatGPT.
    """
    conversations = []

    # .dms is a renamed ZIP
    if file_path.endswith((".dms", ".zip")):
        with zipfile.ZipFile(file_path) as z:
            # Find conversations.json in the archive
            json_files = [n for n in z.namelist() if "conversations" in n.lower() and n.endswith(".json")]
            if not json_files:
                return []
            with z.open(json_files[0]) as f:
                data = json.load(f)
    else:
        with open(file_path) as f:
            data = json.load(f)

    for conv in data:
        title = conv.get("name", "Untitled")
        messages = []
        for msg in conv.get("chat_messages", []):
            role = "user" if msg.get("sender") == "human" else "assistant"
            text = msg.get("text", "").strip()
            if text:
                messages.append({
                    "role": role,
                    "content": text,
                    "timestamp": msg.get("created_at"),
                })

        if messages:
            conversations.append({
                "title": title,
                "source": "claude",
                "created_at": conv.get("created_at"),
                "message_count": len(messages),
                "messages": messages,
            })

    return conversations


def import_whatsapp(file_path: str) -> list[dict]:
    """Import WhatsApp chat export (.txt file).

    Format varies by locale:
    - MM/DD/YYYY, HH:MM AM/PM - Name: Message
    - DD/MM/YYYY, HH:MM - Name: Message
    - DD.MM.YY, HH:MM - Name: Message
    """
    messages = []

    # Regex patterns for different WhatsApp timestamp formats
    patterns = [
        # MM/DD/YYYY, HH:MM AM/PM
        r"(\d{1,2}/\d{1,2}/\d{2,4},?\s+\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM)?)\s*-\s*(.+?):\s*(.+)",
        # DD/MM/YYYY, HH:MM (24h)
        r"(\d{1,2}/\d{1,2}/\d{2,4},?\s+\d{1,2}:\d{2}(?::\d{2})?)\s*-\s*(.+?):\s*(.+)",
        # DD.MM.YY, HH:MM
        r"(\d{1,2}\.\d{1,2}\.\d{2,4},?\s+\d{1,2}:\d{2}(?::\d{2})?)\s*-\s*(.+?):\s*(.+)",
        # [DD/MM/YYYY, HH:MM:SS] — bracket format
        r"\[(\d{1,2}/\d{1,2}/\d{2,4},?\s+\d{1,2}:\d{2}(?::\d{2})?)\]\s*(.+?):\s*(.+)",
    ]

    with open(file_path, encoding="utf-8") as f:
        lines = f.readlines()

    current_msg = None
    for line in lines:
        matched = False
        for pattern in patterns:
            m = re.match(pattern, line.strip())
            if m:
                if current_msg:
                    messages.append(current_msg)
                current_msg = {
                    "role": "user",  # WhatsApp doesn't have "assistant" — all are people
                    "sender": m.group(2).strip(),
                    "content": m.group(3).strip(),
                    "timestamp": m.group(1).strip(),
                }
                matched = True
                break

        if not matched and current_msg and line.strip():
            # Multi-line message continuation
            current_msg["content"] += "\n" + line.strip()

    if current_msg:
        messages.append(current_msg)

    # Filter out media/system messages
    messages = [m for m in messages if m["content"] not in ("<Media omitted>", "")]

    if messages:
        return [{
            "title": f"WhatsApp chat ({len(messages)} messages)",
            "source": "whatsapp",
            "created_at": messages[0].get("timestamp") if messages else None,
            "message_count": len(messages),
            "messages": messages,
        }]
    return []


def import_telegram(file_path: str) -> list[dict]:
    """Import Telegram export (result.json from Telegram Desktop export)."""
    conversations = []

    with open(file_path) as f:
        data = json.load(f)

    for chat in data.get("chats", {}).get("list", []):
        chat_name = chat.get("name", "Unknown")
        messages = []

        for msg in chat.get("messages", []):
            if msg.get("type") != "message":
                continue

            # text can be string or array of styled objects
            text = msg.get("text", "")
            if isinstance(text, list):
                text = "".join(
                    part if isinstance(part, str) else part.get("text", "")
                    for part in text
                )
            text = text.strip()

            if text:
                messages.append({
                    "role": "user",
                    "sender": msg.get("from", "Unknown"),
                    "content": text,
                    "timestamp": msg.get("date"),
                })

        if messages:
            conversations.append({
                "title": f"Telegram: {chat_name}",
                "source": "telegram",
                "created_at": messages[0].get("timestamp") if messages else None,
                "message_count": len(messages),
                "messages": messages,
            })

    return conversations


def import_generic(file_path: str) -> list[dict]:
    """Try to import any JSON/text file as conversation history."""
    path = Path(file_path)

    if path.suffix == ".json":
        with open(file_path) as f:
            data = json.load(f)

        # Try to detect format
        if isinstance(data, list) and data:
            first = data[0]
            if "mapping" in first:
                return import_chatgpt(file_path)
            elif "chat_messages" in first:
                return import_claude(file_path)
            elif "chats" in first:
                return import_telegram(file_path)

    elif path.suffix == ".txt":
        return import_whatsapp(file_path)

    elif path.suffix in (".dms", ".zip"):
        # Try Claude first, then ChatGPT
        try:
            return import_claude(file_path)
        except:
            return import_chatgpt(file_path)

    return []


def distill_memories(conversations: list[dict], max_highlights: int = 50) -> list[str]:
    """Distill imported conversations into memory highlights.

    Instead of storing raw history, extract key patterns:
    - Topics discussed frequently
    - User preferences and opinions
    - Recurring projects/people
    - Technical knowledge demonstrated
    - Communication style
    """
    # Collect all user messages
    all_user_msgs = []
    for conv in conversations:
        for msg in conv["messages"]:
            if msg["role"] == "user" and len(msg["content"]) > 20:
                all_user_msgs.append(msg["content"][:500])

    if not all_user_msgs:
        return []

    # For now, take a sample of messages as highlights
    # TODO: Use Claude Haiku to actually distill these into insights
    highlights = []
    total = len(all_user_msgs)
    highlights.append(f"Imported {total} messages from {len(conversations)} conversations ({conversations[0]['source']})")

    # Sample every Nth message for variety
    step = max(1, total // max_highlights)
    for i in range(0, total, step):
        msg = all_user_msgs[i]
        if len(msg) > 50:
            highlights.append(f"[{conversations[0]['source']}] {msg[:150]}")

    return highlights[:max_highlights]


def import_and_distill(file_path: str) -> dict:
    """Import a file and return distilled memories.

    Returns: {
        "source": str,
        "conversations": int,
        "messages": int,
        "highlights": list[str],
    }
    """
    conversations = import_generic(file_path)
    if not conversations:
        return {"source": "unknown", "conversations": 0, "messages": 0, "highlights": []}

    total_msgs = sum(c["message_count"] for c in conversations)
    highlights = distill_memories(conversations)

    return {
        "source": conversations[0]["source"] if conversations else "unknown",
        "conversations": len(conversations),
        "messages": total_msgs,
        "highlights": highlights,
    }


if __name__ == "__main__":
    """Test import with a file path argument."""
    if len(sys.argv) < 2:
        print("Usage: python memory_import.py <file_path>")
        print("Supports: .json (ChatGPT/Claude/Telegram), .txt (WhatsApp), .dms/.zip (Claude)")
        sys.exit(1)

    import sys
    result = import_and_distill(sys.argv[1])
    print(f"Source: {result['source']}")
    print(f"Conversations: {result['conversations']}")
    print(f"Messages: {result['messages']}")
    print(f"Highlights ({len(result['highlights'])}):")
    for h in result["highlights"][:10]:
        print(f"  {h}")
