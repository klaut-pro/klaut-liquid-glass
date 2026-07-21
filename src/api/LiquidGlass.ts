import { LiquidGlassEngine, type EngineOptions, type GlassifyOptions, type GlassSurface } from "./Glassify.js";
import type { Material, MaterialPartial } from "./Material.js";
import { DEFAULT_MATERIAL, resolveMaterial, clampMaterial } from "./Material.js";
import { lightFromOrbit, orbitFromLight, presets, type PresetName } from "../presets/index.js";
import { supportsWebGL2, prefersReducedMotion } from "../core/gl.js";

export type { Material, MaterialPartial, GlassSurface, GlassifyOptions, EngineOptions, PresetName };

export const LiquidGlass = {
  presets,
  DEFAULT_MATERIAL,
  resolveMaterial,
  clampMaterial,
  lightFromOrbit,
  orbitFromLight,
  supportsWebGL2,
  prefersReducedMotion,

  create(opts?: EngineOptions): LiquidGlassEngine {
    return new LiquidGlassEngine(opts);
  },

  /** Convenience: one-shot glassify with auto-started engine. */
  glassify(el: HTMLElement, material?: GlassifyOptions): {
    engine: LiquidGlassEngine;
    surface: GlassSurface;
  } {
    const engine = new LiquidGlassEngine();
    const surface = engine.glassify(el, material);
    engine.start();
    return { engine, surface };
  },
};

export { LiquidGlassEngine };
export type LiquidGlassStatic = typeof LiquidGlass;
