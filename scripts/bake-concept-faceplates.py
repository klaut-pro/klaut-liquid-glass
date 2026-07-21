#!/usr/bin/env python3
"""
Bake atlas-aligned concept-art faceplates + normal hints.

Bold pivot off oil-multiplier plateau: project real chrome crops from
1c6PD / Z53Ve / ENj9B onto each glyph SDF atlas UV, then sample in-shader
as hybrid photo-plate chrome (faces filled, pink0, charcoal voids).

Outputs:
  demo/env/face-chromeSansP.png  RGB chrome, A = luma height hint
  demo/env/face-scriptProP.png
"""
from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter
from scipy.ndimage import distance_transform_edt, gaussian_filter

ROOT = Path(__file__).resolve().parents[1]
CONCEPT = ROOT.parent / "klaut.pro" / "concept_art"
ATLAS_DIR = ROOT / "demo" / "glyph-atlases"
OUT_DIR = ROOT / "demo" / "env"

SIZE = 512

# Manual crops tuned to isolated letterforms (stem+bowl / script p)
CROPS = {
    "chromeSansP": [
        # Z53Ve geometric chrome p — planar oil + drip
        ("Z53Ve.jpg", (248, 630, 425, 910), 1.0),
        # 1c6PD stem oil for richer gold/lime midtones
        ("1c6PD.jpg", (160, 740, 310, 1020), 0.55),
    ],
    "scriptProP": [
        # ENj9B molten script p (pink crushed later → silver tubular)
        ("ENj9B.jpg", (190, 620, 420, 940), 1.0),
        # Extra stem/drip metal from same plate
        ("ENj9B.jpg", (210, 780, 360, 980), 0.45),
    ],
}


def load_rgb(name: str) -> np.ndarray:
    path = CONCEPT / name
    if not path.exists():
        path = ROOT / "demo" / "qa-refs" / name
    return np.asarray(Image.open(path).convert("RGB"), dtype=np.float32)


def crush_pink_cream(rgb: np.ndarray, spare_oil: bool = True) -> np.ndarray:
    """pink0 + cream kill; spare lime/gold oil chroma."""
    out = rgb.copy()
    r, g, b = out[..., 0], out[..., 1], out[..., 2]
    chroma = out.max(-1) - out.min(-1)
    luma = 0.2126 * r + 0.7152 * g + 0.0722 * b
    lime = (g > r + 6) & (g > b + 4) & (chroma > 18)
    gold = (r > 110) & (g > 90) & (b < 145) & (chroma > 18) & (r > b + 8)
    spare = (lime | gold) if spare_oil else np.zeros_like(lime)
    softbox = (luma > 200) & (chroma < 30)
    pink = np.maximum(0.0, r - g * 1.05) * np.maximum(0.0, b - g * 0.88)
    pink = np.where(spare | softbox, pink * 0.08, pink)
    # Magenta body → neutral silver (script tubular elegance without pink flood)
    mag = np.maximum(0.0, r - g * 1.02) * np.maximum(0.0, b - g * 0.95)
    mag = np.where(spare, mag * 0.05, mag)
    cream = np.maximum(0.0, r - b * 1.05)
    cream = np.maximum(cream, np.maximum(0.0, g * 0.9 - b))
    cream = np.where(spare | softbox, cream * 0.12, cream)
    out[..., 0] = r - pink * 1.05 - mag * 0.95 - cream * 0.75
    out[..., 1] = g - cream * 0.35 + pink * 0.15 + mag * 0.25
    out[..., 2] = b - pink * 0.85 - mag * 0.7 - cream * 0.1
    # Rebalance toward cool silver when still magenta-heavy
    nr, ng, nb = out[..., 0], out[..., 1], out[..., 2]
    still_pink = np.maximum(0.0, nr - ng * 1.02) * np.maximum(0.0, nb - ng * 0.9)
    sil = 0.2126 * nr + 0.7152 * ng + 0.0722 * nb
    w = np.clip(still_pink * 1.4, 0.0, 1.0)[..., None]
    silver = np.stack([sil * 0.97, sil * 1.0, sil * 1.05], axis=-1)
    out = out * (1.0 - w) + silver * w
    return np.clip(out, 0.0, 255.0)


