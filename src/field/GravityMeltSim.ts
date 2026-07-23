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
 * Roundness (geometry-level):
 * - Local tip remesh: continuous pear-of-revolution lattice (thick lip → taper
 *   neck → squashed teardrop bulb) — not UV-spheres on thin sticks
 * - Absolute pear / teardrop sculpt; tip-seed hard-project onto same profile
 * - Letter lip gather + off-column strand kill for seamless letter→neck join
 * - No attached drip sphere meshes (`dripBlobs: 0`)
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

/**
 * Parametric honey-pendant radius along profile u∈[0,1].
 * Concept: stem-matched lip → thick taper neck → pear bulb (widest low) → plump tip.
 * Neck stays ≥ ~62% of bulb so it never reads as wire / empty gap.
 */
export function honeyPendantRadius(
  u: number,
  neckR: number,
  bulbR: number,
  lipR?: number,
): number {
  const t = clamp01(u);
  const neck = Math.max(neckR, bulbR * 0.62); // hard floor vs bulb — thick honey neck
  const bulb = Math.max(bulbR, neck * 1.35);
  // Lip ≈ stem — avoid vase-flare that reads as detached cup
  const lip = Math.max(Math.min(lipR ?? neck * 1.28, neck * 1.45), neck * 1.08);

  // 0→0.32: lip → neck (gentle taper, stays thick)
  if (t < 0.32) {
    const s = Math.pow(smoothstep(0, 0.32, t), 0.9);
    return mix(lip, neck, s);
  }
  // 0.32→0.76: neck → pear swell (peak ~0.70 — lower half fatter)
  if (t < 0.76) {
    const s = Math.pow(smoothstep(0.32, 0.7, t), 0.88);
    return mix(neck, bulb, s);
  }
  // 0.76→1: soft tip taper with plump floor (teardrop, not spike)
  const tip = Math.pow(smoothstep(0.76, 1, t), 1.3);
  const tipR = mix(bulb, bulb * 0.4, tip);
  const tipFloor = bulb * mix(0.48, 0.34, tip);
  return Math.max(tipFloor, tipR);
}

/** Y along pendant: lip → tip. Short neck + elongated pear body. */
export function honeyPendantY(u: number, lipY: number, hang: number): number {
  const t = clamp01(u);
  // Short neck (22%) then pear body — avoids long invisible filament
  const neckFrac = 0.22;
  if (t <= neckFrac) {
    const nu = t / Math.max(neckFrac, 1e-6);
    return lipY - hang * neckFrac * Math.pow(nu, 0.95);
  }
  const bu = (t - neckFrac) / (1 - neckFrac);
  // Bias mass downward (honey hang / pear squash vs sphere)
  return lipY - hang * (neckFrac + (1 - neckFrac) * Math.pow(bu, 0.72));
}

export type HoneyTipCapsuleSpec = {
  columnXs: number[];
  /** Letter bottom lip Y in mesh-local space. */
  lipY: number;
  cz: number;
  /** Column half-width (drives neck/bulb scale). */
  colW: number;
  /** Full pendant hang length (sculpt target). Rest seed uses a fraction. */
  hang: number;
  neckR?: number;
  bulbR?: number;
  /** Lip join radius (defaults to ~2× neck — seamless letter blend). */
  lipR?: number;
  /** Latitude rings from lip→tip (default 14). */
  rings?: number;
  /** Azimuth segments (default 18). */
  segs?: number;
  /**
   * Rest-pose hang as fraction of `hang` (collapsed seed under lip so stages
   * 1–4 stay clean). Default 0.08.
   */
  seedHangFrac?: number;
  /** Extra plump for spike-prone glyphs (p / . / descenders). */
  plump?: number;
};

export type HoneyTipCapsuleBuffers = {
  positions: Float32Array;
  normals: Float32Array;
  /** Parametric u per vert ∈ (0,1]; used as tipSeed hard-project. */
  tipU: Float32Array;
  indices: Uint32Array;
  vertCount: number;
};

