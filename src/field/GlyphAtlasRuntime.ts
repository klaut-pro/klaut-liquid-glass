/**
 * Runtime loaders for font-baked glyph SDF atlases.
 * Pipeline: TrueType outline → EDT SDF (scripts/bake-glyph-sdf.py).
 * Blender mesh bake can replace PNGs later with the same R8 encoding.
 */

import {
  GLYPH_ATLASES,
  glyphAtlasDataUrl,
  type GlyphAtlas,
  type GlyphAtlasId,
} from "./glyphAtlases.js";

const imageCache = new Map<GlyphAtlasId, HTMLImageElement>();
const inflight = new Map<GlyphAtlasId, Promise<HTMLImageElement>>();

export function getGlyphAtlasMeta(id: GlyphAtlasId): GlyphAtlas {
  return GLYPH_ATLASES[id];
}

export function loadGlyphAtlasImage(id: GlyphAtlasId): Promise<HTMLImageElement> {
  const hit = imageCache.get(id);
  if (hit?.complete && hit.naturalWidth > 0) return Promise.resolve(hit);

  const pending = inflight.get(id);
  if (pending) return pending;

  const p = new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => {
      imageCache.set(id, img);
      inflight.delete(id);
      resolve(img);
    };
    img.onerror = () => {
      inflight.delete(id);
      reject(new Error(`Failed to decode glyph atlas ${id}`));
    };
    img.src = glyphAtlasDataUrl(id);
  });
  inflight.set(id, p);
  return p;
}

export async function preloadGlyphAtlases(
  ids: GlyphAtlasId[] = ["chromeSansP", "scriptProP"],
): Promise<void> {
  await Promise.all(ids.map((id) => loadGlyphAtlasImage(id)));
}
