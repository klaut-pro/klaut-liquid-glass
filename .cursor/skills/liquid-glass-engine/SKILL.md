---
name: liquid-glass-engine
description: >-
  Integrates @klaut-pro/klaut-liquid-glass — glassify live DOM, material API,
  presets, perf budget, reduced-motion, and WebGL fallbacks. Use when installing
  or wiring liquid glass, calling glassify, choosing presets, or capping live
  surfaces.
---

# Liquid Glass Engine

Agent playbook for **`@klaut-pro/klaut-liquid-glass`**: live-DOM glassify, composable materials, presets, and runtime constraints.

Related skills: `liquid-glass-physics`, `liquid-glass-typography`, `liquid-glass-landing`, `liquid-glass-design`.

## Package

| Item | Value |
|------|--------|
| npm | `@klaut-pro/klaut-liquid-glass` |
| repo | `klaut-pro/klaut-liquid-glass` |
| runtime | WebGL2 (CSS/SVG displacement fallback) |

Do **not** fork DOM-capture pane clones. Use this package’s field + shade stack.

## Install

```bash
npm install @klaut-pro/klaut-liquid-glass
```

## Quick start

```ts
import { LiquidGlass } from "@klaut-pro/klaut-liquid-glass";

const engine = LiquidGlass.create({
  root: document.querySelector("#app")!,
});

const panel = engine.glassify(waitlistEl, {
  ...LiquidGlass.presets.chromeDrip,
  glass: 1,
  liquify: 0.2,
  drip: 0.05,
  dispersion: 0.7,
  filmThickness: 0.4,
});

panel.set({ liquify: 0.85, drip: 0.6 }); // live tweaks / debug
engine.start();
```

## API surface

### `LiquidGlass.create(options)`

| Option | Purpose |
|--------|---------|
| `root` | Mount / capture root (usually app or section) |
| `dpr` | Optional DPR cap (prefer ≤2 for perf) |
| `reducedMotion` | Honor `prefers-reduced-motion` (default: true) |

Returns an engine with `glassify`, `start`, `stop`, and surface handles.

### `engine.glassify(el, material)`

1. Captures live backdrop behind `el` into a texture.
2. Overlays a WebGL canvas sized to the element.
3. Shades with the material stack (refraction → Fresnel → dispersion/film → liquify/drip).

**Keep real DOM for a11y/layout.** The canvas is decorative visual layer only — never replace focusable controls or readable text with canvas-only content (see `liquid-glass-typography`).

### Material knobs (composable)

| Knob | Range (typical) | Role |
|------|-----------------|------|
| `glass` | 0–1 | Refraction / pane presence |
| `liquify` | 0–1 | Metaball soft-min melt |
| `drip` | 0–1 | Drop emission / detach |
| `dispersion` | 0–1 | Per-channel IOR split (cyan–magenta–lime fringe) |
| `filmThickness` | 0–1 | Thin-film iridescence Δ |
| `ior` | ~1.1–1.5 | Base index of refraction |

Start from a **preset**, then override knobs. Prefer `panel.set({...})` for live artist tweaks.

### Presets

| Preset | Mood |
|--------|------|
| `applePane` | Clean UI glass pane; low liquify/drip |
| `chromeDrip` | Maximalist chrome melt + fringe (concept north star) |
| `orbFilm` | Soap-bubble / oil-slick film dominance |
| `swarmChip` | Small chip/badge; tight field, light drip |

```ts
engine.glassify(el, { ...LiquidGlass.presets.applePane, dispersion: 0.35 });
```

Full mood composition → `liquid-glass-design`. Physics ranges → `liquid-glass-physics`.

## Perf budget (hard)

- **≤3 live glass surfaces** per page/view at once.
- Target **~45–60fps** on a mid laptop with ≤3 surfaces.
- Cap DPR; avoid full-page capture loops every frame if the package offers dirty/resize hooks — follow package docs.
- Extra decorative heroes → **bake to video later** (Phase 7 / Hyperframes). Do not spawn a 4th live surface “just for the hero.”

## Live vs baked video

| Use | Mode |
|-----|------|
| Interactive UI (forms, CTAs, waitlist, focusable chrome) | **Live** `glassify` |
| Decorative looping hero, low-power clients, static marketing | **Bake** WebM/MP4 from the same animation (after live MVP) |

Live engine is the quality/FPS benchmark. Baked video is an escape hatch, not a substitute for interactive glass.

## Fallbacks

| Condition | Behavior |
|-----------|----------|
| WebGL unavailable / context lost | CSS/SVG `feDisplacementMap`-style pane — **no drops** |
| `prefers-reduced-motion: reduce` | Freeze animation or static glass; no drip swarm |
| Capture failure | Soft degrade; do not crash the page |

Always leave underlying DOM usable if the canvas fails.

## Agent checklist

- [ ] Package import from `@klaut-pro/klaut-liquid-glass`
- [ ] Start from a named preset, then override
- [ ] ≤3 live surfaces
- [ ] Real DOM kept for text/controls
- [ ] Reduced-motion respected
- [ ] No flat purple bloom as “dispersion” (use real η split / film — see physics skill)
- [ ] Interactive = live; decorative loop = bake later

## Do not

- Implement a parallel WebGL refraction stack in app code
- Glassify every card or list row
- Send both a custom bloom overlay and claim it is spectral fringe
- Block on MCP/server rendering — rendering stays in the client package
