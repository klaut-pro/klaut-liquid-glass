/**
 * Frozen viscoplastic gravity sag (CPU vertex field).
 *
 * Concept art (klaut.pro/concept_art): molten chrome/glass letterforms that
 * sagged into pendant shapes and solidified — continuous letter body → neck →
 * bulb. Upper glyph stays identity; only below a tunable freeze height yields.
 *
 * Per-letter: each bound mesh slot can enable/disable melt and override
 * gravity / freeze / viscosity / sag / neck / bulb independently.
 *
 * Roundness: cosine teardrop radial profile + softMin bulb SDF tip overlay +
 * Taubin smooth on yielded verts (no attached drip sphere meshes).
 */

import { softMin } from "./SDF.js";

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

function mix(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / Math.max(edge1 - edge0, 1e-8));
  return t * t * (3 - 2 * t);
}

function bulbEaseSafe(t: number): number {
  const u = clamp01(t);
  return u * u * (3 - 2 * u);
}

export type MeltViscosityMaps = {
  /** Effective gravity on yielded verts. Low Oh → stronger pull. */
  gravity: number;
  /** Viscous drag γ. High Oh → stronger damping / slower flow. */
  damping: number;
  /** Restoring spring toward rest. High Oh → softer (lets thick hang). */
  spring: number;
  /** Max downward sag as fraction of glyph height. High Oh → longer hang. */
  sagAmp: number;
  /** Neck pinch strength (radial shrink mid-filament). High Oh → milder. */
  neckPinch: number;
  /** Tip bulb radial expand. High Oh → fatter pendant. */
  bulbGrow: number;
  /** How sharply preferential columns form. Low Oh → sharper drips. */
  columnSharp: number;
  /** Settle rate toward freeze. High Oh → slower. */
  settleRate: number;
  /** Kinetic-energy RMS threshold (× halfH) below which we freeze. */
  freezeKe: number;
};

/**
 * Ohnesorge-ish maps for mesh gravity drainage + freeze.
 * `intensity` (0–1) scales liquify / gravity amount.
 */
export function meltViscosityMaps(viscosity: number, intensity = 1): MeltViscosityMaps {
  const v = clamp01(viscosity);
  const d = Math.max(intensity, 0.02);
  return {
    gravity: mix(2.8, 0.7, v) * d,
    damping: mix(2.2, 9.5, v),
    spring: mix(11, 1.8, v),
    sagAmp: mix(0.35, 0.85, v) * d,
    neckPinch: mix(0.55, 0.18, v),
    bulbGrow: mix(0.38, 0.95, v),
    columnSharp: mix(2.4, 1.05, v),
    settleRate: mix(1.6, 0.4, v) * d,
    freezeKe: mix(0.014, 0.0035, v),
  };
}

/** Alias for demos that share vocabulary with DripSim.viscosityMaps. */
export { meltViscosityMaps as viscosityMapsForMelt };

export type GravityMeltParams = {
  /** 0–1 gravity / melt intensity (artist "gravity amount"). */
  intensity: number;
  /** 0–1 Oh-proxy viscosity (how thick the frozen sag reads). */
  viscosity: number;
  /**
   * Fraction of glyph height measured from the **top** that stays completely
   * frozen (identity). 0 = whole glyph yields; 0.55 ≈ top 55% rigid (concept).
   * Default 0.52.
   */
  freezeHeight?: number;
  /**
   * Falloff power below the freeze line. Higher → sharper transition into sag.
   * Default 1.65.
   */
  falloffPower?: number;
  /** Preferential drip-column X in **local** mesh space (optional). */
  columnXs?: number[];
  /** Half-width of column influence in local X. */
  columnHalfW?: number;
  /**
   * When true, skip Verlet and lerp toward the analytic target pose, then freeze.
   * Matches “one-shot settle → solidify” concept art.
   */
  oneShot?: boolean;
  /** Extra sag amplitude multiplier (1 = maps default). */
  sagAmpMul?: number;
  /** Extra neck pinch multiplier. */
  neckPinchMul?: number;
  /** Extra bulb grow multiplier. */
  bulbGrowMul?: number;
  /** SoftMin bulb overlay strength 0–1 (mesh verts only; no sphere blobs). */
  bulbSoftMin?: number;
  /** Taubin / Laplacian smooth passes after sag (0–8). Default 3. */
  smoothPasses?: number;
};

