/**
 * Concept-art letterform profiles for isolated glyph QA.
 *
 * Targets (iteration 1):
 * - chromeSansP — block geometric "p" (refs: 1c6PD.jpg, Z53Ve.jpg)
 * - scriptProP  — molten script "p" (ref: ENj9B.jpg ".pro" stroke)
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
    x: -0.12,
    intensity: 1,
    viscosity: 0.8,
    phaseOffset: 0.05,
    stretchScale: 1.25,
    locked: true,
    startInStretch: true,
    stretchT: 0.62,
  },
];

const scriptEmitters: DripEmitterSpec[] = [
  {
    x: -0.14,
    intensity: 1,
    viscosity: 0.88,
    phaseOffset: 0.1,
    stretchScale: 1.45,
    locked: true,
    startInStretch: true,
    stretchT: 0.7,
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
    liquify: 0.35,
    drip: 0.85,
    viscosity: 0.8,
    dispersion: 0.9,
    filmThickness: 0.48,
    bevel: 0.88,
    blur: 0.05,
    cornerRadius: 0.22,
    specular: 1,
    lightPosition: { x: -0.55, y: 0.75, z: 0.9 },
    lightIntensity: 2.0,
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
    liquify: 0.4,
    drip: 0.95,
    viscosity: 0.88,
    dispersion: 0.95,
    filmThickness: 0.55,
    bevel: 0.85,
    blur: 0.04,
    cornerRadius: 0.28,
    specular: 1,
    lightPosition: { x: -0.48, y: 0.68, z: 0.88 },
    lightIntensity: 1.95,
  },
  dripControl: {
    mode: "controlled",
    isolate: true,
    deterministic: true,
    freeze: true,
    attachY: -0.26,
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
