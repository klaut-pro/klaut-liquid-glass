/**
 * Live backdrop capture for glassify.
 * Prefer page-themed atmospheric fill; attempt SVG foreignObject when safe.
 */

export type CaptureOptions = {
  exclude?: HTMLElement | null;
  maxSize?: number;
};

export async function captureBackdrop(
  target: HTMLElement,
  opts: CaptureOptions = {},
): Promise<HTMLCanvasElement> {
  const maxSize = opts.maxSize ?? 1024;
  const rect = target.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.max(1, Math.round(rect.width * dpr));
  const h = Math.max(1, Math.round(rect.height * dpr));
  const scale = Math.min(1, maxSize / Math.max(w, h));
  const cw = Math.max(1, Math.round(w * scale));
  const ch = Math.max(1, Math.round(h * scale));

  const canvas = document.createElement("canvas");
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;

  // Always seed with themed atmosphere (reliable refraction target)
  paintPageThemedBackdrop(ctx, cw, ch);

  try {
    await captureViaForeignObject(ctx, rect, cw, ch, opts.exclude ?? null);
  } catch {
    // themed fill already present
  }

  return canvas;
}

function cssVar(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

function paintPageThemedBackdrop(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
): void {
  const bg = cssVar("--klaut-bg", getComputedStyle(document.body).backgroundColor || "#0a0c10");
  const accent = cssVar("--klaut-accent", "#5ec8ff");
  const accent2 = cssVar("--klaut-accent-2", "#ff6ab0");
  const surface = cssVar("--klaut-surface", "#152238");

  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, bg);
  g.addColorStop(0.4, surface);
  g.addColorStop(1, bg);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  const blobs: [number, number, string][] = [
    [0.2, 0.25, accent],
    [0.75, 0.55, accent2],
    [0.5, 0.8, accent],
    [0.85, 0.2, accent2],
  ];
  for (const [nx, ny, color] of blobs) {
    const x = w * nx;
    const y = h * ny;
    const r = Math.min(w, h) * 0.35;
    const rg = ctx.createRadialGradient(x, y, 0, x, y, r);
    rg.addColorStop(0, withAlpha(color, 0.45));
    rg.addColorStop(0.55, withAlpha(color, 0.12));
    rg.addColorStop(1, withAlpha(color, 0));
    ctx.fillStyle = rg;
    ctx.fillRect(0, 0, w, h);
  }
}

function withAlpha(color: string, a: number): string {
  if (color.startsWith("#")) {
    let hex = color.slice(1);
    if (hex.length === 3) {
      hex = hex.split("").map((c) => c + c).join("");
    }
    if (hex.length >= 6) {
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      return `rgba(${r},${g},${b},${a})`;
    }
  }
  if (color.startsWith("rgb")) {
    return color.replace(/rgba?\(([^)]+)\)/, (_, inner: string) => {
      const parts = inner.split(",").map((p) => p.trim());
      return `rgba(${parts[0]},${parts[1]},${parts[2]},${a})`;
    });
  }
  return color;
}

