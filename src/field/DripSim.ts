/**
 * Viscosity-driven pendant-drop simulation (CPU).
 *
 * Practical continuum model (not full SPH):
 * - Mass accumulates at bottom emitters (Bond-ish critical mass → drip)
 * - Stretch phase forms a neck; viscosity lengthens the neck and slows pinch
 * - Detach when neck thins below threshold → free drops under gravity + drag
 * - Nearby free drops remerge (surface-tension proxy); softMin in the shader
 *   blends them with the pane field
 *
 * Viscosity (0–1): low = watery/fast/short necks; high = thick/slow/long necks.
 * Inspired by pendant-drop / Plateau–Rayleigh pinch literature + Codrops smoothMin metaballs.
 */

export const MAX_DRIP_BLOBS = 24;

export type DripBlob = {
  /** Normalized field coords (same space as shader `p`). */
  x: number;
  y: number;
  r: number;
  w: number;
};

export type DripSimParams = {
  drip: number;
  liquify: number;
  viscosity: number;
  halfW: number;
  halfH: number;
  reducedMotion: boolean;
};

type Phase = "fill" | "stretch" | "cooldown";

type Emitter = {
  x: number;
  seed: number;
  mass: number;
  phase: Phase;
  stretchT: number;
  cooldown: number;
  neckR: number;
};

type FreeDrop = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  mass: number;
};

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

