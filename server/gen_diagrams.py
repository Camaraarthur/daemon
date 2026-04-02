#!/usr/bin/env python3
"""Generate architecture diagrams for daemon pitch deck using Nano Banana 2."""

import os
import base64
import time
from pathlib import Path
from google import genai

# Load API key
key = ""
with open(os.path.expanduser("~/.secrets/vault.env")) as f:
    for line in f:
        if line.startswith("GOOGLE_API_KEY="):
            key = line.split("=", 1)[1].strip().strip('"').strip("'")

client = genai.Client(api_key=key)
MODEL = "gemini-3.1-flash-image-preview"
OUTPUT_DIR = Path("/tmp/daemon-diagrams")
OUTPUT_DIR.mkdir(exist_ok=True)

STYLE = """
STRICT STYLE RULES for ALL images:
- Dark charcoal/near-black background (#1a1a1a)
- Color palette ONLY: red (#ff0505), blue (#0050db), light grey (#bfbfbf), white (#ffffff)
- Use smooth gradients between red and blue for accent elements
- Text in white or light grey, clean sans-serif font (Arial/Helvetica style)
- Minimalist, modern tech aesthetic — like a premium pitch deck slide
- No 3D effects, no drop shadows, no gradients on text
- Clean lines, generous spacing, professional infographic style
- Icons should be simple line icons in white or accent colors
- Use red for primary/highlight elements, blue for secondary, grey for supporting
"""

