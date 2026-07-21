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
 * Knife-edge studio HDRI plate for glyph QA (Blender bake unavailable).
 * Hard softbox cores as fillRect strips — wet-mirror bars for NEAREST sampling;
 * soft colored ambient is separate so faces don't crush to black / milk bars.
 */
export function createChromeStudioBackdrop(
  width: number,
  height: number,
): HTMLCanvasElement {
  // Upsize plate so knife-edge cores stay sharp
  const scale = 3;
  const c = document.createElement("canvas");
  c.width = Math.max(2, Math.round(width * scale));
  c.height = Math.max(2, Math.round(height * scale));
  const ctx = c.getContext("2d");
  if (!ctx) return c;
  const w = c.width;
  const h = c.height;

  ctx.fillStyle = "#010103";
  ctx.fillRect(0, 0, w, h);

  // Near-black ambient — wet chrome interstitial (not lavender fog)
  const ambL = ctx.createLinearGradient(0, 0, w * 0.35, 0);
  ambL.addColorStop(0, "rgba(0,0,0,0)");
  ambL.addColorStop(0.5, "rgba(40,55,70,0.04)");
  ambL.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = ambL;
  ctx.fillRect(0, 0, w, h);

  const ambR = ctx.createLinearGradient(w * 0.66, 0, w * 0.9, 0);
  ambR.addColorStop(0, "rgba(0,0,0,0)");
  ambR.addColorStop(0.5, "rgba(60,40,55,0.03)");
  ambR.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = ambR;
  ctx.fillRect(0, 0, w, h);

  const key = ctx.createRadialGradient(
    w * 0.12,
    h * 0.06,
    0,
    w * 0.12,
    h * 0.06,
    Math.min(w, h) * 0.28,
  );
  key.addColorStop(0, "rgba(180,200,220,0.14)");
  key.addColorStop(0.4, "rgba(70,100,130,0.05)");
  key.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = key;
  ctx.fillRect(0, 0, w, h);

  /** Absolute hard core only — knife-edge wet-mirror bars (no soft shoulder wash). */
  const knifeV = (cx: number, coreW: number, rgb: string) => {
    const hx = Math.floor(cx - coreW / 2);
    ctx.fillStyle = `rgb(${rgb})`;
    ctx.fillRect(hx, 0, Math.max(1, Math.ceil(coreW)), h);
  };

  /** Wide softbox panel — planar chrome mirror faces (1c6PD/Z53Ve). */
  const panelV = (cx: number, halfW: number, rgb: string) => {
    const x0 = Math.floor(cx - halfW);
    ctx.fillStyle = `rgb(${rgb})`;
    ctx.fillRect(x0, 0, Math.max(2, Math.ceil(halfW * 2)), h);
  };

  // Fewer, wider planar softbox panels (wet-mirror slabs — not dense pastel ribs)
  panelV(w * 0.18, Math.max(10, w * 0.022), "220,235,250");
  panelV(w * 0.36, Math.max(14, w * 0.032), "255,252,248");
  panelV(w * 0.54, Math.max(8, w * 0.018), "160,230,255");
  panelV(w * 0.7, Math.max(12, w * 0.028), "255,255,255");
  panelV(w * 0.86, Math.max(7, w * 0.016), "230,210,245");

  // Sparse knife cores on panel centers only
  knifeV(w * 0.18, Math.max(2, w * 0.0015), "255,255,255");
  knifeV(w * 0.36, Math.max(2, w * 0.002), "255,255,255");
  knifeV(w * 0.54, Math.max(1, w * 0.001), "200,245,255");
  knifeV(w * 0.7, Math.max(2, w * 0.0018), "255,255,255");
  knifeV(w * 0.86, Math.max(1, w * 0.001), "255,240,255");

  // Horizontal strip — hard core only
  {
    const cy = h * 0.24;
    const coreH = Math.max(2, h * 0.0015);
    ctx.fillStyle = "rgb(255,255,255)";
    ctx.fillRect(0, Math.floor(cy - coreH / 2), w, Math.max(1, Math.ceil(coreH)));
  }

  return c;
}
