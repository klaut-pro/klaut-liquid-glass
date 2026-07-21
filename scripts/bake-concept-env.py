#!/usr/bin/env python3
"""
Bake concept-art-derived studio HDRI / reflection plate.

Blender unavailable — instead harvest wet-mirror chrome pixels from
1c6PD / Z53Ve / ENj9B and rebuild a frontal softbox + latlong hybrid plate
for NEAREST reflection sampling (planar knife + tubular wrap).

Cream crushed · pink crushed (user request). Cool cyan/lime/gold accents only.
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
        # fallback: demo/qa-refs
        path = ROOT / "demo" / "qa-refs" / name
    im = Image.open(path).convert("RGB")
    return np.asarray(im, dtype=np.float32)


def metal_mask(rgb: np.ndarray) -> np.ndarray:
    luma = 0.2126 * rgb[..., 0] + 0.7152 * rgb[..., 1] + 0.0722 * rgb[..., 2]
    chroma = rgb.max(axis=-1) - rgb.min(axis=-1)
    # Letter chrome: bright + chromatic; skip dim brain/circuit haze
    return (luma > 55.0) & (chroma > 18.0) & (luma < 252.0)


def crush_cream_pink(rgb: np.ndarray) -> np.ndarray:
    """Kill warm cream + magenta/pink — keep cool cyan/lime/gold."""
    out = rgb.copy()
    r, g, b = out[..., 0], out[..., 1], out[..., 2]
    # Cream / peach: high R+G vs B
    cream = np.maximum(0.0, r - b * 1.05)
    cream = np.maximum(cream, np.maximum(0.0, g * 0.9 - b))
    # Pink / magenta: high R+B vs G
    pink = np.maximum(0.0, r - g * 1.08) * np.maximum(0.0, b - g * 0.95)
    pink = np.maximum(pink, np.maximum(0.0, r - g) * 0.55 * np.maximum(0.0, b - g * 0.85))
    out[..., 0] = r - cream * 0.85 - pink * 0.9
    out[..., 1] = g - cream * 0.35
    out[..., 2] = b - pink * 0.55
    # Bias leftover toward cool silver-cyan
    cool = np.maximum(0.0, out[..., 2] - out[..., 0])
    out[..., 1] = np.minimum(out[..., 1] + cool * 0.08, 255.0)
    out[..., 2] = np.minimum(out[..., 2] + cool * 0.12, 255.0)
    return np.clip(out, 0.0, 255.0)


def column_profile(rgb: np.ndarray, mask: np.ndarray, bins: int = 256) -> np.ndarray:
    """Average metal color per horizontal bin — softbox columns from real faces."""
    h, w, _ = rgb.shape
    profile = np.zeros((bins, 3), dtype=np.float64)
    counts = np.zeros(bins, dtype=np.float64)
    ys, xs = np.where(mask)
    if len(xs) == 0:
        return np.zeros((bins, 3), dtype=np.float32)
    for x, y in zip(xs, ys):
        bi = int(x / w * bins)
        bi = min(bins - 1, max(0, bi))
        profile[bi] += rgb[y, x]
        counts[bi] += 1.0
    # Fill empty bins by neighbor interpolate
    for i in range(bins):
        if counts[i] < 1:
            # search nearest populated
            for d in range(1, bins):
                L, R = i - d, i + d
                if L >= 0 and counts[L] > 0:
                    profile[i] = profile[L] / counts[L]
                    counts[i] = 1.0
                    break
                if R < bins and counts[R] > 0:
                    profile[i] = profile[R] / counts[R]
                    counts[i] = 1.0
                    break
        else:
            profile[i] /= counts[i]
    return profile.astype(np.float32)


def harvest_patches(rgb: np.ndarray, mask: np.ndarray, n: int = 48, ps: int = 48) -> list[np.ndarray]:
    """Random high-chroma metal patches for reflection mosaic."""
    ys, xs = np.where(mask)
    if len(xs) < 10:
        return []
    chroma = rgb.max(-1) - rgb.min(-1)
    score = chroma * mask.astype(np.float32)
    picks: list[np.ndarray] = []
    h, w, _ = rgb.shape
    rng = np.random.default_rng(42)
    # Prefer high-score pixels
    flat = score.ravel()
    top = np.argpartition(flat, -min(2000, flat.size))[-min(2000, flat.size) :]
    top = top[rng.permutation(len(top))[: n * 3]]
    for idx in top:
        if len(picks) >= n:
            break
        y, x = divmod(int(idx), w)
        y0 = max(0, y - ps // 2)
        x0 = max(0, x - ps // 2)
        y1 = min(h, y0 + ps)
        x1 = min(w, x0 + ps)
        patch = rgb[y0:y1, x0:x1]
        if patch.shape[0] < ps // 2 or patch.shape[1] < ps // 2:
            continue
        picks.append(patch)
    return picks


def build_plate() -> Image.Image:
    srcs = [
        ("1c6PD.jpg", 1.0),
        ("Z53Ve.jpg", 0.85),
        ("ENj9B.jpg", 0.55),
    ]
    profiles: list[tuple[np.ndarray, float]] = []
    patches: list[np.ndarray] = []
    for name, wgt in srcs:
        rgb = crush_cream_pink(load_rgb(name))
        m = metal_mask(rgb)
        profiles.append((column_profile(rgb, m, bins=384), wgt))
        patches.extend(harvest_patches(rgb, m, n=24 if "EN" not in name else 12, ps=56))

    # Blend column profiles
    bins = profiles[0][0].shape[0]
    col = np.zeros((bins, 3), dtype=np.float64)
    wsum = 0.0
    for p, w in profiles:
        col += p.astype(np.float64) * w
        wsum += w
    col = (col / max(wsum, 1e-6)).astype(np.float32)
    col = crush_cream_pink(col.reshape(1, bins, 3)).reshape(bins, 3)

    # Base: charcoal interstitial (wet-mirror voids)
    plate = np.zeros((OUT_H, OUT_W, 3), dtype=np.float32)

    # Concept-derived softbox columns — width from local brightness peaks
    luma = 0.2126 * col[:, 0] + 0.7152 * col[:, 1] + 0.0722 * col[:, 2]
    # Smooth for panel detection
    kern = np.array([1, 2, 3, 4, 5, 4, 3, 2, 1], dtype=np.float32)
    kern /= kern.sum()
    pad = len(kern) // 2
    lum_s = np.convolve(np.pad(luma, pad, mode="edge"), kern, mode="valid")

    # Paint continuous concept columns with horizontal variation (not pure strip paint)
    for x in range(OUT_W):
        bi = int(x / OUT_W * (bins - 1))
        c = col[bi]
        peak = float(lum_s[bi] / 255.0)
        left = lum_s[max(0, bi - 3)]
        right = lum_s[min(bins - 1, bi + 3)]
        contrast = abs(float(lum_s[bi] - 0.5 * (left + right))) / 255.0
        strength = 0.08 + 0.55 * peak + 1.1 * contrast
        plate[:, x, :] = c * np.clip(strength, 0.0, 1.35)

    # Stronger 2D concept patch mosaic — wet-mirror fidelity over column paint
    rng = np.random.default_rng(7)
    for i, patch in enumerate(patches):
        ph, pw, _ = patch.shape
        cx = int(rng.uniform(0.04, 0.96) * OUT_W)
        cy = int(rng.uniform(0.05, 0.72) * OUT_H)
        strip_h = int(rng.uniform(OUT_H * 0.22, OUT_H * 0.7))
        strip_w = max(10, int(pw * rng.uniform(1.2, 3.5)))
        resized = np.asarray(
            Image.fromarray(patch.astype(np.uint8)).resize((strip_w, strip_h), Image.Resampling.LANCZOS),
            dtype=np.float32,
        )
        resized = crush_cream_pink(resized)
        # Mild horizontal blur so reflections aren't barcode
        from PIL import ImageFilter as IF

        blurred = np.asarray(
            Image.fromarray(resized.astype(np.uint8)).filter(IF.GaussianBlur(radius=0.6)),
            dtype=np.float32,
        )
        x0 = max(0, cx - strip_w // 2)
        y0 = max(0, cy - strip_h // 2)
        x1 = min(OUT_W, x0 + strip_w)
        y1 = min(OUT_H, y0 + strip_h)
        rw, rh = x1 - x0, y1 - y0
        if rw < 2 or rh < 2:
            continue
        src = blurred[:rh, :rw]
        dest = plate[y0:y1, x0:x1]
        blend = np.clip(src / 255.0, 0, 1)
        alpha = 0.45 + 0.5 * blend.max(axis=-1, keepdims=True)
        plate[y0:y1, x0:x1] = dest * (1.0 - alpha) + src * alpha

    # Horizontal softbox bar (ceiling catch)
    cy = int(OUT_H * 0.16)
    plate[cy - 2 : cy + 3, :, :] = np.maximum(plate[cy - 2 : cy + 3, :, :], 220.0)

    # Razor knife cores on brightest concept columns
    peaks = []
    for i in range(8, bins - 8):
        if lum_s[i] >= lum_s[i - 1] and lum_s[i] >= lum_s[i + 1] and lum_s[i] > 90:
            peaks.append(i)
    # Keep top peaks
    peaks = sorted(peaks, key=lambda i: lum_s[i], reverse=True)[:14]
    for bi in peaks:
        cx = int(bi / bins * OUT_W)
        core = 2 if lum_s[bi] < 160 else 3
        c = np.maximum(col[bi], 200.0)
        # Cool white core — never cream
        c = np.array([min(255, c[0] * 0.92), min(255, max(c[1], 230)), min(255, max(c[2], 245))])
        plate[:, max(0, cx - core) : min(OUT_W, cx + core + 1), :] = c

    plate = crush_cream_pink(plate)
    # Deepen interstitial voids
    luma2 = 0.2126 * plate[..., 0] + 0.7152 * plate[..., 1] + 0.0722 * plate[..., 2]
    void = luma2 < 40
    plate[void] *= 0.25

    im = Image.fromarray(np.clip(plate, 0, 255).astype(np.uint8), mode="RGB")
    # Tiny sharpen so NEAREST sampling keeps knife edges
    im = im.filter(ImageFilter.UnsharpMask(radius=1.2, percent=140, threshold=6))
    return im


def main() -> None:
    OUT.parent.mkdir(parents=True, exist_ok=True)
    im = build_plate()
    im.save(OUT, "PNG", optimize=True)
    print(f"wrote {OUT} ({OUT.stat().st_size} bytes) from concept HDRI harvest")


if __name__ == "__main__":
    main()