/** Per-letter (per mesh slot) override. Missing fields inherit master. */
export type LetterMeltOverride = {
  /** When false, letter stays identity (no melt). Default true. */
  enable?: boolean;
  intensity?: number;
  viscosity?: number;
  freezeHeight?: number;
  falloffPower?: number;
  sagAmpMul?: number;
  neckPinchMul?: number;
  bulbGrowMul?: number;
  bulbSoftMin?: number;
  smoothPasses?: number;
  columnXs?: number[];
  columnHalfW?: number;
};

export type GravityMeltStatus = {
  frozen: boolean;
  /** 0–1 how close to freeze (1 = frozen / settled). */
  settle: number;
  /** RMS velocity (mesh units / s). */
  keRms: number;
  freezeHeight: number;
  maps: MeltViscosityMaps;
  slotCount: number;
};

type MeshSlot = {
  pos: Float32Array;
  base: Float32Array;
  normal: Float32Array;
  vel: Float32Array;
  /** Normalized height 0 at bottom … 1 at top (rest pose). */
  hNorm: Float32Array;
  /** Downward-face weight from rest normals. */
  downFace: Float32Array;
  lo: number;
  hi: number;
  halfW: number;
  /** Local X centroid for radial pinch. */
  cx: number;
  cz: number;
  /** Adjacency for Taubin smooth (built once from proximity). */
  neighbors: Int32Array[];
};

function resolveParams(
  master: GravityMeltParams,
  ov: LetterMeltOverride | undefined,
): GravityMeltParams & { enable: boolean } {
  const enable = ov?.enable !== false;
  return {
    enable,
    intensity: ov?.intensity ?? master.intensity,
    viscosity: ov?.viscosity ?? master.viscosity,
    freezeHeight: ov?.freezeHeight ?? master.freezeHeight,
    falloffPower: ov?.falloffPower ?? master.falloffPower,
    columnXs: ov?.columnXs ?? master.columnXs,
    columnHalfW: ov?.columnHalfW ?? master.columnHalfW,
    oneShot: master.oneShot,
    sagAmpMul: ov?.sagAmpMul ?? master.sagAmpMul ?? 1,
    neckPinchMul: ov?.neckPinchMul ?? master.neckPinchMul ?? 1,
    bulbGrowMul: ov?.bulbGrowMul ?? master.bulbGrowMul ?? 1,
    bulbSoftMin: ov?.bulbSoftMin ?? master.bulbSoftMin ?? 0.65,
    smoothPasses: ov?.smoothPasses ?? master.smoothPasses ?? 5,
  };
}

/**
 * Soft-body gravity drainage over letter meshes — then freeze.
 */
export class GravityMeltSim {
  private slots: MeshSlot[] = [];
  private frozen = false;
  private settle = 0;
  private keRms = 0;
  private lastMaps: MeltViscosityMaps = meltViscosityMaps(0.45, 1);
  private lastFreezeHeight = 0.52;
  private t = 0;
  /** One-shot blend 0→1 toward analytic target. */
  private oneShotT = 0;
  private letterOverrides: LetterMeltOverride[] = [];

