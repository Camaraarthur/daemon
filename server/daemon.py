#!/usr/bin/env python3
"""
Daemon — Main orchestrator.
Spawns Claude Code, feeds it events (voice, USB, user input),
manages personality settling, and routes responses.
"""

import asyncio
import json
import os
import sys
import subprocess
from pathlib import Path
from datetime import datetime, timezone

from personality import (
    load_personality, save_personality, create_default_personality,
    add_to_history, detect_name_from_response, should_settle,
    run_settling, generate_settling_digest,
)
from memory import (
    ensure_collection, store_conversation_turn,
    build_memory_context, get_memory_stats,
)
try:
    from knowledge import (
        ensure_collections as ensure_knowledge,
        build_knowledge_context, get_knowledge_stats,
        store_conversation_summary,
    )
    HAS_KNOWLEDGE = True
except ImportError:
    HAS_KNOWLEDGE = False

# Project paths
DAEMON_ROOT = Path(__file__).parent.parent
SERVER_DIR = Path(__file__).parent
CONFIG_DIR = DAEMON_ROOT / "config"
SOUL_PATH = DAEMON_ROOT / "SOUL.md"
MCP_CONFIG_PATH = CONFIG_DIR / "mcp_tools.json"

CONFIG_DIR.mkdir(exist_ok=True)


def build_system_prompt(personality: dict) -> str:
    """Build system prompt from SOUL.md + personality state."""
    soul_template = ""
    if SOUL_PATH.exists():
        with open(SOUL_PATH) as f:
            soul_template = f.read()

    traits = personality["traits"]
    trait_lines = []
    for trait, value in traits.items():
        if value < 0.3:
            level = "low"
        elif value < 0.7:
            level = "moderate"
        else:
            level = "high"
        trait_lines.append(f"  {trait}: {value:.2f} ({level})")

    name = personality.get("name") or "unnamed"
    memories = personality.get("memory_highlights", [])
    memory_block = "\n".join(f"  - {m}" for m in memories[-20:]) if memories else "  (none yet)"

    prompt = f"""{soul_template}

## Current State

Name: {name}
Created: {personality.get('created_at', 'unknown')}
Interactions: {personality.get('interaction_count', 0)}

### Personality Traits (0.0 = low, 1.0 = high)
{chr(10).join(trait_lines)}

### Memory Highlights
{memory_block}

## Behavior Guide

Your personality traits shape HOW you communicate:
- directness {traits['directness']:.1f} → {"get to the point, skip hedging" if traits['directness'] > 0.6 else "explain your reasoning, add context" if traits['directness'] < 0.4 else "balanced directness"}
- humor {traits['humor']:.1f} → {"be witty, playful observations welcome" if traits['humor'] > 0.6 else "stay focused, humor only when natural" if traits['humor'] < 0.4 else "occasional humor"}
- warmth {traits['warmth']:.1f} → {"personal, reference past conversations, ask about the user" if traits['warmth'] > 0.6 else "professional, focus on the task" if traits['warmth'] < 0.4 else "friendly but task-oriented"}
- initiative {traits['initiative']:.1f} → {"proactively suggest and act" if traits['initiative'] > 0.6 else "wait for instructions" if traits['initiative'] < 0.4 else "suggest when relevant"}
- formality {traits['formality']:.1f} → {"structured, proper" if traits['formality'] > 0.6 else "casual, conversational" if traits['formality'] < 0.4 else "natural tone"}

{"If the user hasn't named you yet, start with: I'm here. Give me a name." if name == "unnamed" else ""}
"""
    return prompt


class DaemonProcess:
    """Manages Claude Code subprocess + personality lifecycle."""

    def __init__(self, model: str = "opus"):
        self.model = model
        self.session_id = None
        self.personality = load_personality()

    async def send_message(self, message: str) -> str:
        """Send message to Claude Code, return response."""
        system_prompt = build_system_prompt(self.personality)

        # Retrieve relevant knowledge + memories for this message
        if HAS_KNOWLEDGE:
            try:
                knowledge_context = build_knowledge_context(message, limit=5)
                if knowledge_context:
                    system_prompt += "\n\n" + knowledge_context
            except Exception as e:
                print(f"[knowledge] Recall failed: {e}")
        try:
            memory_context = build_memory_context(message, limit=3)
            if memory_context:
                system_prompt += "\n\n" + memory_context
        except Exception as e:
            print(f"[memory] Recall failed: {e}")

        cmd = [
            "claude", "-p", message,
            "--output-format", "json",
            "--model", self.model,
            "--system-prompt", system_prompt,
            "--permission-mode", "auto",
        ]

        # Add MCP tools if config exists
        if MCP_CONFIG_PATH.exists():
            cmd.extend(["--mcp-config", str(MCP_CONFIG_PATH)])
            cmd.extend([
                "--allowed-tools",
                "Bash", "Read", "Write", "Edit", "Glob", "Grep",
                "mcp__daemon-tools__ssh_run",
                "mcp__daemon-tools__list_devices",
                "mcp__daemon-tools__device_info",
                "mcp__daemon-tools__list_usb_devices",
                "mcp__daemon-tools__scan_i2c",
            ])

        # Resume session for conversation continuity
        if self.session_id:
            cmd.extend(["--resume", self.session_id])

        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await proc.communicate()

        if proc.returncode != 0:
            error = stderr.decode().strip()[:500]
            print(f"[daemon] Error: {error}")
            return f"[error communicating with Claude: {error[:100]}]"

        try:
            result = json.loads(stdout.decode())
            self.session_id = result.get("session_id")
            response_text = result.get("result", "")

            # Track interaction
            self.personality["interaction_count"] += 1
            save_personality(self.personality)

            # Save to history
            add_to_history("user", message)
            add_to_history("daemon", response_text)

            # Store in long-term memory (Qdrant)
            try:
                store_conversation_turn(
                    message, response_text,
                    daemon_name=self.personality.get("name", "daemon"),
                )
            except Exception as e:
                print(f"[memory] Store failed: {e}")

            return response_text
        except json.JSONDecodeError:
            return stdout.decode().strip()

    def process_response(self, user_msg: str, response: str):
        """Post-process a response: name detection, settling, etc."""
        # Name detection
        if not self.personality.get("name"):
            detected = detect_name_from_response(user_msg, response, self.personality)
            if detected:
                self.personality["name"] = detected
                save_personality(self.personality)
                print(f"[daemon] Name detected: {detected}")

        # Check if settling is due
        if should_settle(self.personality):
            print("[daemon] Running settling algorithm...")
            old_traits = dict(self.personality["traits"])
            self.personality = run_settling(self.personality)
            digest = generate_settling_digest(old_traits, self.personality["traits"])
            if digest:
                print(f"[settling] {digest}")
                # Could inject this as a daemon message next turn


