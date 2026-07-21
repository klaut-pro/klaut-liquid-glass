#!/usr/bin/env python3
"""
Bake concept-art-derived studio HDRI / reflection plate.

Blender unavailable — frontal softbox plate for reflection sampling
(planar wet-mirror + tubular wrap).

Iteration 32: multi-softbox silver wet-mirror — overlapping elliptical
softboxes with luminance contrast (no barcode columns, no residual
lime/gold flood, no cream/pink). Whisper cool oil puddles only.
"""
from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
CONCEPT = ROOT.parent / "klaut.pro" / "concept_art"
OUT = ROOT / "demo" / "env" / "studio-softbox.png"
OUT_H = 2048
OUT_W = 2048


def load_rgb(name: str) -> np.ndarray:
    path = CONCEPT / name
    if not path.exists():
        path = ROOT / "demo" / "qa-refs" / name
    im = Image.open(path).convert("RGB")
    return np.asarray(im, dtype=np.float32)


def crush_cream_pink(rgb: np.ndarray) -> np.ndarray:
    """Kill warm cream + magenta + neon lime/gold flood; keep softbox luma."""
    out = rgb.copy()
    r, g, b = out[..., 0], out[..., 1], out[..., 2]
    chroma = out.max(-1) - out.min(-1)
    cream = np.maximum(0.0, r - b * 1.05)
    cream = np.maximum(cream, np.maximum(0.0, g * 0.9 - b))
    pink = np.maximum(0.0, r - g * 1.08) * np.maximum(0.0, b - g * 0.95)
    # Neon lime/gold only (high chroma) — spare mild cool softbox tint
    lime_neon = np.maximum(0.0, g - r * 1.05) * np.maximum(0.0, g - b * 1.0)
    lime_neon = np.where(chroma > 35, lime_neon, 0.0)
    gold_neon = np.maximum(0.0, r - b * 1.12) * np.maximum(0.0, g - b * 0.95)
    gold_neon = np.where((chroma > 35) & (b < 140), gold_neon, 0.0)
    cyan_milk = np.maximum(0.0, b - r * 0.95) * (1.0 - np.clip(chroma / 90.0, 0.0, 1.0))
    out[..., 0] = r - cream * 0.85 - pink * 0.98 - gold_neon * 0.45 + cyan_milk * 0.2
    out[..., 1] = g - cream * 0.35 - lime_neon * 0.7 - gold_neon * 0.2 + cyan_milk * 0.1
    out[..., 2] = b - pink * 0.75 - cyan_milk * 0.75 + lime_neon * 0.15
    lav = np.maximum(0.0, out[..., 2] - out[..., 0] * 0.98)
    out[..., 0] = out[..., 0] + lav * 0.2
    out[..., 2] = out[..., 2] - lav * 0.45
    return np.clip(out, 0.0, 255.0)


def soft_ellipse(yy: np.ndarray, xx: np.ndarray, cy: float, cx: float, ry: float, rx: float) -> np.ndarray:
    """Smooth elliptical softbox lobe in [0,1]."""
    q = ((yy - cy) / max(ry, 1e-4)) ** 2 + ((xx - cx) / max(rx, 1e-4)) ** 2
    return np.clip(1.0 - q, 0.0, 1.0) ** 1.55


def planar_oil_field(h: int, w: int) -> np.ndarray:
    """Whisper cool oil — faint cyan↔silver puddles for wet-mirror (not neon lime)."""
    yy = np.linspace(0, 1, h, dtype=np.float32).reshape(-1, 1)
    xx = np.linspace(0, 1, w, dtype=np.float32).reshape(1, -1)
    phase = yy * 2.8 + xx * 1.6
    phase2 = yy * 1.4 - xx * 2.2 + 0.55
    cool = 0.5 + 0.5 * np.sin(phase * 1.6)
    wash = 0.35 + 0.45 * (0.5 + 0.5 * np.sin(phase2 * 1.05))
    puddle = soft_ellipse(yy, xx, 0.34, 0.4, 0.55, 0.62)
    puddle = np.maximum(puddle, soft_ellipse(yy, xx, 0.55, 0.58, 0.48, 0.55) * 0.8)
    puddle = np.maximum(puddle, soft_ellipse(yy, xx, 0.28, 0.68, 0.35, 0.42) * 0.55)
    mod = np.zeros((h, w, 3), dtype=np.float32)
    mod[..., 0] = (-6.0 * cool) * wash * puddle
    mod[..., 1] = (3.0 * cool) * wash * puddle
    mod[..., 2] = (10.0 * cool) * wash * puddle
    return mod


