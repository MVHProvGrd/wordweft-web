# wefty-jump-up · prompt pack (6-frame painterly-cartoon)

Reference: `wordweft-web/wefty_run_b.png`. Produced via
`weftypiccraft_v1.md`.

## Workflow status
- Mode A (`codex_image_gen_api`) two early failures were a busted
  WSL→Windows codex CLI install (no `@openai/codex-linux-x64` native
  dep), not a Cloudflare or rate-limit issue. Fixed with a WSL-local
  `npm install -g @openai/codex@latest` plus a PATH prefix in
  `weftypiccraft.mjs`. Smoke test passed (`READY_OK`).
- Currently retrying **Mode A** (codex CLI image_gen). The Mode B
  paste-pack below remains available as a fallback if Mode A still
  fails for unrelated reasons.

## ChatGPT paste-pack (Mode B)

> Generate a single PNG that is a **2-row × 3-column sprite sheet** of
> the attached Wefty mascot performing a 6-frame "jump up" animation.
> Each cell is a square 512×512 panel, transparent background, the
> character centered, no cell borders, no frame numbers, no text or
> labels.
>
> Read frames left-to-right, top row first (F1 F2 F3 / F4 F5 F6).
>
> **Style lock — match the attached reference exactly:** painterly
> cartoon Wefty (yarn-ball mascot), round purple body wrapped in
> multicolor yarn strands (peach, pink, mint, lavender), large
> anime-style eyes with white catchlights, soft pink blush dots, tiny
> smile, dangling pink-magenta yarn tail. Identical proportions, face,
> line quality, palette, and lighting in every cell. Soft cel-shading,
> subtle gradients, hand-painted feel. Same camera angle and scale
> across all 6 frames.
>
> **F1 anticipation_squash** — Wefty compressed vertically by ~12%
> (slightly wider, shorter pumpkin shape). Yarn-strand wrap bunches a
> touch at the top. Tail curled tightly underneath. Eyes narrowed in
> determination with sparkle highlights, brows slightly furrowed,
> smile small and tight. Loaded-spring feeling. No motion lines yet.
>
> **F2 launch_stretch** — Wefty stretched vertically by ~15% (taller
> egg shape), released from the squash. Tail trailing straight downward
> as if just leaving the ground. Eyes wide open in surprise/joy, mouth
> open in a small 'o'. Faint upward speed lines BELOW the body only.
> Continuation of F1.
>
> **F3 rising_smear** — Body stretched ~10% vertically, tail streaming
> straight down behind/below. Eyes wide with delight, sparkles in the
> pupils, smile open and excited. Soft painterly motion smear below the
> body — a faint trailing yarn-strand echo. Yarn wrap fans slightly
> outward at the equator from rising velocity. Continuation of F2.
>
> **F4 peak_velocity** — Body still stretched ~8% vertically with a
> slight backward tilt (~5° rear) as if leaning into the rise. Yarn
> strands fanning outward more pronounced at the equator. Tail
> streaming down. Eyes wide and joyful with a big open 'wheee' smile.
> Subtle warm sparkle highlights on the upper body. No smear at this
> instant. Continuation of F3.
>
> **F5 decelerating** — Body relaxing back toward a sphere, ~3%
> vertical stretch remaining, slight backward tilt (~5°) held. Yarn
> tail catching up, curving softly upward at its tip in an early
> S-curve. Eyes still wide, smile relaxing into a softer grin. No
> motion lines. Continuation of F4 toward apex.
>
> **F6 apex_float** — Wefty fully spherical (matches reference
> proportions), gentle backward tilt (~10°), yarn tail floating free in
> a soft S-curve as if weightless. Eyes half-closed in bliss, peaceful
> smile. Faint sparkle highlights along the top of the body suggesting
> the top of the jump. Held weightless pose ready to begin falling.
>
> **Negative:** pixel art, 8-bit, 16-bit, chunky pixels, magenta chroma
> key, indexed palette, nearest-neighbor scaling, hard outlines, text,
> watermark, signature, multiple characters, props, background scenery,
> crop, partial body, cell borders, frame numbers, labels.

(The detailed per-frame breakdown below is the source of truth — the
paste-pack above is just a one-shot bundle.)