  /** Bind mesh attribute buffers (pos is live; base/normal are rest snapshots). */
  bind(
    meshes: Array<{
      pos: Float32Array;
      base: Float32Array;
      normal: Float32Array;
    }>,
  ): void {
    this.slots = meshes.map(({ pos, base, normal }) => {
      let lo = Infinity;
      let hi = -Infinity;
      let minX = Infinity;
      let maxX = -Infinity;
      let minZ = Infinity;
      let maxZ = -Infinity;
      for (let i = 0; i < base.length; i += 3) {
        lo = Math.min(lo, base[i + 1]);
        hi = Math.max(hi, base[i + 1]);
        minX = Math.min(minX, base[i]);
        maxX = Math.max(maxX, base[i]);
        minZ = Math.min(minZ, base[i + 2]);
        maxZ = Math.max(maxZ, base[i + 2]);
      }
      const span = Math.max(hi - lo, 1e-4);
      const n = (base.length / 3) | 0;
      const hNorm = new Float32Array(n);
      const downFace = new Float32Array(n);
      for (let vi = 0; vi < n; vi++) {
        const i = vi * 3;
        hNorm[vi] = clamp01((base[i + 1] - lo) / span);
        downFace[vi] = Math.max(0, -normal[i + 1]);
      }
      const halfW = Math.max((maxX - minX) * 0.5, 0.2);
      const neighbors = buildProximityGraph(base, halfW * 0.22);
      return {
        pos,
        base,
        normal,
        vel: new Float32Array(base.length),
        hNorm,
        downFace,
        lo,
        hi,
        halfW,
        cx: (minX + maxX) * 0.5,
        cz: (minZ + maxZ) * 0.5,
        neighbors,
      };
    });
    this.letterOverrides = this.slots.map(() => ({}));
    this.reset();
  }

  slotCount(): number {
    return this.slots.length;
  }

  /** Replace or patch per-letter overrides (by slot index). */
  setLetterOverrides(overrides: LetterMeltOverride[]): void {
    this.letterOverrides = this.slots.map((_, i) => ({ ...(overrides[i] ?? {}) }));
  }

  getLetterOverrides(): LetterMeltOverride[] {
    return this.letterOverrides.map((o) => ({ ...o }));
  }

  patchLetter(index: number, patch: LetterMeltOverride): void {
    if (index < 0 || index >= this.slots.length) return;
    this.letterOverrides[index] = { ...this.letterOverrides[index], ...patch };
  }

  reset(): void {
    this.frozen = false;
    this.settle = 0;
    this.keRms = 0;
    this.t = 0;
    this.oneShotT = 0;
    for (const s of this.slots) {
      s.pos.set(s.base);
      s.vel.fill(0);
    }
  }

  /** Lock current deformed pose (no further integration). */
  freeze(): void {
    this.frozen = true;
    this.settle = 1;
    this.oneShotT = 1;
    for (const s of this.slots) s.vel.fill(0);
  }

  /** Resume melting from the current pose (keeps deformation). */
  unfreeze(): void {
    this.frozen = false;
    this.settle = Math.min(this.settle, 0.85);
    this.oneShotT = Math.min(this.oneShotT, 0.85);
  }

  isFrozen(): boolean {
    return this.frozen;
  }

  getStatus(): GravityMeltStatus {
    return {
      frozen: this.frozen,
      settle: this.settle,
      keRms: this.keRms,
      freezeHeight: this.lastFreezeHeight,
      maps: this.lastMaps,
      slotCount: this.slots.length,
    };
  }

  /**
   * Yield weight from height mask.
   * Top (≥ freezeHeight in hNorm) → 0 (completely frozen).
   * Bottom → 1. Tunable falloff below the freeze line.
   */
  static yieldWeight(
    hNorm: number,
    freezeHeight: number,
    falloffPower: number,
    downFace: number,
  ): number {
    const fh = clamp01(freezeHeight);
    if (hNorm >= fh - 1e-6) return 0;
    const raw = (fh - hNorm) / Math.max(fh, 1e-4);
    const w = Math.pow(clamp01(raw), Math.max(0.35, falloffPower));
    // Mild boost for downward-facing lips (pendant seeds)
    return clamp01(w * (0.72 + 0.28 * downFace));
  }

