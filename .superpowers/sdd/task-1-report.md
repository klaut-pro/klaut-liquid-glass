# Task 1 report: Authored softbox environment

## Status

DONE_WITH_CONCERNS

## Scope completed

- Replaced the scratch demo's happy-path `RoomEnvironment` PMREM with a small authored Three scene.
- The authored scene contains three neutral-white softbox rectangles against a `#030406` charcoal void and is baked through `PMREMGenerator.fromScene`.
- Kept `RoomEnvironment` as a dynamically imported fallback that runs only when authored PMREM setup throws.
- Kept the demo background at `#07090e`, preserved the existing exposure and environment intensity, and left all MeshPhysical settings, melt logic, fonts, per-letter overrides, and mesh topology untouched.
- Added a focused static regression check for the authored-PMREM wiring and fallback arrangement.

## Asset assessment

`demo/env/studio-softbox.png` is an 8-bit RGB 2048×2048 square image. It is not a usable equirectangular source (which requires a 2:1 projection), so the task's permitted authored-scene PMREM path was used instead.

## Verification

- `node scripts/test-scratch-environment.mjs` passed.
- `npm run build` passed (`tsc -p tsconfig.json`).
- `git diff --check` passed.
- A local static server accepted connections and served the demo path.
- Browser smoke could not complete: the local Playwright Chromium binary exited during launch with `Invalid file descriptor to ICU data received` before the page loaded. This is an execution-environment failure, so no browser console or visual screenshot result was available.

## Self-review

- Confirmed there is no static `RoomEnvironment` import and that `scene.environment` awaits the authored PMREM on the normal path.
- Confirmed the fallback is isolated to the authored-environment error path.
- Confirmed the diff is limited to environment wiring plus the focused regression test; direct lights and material/melt/font/geometry code are unchanged.

## Concern

Rendered visual sanity still needs a browser run on an environment with a functioning Chromium/ICU installation. No task-owned frame assets were produced or staged.
