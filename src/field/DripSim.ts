/**
 * Viscosity-driven pendant-drop simulation (CPU).
 *
 * Practical continuum model (not full SPH):
 * - Mass accumulates at bottom emitters (Bond-ish critical mass → drip)
 * - Stretch phase forms a neck; viscosity lengthens the neck and slows pinch
 * - Detach when neck thins below threshold → free drops under gravity + drag
 * - Nearby free drops remerge (surface-tension proxy); softMin in the shader
 *   blends them with the pane/glyph field
 *
 * Controlled mode: explicit per-emitter anchors (per-glyph), deterministic necks,
 * no lateral chaos — clear pendant morphology for visual QA.
 */

export const MAX_DRIP_BLOBS = 24;

export type DripBlob = {
  /** Normalized field coords (same space as shader `p`). */
  x: number;
  y: number;
  r: number;
  w: number;
};

/** Per-emitter artist/agent knobs (glyph bottoms, icon lips, etc.). */
export type DripEmitterSpec = {
  /**
   * Emitter x. When `normalized` is true (default), range is -1…1 across halfW.
   * When false, value is already in field space.
   */
  x: number;
  normalized?: boolean;
  /** 0–1 intensity multiplier (scales drip for this emitter only). */
  intensity?: number;
  /** Optional viscosity override for this emitter. */
  viscosity?: number;
  /** 0–1 phase offset into the fill→stretch cycle. */
  phaseOffset?: number;
  /** Stretch length multiplier (long syrup stems). */
  stretchScale?: number;
  /** Disable lateral wobble for this emitter. */
  locked?: boolean;
  /** Soft on/off without removing the slot. */
  enabled?: boolean;
  /**
   * Start mid-stretch with a clear pendant neck (for visual QA frames).
   * stretchT in 0–1 when startInStretch is true.
   */
  startInStretch?: boolean;
  stretchT?: number;
};

export type DripControl = {
  /** auto = evenly spaced; controlled = only explicit emitters. */
  mode: "auto" | "controlled";
  emitters?: DripEmitterSpec[];
  /**
   * When true, skip liquify bottom-bulge blobs so drip necks read cleanly
   * (isolate drip sim from muddy full-scene melt).
   */
  isolate?: boolean;
  /** Global: no sin wobble on any emitter. */
  deterministic?: boolean;
  /** Auto-mode emitter count (1–8). Ignored in controlled mode. */
  emitterCount?: number;
  /**
   * Field-space Y where pendants attach (default: pane bottom ≈ -halfH*0.92).
   * Glyph QA sets this to the letterform stem lip.
   */
  attachY?: number;
  /** Hold emitters in current phase (no fill/stretch advance) — QA freeze-frame. */
  freeze?: boolean;
};

export type DripSimParams = {
  drip: number;
  liquify: number;
  viscosity: number;
  halfW: number;
  halfH: number;
  reducedMotion: boolean;
  control?: DripControl;
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
  intensity: number;
  viscosity: number | null;
  stretchScale: number;
  locked: boolean;
  enabled: boolean;
  /** Raw spec for re-layout. */
  spec: DripEmitterSpec | null;
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
    fillPeriod: mix(0.55, 2.6, v) / d,
    criticalMass: mix(0.35, 0.85, v),
    stretchLen: mix(0.32, 1.15, v),
    stretchDuration: mix(0.35, 1.85, v),
    neckThinRate: mix(2.8, 0.32, v),
    dropR: mix(0.055, 0.155, v),
    drag: mix(0.1, 0.78, v),
    gravity: mix(1.25, 0.42, v),
    mergeK: mix(0.04, 0.24, v),
    cooldown: mix(0.15, 0.7, v),
  };
}

export class DripSim {
  private emitters: Emitter[] = [];
  private frees: FreeDrop[] = [];
  private emitterCount: number;
  private control: DripControl = { mode: "auto", deterministic: false, isolate: false };

  constructor(emitterCount = 5) {
    this.emitterCount = Math.max(1, Math.min(8, emitterCount));
    this.resetEmitters(0.48);
  }