async function captureViaForeignObject(
  ctx: CanvasRenderingContext2D,
  rect: DOMRect,
  cw: number,
  ch: number,
  exclude: HTMLElement | null,
): Promise<boolean> {
  const width = Math.max(1, Math.round(rect.width));
  const height = Math.max(1, Math.round(rect.height));
  const root = document.documentElement;
  const clone = root.cloneNode(true) as HTMLElement;

  clone.querySelectorAll("script").forEach((n) => n.remove());
  if (exclude) {
    const mark = exclude.getAttribute("data-liquid-glass-id");
    if (mark) {
      clone.querySelectorAll(`[data-liquid-glass-id="${mark}"]`).forEach((n) => {
        (n as HTMLElement).style.visibility = "hidden";
      });
    }
  }
  clone.querySelectorAll("canvas[data-liquid-glass-canvas]").forEach((n) => {
    (n as HTMLElement).style.display = "none";
  });

  const xhtml = new XMLSerializer().serializeToString(clone);
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
  <foreignObject width="100%" height="100%" x="0" y="0">
    <div xmlns="http://www.w3.org/1999/xhtml" style="width:${root.clientWidth}px;height:${root.clientHeight}px;transform:translate(${-rect.left}px,${-rect.top}px);">
      ${xhtml}
    </div>
  </foreignObject>
</svg>`;

  const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  try {
    const img = await loadImage(url);
    ctx.globalAlpha = 0.85;
    ctx.drawImage(img, 0, 0, cw, ch);
    ctx.globalAlpha = 1;
    return true;
  } catch {
    return false;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("backdrop image load failed"));
    img.src = url;
  });
}

export function createFallbackBackdrop(
  width: number,
  height: number,
): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = Math.max(1, width);
  c.height = Math.max(1, height);
  const ctx = c.getContext("2d");
  if (ctx) paintPageThemedBackdrop(ctx, c.width, c.height);
  return c;
}

/**
 * Planar wet-mirror studio plate fallback (when baked HDRI missing).
 * Soft elliptical softboxes + lime/gold oil puddles — NO vertical barcode strips.
 */
export function createChromeStudioBackdrop(
  width: number,
  height: number,
): HTMLCanvasElement {
  const scale = 3;
  const c = document.createElement("canvas");
  c.width = Math.max(2, Math.round(width * scale));
  c.height = Math.max(2, Math.round(height * scale));
  const ctx = c.getContext("2d");
  if (!ctx) return c;
  const w = c.width;
  const h = c.height;

  ctx.fillStyle = "#050506";
  ctx.fillRect(0, 0, w, h);

  const softEllipsis = (
    cx: number,
    cy: number,
    rx: number,
    ry: number,
    rgb: string,
    alpha: number,
  ) => {
    const rg = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(rx, ry));
    rg.addColorStop(0, `rgba(${rgb},${alpha})`);
    rg.addColorStop(0.55, `rgba(${rgb},${alpha * 0.45})`);
    rg.addColorStop(1, `rgba(${rgb},0)`);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(rx / Math.max(ry, 1), 1);
    ctx.fillStyle = rg;
    ctx.beginPath();
    ctx.arc(0, 0, ry, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  };

  softEllipsis(w * 0.28, h * 0.18, w * 0.38, h * 0.22, "248,250,255", 0.95);
  softEllipsis(w * 0.62, h * 0.16, w * 0.34, h * 0.2, "232,236,244", 0.85);
  softEllipsis(w * 0.45, h * 0.42, w * 0.48, h * 0.32, "190,198,210", 0.7);
  softEllipsis(w * 0.22, h * 0.55, w * 0.3, h * 0.28, "168,176,188", 0.6);
  softEllipsis(w * 0.78, h * 0.5, w * 0.28, h * 0.3, "175,182,192", 0.58);
  softEllipsis(w * 0.55, h * 0.35, w * 0.32, h * 0.24, "78,220,72", 0.55);
  softEllipsis(w * 0.4, h * 0.62, w * 0.3, h * 0.22, "225,195,52", 0.5);
  softEllipsis(w * 0.75, h * 0.28, w * 0.22, h * 0.18, "95,210,70", 0.4);
  softEllipsis(w * 0.68, h * 0.7, w * 0.26, h * 0.2, "210,175,45", 0.38);

  const ceil = ctx.createLinearGradient(0, h * 0.08, 0, h * 0.22);
  ceil.addColorStop(0, "rgba(250,252,255,0)");
  ceil.addColorStop(0.5, "rgba(250,252,255,0.35)");
  ceil.addColorStop(1, "rgba(250,252,255,0)");
  ctx.fillStyle = ceil;
  ctx.fillRect(0, h * 0.08, w, h * 0.14);

  return c;
}
