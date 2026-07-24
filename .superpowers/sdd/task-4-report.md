# Task 4 report: Gated Fresnel fringe

## Status
DONE

## Implemented
- `installEdgeFringe` on `matGlass` / `matLiquid` via `onBeforeCompile`
- Fresnel-masked edge fire (gold↔lime↔cyan from shaders.ts `edgeFire` rails)
- Fringe HUD slider (default 0.9); o carve-out fringe quiet (~0.08 max)
- Softbox + Physical retune preserved

## Capture
- `demo/frames/scratch-look-after-fringe.png`
- Softbox happy path (`roomLoaded: false`)

## Tests
- `scripts/test-scratch-fringe.mjs` added
- materials test updated to expect fringe after glance FAIL

## Glance after fringe
Improved rim/oil color vs pre-fringe milky grey; still denser glass than concept chrome, but gate-required fringe is shipped behind slider.
