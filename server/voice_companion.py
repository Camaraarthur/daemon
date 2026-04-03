#!/usr/bin/env python3
"""
Voice Companion Server — The orchestrator.

Bridges browser audio ↔ Gemini Live, with Claude Code as background brain.

Architecture:
  Browser (WebSocket :4803) → this server → Gemini Live API
                                          → Claude Brain (subprocess)
                                          → Qdrant (personal data)

Protocol (browser ↔ server):
  Client sends: { "type": "audio", "data": "<base64 PCM16 16kHz>" }
  Client sends: { "type": "connect" }
  Client sends: { "type": "disconnect" }

  Server sends: { "type": "audio", "data": "<base64 PCM16 24kHz>" }
  Server sends: { "type": "transcript", "role": "user"|"model", "text": "..." }
  Server sends: { "type": "status", "state": "connected"|"disconnected"|"thinking" }
  Server sends: { "type": "brain_update", "action": "FAST"|"DEEP"|"PASS", "count": N }
"""

import asyncio
import base64
import json
import os
import sys
import time
from pathlib import Path

import aiohttp
from aiohttp import web

# Add server dir to path
sys.path.insert(0, str(Path(__file__).parent))

from gemini_live import GeminiLive, LiveSession
from claude_brain import ClaudeBrain

PORT = 4803
PERSONA = """You are a voice companion for Arthur — warm, insightful, and genuinely curious about his inner life.

You're having a real-time voice conversation. Arthur has a rich personal database (years of messages, notes, recordings) that a background system searches and feeds you context from in real-time. Use this context naturally — reference specific things from his history when relevant, but don't dump data. Weave it into the conversation like someone who actually knows him.

Your style:
- Natural, conversational voice — short sentences, natural pauses
- Ask probing follow-up questions, not just "how does that make you feel"
- Name patterns you notice: "That's the third time you've mentioned freezing up in group settings"
- Be direct and honest — Arthur values truth over comfort
- Draw from psychology and research when it helps, but keep it practical
- Remember: you're talking, not writing. Keep it concise.

You are NOT a therapist. You're a smart companion who knows Arthur deeply and can help him see himself clearly. Think of it like talking to the most insightful friend imaginable, who also happens to have a perfect memory of everything Arthur has ever said or written."""


