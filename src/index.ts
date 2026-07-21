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

export { DEFAULT_MATERIAL, resolveMaterial, clampMaterial } from "./api/Material.js";
export { presets } from "./presets/index.js";
export { supportsWebGL2, prefersReducedMotion } from "./core/gl.js";
