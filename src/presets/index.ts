import type { Material } from "../api/Material.js";

/** Named moods — concept-art adjacent, composable overrides welcome. */
export const presets = {
  applePane: {
    glass: 1,
    liquify: 0,
    drip: 0,
    dispersion: 0.2,
    filmThickness: 0.08,
    ior: 1.42,
    bevel: 0.7,
    blur: 0.45,
    cornerRadius: 0.14,
    specular: 0.55,
  },
  chromeDrip: {
    glass: 1,
    liquify: 0.45,
    drip: 0.35,
    dispersion: 0.75,
    filmThickness: 0.55,
    ior: 1.48,
    bevel: 0.6,
    blur: 0.2,
    cornerRadius: 0.16,
    specular: 0.8,
  },
  orbFilm: {
    glass: 1,
    liquify: 0.25,
    drip: 0.1,
    dispersion: 0.9,
    filmThickness: 0.85,
    ior: 1.52,
    bevel: 0.8,
    blur: 0.15,
    cornerRadius: 0.5,
    specular: 0.9,
  },
  swarmChip: {
    glass: 0.95,
    liquify: 0.55,
    drip: 0.2,
    dispersion: 0.55,
    filmThickness: 0.35,
    ior: 1.4,
    bevel: 0.45,
    blur: 0.3,
    cornerRadius: 0.1,
    specular: 0.5,
  },
} as const satisfies Record<string, Material>;

export type PresetName = keyof typeof presets;
