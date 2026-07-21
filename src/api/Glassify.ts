import {
  clampMaterial,
  resolveMaterial,
  type Material,
  type MaterialPartial,
} from "./Material.js";
import { Renderer, motionFrozen } from "../core/Renderer.js";
import { supportsWebGL2 } from "../core/gl.js";
import {
  captureBackdrop,
  createFallbackBackdrop,
} from "../capture/BackdropCapture.js";
import { applyCssFallback } from "../fallback/CssFallback.js";

let idCounter = 0;

export type GlassSurface = {
  readonly el: HTMLElement;
  readonly canvas: HTMLCanvasElement | null;
  readonly mode: "webgl" | "css";
  get(): Material;
  set(partial: MaterialPartial): void;
  refreshBackdrop(): Promise<void>;
  destroy(): void;
};

export type GlassifyOptions = MaterialPartial & {
  /** How often to recapture backdrop (ms). 0 = only on resize/scroll settle. */
  captureIntervalMs?: number;
};

export type EngineOptions = {
  root?: HTMLElement | Document;
  /** Hard cap guidance — warn in console when exceeded. */
  maxSurfaces?: number;
};

type InternalSurface = {
  id: string;
  el: HTMLElement;
  material: Material;
  canvas: HTMLCanvasElement | null;
  renderer: Renderer | null;
  mode: "webgl" | "css";
  disposeFallback: (() => void) | null;
  wrapper: HTMLElement | null;
  captureIntervalMs: number;
  lastCapture: number;
  destroyed: boolean;
};

/**
 * Live-DOM glassify: overlay WebGL canvas (or CSS fallback) on a real element.
 */
export class LiquidGlassEngine {
  readonly root: HTMLElement | Document;
  readonly maxSurfaces: number;
  private surfaces: InternalSurface[] = [];
  private raf = 0;
  private running = false;
  private startTime = 0;
  private onScroll: (() => void) | null = null;
  private onResize: (() => void) | null = null;
  private scrollTimer = 0;

  constructor(opts: EngineOptions = {}) {
    this.root = opts.root ?? (typeof document !== "undefined" ? document.body : (null as unknown as HTMLElement));
    this.maxSurfaces = opts.maxSurfaces ?? 3;
  }

  glassify(el: HTMLElement, material?: GlassifyOptions): GlassSurface {
    if (this.surfaces.length >= this.maxSurfaces) {
      console.warn(
        `[klaut-liquid-glass] Cap ≤${this.maxSurfaces} live surfaces for FPS. Consider baking decorative loops.`,
      );
    }

    const id = `lg-${++idCounter}`;
    el.setAttribute("data-liquid-glass-id", id);

    const mat = clampMaterial(resolveMaterial(material));
    const captureIntervalMs = material?.captureIntervalMs ?? 1200;

    const surface: InternalSurface = {
      id,
      el,
      material: mat,
      canvas: null,
      renderer: null,
      mode: "webgl",
      disposeFallback: null,
      wrapper: null,
      captureIntervalMs,
      lastCapture: 0,
      destroyed: false,
    };

    if (!supportsWebGL2()) {
      surface.mode = "css";
      surface.disposeFallback = applyCssFallback(el, mat);
    } else {
      this.mountWebGL(surface);
    }

    this.surfaces.push(surface);
    void this.refreshSurface(surface);

    const api: GlassSurface = {
      el,
      get canvas() {
        return surface.canvas;
      },
      get mode() {
        return surface.mode;
      },
      get: () => ({ ...surface.material }),
      set: (partial) => {
        surface.material = clampMaterial({ ...surface.material, ...partial });
        if (surface.mode === "css") {
          surface.disposeFallback?.();
          surface.disposeFallback = applyCssFallback(el, surface.material);
        }
      },
      refreshBackdrop: () => this.refreshSurface(surface),
      destroy: () => this.destroySurface(surface),
    };

    return api;
  }

