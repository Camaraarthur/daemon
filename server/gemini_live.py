#!/usr/bin/env python3
"""
Gemini Live API client — handles real-time voice streaming.

Manages the WebSocket connection to Gemini 3.1 Flash Live,
audio relay, transcript capture, and system instruction injection.
"""

import asyncio
import os
import time
from typing import Callable, Optional
from dataclasses import dataclass, field

# Gemini Live config
MODEL = "gemini-3.1-flash-live-preview"
AUDIO_IN_MIME = "audio/pcm;rate=16000"
AUDIO_OUT_SAMPLE_RATE = 24000


def _get_google_key() -> str:
    vault = os.path.expanduser("~/.secrets/vault.env")
    if os.path.exists(vault):
        with open(vault) as f:
            for line in f:
                if line.startswith("GOOGLE_API_KEY="):
                    return line.split("=", 1)[1].strip().strip('"').strip("'")
    return os.environ.get("GOOGLE_API_KEY", "")


@dataclass
class TranscriptEntry:
    role: str  # "user" or "model"
    text: str
    timestamp: float


@dataclass
class LiveSession:
    """State for a single Gemini Live session."""
    transcript: list[TranscriptEntry] = field(default_factory=list)
    system_instruction: str = ""
    session_handle: Optional[str] = None
    connected: bool = False
    # Callbacks
    on_audio: Optional[Callable] = None
    on_user_transcript: Optional[Callable] = None   # live partial user text
    on_model_transcript: Optional[Callable] = None   # live partial model text
    on_user_turn_end: Optional[Callable] = None      # user finished speaking
    on_model_turn_end: Optional[Callable] = None     # model finished speaking
    on_connected: Optional[Callable] = None
    on_disconnected: Optional[Callable] = None
    # Internal
    _session: object = None
    _receive_task: Optional[asyncio.Task] = None
    _current_model_text: str = ""
    _current_user_text: str = ""
    _last_brain_user_text: str = ""
    _turn_count: int = 0