/**
 * Build a denser pear / teardrop lattice per drip column.
 * Continuous rings of revolution (thick lip → neck → squashed bulb) + tip pole —
 * solid from any camera angle; no UV-sphere on a thin stick.
 */
export function buildHoneyTipCapsuleBuffers(
  spec: HoneyTipCapsuleSpec,
): HoneyTipCapsuleBuffers {
  const cols = spec.columnXs.length ? spec.columnXs : [0];
  const rings = Math.max(10, Math.min(28, spec.rings ?? 14));
  const segs = Math.max(10, Math.min(32, spec.segs ?? 18));
  const plump = Math.max(0.85, spec.plump ?? 1);
  const neckR = Math.max(
    (spec.neckR ?? spec.colW * 0.78) * plump,
    spec.colW * 0.5,
  );
  const bulbR = Math.max(
    (spec.bulbR ?? spec.colW * 1.28) * plump,
    neckR * 1.4,
  );
  const lipR = Math.max(
    (spec.lipR ?? neckR * 1.22) * plump,
    neckR * 1.1,
    spec.colW * 0.85,
  );
  // Pear needs vertical room: hang ≥ ~3.0× bulbR so silhouette elongates
  const hang = Math.max(spec.hang, bulbR * 3.0);
  const seedHang = hang * clamp01(spec.seedHangFrac ?? 0.06);
  // Bury join slightly into letter so lattice emerges from lip (no air gap)
  const lipY = spec.lipY + hang * 0.035;
  const cz = spec.cz;

  // Latitude rings + south pole (closed tip)
  const vertsPerCol = rings * segs + 1;
  const vertCount = vertsPerCol * cols.length;
  const positions = new Float32Array(vertCount * 3);
  const normals = new Float32Array(vertCount * 3);
  const tipU = new Float32Array(vertCount);
  const indices: number[] = [];

  for (let ci = 0; ci < cols.length; ci++) {
    const ax = cols[ci]!;
    const base = ci * vertsPerCol;
    let cursor = 0;

    for (let r = 0; r < rings; r++) {
      // First ring near lip (u≈0.02) — tipU must stay >0 so hard-project runs
      const u = mix(0.02, 0.985, r / Math.max(rings - 1, 1));
      const R = honeyPendantRadius(u, neckR, bulbR, lipR) * 0.42; // rest seed compact
      const y = lipY - seedHang * Math.pow(u, 0.9);
      // Approximate surface normal from profile slope
      const u2 = Math.min(1, u + 0.02);
      const R2 = honeyPendantRadius(u2, neckR, bulbR, lipR) * 0.38;
      const y2 = lipY - seedHang * Math.pow(u2, 0.88);
      const dR = R2 - R;
      const dY = y2 - y;
      // Outward normal for descending profile (rings go −Y): n_r = −dY
      const nLen = Math.hypot(-dY, dR) || 1;
      const nRad = -dY / nLen;
      const nY = dR / nLen;
      for (let s = 0; s < segs; s++) {
        const ang = (s / segs) * Math.PI * 2;
        const vi = base + cursor++;
        const i = vi * 3;
        const c = Math.cos(ang);
        const sn = Math.sin(ang);
        positions[i] = ax + c * R;
        positions[i + 1] = y;
        positions[i + 2] = cz + sn * R * 0.96;
        normals[i] = c * nRad;
        normals[i + 1] = nY;
        normals[i + 2] = sn * nRad;
        tipU[vi] = u;
      }
    }

    // South pole (closed tip)
    const south = base + cursor++;
    {
      const i = south * 3;
      positions[i] = ax;
      positions[i + 1] = lipY - seedHang * 0.98;
      positions[i + 2] = cz;
      normals[i] = 0;
      normals[i + 1] = -1;
      normals[i + 2] = 0;
      tipU[south] = 1;
    }

    // Side quads between latitude rings (CCW from outside — FrontSide visible)
    for (let r = 0; r < rings - 1; r++) {
      for (let s = 0; s < segs; s++) {
        const s2 = (s + 1) % segs;
        const a = base + r * segs + s;
        const b = base + r * segs + s2;
        const c = base + (r + 1) * segs + s2;
        const d = base + (r + 1) * segs + s;
        // a→d→c→b: outward when rings descend (−Y) and angle increases
        indices.push(a, d, c, a, c, b);
      }
    }
    // Fan south pole ← last ring (outward)
    const last = rings - 1;
    for (let s = 0; s < segs; s++) {
      const s2 = (s + 1) % segs;
      const a = base + last * segs + s;
      const b = base + last * segs + s2;
      indices.push(a, south, b);
    }
  }

  return {
    positions,
    normals,
    tipU,
    indices: Uint32Array.from(indices),
    vertCount,
  };
}

