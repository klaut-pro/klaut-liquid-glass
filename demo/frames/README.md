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

## Iteration 23 (iridescent planar faces + tube join refine)

- chromeSansP: chromatic softbox plate (cyan/magenta/lime/gold) + face-wide oil-slick edgeFire/film on planar slabs; cream crush spares high-chroma; filmThickness 0.45 slab-gated; knife white cores restored
- scriptProP: lighter softMin join (less blob deformation); denser cylindrical wrap + join highlight; harder icy/white flood crush; atlas dilate 5.4 / round 2.1; pinkRatio 0; silverRatio ~0.49; voidInside ↓
- Evidence: `glyph-chromeSansP.png`, `glyph-scriptProP.png`, `glyph-qa-full.png`
- Metrics: chrome bowl/stem iridescent (no cream); script pinkRatio 0; silverRatio ~0.49; voidInside ~378

**Status:** ❌ not READY — chromeSansP iridescent faces closer to 1c6PD/Z53Ve but planar knife wet-mirror still short (facet blocks vs concept softbox fidelity; bowl join notch); scriptProP pink crushed + voids down but tubular elegance / join still lag ENj9B (residual icy bowl + wrap alias). Blender still unavailable. Loop stays armed.

## Iteration 22 (cream crush + cool planar softbox + chrome tube push)

- chromeSansP: warm cream bowl killed (bowl probe `[242,239,229]`→`[168,179,184]` cool softbox); cool studio plate; wider hard-edged planar slabs + cream crush sparing cool peaks; filmThickness 0
- scriptProP: thicker junction softMin + filament; icy/cool-white flood crush → dark-first chrome tube + wrap; pinkRatio 0; silverRatio ~0.52; atlas dilate 5.2 / round 2.05
- Evidence: `glyph-chromeSansP.png`, `glyph-scriptProP.png`, `glyph-qa-full.png`
- Metrics: chrome creamPct 0; stem charcoal; script pinkRatio 0; left-notch 0

**Status:** ❌ not READY — chromeSansP cream bowl fixed but planar knife wet-mirror still short of 1c6PD/Z53Ve (softbox slabs cooler/weaker than concept iridescent faces); scriptProP pink crushed + darker tube midtones but tubular elegance / join still lag ENj9B (residual icy fill / voids). Blender still unavailable. Loop stays armed.

## Iteration 21 (dark-first planar softbox + junction softMin)

- chromeSansP: dark-first charcoal body + 2 wide softbox slabs (no plate flood / cyan milk); face fire/spec gated to rim; filmThickness 0; neutral studio plate (3 white slabs on black)
- scriptProP: softMin junction fill (exterior dent + stem–bowl V); broader cylindrical wrap bands; thicker freeze filament; atlas dilate 4.8 / round 1.85; pinkRatio 0.001
- Evidence: `glyph-chromeSansP.png`, `glyph-scriptProP.png`, `glyph-qa-full.png`
- Metrics: chrome stem dark [32,26,31]; script left-notch rows 0; pinkRatio 0.001; silverRatio ~0.50

**Status:** ❌ not READY — chromeSansP charcoal+slab contrast improved vs milky cyan flood but still short of 1c6PD/Z53Ve planar knife softbox wet-mirror (bowl cream / residual slab ribs); scriptProP pink crushed + left-notch metric cleared but tubular elegance / join still lag ENj9B. Blender still unavailable. Loop stays armed.

## Iteration 20 (planar softbox slabs + filament X align + blob cap)

- chromeSansP: near-flat normals (faceBend 0.06), aniso ribs gated, few wide softbox panels + charcoal interstitial, lavender desat, filmThickness 0.01; studio plate fewer/wider panels
- scriptProP: silver-chrome luminous tube fill (pinkRatio 0.34→0.014), emitter x −0.08→−0.04 (stem–filament X align), stretchScale 1.85; MAX_DRIP_BLOBS 24→48 + Y-coverage trim; thicker pendant capsules; filmThickness 0.08
- Evidence: `glyph-chromeSansP.png`, `glyph-scriptProP.png`, `glyph-qa-full.png`
- Metrics: script pinkRatio 0.014, silverRatio ~0.51, junction gapRows 250–360: 94→3; filled loop held

**Status:** ❌ not READY — chromeSansP still short of 1c6PD/Z53Ve wet-mirror planar fidelity (milky cyan face / residual ribs vs knife softbox contrast); scriptProP pink crushed + filament continuous but tubular elegance / residual junction notch still lag ENj9B. Blender still unavailable. Loop stays armed.

## Iteration 19 (planar softbox panels + tubular silver wrap)

