"use client";

import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  LiquidGlass,
  type GlassSurface,
  type Material,
  type MaterialPartial,
} from "../api/LiquidGlass.js";
import type { LiquidGlassEngine } from "../api/Glassify.js";

export type GlassifyProps = {
  children: ReactNode;
  material?: MaterialPartial;
  className?: string;
  style?: CSSProperties;
  engine?: LiquidGlassEngine | null;
  onSurface?: (surface: GlassSurface | null) => void;
  /** Shared engine from parent — preferred when glassifying ≤3 surfaces. */
  sharedEngine?: LiquidGlassEngine;
};

/**
 * Wrap any interactive DOM subtree; real children stay for a11y/layout.
 */
export function Glassify({
  children,
  material,
  className,
  style,
  sharedEngine,
  onSurface,
}: GlassifyProps) {
  const ref = useRef<HTMLDivElement>(null);
  const engineRef = useRef<LiquidGlassEngine | null>(null);
  const ownsEngine = useRef(false);

  const surfaceRef = useRef<GlassSurface | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const engine =
      sharedEngine ??
      (() => {
        ownsEngine.current = true;
        const e = LiquidGlass.create();
        e.start();
        return e;
      })();
    engineRef.current = engine;

    const surface = engine.glassify(el, material);
    surfaceRef.current = surface;
    onSurface?.(surface);

    return () => {
      surface.destroy();
      surfaceRef.current = null;
      onSurface?.(null);
      if (ownsEngine.current) {
        engine.destroy();
        ownsEngine.current = false;
      }
      engineRef.current = null;
    };
    // Mount once per element / shared engine
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sharedEngine]);

  useEffect(() => {
    if (material && surfaceRef.current) {
      surfaceRef.current.set(material);
    }
  }, [material]);

  return (
    <div ref={ref} className={className} style={{ position: "relative", ...style }}>
      {children}
    </div>
  );
}

export type DebugPanelProps = {
  value: Material;
  onChange: (next: Material) => void;
  className?: string;
};

const KNOBS: { key: keyof Material; label: string; min: number; max: number; step: number }[] = [
  { key: "glass", label: "glass", min: 0, max: 1, step: 0.01 },
  { key: "liquify", label: "liquify", min: 0, max: 1, step: 0.01 },
  { key: "drip", label: "drip", min: 0, max: 1, step: 0.01 },
  { key: "dispersion", label: "dispersion", min: 0, max: 1, step: 0.01 },
  { key: "filmThickness", label: "filmThickness", min: 0, max: 1, step: 0.01 },
  { key: "ior", label: "ior", min: 1.1, max: 1.7, step: 0.01 },
  { key: "bevel", label: "bevel", min: 0, max: 1, step: 0.01 },
  { key: "blur", label: "blur", min: 0, max: 1, step: 0.01 },
  { key: "cornerRadius", label: "cornerRadius", min: 0, max: 0.5, step: 0.01 },
  { key: "specular", label: "specular", min: 0, max: 1, step: 0.01 },
];

export function LiquidGlassDebugPanel({ value, onChange, className }: DebugPanelProps) {
  return (
    <div
      className={className}
      style={{
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        fontSize: 12,
        padding: 12,
        background: "rgba(8,10,16,0.85)",
        color: "#e8eef8",
        borderRadius: 8,
        maxWidth: 280,
        backdropFilter: "blur(8px)",
      }}
    >
      <div style={{ marginBottom: 8, opacity: 0.7 }}>liquid-glass knobs</div>
      {KNOBS.map(({ key, label, min, max, step }) => (
        <label
          key={key}
          style={{
            display: "grid",
            gridTemplateColumns: "110px 1fr 42px",
            gap: 6,
            alignItems: "center",
            marginBottom: 6,
          }}
        >
          <span>{label}</span>
          <input
            type="range"
            min={min}
            max={max}
            step={step}
            value={value[key]}
            onChange={(e) =>
              onChange({ ...value, [key]: Number(e.target.value) })
            }
          />
          <span style={{ textAlign: "right", opacity: 0.8 }}>
            {value[key].toFixed(2)}
          </span>
        </label>
      ))}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 8 }}>
        {(Object.keys(LiquidGlass.presets) as (keyof typeof LiquidGlass.presets)[]).map(
          (name) => (
            <button
              key={name}
              type="button"
              style={{
                fontSize: 11,
                padding: "4px 8px",
                borderRadius: 4,
                border: "1px solid rgba(255,255,255,0.2)",
                background: "rgba(255,255,255,0.06)",
                color: "inherit",
                cursor: "pointer",
              }}
              onClick={() => onChange({ ...LiquidGlass.presets[name] })}
            >
              {name}
            </button>
          ),
        )}
      </div>
    </div>
  );
}

/** Hook: shared engine + live material for multiple Glassify children. */
export function useLiquidGlassEngine(autoStart = true): LiquidGlassEngine {
  const [engine] = useState(() => LiquidGlass.create());
  useEffect(() => {
    if (autoStart) engine.start();
    return () => engine.destroy();
  }, [engine, autoStart]);
  return engine;
}

export function useMaterial(
  initial: MaterialPartial = LiquidGlass.presets.chromeDrip,
): [Material, (p: MaterialPartial | Material) => void] {
  const [mat, setMat] = useState(() => LiquidGlass.resolveMaterial(initial));
  return [
    mat,
    (p) => setMat((prev) => LiquidGlass.clampMaterial({ ...prev, ...p })),
  ];
}