  /**
   * Cosine teardrop radial scale along drain profile.
   * Mid = continuous neck; tip = round bulb (not faceted linear ramp).
   */
  static teardropRadial(
    profileT: number,
    neckPinch: number,
    bulbGrow: number,
  ): number {
    const t = clamp01(profileT);
    // Smooth neck: raised-cosine lobe peaking mid-filament
    const neckU = smoothstep(0.06, 0.62, t);
    const neckBand = Math.sin(Math.PI * neckU);
    // Round bulb: strong tip swell (pear / pendant silhouette)
    const bulbU = smoothstep(0.38, 1.0, t);
    const bulbEase = bulbU * bulbU * (3 - 2 * bulbU);
    // Half-sine gives circular cross-section swell at tip
    const bulbRound = Math.sin((Math.PI * 0.5) * bulbEase);
    const pinch = neckPinch * neckBand * 0.85;
    const bulb = bulbGrow * bulbRound * 1.35;
    return Math.max(0.12, 1 - pinch + bulb);
  }

  /**
   * Analytic target displacement for a rest-pose vertex (concept pendant profile).
   * Returns [dx, dy, dz] added to base.
   */
  private targetDelta(
    s: MeshSlot,
    vi: number,
    maps: MeltViscosityMaps,
    freezeHeight: number,
    falloffPower: number,
    columns: number[],
    colW: number,
    halfH: number,
    sagMul: number,
    neckMul: number,
    bulbMul: number,
    bulbSoft: number,
  ): [number, number, number] {
    const i = vi * 3;
    const bx = s.base[i];
    const by = s.base[i + 1];
    const bz = s.base[i + 2];
    const w = GravityMeltSim.yieldWeight(
      s.hNorm[vi],
      freezeHeight,
      falloffPower,
      s.downFace[vi],
    );
    if (w < 0.001) return [0, 0, 0];

    let column = 0;
    if (columns.length) {
      let near = 1;
      for (const cx of columns) {
        near = Math.min(near, Math.abs(bx - cx) / colW);
      }
      column = Math.pow(Math.max(0, 1 - near), maps.columnSharp);
    } else {
      // No explicit columns: soft column from yield + local bottom
      column = Math.pow(w, 1.15);
    }

    const drain = w * (0.35 + 0.65 * Math.max(column, w * 0.5));
    // Soften tip spike: sag eases off at extreme tip so bulb can round
    const tipSoft = 1 - 0.28 * Math.pow(smoothstep(0.7, 1, drain), 1.5);
    const sag =
      maps.sagAmp *
      sagMul *
      halfH *
      2 *
      drain *
      tipSoft *
      (0.5 + 0.95 * Math.max(column, drain * 0.35));

    const profileT = clamp01(drain);
    const radialScale = GravityMeltSim.teardropRadial(
      profileT,
      maps.neckPinch * neckMul,
      maps.bulbGrow * bulbMul,
    );

    // Radial axis: prefer column X, else mesh centroid
    let ax = s.cx;
    if (columns.length) {
      let best = columns[0]!;
      let bestD = Infinity;
      for (const cx of columns) {
        const d = Math.abs(bx - cx);
        if (d < bestD) {
          bestD = d;
          best = cx;
        }
      }
      ax = best;
    }
    const rx = bx - ax;
    const rz = bz - s.cz;
    let dx = rx * (radialScale - 1);
    let dy = -sag;
    let dz = rz * (radialScale - 1) * 0.88;

    // Implicit softMin bulb SDF overlay — round tip without attached spheres
    const tipGate = Math.max(column, profileT * 0.85);
    if (bulbSoft > 0.01 && profileT > 0.28) {
      const tipY = s.lo - sag * 0.78;
      const bulbR =
        s.halfW *
        (0.32 + 0.55 * maps.bulbGrow * bulbMul) *
        (0.5 + 0.5 * tipGate);
      const tipCx = ax;
      const tipCz = s.cz;
      // Distance to ideal teardrop center (slightly above tip)
      const cy = tipY + bulbR * 0.55;
      const px0 = bx + dx;
      const py0 = by + dy;
      const pz0 = bz + dz;
      const dSphere = Math.hypot(px0 - tipCx, py0 - cy, pz0 - tipCz) - bulbR;
      // Letter body as a vertical capsule stub (negative inside thickened stem)
      const stemR = s.halfW * mix(0.5, 0.22, profileT) * mix(1, 0.7, tipGate);
      const dStem = Math.hypot(px0 - tipCx, pz0 - tipCz) - stemR;
      const k = mix(0.1, 0.28, maps.bulbGrow) * halfH;
      const dField = softMin(dStem, dSphere, k);
      // Pull surface toward zero isosurface (outward if inside bulb union)
      const pull =
        clamp01(bulbSoft) *
        smoothstep(0.28, 0.95, profileT) *
        (0.35 + 0.65 * tipGate);
      if (pull > 0.01 && Math.abs(dField) < bulbR * 3.2) {
        const eps = 1e-3;
        const ddx =
          softMin(
            Math.hypot(px0 + eps - tipCx, pz0 - tipCz) - stemR,
            Math.hypot(px0 + eps - tipCx, py0 - cy, pz0 - tipCz) - bulbR,
            k,
          ) - dField;
        const ddy =
          softMin(
            Math.hypot(px0 - tipCx, pz0 - tipCz) - stemR,
            Math.hypot(px0 - tipCx, py0 + eps - cy, pz0 - tipCz) - bulbR,
            k,
          ) - dField;
        const ddz =
          softMin(
            Math.hypot(px0 - tipCx, pz0 + eps - tipCz) - stemR,
            Math.hypot(px0 - tipCx, py0 - cy, pz0 + eps - tipCz) - bulbR,
            k,
          ) - dField;
        const invLen = 1 / Math.max(Math.hypot(ddx, ddy, ddz), 1e-6);
        // Stronger projection onto softMin zero-set for round bulbs
        const corr = -dField * pull * 0.85;
        dx += ddx * invLen * corr;
        dy += ddy * invLen * corr;
        dz += ddz * invLen * corr;

        // Extra tip plump: blend deformed tip toward sphere surface
        const plump = pull * bulbEaseSafe(profileT) * 0.55;
        if (plump > 0.02) {
          const toCx = tipCx - (bx + dx);
          const toCy = cy - (by + dy);
          const toCz = tipCz - (bz + dz);
          const dist = Math.hypot(toCx, toCy, toCz);
          if (dist > 1e-5) {
            const targetR = bulbR * 0.92;
            const push = (dist - targetR) * plump;
            dx += (toCx / dist) * push;
            dy += (toCy / dist) * push;
            dz += (toCz / dist) * push;
          }
        }
      }
    }

    return [dx, dy, dz];
  }

