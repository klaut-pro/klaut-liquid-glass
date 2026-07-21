import type { DripControl } from "../field/DripSim.js";
import type { GlyphId } from "../field/GlyphProfiles.js";

/** Field geometry mode for a glass surface. */
export type FieldMode = "pane" | "glyph";

export type GlyphOptions = {
  /** pane = rounded rect (default); glyph = letterform SDF. */
  fieldMode?: FieldMode;
  /** Which concept-art letterform to shade. */
  glyphId?: GlyphId;
  /** Controlled drip sim (per-glyph emitters, isolate). */
  dripControl?: DripControl;
};

export const DEFAULT_GLYPH_OPTIONS: Required<Pick<GlyphOptions, "fieldMode">> = {
  fieldMode: "pane",
};
