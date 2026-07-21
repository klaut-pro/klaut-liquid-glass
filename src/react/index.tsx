"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import {
  LiquidGlass,
  type GlassSurface,
  type Material,
  type MaterialPartial,
} from "../api/LiquidGlass.js";
import type { LiquidGlassEngine } from "../api/Glassify.js";
import { lightFromOrbit, orbitFromLight } from "../presets/index.js";

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
  { key: "viscosity", label: "viscosity", min: 0, max: 1, step: 0.01 },
  { key: "dispersion", label: "dispersion", min: 0, max: 1, step: 0.01 },
  { key: "filmThickness", label: "film", min: 0, max: 1, step: 0.01 },
  { key: "ior", label: "ior", min: 1.1, max: 1.7, step: 0.01 },
  { key: "bevel", label: "bevel", min: 0, max: 1, step: 0.01 },
  { key: "blur", label: "blur", min: 0, max: 1, step: 0.01 },
  { key: "cornerRadius", label: "cornerR", min: 0, max: 0.5, step: 0.01 },
  { key: "specular", label: "specular", min: 0, max: 1, step: 0.01 },
  { key: "lightIntensity", label: "light I", min: 0, max: 3, step: 0.01 },
];

/** Azimuth / elevation gimbal + drag pad for light aim (drives dispersion + specular). */
function LightGimbal({
  value,
  onChange,
}: {
  value: Material;
  onChange: (next: Material) => void;
}) {
  const orbit = useMemo(() => orbitFromLight(value.lightPosition), [value.lightPosition]);
  const padRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const applyOrbit = (azimuth: number, elevation: number) => {
    onChange({
      ...value,
      lightPosition: lightFromOrbit(azimuth, elevation, orbit.distance || 1.15),
    });
  };

  const aimFromPointer = (clientX: number, clientY: number) => {
    const el = padRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const nx = (clientX - r.left) / Math.max(r.width, 1); // 0..1
    const ny = (clientY - r.top) / Math.max(r.height, 1);
    // Pad: x → azimuth (-180..180), y → elevation (70..-20)
    const azimuth = (nx - 0.5) * 360;
    const elevation = 70 - ny * 90;
    applyOrbit(azimuth, elevation);
  };

  const onPointerDown = (e: ReactPointerEvent) => {
    dragging.current = true;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    aimFromPointer(e.clientX, e.clientY);
  };
  const onPointerMove = (e: ReactPointerEvent) => {
    if (!dragging.current) return;
    aimFromPointer(e.clientX, e.clientY);
  };
  const onPointerUp = () => {
    dragging.current = false;
  };

  // Marker position from current orbit
  const mx = ((orbit.azimuth / 360) + 0.5) * 100;
  const my = ((70 - orbit.elevation) / 90) * 100;

  return (
    <div style={{ marginTop: 10, marginBottom: 6 }}>
      <div style={{ opacity: 0.7, marginBottom: 6 }}>light gimbal (drag to aim)</div>
      <div
        ref={padRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        style={{
          position: "relative",
          width: "100%",
          height: 96,
          borderRadius: 8,
          cursor: "crosshair",
          touchAction: "none",
          background:
            "radial-gradient(circle at 50% 35%, rgba(120,200,255,0.35), transparent 55%), linear-gradient(160deg, #1a2233, #0a0c12)",
          border: "1px solid rgba(255,255,255,0.18)",
          overflow: "hidden",
        }}
        aria-label="Light aim pad"
      >
        <div
          style={{
            position: "absolute",
            left: `${Math.min(96, Math.max(4, mx))}%`,
            top: `${Math.min(92, Math.max(4, my))}%`,
            width: 14,
            height: 14,
            marginLeft: -7,
            marginTop: -7,
            borderRadius: "50%",
            background: "radial-gradient(circle at 30% 30%, #fff, #7ec8ff 55%, #ff6ab0)",
            boxShadow: "0 0 12px rgba(126,200,255,0.9)",
            pointerEvents: "none",
          }}
        />
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "space-between",
            padding: "4px 6px",
            fontSize: 9,
            opacity: 0.45,
            pointerEvents: "none",
          }}
        >
          <span>← az</span>
          <span>elev ↑</span>
          <span>az →</span>
        </div>
      </div>
      <label
        style={{
          display: "grid",
          gridTemplateColumns: "110px 1fr 42px",
          gap: 6,
          alignItems: "center",
          marginTop: 6,
        }}
      >
        <span>azimuth</span>
        <input
          type="range"
          min={-180}
          max={180}
          step={1}
          value={orbit.azimuth}
          onChange={(e) => applyOrbit(Number(e.target.value), orbit.elevation)}
        />
        <span style={{ textAlign: "right", opacity: 0.8 }}>{orbit.azimuth.toFixed(0)}°</span>
      </label>
      <label
        style={{
          display: "grid",
          gridTemplateColumns: "110px 1fr 42px",
          gap: 6,
          alignItems: "center",
          marginBottom: 4,
        }}
      >
        <span>elevation</span>
        <input
          type="range"
          min={-20}
          max={80}
          step={1}
          value={orbit.elevation}
          onChange={(e) => applyOrbit(orbit.azimuth, Number(e.target.value))}
        />
        <span style={{ textAlign: "right", opacity: 0.8 }}>{orbit.elevation.toFixed(0)}°</span>
      </label>
    </div>
  );
}

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
        maxWidth: 300,
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
            value={value[key] as number}
            onChange={(e) =>
              onChange({ ...value, [key]: Number(e.target.value) })
            }
          />
          <span style={{ textAlign: "right", opacity: 0.8 }}>
            {(value[key] as number).toFixed(2)}
          </span>
        </label>
      ))}
      <LightGimbal value={value} onChange={onChange} />
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
