---
name: liquid-glass-physics
description: >-
  Liquid glass physics cheat sheet — Snell refraction, RGB/spectral dispersion,
  Fresnel, thin-film Δ, metaball smoothMin, safe knob ranges. Use when tuning
  materials, debugging fringe color, or preventing fake purple bloom.
---

# Liquid Glass Physics

Cheat sheet for the **`@klaut-pro/klaut-liquid-glass`** shade + field stack. Tune materials with real optics language — not CSS blur + purple glow.

Related: `liquid-glass-engine` (API), `liquid-glass-design` (moods).

## Hard ban: fake fringe

**Do not** fake diffraction with:

- Flat purple / violet bloom overlays
- Single-tint `box-shadow` / glow as “chromatic aberration”
- Hue-rotate filters on a blurred pane

Real fringe is **wavelength-dependent bending** (per-channel η or thin-film interference) → cyan–magenta–lime edges, angle-dependent, stronger at grazing / high curvature.

If the look is “one purple haze,” lower bloom and raise `dispersion` / `filmThickness` instead.

## Phenomena → shader approach

| Phenomenon | Physics | Engine approach |
|------------|---------|-----------------|
| Refraction | Snell; bend by surface normal | Sample backdrop with `refract(V, N, η)` UV offset from ∇SDF |
| Chromatic dispersion | IOR varies with λ (Cauchy / Sellmeier) | Separate η for R/G/B (v1); optional spectral → CIE → sRGB later |
| Fresnel | More reflection at grazing | Schlick; rim brightening |
| Thin-film iridescence | Path difference Δ (soap / oil) | Dual-interface Fresnel + `cos(Δ)`; thickness from SDF/noise |
| Specular / caustics | Focus through curved liquid | Specular lobe; optional cheap caustic sheet under drops |
| Liquify / drops | Surface tension merge → pinch | Metaballs / SDF `smoothMin`; detach when neck thins |

## Field stack (order of mind)

1. **Compose field** — SDF primitives + MSDF glyphs + metaball sum / `smoothMin`
2. **Glass shade** — refraction UV from field gradient, Fresnel, bevel (`zRadius`)
3. **Dispersion / film** — RGB η split and/or thin-film Δ
4. **Composite** — over live capture or self-contained SDF scene

Live DOM MVP uses **scene capture** as backdrop. Self-contained SDF scenes are for demos, stress tests, and offline bake.

## Safe parameter ranges

| Knob | Safe start | Push for concept art | Notes |
|------|------------|----------------------|-------|
| `ior` | 1.33 (water-ish) | 1.1–1.5 | Too high → wild UV stretch / sampling artifacts |
| `glass` | 0.7–1.0 | 1.0 | 0 = no pane |
| `dispersion` | 0.2–0.4 (UI) | 0.6–0.9 | Fringe from η split — not purple bloom |
| `filmThickness` | 0–0.3 (UI) | 0.4–0.8 | Iridescent soap/oil; pairs with `orbFilm` |
| `liquify` | 0–0.25 (UI) | 0.7–1.0 | Soft-min melt of the field |
| `drip` | 0–0.1 (UI) | 0.4–0.8 | Needs enough liquify to form necks |
| Bevel / `zRadius` | modest | higher for chrome lip | Drives normal strength → refraction + Fresnel |

### Coupling rules

- Raise **`drip` only with `liquify`** — drips need a soft field and thinning necks.
- **UI panes**: high `glass`, low `liquify`/`drip`, moderate `dispersion`.
- **Concept chrome**: high `glass` + `dispersion` + `liquify`; add `drip` last.
- **Film mood**: lead with `filmThickness`; keep `dispersion` supportive, not a purple wash.

## Dispersion vs thin film

| Mode | What you see | When |
|------|--------------|------|
| RGB η split (`dispersion`) | Edge fringe (R/G/B sample offsets) | Default psychedelic edge |
| Thin film (`filmThickness`) | Angle/thickness washes (cyan↔magenta↔gold) | Orbs, soap, oil slick |
| Both | Rich maximalist | Cap intensity so text stays readable |

## Metaball / liquify notes

- Merge blobs with **`smoothMin`** (or field sum + threshold) — hard `min` looks polygonal.
- Drops **detach** when the neck field falls below threshold; don’t animate sprites that ignore the field.
- Seed drips along medial axis / bottom edge of the glyph or pane SDF — not random screen particles.

## Debugging look failures

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| Purple flat glow | Fake bloom / wrong tint | Disable bloom; use `dispersion`/`filmThickness` |
| No bend of background | Capture missing or η≈1 | Fix capture; raise `ior`/`glass` |
| Fringe only on one side | Bad normals / one-axis offset | Check ∇SDF and per-channel UV |
| Melty soup, no drops | `liquify` high, `drip` ~0 or threshold wrong | Raise `drip`; tune detach threshold |
| Unreadable UI | Over-dispersion / over-film | Lower dispersion/film; keep DOM text sharp |
| Jank / low FPS | Too many live surfaces | ≤3 live; bake decorative loops |

## Agent rules

1. Speak in refraction / dispersion / Fresnel / film / metaball terms when suggesting knobs.
2. Never prescribe purple bloom as diffraction.
3. Prefer preset → small knob deltas over inventing new shader passes in app code.
4. Point implementers at the engine package — do not re-derive Sellmeier in landing CSS.
