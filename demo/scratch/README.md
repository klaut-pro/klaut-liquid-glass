# Scratch 3D liquid-glass pipeline

Clean staged path — **not** the old `chromeSansP` / `scriptProP` SDF atlas QA harness.

## Stage 1 — Font

| Choice | Why |
|--------|-----|
| **Arial Black** (`C:\Windows\Fonts\ariblk.ttf`) | Heavy geometric display sans on every Windows box; extrudes cleanly; reads as a block letter under glass |

Glyph for this pass: **`klaut.pro`** (full brand wordmark, one rotatable glass mesh).

Bake:

```bat
npm run bake:scratch
```

or:

```bat
"%LOCALAPPDATA%\Programs\blender-portable\blender-4.2.16-windows-x64\blender.exe" ^
  --background --python scripts/bake-scratch-mesh.py
```

→ `demo/scratch/mesh/wordmark-klaut-pro.glb` + `manifest.json`

## Stages (in order)

| # | Goal | Status |
|---|------|--------|
| 1 | Pick one font + bake wordmark mesh | ✅ this pass |
| 2 | 3D rotatable (OrbitControls) | ✅ `demo/scratch.html` |
| 3 | Clear refractive glass (IOR / Fresnel / env) | ✅ same page |
| 4 | Liquid glass (liquify / soft surface) | ✅ slider on page |
| 5 | Gravity melt + viscosity + freeze | ✅ `GravityMeltSim` (letter mesh only) |
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

Drag to orbit. Controls: **Gravity**, **Freeze ht**, **Viscosity**, **IOR**, **Fringe**. Resettle / Freeze now for pose control.

**Stage 5 physics (`docs/drop-modeling-research.md` §3.1 / §5c):**

- **Frozen viscoplastic sag** — letter mesh yields under gravity; upper band stays identity
- Tunable `freezeHeight` + falloff; Oh maps → neck pinch / bulb grow / settle speed
- One-shot settle → freeze (static sculpture, not ongoing drip sim)
- Preferential columns under stems (same mesh — **no attached drip blobs**)

Drop-modeling research: [`docs/drop-modeling-research.md`](../../docs/drop-modeling-research.md).