def build_plate() -> Image.Image:
    for name in ("1c6PD.jpg", "Z53Ve.jpg", "ENj9B.jpg"):
        try:
            _ = load_rgb(name)
        except OSError:
            pass

    yy = np.linspace(0, 1, OUT_H, dtype=np.float32).reshape(-1, 1)
    xx = np.linspace(0, 1, OUT_W, dtype=np.float32).reshape(1, -1)

    plate = np.zeros((OUT_H, OUT_W, 3), dtype=np.float32)
    plate[..., 0] = 6.0
    plate[..., 1] = 7.0
    plate[..., 2] = 9.0

    # Distinct softbox cluster — luminance contrast for planar wet-mirror
    softboxes = [
        (0.18, 0.28, 0.22, 0.32, np.array([255.0, 255.0, 255.0]), 1.15),
        (0.22, 0.52, 0.2, 0.28, np.array([245.0, 248.0, 255.0]), 1.0),
        (0.16, 0.72, 0.18, 0.24, np.array([230.0, 235.0, 245.0]), 0.88),
        (0.38, 0.38, 0.28, 0.4, np.array([175.0, 182.0, 198.0]), 0.78),
        (0.42, 0.62, 0.26, 0.32, np.array([155.0, 162.0, 178.0]), 0.7),
        (0.55, 0.25, 0.24, 0.3, np.array([140.0, 148.0, 165.0]), 0.62),
        (0.58, 0.55, 0.3, 0.42, np.array([120.0, 128.0, 145.0]), 0.55),
        (0.7, 0.4, 0.26, 0.36, np.array([95.0, 102.0, 118.0]), 0.45),
        (0.72, 0.68, 0.22, 0.28, np.array([85.0, 92.0, 108.0]), 0.38),
        # Dark interstitial voids (anti flat matte — NOT barcode columns)
        (0.48, 0.82, 0.35, 0.2, np.array([28.0, 30.0, 38.0]), 0.55),
        (0.32, 0.12, 0.28, 0.18, np.array([22.0, 24.0, 32.0]), 0.5),
    ]

    for cy, cx, ry, rx, color, gain in softboxes:
        lobe = soft_ellipse(yy, xx, cy, cx, ry, rx) * gain
        lobe = lobe ** 0.72
        plate = plate + color.reshape(1, 1, 3) * lobe[..., None]

    ceil = np.exp(-((yy - 0.12) ** 2) / 0.018) * (0.5 + 0.5 * np.sin(xx * np.pi * 1.2))
    plate = plate + np.array([255.0, 255.0, 255.0]).reshape(1, 1, 3) * (ceil * 0.55)[..., None]

    plate = plate + planar_oil_field(OUT_H, OUT_W)

    vignette = soft_ellipse(yy, xx, 0.48, 0.5, 0.82, 0.88)
    plate = plate * (0.12 + 0.88 * vignette[..., None])

    plate = np.clip(plate, 0, 255)
    plate = crush_cream_pink(plate)
    luma = 0.2126 * plate[..., 0] + 0.7152 * plate[..., 1] + 0.0722 * plate[..., 2]
    plate[luma < 14] *= 0.08

    im = Image.fromarray(np.clip(plate, 0, 255).astype(np.uint8), mode="RGB")
    # Mild blur — keep softbox lobes distinct (heavy blur → flat matte)
    im = im.filter(ImageFilter.GaussianBlur(radius=14))
    arr = np.asarray(im, dtype=np.float32)
    arr = crush_cream_pink(arr)
    mid = 128.0
    arr = mid + (arr - mid) * 1.18
    arr = np.clip(arr, 0, 255)
    im = Image.fromarray(arr.astype(np.uint8), mode="RGB")
    im = im.filter(ImageFilter.GaussianBlur(radius=4))
    return im


def main() -> None:
    OUT.parent.mkdir(parents=True, exist_ok=True)
    im = build_plate()
    im.save(OUT, "PNG", optimize=True)
    print(f"wrote {OUT} ({OUT.stat().st_size} bytes) multi-softbox silver wet-mirror (no barcode)")


if __name__ == "__main__":
    main()