  /**
   * Integrate one frame. Returns true if any mesh positions changed.
   * When frozen, leaves buffers untouched (static solidified pose).
   */
  step(dt: number, p: GravityMeltParams): boolean {
    const h = Math.min(Math.max(dt, 0), 0.05);
    if (!this.slots.length) return false;

    // If master intensity is ~0 and no letter has its own intensity, reset
    const anyLetterOn = this.letterOverrides.some(
      (o) => o.enable !== false && (o.intensity ?? p.intensity) >= 0.001,
    );
    if (p.intensity < 0.001 && !anyLetterOn) {
      if (!this.frozen) this.reset();
      return false;
    }

    const maps = meltViscosityMaps(p.viscosity, Math.max(p.intensity, 0.15));
    this.lastMaps = maps;
    const freezeHeight = clamp01(
      typeof p.freezeHeight === "number" ? p.freezeHeight : 0.52,
    );
    this.lastFreezeHeight = freezeHeight;

    if (this.frozen) return false;

    const oneShot = p.oneShot !== false; // default: one-shot settle (concept art)

    if (oneShot) {
      return this.stepOneShot(h, p);
    }
    return this.stepPhysics(h, p);
  }

  /** Analytic target lerp → freeze (preferred for brand look). */
  private stepOneShot(h: number, master: GravityMeltParams): boolean {
    this.t += h;
    // Ease toward full sag; use master viscosity for settle pace
    const paceMaps = meltViscosityMaps(master.viscosity, Math.max(master.intensity, 0.2));
    this.oneShotT = Math.min(1, this.oneShotT + paceMaps.settleRate * h * 0.85);
    const ease = this.oneShotT * this.oneShotT * (3 - 2 * this.oneShotT);
    this.settle = ease;

    for (let si = 0; si < this.slots.length; si++) {
      const s = this.slots[si]!;
      const p = resolveParams(master, this.letterOverrides[si]);
      if (!p.enable || p.intensity < 0.001) {
        s.pos.set(s.base);
        s.vel.fill(0);
        continue;
      }

      const maps = meltViscosityMaps(p.viscosity, p.intensity);
      if (si === 0) this.lastMaps = maps;
      const freezeHeight = clamp01(
        typeof p.freezeHeight === "number" ? p.freezeHeight : 0.52,
      );
      const falloffPower =
        typeof p.falloffPower === "number" ? Math.max(0.35, p.falloffPower) : 1.65;
      this.lastFreezeHeight = freezeHeight;

      const halfH = Math.max((s.hi - s.lo) * 0.5, 1e-3);
      const columns = p.columnXs ?? [];
      const colW = Math.max(p.columnHalfW ?? s.halfW * 0.28, 0.03);
      const n = (s.base.length / 3) | 0;
      const sagMul = p.sagAmpMul ?? 1;
      const neckMul = p.neckPinchMul ?? 1;
      const bulbMul = p.bulbGrowMul ?? 1;
      const bulbSoft = p.bulbSoftMin ?? 0.65;

      for (let vi = 0; vi < n; vi++) {
        const i = vi * 3;
        const [dx, dy, dz] = this.targetDelta(
          s,
          vi,
          maps,
          freezeHeight,
          falloffPower,
          columns,
          colW,
          halfH,
          sagMul,
          neckMul,
          bulbMul,
          bulbSoft,
        );
        s.pos[i] = s.base[i] + dx * ease;
        s.pos[i + 1] = s.base[i + 1] + dy * ease;
        s.pos[i + 2] = s.base[i + 2] + dz * ease;
        s.vel[i] = 0;
        s.vel[i + 1] = 0;
        s.vel[i + 2] = 0;
      }

      const passes = Math.max(0, Math.min(8, Math.round(p.smoothPasses ?? 3)));
      if (passes > 0 && ease > 0.15) {
        taubinSmoothSlot(s, freezeHeight, falloffPower, passes, ease);
      }
    }

    this.keRms = 0;
    if (this.oneShotT >= 0.995) this.freeze();
    return true;
  }

