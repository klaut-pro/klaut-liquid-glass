export {
  LiquidGlass,
  LiquidGlassEngine,
  type LiquidGlassStatic,
  type Material,
  type MaterialPartial,
  type GlassSurface,
  type GlassifyOptions,
  type EngineOptions,
  type PresetName,
} from "./api/LiquidGlass.js";

export { DEFAULT_MATERIAL, resolveMaterial, clampMaterial, DEFAULT_LIGHT, type Vec3 } from "./api/Material.js";
export { presets, lightFromOrbit, orbitFromLight } from "./presets/index.js";
export { supportsWebGL2, prefersReducedMotion } from "./core/gl.js";
export {
  DripSim,
  MAX_DRIP_BLOBS,
  viscosityMaps,
  type DripBlob,
  type DripControl,
  type DripEmitterSpec,
  type DripViscosityMaps,
} from "./field/DripSim.js";
export {
  GravityMeltSim,
  meltViscosityMaps,
  buildHoneyTipCapsuleBuffers,
  weldHoneyTipIntoLetter,
  honeyPendantRadius,
  honeyPendantY,
  honeyPendantPoint,
  type MeltViscosityMaps,
  type GravityMeltParams,
  type GravityMeltStatus,
  type LetterMeltOverride,
  type HoneyTipCapsuleSpec,
  type HoneyTipCapsuleBuffers,
  type WeldHoneyTipOpts,
  type WeldHoneyTipResult,
} from "./field/GravityMeltSim.js";
export { softMin, sdRoundBox } from "./field/SDF.js";
export {
  GLYPH_PROFILES,
  getGlyphProfile,
  chromeSansP,
  scriptProP,
  type GlyphId,
  type GlyphProfile,
} from "./field/GlyphProfiles.js";
export {
  GLYPH_ATLASES,
  glyphAtlasDataUrl,
  type GlyphAtlas,
  type GlyphAtlasId,
} from "./field/glyphAtlases.js";
export { preloadGlyphAtlases, getGlyphAtlasMeta } from "./field/GlyphAtlasRuntime.js";
export type { FieldMode, GlyphOptions } from "./api/GlyphOptions.js";
