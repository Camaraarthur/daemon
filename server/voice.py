#!/usr/bin/env python3
"""
Voice Pipeline — Deepgram streaming STT + TTS output.
Handles mic input → transcription → daemon → TTS response.
"""

import asyncio
import json
import os
import sys
from typing import Callable, Optional

# Get Deepgram key from vault
def get_deepgram_key() -> Optional[str]:
    """Load Deepgram API key from vault."""
    vault_path = os.path.expanduser("~/.secrets/vault.env")
    if os.path.exists(vault_path):
        with open(vault_path) as f:
            for line in f:
                if line.startswith("DEEPGRAM_API_KEY="):
                    return line.split("=", 1)[1].strip().strip('"').strip("'")
    return os.environ.get("DEEPGRAM_API_KEY")


class VoicePipeline:
    """Streaming voice input/output pipeline."""

    def __init__(self, on_transcript: Optional[Callable] = None):
        self.on_transcript = on_transcript
        self._running = False
        self._deepgram_key = get_deepgram_key()

    async def start_listening(self, device_index: Optional[int] = None):
        """Start streaming mic audio to Deepgram for transcription."""
        if not self._deepgram_key:
            print("[voice] No Deepgram API key found. Voice input disabled.")
            print("[voice] Set DEEPGRAM_API_KEY in ~/.secrets/vault.env")
            return

        try:
            from deepgram import DeepgramClient, LiveTranscriptionEvents, LiveOptions
        except ImportError:
            print("[voice] deepgram-sdk not installed. Install with: pip install deepgram-sdk")
            return

        try:
            import sounddevice as sd
        except ImportError:
            print("[voice] sounddevice not installed. Install with: pip install sounddevice")
            return

        self._running = True
        print("[voice] Connecting to Deepgram...")

        dg = DeepgramClient(self._deepgram_key)
        connection = dg.listen.asyncwebsocket.v("1")

        transcript_buffer = []

        @connection.on(LiveTranscriptionEvents.Transcript)
        async def on_transcript(self_dg, result, **kwargs):
            try:
                alt = result.channel.alternatives[0]
                transcript = alt.transcript
                is_final = result.is_final

                if transcript.strip():
                    if is_final:
                        full_text = transcript.strip()
                        print(f"[voice] Heard: {full_text}")
                        if self.on_transcript:
                            await self.on_transcript(full_text)
                    else:
                        # Interim result — could show as "listening..." indicator
                        pass
            except Exception as e:
                print(f"[voice] Transcript error: {e}")

        @connection.on(LiveTranscriptionEvents.Error)
        async def on_error(self_dg, error, **kwargs):
            print(f"[voice] Deepgram error: {error}")

        options = LiveOptions(
            model="nova-3",
            language="en",
            smart_format=True,
            interim_results=True,
            endpointing=300,  # ms of silence before finalizing
            vad_events=True,
        )

        success = await connection.start(options)
        if not success:
            print("[voice] Failed to connect to Deepgram")
            return

        print("[voice] Listening... (Ctrl+C to stop)")

        # Stream audio from mic
        # Most HDA Intel cards need 48kHz — Deepgram handles resampling
        sample_rate = 48000
        channels = 1
        blocksize = 4096

        def audio_callback(indata, frames, time_info, status):
            if status:
                print(f"[voice] Audio status: {status}")
            if self._running:
                # Send raw audio bytes to Deepgram
                asyncio.run_coroutine_threadsafe(
                    connection.send(indata.tobytes()),
                    asyncio.get_event_loop()
                )

        try:
            kwargs = {
                "samplerate": sample_rate,
                "channels": channels,
                "blocksize": blocksize,
                "dtype": "int16",
                "callback": audio_callback,
            }
            if device_index is not None:
                kwargs["device"] = device_index

            with sd.InputStream(**kwargs):
                while self._running:
                    await asyncio.sleep(0.1)
        except Exception as e:
            print(f"[voice] Audio stream error: {e}")
        finally:
            await connection.finish()

    async def speak(self, text: str, use_elevenlabs: bool = False):
        """Convert text to speech and play it."""
        if use_elevenlabs:
            await self._speak_elevenlabs(text)
        else:
            await self._speak_local(text)

    async def _speak_local(self, text: str):
        """Use system TTS (espeak/piper) for speech output."""
        try:
            proc = await asyncio.create_subprocess_exec(
                "espeak-ng", "-s", "160", text,
                stdout=asyncio.subprocess.DEVNULL,
                stderr=asyncio.subprocess.DEVNULL,
            )
            await proc.wait()
        except FileNotFoundError:
            # Try piper as fallback
            try:
                proc = await asyncio.create_subprocess_exec(
                    "piper", "--model", "en_US-lessac-medium",
                    stdin=asyncio.subprocess.PIPE,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.DEVNULL,
                )
                stdout, _ = await proc.communicate(input=text.encode())
                # Play the WAV output
                play = await asyncio.create_subprocess_exec(
                    "aplay", "-",
                    stdin=asyncio.subprocess.PIPE,
                    stdout=asyncio.subprocess.DEVNULL,
                    stderr=asyncio.subprocess.DEVNULL,
                )
                await play.communicate(input=stdout)
            except FileNotFoundError:
                print(f"[voice] No TTS available. Install espeak-ng or piper.")

    async def _speak_elevenlabs(self, text: str):
        """Use ElevenLabs API for high-quality speech."""
        # TODO: Implement ElevenLabs TTS
        # For now, fall back to local
        await self._speak_local(text)

    def stop(self):
        """Stop the voice pipeline."""
        self._running = False

    @staticmethod
    def list_audio_devices() -> list:
        """List available audio input devices."""
        try:
            import sounddevice as sd
            devices = sd.query_devices()
            inputs = []
            for i, d in enumerate(devices):
                if d["max_input_channels"] > 0:
                    inputs.append({
                        "index": i,
                        "name": d["name"],
                        "channels": d["max_input_channels"],
                        "sample_rate": d["default_samplerate"],
                    })
            return inputs
        except ImportError:
            return []


if __name__ == "__main__":
    """Test voice pipeline standalone."""
    async def on_heard(text: str):
        print(f">>> TRANSCRIPT: {text}")

    pipeline = VoicePipeline(on_transcript=on_heard)

    print("Available audio devices:")
    for d in pipeline.list_audio_devices():
        print(f"  [{d['index']}] {d['name']} ({d['channels']}ch, {d['sample_rate']}Hz)")

    asyncio.run(pipeline.start_listening())