def atlas_mask(glyph_id: str) -> np.ndarray:
    mask_path = ATLAS_DIR / f"{glyph_id}-mask.png"
    sdf_path = ATLAS_DIR / f"{glyph_id}.png"
    if mask_path.exists():
        m = np.asarray(Image.open(mask_path).convert("L"), dtype=np.float32) / 255.0
        return m > 0.45
    # Fallback: SDF R channel inside
    sdf = np.asarray(Image.open(sdf_path).convert("RGBA"), dtype=np.float32)
    return sdf[..., 0] < 127.5


def crop_to_atlas(rgb: np.ndarray, box: tuple[int, int, int, int], mask: np.ndarray) -> np.ndarray:
    """Resize crop into atlas space; keep metal only inside glyph mask."""
    x0, y0, x1, y1 = box
    patch = rgb[y0:y1, x0:x1].copy()
    if patch.size == 0:
        return np.zeros((SIZE, SIZE, 3), dtype=np.float32)
    # Content-aware pad: find metal bbox inside crop, then fit to mask bbox
    luma = 0.2126 * patch[..., 0] + 0.7152 * patch[..., 1] + 0.0722 * patch[..., 2]
    chroma = patch.max(-1) - patch.min(-1)
    # Strict metal — kill circuit-board line bg (thin grey chroma)
    metal = (luma > 48) & (chroma > 16) & (luma < 248)
    # Also keep bright softbox cores on letter faces
    soft = (luma > 170) & (chroma < 40)
    keep = metal | soft
    patch = np.where(keep[..., None], patch, 0.0)
    ys, xs = np.where(keep)
    if len(ys) < 40:
        ys, xs = np.where(luma > 55)
    if len(ys) < 20:
        content = patch
    else:
        pad = 8
        cy0 = max(0, int(ys.min()) - pad)
        cy1 = min(patch.shape[0], int(ys.max()) + pad + 1)
        cx0 = max(0, int(xs.min()) - pad)
        cx1 = min(patch.shape[1], int(xs.max()) + pad + 1)
        content = patch[cy0:cy1, cx0:cx1]

    my, mx = np.where(mask)
    if len(my) < 10:
        return np.zeros((SIZE, SIZE, 3), dtype=np.float32)
    mpad = 4
    my0, my1 = max(0, int(my.min()) - mpad), min(SIZE, int(my.max()) + mpad + 1)
    mx0, mx1 = max(0, int(mx.min()) - mpad), min(SIZE, int(mx.max()) + mpad + 1)
    mh, mw = my1 - my0, mx1 - mx0

    resized = np.asarray(
        Image.fromarray(np.clip(content, 0, 255).astype(np.uint8)).resize(
            (mw, mh), Image.Resampling.LANCZOS
        ),
        dtype=np.float32,
    )
    out = np.zeros((SIZE, SIZE, 3), dtype=np.float32)
    out[my0:my1, mx0:mx1] = resized
    # Soft feather outside mask using distance
    outside = distance_transform_edt(~mask)
    feather = np.clip(1.0 - outside / 6.0, 0.0, 1.0)[..., None]
    out *= feather
    out *= mask[..., None].astype(np.float32)
    return out


def sobel_normals(luma: np.ndarray) -> np.ndarray:
    """Pack fake normals from luminance gradients into RG (0.5-centered)."""
    gy, gx = np.gradient(gaussian_filter(luma, sigma=1.2))
    # Invert Y for GL-ish up
    nx = -gx
    ny = gy
    nz = np.ones_like(luma) * 0.35
    n = np.stack([nx, ny, nz], axis=-1)
    n /= np.maximum(np.linalg.norm(n, axis=-1, keepdims=True), 1e-5)
    return (n * 0.5 + 0.5).astype(np.float32)


