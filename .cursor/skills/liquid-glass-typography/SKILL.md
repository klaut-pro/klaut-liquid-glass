---
name: liquid-glass-typography
description: >-
  MSDF / wordmark liquify for liquid glass — keep real DOM text for a11y,
  decorative canvas overlay only. Use when glassifying logos, headlines, or
  melting type with @klaut-pro/klaut-liquid-glass.
---

# Liquid Glass Typography

How to liquify **wordmarks and display type** with `@klaut-pro/klaut-liquid-glass` without breaking accessibility or SEO.

Related: `liquid-glass-engine`, `liquid-glass-physics`, `liquid-glass-landing`.

## Core rule

**DOM owns meaning. Canvas owns spectacle.**

| Layer | Responsibility |
|-------|----------------|
| Real DOM text / SVG | Readable string, focus order, screen readers, selection, SEO |
| Engine canvas | MSDF/SDF field + glass shade over or around the mark |

Never replace a heading or logo with canvas-only pixels and `aria-hidden` on the only copy of the words.

## Recommended pattern

```html
<!-- Visible for a11y; may be visually muted under glass -->
<h1 class="wordmark" data-glass-target>
  klaut
</h1>
```

```ts
const el = document.querySelector("[data-glass-target]");
engine.glassify(el, {
  ...LiquidGlass.presets.chromeDrip,
  glass: 1,
  liquify: 0.55,
  drip: 0.35,
  dispersion: 0.75,
});
```

- Keep the text node in the tree with correct semantics (`h1`, `p`, `span` with accessible name).
- If the glass overlay fully paints over glyphs, ensure contrast of the **underlying** text still works when WebGL fails, or provide a non-glass fallback style.
- Decorative drips must not require reading the canvas to understand the brand name.

## MSDF / glyph fields

Engine path (when available):

1. Load **MSDF atlas** for the display face (or sample SVG logo as SDF).
2. Layout string → distance field.
3. Compose with metaballs (`smoothMin`) for liquify/drip.
4. Shade with glass + dispersion/film.

Brand marks in `brand/logo/` (simple geometric SVG) are good **SDF glass glyph** sources — not psychedelic textures by themselves. Concept-art PNGs are north-star reference only; **do not** use them as runtime textures.

## Liquify intensity by role

| Role | `liquify` | `drip` | Notes |
|------|-----------|--------|-------|
| Body / UI labels | 0 | 0 | Do not liquify reading text |
| Nav wordmark (small) | 0–0.2 | 0–0.05 | Prefer `applePane` or light film |
| Hero wordmark | 0.4–0.85 | 0.2–0.6 | Concept chrome OK; keep one live surface |
| One-shot logo sting | high | high | Prefer **baked video** if not interactive |

## Accessibility checklist

- [ ] Text (or `aria-label`) present in DOM matching what users should hear
- [ ] Contrast of fallback / reduced-motion static state meets WCAG for the context
- [ ] `prefers-reduced-motion`: freeze melt/drip; static glass or plain type OK
- [ ] Focus rings and hit targets stay on DOM controls — never only on canvas
- [ ] Don’t put essential instructions only inside the shaded overlay
- [ ] If text is visually hidden under heavy glass, use `sr-only` / visually-hidden **duplicate** only when the visible layer is truly non-text; prefer keeping one visible DOM string

## Perf

- A liquified wordmark counts as **one live surface** toward the ≤3 budget.
- Prefer one hero liquify + plain type elsewhere.
- Long paragraphs must stay CSS/DOM — MSDF liquify is for short display strings.

## Do not

- Rasterize the only copy of the logo into a PNG and glassify that alone
- Animate fake purple chromatic outlines on CSS text as a stand-in
- Liquify form labels, legal copy, or error messages
- Exceed one melting wordmark live without dropping another live glass surface