/**
 * Absolute pear sample at parametric u — tip-seed hard-project target.
 * Continuous lip→neck→teardrop (no UV-sphere branch).
 */
export function honeyPendantPoint(
  u: number,
  ax: number,
  lipY: number,
  cz: number,
  hang: number,
  neckR: number,
  bulbR: number,
  ang: number,
  lipR?: number,
): [number, number, number] {
  const t = clamp01(u);
  const rr = honeyPendantRadius(t, neckR, bulbR, lipR);
  const yy = honeyPendantY(t, lipY, hang);
  return [ax + Math.cos(ang) * rr, yy, cz + Math.sin(ang) * rr * 0.96];
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
  // Oh-proxy: high v ≈ honey (fat slow bulbs, thick necks);
  // low v ≈ watery (sharper thinner drips, smaller tips).
  // Concept art: long thin necks + plump teardrop tips hanging mid-air.
  return {
    gravity: mix(3.2, 0.62, v) * d,
    damping: mix(2.0, 12.5, v),
    spring: mix(12, 1.2, v),
    // Longer hang so necks read as filaments (still capped in targetDelta)
    sagAmp: mix(0.22, 0.58, v) * d,
    // Strong mid-filament pinch — neck must be clearly thinner than bulb
    neckPinch: mix(0.95, 0.72, v),
    // Tip radial swell — honey needs obvious pear bulbs (tipW/midW > 1.3)
    bulbGrow: mix(0.7, 2.05, v),
    columnSharp: mix(3.6, 1.55, v),
    settleRate: mix(1.8, 0.38, v) * d,
    freezeKe: mix(0.014, 0.0028, v),
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
  /**
   * Tip-seed parametric u ∈ (0,1] for remeshed pear-lattice verts; 0 = letter mesh.
   * Hard-projected onto honey pendant each settle step.
   */
  tipU: Float32Array;
  lo: number;
  hi: number;
  halfW: number;
  /** Local X centroid for radial pinch. */
  cx: number;
  cz: number;
  /** Adjacency for Taubin smooth (built once from proximity). */
  neighbors: Int32Array[];
  /** True if this slot has pear-lattice tip-seed verts. */
  hasTipLattice: boolean;
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
    bulbSoftMin: ov?.bulbSoftMin ?? master.bulbSoftMin ?? 0.92,
    smoothPasses: ov?.smoothPasses ?? master.smoothPasses ?? 6,
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
      /** Optional tip-seed u per vert from `buildHoneyTipCapsuleBuffers`. */
      tipU?: Float32Array;
    }>,
  ): void {
    this.slots = meshes.map(({ pos, base, normal, tipU: tipUIn }) => {
      let lo = Infinity;
      let hi = -Infinity;
      let minX = Infinity;
      let maxX = -Infinity;
      let minZ = Infinity;
      let maxZ = -Infinity;
      for (let i = 0; i < base.length; i += 3) {
        lo = Math.min(lo, base[i + 1]!);
        hi = Math.max(hi, base[i + 1]!);
        minX = Math.min(minX, base[i]!);
        maxX = Math.max(maxX, base[i]!);
        minZ = Math.min(minZ, base[i + 2]!);
        maxZ = Math.max(maxZ, base[i + 2]!);
      }
      const span = Math.max(hi - lo, 1e-4);
      const n = (base.length / 3) | 0;
      const hNorm = new Float32Array(n);
      const downFace = new Float32Array(n);
      const tipU = new Float32Array(n);
      if (tipUIn && tipUIn.length >= n) tipU.set(tipUIn.subarray(0, n));
      for (let vi = 0; vi < n; vi++) {
        const i = vi * 3;
        // Tip-seed verts: treat as fully yielded bottom lip (ignore rest Y inside seed)
        if (tipU[vi]! > 1e-5) {
          hNorm[vi] = mix(0.02, 0.18, 1 - tipU[vi]!);
          downFace[vi] = 1;
        } else {
          hNorm[vi] = clamp01((base[i + 1]! - lo) / span);
          downFace[vi] = Math.max(0, -normal[i + 1]!);
        }
      }
      const halfW = Math.max((maxX - minX) * 0.5, 0.2);
      // Denser graph radius so tip-lattice rings smooth with letter lip
      const neighbors = buildProximityGraph(base, halfW * 0.28);
      let hasTipLattice = false;
      for (let ti = 0; ti < n; ti++) {
        if (tipU[ti]! > 1e-5) {
          hasTipLattice = true;
          break;
        }
      }
      return {
        pos,
        base,
        normal,
        vel: new Float32Array(base.length),
        hNorm,
        downFace,
        tipU,
        lo,
        hi,
        halfW,
        cx: (minX + maxX) * 0.5,
        cz: (minZ + maxZ) * 0.5,
        neighbors,
        hasTipLattice,
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
   * Absolute pear / pendant radius along drip profile (in mesh units).
   * Thin stems need absolute R — multiplicative scale from near-axis verts stays invisible.
   */
  static pearRadius(
    profileT: number,
    neckPinch: number,
    bulbGrow: number,
    halfW: number,
    halfH: number,
  ): number {
    const t = clamp01(profileT);
    const base = Math.max(halfW * 0.85, halfH * 0.11);
    const neckPhase = smoothstep(0.02, 0.62, t);
    const neckWave = Math.sin(Math.PI * Math.min(neckPhase / 0.48, 1));
    const bulbPhase = smoothstep(0.42, 1.0, t);
    const pear = Math.pow(bulbEaseSafe(bulbPhase), 0.92);
    const bulbRound = Math.sin((Math.PI * 0.5) * pear);
    // Soft tip pole only — keep finite radius (concept: plump teardrop, not spike)
    const tipCap = Math.pow(smoothstep(0.9, 1.0, t), 2.4);
    // Neck much thinner than base; tip bulb clearly exceeds neck
    const neckR = base * (1 - neckPinch * neckWave * 1.05);
    const bulbR =
      base *
      (1 + bulbGrow * (bulbRound * 2.15 + tipCap * 0.12)) *
      mix(1.15, 2.15, clamp01(bulbGrow / 2.05));
    const uNeck = smoothstep(0.04, 0.48, t);
    const uBulb = smoothstep(0.38, 1.0, t);
    const r = mix(base, Math.max(neckR, base * 0.08), uNeck);
    // Floor tip radius — south pole stays round
    const tipFloor = bulbR * mix(0.78, 0.48, tipCap);
    return Math.max(tipFloor, mix(r, Math.max(r, bulbR), uBulb));
  }

  /**
   * Cosine / pear teardrop radial scale (compat / debugging). Prefer pearRadius.
   */
  static teardropRadial(
    profileT: number,
    neckPinch: number,
    bulbGrow: number,
  ): number {
    const t = clamp01(profileT);
    const neckPhase = smoothstep(0.04, 0.7, t);
    const neckWave = Math.sin(Math.PI * Math.min(neckPhase / 0.55, 1));
    const bulbPhase = smoothstep(0.48, 1.0, t);
    const pear = Math.pow(bulbEaseSafe(bulbPhase), 1.05);
    const bulbRound = Math.sin((Math.PI * 0.5) * pear);
    const tipCap = Math.pow(smoothstep(0.78, 1.0, t), 1.4);
    const pinch = neckPinch * neckWave * 1.05;
    const bulb = bulbGrow * (bulbRound * 2.05 + tipCap * 0.7);
    return Math.max(0.08, 1 - pinch + bulb);
  }

  /**
   * Analytic target displacement for a rest-pose vertex (honey pendant profile).
   * Continuous letter → long neck → round tip bulb (no attached sphere meshes).
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
    // Tip-lattice verts are authored for pear topology — sculpt hard-projects them.
    // Never run letter-stretch delta on them (that recreates spikes).
    if (s.tipU[vi]! > 1e-5) return [0, 0, 0];

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
      // Soft falloff — concentrate melt into drip columns (honey pendants)
      column = Math.pow(Math.max(0, 1 - near), maps.columnSharp);
    } else {
      // No explicit columns: prefer bottom-center medial drip
      const nx = Math.abs(bx - s.cx) / Math.max(s.halfW, 1e-4);
      const medial = Math.pow(Math.max(0, 1 - nx * 1.15), maps.columnSharp);
      column = Math.pow(w, 0.85) * mix(0.35, 1, medial);
    }

    // Gate drainage tightly to drip columns (avoid slab/puddle bottoms)
    const drain = w * (0.05 + 0.95 * Math.pow(Math.max(column, w * 0.08), 0.9));
    const profileT = clamp01(drain);

    // Tip-heavy hang: longer filament so neck reads before bulb
    const tipWeight = Math.pow(profileT, 0.55);
    const neckElongate = mix(0.55, 1.35, smoothstep(0.12, 0.92, profileT));
    const tipHangExtra =
      maps.bulbGrow *
      bulbMul *
      0.22 *
      Math.pow(smoothstep(0.5, 1, profileT), 1.6);
    let sag =
      maps.sagAmp *
      sagMul *
      halfH *
      (1.25 + tipHangExtra) *
      tipWeight *
      neckElongate *
      (0.35 + 1.2 * Math.max(column, profileT * 0.35));
    // Cap — hanging pendant above floor; letter verts only form the neck root.
    // Tip lattice owns the bulb silhouette (avoid stretched letter spikes).
    const sagCap = halfH * mix(0.28, 0.48, clamp01(maps.bulbGrow / 2.05)) * sagMul;
    sag = Math.min(sag, sagCap);

    const targetR = GravityMeltSim.pearRadius(
      profileT,
      maps.neckPinch * neckMul,
      maps.bulbGrow * bulbMul,
      // Column-local width — not full glyph halfW (that flattens drips into slabs)
      Math.max(colW * 1.35, halfH * 0.12),
      halfH,
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
    let ox = bx - ax;
    let oz = bz - s.cz;
    const restR = Math.hypot(ox, oz);
    // Keep rest angular position — never invent dirs (tears manifold into ribbons)
    if (restR < 1e-6) {
      // Exact axis: only sag vertically; softMin tip handles plump
      ox = 0;
      oz = 0;
    }
    const blendR =
      smoothstep(0.1, 0.98, profileT) *
      (0.55 + 0.45 * Math.max(column, profileT));
    let dx = 0;
    let dz = 0;
    if (restR > 1e-6) {
      const invR = 1 / restR;
              // Thin stems: floor rest radius so tip can swell into honey bulb
              const fromR = mix(
                restR,
                Math.max(restR, colW * 0.55),
                smoothstep(0.45, 1, profileT),
              );
      const outR = mix(fromR, targetR, blendR);
      dx = ax + ox * invR * outR - bx;
      dz = s.cz + oz * invR * outR * 0.95 - bz;
    }
    let dy = -sag;

    // With tip lattice: letter mesh only forms a short lip melt.
    // Remeshed pear capsule owns the hanging teardrop (avoids flared letter spikes).
    const hasTipLattice = s.hasTipLattice;
    if (hasTipLattice) {
      // Kill jagged off-column lip strands — snap back to rest (no hang)
      if (column < 0.38) {
        // Mild upward tuck for stray bottom verts that look like strands
        const tuck =
          s.hNorm[vi]! < 0.22 ? halfH * 0.02 * (1 - column) * w : 0;
        return [0, tuck, 0];
      }
      // Strong radial gather into column — thick seamless lip blend
      let gdx = 0;
      let gdz = 0;
      if (restR > 1e-6) {
        const gather = 0.72 * column * Math.max(tipWeight, 0.35);
        const lipBlendR = mix(
          restR,
          Math.max(colW * 1.05, Math.min(restR, colW * 1.35)),
          gather,
        );
        const invR = 1 / restR;
        gdx = ax + ox * invR * lipBlendR - bx;
        gdz = s.cz + oz * invR * lipBlendR * 0.95 - bz;
      }
      // Very short lip sag only — lattice owns hang
      const lipSag = -halfH * mix(0.01, 0.07, tipWeight * column) * sagMul;
      return [gdx, lipSag, gdz];
    }

    const tipGate = Math.max(column, profileT * 0.9);
    const tipHang = Math.min(
      sagCap * mix(0.75, 1.05, tipGate),
      maps.sagAmp * sagMul * halfH * (1.35 + 0.45 * maps.bulbGrow * bulbMul),
    );
    if (bulbSoft > 0.01 && profileT > 0.35 && tipGate > 0.18) {
      const baseR = Math.max(colW * 1.05, halfH * 0.09);
      const bulbR =
        baseR *
        (1.05 + 0.85 * maps.bulbGrow * bulbMul) *
        mix(1.0, 1.55, clamp01(maps.bulbGrow / 2.05));
      const neckR = baseR * mix(0.55, 0.28, maps.neckPinch);
      const tipCx = ax;
      const tipCz = s.cz;
      const cy = s.lo - tipHang * 0.42;
      const tipY = cy - bulbR * 0.95;

      let px0 = bx + dx;
      let py0 = by + dy;
      let pz0 = bz + dz;

      const lat = smoothstep(0.38, 1.0, profileT);
      const tipSnap =
        clamp01(bulbSoft) * Math.pow(lat, 0.95) * (0.6 + 0.4 * tipGate);
      if (tipSnap > 0.02) {
        let ox2 = px0 - tipCx;
        let oz2 = pz0 - tipCz;
        let rXZ = Math.hypot(ox2, oz2);
        if (rXZ < 1e-5) {
          ox2 = restR > 1e-6 ? ox : colW * 0.4;
          oz2 = restR > 1e-6 ? oz : 0;
          rXZ = Math.hypot(ox2, oz2);
        }
        const inv2 = 1 / Math.max(rXZ, 1e-5);
        const pearWave = Math.sin(Math.PI * Math.min(lat / 0.78, 1));
        const wantR = Math.max(
          bulbR * mix(0.72, 0.45, Math.pow(lat, 1.8)),
          mix(neckR, bulbR, pearWave) * (1 - 0.1 * Math.pow(lat, 2.4)),
        );
        const wantY = mix(cy + bulbR * 0.08, tipY, Math.pow(lat, 1.05));
        const tx = tipCx + ox2 * inv2 * wantR;
        const tz = tipCz + oz2 * inv2 * wantR * 0.95;
        dx += (tx - px0) * tipSnap;
        dy += (wantY - py0) * tipSnap;
        dz += (tz - pz0) * tipSnap;
        px0 = bx + dx;
        py0 = by + dy;
        pz0 = bz + dz;
      }

      const dSphere = Math.hypot(px0 - tipCx, py0 - cy, pz0 - tipCz) - bulbR;
      const stemR = neckR * mix(1.05, 0.7, lat);
      const dStem = Math.hypot(px0 - tipCx, pz0 - tipCz) - stemR;
      const k = mix(0.16, 0.48, maps.bulbGrow) * halfH;
      const dField = softMin(dStem, dSphere, k);
      const pull =
        clamp01(bulbSoft) *
        smoothstep(0.35, 0.98, profileT) *
        (0.5 + 0.5 * tipGate) *
        1.05;
      if (pull > 0.01 && Math.abs(dField) < bulbR * 3.8) {
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
        const corr = -dField * pull;
        dx += ddx * invLen * corr;
        dy += ddy * invLen * corr;
        dz += ddz * invLen * corr;
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
      const bulbSoft = p.bulbSoftMin ?? 0.92;

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

      // Sculpt clear honey pendant silhouettes per drip column
      if (ease > 0.12) {
        const cols = columns.length ? columns : [s.cx];
        // Spike-prone: denser tip lattice + extra plump (descenders / period)
        const tipSeedN = s.tipU.reduce((a, u) => a + (u > 0 ? 1 : 0), 0);
        const plump = tipSeedN > 40 ? 1.28 : 1.12;
        for (const ax of cols) {
          sculptHoneyPendant(
            s,
            ax,
            colW,
            maps,
            freezeHeight,
            falloffPower,
            sagMul,
            neckMul,
            bulbMul,
            // Full snap on tip lattice once ease advances
            Math.min(1, ease * 1.35) * clamp01(bulbSoft + 0.35),
            plump,
          );
        }
      }

      // Mild Taubin — tip seeds mostly skip (lattice owns roundness)
      const passes = Math.max(0, Math.min(8, Math.round(p.smoothPasses ?? 4)));
      if (passes > 0 && ease > 0.12) {
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
      const bulbSoft = p.bulbSoftMin ?? 0.92;

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
 * Post-sculpt: remap yielded column verts onto a parametric honey pendant
 * (thick lip → taper neck → pear bulb). Tip-seed lattice verts (tipU>0) are
 * hard-projected so rings stay pear-shaped — no UV-sphere snap.
 */
function sculptHoneyPendant(
  s: MeshSlot,
  ax: number,
  colW: number,
  maps: MeltViscosityMaps,
  freezeHeight: number,
  falloffPower: number,
  sagMul: number,
  neckMul: number,
  bulbMul: number,
  strength: number,
  /** Extra plump for spike-prone glyphs (p / .). */
  plump = 1,
): void {
  if (strength < 0.05) return;
  const halfH = Math.max((s.hi - s.lo) * 0.5, 1e-3);
  const hang = Math.min(
    halfH * mix(0.75, 1.25, clamp01(maps.bulbGrow / 2.05)) * sagMul,
    halfH * 1.65,
  );
  // Absolute radii from column width — pear needs vertical room vs width
  const baseR = Math.max(colW * 1.2, halfH * 0.1);
  const n = (s.base.length / 3) | 0;
  // Bury join into letter lip so pendant emerges continuously
  const lipY = s.lo + hang * 0.03;
  // Thick neck (concept: seamless stem blend, not wire / gap)
  let neckR = Math.min(
    baseR * mix(0.95, 0.75, clamp01(maps.neckPinch * Math.min(neckMul, 1.3))),
    hang * 0.34,
  );
  neckR = Math.max(neckR, baseR * 0.65, colW * 0.75);
  const lipR = Math.max(neckR * 1.2, baseR * 0.95, colW * 0.95);
  let bulbR =
    baseR *
    (0.9 + 0.38 * maps.bulbGrow * Math.min(bulbMul, 2.0)) *
    mix(1.0, 1.18, clamp01(maps.bulbGrow / 2.05)) *
    Math.min(plump, 1.15);
  // Elongated pear: bulb diameter ≤ ~46% of hang
  bulbR = Math.min(bulbR, hang * 0.27);
  bulbR = Math.max(bulbR, neckR * 1.4);

  for (let vi = 0; vi < n; vi++) {
    const seedU = s.tipU[vi]!;
    const isSeed = seedU > 1e-5;
    const w = GravityMeltSim.yieldWeight(
      s.hNorm[vi]!,
      freezeHeight,
      falloffPower,
      s.downFace[vi]!,
    );
    if (!isSeed && w < 0.12) continue;
    const i = vi * 3;
    const bx = s.base[i]!;
    const bz = s.base[i + 2]!;
    const near = Math.abs(bx - ax) / Math.max(colW, 1e-4);
    // Kill jagged lip strands: letter verts outside drip column stay put
    if (!isSeed && near > 0.85) continue;
    const column = isSeed
      ? 1
      : Math.pow(Math.max(0, 1 - near), maps.columnSharp);
    if (!isSeed && column < 0.28) continue;

    // Non-seed letter verts: only blend into buried lip — never form hanging spikes
    if (!isSeed) {
      const by = s.base[i + 1]!;
      // Tuck stray bottom spikes back toward letter rest Y
      if (by < s.lo + halfH * 0.04 && column < 0.55) {
        s.pos[i + 1] = mix(s.pos[i + 1]!, by + halfH * 0.015, 0.85 * strength);
        continue;
      }
    }

    // Tip-seed: parametric u is authored on the lattice; letter lip blends into thick root
    const t = isSeed
      ? seedU
      : clamp01(0.02 + 0.18 * w * column);
    if (!isSeed && t < 0.025) continue;

    let ox = bx - ax;
    let oz = bz - s.cz;
    let r0 = Math.hypot(ox, oz);
    if (r0 < 1e-5) {
      ox = s.pos[i]! - ax;
      oz = s.pos[i + 2]! - s.cz;
      r0 = Math.hypot(ox, oz);
      if (r0 < 1e-5) {
        ox = colW * 0.35;
        oz = 0.01;
        r0 = Math.hypot(ox, oz);
      }
    }
    const ang = Math.atan2(oz, ox);

    const [tx, ty, tz] = honeyPendantPoint(
      t,
      ax,
      lipY,
      s.cz,
      hang,
      neckR,
      bulbR,
      ang,
      lipR,
    );

    const k = isSeed
      ? Math.min(1, strength * 1.1)
      : strength * smoothstep(0.02, 0.22, t) * (0.55 + 0.45 * column) * 0.85;

    s.pos[i] = mix(s.pos[i]!, tx, k);
    s.pos[i + 1] = mix(s.pos[i + 1]!, ty, k);
    s.pos[i + 2] = mix(s.pos[i + 2]!, tz, k);

    // Reinforce pear radius (not sphere) on tip half
    if (isSeed && t > 0.35) {
      const wantR = honeyPendantRadius(t, neckR, bulbR, lipR);
      const wantY = honeyPendantY(t, lipY, hang);
      let px = s.pos[i]!;
      let py = s.pos[i + 1]!;
      let pz = s.pos[i + 2]!;
      let vx = px - ax;
      let vz = pz - s.cz;
      let rXZ = Math.hypot(vx, vz);
      if (rXZ < 1e-5) {
        vx = Math.cos(ang);
        vz = Math.sin(ang);
        rXZ = 1;
      }
      const inv = 1 / rXZ;
      const snap = strength * 0.92;
      s.pos[i] = mix(px, ax + vx * inv * wantR, snap);
      s.pos[i + 1] = mix(py, wantY, snap);
      s.pos[i + 2] = mix(pz, s.cz + vz * inv * wantR * 0.96, snap);
    }
  }
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
  const lambda = 0.48 * strength;
  const mu = -0.5 * strength;
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
      const tipSeed = s.tipU[vi]! > 1e-5;
      if (w < 0.04 && !tipSeed) continue;
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
      // Tip lattice owns roundness — barely Taubin (prevents spike collapse)
      const tipBoost = tipSeed
        ? 0.08
        : mix(1.05, 0.18, Math.pow(w, 1.6));
      const blend = factor * (tipSeed ? 1 : w) * tipBoost;
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
