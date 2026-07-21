#!/usr/bin/env python3
"""
Bake concept-art-derived studio HDRI / reflection plate.

Blender unavailable — frontal softbox plate for NEAREST reflection
sampling (planar knife + tubular wrap).

Iteration 29: richer planar oil-slick — silver softbox panels carry
lime↔gold iridescent wash (not silver-mono); thin cyan edge fringe only;
no magenta / cyan-milk face flood.
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
    # Cyan milk (low-chroma B>R) → silver; spare thin high-chroma fringe
    cyan_milk = np.maximum(0.0, b - r * 0.95) * (1.0 - np.clip(chroma / 90.0, 0.0, 1.0))
    cyan_milk = np.where(spare, 0.0, cyan_milk)
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
    Silver-first knife softbox — 4 panels; silver carries oil wash;
    lime/gold accents wider for planar iridescence sampling.
    """
    return [
        np.array([242.0, 246.0, 252.0]),  # knife white (slight cool)
        np.array([178.0, 186.0, 198.0]),  # neutral chrome
        np.array([72.0, 215.0, 68.0]),    # lime accent
        np.array([220.0, 190.0, 48.0]),   # gold accent
    ]


def oil_slick_modulation(h: int, w: int, panel_idx: int) -> np.ndarray:
    """Per-panel oil-slick: richer lime↔gold planar wash + thin cyan edge fringe."""
    yy = np.linspace(0, 1, h, dtype=np.float32).reshape(-1, 1)
    xx = np.linspace(0, 1, w, dtype=np.float32).reshape(1, -1)
    # Diagonal oil phase — iridescent planar faces (1c6PD/Z53Ve)
    phase = yy * 5.2 + xx * 2.8 + panel_idx * 1.35
    lime = 0.5 + 0.5 * np.sin(phase * 2.15)
    gold = 0.5 + 0.5 * np.sin(phase * 2.15 + 2.05)
    # Broader wash envelope (not sparse streak-only)
    wash = 0.55 + 0.45 * (0.5 + 0.5 * np.sin(phase * 0.85 + 0.4))
    # Edge fringe only (not face flood)
    edge = np.minimum(xx, 1.0 - xx)
    thin_cyan = np.clip(1.0 - edge / 0.07, 0.0, 1.0) * 0.22
    mod = np.zeros((h, w, 3), dtype=np.float32)
    if panel_idx < 2:
        # Silver panels: richer oil-slick chroma on silver (planar wet-mirror)
        mod[..., 0] = (-10.0 * lime + 22.0 * gold) * wash
        mod[..., 1] = (18.0 * lime + 8.0 * gold) * wash
        mod[..., 2] = (-12.0 * lime - 16.0 * gold) * wash + 8.0 * thin_cyan
        mod *= 1.15
    elif panel_idx == 2:
        # Lime panel: keep green dominant, gold flecks
        mod[..., 0] = 12.0 * gold * wash
        mod[..., 1] = 14.0 * lime * wash
        mod[..., 2] = -16.0 * lime * wash + 6.0 * thin_cyan
    else:
        # Gold panel: warm, crush cream drift
        mod[..., 0] = 10.0 * gold * wash
        mod[..., 1] = (6.0 * gold - 6.0 * lime) * wash
        mod[..., 2] = -22.0 * gold * wash + 5.0 * thin_cyan
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

    # Wider lime/gold for face UV to sample oil panels; voids keep knife contrast
    n = len(palette)
    panel_w = [0.22, 0.2, 0.14, 0.14]
    void_w = 0.075
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
    print(f"wrote {OUT} ({OUT.stat().st_size} bytes) richer planar oil-slick softbox")


if __name__ == "__main__":
    main()
