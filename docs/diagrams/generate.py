#!/usr/bin/env python3
"""Generate Daemon platform architecture diagrams using Gemini image generation."""

import requests, base64, json, sys, time, os

api_key = os.popen("grep GOOGLE_API_KEY_ARTHUR ~/.secrets/vault.env | cut -d= -f2").read().strip()
MODEL = "gemini-2.5-flash-image"
URL = f"https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent?key={api_key}"
OUT_DIR = "/home/arthur/daemon/docs/diagrams"

STYLE = """Technical architecture diagram. Dark background color #0A0A0A.
Primary accent color: red #FF0505. Text color: white #FFFFFF. Secondary text: gray #888888.
Boxes/nodes: dark gray #161616 with red #FF0505 borders or subtle red accents.
Connection lines: red #FF0505 or dark gray #333333.
Clean, minimal, polished product diagram style. Sans-serif font.
NOT a whiteboard sketch — this should look like a professional dark-mode product diagram you'd see on a startup landing page.
16:9 aspect ratio. High contrast. No gradients except subtle glows."""

diagrams = [
    {
        "filename": "system-overview.png",
        "prompt": f"""Create a technical architecture diagram titled "Daemon Platform Architecture" with subtitle "daemon.page".

Layout (top to bottom):
- TOP ROW: Four device icons in a row — Phone (smartphone icon), Laptop, Server (rack), Watch (smartwatch). Each in a dark gray #161616 rounded rectangle with red border. Labels below each in white.
- MIDDLE: A cloud shape labeled "Cloudflare" with a red border, connected by red lines down to a box labeled "proxy.js :4800"
- CENTER ROW: Three service boxes side by side:
  1. "Next.js Web :4802"
  2. "WebSocket Server :4801"
  3. "Python Backend"
  All in dark gray boxes with red top borders.
- BOTTOM LEFT: Stack of three boxes labeled "AI Models":
  - "Qwen 3 Coder" with tag "FREE" in green
  - "DeepSeek V3" with tag "$" in yellow
  - "Claude Opus" with tag "$$$" in red
- BOTTOM RIGHT: Two storage boxes:
  - "SQLite" with a database icon
  - "Qdrant Vector DB" with a vector/dots icon

Red lines connecting: devices → Cloudflare → proxy → services → models and storage.
All on pure black #0A0A0A background.

{STYLE}"""
    },
    {
        "filename": "device-mesh.png",
        "prompt": f"""Create a technical architecture diagram titled "Device Mesh".

Layout:
- CENTER: A large hexagonal or circular node labeled "daemon server" with a subtle red glow/aura effect around it. Dark gray fill with red border.
- SURROUNDING the center, four device nodes arranged in a diamond/cross pattern:
  - TOP: Smartphone icon labeled "Phone" with subtitle "Android"
  - RIGHT: Laptop icon labeled "Laptop" with subtitle "Windows / macOS"
  - BOTTOM: Desktop/monitor icon labeled "Desktop" with subtitle "Linux"
  - LEFT: Smartwatch icon labeled "Watch" with subtitle "Wear OS"
- Each device has a small list of capabilities below it: "shell, files, clipboard" in gray text
- RED dashed lines from each device to center labeled "WSS" (WebSocket Secure)
- Between adjacent devices, show subtle gray curved arrows labeled "clipboard sync"
- BOTTOM: A small flow showing the pairing sequence: three connected boxes:
  "6-char code" → "verify" → "token issued" → "connected ✓"
  with arrows between them

All on pure black #0A0A0A background.

{STYLE}"""
    },
    {
        "filename": "chat-flow.png",
        "prompt": f"""Create a technical architecture diagram titled "Message Flow".

Layout — horizontal flow from LEFT to RIGHT:
- LEFT: User icon (person silhouette) with speech bubble "message"
- Arrow right to: "App" box (dark gray, red border)
- Arrow right to: Cloud shape "Cloudflare"
- Arrow right to: Large box "Server" containing three internal steps stacked vertically:
  1. "Auth" (with lock icon)
  2. "Tier Check" (with shield icon)
  3. "Model Router" (with branching icon)
- From Model Router, THREE arrows branch to three model boxes:
  - "Qwen" (green accent)
  - "DeepSeek" (yellow accent)
  - "Claude Opus" (red accent)
- Below the model boxes: a loop arrow labeled "Docker Sandbox" with a container icon, connecting back to the models (for tool execution)
- From models, a red arrow streams back: "SSE Stream" → back through App → User sees response
- BOTTOM: A gray bar spanning the width: "Persist to SQLite + Log usage metrics"

All on pure black #0A0A0A background.

{STYLE}"""
    },
    {
        "filename": "memory-system.png",
        "prompt": f"""Create a technical architecture diagram titled "Memory & Search".

Layout — pipeline flowing left to right with a retrieval loop:
- LEFT: Input icon showing chat bubbles labeled "Conversations"
- Arrow right to STEP 1: Box labeled "Gemini Flash" with subtitle "Summarize" and small text listing: "TLDR, decisions, facts, problems, solutions" — dark gray box with red border
- Arrow right to STEP 2: Box labeled "Gemini Embedding" with subtitle "768-dim vectors" — shows a small vector visualization (row of colored dots)
- Arrow right to STEP 3: Large cylinder/database icon labeled "Qdrant" with red accent

Below, show the RETRIEVAL section:
- A search query input box on the left
- TWO parallel paths from search:
  1. TOP path: "Vector Search" (semantic) — icon of scattered dots connecting — goes to Qdrant
  2. BOTTOM path: "Text Search" (keyword/grep) — icon of text lines — goes to SQLite
- Both paths merge into an output: "Memory context injected into next chat" — shown as a document with highlighted sections being inserted into a chat prompt

All on pure black #0A0A0A background.

{STYLE}"""
    },
    {
        "filename": "billing.png",
        "prompt": f"""Create a technical architecture diagram titled "Pricing Model".

Layout:
- TOP: Three pricing tier cards side by side, each as a dark gray #161616 rounded rectangle with distinct top border color:

  1. LEFT card — red border top:
     "FREE" (large white text)
     "Qwen unlimited"
     "Bring your own keys"
     "$0/mo" (large)

  2. MIDDLE card — brighter red border, slightly larger/elevated to emphasize it:
     "PRO" (large white text)
     "$10/mo + $5 credits"
     "All models included"
     "Managed API keys"
     "Priority support"

  3. RIGHT card — gray border:
     "BYOK" (large white text)
     "Your keys, our platform"
     "$0/mo"
     "Full model access"

- MIDDLE SECTION: A horizontal bar labeled "24 APIs Included" with small icons representing categories: AI, Search, Voice, Storage, Auth

- BOTTOM LEFT: A usage meter/progress bar showing "$2.34 / $5.00 used" — partially filled bar in red

- BOTTOM RIGHT: A small scatter plot with axes "Price →" (x) and "Capability →" (y), with three dots plotted:
  - Qwen (bottom-left, labeled FREE)
  - DeepSeek (middle)
  - Claude Opus (top-right)
  Title: "Model Pareto Front"

All on pure black #0A0A0A background.

{STYLE}"""
    },
    {
        "filename": "data-sovereignty.png",
        "prompt": f"""Create a technical architecture diagram titled "Your Data, Your Devices".

Layout:
- CENTER: A person/user icon inside a large circle or shield shape with a red border — this represents the user's sovereignty boundary
- INSIDE the circle, arranged around the user: four device icons (phone, laptop, desktop, watch) — all connected to each other with thin red lines forming a mesh
- Data flow labels inside the circle: "conversations", "files", "clipboard" — shown as small flowing arrows between devices
- The entire inner circle has a subtle red glow to show it's the user's protected space
- OUTSIDE the circle:
  - A box labeled "Daemon Server" with text "relay only — no content storage" in gray
  - A thin line from the circle to the server, but clearly showing data stays inside the user boundary
- BOTTOM: Three badges/pills in a row:
  1. Shield icon + "Open Source"
  2. Server icon + "Self-Hostable"
  3. Unlock icon + "No Vendor Lock-in"
- A large lock/shield icon watermark very faintly in the background

All on pure black #0A0A0A background.

{STYLE}"""
    },
]