def bake_glyph(glyph_id: str) -> Image.Image:
    mask = atlas_mask(glyph_id)
    plate = np.zeros((SIZE, SIZE, 3), dtype=np.float32)
    weight = np.zeros((SIZE, SIZE), dtype=np.float32)

    for name, box, gain in CROPS[glyph_id]:
        rgb = crush_pink_cream(load_rgb(name))
        layer = crop_to_atlas(rgb, box, mask)
        layer = crush_pink_cream(layer)
        w = (layer.max(axis=-1) > 8).astype(np.float32) * float(gain)
        plate += layer * gain
        weight += w

    # Normalize overlaps
    w3 = np.maximum(weight, 1e-3)[..., None]
    plate = plate / w3
    plate = crush_pink_cream(plate)

    # Charcoal floor outside / low metal
    luma = 0.2126 * plate[..., 0] + 0.7152 * plate[..., 1] + 0.0722 * plate[..., 2]
    plate = np.where(mask[..., None], plate, 0.0)
    # Fill mask holes with local charcoal so faces stay opaque
    charcoal = np.array([18.0, 20.0, 26.0], dtype=np.float32)
    empty = mask & (luma < 12)
    plate[empty] = charcoal

    # Mild blur to kill crop alias, keep oil chroma
    im = Image.fromarray(np.clip(plate, 0, 255).astype(np.uint8), mode="RGB")
    im = im.filter(ImageFilter.GaussianBlur(radius=1.2))
    arr = crush_pink_cream(np.asarray(im, dtype=np.float32))

    # Script: boost silver structure (tubular elegance) — desat pink leftovers harder
    if glyph_id == "scriptProP":
        r, g, b = arr[..., 0], arr[..., 1], arr[..., 2]
        sil = 0.2126 * r + 0.7152 * g + 0.0722 * b
        chroma = arr.max(-1) - arr.min(-1)
        # Keep only cool silver + faint cyan fringe; crush warm/magenta
        cool = np.stack([sil * 0.96, sil * 1.0, sil * 1.06], axis=-1)
        keep = (chroma > 25) & (b > r + 8) & (b > g)  # cyan fringe only
        arr = np.where(keep[..., None], arr * 0.35 + cool * 0.65, cool)
        # Restore specular peaks from original luma
        peaks = sil > 160
        arr[peaks] = np.maximum(arr[peaks], np.stack([sil, sil, sil * 1.02], axis=-1)[peaks])

    # Chrome: keep concept oil chroma; mild gold lift; soft neon crush only
    if glyph_id == "chromeSansP":
        r, g, b = arr[..., 0], arr[..., 1], arr[..., 2]
        sil = 0.2126 * r + 0.7152 * g + 0.0722 * b
        mid = (sil > 40) & (sil < 200) & mask
        arr[mid, 0] = np.clip(arr[mid, 0] + 8.0, 0, 255)
        arr[mid, 1] = np.clip(arr[mid, 1] + 4.0, 0, 255)
        arr[mid, 2] = np.clip(arr[mid, 2] - 6.0, 0, 255)
        # Only crush extreme neon lime (keep oil midtones)
        neon = np.maximum(0.0, arr[..., 1] - arr[..., 0] * 1.18) * np.maximum(
            0.0, arr[..., 1] - arr[..., 2] * 1.12
        )
        neon = np.where(sil > 160, neon, neon * 0.35)
        w = np.clip(neon / 55.0, 0.0, 1.0)[..., None]
        cool = np.stack([sil * 1.05, sil * 0.95, sil * 0.65], axis=-1)
        arr = arr * (1.0 - w * 0.55) + cool * (w * 0.55)
        arr = crush_pink_cream(arr)

    arr *= mask[..., None].astype(np.float32)
    luma2 = 0.2126 * arr[..., 0] + 0.7152 * arr[..., 1] + 0.0722 * arr[..., 2]
    # Alpha = normalized height hint from luma (for normal perturbation)
    alpha = np.clip(luma2 / 255.0, 0.0, 1.0)
    alpha = gaussian_filter(alpha, sigma=1.0) * mask.astype(np.float32)

    rgba = np.dstack([np.clip(arr, 0, 255), alpha * 255.0]).astype(np.uint8)
    return Image.fromarray(rgba, mode="RGBA")


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for gid in ("chromeSansP", "scriptProP"):
        im = bake_glyph(gid)
        out = OUT_DIR / f"face-{gid}.png"
        im.save(out, "PNG", optimize=True)
        print(f"wrote {out} ({out.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
