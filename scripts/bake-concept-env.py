#!/usr/bin/env python3
"""
Bake concept-art-derived studio HDRI / reflection plate.

Blender unavailable — harvest wet-mirror chrome pixels from
1c6PD / Z53Ve / ENj9B and rebuild a frontal softbox plate for
NEAREST reflection sampling (planar knife + tubular wrap).

Iteration 26: contiguous wide softbox panels (not barcode columns /
random vertical patch spam). Cream crushed · pink crushed.
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


def metal_mask(rgb: np.ndarray) -> np.ndarray:
    luma = 0.2126 * rgb[..., 0] + 0.7152 * rgb[..., 1] + 0.0722 * rgb[..., 2]
    chroma = rgb.max(axis=-1) - rgb.min(axis=-1)
    return (luma > 55.0) & (chroma > 18.0) & (luma < 252.0)


def crush_cream_pink(rgb: np.ndarray) -> np.ndarray:
    """Kill warm cream + magenta/pink — keep cool cyan/lime/gold/silver."""
    out = rgb.copy()
    r, g, b = out[..., 0], out[..., 1], out[..., 2]
    cream = np.maximum(0.0, r - b * 1.05)
    cream = np.maximum(cream, np.maximum(0.0, g * 0.9 - b))
    pink = np.maximum(0.0, r - g * 1.08) * np.maximum(0.0, b - g * 0.95)
    pink = np.maximum(
        pink, np.maximum(0.0, r - g) * 0.55 * np.maximum(0.0, b - g * 0.85)
    )
    out[..., 0] = r - cream * 0.9 - pink * 0.95
    out[..., 1] = g - cream * 0.4
    out[..., 2] = b - pink * 0.6
    cool = np.maximum(0.0, out[..., 2] - out[..., 0])
    out[..., 1] = np.minimum(out[..., 1] + cool * 0.06, 255.0)
    out[..., 2] = np.minimum(out[..., 2] + cool * 0.1, 255.0)
    return np.clip(out, 0.0, 255.0)


def harvest_metal_colors(rgb: np.ndarray, mask: np.ndarray, n: int = 400) -> np.ndarray:
    ys, xs = np.where(mask)
    if len(xs) < 8:
        return np.zeros((0, 3), dtype=np.float32)
    chroma = (rgb.max(-1) - rgb.min(-1)) * mask.astype(np.float32)
    flat = chroma.ravel()
    k = min(n * 4, flat.size)
    top = np.argpartition(flat, -k)[-k:]
    rng = np.random.default_rng(11)
    pick = top[rng.permutation(len(top))[:n]]
    h, w = rgb.shape[:2]
    cols = []
    for idx in pick:
        y, x = divmod(int(idx), w)
        cols.append(rgb[y, x])
    return np.asarray(cols, dtype=np.float32)


def panel_palette(samples: np.ndarray) -> list[np.ndarray]:
    """
    Build 6–7 contiguous softbox panel colors from harvested metal.
    Prefer high-chroma cool accents + one near-white knife panel.
    """
    if samples.shape[0] < 10:
        return [
            np.array([40, 170, 220], dtype=np.float32),
            np.array([90, 220, 120], dtype=np.float32),
            np.array([230, 230, 240], dtype=np.float32),
            np.array([180, 210, 60], dtype=np.float32),
            np.array([50, 140, 200], dtype=np.float32),
            np.array([200, 190, 70], dtype=np.float32),
        ]

    luma = 0.2126 * samples[:, 0] + 0.7152 * samples[:, 1] + 0.0722 * samples[:, 2]
    chroma = samples.max(1) - samples.min(1)

    def mean_of(sel: np.ndarray, fallback: np.ndarray) -> np.ndarray:
        if sel.sum() < 3:
            return fallback.astype(np.float32)
        return samples[sel].mean(axis=0).astype(np.float32)

    white = mean_of((luma > 190) & (chroma < 55), np.array([235, 240, 250]))
    cyan = mean_of((samples[:, 2] > samples[:, 0] + 25) & (luma > 90), np.array([45, 185, 230]))
    lime = mean_of((samples[:, 1] > samples[:, 0] + 20) & (samples[:, 1] > samples[:, 2]), np.array([110, 225, 90]))
    gold = mean_of((samples[:, 0] > 160) & (samples[:, 1] > 130) & (samples[:, 2] < 120), np.array([210, 185, 55]))
    teal = mean_of((samples[:, 1] > 100) & (samples[:, 2] > 140) & (luma > 80), np.array([55, 175, 195]))
    cool_mid = mean_of((luma > 70) & (luma < 160) & (chroma > 30), np.array([70, 150, 185]))

    # Desaturate pink leftovers in palette
    panels = [cyan, teal, white, lime, cool_mid, gold]
    out = []
    for p in panels:
        p = crush_cream_pink(p.reshape(1, 1, 3)).reshape(3)
        # Bias white toward cool silver (never cream)
        if p.mean() > 200:
            p = np.array([min(255, p[0] * 0.94), min(255, max(p[1], 235)), min(255, max(p[2], 245))])
        out.append(p)
    return out


def build_plate() -> Image.Image:
    srcs = [
        ("1c6PD.jpg", 1.15),
        ("Z53Ve.jpg", 1.0),
        ("ENj9B.jpg", 0.35),  # tubular chrome accents only — avoid pink flood
    ]
    samples: list[np.ndarray] = []
    weights: list[float] = []
    for name, wgt in srcs:
        rgb = crush_cream_pink(load_rgb(name))
        m = metal_mask(rgb)
        cols = harvest_metal_colors(rgb, m, n=350 if "EN" not in name else 120)
        if cols.shape[0]:
            samples.append(cols)
            weights.extend([wgt] * len(cols))

    if samples:
        all_c = np.concatenate(samples, axis=0)
        # Weighted resample toward chromeSans refs
        warr = np.asarray(weights, dtype=np.float64)
        warr /= warr.sum()
        rng = np.random.default_rng(3)
        idx = rng.choice(len(all_c), size=min(800, len(all_c)), replace=True, p=warr)
        palette = panel_palette(all_c[idx])
    else:
        palette = panel_palette(np.zeros((0, 3)))

    plate = np.zeros((OUT_H, OUT_W, 3), dtype=np.float32)

    # Contiguous wide softbox slabs — planar knife wet-mirror (not barcode)
    # Layout: dark void | panel | void | panel ... with hard edges
    n = len(palette)
    # Panel fractional widths (sum with voids ≈ 1)
    panel_w = [0.11, 0.09, 0.13, 0.10, 0.09, 0.11][:n]
    void_w = 0.045
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
        # Soft vertical luminance within panel (studio softbox falloff) — continuous
        yy = np.linspace(0, 1, OUT_H, dtype=np.float32)
        # Top brighter (ceiling softbox), slight bottom fade — no vertical shred
        fall = 0.72 + 0.35 * np.exp(-((yy - 0.18) ** 2) / 0.08)
        fall = fall * (0.88 + 0.12 * np.sin(yy * 3.14159))
        # Tiny horizontal gradient inside panel (planar face read, not barcode)
        xx = np.linspace(-1, 1, max(1, x1 - x0), dtype=np.float32)
        hgrad = 0.92 + 0.08 * (1.0 - np.abs(xx))
        slab = color.reshape(1, 1, 3) * fall.reshape(-1, 1, 1) * hgrad.reshape(1, -1, 1)
        # Mild iridescent tilt per panel (concept oil-slick) — smooth only
        tilt = np.array(
            [
                1.0 + 0.04 * np.sin(i * 1.7),
                1.0 + 0.05 * np.cos(i * 1.3),
                1.0 + 0.06 * np.sin(i * 0.9 + 0.5),
            ],
            dtype=np.float32,
        )
        slab *= tilt.reshape(1, 1, 3)
        plate[:, x0:x1, :] = np.clip(slab, 0, 255)

        # Knife white core at panel center
        cx = (x0 + x1) // 2
        core = 2 if pw < 0.1 else 3
        knife = np.array(
            [
                min(255, color[0] * 0.55 + 200),
                min(255, max(color[1], 235)),
                min(255, max(color[2], 248)),
            ],
            dtype=np.float32,
        )
        plate[:, max(0, cx - core) : min(OUT_W, cx + core + 1), :] = knife

    # Horizontal ceiling catch — single hard bar
    cy = int(OUT_H * 0.15)
    plate[cy - 2 : cy + 3, :, :] = np.maximum(
        plate[cy - 2 : cy + 3, :, :],
        np.array([240, 245, 255], dtype=np.float32),
    )

    # No random concept patch mosaic — that reintroduced vertical shred / cyan wash.
    # Panel colors are already concept-harvested; keep contiguous softbox slabs.

    plate = crush_cream_pink(plate)
    # Deepen interstitial voids for knife contrast
    luma2 = 0.2126 * plate[..., 0] + 0.7152 * plate[..., 1] + 0.0722 * plate[..., 2]
    void = luma2 < 28
    plate[void] *= 0.15
    # Crush residual pink
    r, g, b = plate[..., 0], plate[..., 1], plate[..., 2]
    pink = np.maximum(0.0, r - g * 1.05) * np.maximum(0.0, b - g * 0.9)
    plate[..., 0] = r - pink * 0.9
    plate[..., 2] = b - pink * 0.55

    im = Image.fromarray(np.clip(plate, 0, 255).astype(np.uint8), mode="RGB")
    # Mild unsharp — keep panel edges; avoid amplifying barcode
    im = im.filter(ImageFilter.UnsharpMask(radius=0.8, percent=90, threshold=8))
    return im


def main() -> None:
    OUT.parent.mkdir(parents=True, exist_ok=True)
    im = build_plate()
    im.save(OUT, "PNG", optimize=True)
    print(f"wrote {OUT} ({OUT.stat().st_size} bytes) from concept HDRI harvest (wide panels)")


if __name__ == "__main__":
    main()