  /** Replace control (per-glyph emitters, isolate, deterministic). */
  setControl(control: DripControl | undefined): void {
    this.control = {
      mode: control?.mode ?? "auto",
      emitters: control?.emitters,
      isolate: control?.isolate ?? false,
      deterministic: control?.deterministic ?? false,
      emitterCount: control?.emitterCount,
      attachY: control?.attachY,
      freeze: control?.freeze ?? false,
    };
    if (typeof this.control.emitterCount === "number") {
      this.emitterCount = Math.max(1, Math.min(8, this.control.emitterCount));
    }
    this.rebuildFromControl(0.48);
  }

  getControl(): DripControl {
    return { ...this.control, emitters: this.control.emitters?.map((e) => ({ ...e })) };
  }

  private resolveX(spec: DripEmitterSpec, halfW: number): number {
    const norm = spec.normalized !== false;
    return norm ? spec.x * halfW : spec.x;
  }

  private rebuildFromControl(halfW: number): void {
    const specs =
      this.control.mode === "controlled" && this.control.emitters?.length
        ? this.control.emitters
        : null;

    if (specs) {
      this.emitters = specs.map((spec, i) => {
        const phaseOffset = clamp01(spec.phaseOffset ?? i * 0.17);
        const startStretch = spec.startInStretch === true;
        return {
          x: this.resolveX(spec, halfW),
          seed: phaseOffset,
          mass: startStretch ? 1 : phaseOffset * 0.35,
          phase: (startStretch ? "stretch" : "fill") as Phase,
          stretchT: startStretch ? clamp01(spec.stretchT ?? 0.55) : 0,
          cooldown: startStretch ? 0 : phaseOffset * 0.2,
          neckR: startStretch ? Math.max(0.2, 1 - clamp01(spec.stretchT ?? 0.55) * 0.7) : 1,
          intensity: clamp01(spec.intensity ?? 1),
          viscosity: spec.viscosity ?? null,
          stretchScale: Math.max(0.2, spec.stretchScale ?? 1),
          locked: spec.locked ?? this.control.deterministic ?? false,
          enabled: spec.enabled !== false,
          spec,
        };
      });
      return;
    }

    this.resetEmitters(halfW);
  }

  private resetEmitters(halfW: number): void {
    this.emitters = [];
    for (let i = 0; i < this.emitterCount; i++) {
      const nx = (i - (this.emitterCount - 1) / 2) / Math.max(this.emitterCount / 2, 1);
      this.emitters.push({
        x: nx * halfW * 0.72,
        seed: ((i * 17 + 3) % 10) / 10,
        mass: (i * 0.13) % 0.4,
        phase: "fill",
        stretchT: 0,
        cooldown: i * 0.15,
        neckR: 1,
        intensity: 1,
        viscosity: null,
        stretchScale: 1,
        locked: this.control.deterministic ?? false,
        enabled: true,
        spec: null,
      });
    }
  }

  reset(): void {
    this.frees = [];
    this.rebuildFromControl(0.48);
  }