  /** Soft-body Verlet until KE dies, then freeze. */
  private stepPhysics(h: number, master: GravityMeltParams): boolean {
    this.t += h;
    let keSum = 0;
    let keN = 0;

    for (let si = 0; si < this.slots.length; si++) {
      const s = this.slots[si]!;
      const p = resolveParams(master, this.letterOverrides[si]);
      if (!p.enable || p.intensity < 0.001) {
        s.pos.set(s.base);
        s.vel.fill(0);
        continue;
      }

      const maps = meltViscosityMaps(p.viscosity, p.intensity);
      if (si === 0) this.lastMaps = maps;
      const freezeHeight = clamp01(
        typeof p.freezeHeight === "number" ? p.freezeHeight : 0.52,
      );
      const falloffPower =
        typeof p.falloffPower === "number" ? Math.max(0.35, p.falloffPower) : 1.65;
      this.lastFreezeHeight = freezeHeight;

      const halfH = Math.max((s.hi - s.lo) * 0.5, 1e-3);
      const maxSag = maps.sagAmp * (p.sagAmpMul ?? 1) * halfH * 2;
      const columns = p.columnXs ?? [];
      const colW = Math.max(p.columnHalfW ?? s.halfW * 0.28, 0.03);
      const n = (s.base.length / 3) | 0;
      const sagMul = p.sagAmpMul ?? 1;
      const neckMul = p.neckPinchMul ?? 1;
      const bulbMul = p.bulbGrowMul ?? 1;
      const bulbSoft = p.bulbSoftMin ?? 0.65;

      for (let vi = 0; vi < n; vi++) {
        const i = vi * 3;
        const bx = s.base[i];
        const by = s.base[i + 1];
        const bz = s.base[i + 2];
        const w = GravityMeltSim.yieldWeight(
          s.hNorm[vi],
          freezeHeight,
          falloffPower,
          s.downFace[vi],
        );

        if (w < 0.002) {
          s.pos[i] = bx;
          s.pos[i + 1] = by;
          s.pos[i + 2] = bz;
          s.vel[i] = 0;
          s.vel[i + 1] = 0;
          s.vel[i + 2] = 0;
          continue;
        }

        const [tdx, tdy, tdz] = this.targetDelta(
          s,
          vi,
          maps,
          freezeHeight,
          falloffPower,
          columns,
          colW,
          halfH,
          sagMul,
          neckMul,
          bulbMul,
          bulbSoft,
        );
        const tx = bx + tdx;
        const ty = by + tdy;
        const tz = bz + tdz;

        let vx = s.vel[i];
        let vy = s.vel[i + 1];
        let vz = s.vel[i + 2];
        const px = s.pos[i];
        const py = s.pos[i + 1];
        const pz = s.pos[i + 2];

        const k = maps.spring * (0.35 + 0.65 * (1 - w));
        const fx = -k * (px - tx);
        const fy = -k * (py - ty) - maps.gravity * w * halfH * 0.25;
        const fz = -k * (pz - tz);

        const damp = Math.exp(-maps.damping * h);
        vx = (vx + fx * h) * damp;
        vy = (vy + fy * h) * damp;
        vz = (vz + fz * h) * damp;

        let nxPos = px + vx * h;
        let nyPos = py + vy * h;
        let nzPos = pz + vz * h;

        const sag = by - nyPos;
        const cap = maxSag * (0.55 + 0.9 * w);
        if (sag > cap) {
          nyPos = by - cap;
          vy *= 0.25;
        }
        if (nyPos > by + halfH * 0.03) {
          nyPos = by + halfH * 0.03;
          vy *= 0.2;
        }

        s.pos[i] = nxPos;
        s.pos[i + 1] = nyPos;
        s.pos[i + 2] = nzPos;
        s.vel[i] = vx;
        s.vel[i + 1] = vy;
        s.vel[i + 2] = vz;

        keSum += vx * vx + vy * vy + vz * vz;
        keN++;
      }

      const passes = Math.max(0, Math.min(8, Math.round(p.smoothPasses ?? 2)));
      if (passes > 0) {
        taubinSmoothSlot(s, freezeHeight, falloffPower, passes, 1);
      }
    }

    this.keRms = keN > 0 ? Math.sqrt(keSum / keN) : 0;
    const halfHRef = Math.max(
      ...this.slots.map((s) => (s.hi - s.lo) * 0.5),
      0.5,
    );
    const maps = meltViscosityMaps(master.viscosity, master.intensity);
    this.lastMaps = maps;
    const keNorm = this.keRms / halfHRef;
    if (keNorm < maps.freezeKe) {
      this.settle = Math.min(1, this.settle + maps.settleRate * h * 1.8);
    } else {
      this.settle = Math.max(0, this.settle - maps.settleRate * h * 0.35);
    }
    if (this.settle >= 0.98 && keNorm < maps.freezeKe * 1.4) {
      this.freeze();
    }
    return true;
  }
}

