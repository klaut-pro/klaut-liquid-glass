# Scratch 3D liquid-glass pipeline

Clean staged path — **not** the old `chromeSansP` / `scriptProP` SDF atlas QA harness.

## Blender MCP?

**No.** Cursor has no Blender MCP server/tools in this environment. Bake uses portable Blender 4.2 bpy at:

`%LOCALAPPDATA%\Programs\blender-portable\blender-4.2.16-windows-x64\blender.exe`

## Stage 1 — Concept bake (primary)

| Choice | Why |
|--------|-----|
| **Arial Black** | Heavy geometric display sans; plump bevel reads under glass |
| **Concept drips** | Honey teardrops on **k / t / . / p / r / o** (map from `concept_art/1c6PD.jpg`) baked into mesh via GN SDF soft-union |
| **Chrome material** | Principled metallic + transmission exported in GLB; Three `honeyChrome` Physical + fringe for live look |

Glyph: **`klaut.pro`** (per-letter meshes, OrbitControls).

Bake (concept path — default):

```bat
npm run bake:scratch
npm run bake:concept
```

Legacy GravityMeltSim-tuned soft-boolean path:

```bat
npm run bake:scratch:legacy
```

or:

```bat
"%LOCALAPPDATA%\Programs\blender-portable\blender-4.2.16-windows-x64\blender.exe" ^
  --background --python scripts/bake-concept-wordmark.py
```

→ `demo/scratch/mesh/wordmark-klaut-pro.glb` + `manifest.json` (`conceptBake: true`, `blenderMcp: false`)

### What the concept bake does

1. Extrude + heavy bevel + subdiv per glyph
2. Build pear-of-revolution honey pendants (fat bead, thin neck) at concept drip columns
3. Soft-union tips into letter bottoms (GN Mesh→SDF ∪ → Grid to Mesh; Exact/Float boolean fallback)
4. Voxel remesh + smooth so letter→filament is one surface
5. Assign Principled chrome/glass; export GLB with materials

Runtime **does not** need GravityMeltSim for the honey look (gravity defaults to 0). Stage 5 sag remains optional.

## Stages (in order)

| # | Goal | Status |
|---|------|--------|
| 1 | Pick one font + bake wordmark mesh | ✅ concept bake |
| 2 | 3D rotatable (OrbitControls) | ✅ `demo/scratch.html` |
| 3 | Clear refractive glass (IOR / Fresnel / env) | ✅ same page |
| 4 | Liquid glass (liquify / soft surface) | ✅ slider on page |
| 5 | Gravity melt + viscosity + freeze | ✅ optional (`GravityMeltSim`) |
| 6 | Softbox PMREM + Physical retune + iridescence + gated Fresnel fringe | ✅ look pass (`honeyChrome`) |

## Stage 6 look (this pass)

| Piece | What shipped |
|-------|----------------|
| Softbox PMREM | Authored 3-rect softbox + charcoal void (`createSoftboxEnvironment`); RoomEnvironment fallback only |
| Physical retune | Denser body, tiny metalness, clearcoat, sparse `iridescence`, dark-plate lights/exposure |
| Glance gate | Softbox+retune alone still read milky → **FAIL** → fringe ON |
| Fringe | `onBeforeCompile` Fresnel edge fire (gold↔lime↔cyan), Fringe slider, quiet on closed `o` |
| Preset | `honeyChrome` (default knobs in `demo/scratch.html`) |

Frames: `demo/frames/scratch-look-after.png` (pre-fringe FAIL), `demo/frames/scratch-look-after-fringe.png` (fringe ON).

## Demo

Serve repo root, then open:

**http://localhost:52780/demo/scratch.html**

```bat
npm run demo:serve
```

Drag to orbit / scroll to zoom. Controls: **Gravity** (0 = baked sculpture), **Freeze ht**, **Viscosity**, **IOR**, **Fringe**. Stage 5 + Resettle for optional runtime sag.

**Honest match vs concept art:** baked mesh captures plump letterforms + honey teardrop bottoms. Full iridescent chrome of the stills is approximated in Three (softbox + fringe), not a pixel-matched Cycles render of the concept frames.

Drop-modeling research (legacy sag path): [`docs/drop-modeling-research.md`](../../docs/drop-modeling-research.md).