  private mountWebGL(surface: InternalSurface): void {
    const el = surface.el;
    const style = getComputedStyle(el);
    if (style.position === "static") {
      el.style.position = "relative";
    }

    const canvas = document.createElement("canvas");
    canvas.setAttribute("data-liquid-glass-canvas", "1");
    canvas.setAttribute("aria-hidden", "true");
    Object.assign(canvas.style, {
      position: "absolute",
      inset: "0",
      width: "100%",
      height: "100%",
      pointerEvents: "none",
      zIndex: "0",
      borderRadius: style.borderRadius || "inherit",
    } as CSSStyleDeclaration);

    // Ensure content stays above glass overlay for a11y / clicks
    Array.from(el.children).forEach((child) => {
      const node = child as HTMLElement;
      if (node.style) {
        if (!node.style.position || node.style.position === "static") {
          node.style.position = "relative";
        }
        if (!node.style.zIndex) node.style.zIndex = "1";
      }
    });

    el.insertBefore(canvas, el.firstChild);
    surface.canvas = canvas;

    try {
      surface.renderer = new Renderer(canvas);
    } catch {
      canvas.remove();
      surface.canvas = null;
      surface.mode = "css";
      surface.disposeFallback = applyCssFallback(el, surface.material);
    }
  }

  private async refreshSurface(surface: InternalSurface): Promise<void> {
    if (surface.destroyed || surface.mode !== "webgl" || !surface.renderer || !surface.canvas) {
      return;
    }
    const rect = surface.el.getBoundingClientRect();
    surface.renderer.resize(rect.width, rect.height);

    // Hide canvas during capture so we don't refract ourselves
    surface.canvas.style.visibility = "hidden";
    try {
      const shot = await captureBackdrop(surface.el, { exclude: surface.el });
      surface.renderer.setBackdrop(shot);
    } catch {
      const fb = createFallbackBackdrop(
        surface.canvas.width || 256,
        surface.canvas.height || 256,
      );
      surface.renderer.setBackdrop(fb);
    } finally {
      surface.canvas.style.visibility = "visible";
      surface.lastCapture = performance.now();
    }
  }

  private destroySurface(surface: InternalSurface): void {
    if (surface.destroyed) return;
    surface.destroyed = true;
    surface.renderer?.dispose();
    surface.canvas?.remove();
    surface.disposeFallback?.();
    surface.el.removeAttribute("data-liquid-glass-id");
    this.surfaces = this.surfaces.filter((s) => s !== surface);
    if (this.surfaces.length === 0) this.stop();
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.startTime = performance.now();

    this.onScroll = () => {
      window.clearTimeout(this.scrollTimer);
      this.scrollTimer = window.setTimeout(() => {
        for (const s of this.surfaces) void this.refreshSurface(s);
      }, 120);
    };
    this.onResize = () => {
      for (const s of this.surfaces) void this.refreshSurface(s);
    };
    window.addEventListener("scroll", this.onScroll, { passive: true });
    window.addEventListener("resize", this.onResize);

    const tick = (now: number) => {
      if (!this.running) return;
      const t = (now - this.startTime) / 1000;
      const reduced = motionFrozen() ? 1 : 0;

      for (const s of this.surfaces) {
        if (s.mode !== "webgl" || !s.renderer) continue;
        if (
          s.captureIntervalMs > 0 &&
          now - s.lastCapture > s.captureIntervalMs
        ) {
          void this.refreshSurface(s);
        }
        s.renderer.draw({
          ...s.material,
          time: reduced ? 0 : t,
          reducedMotion: reduced,
        });
      }
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
    if (this.onScroll) window.removeEventListener("scroll", this.onScroll);
    if (this.onResize) window.removeEventListener("resize", this.onResize);
    this.onScroll = null;
    this.onResize = null;
  }

  destroy(): void {
    [...this.surfaces].forEach((s) => this.destroySurface(s));
    this.stop();
  }

  getSurfaceCount(): number {
    return this.surfaces.length;
  }
}
