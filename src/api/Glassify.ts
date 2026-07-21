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
  createChromeStudioBackdrop,
} from "../capture/BackdropCapture.js";
import { applyCssFallback } from "../fallback/CssFallback.js";
import { DripSim, type DripBlob, type DripControl } from "../field/DripSim.js";
import type { FieldMode, GlyphOptions } from "./GlyphOptions.js";
import type { GlyphId } from "../field/GlyphProfiles.js";

let idCounter = 0;

export type GlassSurface = {
  readonly el: HTMLElement;
  readonly canvas: HTMLCanvasElement | null;
  readonly mode: "webgl" | "css";
  get(): Material;
  set(partial: MaterialPartial & GlyphOptions): void;
  refreshBackdrop(): Promise<void>;
  /** Capture current WebGL frame as PNG data URL (analysis / hyperframes). */
  captureFrame(): string | null;
  destroy(): void;
};

export type GlassifyOptions = MaterialPartial &
  GlyphOptions & {
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
  dripSim: DripSim;
  /** Smoothed blobs for temporal stability (lerp toward sim). */
  smoothBlobs: DripBlob[];
  capturing: boolean;
  lastW: number;
  lastH: number;
  fieldMode: FieldMode;
  glyphId: GlyphId | null;
  dripControl: DripControl | undefined;
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
  private lastTick = 0;
  private onScroll: (() => void) | null = null;
  private onResize: (() => void) | null = null;
  private scrollTimer = 0;
  private resizeTimer = 0;

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
    // 0 = no periodic recapture. Periodic texture swaps (~1–4s) caused visible flicker.
    // Recapture only on mount + debounced scroll/resize.
    const captureIntervalMs = material?.captureIntervalMs ?? 0;
    const fieldMode = material?.fieldMode ?? "pane";
    const glyphId = material?.glyphId ?? null;
    const dripControl = material?.dripControl;

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
      dripSim: new DripSim(dripControl?.emitters?.length ?? 5),
      smoothBlobs: [],
      capturing: false,
      lastW: 0,
      lastH: 0,
      fieldMode,
      glyphId,
      dripControl,
    };

    if (dripControl) surface.dripSim.setControl(dripControl);

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
      get: () => ({
        ...surface.material,
        lightPosition: { ...surface.material.lightPosition },
      }),
      set: (partial) => {
        const next = {
          ...surface.material,
          ...partial,
          lightPosition: {
            ...surface.material.lightPosition,
            ...(partial.lightPosition ?? {}),
          },
        };
        surface.material = clampMaterial(next);
        if (partial.fieldMode !== undefined) surface.fieldMode = partial.fieldMode;
        if (partial.glyphId !== undefined) surface.glyphId = partial.glyphId ?? null;
        if (partial.dripControl !== undefined) {
          surface.dripControl = partial.dripControl;
          surface.dripSim.setControl(partial.dripControl);
        }
        if (surface.mode === "css") {
          surface.disposeFallback?.();
          surface.disposeFallback = applyCssFallback(el, surface.material);
        }
      },
      refreshBackdrop: () => this.refreshSurface(surface, true),
      captureFrame: () => surface.renderer?.captureFrame() ?? null,
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

  /** Resize canvas to element — never touches backdrop texture (scroll-safe). */
  private syncLayout(surface: InternalSurface): void {
    if (surface.destroyed || surface.mode !== "webgl" || !surface.renderer || !surface.canvas) {
      return;
    }
    const rect = surface.el.getBoundingClientRect();
    const w = Math.round(rect.width);
    const h = Math.round(rect.height);
    if (w === surface.lastW && h === surface.lastH) return;
    surface.renderer.resize(rect.width, rect.height);
    surface.lastW = w;
    surface.lastH = h;
  }

  /**
   * Capture backdrop once (or when forced).
   * Periodic / scroll recaptures were the ~2s flicker: async texture swap
   * against a live canvas. Default path captures at mount only.
   */
  private async refreshSurface(surface: InternalSurface, force = false): Promise<void> {
    if (surface.destroyed || surface.mode !== "webgl" || !surface.renderer || !surface.canvas) {
      return;
    }
    if (surface.capturing) return;
    // Skip re-capture unless forced or never captured
    if (!force && surface.lastCapture > 0) {
      this.syncLayout(surface);
      return;
    }
    surface.capturing = true;
    this.syncLayout(surface);

    // Never hide the live canvas — visibility toggles caused hard flicker.
    try {
      if (surface.fieldMode === "glyph") {
        // Glyph QA: studio chrome plate — no muddy DOM capture wash
        const shot = createChromeStudioBackdrop(
          surface.canvas.width || 512,
          surface.canvas.height || 512,
        );
        surface.renderer.setBackdrop(shot, true);
      } else {
        const shot = await captureBackdrop(surface.el, { exclude: surface.el });
        if (!surface.destroyed && surface.renderer) {
          surface.renderer.setBackdrop(shot, true);
        }
      }
    } catch {
      if (!surface.destroyed && surface.renderer && surface.canvas) {
        const fb =
          surface.fieldMode === "glyph"
            ? createChromeStudioBackdrop(
                surface.canvas.width || 256,
                surface.canvas.height || 256,
              )
            : createFallbackBackdrop(
                surface.canvas.width || 256,
                surface.canvas.height || 256,
              );
        surface.renderer.setBackdrop(fb, true);
      }
    } finally {
      surface.lastCapture = performance.now();
      surface.capturing = false;
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

  /** Lerp blob list toward target for detach/spawn temporal coherence. */
  private smoothToward(prev: DripBlob[], next: DripBlob[], alpha: number): DripBlob[] {
    const out: DripBlob[] = [];
    const n = Math.max(prev.length, next.length);
    for (let i = 0; i < n; i++) {
      const a = prev[i];
      const b = next[i];
      if (a && b) {
        out.push({
          x: a.x + (b.x - a.x) * alpha,
          y: a.y + (b.y - a.y) * alpha,
          r: a.r + (b.r - a.r) * alpha,
          w: a.w + (b.w - a.w) * alpha,
        });
      } else if (b) {
        // Fade in
        out.push({ ...b, w: b.w * alpha });
      } else if (a) {
        // Fade out
        const w = a.w * (1 - alpha);
        if (w > 0.02) out.push({ ...a, w });
      }
    }
    return out;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.startTime = performance.now();
    this.lastTick = this.startTime;

    // Scroll: layout only — NEVER recapture (was a primary flicker source)
    this.onScroll = () => {
      window.clearTimeout(this.scrollTimer);
      this.scrollTimer = window.setTimeout(() => {
        for (const s of this.surfaces) this.syncLayout(s);
      }, 100);
    };
    this.onResize = () => {
      window.clearTimeout(this.resizeTimer);
      this.resizeTimer = window.setTimeout(() => {
        for (const s of this.surfaces) {
          this.syncLayout(s);
          // Size change only: optional one-shot recapture
          void this.refreshSurface(s, true);
        }
      }, 200);
    };
    window.addEventListener("scroll", this.onScroll, { passive: true });
    window.addEventListener("resize", this.onResize);

    const tick = (now: number) => {
      if (!this.running) return;
      const t = (now - this.startTime) / 1000;
      const rawDt = (now - this.lastTick) / 1000;
      this.lastTick = now;
      // Clamp dt to avoid giant steps after tab backgrounding (spawn storms)
      const dt = Math.min(0.05, Math.max(0.001, rawDt));
      const reducedMotion = motionFrozen();
      const reducedFlag = reducedMotion ? 1 : 0;

      for (const s of this.surfaces) {
        if (s.mode !== "webgl" || !s.renderer || !s.canvas) continue;

        // Opt-in only; default captureIntervalMs=0 kills the ~2s texture flicker
        if (
          s.captureIntervalMs > 0 &&
          !s.capturing &&
          now - s.lastCapture > s.captureIntervalMs
        ) {
          void this.refreshSurface(s, true);
        }

        const rect = s.el.getBoundingClientRect();
        const aspect = rect.width / Math.max(rect.height, 1);
        const halfH = 0.48;
        const halfW = aspect * halfH;

        const simBlobs =
          reducedMotion || (s.material.drip < 0.001 && s.material.liquify < 0.001)
            ? []
            : s.dripSim.step(dt, {
                drip: s.material.drip,
                liquify: s.material.liquify,
                viscosity: s.material.viscosity,
                halfW,
                halfH,
                reducedMotion,
                control: s.dripControl,
              });

        // Temporal smooth (~12–18Hz effective for blob topology changes)
        const alpha = 1 - Math.exp(-dt * 14);
        s.smoothBlobs = this.smoothToward(s.smoothBlobs, simBlobs, alpha);

        s.renderer.draw({
          ...s.material,
          time: reducedMotion ? 0 : t,
          reducedMotion: reducedFlag,
          blobs: s.smoothBlobs,
          fieldMode: s.fieldMode,
          glyphId: s.glyphId ?? undefined,
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
    window.clearTimeout(this.scrollTimer);
    window.clearTimeout(this.resizeTimer);
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
