#!/usr/bin/env python3
"""
Bake concept-art-derived studio HDRI / reflection plate.

Blender unavailable — frontal softbox plate for reflection sampling
(planar wet-mirror + tubular wrap).

Iteration 33: rich planar oil-slick wet-mirror —
dark charcoal base + distinct softbox whites + concept-harvested
iridescent accents (cyan/lime/gold). No neon lime flood, no cream
matte wash, no pink, no barcode columns.
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
    return (luma > 48.0) & (chroma > 14.0) & (luma < 250.0)


def crush_cream_pink(rgb: np.ndarray, spare_oil: bool = True) -> np.ndarray:
    """Kill warm cream + magenta + cyan milk; spare softbox whites + lime/gold oil."""
    out = rgb.copy()
    r, g, b = out[..., 0], out[..., 1], out[..., 2]
    chroma = out.max(-1) - out.min(-1)
    luma = 0.2126 * r + 0.7152 * g + 0.0722 * b
    lime = (g > r + 8) & (g > b + 6) & (chroma > 22)
    gold = (r > 120) & (g > 95) & (b < 130) & (chroma > 22) & (r > b + 10)
    spare = (lime | gold) if spare_oil else np.zeros_like(lime)
    softbox = (luma > 180) & (chroma < 28)  # bright near-white — never crush
    cream = np.maximum(0.0, r - b * 1.05)
    cream = np.maximum(cream, np.maximum(0.0, g * 0.88 - b))
    cream = np.where(spare | softbox, cream * 0.1, cream)
    pink = np.maximum(0.0, r - g * 1.08) * np.maximum(0.0, b - g * 0.95)
    pink = np.where(softbox, 0.0, pink)
    lime_neon = np.maximum(0.0, g - r * 1.12) * np.maximum(0.0, g - b * 1.08)
    lime_neon = np.where(chroma > 70, lime_neon, 0.0)
    # Cyan milk/flood only when truly B-dominant chromatic (NOT softbox white)
    cyan_flood = np.maximum(0.0, b - r * 1.02) * np.maximum(0.0, b - g * 0.95)
    cyan_flood = np.where((chroma > 28) & (b > r + 12) & ~softbox & ~spare, cyan_flood, 0.0)
    cyan_milk = np.maximum(0.0, b - r * 0.95) * (1.0 - np.clip(chroma / 85.0, 0.0, 1.0))
    cyan_milk = np.where(softbox | spare, 0.0, cyan_milk)
    out[..., 0] = r - cream * 0.8 - pink * 0.98 - lime_neon * 0.15 + cyan_milk * 0.2
    out[..., 1] = g - cream * 0.3 - lime_neon * 0.55 + cyan_milk * 0.08
    out[..., 2] = b - pink * 0.8 - cyan_flood * 0.65 - cyan_milk * 0.8
    lav = np.maximum(0.0, out[..., 2] - out[..., 0] * 0.98)
    lav = np.where(spare | softbox, 0.0, lav)
    out[..., 0] = out[..., 0] + lav * 0.2
    out[..., 2] = out[..., 2] - lav * 0.45
    return np.clip(out, 0.0, 255.0)


def soft_ellipse(yy: np.ndarray, xx: np.ndarray, cy: float, cx: float, ry: float, rx: float) -> np.ndarray:
    q = ((yy - cy) / max(ry, 1e-4)) ** 2 + ((xx - cx) / max(rx, 1e-4)) ** 2
    return np.clip(1.0 - q, 0.0, 1.0) ** 1.45


def planar_oil_field(h: int, w: int) -> np.ndarray:
    """Sparse oil-slick accents — lime↔gold primary, cyan whisper (not cyan flood)."""
    yy = np.linspace(0, 1, h, dtype=np.float32).reshape(-1, 1)
    xx = np.linspace(0, 1, w, dtype=np.float32).reshape(1, -1)
    phase = yy * 3.1 + xx * 1.85
    phase2 = yy * 1.55 - xx * 2.4 + 0.4
    lime = 0.5 + 0.5 * np.sin(phase * 1.55)
    gold = 0.5 + 0.5 * np.sin(phase * 1.55 + 2.1)
    cyan = 0.5 + 0.5 * np.sin(phase2 * 1.2 + 0.8)
    wash = 0.35 + 0.45 * (0.5 + 0.5 * np.sin(phase2 * 0.95))
    puddle = soft_ellipse(yy, xx, 0.32, 0.38, 0.42, 0.48)
    puddle = np.maximum(puddle, soft_ellipse(yy, xx, 0.52, 0.6, 0.36, 0.42) * 0.75)
    puddle = np.maximum(puddle, soft_ellipse(yy, xx, 0.26, 0.7, 0.28, 0.32) * 0.55)
    puddle = np.maximum(puddle, soft_ellipse(yy, xx, 0.64, 0.3, 0.3, 0.34) * 0.5)
    mod = np.zeros((h, w, 3), dtype=np.float32)
    # Lime/gold lead; cyan as thin accent only
    mod[..., 0] = (-8.0 * lime + 32.0 * gold - 4.0 * cyan) * wash * puddle
    mod[..., 1] = (30.0 * lime + 12.0 * gold + 4.0 * cyan) * wash * puddle
    mod[..., 2] = (-14.0 * lime - 20.0 * gold + 12.0 * cyan) * wash * puddle
    return mod


def harvest_oil_patches() -> list[np.ndarray]:
    """Soft concept metal patches for oil-slick reflection fidelity."""
    patches: list[np.ndarray] = []
    rng = np.random.default_rng(33)
    for name, n in (("1c6PD.jpg", 28), ("Z53Ve.jpg", 22), ("ENj9B.jpg", 10)):
        try:
            rgb = crush_cream_pink(load_rgb(name))
        except OSError:
            continue
        m = metal_mask(rgb)
        chroma = rgb.max(-1) - rgb.min(-1)
        score = chroma * m.astype(np.float32)
        flat = score.ravel()
        if flat.size < 100:
            continue
        top_n = min(1800, flat.size)
        top = np.argpartition(flat, -top_n)[-top_n:]
        top = top[rng.permutation(len(top))]
        h, w, _ = rgb.shape
        ps = 64
        got = 0
        for idx in top:
            if got >= n:
                break
            y, x = divmod(int(idx), w)
            y0 = max(0, y - ps // 2)
            x0 = max(0, x - ps // 2)
            y1 = min(h, y0 + ps)
            x1 = min(w, x0 + ps)
            patch = rgb[y0:y1, x0:x1]
            if patch.shape[0] < ps // 2 or patch.shape[1] < ps // 2:
                continue
            # Prefer chromatic oil (skip near-white softbox cores)
            pl = 0.2126 * patch[..., 0] + 0.7152 * patch[..., 1] + 0.0722 * patch[..., 2]
            pc = patch.max(-1) - patch.min(-1)
            if float(pc.mean()) < 18 and float(pl.mean()) > 200:
                continue
            patches.append(patch)
            got += 1
    return patches


def stamp_soft_patch(plate: np.ndarray, patch: np.ndarray, cy: float, cx: float, ry: float, rx: float, gain: float) -> None:
    """Stamp a concept patch as a soft elliptical oil puddle (anti barcode)."""
    h, w, _ = plate.shape
    yy = np.linspace(0, 1, h, dtype=np.float32).reshape(-1, 1)
    xx = np.linspace(0, 1, w, dtype=np.float32).reshape(1, -1)
    lobe = soft_ellipse(yy, xx, cy, cx, ry, rx) * gain
    if float(lobe.max()) < 0.02:
        return
    # Resize patch to cover ellipse bbox
    y0 = max(0, int((cy - ry) * h))
    y1 = min(h, int((cy + ry) * h) + 1)
    x0 = max(0, int((cx - rx) * w))
    x1 = min(w, int((cx + rx) * w) + 1)
    bh, bw = y1 - y0, x1 - x0
    if bh < 8 or bw < 8:
        return
    resized = np.asarray(
        Image.fromarray(np.clip(patch, 0, 255).astype(np.uint8)).resize(
            (bw, bh), Image.Resampling.LANCZOS
        ),
        dtype=np.float32,
    )
    resized = crush_cream_pink(resized)
    alpha = lobe[y0:y1, x0:x1][..., None]
    dest = plate[y0:y1, x0:x1]
    plate[y0:y1, x0:x1] = dest * (1.0 - alpha * 0.72) + resized * (alpha * 0.72)


def build_plate() -> Image.Image:
    yy = np.linspace(0, 1, OUT_H, dtype=np.float32).reshape(-1, 1)
    xx = np.linspace(0, 1, OUT_W, dtype=np.float32).reshape(1, -1)

    # Dark charcoal wet-mirror floor (not cream mid)
    plate = np.zeros((OUT_H, OUT_W, 3), dtype=np.float32)
    plate[..., 0] = 10.0
    plate[..., 1] = 11.0
    plate[..., 2] = 14.0

    # Distinct softbox cluster — luminance contrast for planar wet-mirror
    softboxes = [
        (0.16, 0.26, 0.18, 0.26, np.array([255.0, 255.0, 255.0]), 1.2),
        (0.2, 0.5, 0.16, 0.22, np.array([248.0, 250.0, 255.0]), 1.05),
        (0.14, 0.72, 0.14, 0.18, np.array([235.0, 240.0, 252.0]), 0.92),
        (0.36, 0.36, 0.22, 0.32, np.array([165.0, 175.0, 195.0]), 0.7),
        (0.4, 0.6, 0.2, 0.26, np.array([140.0, 150.0, 170.0]), 0.58),
        (0.54, 0.24, 0.18, 0.22, np.array([120.0, 130.0, 150.0]), 0.5),
        (0.56, 0.52, 0.24, 0.34, np.array([95.0, 105.0, 125.0]), 0.42),
        (0.68, 0.38, 0.2, 0.28, np.array([70.0, 78.0, 95.0]), 0.32),
        # Deep interstitial voids
        (0.46, 0.82, 0.3, 0.16, np.array([18.0, 20.0, 26.0]), 0.7),
        (0.3, 0.1, 0.24, 0.14, np.array([14.0, 16.0, 22.0]), 0.6),
        (0.72, 0.7, 0.22, 0.2, np.array([16.0, 18.0, 24.0]), 0.55),
    ]

    for cy, cx, ry, rx, color, gain in softboxes:
        lobe = soft_ellipse(yy, xx, cy, cx, ry, rx) * gain
        lobe = lobe ** 0.68
        plate = plate + color.reshape(1, 1, 3) * lobe[..., None]

    ceil = np.exp(-((yy - 0.1) ** 2) / 0.014) * (0.45 + 0.55 * np.sin(xx * np.pi * 1.15))
    plate = plate + np.array([255.0, 255.0, 255.0]).reshape(1, 1, 3) * (ceil * 0.5)[..., None]

    # Concept-harvested oil puddles (soft ellipses — never barcode columns)
    # Prefer lime/gold patches; skip cyan-milk concept harvest flood
    patches = harvest_oil_patches()
    rng = np.random.default_rng(33)
    stamped = 0
    for patch in patches:
        if stamped >= 28:
            break
        pl = 0.2126 * patch[..., 0] + 0.7152 * patch[..., 1] + 0.0722 * patch[..., 2]
        pb = patch[..., 2].mean()
        pr = patch[..., 0].mean()
        if float(pb) > float(pr) + 18:
            continue  # skip cyan-dominant patches
        cy = float(rng.uniform(0.2, 0.68))
        cx = float(rng.uniform(0.2, 0.8))
        ry = float(rng.uniform(0.1, 0.22))
        rx = float(rng.uniform(0.12, 0.26))
        gain = float(rng.uniform(0.28, 0.55))
        stamp_soft_patch(plate, patch, cy, cx, ry, rx, gain)
        stamped += 1

    plate = plate + planar_oil_field(OUT_H, OUT_W)

    vignette = soft_ellipse(yy, xx, 0.48, 0.5, 0.84, 0.9)
    plate = plate * (0.1 + 0.9 * vignette[..., None])

    plate = np.clip(plate, 0, 255)
    plate = crush_cream_pink(plate, spare_oil=True)
    luma = 0.2126 * plate[..., 0] + 0.7152 * plate[..., 1] + 0.0722 * plate[..., 2]
    # Crush near-black noise; keep softbox voids dark
    plate[luma < 12] *= 0.05

    im = Image.fromarray(np.clip(plate, 0, 255).astype(np.uint8), mode="RGB")
    # Mild blur — keep softbox + oil contrast (heavy blur → flat cream matte)
    im = im.filter(ImageFilter.GaussianBlur(radius=10))
    arr = np.asarray(im, dtype=np.float32)
    arr = crush_cream_pink(arr, spare_oil=True)
    mid = 100.0
    arr = mid + (arr - mid) * 1.22
    arr = np.clip(arr, 0, 255)
    # Ensure softbox peak floor after crush
    luma2 = 0.2126 * arr[..., 0] + 0.7152 * arr[..., 1] + 0.0722 * arr[..., 2]
    peak_mask = luma2 > 160
    arr[peak_mask] = np.maximum(arr[peak_mask], np.array([235.0, 238.0, 245.0]))
    im = Image.fromarray(arr.astype(np.uint8), mode="RGB")
    im = im.filter(ImageFilter.GaussianBlur(radius=3))
    return im


def main() -> None:
    OUT.parent.mkdir(parents=True, exist_ok=True)
    im = build_plate()
    im.save(OUT, "PNG", optimize=True)
    print(f"wrote {OUT} ({OUT.stat().st_size} bytes) charcoal softbox + rich oil-slick (no barcode)")


if __name__ == "__main__":
    main()