DIAGRAMS = [
    {
        "name": "01_overall_architecture",
        "prompt": f"""Create a clean technical architecture diagram for a pitch deck.

Title at top in white: "DAEMON — Architecture"

Show a horizontal flow from left to right:

LEFT SIDE (labeled "Your Devices"):
- Phone icon (red outline)
- Laptop icon (blue outline)
- Raspberry Pi icon (grey outline)
- Each with a small label underneath

CENTER (labeled "Always-On Brain"):
- A glowing hexagonal node in red-to-blue gradient
- Inside it says "Claude AI + Memory"
- Small icons around it: microphone, shield lock, brain
- Connected to all devices with thin gradient lines (red to blue)

RIGHT SIDE (labeled "The World"):
- Cloud icon for "APIs & Services"
- Radio waves icon for "RF / LoRa / IR"
- Database icon for "Vector Memory"

Bottom text in small grey: "One daemon. All your devices. Always learning."

{STYLE}"""
    },
    {
        "name": "02_three_layers",
        "prompt": f"""Create a vertical stack diagram for a pitch deck.

Title: "THREE LAYERS"

Three horizontal bands stacked vertically, each a rounded rectangle:

TOP LAYER (red tinted, glowing):
- Label: "THE SOUL"
- Icons: heart, brain wave, speech bubble
- Text: "Personality • Memory • Voice"
- Subtitle: "Settles over time — becomes uniquely yours"

MIDDLE LAYER (blue tinted):
- Label: "THE BRAIN"
- Icons: chip/processor, code brackets, lightning bolt
- Text: "Claude AI Agent • SSH • Code"
- Subtitle: "Understands, decides, acts"

BOTTOM LAYER (grey tinted):
- Label: "THE BODY"
- Icons: USB plug, antenna, microphone
- Text: "Sensors • Radios • Hardware"
- Subtitle: "Sees, hears, connects to anything"

A vertical gradient line connects all three layers on the left side, going from red (top) to blue (bottom).

{STYLE}"""
    },
    {
        "name": "03_software_first",
        "prompt": f"""Create a horizontal timeline/roadmap diagram for a pitch deck.

Title: "SOFTWARE FIRST, HARDWARE SECOND"

Three phases shown as connected nodes on a horizontal line:

PHASE 1 (left, red glow):
- Circle with phone icon
- Label: "Software Daemon"
- Bullet: "Web + App"
- Bullet: "Your existing devices"
- Bullet: "Subscribe or BYOK"
- Tag: "NOW"

PHASE 2 (center, gradient red-to-blue):
- Circle with box/package icon
- Label: "Kickstarter"
- Bullet: "Hardware key ships"
- Bullet: "Backers already have daemon"
- Bullet: "Real beta data"
- Tag: "MONTH 4"

PHASE 3 (right, blue glow):
- Circle with globe icon
- Label: "Scale"
- Bullet: "Direct sales"
- Bullet: ".daemon domains"
- Bullet: "Developer platform"
- Tag: "YEAR 1"

Connected by a gradient line (red → blue) with arrows between phases.

{STYLE}"""
    },
    {
        "name": "04_memory_system",
        "prompt": f"""Create a diagram showing how the daemon's memory works. Pitch deck style.

Title: "MEMORY — Your Daemon Remembers Everything"

Center: A brain icon with concentric rings, in red-blue gradient.

Four arrows pointing INTO the brain from corners:
- Top-left: "Conversations" (chat bubble icon) — "Every interaction stored"
- Top-right: "Imported History" (download icon) — "ChatGPT, Claude, WhatsApp"
- Bottom-left: "Device Events" (plug icon) — "What you connected, when"
- Bottom-right: "User Facts" (person icon) — "Preferences, habits, context"

Below the brain: a search bar graphic labeled "Semantic Recall"
With example text: "What did we discuss about the garden last week?"

Arrow pointing down to a result box:
"Found 3 memories (relevance: 92%, 78%, 65%)"

Small text at bottom: "Gemini embeddings + Qdrant vector database • MemGPT-inspired"

{STYLE}"""
    },
    {
        "name": "05_device_mesh",
        "prompt": f"""Create a mesh/network diagram showing all devices connected as one.

Title: "ALL YOUR DEVICES, ONE DAEMON"

Center: The daemon represented as a glowing red-blue gradient orb/node.

Around it in a circle, 5 device icons connected with gradient lines:
- Phone (top, with label "Android App — mic, GPS, camera, sensors")
- Laptop (top-right, "Windows App — files, commands, mic")
- Raspberry Pi (right, "Hardware — sensors, screen, GPIO")
- Server (bottom, "Always-on — the daemon lives here")
- Tablet/Browser (left, "Web UI — chat, settings, memory")

Each connection line pulses with a subtle gradient.
Each device has a small green dot indicating "online".

Below: "Plug anything into any device. Your daemon sees it instantly."

{STYLE}"""
    },
    {
        "name": "06_settling_personality",
        "prompt": f"""Create a diagram showing how daemon personality evolves over time.

Title: "SETTLING — Your Daemon Becomes Yours"

Show a horizontal timeline with 3 states:

LEFT — "Day 1" (grey, neutral):
- A simple circle face, neutral expression
- Radar/spider chart below with all traits at 0.5 (flat)
- Label: "Competent. Neutral. Proves itself useful."

CENTER — "Month 1" (slight red tint):
- Circle face with subtle expression
- Radar chart with some traits shifting
- Label: "Developing opinions. Adapting to you."

RIGHT — "Month 6" (vibrant red-blue gradient):
- Circle face with distinct character
- Radar chart with clear personality shape
- Label: "Uniquely yours. No two daemons alike."

Below: four tendency labels in a row:
"Warm" (red) • "Sharp" (blue) • "Precise" (grey) • "Still" (white)

Small text: "Not chosen. Grown. Based on how you interact."

{STYLE}"""
    },
    {
        "name": "07_security_isolation",
        "prompt": f"""Create a security/isolation diagram for multi-tenant architecture.

Title: "SECURITY — Your Data, Your Devices"

Show a server rack/box in the center labeled "Server (Arturito)".

Inside the server, show 3 isolated containers as rounded boxes:
- Container A (red outline): "Alice's Daemon" with a lock icon
- Container B (blue outline): "Bob's Daemon" with a lock icon
- Container C (grey outline): "Carol's Daemon" with a lock icon

Between containers: a bold X mark or wall showing they CANNOT see each other.

Key security features listed on the right:
- Shield icon: "gVisor — user-space kernel"
- Lock icon: "Zero host access"
- Database-crossed icon: "No data stored on server"
- Key icon: "E2E encrypted tunnels"

Below the server: arrows going to user devices with label:
"All data lives on YOUR devices. Server is compute, not storage."

{STYLE}"""
    },
    {
        "name": "08_voice_pipeline",
        "prompt": f"""Create a horizontal flow diagram showing the voice pipeline.

Title: "TALK TO YOUR DAEMON"

Show a left-to-right flow:

1. Microphone icon (red) — "Any mic: phone, USB, Bluetooth, browser"
2. Arrow → Sound waves graphic →
3. "Deepgram" box (blue) — "Streaming speech-to-text, 300ms latency"
4. Arrow →
5. Brain/daemon icon (red-blue gradient) — "Claude AI processes"
6. Arrow →
7. Speaker icon (blue) — "Speaks back via TTS"

Below the main flow, three mode icons:
- Keyboard icon: "Text mode — type in chat"
- Mic button icon: "Push to talk — tap and speak"
- Radio wave icon: "Always listening — plug in a mic"

Small text: "Works on every device. Same pipeline everywhere."

{STYLE}"""
    },
    {
        "name": "09_plug_and_play",
        "prompt": f"""Create a diagram showing the plug-and-play hardware detection.

Title: "PLUG ANYTHING IN"

Show a USB cable being plugged in (stylized, top center).

Below it, a decision tree / flow:

Step 1: "USB device detected" (flash icon)
Step 2: "Identified: Bluetooth Mic" (magnifying glass icon)
Step 3: "Auto-configured as audio input" (checkmark icon)
Step 4: Daemon speech bubble: "I see you plugged in a mic. Want me to start listening?"

On the right side, show different device types that can be detected:
- Microphone icon → "Auto-configures audio"
- Arduino icon → "Connects via serial"
- Bluetooth icon → "Scans for devices"
- Sensor icon → "Reads I2C bus"
- Screen icon → "Drives display"

Small text: "No drivers. No code. No setup. The AI handles it."

{STYLE}"""
    },
    {
        "name": "10_revenue_model",
        "prompt": f"""Create a clean pricing/revenue diagram for a pitch deck.

Title: "HOW IT MAKES MONEY"

Three pricing tiers shown as cards side by side:

LEFT CARD (outlined in grey):
- "FREE"
- "Bring your own API key"
- Bullet: "Open-source framework"
- Bullet: "Local memory"
- Bullet: "Basic agent"
- Price: "€0/month"

CENTER CARD (outlined in red, highlighted as "MOST POPULAR"):
- "CORE"
- Bullet: "Cloud AI processing"
- Bullet: "Voice synthesis"
- Bullet: "Memory sync"
- Bullet: "Settling engine"
- Price: "€15-20/month"

RIGHT CARD (outlined in blue):
- "HARDWARE KEY"
- Bullet: "Physical daemon device"
- Bullet: "All radios + sensors"
- Bullet: "Core subscription included"
- Price: "€149-199 one-time"

Below the cards: "Software validates → Kickstarter funds hardware → Platform scales"

{STYLE}"""
    },
    {
        "name": "11_daemon_character",
        "prompt": f"""Create an artistic/brand image of the daemon concept.

A minimalist, abstract representation of a daemon entity:
- A glowing orb or geometric shape (hexagonal or circular) floating in dark space
- Red-to-blue gradient glow emanating from it
- Thin concentric rings or orbits around it (like a small solar system)
- Small white dots representing connected devices orbiting around it
- Subtle circuit-board-like line patterns in the background
- Clean, futuristic, slightly mysterious
- NOT a face or character — abstract and elegant
- Think: if an AI's soul had a visual form

Below: the word "daemon" in clean white lowercase sans-serif

{STYLE}
Make it feel premium, like a luxury tech brand logo. Minimal. Powerful."""
    },
    {
        "name": "12_competitive_landscape",
        "prompt": f"""Create a competitive positioning diagram / 2x2 matrix.

Title: "WHERE DAEMON SITS"

A 2x2 grid:
- X-axis: "Tool" (left) ←→ "Companion" (right)
- Y-axis: "Software only" (bottom) ←→ "Hardware" (top)

Plot these as labeled dots:
- Top-left quadrant: "Flipper Zero" (grey dot), "Kode Dot" (grey dot)
- Top-right quadrant: "DAEMON" (large red-blue gradient dot, glowing, with a subtle halo)
- Bottom-left quadrant: "Claude Code" (grey dot), "OpenClaw" (grey dot)
- Bottom-right quadrant: "Character.ai" (grey dot), "Replika" (grey dot)

DAEMON should clearly stand out as the only thing in the top-right (Hardware + Companion).

Subtitle: "The only AI agent with a body AND a soul."

{STYLE}"""
    },
]

