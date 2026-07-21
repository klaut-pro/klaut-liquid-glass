/**
 * Soft CSS / SVG displacement fallback when WebGL2 is unavailable.
 * No drops / true Snell — readable glass pane only.
 */

import type { Material } from "../api/Material.js";

export function applyCssFallback(
  el: HTMLElement,
  material: Material,
): () => void {
  const prev = {
    backdropFilter: el.style.backdropFilter,
    webkitBackdropFilter: (el.style as CSSStyleDeclaration & { webkitBackdropFilter?: string })
      .webkitBackdropFilter,
    background: el.style.background,
    boxShadow: el.style.boxShadow,
    border: el.style.border,
    isolation: el.style.isolation,
  };

  const blurPx = 8 + material.blur * 16;
  const sat = 1 + material.dispersion * 0.35;
  el.style.isolation = "isolate";
  el.style.backdropFilter = `blur(${blurPx}px) saturate(${sat})`;
  (el.style as CSSStyleDeclaration & { webkitBackdropFilter?: string }).webkitBackdropFilter =
    el.style.backdropFilter;
  el.style.background = `linear-gradient(
    135deg,
    rgba(255,255,255,${0.08 + material.glass * 0.12}) 0%,
    rgba(180,255,255,${0.04 + material.filmThickness * 0.08}) 45%,
    rgba(255,120,200,${0.03 + material.dispersion * 0.06}) 100%
  )`;
  el.style.boxShadow = `inset 0 1px 0 rgba(255,255,255,0.25), 0 8px 32px rgba(0,0,0,0.25)`;
  el.style.border = `1px solid rgba(255,255,255,${0.15 + material.glass * 0.2})`;

  // Optional SVG turbulence displacement for a hint of liquify without WebGL
  let filterEl: SVGSVGElement | null = null;
  if (material.liquify > 0.05 || material.drip > 0.05) {
    const id = `lg-fallback-${Math.random().toString(36).slice(2, 9)}`;
    filterEl = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    filterEl.setAttribute("width", "0");
    filterEl.setAttribute("height", "0");
    filterEl.style.position = "absolute";
    filterEl.innerHTML = `
      <filter id="${id}">
        <feTurbulence type="fractalNoise" baseFrequency="${0.01 + material.liquify * 0.04}" numOctaves="2" result="noise"/>
        <feDisplacementMap in="SourceGraphic" in2="noise" scale="${4 + material.liquify * 12 + material.drip * 8}" xChannelSelector="R" yChannelSelector="G"/>
      </filter>`;
    document.body.appendChild(filterEl);
    el.style.filter = `url(#${id})`;
  }

  return () => {
    el.style.backdropFilter = prev.backdropFilter;
    (el.style as CSSStyleDeclaration & { webkitBackdropFilter?: string }).webkitBackdropFilter =
      prev.webkitBackdropFilter ?? "";
    el.style.background = prev.background;
    el.style.boxShadow = prev.boxShadow;
    el.style.border = prev.border;
    el.style.isolation = prev.isolation;
    el.style.filter = "";
    filterEl?.remove();
  };
}