class VoiceCompanionServer:
    """Main orchestrator server."""

    def __init__(self):
        self.gemini = GeminiLive()
        self.brain = ClaudeBrain(user_name="Arthur")
        self.brain.set_base_persona(PERSONA)
        self._ws_clients: set[web.WebSocketResponse] = set()
        self._session: LiveSession = None
        self._hold_active = False
        self._hold_buffer: list[bytes] = []

    async def handle_websocket(self, request: web.Request) -> web.WebSocketResponse:
        """Handle browser WebSocket connection."""
        ws = web.WebSocketResponse()
        await ws.prepare(request)
        self._ws_clients.add(ws)
        print(f"[server] Browser connected ({len(self._ws_clients)} clients)")

        try:
            async for msg in ws:
                if msg.type == aiohttp.WSMsgType.TEXT:
                    data = json.loads(msg.data)
                    await self._handle_message(data, ws)
                elif msg.type == aiohttp.WSMsgType.BINARY:
                    # Raw audio binary
                    await self._handle_audio(msg.data)
                elif msg.type == aiohttp.WSMsgType.ERROR:
                    print(f"[server] WS error: {ws.exception()}")
        except Exception as e:
            print(f"[server] WS handler error: {e}")
        finally:
            self._ws_clients.discard(ws)
            print(f"[server] Browser disconnected ({len(self._ws_clients)} clients)")

        return ws

    async def _handle_message(self, data: dict, ws: web.WebSocketResponse):
        """Process a message from the browser."""
        msg_type = data.get("type")

        if msg_type == "connect":
            await self._start_session()

        elif msg_type == "disconnect":
            await self._stop_session()

        elif msg_type == "audio":
            # Base64-encoded PCM audio from browser
            audio_bytes = base64.b64decode(data["data"])
            await self._handle_audio(audio_bytes)

        elif msg_type == "hold_start":
            self._hold_active = True
            self._hold_buffer = []
            print("[server] Hold mode ON — buffering audio")
            await self._broadcast({"type": "hold", "active": True})

        elif msg_type == "hold_stop":
            self._hold_active = False
            print(f"[server] Hold mode OFF — flushing {len(self._hold_buffer)} chunks")
            # Flush all buffered audio to Gemini at once
            if self.gemini.state and self.gemini.state.connected:
                for chunk in self._hold_buffer:
                    await self.gemini.send_audio(chunk)
            self._hold_buffer = []
            await self._broadcast({"type": "hold", "active": False})

    async def _handle_audio(self, pcm_data: bytes):
        """Forward audio from browser to Gemini, or buffer if held."""
        if self._hold_active:
            self._hold_buffer.append(pcm_data)
            return
        if self.gemini.state and self.gemini.state.connected:
            await self.gemini.send_audio(pcm_data)

    async def _start_session(self):
        """Start a new Gemini Live session with Claude brain."""
        print("[server] Starting voice session...")
        await self._broadcast({"type": "status", "state": "connecting"})

        # Build initial instruction
        initial_instruction = self.brain.build_initial_instruction()

        # Set up session callbacks
        self._session = LiveSession(
            on_audio=self._on_gemini_audio,
            on_user_transcript=self._on_user_transcript,
            on_model_transcript=self._on_model_transcript,
            on_user_turn_end=self._on_user_turn_end,
            on_model_turn_end=self._on_model_turn_end,
            on_connected=self._on_gemini_connected,
            on_disconnected=self._on_gemini_disconnected,
        )

        success = await self.gemini.connect(initial_instruction, self._session)
        if not success:
            await self._broadcast({
                "type": "status",
                "state": "error",
                "message": "Failed to connect to Gemini Live",
            })

    async def _stop_session(self):
        """Stop the current session."""
        print("[server] Stopping voice session...")
        if self.gemini:
            await self.gemini.disconnect()
        await self._broadcast({"type": "status", "state": "disconnected"})

    async def _on_gemini_audio(self, audio_data: bytes):
        """Forward Gemini audio to all browser clients."""
        msg = json.dumps({
            "type": "audio",
            "data": base64.b64encode(audio_data).decode(),
        })
        await self._broadcast_raw(msg)

    async def _on_user_transcript(self, text: str, partial: bool = True):
        """Live user speech transcription — stream to browser."""
        await self._broadcast({
            "type": "transcript",
            "role": "user",
            "text": text,
            "partial": partial,
        })

    async def _on_model_transcript(self, text: str, partial: bool = True):
        """Live model speech transcription — stream to browser."""
        await self._broadcast({
            "type": "transcript",
            "role": "model",
            "text": text,
            "partial": partial,
        })

    async def _on_user_turn_end(self, user_text: str, full_transcript: str):
        """User finished speaking — fire Claude brain in background."""
        # Notify browser that brain is thinking
        await self._broadcast({
            "type": "brain_update",
            "action": "THINKING",
            "count": self.brain.state.update_count,
        })

        # Fire Claude brain analysis — completely async, never blocks conversation
        await self.brain.on_user_turn(
            user_text,
            full_transcript,
            callback=self._on_brain_update,
        )

    async def _on_model_turn_end(self, model_text: str):
        """Gemini finished speaking. Session stays alive — keep listening."""
        pass  # Transcript already sent via _on_model_transcript

    async def _on_brain_update(self, new_instruction: str):
        """Claude brain produced an update — queue it, don't reconnect mid-conversation."""
        # Queue instruction — will apply on next natural reconnect (go_away)
        await self.gemini.queue_instruction_update(new_instruction)

        await self._broadcast({
            "type": "brain_update",
            "action": "QUEUED",
            "count": self.brain.state.update_count,
        })

    async def _on_gemini_connected(self):
        """Gemini session established."""
        await self._broadcast({"type": "status", "state": "connected"})

    async def _on_gemini_disconnected(self):
        """Gemini session dropped — only notify browser if not reconnecting."""
        if self.gemini and self.gemini._reconnecting:
            # Silent reconnect — don't tell browser, audio will resume shortly
            await self._broadcast({"type": "brain_update", "action": "RECONNECTING", "count": self.brain.state.update_count})
        else:
            await self._broadcast({"type": "status", "state": "disconnected"})

    async def _broadcast(self, data: dict):
        """Send JSON to all connected browser clients."""
        msg = json.dumps(data)
        await self._broadcast_raw(msg)

    async def _broadcast_raw(self, msg: str):
        """Send raw string to all connected browser clients."""
        dead = set()
        for ws in self._ws_clients:
            try:
                await ws.send_str(msg)
            except Exception:
                dead.add(ws)
        self._ws_clients -= dead

    async def handle_health(self, request: web.Request) -> web.Response:
        """Health check endpoint."""
        state = "connected" if (self._session and self._session.connected) else "idle"
        return web.json_response({
            "status": "ok",
            "state": state,
            "brain_updates": self.brain.state.update_count if self.brain else 0,
            "transcript_length": len(self._session.transcript) if self._session else 0,
            "clients": len(self._ws_clients),
        })

    async def handle_transcript(self, request: web.Request) -> web.Response:
        """Get full transcript."""
        if not self._session:
            return web.json_response({"transcript": []})

        entries = [
            {
                "role": e.role,
                "text": e.text,
                "timestamp": e.timestamp,
            }
            for e in self._session.transcript
        ]
        return web.json_response({"transcript": entries})


def create_app() -> web.Application:
    """Create the aiohttp application."""
    server = VoiceCompanionServer()
    app = web.Application()
    app.router.add_get("/ws", server.handle_websocket)
    app.router.add_get("/health", server.handle_health)
    app.router.add_get("/transcript", server.handle_transcript)

    # CORS for local dev
    @web.middleware
    async def cors_middleware(request, handler):
        if request.method == "OPTIONS":
            response = web.Response()
        else:
            response = await handler(request)
        response.headers["Access-Control-Allow-Origin"] = "*"
        response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
        response.headers["Access-Control-Allow-Headers"] = "Content-Type"
        return response

    app.middlewares.append(cors_middleware)
    return app


if __name__ == "__main__":
    print(f"[voice-companion] Starting on port {PORT}")
    print(f"[voice-companion] WebSocket: ws://localhost:{PORT}/ws")
    print(f"[voice-companion] Health: http://localhost:{PORT}/health")
    app = create_app()
    web.run_app(app, port=PORT, print=lambda msg: print(f"[voice-companion] {msg}"))
