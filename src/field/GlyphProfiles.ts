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
    x: -0.11,
    intensity: 1,
    viscosity: 0.82,
    phaseOffset: 0.05,
    stretchScale: 1.55,
    locked: true,
    startInStretch: true,
    stretchT: 0.74,
  },
  {
    x: -0.11,
    intensity: 0.72,
    viscosity: 0.75,
    phaseOffset: 0.42,
    stretchScale: 0.0,
    locked: true,
    startInStretch: true,
    stretchT: 0.92,
  },
];

const scriptEmitters: DripEmitterSpec[] = [
  {
    x: -0.03,
    intensity: 1,
    viscosity: 0.9,
    phaseOffset: 0.1,
    stretchScale: 1.75,
    locked: true,
    startInStretch: true,
    stretchT: 0.8,
  },
  {
    x: -0.03,
    intensity: 0.65,
    viscosity: 0.7,
    phaseOffset: 0.55,
    stretchScale: 0.0,
    locked: true,
    startInStretch: true,
    stretchT: 0.95,
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
    liquify: 0.28,
    drip: 0.9,
    viscosity: 0.82,
    dispersion: 0.88,
    filmThickness: 0.32,
    bevel: 0.92,
    blur: 0.03,
    cornerRadius: 0.22,
    specular: 1,
    ior: 1.56,
    lightPosition: { x: -0.58, y: 0.78, z: 0.92 },
    lightIntensity: 2.25,
  },
  dripControl: {
    mode: "controlled",
    isolate: true,
    deterministic: true,
    freeze: true,
    attachY: -0.3,
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
    liquify: 0.32,
    drip: 0.95,
    viscosity: 0.9,
    dispersion: 0.92,
    filmThickness: 0.36,
    bevel: 0.88,
    blur: 0.025,
    cornerRadius: 0.28,
    specular: 1,
    ior: 1.54,
    lightPosition: { x: -0.52, y: 0.72, z: 0.9 },
    lightIntensity: 2.1,
  },
  dripControl: {
    mode: "controlled",
    isolate: true,
    deterministic: true,
    freeze: true,
    attachY: -0.34,
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
