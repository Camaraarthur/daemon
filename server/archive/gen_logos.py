#!/usr/bin/env python3
"""Generate 15 daemon logo variations — each letter as a character face."""

import os, base64, time
from google import genai

key = ""
with open(os.path.expanduser("~/.secrets/vault.env")) as f:
    for line in f:
        if line.startswith("GOOGLE_API_KEY="):
            key = line.split("=", 1)[1].strip().strip('"').strip("'")

client = genai.Client(api_key=key)
MODEL = "gemini-3.1-flash-image-preview"
OUT = "/tmp/daemon-logos"
os.makedirs(OUT, exist_ok=True)

BASE_STYLE = "Red (#ff0505) on pure black background. Wide horizontal format. Minimal, clean, premium tech brand feel."

LOGOS = [
    ("logo_01_blob_faces", "The word 'daemon' where each letter is a blob creature with a distinct face/expression. Like 6 tiny monsters standing in a row forming the word. Each has dot-eyes and a simple mouth shape. Blobby, organic, cute but not childish. " + BASE_STYLE),

    ("logo_02_emoji_letters", "The word 'daemon' where each letter has been subtly turned into a face using minimal additions — two dots for eyes in the 'd', a smile curve in the 'a', a wink in the 'e', raised eyebrow dots on the 'm', wide eyes in the 'o', a smirk in the 'n'. The base letterform is thick rounded sans-serif, and the face elements are integrated into the letter shapes. " + BASE_STYLE),

    ("logo_03_silhouette_creatures", "Six creature silhouettes in a row that together read as 'daemon'. Each creature's body shape IS the letter — the d-creature is tall with a round belly, the a-creature is triangular, the e-creature has a curled tail, the m-creature has two bumps on top, the o-creature is perfectly round, the n-creature has one arch. Each has tiny white dot eyes. " + BASE_STYLE),

    ("logo_04_stacked_faces", "The word 'daemon' in a heavy bold font. Inside each letter, a different simple face is drawn with white lines — like graffiti faces hidden in typography. One letter has a cyclops eye, another has a wide grin, another looks sleepy, etc. The letters themselves are solid red, faces are white line art inside. " + BASE_STYLE),

    ("logo_05_tamagotchi_row", "Six tamagotchi-style pixel creatures in a row on a dark screen, each representing a letter of 'daemon'. They're 16-bit pixel art style but the overall composition reads as the word 'daemon'. Below them, 'daemon' written small in pixel font. " + BASE_STYLE),

    ("logo_06_faces_only", "Just six circular faces in a row — each is a different daemon personality. One is curious (one eyebrow up), one is calm (closed eyes, slight smile), one is sharp (angular eyes), one is warm (big round eyes), one is playful (tongue out), one is mysterious (one eye showing). Below them: 'daemon' in thin lowercase. All red on black. " + BASE_STYLE),

    ("logo_07_morph_letters", "The word 'daemon' where each letter is morphing/melting into a face. Like the letters are alive and trying to express themselves through their shapes. Dripping, organic, slightly surreal but still readable. " + BASE_STYLE),

    ("logo_08_minimal_dots", "The word 'daemon' in clean sans-serif. Each letter has exactly two small dots placed to look like eyes. Nothing else added — just the dots in the right position on each letter make every letter look like it's staring at you. Subtle pareidolia. " + BASE_STYLE),

    ("logo_09_one_eye_each", "The word 'daemon' where each letter has a single eye (not two). Like cyclops characters. The eye is placed differently in each letter — in the counter of the 'd', above the 'a', in the curve of the 'e', between the humps of 'm', dead center of 'o', on the arch of 'n'. White circles with dark pupils on red letters. " + BASE_STYLE),

    ("logo_10_evolving", "A sequence showing the word 'daemon' three times in a row: first as plain text, then with subtle face hints emerging, then with full character faces on each letter. Like the word is coming alive. Shows the settling concept. Left is grey, middle is light red, right is full red. On black background. " + BASE_STYLE),

    ("logo_11_hand_drawn", "The word 'daemon' hand-drawn in a sketchy style, like marker on paper but in red on black. Each letter is drawn slightly differently, imperfect, with personality. Some letters have tiny face doodles next to them or integrated. Raw, authentic, human feeling despite being for an AI product. " + BASE_STYLE),

    ("logo_12_negative_space", "The word 'daemon' where the NEGATIVE SPACE between and inside letters forms faces. The letters themselves are solid blocks, but the gaps between them reveal hidden face profiles. Clever optical illusion typography. " + BASE_STYLE),

    ("logo_13_circuit_faces", "The word 'daemon' where each letter is made of circuit board traces and components, and the components are arranged to look like faces — resistors as eyebrows, capacitors as eyes, traces forming smiles. Technical + playful. " + BASE_STYLE),

    ("logo_14_shadow_friends", "The word 'daemon' in solid red, with each letter casting a shadow below it. But the shadows aren't letter-shaped — each shadow is a different small creature/character, like each letter's daemon companion standing behind it. Shadows in dark grey. " + BASE_STYLE),

    ("logo_15_personality_spectrum", "The word 'daemon' where each letter has a different style/personality: 'd' is sharp and angular (blue tint), 'a' is round and warm (red tint), 'e' is precise and geometric (grey tint), 'm' is bold and stable (dark red), 'o' is perfectly circular and zen (white), 'n' is quirky and asymmetric (red-blue gradient). Each letter's design style IS its personality. On black. " + BASE_STYLE),
]

for name, prompt in LOGOS:
    print(f"Generating {name}...")
    try:
        response = client.models.generate_content(
            model=MODEL,
            contents=prompt,
            config=genai.types.GenerateContentConfig(response_modalities=["image", "text"]),
        )
        for part in response.candidates[0].content.parts:
            if hasattr(part, "inline_data") and part.inline_data:
                data = part.inline_data.data
                if isinstance(data, str):
                    data = base64.b64decode(data)
                with open(f"{OUT}/{name}.png", "wb") as f:
                    f.write(data)
                print(f"  Saved ({len(data)//1024}KB)")
                break
        else:
            print("  No image generated")
    except Exception as e:
        print(f"  FAILED: {e}")
    time.sleep(2)

print(f"\nDone! Files in {OUT}")
