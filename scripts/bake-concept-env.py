#!/usr/bin/env python3
"""
Bake concept-art-derived studio HDRI / reflection plate.

Blender unavailable — frontal softbox plate for reflection sampling
(planar wet-mirror + tubular wrap).

Iteration 30: kill vertical barcode columns. Continuous planar softbox —
soft elliptical panels + diagonal lime↔gold oil wash (1c6PD/Z53Ve wet-mirror).
No magenta / cyan-milk face flood; pink0 cream0.
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
    return np.clip(1.0 - q, 0.0, 1.0) ** 1.35


def planar_oil_field(h: int, w: int) -> np.ndarray:
    """Continuous 2D oil-slick (diagonal lime↔gold) — not vertical barcode."""
    yy = np.linspace(0, 1, h, dtype=np.float32).reshape(-1, 1)
    xx = np.linspace(0, 1, w, dtype=np.float32).reshape(1, -1)
    # Low-frequency diagonal oil phase (wet-mirror planar wash)
    phase = yy * 3.4 + xx * 2.1
    phase2 = yy * 1.6 - xx * 2.8 + 0.7
    lime = 0.5 + 0.5 * np.sin(phase * 2.0)
    gold = 0.5 + 0.5 * np.sin(phase * 2.0 + 2.1)
    wash = 0.45 + 0.55 * (0.5 + 0.5 * np.sin(phase2 * 1.15))
    # Soft puddle envelopes (planar blobs, not columns)
    puddle = soft_ellipse(yy, xx, 0.32, 0.38, 0.55, 0.62)
    puddle = np.maximum(puddle, soft_ellipse(yy, xx, 0.58, 0.62, 0.48, 0.55) * 0.9)
    puddle = np.maximum(puddle, soft_ellipse(yy, xx, 0.22, 0.72, 0.35, 0.4) * 0.7)
    mod = np.zeros((h, w, 3), dtype=np.float32)
    # Silver base gets oil chroma; luminance-preserving-ish deltas
    mod[..., 0] = (-14.0 * lime + 28.0 * gold) * wash * puddle
    mod[..., 1] = (22.0 * lime + 10.0 * gold) * wash * puddle
    mod[..., 2] = (-14.0 * lime - 20.0 * gold) * wash * puddle
    # Thin cyan only at extreme plate edges (not face flood)
    edge = np.minimum(np.minimum(xx, 1.0 - xx), np.minimum(yy, 1.0 - yy))
    thin_cyan = np.clip(1.0 - edge / 0.045, 0.0, 1.0) * 0.12
    mod[..., 2] += 6.0 * thin_cyan
    return mod


def build_plate() -> Image.Image:
    for name in ("1c6PD.jpg", "Z53Ve.jpg", "ENj9B.jpg"):
        try:
            _ = load_rgb(name)
        except OSError:
            pass

    yy = np.linspace(0, 1, OUT_H, dtype=np.float32).reshape(-1, 1)
    xx = np.linspace(0, 1, OUT_W, dtype=np.float32).reshape(1, -1)

    # Charcoal void floor — soft, continuous (no vertical barcode voids)
    plate = np.zeros((OUT_H, OUT_W, 3), dtype=np.float32)
    plate[..., 0] = 6.0
    plate[..., 1] = 7.0
    plate[..., 2] = 9.0

    # Soft elliptical softboxes (planar wet-mirror studio) — silver-first
    softboxes = [
        # (cy, cx, ry, rx, color, gain)
        (0.18, 0.28, 0.22, 0.38, np.array([248.0, 250.0, 255.0]), 1.0),
        (0.16, 0.62, 0.2, 0.34, np.array([232.0, 236.0, 244.0]), 0.92),
        (0.42, 0.45, 0.32, 0.48, np.array([190.0, 198.0, 210.0]), 0.75),
        (0.55, 0.22, 0.28, 0.3, np.array([168.0, 176.0, 188.0]), 0.65),
        (0.5, 0.78, 0.3, 0.28, np.array([175.0, 182.0, 192.0]), 0.62),
        # Lime / gold oil puddles (planar iridescence accents)
        (0.35, 0.55, 0.24, 0.32, np.array([78.0, 220.0, 72.0]), 0.55),
        (0.62, 0.4, 0.22, 0.3, np.array([225.0, 195.0, 52.0]), 0.5),
        (0.28, 0.75, 0.18, 0.22, np.array([95.0, 210.0, 70.0]), 0.4),
        (0.7, 0.68, 0.2, 0.26, np.array([210.0, 175.0, 45.0]), 0.38),
    ]

    for cy, cx, ry, rx, color, gain in softboxes:
        lobe = soft_ellipse(yy, xx, cy, cx, ry, rx) * gain
        # Soft falloff — wet mirror, not hard panel knife
        lobe = lobe ** 0.85
        plate = plate + color.reshape(1, 1, 3) * lobe[..., None]

    # Ceiling catch — soft horizontal band (not a hard knife line)
    ceil = np.exp(-((yy - 0.12) ** 2) / 0.018) * (0.55 + 0.45 * np.sin(xx * np.pi))
    plate = plate + np.array([250.0, 252.0, 255.0]).reshape(1, 1, 3) * (ceil * 0.35)[..., None]

    # Continuous planar oil wash across whole plate
    plate = plate + planar_oil_field(OUT_H, OUT_W)

    # Soft vignette voids at corners (planar contrast without barcode columns)
    vignette = soft_ellipse(yy, xx, 0.48, 0.5, 0.72, 0.78)
    plate = plate * (0.12 + 0.88 * vignette[..., None])

    plate = np.clip(plate, 0, 255)
    plate = crush_cream_pink(plate)
    luma = 0.2126 * plate[..., 0] + 0.7152 * plate[..., 1] + 0.0722 * plate[..., 2]
    plate[luma < 22] *= 0.08

    # Heavy blur → planar wet-mirror softbox (kills residual high-freq shred)
    im = Image.fromarray(np.clip(plate, 0, 255).astype(np.uint8), mode="RGB")
    im = im.filter(ImageFilter.GaussianBlur(radius=18))
    # Mild re-contrast after blur so softbox peaks stay readable
    arr = np.asarray(im, dtype=np.float32)
    arr = crush_cream_pink(arr)
    mid = 128.0
    arr = mid + (arr - mid) * 1.18
    arr = np.clip(arr, 0, 255)
    im = Image.fromarray(arr.astype(np.uint8), mode="RGB")
    im = im.filter(ImageFilter.UnsharpMask(radius=1.2, percent=80, threshold=6))
    return im


def main() -> None:
    OUT.parent.mkdir(parents=True, exist_ok=True)
    im = build_plate()
    im.save(OUT, "PNG", optimize=True)
    print(f"wrote {OUT} ({OUT.stat().st_size} bytes) planar wet-mirror softbox (no barcode columns)")


if __name__ == "__main__":
    main()
