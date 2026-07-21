import type { Material, Vec3 } from "../api/Material.js";

/** Named moods — concept-art adjacent, composable overrides welcome. */
export const presets = {
  applePane: {
    glass: 1,
    liquify: 0,
    drip: 0,
    viscosity: 0.35,
    dispersion: 0.25,
    filmThickness: 0.08,
    ior: 1.42,
    bevel: 0.7,
    blur: 0.45,
    cornerRadius: 0.14,
    specular: 0.55,
    lightPosition: { x: -0.35, y: 0.7, z: 0.9 },
    lightIntensity: 1.0,
  },
  /** Concept-art north star: molten chrome drips, top-left light, cyan↔magenta fire. */
  chromeDrip: {
    glass: 1,
    liquify: 0.7,
    drip: 0.85,
    viscosity: 0.72,
    dispersion: 0.88,
    filmThickness: 0.5,
    ior: 1.58,
    bevel: 0.88,
    blur: 0.12,
    cornerRadius: 0.18,
    specular: 1,
    // Top-left light (concept_art 1c6PD / Z53Ve / ENj9B)
    lightPosition: { x: -0.6, y: 0.82, z: 1.0 },
    lightIntensity: 2.4,
  },
  orbFilm: {
    glass: 1,
    liquify: 0.3,
    drip: 0.2,
    viscosity: 0.4,
    dispersion: 0.85,
    filmThickness: 0.75,
    ior: 1.52,
    bevel: 0.8,
    blur: 0.15,
    cornerRadius: 0.5,
    specular: 0.9,
    lightPosition: { x: 0.55, y: 0.45, z: 0.75 },
    lightIntensity: 1.5,
  },
  swarmChip: {
    glass: 0.95,
    liquify: 0.55,
    drip: 0.35,
    viscosity: 0.3,
    dispersion: 0.5,
    filmThickness: 0.3,
    ior: 1.4,
    bevel: 0.45,
    blur: 0.3,
    cornerRadius: 0.1,
    specular: 0.5,
    lightPosition: { x: -0.6, y: 0.4, z: 0.7 },
    lightIntensity: 1.1,
  },
} as const satisfies Record<string, Material>;

export type PresetName = keyof typeof presets;

/** Spherical light aim: azimuth/elevation (degrees) → field-space position. */
export function lightFromOrbit(
  azimuthDeg: number,
  elevationDeg: number,
  distance = 1.15,
): Vec3 {
  const az = (azimuthDeg * Math.PI) / 180;
  const el = (elevationDeg * Math.PI) / 180;
  const cosEl = Math.cos(el);
  return {
    x: distance * cosEl * Math.sin(az),
    y: distance * Math.sin(el),
    z: Math.max(0.08, distance * cosEl * Math.cos(az)),
  };
}

export function orbitFromLight(pos: Vec3): { azimuth: number; elevation: number; distance: number } {
  const distance = Math.max(0.2, Math.hypot(pos.x, pos.y, pos.z));
  const elevation = (Math.asin(Math.min(1, Math.max(-1, pos.y / distance))) * 180) / Math.PI;
  const azimuth = (Math.atan2(pos.x, pos.z) * 180) / Math.PI;
  return { azimuth, elevation, distance };
}