def generate_image(prompt, filename):
    filepath = os.path.join(OUT_DIR, filename)
    payload = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {"responseModalities": ["IMAGE", "TEXT"]}
    }

    for attempt in range(3):
        try:
            resp = requests.post(URL, json=payload, timeout=120)
            if resp.ok:
                data = resp.json()
                candidates = data.get("candidates", [])
                if candidates:
                    parts = candidates[0].get("content", {}).get("parts", [])
                    for p in parts:
                        if "inlineData" in p:
                            img_data = base64.b64decode(p["inlineData"]["data"])
                            with open(filepath, "wb") as f:
                                f.write(img_data)
                            print(f"[OK] {filename} — {len(img_data):,} bytes")
                            return True
                        elif "text" in p:
                            pass  # skip text parts
                    print(f"[WARN] {filename} — no image in response")
                else:
                    print(f"[WARN] {filename} — no candidates")
                    print(json.dumps(data, indent=2)[:300])
            else:
                print(f"[ERR] {filename} — HTTP {resp.status_code}: {resp.text[:200]}")
                if resp.status_code == 429:
                    print("Rate limited, waiting 30s...")
                    time.sleep(30)
                    continue
        except Exception as e:
            print(f"[ERR] {filename} — {e}")

        if attempt < 2:
            time.sleep(5)

    return False


if __name__ == "__main__":
    # Clean up test file
    test_file = os.path.join(OUT_DIR, "test.png")
    if os.path.exists(test_file):
        os.remove(test_file)

    results = []
    for i, d in enumerate(diagrams):
        print(f"\n--- [{i+1}/6] Generating {d['filename']} ---")
        ok = generate_image(d["prompt"], d["filename"])
        results.append((d["filename"], ok))
        if i < len(diagrams) - 1:
            time.sleep(3)  # Small delay between requests

    print("\n=== RESULTS ===")
    for fn, ok in results:
        status = "SUCCESS" if ok else "FAILED"
        print(f"  {status}: {fn}")