- Studio plate: medium-width softbox **panels** under knife cores (`bake-studio-env.py` + `createChromeStudioBackdrop`)
- chromeSansP: near-planar face bend (0.16), zero softAmb lavender, forced plate mirror floor, panel bars over ribbed streaks, filmThickness 0.02; brightPct 0.051→0.111
- scriptProP: cylindrical Fresnel silver wrap + broader wrap bands post-tonemap; thicker freeze filament (anti-junction void); filmThickness 0.14; silverRatio ~0.51
- Evidence: `glyph-chromeSansP.png`, `glyph-scriptProP.png`, `glyph-qa-full.png`

**Status:** ❌ not READY — chromeSansP brighter panels but still short of 1c6PD/Z53Ve wet-mirror planar fidelity (lavender stem + streak ribs); scriptProP silver wrap stronger but pink body still dominates ENj9B tubular chrome, junction void persists. Filled loop held. Blender still unavailable. Loop stays armed.

## Iteration 18 (knife densify + tubular silver chrome)

- Denser studio softbox plate (procedural + baked `studio-softbox.png`) — more 1–2px hard cores
- chromeSansP: flatter face bend, harder plate/faceBar mul, darker interstitials, stronger contrast expand, filmThickness 0.04
- scriptProP: dark magenta metal body + post-tonemap silver wrap filaments (survive magenta crush); filmThickness 0.22 rim-gated; brighter plate/env wrap; drip floor anti-void
- Evidence: `glyph-chromeSansP.png`, `glyph-scriptProP.png`, `glyph-qa-full.png`
- Metrics: script brightPct 0.028→0.084; chrome knife bars denser

**Status:** ❌ not READY — chromeSansP knife wet-mirror still short of 1c6PD/Z53Ve planar chrome fidelity; scriptProP filled loop held + silver filaments improved but tubular elegance still lags ENj9B (pink body dominates). Blender still unavailable. Loop stays armed.

## Iteration 17 (knife face contrast + luminous tubular script)

- Capped glyph `fwidth` AA + hard outside early-out (SwiftShader soft-mask pastel wash fix)
- chromeSansP: flatter face normals, denser planar knife bars, harder contrast expand, cool chromatic peaks (no cream lip / equal-white clip)
- scriptProP: thicker SDF dilate (4.2), razor rim pow, magenta tubeFill floor, medial ridge, AA cover holds body (no black outline voids)
- Capture: keep equal-white SwiftShader clear strip; peaks forced chromatic so fill survives
- Evidence: `glyph-chromeSansP.png`, `glyph-scriptProP.png`, `glyph-qa-full.png`

**Status:** ❌ not READY — chromeSansP knife bars + midtone faces improved vs iter 16 (no cream wash / no void regression) but still short of 1c6PD/Z53Ve wet-mirror sharpness; scriptProP upper loop now magenta-filled (not hollow rim) but tubular chrome elegance still lags ENj9B. Blender still unavailable. Loop stays armed.

## Iteration 16 (harder knife plate + script face/filament)

- Re-baked `studio-softbox.png` at 2k: near-black ambient, 1–3px absolute hard cores (no soft shoulders), denser bar set
- Procedural `createChromeStudioBackdrop` matched (hard cores only, quieter amb)
- chromeSansP: softAmb gated down, contrast expand on mids, white razor streak cores, film face-gated, thinner bevel + bright rim lip, filmThickness 0.1
- scriptProP: razor-thin rim pow so thin strokes keep face fill; luminous tubeFill floor; silver mid-filament on medial (`inside/0.028`); thicker freeze filament (~0.07–0.085) + neck floor 0.28
- Evidence: `glyph-chromeSansP.png`, `glyph-scriptProP.png`, `glyph-qa-full.png`

**Status:** ❌ not READY — chromeSansP harder/less pastel than iter 15 but wet-mirror bars still short of 1c6PD/Z53Ve knife faces; scriptProP mid-filament + pendant improved but tubular face chrome still lag ENj9B (upper loop too rim/outline). Blender still unavailable. Loop stays armed.

## Iteration 15 (knife HDRI plate + planar softbox UV)

- Procedural softbox ceiling: baked knife-edge plate (`demo/env/studio-softbox.png` via `bake-studio-env.py`) + NEAREST backdrop sampling
- Planar studio UV (not equirect scramble); hardBar-gated plate add; denser razor streak cores; gentler tone-map
- Script: stronger cylinder normals, thicker elegant mid-filament (~0.05), rounder pendant; pendant midtone floor
- chromeSansP filmThickness cut (0.22) to reduce pastel wash over mirror bars
- Evidence: `glyph-chromeSansP.png`, `glyph-scriptProP.png`, `glyph-qa-full.png`

**Status:** ❌ not READY — chromeSansP bars still softer than wet-mirror 1c6PD/Z53Ve; scriptProP tubular/pendant closer but mid-filament elegance + face chrome still lag ENj9B. Blender still unavailable. Loop stays armed.

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
