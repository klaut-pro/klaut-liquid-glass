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
 * Hard softbox cores as fillRect strips — wet-mirror bars survive LINEAR filter
 * + tone-map; soft colored ambient is separate so faces don't crush to black.
 */
export function createChromeStudioBackdrop(
  width: number,
  height: number,
): HTMLCanvasElement {
  // Upsize plate so knife-edge cores stay sharp after LINEAR sampling
  const scale = 2;
  const c = document.createElement("canvas");
  c.width = Math.max(2, Math.round(width * scale));
  c.height = Math.max(2, Math.round(height * scale));
  const ctx = c.getContext("2d");
  if (!ctx) return c;
  const w = c.width;
  const h = c.height;

  ctx.fillStyle = "#020206";
  ctx.fillRect(0, 0, w, h);

  // Soft colored ambient ONLY (no white) — midtone fill without milking bars
  const ambL = ctx.createLinearGradient(w * 0.18, 0, w * 0.42, 0);
  ambL.addColorStop(0, "rgba(0,0,0,0)");
  ambL.addColorStop(0.5, "rgba(90,140,200,0.14)");
  ambL.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = ambL;
  ctx.fillRect(0, 0, w, h);

  const ambR = ctx.createLinearGradient(w * 0.62, 0, w * 0.88, 0);
  ambR.addColorStop(0, "rgba(0,0,0,0)");
  ambR.addColorStop(0.5, "rgba(160,60,140,0.11)");
  ambR.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = ambR;
  ctx.fillRect(0, 0, w, h);

  // Top-left cool key (soft, colored — not a white wash)
  const key = ctx.createRadialGradient(
    w * 0.14,
    h * 0.08,
    0,
    w * 0.14,
    h * 0.08,
    Math.min(w, h) * 0.38,
  );
  key.addColorStop(0, "rgba(180,220,255,0.45)");
  key.addColorStop(0.35, "rgba(100,170,230,0.16)");
  key.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = key;
  ctx.fillRect(0, 0, w, h);

  // Magenta fill pocket
  const fill = ctx.createRadialGradient(
    w * 0.9,
    h * 0.74,
    0,
    w * 0.9,
    h * 0.74,
    Math.min(w, h) * 0.48,
  );
  fill.addColorStop(0, "rgba(255,50,180,0.32)");
  fill.addColorStop(0.5, "rgba(120,25,140,0.1)");
  fill.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = fill;
  ctx.fillRect(0, 0, w, h);

  // Cyan rim pocket
  const rim = ctx.createRadialGradient(
    w * 0.5,
    h * 0.36,
    0,
    w * 0.5,
    h * 0.36,
    Math.min(w, h) * 0.28,
  );
  rim.addColorStop(0, "rgba(40,255,230,0.18)");
  rim.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = rim;
  ctx.fillRect(0, 0, w, h);

  /** Knife-edge vertical softbox: 1px soft shoulder + hard core. */
  const knifeV = (cx: number, coreW: number, shoulder: number, rgb: string, aCore: number, aShoulder: number) => {
    const x0 = Math.max(0, Math.floor(cx - coreW / 2 - shoulder));
    const x1 = Math.min(w, Math.ceil(cx + coreW / 2 + shoulder));
    if (x1 <= x0) return;
    const g = ctx.createLinearGradient(x0, 0, x1, 0);
    const tCore0 = shoulder / Math.max(1, x1 - x0);
    const tCore1 = (shoulder + coreW) / Math.max(1, x1 - x0);
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(Math.max(0, tCore0 - 0.001), `rgba(${rgb},${aShoulder})`);
    g.addColorStop(tCore0, `rgba(${rgb},${aCore})`);
    g.addColorStop(tCore1, `rgba(${rgb},${aCore})`);
    g.addColorStop(Math.min(1, tCore1 + 0.001), `rgba(${rgb},${aShoulder})`);
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    // Absolute hard core (survives LINEAR blur)
    const hx = Math.floor(cx - coreW / 2);
    ctx.fillStyle = `rgba(${rgb},${Math.min(1, aCore)})`;
    ctx.fillRect(hx, 0, Math.max(1, Math.ceil(coreW)), h);
  };

  // Primary + secondary + tertiary wet-mirror softboxes (concept 1c6PD / Z53Ve)
  knifeV(w * 0.30, Math.max(2, w * 0.006), Math.max(2, w * 0.01), "255,252,248", 1.0, 0.35);
  knifeV(w * 0.71, Math.max(2, w * 0.0045), Math.max(2, w * 0.008), "200,230,255", 0.92, 0.28);
  knifeV(w * 0.18, Math.max(1, w * 0.0035), Math.max(1, w * 0.007), "255,180,240", 0.55, 0.18);
  knifeV(w * 0.48, Math.max(1, w * 0.0028), Math.max(1, w * 0.006), "120,255,250", 0.5, 0.15);

  // Horizontal strip — thin hard core
  {
    const cy = h * 0.25;
    const coreH = Math.max(2, h * 0.005);
    const sh = Math.max(2, h * 0.012);
    const y0 = Math.floor(cy - coreH / 2 - sh);
    const y1 = Math.ceil(cy + coreH / 2 + sh);
    const g = ctx.createLinearGradient(0, y0, 0, y1);
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(0.35, "rgba(255,245,255,0.2)");
    g.addColorStop(0.48, "rgba(255,255,255,0.85)");
    g.addColorStop(0.52, "rgba(255,255,255,0.85)");
    g.addColorStop(0.65, "rgba(255,245,255,0.2)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "rgba(255,255,255,0.95)";
    ctx.fillRect(0, Math.floor(cy - coreH / 2), w, Math.max(1, Math.ceil(coreH)));
  }

  return c;
}