/** Build crude k-nearest graph in rest pose for Laplacian / Taubin. */
function buildProximityGraph(base: Float32Array, radius: number): Int32Array[] {
  const n = (base.length / 3) | 0;
  const r2 = radius * radius;
  const neighbors: Int32Array[] = new Array(n);
  const maxDeg = 12;
  const cell = Math.max(radius, 1e-4);
  const inv = 1 / cell;
  const buckets = new Map<string, number[]>();
  const keyOf = (x: number, y: number, z: number) =>
    `${(x * inv) | 0},${(y * inv) | 0},${(z * inv) | 0}`;

  for (let i = 0; i < n; i++) {
    const k = keyOf(base[i * 3]!, base[i * 3 + 1]!, base[i * 3 + 2]!);
    let arr = buckets.get(k);
    if (!arr) {
      arr = [];
      buckets.set(k, arr);
    }
    arr.push(i);
  }

  for (let i = 0; i < n; i++) {
    const ix = base[i * 3]!;
    const iy = base[i * 3 + 1]!;
    const iz = base[i * 3 + 2]!;
    const cx = (ix * inv) | 0;
    const cy = (iy * inv) | 0;
    const cz = (iz * inv) | 0;
    const pairs: { j: number; d2: number }[] = [];
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          const arr = buckets.get(`${cx + dx},${cy + dy},${cz + dz}`);
          if (!arr) continue;
          for (const j of arr) {
            if (j === i) continue;
            const ddx = base[j * 3]! - ix;
            const ddy = base[j * 3 + 1]! - iy;
            const ddz = base[j * 3 + 2]! - iz;
            const d2 = ddx * ddx + ddy * ddy + ddz * ddz;
            if (d2 <= r2 && d2 > 1e-12) pairs.push({ j, d2 });
          }
        }
      }
    }
    pairs.sort((a, b) => a.d2 - b.d2);
    neighbors[i] = Int32Array.from(pairs.slice(0, maxDeg).map((p) => p.j));
  }
  return neighbors;
}

