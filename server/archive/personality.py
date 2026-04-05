#!/usr/bin/env python3
"""
Personality — Settling engine and memory management.
Adjusts daemon personality traits over time based on interaction patterns.
"""

import json
import subprocess
from pathlib import Path
from datetime import datetime, timezone
from typing import Optional

CONFIG_DIR = Path(__file__).parent.parent / "config"
PERSONALITY_PATH = CONFIG_DIR / "personality.json"
HISTORY_PATH = CONFIG_DIR / "conversation_history.json"

# How many interactions before running settling
SETTLING_INTERVAL = 20


def load_personality() -> dict:
    if PERSONALITY_PATH.exists():
        with open(PERSONALITY_PATH) as f:
            return json.load(f)
    return create_default_personality()


def create_default_personality() -> dict:
    return {
        "name": None,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "interaction_count": 0,
        "traits": {
            "directness": 0.5,
            "humor": 0.3,
            "verbosity": 0.5,
            "initiative": 0.4,
            "warmth": 0.5,
            "formality": 0.6,
            "curiosity": 0.5,
            "patience": 0.5,
        },
        "memory_highlights": [],
        "device_history": {},
        "last_settled": None,
    }


def save_personality(p: dict):
    CONFIG_DIR.mkdir(exist_ok=True)
    with open(PERSONALITY_PATH, "w") as f:
        json.dump(p, f, indent=2)


def load_history() -> list:
    if HISTORY_PATH.exists():
        with open(HISTORY_PATH) as f:
            return json.load(f)
    return []


def save_history(history: list):
    CONFIG_DIR.mkdir(exist_ok=True)
    # Keep last 500 messages
    with open(HISTORY_PATH, "w") as f:
        json.dump(history[-500:], f, indent=2)


def add_to_history(role: str, content: str):
    """Add a message to conversation history."""
    history = load_history()
    history.append({
        "role": role,
        "content": content,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    })
    save_history(history)


def detect_name_from_response(user_msg: str, daemon_response: str, personality: dict) -> Optional[str]:
    """Try to detect if the daemon was just named.

    Heuristics:
    - User message is short (1-3 words)
    - Daemon response acknowledges it as a name
    - Personality currently has no name
    """
    if personality.get("name"):
        return None  # Already named

    # Check if daemon response seems to acknowledge a name
    response_lower = daemon_response.lower()
    name_signals = [
        "works for me", "i like it", "i'll take it", "good name",
        "nice to meet", "that's me", "call me", "i'm ",
        "noted", "luna", "from now on",
    ]

    user_words = user_msg.strip().split()
    if len(user_words) <= 4:
        for signal in name_signals:
            if signal in response_lower:
                # The user's message is likely the name
                # Take the first word that's capitalized or the whole thing
                candidates = [w for w in user_words if w[0].isupper()] if user_words else []
                if candidates:
                    return candidates[0]
                # Just use the whole message cleaned up
                name = user_msg.strip().strip(".,!?'\"")
                if name and len(name) < 30:
                    return name

    return None


def should_settle(personality: dict) -> bool:
    """Check if it's time to run the settling algorithm."""
    count = personality.get("interaction_count", 0)
    if count < SETTLING_INTERVAL:
        return False
    if count % SETTLING_INTERVAL != 0:
        return False
    return True