## Global prefix
> Painterly cartoon Wefty (yarn-ball mascot): round purple body wrapped
> in multicolor yarn strands (peach, pink, mint, lavender), large
> anime-style eyes with white catchlights, soft pink blush dots, tiny
> smile, dangling pink-magenta yarn tail. Match the attached reference
> (wefty_run_b.png) exactly for proportions, face, line quality, and
> yarn palette. Soft cel-shading, subtle gradients, hand-painted feel.
> Same camera angle and scale across all frames; centered character in
> each cell; transparent background.

## Negative prompt
pixel art · 8-bit · 16-bit · chunky pixels · magenta chroma key ·
indexed palette · nearest-neighbor scaling · hard outlines · text ·
watermark · signature · multiple characters · props · background
scenery · crop · partial body · cell borders · frame numbers · labels.

## Frames

### F1 · anticipation_squash · 100 ms
Frame 1 — Anticipation. Wefty compressed vertically by ~12% (slightly
wider, shorter pumpkin shape). Yarn-strand wrap bunches a touch at the
top. Tail curled tightly underneath the body. Eyes narrowed in
determination with sparkle highlights, brows slightly furrowed, smile
small and tight. Loaded-spring feeling. No motion lines yet.

### F2 · launch_stretch · 50 ms
Frame 2 — Launch. Wefty stretched vertically by ~15% (taller egg
shape), released from the squash. Tail trailing straight downward as if
just leaving the ground. Eyes wide open in surprise/joy, mouth open in
a small 'o'. Faint upward speed lines BELOW the body only. Continuation
of Frame 1's anticipation.

### F3 · rising_smear · 60 ms
Frame 3 — Rising fast. Body stretched ~10% vertically, tail streaming
straight down behind/below. Eyes wide with delight, sparkles in the
pupils, smile open and excited. Soft painterly motion smear below the
body — a faint trailing yarn-strand echo (no pixel smear, no speed
lines). Yarn wrap fans slightly outward at the equator from rising
velocity. Continuation of Frame 2 launch.

### F4 · peak_velocity · 70 ms
Frame 4 — Peak rising velocity. Body still stretched ~8% vertically
with a slight backward tilt (~5° rear) as if leaning into the rise.
Yarn strands fanning outward more pronounced at the equator. Tail
streaming down. Eyes wide and joyful with a big open 'wheee' smile.
Subtle warm sparkle highlights on the upper body. No smear at this
instant.

### F5 · decelerating · 80 ms
Frame 5 — Decelerating near apex. Body relaxing back toward a sphere,
~3% vertical stretch remaining, slight backward tilt (~5°) held. Yarn
tail catching up, curving softly upward at its tip in an early S-curve.
Eyes still wide, smile relaxing into a softer grin. No motion lines.

### F6 · apex_float · 110 ms
Frame 6 — Apex / brief float. Wefty fully spherical (matches reference
proportions), gentle backward tilt (~10°), yarn tail floating free in a
soft S-curve as if weightless. Eyes half-closed in bliss, peaceful
smile. Faint sparkle highlights along the top of the body suggesting
the top of the jump. Held weightless pose ready to begin falling.

## Timing summary
| Frame | Name                | Duration |
|-------|---------------------|----------|
| F1    | anticipation_squash | 100 ms   |
| F2    | launch_stretch      |  50 ms   |
| F3    | rising_smear        |  60 ms   |
| F4    | peak_velocity       |  70 ms   |
| F5    | decelerating        |  80 ms   |
| F6    | apex_float          | 110 ms   |
| **Total** |                 | **470 ms** |

## Pipeline

### Mode B (current) — ChatGPT browser
1. Paste the block under "ChatGPT paste-pack" above into ChatGPT,
   attaching `wordweft-web/wefty_run_b.png`.
2. Save the returned PNG as
   `wordweft-web/sprite-forge/wefty-jump-up/source-sheet.png`.
3. `python3 wordweft-web/sprite-forge/wefty-jump-up/slice.py wordweft-web/sprite-forge/wefty-jump-up/source-sheet.png`
4. Outputs: `frame_1..6.png` · `sheet-transparent.png` · `animation.gif`

### Mode A (failed for this asset) — codex CLI
> Reference for the next asset that retries codex:
> `node design/mascots/weftypiccraft.mjs wefty-jump-up "<sheet prompt>" --into wefty-jump-up --ref wordweft-web/wefty_run_b.png`