/**
 * Taubin λ|μ smooth on yielded verts only — rounds faceted melt edges while
 * preserving frozen upper band (identity).
 */
function taubinSmoothSlot(
  s: MeshSlot,
  freezeHeight: number,
  falloffPower: number,
  passes: number,
  strength: number,
): void {
  const n = (s.base.length / 3) | 0;
  const lambda = 0.42 * strength;
  const mu = -0.44 * strength;
  const scratch = new Float32Array(s.pos.length);

  const lapPass = (factor: number) => {
    scratch.set(s.pos);
    for (let vi = 0; vi < n; vi++) {
      const w = GravityMeltSim.yieldWeight(
        s.hNorm[vi]!,
        freezeHeight,
        falloffPower,
        s.downFace[vi]!,
      );
      if (w < 0.05) continue;
      const nbrs = s.neighbors[vi]!;
      if (!nbrs.length) continue;
      let ax = 0;
      let ay = 0;
      let az = 0;
      for (let k = 0; k < nbrs.length; k++) {
        const j = nbrs[k]! * 3;
        ax += s.pos[j]!;
        ay += s.pos[j + 1]!;
        az += s.pos[j + 2]!;
      }
      const inv = 1 / nbrs.length;
      ax *= inv;
      ay *= inv;
      az *= inv;
      const i = vi * 3;
      const blend = factor * w;
      scratch[i] = s.pos[i]! + (ax - s.pos[i]!) * blend;
      scratch[i + 1] = s.pos[i + 1]! + (ay - s.pos[i + 1]!) * blend;
      scratch[i + 2] = s.pos[i + 2]! + (az - s.pos[i + 2]!) * blend;
    }
    s.pos.set(scratch);
  };

  for (let p = 0; p < passes; p++) {
    lapPass(lambda);
    lapPass(mu);
  }
}
