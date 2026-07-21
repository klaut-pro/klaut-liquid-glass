/** Composable liquid-glass material uniforms (artist + agent friendly). */

export type Vec3 = { x: number; y: number; z: number };

export type Material = {
  /** Pane strength / glass shade mix (0–1). */
  glass: number;
  /** Metaball field warp / surface-tension melt (0–1). */
  liquify: number;
  /** Drop emission intensity along bottom edge (0–1). */
  drip: number;
  /**
   * Dynamic viscosity (0–1). Drives drip rate, neck stretch, blob merge.
   * Low = watery/fast/short necks; high = thick/slow/long necks.
   */
  viscosity: number;
  /**
   * Chromatic dispersion amount (0–1). Applied via Cauchy/Abbe η(λ)
   * modulated by the material light (not a flat RGB smear).
   */
  dispersion: number;
  /** Thin-film interference strength (0–1). */
  filmThickness: number;
  /** Base index of refraction (≈ n_d at green). */
  ior: number;
  /** Edge bevel for SDF normals (0–1). */
  bevel: number;
  /** Soft backdrop preblur (0–1). */
  blur: number;
  /** Corner radius as fraction of min(width,height) (0–0.5). */
  cornerRadius: number;
  /** Specular highlight strength (0–1). */
  specular: number;
  /**
   * Point/directional light in field space (origin = pane center, +y up, +z toward camera).
   * Dispersion fringe and specular are strongest toward the lit side / highlight.
   */
  lightPosition: Vec3;
  /** Light intensity (0–4). Scales specular + light-driven dispersion. */
  lightIntensity: number;
};

export type MaterialPartial = Partial<Material>;

export const DEFAULT_LIGHT: Vec3 = { x: -0.45, y: 0.65, z: 0.85 };

export const DEFAULT_MATERIAL: Material = {
  glass: 1,
  liquify: 0,
  drip: 0,
  viscosity: 0.45,
  dispersion: 0.35,
  filmThickness: 0.2,
  ior: 1.45,
  bevel: 0.55,
  blur: 0.25,
  cornerRadius: 0.12,
  specular: 0.65,
  lightPosition: { ...DEFAULT_LIGHT },
  lightIntensity: 1.15,
};

export function resolveMaterial(partial?: MaterialPartial): Material {
  const base = { ...DEFAULT_MATERIAL, ...partial };
  return {
    ...base,
    lightPosition: {
      ...DEFAULT_LIGHT,
      ...(partial?.lightPosition ?? DEFAULT_MATERIAL.lightPosition),
    },
  };
}

export function clampMaterial(m: Material): Material {
  const c = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
  const light = m.lightPosition ?? DEFAULT_LIGHT;
  return {
    glass: c(m.glass),
    liquify: c(m.liquify),
    drip: c(m.drip),
    viscosity: c(m.viscosity),
    dispersion: c(m.dispersion),
    filmThickness: c(m.filmThickness),
    ior: c(m.ior, 1.05, 1.75),
    bevel: c(m.bevel),
    blur: c(m.blur),
    cornerRadius: c(m.cornerRadius, 0, 0.5),
    specular: c(m.specular),
    lightPosition: {
      x: c(light.x, -2, 2),
      y: c(light.y, -2, 2),
      z: c(light.z, 0.05, 3),
    },
    lightIntensity: c(m.lightIntensity, 0, 4),
  };
}