class GeminiLive:
    """Manages a Gemini Live streaming session."""

    def __init__(self):
        self._api_key = _get_google_key()
        self._client = None
        self._session_cm = None
        self.state: Optional[LiveSession] = None
        self._reconnecting = False

    async def connect(self, system_instruction: str, state: LiveSession) -> bool:
        """Connect to Gemini Live with the given system instruction."""
        from google import genai
        from google.genai import types

        self.state = state
        self.state.system_instruction = system_instruction

        if not self._client:
            self._client = genai.Client(api_key=self._api_key)

        config = types.LiveConnectConfig(
            response_modalities=[types.Modality.AUDIO],
            system_instruction=types.Content(
                parts=[types.Part(text=system_instruction)]
            ),
            input_audio_transcription=types.AudioTranscriptionConfig(),
            output_audio_transcription=types.AudioTranscriptionConfig(),
            context_window_compression=types.ContextWindowCompressionConfig(
                trigger_tokens=25600,
                sliding_window=types.SlidingWindow(target_tokens=12800),
            ),
            session_resumption=types.SessionResumptionConfig(
                handle=state.session_handle
            ) if state.session_handle else types.SessionResumptionConfig(),
            realtime_input_config=types.RealtimeInputConfig(
                automatic_activity_detection=types.AutomaticActivityDetection(
                    disabled=False,
                    start_of_speech_sensitivity=types.StartSensitivity.START_SENSITIVITY_LOW,
                    end_of_speech_sensitivity=types.EndSensitivity.END_SENSITIVITY_LOW,
                    prefix_padding_ms=100,
                    silence_duration_ms=2500,
                ),
                activity_handling=types.ActivityHandling.START_OF_ACTIVITY_INTERRUPTS,
            ),
            speech_config=types.SpeechConfig(
                language_code="en-US",
            ),
        )

        try:
            self._session_cm = self._client.aio.live.connect(
                model=MODEL, config=config
            )
            session = await self._session_cm.__aenter__()
            self.state._session = session
            self.state.connected = True
            self._reconnecting = False
            print(f"[gemini-live] Connected to {MODEL}")

            if self.state.on_connected:
                await self.state.on_connected()

            self.state._receive_task = asyncio.create_task(
                self._receive_loop()
            )
            return True
        except Exception as e:
            print(f"[gemini-live] Connection failed: {e}")
            self.state.connected = False
            self._reconnecting = False
            return False

    async def _receive_loop(self):
        """Process messages from Gemini Live. Runs continuously — never breaks on its own."""
        session = self.state._session
        try:
            async for response in session.receive():
                if not self.state.connected:
                    break

                # Audio output
                if response.server_content and response.server_content.model_turn:
                    for part in response.server_content.model_turn.parts:
                        if part.inline_data and part.inline_data.data:
                            if self.state.on_audio:
                                await self.state.on_audio(part.inline_data.data)

                # Output transcription — stream live to browser
                if response.server_content and response.server_content.output_transcription:
                    text = response.server_content.output_transcription.text
                    if text:
                        self.state._current_model_text += text
                        # Send partial transcript live
                        if self.state.on_model_transcript:
                            await self.state.on_model_transcript(text, partial=True)

                # Input transcription — stream live to browser
                if response.server_content and response.server_content.input_transcription:
                    text = response.server_content.input_transcription.text
                    if text:
                        self.state._current_user_text += text
                        # Send partial transcript live
                        if self.state.on_user_transcript:
                            await self.state.on_user_transcript(text, partial=True)

                # Turn complete — model finished speaking
                if response.server_content and response.server_content.turn_complete:
                    # Save completed user text
                    if self.state._current_user_text.strip():
                        user_entry = TranscriptEntry(
                            role="user",
                            text=self.state._current_user_text.strip(),
                            timestamp=time.time(),
                        )
                        self.state.transcript.append(user_entry)
                        print(f"[gemini-live] User: {user_entry.text[:100]}...")
                        if self.state.on_user_transcript:
                            await self.state.on_user_transcript(
                                self.state._current_user_text.strip(), partial=False
                            )
                        self.state._current_user_text = ""

                    # Save completed model text
                    if self.state._current_model_text.strip():
                        model_entry = TranscriptEntry(
                            role="model",
                            text=self.state._current_model_text.strip(),
                            timestamp=time.time(),
                        )
                        self.state.transcript.append(model_entry)
                        print(f"[gemini-live] Gemini: {model_entry.text[:100]}...")
                        if self.state.on_model_transcript:
                            await self.state.on_model_transcript(
                                self.state._current_model_text.strip(), partial=False
                            )
                        if self.state.on_model_turn_end:
                            await self.state.on_model_turn_end(model_entry.text)
                    self.state._current_model_text = ""

                    self.state._turn_count += 1

                    # Fire brain — but DON'T reconnect, just queue the update
                    last_user = ""
                    for e in reversed(self.state.transcript):
                        if e.role == "user":
                            last_user = e.text
                            break
                    if (last_user
                            and last_user != self.state._last_brain_user_text
                            and self.state.on_user_turn_end):
                        self.state._last_brain_user_text = last_user
                        # Fire as task so it doesn't block the receive loop
                        asyncio.create_task(
                            self.state.on_user_turn_end(
                                last_user, self.get_transcript_text()
                            )
                        )

                # Interrupted
                if response.server_content and response.server_content.interrupted:
                    if self.state._current_model_text.strip():
                        entry = TranscriptEntry(
                            role="model",
                            text=self.state._current_model_text.strip() + " [interrupted]",
                            timestamp=time.time(),
                        )
                        self.state.transcript.append(entry)
                    self.state._current_model_text = ""

                # Session resumption handle
                if response.session_resumption_update:
                    update = response.session_resumption_update
                    if update.resumable and update.new_handle:
                        self.state.session_handle = update.new_handle

                # Go away — auto-reconnect
                if response.go_away is not None:
                    print(f"[gemini-live] go_away received, reconnecting...")
                    asyncio.create_task(self._reconnect())

        except asyncio.CancelledError:
            print(f"[gemini-live] Receive loop cancelled")
        except Exception as e:
            print(f"[gemini-live] Receive loop error: {e}")
            if self.state.connected and not self._reconnecting:
                print(f"[gemini-live] Auto-reconnecting...")
                asyncio.create_task(self._reconnect())
                return
        finally:
            if not self._reconnecting:
                self.state.connected = False
                if self.state.on_disconnected:
                    await self.state.on_disconnected()

    async def send_audio(self, pcm_data: bytes):
        """Send PCM16 16kHz audio to Gemini."""
        if not self.state or not self.state.connected or not self.state._session:
            return
        from google.genai import types
        try:
            await self.state._session.send_realtime_input(
                audio=types.Blob(data=pcm_data, mime_type=AUDIO_IN_MIME)
            )
        except Exception as e:
            if "close" not in str(e).lower():
                print(f"[gemini-live] Send audio error: {e}")

    async def queue_instruction_update(self, new_instruction: str):
        """Queue an instruction update — will apply on next natural reconnect.

        Does NOT reconnect immediately. The instruction will be used when:
        - The ~10min connection limit triggers a go_away
        - Or we can do a gentle reconnect during a pause
        """
        self.state.system_instruction = new_instruction
        self.state._pending_instruction = new_instruction
        print(f"[gemini-live] Instruction queued ({len(new_instruction)} chars), "
              f"will apply on next reconnect")

    async def _reconnect(self, new_instruction: str = None):
        """Reconnect using session resumption."""
        if self._reconnecting:
            return

        self._reconnecting = True
        instruction = new_instruction or self.state.system_instruction
        handle = self.state.session_handle

        if self.state._receive_task:
            self.state._receive_task.cancel()
            try:
                await self.state._receive_task
            except (asyncio.CancelledError, Exception):
                pass

        try:
            if self._session_cm:
                await self._session_cm.__aexit__(None, None, None)
                self._session_cm = None
        except Exception:
            pass

        self.state.connected = False
        await asyncio.sleep(0.3)

        self.state.session_handle = handle
        success = await self.connect(instruction, self.state)

        if not success:
            print(f"[gemini-live] Reconnect failed, retrying in 2s...")
            await asyncio.sleep(2)
            self._reconnecting = False
            await self._reconnect(instruction)

    async def disconnect(self):
        """Cleanly disconnect."""
        if self.state:
            self.state.connected = False
            self._reconnecting = True
            if self.state._receive_task:
                self.state._receive_task.cancel()
            try:
                if self._session_cm:
                    await self._session_cm.__aexit__(None, None, None)
                    self._session_cm = None
            except Exception:
                pass
            self._reconnecting = False
            if self.state.on_disconnected:
                await self.state.on_disconnected()

    def get_transcript_text(self, last_n: int = 0) -> str:
        """Get transcript as formatted text."""
        entries = self.state.transcript
        if last_n > 0:
            entries = entries[-last_n:]
        lines = []
        for e in entries:
            role = "Arthur" if e.role == "user" else "Companion"
            lines.append(f"{role}: {e.text}")
        return "\n\n".join(lines)
