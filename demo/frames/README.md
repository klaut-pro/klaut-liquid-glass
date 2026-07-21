# Glyph QA — iteration 1

## Targets (two concept-art letterforms)

| ID | Concept refs | Intent |
|----|--------------|--------|
| `chromeSansP` | `1c6PD.jpg`, `Z53Ve.jpg` | Block geometric chrome **p** (stem + bowl) |
| `scriptProP` | `ENj9B.jpg` | Molten tubular script **p** (ENj9B `.pro` stroke) |

## Harness

- Engine demo: `/demo/qa.html` (side-by-side ref vs live)
- Landing: `/glyph-qa`
- Capture: `node scripts/capture-glyph-qa.mjs http://localhost:52780`

## Evidence (screenshots)

- `demo/frames/glyph-qa-full.png` — full QA page with refs
- `demo/frames/glyph-chromeSansP.png` — live chrome sans p
- `demo/frames/glyph-scriptProP.png` — live script p
- `demo/frames/glyph-qa-meta.json`

## Iteration 10 (latest)

- Heavier chrome: stronger env-reflection, darker body, additive film fringe
- Falling teardrop emitters, body spectrum tint, cursive script SDF
- Thinner viscous necks, magenta scriptProP, interior iridescence

**Status:** ✅ READY — isolated glyph QA meets concept-art material targets (chrome body, viscous pendant necks, light-driven prismatic fringe, detached teardrops). Loop stopped.

## Engine changes

- Per-emitter `DripControl` (controlled mode, isolate, deterministic, attachY, freeze)
- Glyph SDF field modes + studio chrome backdrop
- Profiles: `LiquidGlass.glyphs` / `getGlyphProfile`
