# @klaut-pro/klaut-liquid-glass

From-scratch **WebGL2** liquid glass for live UI: refractive panes, liquify→drops, and psychedelic thin-film fringe.

Not another CSS glassmorphism blur. See [docs/liquid-glass-research.md](docs/liquid-glass-research.md) for physics citations and grill locks.

## Install

```bash
npm install @klaut-pro/klaut-liquid-glass
```

## Quick start

```ts
import { LiquidGlass } from "@klaut-pro/klaut-liquid-glass";

const engine = LiquidGlass.create({ root: document.body });

const panel = engine.glassify(waitlistEl, {
  ...LiquidGlass.presets.chromeDrip,
  glass: 1,
  liquify: 0.35,
  drip: 0.2,
  dispersion: 0.7,
  filmThickness: 0.45,
});

panel.set({ liquify: 0.85 });
engine.start();
```

## Material knobs

| Knob | Range | Role |
|---|---|---|
| `glass` | 0–1 | Pane strength / opacity of glass shade |
| `liquify` | 0–1 | Metaball field warp (surface tension melt) |
| `drip` | 0–1 | Drop emission along bottom edge |
| `dispersion` | 0–1 | RGB η split (cyan–magenta–lime fringe) |
| `filmThickness` | 0–1 | Thin-film interference strength |
| `ior` | ~1.1–1.6 | Base index of refraction |
| `bevel` / `zRadius` | 0–1 | Edge bevel for normals |
| `blur` | 0–1 | Soft backdrop preblur |

### Presets

`applePane`, `chromeDrip`, `orbFilm`, `swarmChip`

## React

```tsx
import { Glassify, LiquidGlassDebugPanel } from "@klaut-pro/klaut-liquid-glass/react";
import { LiquidGlass } from "@klaut-pro/klaut-liquid-glass";

<Glassify material={LiquidGlass.presets.chromeDrip}>
  <form>…</form>
</Glassify>
```

## Performance

Cap **≤3** live `glassify` surfaces. Prefer baked loops for decorative heroes. Soft CSS/SVG fallback when WebGL fails; frozen/static glass when `prefers-reduced-motion: reduce`.

## License

MIT