  /**
   * Advance simulation; returns metaball blobs for the shade pass.
   * Coords match shader field space: origin center, +y up, pane bottom ≈ -halfH.
   */
  step(dt: number, p: DripSimParams): DripBlob[] {
    const blobs: DripBlob[] = [];
    const { drip, liquify, viscosity, halfW, halfH, reducedMotion } = p;
    if (p.control) this.setControl(p.control);

    if (reducedMotion || (drip < 0.001 && liquify < 0.001)) {
      return blobs;
    }

    // Keep emitter x layout in sync with aspect / specs
    if (this.control.mode === "controlled" && this.control.emitters?.length) {
      for (let i = 0; i < this.emitters.length; i++) {
        const spec = this.emitters[i].spec ?? this.control.emitters[i];
        if (spec) this.emitters[i].x = this.resolveX(spec, halfW);
      }
    } else {
      for (let i = 0; i < this.emitters.length; i++) {
        const nx = (i - (this.emitterCount - 1) / 2) / Math.max(this.emitterCount / 2, 1);
        this.emitters[i].x = nx * halfW * 0.72;
      }
    }

    const isolate = this.control.isolate === true;
    const globalDeterministic = this.control.deterministic === true;
    const minDim = Math.min(halfW, halfH);
    const bottomY =
      typeof this.control.attachY === "number" ? this.control.attachY : -halfH * 0.92;
    const sag = liquify * halfH * 0.18;

    // --- Liquify body: soft accumulation bulges (skipped when isolating drips) ---
    if (liquify > 0.001 && !isolate) {
      for (const em of this.emitters) {
        if (!em.enabled) continue;
        const bulge = 0.55 + 0.45 * em.mass;
        blobs.push({
          x: em.x + (em.locked || globalDeterministic ? 0 : Math.sin(em.seed * 12.0) * 0.01),
          y: bottomY + sag * 0.35,
          r: mix(0.07, 0.16, liquify) * minDim * bulge,
          w: liquify * (0.55 + 0.45 * em.mass) * em.intensity,
        });
      }
    }

    if (drip < 0.001) {
      const maps = viscosityMaps(viscosity, Math.max(drip, 0.02));
      this.mergeFrees(dt, maps.mergeK, halfH);
      this.integrateFrees(dt, maps, halfH, halfW, blobs, minDim, bottomY);
      return this.trim(blobs);
    }

    // --- Emitters: fill → stretch → pinch → detach ---
    for (const em of this.emitters) {
      if (!em.enabled || em.intensity < 0.001) continue;

      const emVisc = em.viscosity != null ? clamp01(em.viscosity) : viscosity;
      const emDrip = drip * em.intensity;
      const maps = viscosityMaps(emVisc, emDrip);
      const locked = em.locked || globalDeterministic;
      const wobble = locked ? 0 : Math.sin(em.seed * 40 + em.mass * 8) * 0.012 * halfW;
      const freeze = this.control.freeze === true;

      if (em.phase === "cooldown" && !freeze) {
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
        if (!freeze) em.mass += dt / maps.fillPeriod;
        const grow = clamp01(em.mass / maps.criticalMass);
        const pendR = maps.dropR * minDim * (0.45 + 0.55 * grow) * (0.5 + 0.5 * emDrip);
        const pendY = bottomY - grow * halfH * 0.12 * (0.4 + emDrip);
        blobs.push({
          x: em.x + wobble,
          y: pendY,
          r: pendR,
          w: emDrip * (0.35 + 0.65 * grow),
        });
        blobs.push({
          x: em.x + wobble * 0.35,
          y: mix(bottomY, pendY, 0.42),
          r: pendR * mix(0.42, 0.72, emVisc),
          w: emDrip * grow * 0.75,
        });

        if (!freeze && em.mass >= maps.criticalMass) {
          em.phase = "stretch";
          em.stretchT = 0;
          em.neckR = 1;
        }
        continue;
      }

      // stretch — long viscous filament then pinch
      if (em.stretchScale < 0.05) {
        // Detached pendant drop (QA freeze — second emitter)
        const hang = clamp01(em.stretchT);
        const dropY = bottomY - halfH * (0.2 + hang * 0.26);
        const dropR = maps.dropR * minDim * (0.65 + 0.25 * (1 - hang));
        blobs.push({
          x: em.x + wobble * 0.15,
          y: dropY,
          r: dropR * 1.08,
          w: emDrip * 1.0,
        });
        continue;
      }

      if (!freeze) em.stretchT += dt / maps.stretchDuration;
      const t = clamp01(em.stretchT);
      // Freeze mid-stretch: elegant continuous filament (not fragmented / not lumpy)
      const freezeNeckFloor = freeze ? 0.28 : 0.04;
      em.neckR = Math.max(
        freezeNeckFloor,
        1 - t * maps.neckThinRate * (0.35 + 0.65 * t) * (freeze ? 0.62 : 1),
      );
      const stretch = t * maps.stretchLen * halfH * em.stretchScale;
      const tipY = bottomY - stretch;
      const tipR = maps.dropR * minDim * (0.78 + 0.38 * emDrip) * (1.05 - 0.12 * t);
      const neckY = mix(bottomY, tipY, 0.4);
      const neckR =
        tipR * mix(0.12, 0.3, emVisc) * Math.max(em.neckR, freezeNeckFloor);

      // Lip anchor — blends into glyph stem (root sits inside letterform)
      blobs.push({
        x: em.x + wobble * 0.2,
        y: bottomY + minDim * 0.06,
        r: tipR * mix(1.1, 1.28, emVisc),
        w: emDrip * 1.2,
      });
      blobs.push({
        x: em.x + wobble * 0.12,
        y: bottomY - stretch * 0.04,
        r: tipR * mix(0.62, 0.82, emVisc),
        w: emDrip * 1.0,
      });
      blobs.push({
        x: em.x + wobble * 0.08,
        y: neckY,
        r: neckR * 0.62,
        w: emDrip * Math.max(0.45, em.neckR),
      });

      // Viscous filament — thick lip → elegant mid-filament → round bulb (ENj9B)
      {
        const segments = freeze ? 18 : 5;
        for (let si = 1; si < segments; si++) {
          const ft = si / segments;
          let profile: number;
          if (ft < 0.38) {
            profile = mix(0.5, 0.085, ft / 0.38);
          } else if (ft < 0.76) {
            // Mid-filament — tubular elegance (readable thread, not hair wire)
            profile = mix(0.085, 0.072, (ft - 0.38) / 0.38);
          } else {
            profile = mix(0.072, 1.28, Math.pow((ft - 0.76) / 0.24, 1.2));
          }
          const sy = mix(bottomY, tipY, ft);
          const sr = tipR * profile * Math.max(em.neckR, freezeNeckFloor);
          blobs.push({
            x: em.x + wobble * 0.012,
            y: sy,
            r: Math.max(sr, tipR * (freeze ? 0.055 : 0.04)),
            w: emDrip * mix(1.12, 0.52, ft) * Math.max(0.42, em.neckR),
          });
        }
      }

      blobs.push({
        x: em.x,
        y: mix(bottomY, tipY, 0.55),
        r: tipR * mix(0.055, 0.1, emVisc) * Math.max(em.neckR, freezeNeckFloor),
        w: emDrip * 0.48 * Math.max(0.32, em.neckR),
      });
      // Tip bulb — rounder elegant pendant
      blobs.push({
        x: em.x + wobble,
        y: tipY,
        r: tipR * (freeze ? 1.18 : 1.0),
        w: emDrip * 1.28,
      });
      // Soft shoulder under bulb for spherical read
      if (freeze) {
        blobs.push({
          x: em.x,
          y: tipY + tipR * 0.35,
          r: tipR * 0.72,
          w: emDrip * 0.85,
        });
      }

      if (!freeze && (em.neckR < 0.12 || t >= 1)) {
        this.frees.push({
          x: em.x + wobble,
          y: tipY,
          vx: locked ? 0 : (em.seed - 0.5) * 0.08 * halfW,
          vy: -maps.gravity * 0.15,
          r: tipR,
          mass: tipR,
        });
        em.phase = "cooldown";
        em.cooldown = maps.cooldown * (0.85 + em.seed * 0.3);
        em.mass = 0;
        em.stretchT = 0;
        em.neckR = 1;
      }
    }

    const mapsMerge = viscosityMaps(viscosity, drip);
    // Freeze QA: never draw free-falling detached blobs
    if (!this.control.freeze) {
      this.mergeFrees(dt, mapsMerge.mergeK, halfH);
      this.integrateFrees(dt, mapsMerge, halfH, halfW, blobs, minDim, bottomY);
    } else {
      this.frees = [];
    }
    return this.trim(blobs);
  }

