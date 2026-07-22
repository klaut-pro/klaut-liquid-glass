# Scratch 3D liquid-glass pipeline

Clean staged path — **not** the old `chromeSansP` / `scriptProP` SDF atlas QA harness.

## Stage 1 — Font

| Choice | Why |
|--------|-----|
| **Arial Black** (`C:\Windows\Fonts\ariblk.ttf`) | Heavy geometric display sans on every Windows box; extrudes cleanly; reads as a block letter under glass |

Glyph for this pass: **`K`** (single letter, clear silhouette, easy to orbit).

Bake:

```bat
"%LOCALAPPDATA%\Programs\blender-portable\blender-4.2.16-windows-x64\blender.exe" ^
  --background --python scripts/bake-scratch-mesh.py
```

→ `demo/scratch/mesh/letter-K.glb` + `manifest.json`

## Stages (in order)

| # | Goal | Status |
|---|------|--------|
| 1 | Pick one font + bake mesh | ✅ this pass |
| 2 | 3D rotatable (OrbitControls) | ✅ `demo/scratch.html` |
| 3 | Clear refractive glass (IOR / Fresnel / env) | ✅ same page |
| 4 | Liquid glass (liquify / soft surface) | ✅ slider on page |
| 5 | Gravity + viscosity drips | ✅ viscosity slider |
| 6 | Dispersion / light-driven fringe polish | later |

## Demo

Serve repo root, then open:

**http://localhost:52780/demo/scratch.html**

Drag to orbit. Use the stage / viscosity / liquify controls.
