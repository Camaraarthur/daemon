#!/usr/bin/env python3
"""
Claude Brain — Background intelligence for voice companion.

On each user turn:
1. Receives transcript + last exchange
2. Decides: FAST (quick context update), DEEP (Qdrant search + research), or PASS
3. Returns updated system instruction for Gemini

Claude Code runs as subprocess. The brain maintains a running analysis
that gets progressively deeper as the conversation continues.
"""

import asyncio
import json
import os
import subprocess
import time
from typing import Optional
from dataclasses import dataclass, field

from knowledge import recall_knowledge, build_knowledge_context

QDRANT_URL = "http://localhost:6333"


@dataclass
class BrainState:
    """Tracks the brain's understanding across the conversation."""
    base_persona: str = ""
    current_analysis: str = ""
    topics_explored: list[str] = field(default_factory=list)
    qdrant_findings: list[str] = field(default_factory=list)
    update_count: int = 0
    last_update_time: float = 0
    conversation_themes: list[str] = field(default_factory=list)


class ClaudeBrain:
    """Background AI that watches conversation and updates Gemini's context."""

    def __init__(self, user_name: str = "Arthur"):
        self.user_name = user_name
        self.state = BrainState()
        self._update_lock = asyncio.Lock()
        self._pending_task: Optional[asyncio.Task] = None

    def set_base_persona(self, persona: str):
        """Set the base persona/system instruction template."""
        self.state.base_persona = persona

    async def on_user_turn(
        self,
        user_text: str,
        full_transcript: str,
        callback: callable,
    ):
        """Called when user finishes speaking. Fires analysis."""
        # Cancel any pending deep analysis if user spoke again
        if self._pending_task and not self._pending_task.done():
            self._pending_task.cancel()

        # Always fire — Claude decides fast/deep/pass
        self._pending_task = asyncio.create_task(
            self._analyze_and_update(user_text, full_transcript, callback)
        )

    async def _analyze_and_update(
        self,
        user_text: str,
        full_transcript: str,
        callback: callable,
    ):
        """Run Claude analysis and push update if needed."""
        async with self._update_lock:
            start = time.time()

            # Step 1: Quick Qdrant search on what user just said
            qdrant_context = await self._search_qdrant(user_text)

            # Step 2: Ask Claude to analyze and decide
            instruction = await self._ask_claude(
                user_text, full_transcript, qdrant_context
            )

            if instruction:
                elapsed = time.time() - start
                self.state.update_count += 1
                self.state.last_update_time = time.time()
                print(f"[brain] Update #{self.state.update_count} ready ({elapsed:.1f}s)")

                # Push to Gemini via callback
                await callback(instruction)

    async def _search_qdrant(self, query: str) -> str:
        """Search Qdrant for relevant personal data."""
        try:
            # Run in executor since qdrant_client is sync
            loop = asyncio.get_event_loop()
            results = await loop.run_in_executor(None, recall_knowledge, query, 8)

            findings = []
            for collection, items in results.items():
                for item in items:
                    score = item.get("score", 0)
                    if score < 0.45:
                        continue
                    # Format based on collection type
                    if "entities" in collection:
                        findings.append(
                            f"[Entity] {item.get('name', '?')} ({item.get('type', '?')}): "
                            f"{item.get('description', '')}"
                        )
                    elif "facts" in collection:
                        findings.append(
                            f"[Fact about {item.get('about', '?')}] {item.get('fact', '')}"
                        )
                    elif "preferences" in collection:
                        findings.append(
                            f"[Preference] {item.get('preference', '')} "
                            f"(strength: {item.get('strength', '')})"
                        )
                    elif "events" in collection:
                        findings.append(
                            f"[Event] {item.get('event', '')} "
                            f"({item.get('when', 'unknown date')})"
                        )
                    elif "conversations" in collection:
                        findings.append(
                            f"[Past conversation] {item.get('summary', '')}"
                        )

            # Also search the larger business collections for deeper context
            if findings or len(query.split()) > 3:
                extra = await self._search_large_collections(query)
                findings.extend(extra)

            self.state.qdrant_findings = findings
            return "\n".join(findings) if findings else ""

        except Exception as e:
            print(f"[brain] Qdrant search error: {e}")
            return ""

    async def _search_large_collections(self, query: str) -> list[str]:
        """Search the larger insight collections (contacts, knowledge base)."""
        try:
            from google import genai
            from qdrant_client import QdrantClient
            from knowledge import _get_google_key, _embed

            loop = asyncio.get_event_loop()
            vectors = await loop.run_in_executor(None, _embed, [query])

            client = QdrantClient(url=QDRANT_URL)
            findings = []

            # Search CRA knowledge base
            for collection in ["cra_knowledge", "insights_contacts"]:
                try:
                    # These use 768-dim embeddings, different model
                    # Skip if we can't match dimensions
                    info = client.get_collection(collection)
                    if info.config.params.vectors.size != len(vectors[0]):
                        continue

                    hits = client.query_points(
                        collection_name=collection,
                        query=vectors[0],
                        limit=3,
                        with_payload=True,
                    )
                    for p in hits.points:
                        if p.score > 0.5:
                            payload = p.payload
                            if "full_name" in payload:
                                findings.append(
                                    f"[Contact] {payload.get('full_name', '')} — "
                                    f"{payload.get('role', '')} at {payload.get('company', '')}"
                                )
                            elif "text" in payload:
                                findings.append(
                                    f"[Knowledge] {str(payload.get('text', ''))[:200]}"
                                )
                except Exception:
                    pass

            return findings
        except Exception as e:
            print(f"[brain] Large collection search error: {e}")
            return []

    async def _ask_claude(
        self,
        user_text: str,
        full_transcript: str,
        qdrant_context: str,
    ) -> Optional[str]:
        """Ask Claude to analyze the conversation and produce updated instruction."""

        # Keep transcript manageable — last ~20 exchanges
        transcript_lines = full_transcript.split("\n\n")
        if len(transcript_lines) > 40:
            transcript_lines = transcript_lines[-40:]
        recent_transcript = "\n\n".join(transcript_lines)

        prompt = f"""You are the background brain for a voice companion talking to {self.user_name}.

Gemini Flash Live is having a real-time voice conversation with {self.user_name}. You watch the transcript and update Gemini's system instruction to make it smarter mid-conversation.

## What just happened
{self.user_name} just said: "{user_text}"

## Full conversation so far
{recent_transcript}

## Personal data from {self.user_name}'s database (Qdrant search results)
{qdrant_context if qdrant_context else "(no relevant data found for this turn)"}

## Previous analysis context
{self.state.current_analysis if self.state.current_analysis else "(first turn — no prior analysis)"}

## Your job

Decide one of:

**FAST** — Write an updated system instruction for Gemini. Do this when:
- You found relevant personal data that Gemini should know about
- The conversation is going in a direction where context would help
- Gemini said something generic that could be more specific
- You spotted a pattern worth exploring

**DEEP** — Write an updated system instruction AND flag topics for deeper research. Do this when:
- {self.user_name} mentioned something emotionally significant
- A pattern is emerging across multiple data points
- The topic deserves proper psychological/research framing

**PASS** — Return nothing. Do this ONLY when:
- The conversation is flowing well and Gemini has enough context
- It's small talk or a brief exchange that doesn't need enrichment

## Output format

Return ONLY a JSON object, no markdown, no explanation:

For FAST or DEEP:
{{
  "action": "FAST" or "DEEP",
  "system_instruction": "The complete updated system instruction for Gemini (include persona + all context)",
  "analysis_notes": "Brief notes on what you noticed (for your own memory next turn)",
  "deep_research_topics": ["topic1", "topic2"] // only for DEEP, empty for FAST
}}

For PASS:
{{
  "action": "PASS",
  "analysis_notes": "Brief notes on current conversation state"
}}

IMPORTANT:
- The system_instruction must be COMPLETE — it replaces the entire instruction, not a diff
- Include the base persona, current findings, suggested directions
- Be specific to {self.user_name}'s actual data, not generic
- Keep instructions under 4000 tokens
- Never mention that you're a background process or that instructions are being updated"""

        try:
            proc = await asyncio.create_subprocess_exec(
                "claude", "-p", prompt,
                "--output-format", "json",
                "--model", "sonnet",
                "--no-session-persistence",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, stderr = await proc.communicate()

            if proc.returncode != 0:
                error = stderr.decode()[:200]
                print(f"[brain] Claude error: {error}")
                return None

            result = json.loads(stdout.decode())
            response_text = result.get("result", "")

            # Parse JSON from response
            import re
            json_match = re.search(r'\{[\s\S]*\}', response_text)
            if not json_match:
                print(f"[brain] Could not parse Claude response")
                return None

            decision = json.loads(json_match.group())
            action = decision.get("action", "PASS")

            # Save analysis notes for next turn
            notes = decision.get("analysis_notes", "")
            if notes:
                self.state.current_analysis = notes

            if action == "PASS":
                print(f"[brain] PASS — {notes[:80]}")
                return None

            instruction = decision.get("system_instruction", "")
            if not instruction:
                return None

            # Track topics for DEEP research
            if action == "DEEP":
                topics = decision.get("deep_research_topics", [])
                if topics:
                    self.state.topics_explored.extend(topics)
                    print(f"[brain] DEEP — researching: {topics}")
                    # Fire deep research in background
                    asyncio.create_task(
                        self._deep_research(topics, instruction)
                    )

            print(f"[brain] {action} — updating Gemini instruction")
            return instruction

        except asyncio.CancelledError:
            print(f"[brain] Analysis cancelled (user spoke again)")
            return None
        except Exception as e:
            print(f"[brain] Analysis error: {e}")
            return None

    async def _deep_research(self, topics: list[str], current_instruction: str):
        """Run deeper research on flagged topics. Results feed into next update."""
        for topic in topics[:3]:  # Max 3 parallel deep dives
            try:
                # Deeper Qdrant search
                deep_context = await self._search_qdrant(topic)
                if deep_context:
                    self.state.qdrant_findings.extend(
                        [f"[Deep: {topic}] {line}" for line in deep_context.split("\n") if line]
                    )
                    print(f"[brain] Deep research on '{topic}': {len(deep_context)} chars found")
            except Exception as e:
                print(f"[brain] Deep research error for '{topic}': {e}")

    def build_initial_instruction(self, extra_context: str = "") -> str:
        """Build the initial system instruction for Gemini before conversation starts."""
        return f"""{self.state.base_persona}

## Live Context

This section gets updated in real-time as the conversation progresses.
The background analysis system will inject findings from {self.user_name}'s personal database,
spotted patterns, and relevant research here.

{extra_context}

## Conversation Guidelines

- Be natural, warm, and conversational — this is a voice chat, not a text interface
- Ask follow-up questions that dig deeper, don't just acknowledge
- When you notice a pattern, name it clearly and ask if it resonates
- Use specific examples from the context provided, never make up data
- If something feels emotionally significant, slow down and explore it
- Keep responses concise for voice — 2-4 sentences usually, longer only when going deep
- You can be direct and even challenging when appropriate — {self.user_name} values honesty over comfort"""
