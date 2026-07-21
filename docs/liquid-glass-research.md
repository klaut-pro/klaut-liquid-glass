# Liquid Glass Engine — Research & Grill Locks

Canonical research freeze for `@klaut-pro/klaut-liquid-glass`. Citations are public sources used to design the from-scratch WebGL2 field+shade core. We steal refraction / thin-film / metaball **math**, not pane-library forks.

## Grill locks (must ship)

| Decision | Locked choice |
|---|---|
| Build | From-scratch WebGL2 field+shade; do **not** fork DOM-capture pane libs |
| MVP | Live-DOM `glassify(el, material)` usable in klaut UI |
| Artist control | Composable knobs: `glass`, `liquify`, `drip`, `dispersion`, `filmThickness`, `ior` + presets |
| Look differentiator | **liquify → drops** + **psychedelic fringe** (thin-film + RGB η), not another blur pane |
| Fallback | Soft WebGL → CSS/SVG displacement; honor `prefers-reduced-motion` |
| Perf guidance | Cap **≤3** live glass surfaces; bake decorative loops later |

## Physics stack (engine must implement)

| Phenomenon | Physics | Shader approach |
|---|---|---|
| Refraction | Snell’s law; bend backdrop by surface normal | Sample backdrop with `refract(V, N, η)` UV offset |
| Chromatic dispersion | IOR varies with wavelength (Cauchy) | Separate η for R / G / B |
| Fresnel | More reflection at grazing angles | Schlick approx; rim brightening |
| Thin-film iridescence | Soap-bubble / oil-slick path difference Δ | Dual-interface Fresnel + `cos(Δ)` interference; thickness from SDF/noise |
| Specular / caustics | Focused light through curved liquid | Specular lobe (+ optional cheap caustic sheet) |
| Liquify / drops | Surface tension: fields merge then pinch off | Metaballs: field sum or SDF `smoothMin`; drip emission along bottom edge |

## Prior art (math sources, not forks)

### Tier A — UI glass panes

- [ybouane/liquidglass](https://github.com/ybouane/liquidglass) — WebGL; DOM capture → blur → refraction + chromatic aberration + Fresnel + specular.
- [naughtyduk/liquidGL](https://github.com/naughtyduk/liquidGL) — WebGL pane over snapshot.
- [dpawlikowski/liquid-glass](https://github.com/dpawlikowski/liquid-glass) — CSS/SVG `feTurbulence` + `feDisplacementMap` (no true Snell; good **fallback**).
- [Zenn refractive glass SDF](https://zenn.dev/orectic/articles/liquid-glass-webgl-refraction)
- [aghajari Liquid Glass explanation](https://medium.com/@aghajari/liquid-glass-ios-effect-explanation-dabadd6414ae)

### Tier B — spectral / psychedelic fringe

- [Maxime Heckel — refraction & dispersion](https://blog.maximeheckel.com/posts/refraction-dispersion-and-other-shader-light-effects/) — per-channel IOR.
- [Saqoosha/Spectral-Glass](https://github.com/Saqoosha/Spectral-Glass) — WebGPU; Cauchy + Abbe; spectral → CIE (Phase 2 optional).
- [pompa-iridiscencia](https://github.com/SantiagoGR11/pompa-iridiscencia) — soap-bubble thin film.
- [Varun Vachhar — ray-march SDF iridescence](https://varun.ca/ray-march-sdf/)

### Tier C — liquify / drops

- [Codrops metaball droplets](https://tympanus.net/codrops/2025/06/09/how-to-create-interactive-droplet-like-metaballs-with-three-js-and-glsl/) — `smoothMin` + noise.
- Metaball text / glyph fields: [Lumitree metaballs](https://lumitree.art/blog/metaballs)
- MSDF type source: [three-msdf-text](https://github.com/leochocolat/three-msdf-text)

## Critical constraint

Browsers cannot read “pixels under this element” into a shader. Real refraction needs:

1. **Scene capture** (clone / offscreen → texture) — MVP for live UI, or
2. **Self-contained SDF scene** (engine draws background + glass) — demos / bake.

Grill priority: **(1) live capture glassify** with the same field stack raising `liquify` / `drip` / `dispersion` / `filmThickness`.

## Concept north star

Maximalist chrome-drip / diffraction orb concept art (conversation asset) is the visual mood target — iridescent fringe, melting drips — **not** a runtime texture. Brand SVG marks in klaut repos are good SDF glyph seeds, not the psychedelic look by themselves.

## Non-goals (first ship)

- Full spectral WebGPU path
- Node-graph visual editor
- Server-side GPU / screenshot MCP
- Glassifying every card (≤3 live)
- Forking pane libs for the core

## Validation bar

- ≥2 live-DOM glass surfaces + debug knobs
- Concept-art vibe reachable via liquify + drip + dispersion + film
- ~45–60fps mid laptop with ≤3 surfaces
- Soft WebGL fallback + reduced-motion freeze/static glass
