/**
 * Runtime loaders for concept-art faceplates projected onto glyph atlas UVs.
 * Baked by scripts/bake-concept-faceplates.py → demo/env/face-*.png
 */

import type { GlyphAtlasId } from "./glyphAtlases.js";

const imageCache = new Map<GlyphAtlasId, HTMLImageElement>();
const inflight = new Map<GlyphAtlasId, Promise<HTMLImageElement>>();

const CANDIDATES: Record<GlyphAtlasId, string[]> = {
  chromeSansP: [
    "./env/face-chromeSansP.png",
    "/demo/env/face-chromeSansP.png",
    "demo/env/face-chromeSansP.png",
  ],
  scriptProP: [
    "./env/face-scriptProP.png",
    "/demo/env/face-scriptProP.png",
    "demo/env/face-scriptProP.png",
  ],
};

function tryLoad(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => {
      if (img.naturalWidth > 8) resolve(img);
      else reject(new Error(`empty ${src}`));
    };
    img.onerror = () => reject(new Error(`fail ${src}`));
    img.src = src;
  });
}

export async function loadConceptFaceImage(id: GlyphAtlasId): Promise<HTMLImageElement> {
  const hit = imageCache.get(id);
  if (hit?.complete && hit.naturalWidth > 0) return hit;

  const pending = inflight.get(id);
  if (pending) return pending;

  const p = (async () => {
    let lastErr: unknown;
    for (const src of CANDIDATES[id]) {
      try {
        const img = await tryLoad(src);
        imageCache.set(id, img);
        return img;
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr ?? new Error(`concept faceplate missing for ${id}`);
  })().finally(() => {
    inflight.delete(id);
  });

  inflight.set(id, p);
  return p;
}