async def interactive_loop(daemon: DaemonProcess):
    """Interactive text loop."""
    print("\n" + "=" * 60)
    name = daemon.personality.get("name")
    if name:
        print(f"  DAEMON [{name}] — Interactive Mode")
    else:
        print("  DAEMON — Interactive Mode (unnamed)")
    print("  Type a message. Ctrl+C to exit.")
    print("=" * 60 + "\n")

    # First-time intro
    if not daemon.personality.get("name") and daemon.personality.get("interaction_count", 0) == 0:
        response = await daemon.send_message(
            "(The user just started the daemon for the first time. "
            "You have no name yet. Introduce yourself briefly.)"
        )
        print(f"[daemon]: {response}\n")
        daemon.process_response("", response)

    while True:
        try:
            user_input = await asyncio.get_event_loop().run_in_executor(
                None, lambda: input("[you]: ")
            )
            if not user_input.strip():
                continue

            response = await daemon.send_message(user_input)
            print(f"\n[{daemon.personality.get('name', 'daemon')}]: {response}\n")

            # Post-process
            daemon.process_response(user_input, response)

        except (KeyboardInterrupt, EOFError):
            print(f"\n[daemon] Shutting down. Interactions: {daemon.personality['interaction_count']}")
            save_personality(daemon.personality)
            break


async def main():
    """Entry point."""
    personality = load_personality()
    name = personality.get("name", "unnamed")
    count = personality.get("interaction_count", 0)
    print(f"[daemon] Personality: {name} ({count} interactions)")
    print(f"[daemon] Traits: {json.dumps(personality['traits'])}")

    # Initialize memory + knowledge
    try:
        ensure_collection()
        stats = get_memory_stats()
        print(f"[daemon] Memory: {stats['total_memories']} memories")
    except Exception as e:
        print(f"[daemon] Memory unavailable: {e}")

    if HAS_KNOWLEDGE:
        try:
            ensure_knowledge()
            kstats = get_knowledge_stats()
            total = sum(kstats.values())
            print(f"[daemon] Knowledge: {total} entries ({kstats})")
        except Exception as e:
            print(f"[daemon] Knowledge unavailable: {e}")

    daemon = DaemonProcess(model="opus")

    # USB event queue
    usb_event_queue = asyncio.Queue()
    loop = asyncio.get_event_loop()

    def on_usb_event(event):
        asyncio.run_coroutine_threadsafe(usb_event_queue.put(event), loop)

    # Start USB monitor
    try:
        from devices import DeviceMonitor, configure_audio_device
        device_monitor = DeviceMonitor(on_event=on_usb_event)
        asyncio.create_task(device_monitor.start())
    except ImportError:
        print("[daemon] USB monitoring unavailable (pyudev not installed)")
        device_monitor = None

    # Voice pipeline
    voice_pipeline = None
    if "--voice" in sys.argv:
        try:
            from voice import VoicePipeline

            async def on_voice(text: str):
                response = await daemon.send_message(text)
                name = daemon.personality.get("name", "daemon")
                print(f"\n[{name}]: {response}\n")
                daemon.process_response(text, response)
                if voice_pipeline:
                    await voice_pipeline.speak(response)

            voice_pipeline = VoicePipeline(on_transcript=on_voice)
            asyncio.create_task(voice_pipeline.start_listening())
            print("[daemon] Voice pipeline active.")
        except ImportError:
            print("[daemon] Voice deps not installed (deepgram-sdk, sounddevice)")

    # USB event processor
    async def process_usb():
        while True:
            event = await usb_event_queue.get()
            if device_monitor:
                msg = device_monitor.format_event_for_daemon(event)
                if msg:
                    print(f"\n{msg}")
                    if event["type"] == "audio" and event["action"] == "add":
                        try:
                            from devices import configure_audio_device
                            await configure_audio_device()
                        except:
                            pass

    asyncio.create_task(process_usb())

    # Run
    await interactive_loop(daemon)

    # Cleanup
    if device_monitor:
        device_monitor.stop()
    if voice_pipeline:
        voice_pipeline.stop()


if __name__ == "__main__":
    asyncio.run(main())
