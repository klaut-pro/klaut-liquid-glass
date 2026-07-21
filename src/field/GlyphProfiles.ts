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

/** Single mid-stretch pendant — viscous neck + bulb (no detached free blobs). */
const chromeEmitters: DripEmitterSpec[] = [
  {
    x: -0.14,
    intensity: 1,
    viscosity: 0.93,
    phaseOffset: 0.05,
    stretchScale: 1.55,
    locked: true,
    startInStretch: true,
    stretchT: 0.62,
  },
];

const scriptEmitters: DripEmitterSpec[] = [
  {
    x: -0.08,
    intensity: 1,
    viscosity: 0.97,
    phaseOffset: 0.1,
    stretchScale: 1.85,
    locked: true,
    startInStretch: true,
    stretchT: 0.68,
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
    liquify: 0.06,
    drip: 0.98,
    viscosity: 0.93,
    dispersion: 1,
    filmThickness: 0.45,
    bevel: 1,
    blur: 0.008,
    cornerRadius: 0.18,
    specular: 1,
    ior: 1.7,
    lightPosition: { x: -0.74, y: 0.92, z: 1.15 },
    lightIntensity: 4.15,
  },
  dripControl: {
    mode: "controlled",
    isolate: true,
    deterministic: true,
    freeze: true,
    // Stem lip near atlas bottom (fieldExtent 0.55)
    attachY: -0.34,
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
    liquify: 0.07,
    drip: 1,
    viscosity: 0.97,
    dispersion: 1,
    filmThickness: 0.52,
    bevel: 1,
    blur: 0.008,
    cornerRadius: 0.22,
    specular: 1,
    ior: 1.65,
    lightPosition: { x: -0.58, y: 0.88, z: 1.12 },
    lightIntensity: 4.0,
  },
  dripControl: {
    mode: "controlled",
    isolate: true,
    deterministic: true,
    freeze: true,
    attachY: -0.36,
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