  private integrateFrees(
    dt: number,
    maps: ReturnType<typeof viscosityMaps>,
    halfH: number,
    halfW: number,
    blobs: DripBlob[],
    minDim: number,
    attachY: number,
  ): void {
    const bottomY = attachY;
    const next: FreeDrop[] = [];
    for (const drop of this.frees) {
      drop.vy -= maps.gravity * dt;
      drop.vx *= 1 - maps.drag * dt;
      drop.vy *= 1 - maps.drag * 0.35 * dt;
      drop.x += drop.vx * dt;
      drop.y += drop.vy * dt;

      const nearLip =
        drop.y > bottomY - halfH * 0.05 &&
        drop.y < bottomY + halfH * 0.12 &&
        Math.abs(drop.vy) < 0.25;
      if (nearLip && drop.vy >= -0.05) {
        let best = this.emitters[0];
        let bestD = Infinity;
        for (const em of this.emitters) {
          if (!em.enabled) continue;
          const d = Math.abs(em.x - drop.x);
          if (d < bestD) {
            bestD = d;
            best = em;
          }
        }
        if (best?.phase === "fill") best.mass = Math.min(1, best.mass + drop.mass * 0.5);
        continue;
      }

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
    return blobs
      .slice()
      .sort((a, b) => b.w * b.r - a.w * a.r)
      .slice(0, MAX_DRIP_BLOBS);
  }
}