function mix(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Ohnesorge-ish mapping: high viscosity → slow fill, long stretch, thick blobs. */
function viscosityMaps(viscosity: number, drip: number) {
  const v = clamp01(viscosity);
  const d = Math.max(drip, 0.02);
  return {
    /** Seconds to fill critical mass (scaled by drip intensity). */
    fillPeriod: mix(0.55, 2.6, v) / d,
    /** Critical mass before stretch begins. */
    criticalMass: mix(0.35, 0.85, v),
    /** How far the pendant stretches before pinch (in halfH units). Concept: long syrup stems. */
    stretchLen: mix(0.28, 0.95, v),
    /** Stretch duration (s) — viscous = slow melt. */
    stretchDuration: mix(0.35, 1.85, v),
    /** Neck thin rate during stretch (higher = faster pinch). */
    neckThinRate: mix(2.8, 0.42, v),
    /** Free-drop radius scale — bulbous teardrop tips like concept art. */
    dropR: mix(0.055, 0.14, v),
    /** Linear drag on free drops. */
    drag: mix(0.1, 0.78, v),
    /** Gravity (field units / s²), slightly damped when viscous. */
    gravity: mix(1.25, 0.42, v),
    /** softMin merge width hint (shader also uses viscosity). */
    mergeK: mix(0.04, 0.24, v),
    /** Cooldown after detach before refill. */
    cooldown: mix(0.15, 0.7, v),
  };
}

export class DripSim {
  private emitters: Emitter[] = [];
  private frees: FreeDrop[] = [];
  private emitterCount: number;

  constructor(emitterCount = 5) {
    this.emitterCount = Math.max(1, Math.min(8, emitterCount));
    this.resetEmitters(0.48);
  }

  private resetEmitters(halfW: number): void {
    this.emitters = [];
    for (let i = 0; i < this.emitterCount; i++) {
      const nx = (i - (this.emitterCount - 1) / 2) / Math.max(this.emitterCount / 2, 1);
      this.emitters.push({
        x: nx * halfW * 0.72,
        seed: (i * 17 + 3) % 10 / 10,
        mass: (i * 0.13) % 0.4,
        phase: "fill",
        stretchT: 0,
        cooldown: i * 0.15,
        neckR: 1,
      });
    }
  }

  reset(): void {
    this.frees = [];
    this.resetEmitters(0.48);
  }

  /**
   * Advance simulation; returns metaball blobs for the shade pass.
   * Coords match shader field space: origin center, +y up, pane bottom ≈ -halfH.
   */
  step(dt: number, p: DripSimParams): DripBlob[] {
    const blobs: DripBlob[] = [];
    const { drip, liquify, viscosity, halfW, halfH, reducedMotion } = p;
    if (reducedMotion || (drip < 0.001 && liquify < 0.001)) {
      return blobs;
    }

    // Keep emitter x layout in sync with aspect
    for (let i = 0; i < this.emitters.length; i++) {
      const nx = (i - (this.emitterCount - 1) / 2) / Math.max(this.emitterCount / 2, 1);
      this.emitters[i].x = nx * halfW * 0.72;
    }

    const maps = viscosityMaps(viscosity, drip);
    const minDim = Math.min(halfW, halfH);
    const bottomY = -halfH * 0.92;
    const sag = liquify * halfH * 0.18;

    // --- Liquify body: soft accumulation bulges along bottom ---
    if (liquify > 0.001) {
      for (const em of this.emitters) {
        const bulge = 0.55 + 0.45 * em.mass;
        blobs.push({
          x: em.x + Math.sin(em.seed * 12.0) * 0.01,
          y: bottomY + sag * 0.35,
          r: mix(0.07, 0.16, liquify) * minDim * bulge,
          w: liquify * (0.55 + 0.45 * em.mass),
        });
      }
    }

    if (drip < 0.001) {
      this.mergeFrees(dt, maps.mergeK, halfH);
      this.integrateFrees(dt, maps, halfH, halfW, blobs, minDim);
      return this.trim(blobs);
    }

    // --- Emitters: fill → stretch → pinch → detach ---
    for (const em of this.emitters) {
      const wobble = Math.sin(em.seed * 40 + em.mass * 8) * 0.012 * halfW;

      if (em.phase === "cooldown") {
        em.cooldown -= dt;
        if (em.cooldown <= 0) {
          em.phase = "fill";
          em.mass = 0;
          em.stretchT = 0;
          em.neckR = 1;
        }
        continue;
      }

      if (em.phase === "fill") {
        em.mass += dt / maps.fillPeriod;
        // Growing pendant attached to bottom
        const grow = clamp01(em.mass / maps.criticalMass);
        const pendR = maps.dropR * minDim * (0.45 + 0.55 * grow) * (0.5 + 0.5 * drip);
        const pendY = bottomY - grow * halfH * 0.12 * (0.4 + drip);
        blobs.push({
          x: em.x + wobble,
          y: pendY,
          r: pendR,
          w: drip * (0.35 + 0.65 * grow),
        });
        // Short neck bridge
        blobs.push({
          x: em.x + wobble * 0.5,
          y: mix(bottomY, pendY, 0.45),
          r: pendR * mix(0.55, 0.85, viscosity),
          w: drip * grow * 0.7,
        });

        if (em.mass >= maps.criticalMass) {
          em.phase = "stretch";
          em.stretchT = 0;
          em.neckR = 1;
        }
        continue;
      }

      // stretch
      em.stretchT += dt / maps.stretchDuration;
      const t = clamp01(em.stretchT);
      // Neck thins (viscous fluids keep neck longer — slower thin rate)
      em.neckR = Math.max(0, 1 - t * maps.neckThinRate * (0.35 + 0.65 * t));
      const stretch = t * maps.stretchLen * halfH;
      const tipY = bottomY - stretch;
      const tipR = maps.dropR * minDim * (0.75 + 0.35 * drip) * (1.05 - 0.2 * t);
      const neckY = mix(bottomY, tipY, 0.42);
      const neckR = tipR * mix(0.25, 0.7, viscosity) * Math.max(em.neckR, 0.05);

      // Body residual at attachment
      blobs.push({
        x: em.x + wobble * 0.3,
        y: bottomY - stretch * 0.08,
        r: tipR * 0.85,
        w: drip * 0.85,
      });
      // Viscous filament / neck
      blobs.push({
        x: em.x + wobble * 0.2,
        y: neckY,
        r: neckR,
        w: drip * Math.max(0.15, em.neckR),
      });
      // Pendant tip
      blobs.push({
        x: em.x + wobble,
        y: tipY,
        r: tipR,
        w: drip,
      });

      // Detach when neck collapses (Rayleigh–Plateau proxy)
      if (em.neckR < 0.12 || t >= 1) {
        this.frees.push({
          x: em.x + wobble,
          y: tipY,
          vx: (em.seed - 0.5) * 0.08 * halfW,
          vy: -maps.gravity * 0.15, // initial downward kick
          r: tipR,
          mass: tipR,
        });
        em.phase = "cooldown";
        em.cooldown = maps.cooldown * (0.8 + em.seed * 0.4);
        em.mass = 0;
        em.stretchT = 0;
        em.neckR = 1;
      }
    }

    this.mergeFrees(dt, maps.mergeK, halfH);
    this.integrateFrees(dt, maps, halfH, halfW, blobs, minDim);
    return this.trim(blobs);
  }

  private integrateFrees(
    dt: number,
    maps: ReturnType<typeof viscosityMaps>,
    halfH: number,
    halfW: number,
    blobs: DripBlob[],
    minDim: number,
  ): void {
    const bottomY = -halfH * 0.92;
    const next: FreeDrop[] = [];
    for (const drop of this.frees) {
      drop.vy -= maps.gravity * dt;
      drop.vx *= 1 - maps.drag * dt;
      drop.vy *= 1 - maps.drag * 0.35 * dt;
      drop.x += drop.vx * dt;
      drop.y += drop.vy * dt;

      // Soft remerge into pane when rising back / contacting bottom lip
      const nearLip =
        drop.y > bottomY - halfH * 0.05 &&
        drop.y < bottomY + halfH * 0.12 &&
        Math.abs(drop.vy) < 0.25;
      if (nearLip && drop.vy >= -0.05) {
        // Absorb into nearest emitter mass
        let best = this.emitters[0];
        let bestD = Infinity;
        for (const em of this.emitters) {
          const d = Math.abs(em.x - drop.x);
          if (d < bestD) {
            bestD = d;
            best = em;
          }
        }
        if (best.phase === "fill") best.mass = Math.min(1, best.mass + drop.mass * 0.5);
        continue;
      }

      // Cull far below / outside
      if (drop.y < -halfH * 2.4 || Math.abs(drop.x) > halfW * 1.6) continue;

      blobs.push({
        x: drop.x,
        y: drop.y,
        r: Math.max(drop.r, maps.dropR * minDim * 0.5),
        w: 0.85,
      });
      next.push(drop);
    }
    this.frees = next;
  }

  /** Surface-tension proxy: coalesce overlapping free drops. */
  private mergeFrees(dt: number, mergeK: number, halfH: number): void {
    void dt;
    void halfH;
    const out: FreeDrop[] = [];
    const used = new Set<number>();
    for (let i = 0; i < this.frees.length; i++) {
      if (used.has(i)) continue;
      let a = this.frees[i];
      for (let j = i + 1; j < this.frees.length; j++) {
        if (used.has(j)) continue;
        const b = this.frees[j];
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const dist = Math.hypot(dx, dy);
        const thresh = (a.r + b.r) * (1.15 + mergeK * 2);
        if (dist < thresh) {
          const m = a.mass + b.mass;
          a = {
            x: (a.x * a.mass + b.x * b.mass) / m,
            y: (a.y * a.mass + b.y * b.mass) / m,
            vx: (a.vx * a.mass + b.vx * b.mass) / m,
            vy: (a.vy * a.mass + b.vy * b.mass) / m,
            r: Math.sqrt(a.r * a.r + b.r * b.r),
            mass: m,
          };
          used.add(j);
        }
      }
      out.push(a);
    }
    this.frees = out;
  }

  private trim(blobs: DripBlob[]): DripBlob[] {
    if (blobs.length <= MAX_DRIP_BLOBS) return blobs;
    // Prefer free/pendant (higher |y| downward) + heaviest
    return blobs
      .slice()
      .sort((a, b) => b.w * b.r - a.w * a.r)
      .slice(0, MAX_DRIP_BLOBS);
  }
}
