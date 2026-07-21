/** Metaball field helpers (CPU); GPU path lives in shade/shaders.ts. */

export type Blob = { x: number; y: number; r: number; weight: number };

export function metaballContribution(px: number, py: number, blob: Blob): number {
  const dx = px - blob.x;
  const dy = py - blob.y;
  const d2 = Math.max(dx * dx + dy * dy, 1e-4);
  return (blob.weight * blob.r * blob.r) / d2;
}

export function sumMetaballs(px: number, py: number, blobs: Blob[]): number {
  let field = 0;
  for (const b of blobs) field += metaballContribution(px, py, b);
  return field;
}

/**
 * Seed drip blobs along the bottom edge of a pane (medial-axis approximation).
 */
export function seedDripBlobs(
  halfW: number,
  halfH: number,
  liquify: number,
  drip: number,
  time: number,
  count = 8,
): Blob[] {
  const blobs: Blob[] = [];
  const minDim = Math.min(halfW, halfH);
  for (let i = 0; i < count; i++) {
    const nx = (i - (count - 1) / 2) / (count / 2);
    const seed = ((i * 17) % 10) / 10;
    const wobble = Math.sin(time * (1.2 + seed) + i * 1.7) * 0.08 * liquify;
    blobs.push({
      x: nx * halfW * 0.85 + wobble,
      y: -halfH * (0.35 + 0.45 * liquify) + Math.sin(time * 0.9 + i) * 0.06 * liquify,
      r: (0.08 + seed * 0.14) * (0.35 + liquify) * minDim,
      weight: liquify,
    });
    if (drip > 0.001) {
      const fall = (time * (0.15 + seed * 0.25) + seed) % 1;
      blobs.push({
        x: nx * halfW * 0.7 + Math.sin(time + i) * 0.04,
        y: halfH * 0.2 * (1 - fall) + -halfH * 1.35 * fall,
        r: (0.04 + seed * 0.06) * drip * minDim,
        weight: drip * Math.min(1, fall / 0.15) * Math.max(0, (1 - fall) / 0.3),
      });
    }
  }
  return blobs;
}
