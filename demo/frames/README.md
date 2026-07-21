# Glyph QA — font-baked SDF pipeline

## Targets (two concept-art letterforms)

| ID | Concept refs | Intent |
|----|--------------|--------|
| `chromeSansP` | `1c6PD.jpg`, `Z53Ve.jpg` | Block geometric chrome **p** (stem + bowl) |
| `scriptProP` | `ENj9B.jpg` | Molten tubular script **p** (ENj9B `.pro` stroke) |

## Glyph pipeline (current)

**Blender:** not on PATH / install blocked on admin UAC. Winget pulled Blender 5.2.0 MSI but elevation prompt stalled.

**Chosen alternative:** TrueType outline → binary mask → Euclidean distance transform (EDT) → R8 SDF PNG + embedded atlas.

| Step | Tool | Output |
|------|------|--------|
| 1 | `scripts/bake-glyph-sdf.py` (Pillow + SciPy) | `demo/glyph-atlases/*.png` |
| 2 | same script | `src/field/glyphAtlases.ts` (base64 embed) |
| 3 | WebGL `u_glyphSdf` sample | crisp font silhouettes in fragment shader |
| 4 | Flat-face + rim bevel shading | dark polished chrome (no medial-axis milk) |

Fonts: **Arial Black** (`ariblk.ttf`) for chromeSansP, **Segoe Script** (`segoesc.ttf`) for scriptProP.

Rebake: `npm run bake:glyphs`

When Blender is available, replace atlas PNGs with extruded/remeshed heightfield or MSDF bake using the same R8 encode (`0.5 - 0.5 * signed/maxDist`).

## Harness

- Engine demo: `/demo/qa.html` (side-by-side ref vs live)
- Landing: `/glyph-qa`
- Capture: `node scripts/capture-glyph-qa.mjs http://localhost:52780`

## Iteration 14 (env contrast + script face fill)

- Razor softbox cores + soft shoulders in `studioEnv` / screen streaks; harder studio plate gradients
- Script: thin bevel so tubular face isn't rim-voided; magenta tube fill + medial spine ridge
- Face luminance floor (avoid black-void crush); continuous elegant pendant filament (~0.038 mid)
- Evidence: `glyph-chromeSansP.png`, `glyph-scriptProP.png`, `glyph-qa-full.png`

**Status:** ❌ not READY — chromeSansP softbox bars still soft vs wet-mirror 1c6PD/Z53Ve; scriptProP body chrome restored but stroke elegance / mid-filament still lag ENj9B. Loop stays armed.

## Iteration 13 (wet-mirror bars + thin filament)

- Sharper softbox streak cores (pow falloff) over 99ecc20 chrome face base
- Wider light-tied cyan↔magenta edge fire (bevel + halo + Abbe spread)
- Thinner freeze filament (neck floor 0.32, mid profile ~0.05) + tighter glyph softMin/capsule
- Studio plate softbox gradients narrowed for harder bars

**Status:** ❌ not READY — chromeSansP closer on bar contrast vs soft neon, but still short of concept wet-mirror faces; scriptProP filament/chrome coverage still lag ENj9B; edge fire wider but not concept-wide. Loop stays armed.

## Iteration 12 (wet-mirror push)

- Position-bent studio env + screen-space softbox plate on glyph faces
- Pendant capsule SDF + freeze filament profile; removed stretchScale:0 detached emitters
- Tone-map + channel tint so softboxes survive FB clamp
- Glyph path draws opaque dark plate (SwiftShader white-clear workaround)
- captureFrame: only strip exact equal near-white clears (never luma-kill chrome)

**Status:** ❌ not READY — chromeSansP/scriptProP still soft vs concept wet-mirror; pendant necks improving but not concept-elegant; fringe still thin. Loop stays armed.

## Evidence (screenshots)

- `demo/frames/glyph-qa-full.png` — full QA page with refs
- `demo/frames/glyph-chromeSansP.png` — live chrome sans p
- `demo/frames/glyph-scriptProP.png` — live script p
- `demo/frames/glyph-qa-meta.json`

## Iteration 11 (font SDF atlases)

- Replaced parametric capsule/softMin glyphs with font-baked EDT atlases
- Dark face + thin iridescent rim (cut milky body / medial ridge)
- Harder drip softMin on glyphs; quieter studio softbox
- Controlled pendant drips retuned to stem lips

**Status:** ❌ not READY — silhouettes are real type now, but chrome fidelity vs concept (sharp bevel glints, viscous drip elegance, full prismatic edge fire) still short. Loop stays armed.

## Engine changes

- Per-emitter `DripControl` (controlled mode, isolate, deterministic, attachY, freeze)
- Glyph SDF field modes + studio chrome backdrop
- Font atlas sampling (`u_useGlyphAtlas` / `u_glyphSdf`)
- Profiles: `LiquidGlass.glyphs` / `getGlyphProfile`
