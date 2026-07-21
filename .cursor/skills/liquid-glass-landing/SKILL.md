---
name: liquid-glass-landing
description: >-
  Applies liquid glass to klaut landings — hero budget, Majico motion tokens,
  waitlist/CTA glassify, live vs baked. Use when editing klaut-landing-lab or
  other klaut.pro marketing pages with @klaut-pro/klaut-liquid-glass.
---

# Liquid Glass Landing

Apply **`@klaut-pro/klaut-liquid-glass`** to klaut marketing / landing surfaces without wrecking hero composition or motion systems.

Primary host target: **`klaut-landing-lab`** (waitlist + CTA, optional wordmark). Same rules apply to other klaut landings.

Related: `liquid-glass-engine`, `liquid-glass-typography`, `liquid-glass-design`.

## Hero budget (landing UI rules)

First viewport should stay a **single composition**:

- Brand / product signal (hero-level)
- One headline
- One short supporting sentence
- One CTA group
- One dominant visual plane

**Liquid glass fits as the material on CTA / waitlist / wordmark** — not as a dashboard of glass cards.

Do **not** fill the hero with: stat strips, schedule chips, address blocks, promo stickers, or multiple competing glass panes.

## Where to glassify (priority)

| Priority | Target | Preset start | Live? |
|----------|--------|--------------|-------|
| 1 | Waitlist / email field chrome | `applePane` → nudge dispersion | Yes |
| 2 | Primary CTA | `chromeDrip` light liquify | Yes |
| 3 | Optional wordmark | `chromeDrip` / typography skill | Yes only if still ≤3 total |
| — | Background orb / film loop | `orbFilm` | Prefer **bake later** |

Hard cap: **≤3 live surfaces**. If wordmark + waitlist + CTA are live, bake any extra hero decoration.

## Majico motion

When the landing already uses **Majico** brand / motion tokens (or synced Cursor skills from Majico MCP):

1. Respect existing motion tokens for entrance, hover, and reduced-motion.
2. Liquid glass **adds material**, not a second competing motion language — drip/liquify should feel like the same brand physics, not a random particle pack.
3. Sync / read Majico guidelines via existing Majico MCP tools when branding is in scope; don’t invent a purple gradient theme.
4. Pair glass materials with klaut brand tokens (see `liquid-glass-design`) — chrome/fringe, not generic glassmorphism.

If Majico motion says reduce or freeze, liquid glass must follow `prefers-reduced-motion` (static glass / no drip swarm).

## Integration sketch

```ts
import { LiquidGlass } from "@klaut-pro/klaut-liquid-glass";

const engine = LiquidGlass.create({ root: document.querySelector("main")! });

engine.glassify(waitlistShell, {
  ...LiquidGlass.presets.applePane,
  dispersion: 0.35,
});

engine.glassify(ctaButton, {
  ...LiquidGlass.presets.chromeDrip,
  liquify: 0.15,
  drip: 0.05,
  dispersion: 0.55,
});

// Optional third: wordmark — or skip and bake a logo loop
engine.start();
```

Expose a **debug knob panel** in lab builds (`panel.set`) so artists can reach concept-art vibe without code churn.

## Live vs baked on landings

| Surface | Prefer |
|---------|--------|
| Waitlist, CTA, interactive chrome | **Live** |
| Full-bleed psychedelic orb behind type | **Baked** video (Phase 7 / Hyperframes) once live look is locked |
| Low-power / mobile decorative loops | Baked |

Ship live MVP first; treat video as escape hatch after the live look is the FPS benchmark.

## Landing do / don’t

**Do**

- Glassify 1–2 interactive surfaces first; add wordmark only within budget
- Keep DOM forms and buttons operable under the overlay
- Match Majico / klaut brand motion and tokens
- Use real dispersion/film — no flat purple bloom fringe

**Don’t**

- Glassify every card below the fold
- Put glass cards in the hero “because glass”
- Stack live capture on scroll-jacking heavy sections
- Override Majico reduced-motion with endless drip

## Agent checklist

- [ ] Hero still reads as one composition
- [ ] ≤3 live glass surfaces
- [ ] Waitlist/CTA remain accessible DOM controls
- [ ] Motion respects Majico + `prefers-reduced-motion`
- [ ] Debug knobs available in lab if tuning for concept art
- [ ] Decorative maximalism planned as bake, not a 4th live pane