def run_settling(personality: dict) -> dict:
    """Run the settling algorithm using Haiku (cheap) to adjust traits.

    Reads the last N messages from history, asks Haiku to evaluate
    interaction patterns, and adjusts traits by small amounts.
    """
    history = load_history()
    if len(history) < 10:
        return personality

    # Take last 30 messages for context
    recent = history[-30:]
    conversation_summary = "\n".join(
        f"{'USER' if m['role'] == 'user' else 'DAEMON'}: {m['content'][:200]}"
        for m in recent
    )

    current_traits = json.dumps(personality["traits"], indent=2)

    prompt = f"""Analyze this conversation between a user and their daemon (AI agent). Based on the interaction patterns, suggest small adjustments to the daemon's personality traits.

Current traits (0.0 = low, 1.0 = high):
{current_traits}

Recent conversation:
{conversation_summary}

Rules:
- Adjust each trait by at most +-0.05 per settling cycle
- If the user gives short commands → increase directness
- If the user jokes or is casual → increase humor, decrease formality
- If the user shares personal context → increase warmth
- If the user asks "why" a lot → increase curiosity
- If the user corrects the daemon → increase patience
- If the user wants things done fast → increase initiative, decrease verbosity
- Never go below 0.1 or above 0.9

Return ONLY a JSON object with the adjusted traits. No explanation. Example:
{{"directness": 0.55, "humor": 0.35, "verbosity": 0.45, "initiative": 0.4, "warmth": 0.55, "formality": 0.55, "curiosity": 0.5, "patience": 0.5}}"""

    try:
        result = subprocess.run(
            ["claude", "-p", prompt, "--output-format", "json",
             "--model", "haiku", "--no-session-persistence"],
            capture_output=True, text=True, timeout=30,
        )
        if result.returncode == 0:
            output = json.loads(result.stdout)
            response_text = output.get("result", "")
            # Extract JSON from response
            import re
            json_match = re.search(r'\{[^}]+\}', response_text)
            if json_match:
                new_traits = json.loads(json_match.group())
                # Validate and clamp
                for key in personality["traits"]:
                    if key in new_traits:
                        val = float(new_traits[key])
                        val = max(0.1, min(0.9, val))
                        personality["traits"][key] = round(val, 2)

                personality["last_settled"] = datetime.now(timezone.utc).isoformat()
                save_personality(personality)

                # Log the change
                print(f"[settling] Traits adjusted:")
                for k, v in personality["traits"].items():
                    print(f"  {k}: {v}")

    except Exception as e:
        print(f"[settling] Error: {e}")

    return personality


def generate_settling_digest(old_traits: dict, new_traits: dict) -> Optional[str]:
    """Generate a natural language summary of how the daemon changed.

    Returns None if changes are too small to mention.
    """
    changes = []
    for key in old_traits:
        if key in new_traits:
            diff = new_traits[key] - old_traits[key]
            if abs(diff) >= 0.03:
                direction = "more" if diff > 0 else "less"
                changes.append((key, direction, abs(diff)))

    if not changes:
        return None

    # Natural language
    descriptions = {
        "directness": ("direct", "cautious"),
        "humor": ("playful", "serious"),
        "verbosity": ("talkative", "concise"),
        "initiative": ("proactive", "reactive"),
        "warmth": ("personal", "neutral"),
        "formality": ("formal", "casual"),
        "curiosity": ("curious", "focused"),
        "patience": ("patient", "efficient"),
    }

    parts = []
    for key, direction, magnitude in changes[:3]:  # Top 3 changes
        pos, neg = descriptions.get(key, (key, f"less {key}"))
        word = pos if direction == "more" else neg
        parts.append(word)

    if len(parts) == 1:
        return f"I've gotten more {parts[0]} with you. Is that working?"
    elif len(parts) == 2:
        return f"I've gotten more {parts[0]} and {parts[1]} with you. Is that right?"
    else:
        return f"I've gotten more {', '.join(parts[:-1])}, and {parts[-1]}. Does that fit how you want me to be?"


if __name__ == "__main__":
    """Test settling standalone."""
    p = load_personality()
    print(f"Name: {p.get('name')}")
    print(f"Interactions: {p.get('interaction_count')}")
    print(f"Traits: {json.dumps(p['traits'], indent=2)}")

    if should_settle(p):
        print("\nRunning settling...")
        old_traits = dict(p["traits"])
        p = run_settling(p)
        digest = generate_settling_digest(old_traits, p["traits"])
        if digest:
            print(f"\nDigest: {digest}")
    else:
        print(f"\nNext settling at interaction {((p['interaction_count'] // SETTLING_INTERVAL) + 1) * SETTLING_INTERVAL}")
