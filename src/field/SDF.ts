/** Quilez-style SDF helpers mirrored in shade/shaders.ts (CPU utilities). */

export function sdRoundBox(px: number, py: number, bx: number, by: number, r: number): number {
  const qx = Math.abs(px) - bx + r;
  const qy = Math.abs(py) - by + r;
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
  const inside = Math.min(Math.max(qx, qy), 0);
  return outside + inside - r;
}

export function softMin(a: number, b: number, k: number): number {
  const kk = Math.max(k, 1e-4);
  const h = Math.min(1, Math.max(0, 0.5 + (0.5 * (b - a)) / kk));
  return b * (1 - h) + a * h - kk * h * (1 - h);
}
