/**
 * Frozen viscoplastic gravity sag (CPU vertex field).
 *
 * Concept art (klaut.pro/concept_art): molten chrome/glass letterforms that
 * sagged into pendant shapes and solidified — continuous letter body → neck →
 * bulb. Upper glyph stays identity; only below a tunable freeze height yields.
 *
 * Model (artist-scale, not full NS):
 *   - Herschel–Bulkley / yield-stress intuition: stress below yield → rigid plug
 *     (frozen upper band); above yield → gravity-driven stretch.
 *   - One-shot settle → freeze (static sculpture), not ongoing drip emitters.
 *   - Viscosity (Oh-proxy): thicker necks, fatter bulbs, slower settle.
 *
 * Detached sphere blobs belong to the optional continuum path (DripSim).
 * Default scratch / brand look is mesh deformation only.
 */

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
    bulbGrow: mix(0.22, 0.55, v),
    columnSharp: mix(3.2, 1.25, v),
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
};

export type GravityMeltStatus = {
  frozen: boolean;
  /** 0–1 how close to freeze (1 = frozen / settled). */
  settle: number;
  /** RMS velocity (mesh units / s). */
  keRms: number;
  freezeHeight: number;
  maps: MeltViscosityMaps;
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
};

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
      return {
        pos,
        base,
        normal,
        vel: new Float32Array(base.length),
        hNorm,
        downFace,
        lo,
        hi,
        halfW: Math.max((maxX - minX) * 0.5, 0.2),
        cx: (minX + maxX) * 0.5,
        cz: (minZ + maxZ) * 0.5,
      };
    });
    this.reset();
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
  ): [number, number, number] {
    const i = vi * 3;
    const bx = s.base[i];
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
      // No explicit columns: use local bottom mass as soft column seed
      column = Math.pow(w, 1.35);
    }

    const drain = w * (0.4 + 0.6 * Math.max(column, w * 0.55));
    // Vertical sag — longer under columns (pendant tips)
    const sag =
      maps.sagAmp *
      halfH *
      2 *
      drain *
      (0.55 + 0.9 * Math.max(column, drain * 0.4));

    // Pendant profile along yield weight: mid = neck pinch, tip = bulb
    const profileT = clamp01(drain);
    // Neck peak around mid-lower third
    const neckBand = Math.sin(Math.PI * smoothstep(0.12, 0.78, profileT));
    const bulbBand = Math.pow(smoothstep(0.55, 1, profileT), 1.35);
    const pinch = maps.neckPinch * neckBand * (0.35 + 0.65 * column);
    const bulb = maps.bulbGrow * bulbBand * (0.4 + 0.6 * column);

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
    const radialScale = 1 - pinch + bulb;

    const dx = rx * (radialScale - 1);
    const dy = -sag;
    const dz = rz * (radialScale - 1) * 0.85;
    return [dx, dy, dz];
  }

  /**
   * Integrate one frame. Returns true if any mesh positions changed.
   * When frozen, leaves buffers untouched (static solidified pose).
   */
  step(dt: number, p: GravityMeltParams): boolean {
    const h = Math.min(Math.max(dt, 0), 0.05);
    if (!this.slots.length || p.intensity < 0.001) {
      if (p.intensity < 0.001 && !this.frozen) this.reset();
      return false;
    }

    const maps = meltViscosityMaps(p.viscosity, p.intensity);
    this.lastMaps = maps;
    const freezeHeight = clamp01(
      typeof p.freezeHeight === "number" ? p.freezeHeight : 0.52,
    );
    const falloffPower =
      typeof p.falloffPower === "number" ? Math.max(0.35, p.falloffPower) : 1.65;
    this.lastFreezeHeight = freezeHeight;

    if (this.frozen) return false;

    const columns = p.columnXs ?? [];
    const oneShot = p.oneShot !== false; // default: one-shot settle (concept art)

    if (oneShot) {
      return this.stepOneShot(h, maps, freezeHeight, falloffPower, columns, p);
    }
    return this.stepPhysics(h, maps, freezeHeight, falloffPower, columns, p);
  }

  /** Analytic target lerp → freeze (preferred for brand look). */
  private stepOneShot(
    h: number,
    maps: MeltViscosityMaps,
    freezeHeight: number,
    falloffPower: number,
    columns: number[],
    p: GravityMeltParams,
  ): boolean {
    this.t += h;
    // Ease toward full sag; viscosity slows the settle
    this.oneShotT = Math.min(1, this.oneShotT + maps.settleRate * h * 0.85);
    const ease = this.oneShotT * this.oneShotT * (3 - 2 * this.oneShotT);
    this.settle = ease;

    for (const s of this.slots) {
      const halfH = Math.max((s.hi - s.lo) * 0.5, 1e-3);
      const colW = Math.max(p.columnHalfW ?? s.halfW * 0.14, 0.04);
      const n = (s.base.length / 3) | 0;
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
        );
        s.pos[i] = s.base[i] + dx * ease;
        s.pos[i + 1] = s.base[i + 1] + dy * ease;
        s.pos[i + 2] = s.base[i + 2] + dz * ease;
        s.vel[i] = 0;
        s.vel[i + 1] = 0;
        s.vel[i + 2] = 0;
      }
    }

    this.keRms = 0;
    if (this.oneShotT >= 0.995) this.freeze();
    return true;
  }

  /** Soft-body Verlet until KE dies, then freeze. */
  private stepPhysics(
    h: number,
    maps: MeltViscosityMaps,
    freezeHeight: number,
    falloffPower: number,
    columns: number[],
    p: GravityMeltParams,
  ): boolean {
    this.t += h;
    let keSum = 0;
    let keN = 0;

    for (const s of this.slots) {
      const halfH = Math.max((s.hi - s.lo) * 0.5, 1e-3);
      const maxSag = maps.sagAmp * halfH * 2;
      const colW = Math.max(p.columnHalfW ?? s.halfW * 0.14, 0.04);
      const n = (s.base.length / 3) | 0;

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
          // Completely frozen band — snap to identity
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

        // Soft attract toward analytic pendant target + mild gravity
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
    }

    this.keRms = keN > 0 ? Math.sqrt(keSum / keN) : 0;
    const halfHRef = Math.max(
      ...this.slots.map((s) => (s.hi - s.lo) * 0.5),
      0.5,
    );
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
