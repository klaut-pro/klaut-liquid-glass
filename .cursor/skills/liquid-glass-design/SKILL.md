---
name: liquid-glass-design
description: >-
  Visual artist skill for liquid glass materials — compose moods (chromeDrip,
  orbFilm, applePane, swarmChip), liquify vs glass, contrast/readability, klaut
  brand pairing. Use when art-directing glass UI or matching concept-art fringe.
---

# Liquid Glass Design

**Visual artist / design-system** skill for composing materials in `@klaut-pro/klaut-liquid-glass`. Goal: look like iridescent chrome + melting drips + psychedelic fringe — not another frosted blur pane.

Related: `liquid-glass-engine` (API), `liquid-glass-physics` (optics), `liquid-glass-typography`, `liquid-glass-landing`.

## North star

Maximalist concept art: **iridescent chrome, melting drips, cyan–magenta–lime fringe**.

Not: iOS-style light blur, white frosted cards, or **flat purple bloom** sold as diffraction.

## Material composition

Think in layers (all one stack, knobs only):

1. **Glass** — refraction + Fresnel body  
2. **Field melt** — `liquify` softens the SDF/metaball field  
3. **Drips** — `drip` pinches and detaches drops  
4. **Fringe** — `dispersion` (η split) and/or `filmThickness` (interference)

```text
mood = preset + (glass, liquify, drip, dispersion, filmThickness, ior)
```

Always start from a **named preset**, then nudge.

## Preset moods

| Preset | Intent | Raise | Keep low |
|--------|--------|-------|----------|
| `applePane` | Product UI glass | `glass`, slight `dispersion` | `liquify`, `drip`, `filmThickness` |
| `chromeDrip` | Concept chrome melt | `glass`, `liquify`, `dispersion`, then `drip` | over-film wash that kills edges |
| `orbFilm` | Soap / oil orb | `filmThickness`, `glass` | heavy `drip` on small orbs |
| `swarmChip` | Dense small chips | mild `liquify`/`drip`, tight field | full-screen capture cost |

### When to raise liquify vs glass

| Goal | Bias |
|------|------|
| Readable control chrome | `glass` ↑ · `liquify`/`drip` ↓ |
| Melting logo / sting | `liquify` ↑ · add `drip` after melt reads |
| Psychedelic edge only | `dispersion`/`filmThickness` ↑ · geometry stable |
| Quiet enterprise pane | `applePane` · tiny dispersion |

Rule of thumb: **get the pane believable (`glass`) before melting it.** Drips last.

## Fringe art direction

- Target fringe hues: **cyan / magenta / lime** from physics, not a purple overlay.
- Fringe should hug **high curvature and silhouettes**, not flood the fill.
- If the piece reads “lavender fog,” cut bloom and retune `dispersion` / `filmThickness` (physics skill).

## Contrast & readability on glass UI

- Interactive labels and input text stay **DOM**; ensure fallback styles without WebGL.
- Behind glass, prefer darker or quieter plates so refracted content doesn’t fight type.
- Don’t put long copy on heavy `chromeDrip` — short marks and CTAs only.
- Focus and hover states must remain obvious; glass is dressing, not the affordance.
- Reduced motion: hold a beautiful **still** — still must pass contrast.

## Pairing with klaut brand

- Prefer tokens / guidelines from **klaut brand** (and Majico-authored brand stored under klaut-pro), not generic purple-on-white AI defaults.
- Simple geometric marks in `brand/logo/` → SDF glass glyphs.
- Concept PNGs = **reference only**, never runtime texture.
- Motion: align with Majico landing motion (`liquid-glass-landing`); one physics language.

## Composition recipes

**Waitlist shell (lab)**  
`applePane` + `dispersion: 0.3–0.4` · liquify ≤ 0.15

**Primary CTA**  
`chromeDrip` + `liquify: 0.1–0.25` · `drip: 0–0.1` · `dispersion: 0.5–0.7`

**Hero wordmark**  
`chromeDrip` + higher liquify/drip · still ≤3 live surfaces · see typography skill

**Background orb**  
`orbFilm` · prefer **baked loop** for landings once live look is locked

## Artist checklist

- [ ] Started from a preset (not random uniforms)
- [ ] Fringe is spectral/film — not purple bloom
- [ ] Liquify only where melt is intentional
- [ ] Text/controls remain readable (live + fallback)
- [ ] Mood matches klaut / concept north star
- [ ] Live surface count ≤3; extras planned as bake

## Do not

- Default to purple-indigo glassmorphism
- Glassify every card for “consistency”
- Use concept art PNG as the material albedo
- Treat blur + opacity as done
