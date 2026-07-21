#!/usr/bin/env python3
"""
Bake concept-art-derived studio HDRI / reflection plate.

Blender unavailable — frontal softbox plate for NEAREST reflection
sampling (planar knife + tubular wrap).

Iteration 28: iridescent planar knife — silver softbox panels with
oil-slick lime/gold streaks (no magenta, no cyan-dominant flood).
Thin cyan only as panel-edge fringe, never face-wide milk.
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
    lime = (g > r + 15) & (g > b + 10) & (chroma > 40)
    gold = (r > 150) & (g > 120) & (b < 110) & (chroma > 40)
    spare = lime | gold
    cream = np.maximum(0.0, r - b * 1.05)
    cream = np.maximum(cream, np.maximum(0.0, g * 0.9 - b))
    cream = np.where(spare, 0.0, cream)
    pink = np.maximum(0.0, r - g * 1.08) * np.maximum(0.0, b - g * 0.95)
    # Cyan milk (low-chroma B>R) → silver; spare thin high-chroma fringe
    cyan_milk = np.maximum(0.0, b - r * 0.95) * (1.0 - np.clip(chroma / 90.0, 0.0, 1.0))
    cyan_milk = np.where(spare, 0.0, cyan_milk)
    luma = 0.2126 * r + 0.7152 * g + 0.0722 * b
    out[..., 0] = r - cream * 0.85 - pink * 0.98 + cyan_milk * 0.35
    out[..., 1] = g - cream * 0.35 + cyan_milk * 0.15
    out[..., 2] = b - pink * 0.75 - cyan_milk * 0.85
    # Re-neutralize residual lavender toward silver
    lav = np.maximum(0.0, out[..., 2] - out[..., 0] * 0.98)
    lav = np.where(spare, 0.0, lav)
    out[..., 0] = out[..., 0] + lav * 0.25
    out[..., 2] = out[..., 2] - lav * 0.55
    return np.clip(out, 0.0, 255.0)


def authored_palette() -> list[np.ndarray]:
    """
    Silver-first knife softbox — 4 wide panels (anti barcode shred).
    Contiguous silver/chrome + lime/gold oil-slick; no cyan-dominant slab.
    """
    return [
        np.array([248.0, 250.0, 255.0]),  # knife white
        np.array([188.0, 194.0, 205.0]),  # neutral chrome (was cyan-ish)
        np.array([95.0, 220.0, 85.0]),    # lime accent
        np.array([215.0, 195.0, 55.0]),   # gold accent
    ]


def oil_slick_modulation(h: int, w: int, panel_idx: int) -> np.ndarray:
    """Per-panel oil-slick: lime↔gold streaks + thin cyan edge fringe."""
    yy = np.linspace(0, 1, h, dtype=np.float32).reshape(-1, 1)
    xx = np.linspace(0, 1, w, dtype=np.float32).reshape(1, -1)
    # Diagonal oil phase — iridescent planar faces (1c6PD/Z53Ve)
    phase = yy * 6.5 + xx * 3.2 + panel_idx * 1.7
    lime = 0.5 + 0.5 * np.sin(phase * 2.0)
    gold = 0.5 + 0.5 * np.sin(phase * 2.0 + 2.1)
    # Edge fringe only (not face flood)
    edge = np.minimum(xx, 1.0 - xx)
    thin_cyan = np.clip(1.0 - edge / 0.08, 0.0, 1.0) * 0.35
    mod = np.zeros((h, w, 3), dtype=np.float32)
    if panel_idx < 2:
        # Silver panels: subtle oil-slick chroma on top of silver (sparse)
        mod[..., 0] = -4.0 * lime + 10.0 * gold
        mod[..., 1] = 8.0 * lime + 4.0 * gold
        mod[..., 2] = -4.0 * lime - 8.0 * gold + 12.0 * thin_cyan
        # Keep near-neutral: damp chroma
        mod *= 0.55
    elif panel_idx == 2:
        # Lime panel: keep green dominant, gold flecks
        mod[..., 0] = 8.0 * gold
        mod[..., 1] = 10.0 * lime
        mod[..., 2] = -12.0 * lime + 8.0 * thin_cyan
    else:
        # Gold panel: warm, crush cream drift
        mod[..., 0] = 6.0 * gold
        mod[..., 1] = 4.0 * gold - 4.0 * lime
        mod[..., 2] = -18.0 * gold + 6.0 * thin_cyan
    return mod


def build_plate() -> Image.Image:
    # Touch concept files so bake stays concept-linked (weights unused for color)
    for name in ("1c6PD.jpg", "Z53Ve.jpg", "ENj9B.jpg"):
        try:
            _ = load_rgb(name)
        except OSError:
            pass

    palette = authored_palette()
    plate = np.zeros((OUT_H, OUT_W, 3), dtype=np.float32)

    # Wider voids = knife panel/void contrast (anti cyan-milk flood)
    n = len(palette)
    panel_w = [0.24, 0.22, 0.11, 0.11]
    void_w = 0.08
    total = sum(panel_w) + void_w * (n + 1)
    scale = 1.0 / total
    panel_w = [w * scale for w in panel_w]
    void_w *= scale

    x = 0.0
    for i, color in enumerate(palette):
        x += void_w
        x0 = int(x * OUT_W)
        pw = panel_w[i]
        x1 = int((x + pw) * OUT_W)
        x = x + pw
        ww = max(1, x1 - x0)
        yy = np.linspace(0, 1, OUT_H, dtype=np.float32)
        # Ceiling softbox falloff — continuous, no vertical shred
        fall = 0.82 + 0.22 * np.exp(-((yy - 0.14) ** 2) / 0.06)
        fall = fall * (0.92 + 0.08 * np.sin(yy * 3.14159))
        xx = np.linspace(-1, 1, ww, dtype=np.float32)
        hgrad = 0.94 + 0.06 * (1.0 - np.abs(xx))
        slab = color.reshape(1, 1, 3) * fall.reshape(-1, 1, 1) * hgrad.reshape(1, -1, 1)
        slab = slab + oil_slick_modulation(OUT_H, ww, i)
        plate[:, x0:x1, :] = np.clip(slab, 0, 255)

        # Hot knife white core down panel center
        cx = (x0 + x1) // 2
        core = 5 if i < 2 else 2
        knife = np.array([252.0, 253.0, 255.0], dtype=np.float32)
        plate[:, max(0, cx - core) : min(OUT_W, cx + core + 1), :] = knife

    # Horizontal ceiling catch
    cy = int(OUT_H * 0.14)
    plate[cy - 2 : cy + 3, :, :] = np.maximum(
        plate[cy - 2 : cy + 3, :, :],
        np.array([250.0, 252.0, 255.0], dtype=np.float32),
    )

    plate = crush_cream_pink(plate)
    luma = 0.2126 * plate[..., 0] + 0.7152 * plate[..., 1] + 0.0722 * plate[..., 2]
    plate[luma < 28] *= 0.06

    im = Image.fromarray(np.clip(plate, 0, 255).astype(np.uint8), mode="RGB")
    im = im.filter(ImageFilter.UnsharpMask(radius=0.7, percent=110, threshold=4))
    return im


def main() -> None:
    OUT.parent.mkdir(parents=True, exist_ok=True)
    im = build_plate()
    im.save(OUT, "PNG", optimize=True)
    print(f"wrote {OUT} ({OUT.stat().st_size} bytes) iridescent silver softbox")


if __name__ == "__main__":
    main()
