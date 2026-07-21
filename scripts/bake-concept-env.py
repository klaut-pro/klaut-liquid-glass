#!/usr/bin/env python3
"""
Bake concept-art-derived studio HDRI / reflection plate.

Blender unavailable — frontal softbox plate for reflection sampling
(planar wet-mirror + tubular wrap).

Iteration 31: oil-slick planar — continuous elliptical softboxes + smooth
diagonal oil film (no vertical barcode / no hard lime-gold slabs).
Pink0 cream0; cyan fringe edge-only.
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
    """Kill warm cream + magenta — spare lime/gold accent chroma."""
    out = rgb.copy()
    r, g, b = out[..., 0], out[..., 1], out[..., 2]
    chroma = out.max(-1) - out.min(-1)
    lime = (g > r + 12) & (g > b + 8) & (chroma > 28)
    gold = (r > 140) & (g > 110) & (b < 120) & (chroma > 28)
    spare = lime | gold
    cream = np.maximum(0.0, r - b * 1.05)
    cream = np.maximum(cream, np.maximum(0.0, g * 0.9 - b))
    cream = np.where(spare, 0.0, cream)
    pink = np.maximum(0.0, r - g * 1.08) * np.maximum(0.0, b - g * 0.95)
    cyan_milk = np.maximum(0.0, b - r * 0.95) * (1.0 - np.clip(chroma / 90.0, 0.0, 1.0))
    cyan_milk = np.where(spare, 0.0, cyan_milk)
    out[..., 0] = r - cream * 0.85 - pink * 0.98 + cyan_milk * 0.35
    out[..., 1] = g - cream * 0.35 + cyan_milk * 0.15
    out[..., 2] = b - pink * 0.75 - cyan_milk * 0.85
    lav = np.maximum(0.0, out[..., 2] - out[..., 0] * 0.98)
    lav = np.where(spare, 0.0, lav)
    out[..., 0] = out[..., 0] + lav * 0.25
    out[..., 2] = out[..., 2] - lav * 0.55
    return np.clip(out, 0.0, 255.0)


def soft_ellipse(yy: np.ndarray, xx: np.ndarray, cy: float, cx: float, ry: float, rx: float) -> np.ndarray:
    """Smooth elliptical softbox lobe in [0,1]."""
    q = ((yy - cy) / max(ry, 1e-4)) ** 2 + ((xx - cx) / max(rx, 1e-4)) ** 2
    return np.clip(1.0 - q, 0.0, 1.0) ** 1.55


def planar_oil_field(h: int, w: int) -> np.ndarray:
    """Continuous oil-slick film — diagonal lime↔gold puddles, not vertical slabs."""
    yy = np.linspace(0, 1, h, dtype=np.float32).reshape(-1, 1)
    xx = np.linspace(0, 1, w, dtype=np.float32).reshape(1, -1)
    phase = yy * 2.8 + xx * 1.6
    phase2 = yy * 1.4 - xx * 2.2 + 0.55
    lime = 0.5 + 0.5 * np.sin(phase * 1.6)
    gold = 0.5 + 0.5 * np.sin(phase * 1.6 + 2.0)
    wash = 0.4 + 0.6 * (0.5 + 0.5 * np.sin(phase2 * 1.05))
    puddle = soft_ellipse(yy, xx, 0.34, 0.4, 0.62, 0.7)
    puddle = np.maximum(puddle, soft_ellipse(yy, xx, 0.55, 0.58, 0.55, 0.62) * 0.85)
    puddle = np.maximum(puddle, soft_ellipse(yy, xx, 0.24, 0.68, 0.4, 0.48) * 0.65)
    puddle = np.maximum(puddle, soft_ellipse(yy, xx, 0.68, 0.32, 0.38, 0.45) * 0.55)
    mod = np.zeros((h, w, 3), dtype=np.float32)
    mod[..., 0] = (-10.0 * lime + 22.0 * gold) * wash * puddle
    mod[..., 1] = (18.0 * lime + 8.0 * gold) * wash * puddle
    mod[..., 2] = (-12.0 * lime - 16.0 * gold) * wash * puddle
    edge = np.minimum(np.minimum(xx, 1.0 - xx), np.minimum(yy, 1.0 - yy))
    thin_cyan = np.clip(1.0 - edge / 0.045, 0.0, 1.0) * 0.1
    mod[..., 2] += 5.0 * thin_cyan
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
    plate[..., 0] = 8.0
    plate[..., 1] = 9.0
    plate[..., 2] = 11.0

    softboxes = [
        (0.2, 0.32, 0.28, 0.48, np.array([250.0, 252.0, 255.0]), 1.05),
        (0.18, 0.58, 0.26, 0.42, np.array([236.0, 240.0, 248.0]), 0.95),
        (0.4, 0.48, 0.38, 0.55, np.array([198.0, 205.0, 216.0]), 0.82),
        (0.52, 0.28, 0.34, 0.38, np.array([175.0, 182.0, 194.0]), 0.7),
        (0.48, 0.72, 0.36, 0.36, np.array([180.0, 186.0, 196.0]), 0.68),
        (0.62, 0.5, 0.3, 0.5, np.array([155.0, 162.0, 172.0]), 0.55),
        # Soft lime / gold oil puddles — lower gain (accents on silver, not flood)
        (0.36, 0.52, 0.32, 0.4, np.array([120.0, 185.0, 115.0]), 0.22),
        (0.58, 0.42, 0.28, 0.36, np.array([195.0, 175.0, 95.0]), 0.2),
        (0.3, 0.7, 0.24, 0.28, np.array([130.0, 180.0, 110.0]), 0.16),
        (0.66, 0.62, 0.26, 0.32, np.array([185.0, 165.0, 90.0]), 0.15),
    ]

    for cy, cx, ry, rx, color, gain in softboxes:
        lobe = soft_ellipse(yy, xx, cy, cx, ry, rx) * gain
        lobe = lobe ** 0.75
        plate = plate + color.reshape(1, 1, 3) * lobe[..., None]

    ceil = np.exp(-((yy - 0.14) ** 2) / 0.022) * (0.55 + 0.45 * np.sin(xx * np.pi))
    plate = plate + np.array([250.0, 252.0, 255.0]).reshape(1, 1, 3) * (ceil * 0.4)[..., None]

    plate = plate + planar_oil_field(OUT_H, OUT_W)

    vignette = soft_ellipse(yy, xx, 0.48, 0.5, 0.78, 0.84)
    plate = plate * (0.18 + 0.82 * vignette[..., None])

    plate = np.clip(plate, 0, 255)
    plate = crush_cream_pink(plate)
    luma = 0.2126 * plate[..., 0] + 0.7152 * plate[..., 1] + 0.0722 * plate[..., 2]
    plate[luma < 18] *= 0.12

    im = Image.fromarray(np.clip(plate, 0, 255).astype(np.uint8), mode="RGB")
    im = im.filter(ImageFilter.GaussianBlur(radius=28))
    arr = np.asarray(im, dtype=np.float32)
    arr = crush_cream_pink(arr)
    mid = 128.0
    arr = mid + (arr - mid) * 1.12
    arr = np.clip(arr, 0, 255)
    im = Image.fromarray(arr.astype(np.uint8), mode="RGB")
    im = im.filter(ImageFilter.GaussianBlur(radius=8))
    return im


def main() -> None:
    OUT.parent.mkdir(parents=True, exist_ok=True)
    im = build_plate()
    im.save(OUT, "PNG", optimize=True)
    print(f"wrote {OUT} ({OUT.stat().st_size} bytes) oil-slick planar softbox (no barcode)")


if __name__ == "__main__":
    main()
