/** Composable liquid-glass material uniforms (artist + agent friendly). */

export type Material = {
  /** Pane strength / glass shade mix (0–1). */
  glass: number;
  /** Metaball field warp / surface-tension melt (0–1). */
  liquify: number;
  /** Drop emission intensity along bottom edge (0–1). */
  drip: number;
  /** RGB η split / chromatic fringe (0–1). */
  dispersion: number;
  /** Thin-film interference strength (0–1). */
  filmThickness: number;
  /** Base index of refraction. */
  ior: number;
  /** Edge bevel for SDF normals (0–1). */
  bevel: number;
  /** Soft backdrop preblur (0–1). */
  blur: number;
  /** Corner radius as fraction of min(width,height) (0–0.5). */
  cornerRadius: number;
  /** Specular highlight strength (0–1). */
  specular: number;
};

export type MaterialPartial = Partial<Material>;

export const DEFAULT_MATERIAL: Material = {
  glass: 1,
  liquify: 0,
  drip: 0,
  dispersion: 0.35,
  filmThickness: 0.2,
  ior: 1.45,
  bevel: 0.55,
  blur: 0.25,
  cornerRadius: 0.12,
  specular: 0.65,
};

export function resolveMaterial(partial?: MaterialPartial): Material {
  return { ...DEFAULT_MATERIAL, ...partial };
}

export function clampMaterial(m: Material): Material {
  const c = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
  return {
    glass: c(m.glass),
    liquify: c(m.liquify),
    drip: c(m.drip),
    dispersion: c(m.dispersion),
    filmThickness: c(m.filmThickness),
    ior: c(m.ior, 1.05, 1.75),
    bevel: c(m.bevel),
    blur: c(m.blur),
    cornerRadius: c(m.cornerRadius, 0, 0.5),
    specular: c(m.specular),
  };
}