def generate_diagram(diagram: dict):
    """Generate a single diagram and save it."""
    name = diagram["name"]
    prompt = diagram["prompt"]
    output_path = OUTPUT_DIR / f"{name}.png"

    print(f"[gen] Generating {name}...")
    try:
        response = client.models.generate_content(
            model=MODEL,
            contents=prompt,
            config=genai.types.GenerateContentConfig(
                response_modalities=["image", "text"],
            ),
        )

        for part in response.candidates[0].content.parts:
            if hasattr(part, "inline_data") and part.inline_data:
                img_data = part.inline_data.data
                if isinstance(img_data, str):
                    img_data = base64.b64decode(img_data)
                with open(output_path, "wb") as f:
                    f.write(img_data)
                size_kb = len(img_data) // 1024
                print(f"[gen] Saved {name}.png ({size_kb}KB)")
                return True
            elif hasattr(part, "text") and part.text:
                print(f"[gen] {name} text response: {part.text[:100]}")

        print(f"[gen] {name}: no image in response")
        return False
    except Exception as e:
        print(f"[gen] {name} FAILED: {e}")
        return False


if __name__ == "__main__":
    print(f"Generating {len(DIAGRAMS)} diagrams with {MODEL}...")
    print(f"Output: {OUTPUT_DIR}\n")

    success = 0
    for i, diagram in enumerate(DIAGRAMS):
        ok = generate_diagram(diagram)
        if ok:
            success += 1
        # Small delay to avoid rate limiting
        if i < len(DIAGRAMS) - 1:
            time.sleep(2)

    print(f"\nDone: {success}/{len(DIAGRAMS)} diagrams generated")
    print(f"Files in {OUTPUT_DIR}")
