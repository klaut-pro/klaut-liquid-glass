/**
 * Concept-art letterform profiles for isolated glyph QA.
 *
 * Glyph silhouettes come from font-baked EDT SDF atlases
 * (`scripts/bake-glyph-sdf.py` → `src/field/glyphAtlases.ts`):
 * - chromeSansP — Arial Black geometric "p" (refs: 1c6PD.jpg, Z53Ve.jpg)
 * - scriptProP  — Segoe Script molten "p" (ref: ENj9B.jpg ".pro" stroke)
 *
 * Blender was not on PATH at bake time; atlas PNGs are the WebGL-consumable
 * stand-in (same R8 SDF encoding a Blender heightfield bake would export).
 */

import type { DripControl, DripEmitterSpec } from "./DripSim.js";
import type { MaterialPartial } from "../api/Material.js";
import { presets } from "../presets/index.js";

export type GlyphId = "chromeSansP" | "scriptProP";

export type GlyphProfile = {
  id: GlyphId;
  label: string;
  /** Concept-art reference filename under demo/qa-refs/ or landing public. */
  refImage: string;
  refCaption: string;
  material: MaterialPartial;
  dripControl: DripControl;
};

const chromeEmitters: DripEmitterSpec[] = [
  {
    x: -0.14,
    intensity: 1,
    viscosity: 0.84,
    phaseOffset: 0.05,
    stretchScale: 1.55,
    locked: true,
    startInStretch: true,
    stretchT: 0.82,
  },
  {
    x: -0.14,
    intensity: 0.7,
    viscosity: 0.76,
    phaseOffset: 0.42,
    stretchScale: 0.0,
    locked: true,
    startInStretch: true,
    stretchT: 0.92,
  },
  {
    x: -0.14,
    intensity: 0.42,
    viscosity: 0.66,
    phaseOffset: 0.7,
    stretchScale: 0.0,
    locked: true,
    startInStretch: true,
    stretchT: 0.98,
  },
];

const scriptEmitters: DripEmitterSpec[] = [
  {
    x: -0.06,
    intensity: 1,
    viscosity: 0.9,
    phaseOffset: 0.1,
    stretchScale: 1.75,
    locked: true,
    startInStretch: true,
    stretchT: 0.88,
  },
  {
    x: -0.06,
    intensity: 0.62,
    viscosity: 0.72,
    phaseOffset: 0.55,
    stretchScale: 0.0,
    locked: true,
    startInStretch: true,
    stretchT: 0.95,
  },
  {
    x: -0.06,
    intensity: 0.42,
    viscosity: 0.65,
    phaseOffset: 0.72,
    stretchScale: 0.0,
    locked: true,
    startInStretch: true,
    stretchT: 0.98,
  },
];

/** Block chrome sans "p" — pendant from stem bottom (Z53Ve / 1c6PD). */
export const chromeSansP: GlyphProfile = {
  id: "chromeSansP",
  label: "chrome sans · p",
  refImage: "1c6PD.jpg",
  refCaption: "1c6PD / Z53Ve — geometric chrome melt",
  material: {
    ...presets.chromeDrip,
    liquify: 0.12,
    drip: 0.88,
    viscosity: 0.84,
    dispersion: 0.9,
    filmThickness: 0.16,
    bevel: 0.96,
    blur: 0.012,
    cornerRadius: 0.18,
    specular: 1,
    ior: 1.68,
    lightPosition: { x: -0.62, y: 0.82, z: 0.95 },
    lightIntensity: 2.55,
  },
  dripControl: {
    mode: "controlled",
    isolate: true,
    deterministic: true,
    freeze: true,
    attachY: -0.28,
    emitters: chromeEmitters,
  },
};

/** Script molten "p" — long neck + teardrop (ENj9B ".pro"). */
export const scriptProP: GlyphProfile = {
  id: "scriptProP",
  label: "script pro · p",
  refImage: "ENj9B.jpg",
  refCaption: "ENj9B — molten magenta script drip",
  material: {
    ...presets.chromeDrip,
    liquify: 0.18,
    drip: 0.92,
    viscosity: 0.9,
    dispersion: 0.92,
    filmThickness: 0.18,
    bevel: 0.9,
    blur: 0.014,
    cornerRadius: 0.22,
    specular: 1,
    ior: 1.6,
    lightPosition: { x: -0.55, y: 0.74, z: 0.92 },
    lightIntensity: 2.35,
  },
  dripControl: {
    mode: "controlled",
    isolate: true,
    deterministic: true,
    freeze: true,
    attachY: -0.32,
    emitters: scriptEmitters,
  },
};

export const GLYPH_PROFILES: Record<GlyphId, GlyphProfile> = {
  chromeSansP,
  scriptProP,
};

export function getGlyphProfile(id: GlyphId): GlyphProfile {
  return GLYPH_PROFILES[id];
}
