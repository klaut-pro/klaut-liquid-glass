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
# Boxes are (x0,y0,x1,y1) on 784×1168 concept plates.
CROPS = {
    "chromeSansP": [
        # Z53Ve geometric chrome p — planar oil + softbox (wider, cleaner metal)
        ("Z53Ve.jpg", (230, 620, 455, 930), 1.0),
        # 1c6PD stem/bowl oil for richer gold/lime/cyan midtones
        ("1c6PD.jpg", (145, 700, 330, 1040), 0.72),
        # Z53Ve drip-adjacent oil accents
        ("Z53Ve.jpg", (210, 820, 380, 1000), 0.4),
        # 1c6PD upper bowl iridescence
        ("1c6PD.jpg", (170, 640, 340, 820), 0.5),
    ],
    "scriptProP": [
        # ENj9B molten script p (full bowl+stem)
        ("ENj9B.jpg", (175, 600, 450, 960), 1.0),
        # Extra stem/drip metal — tubular crest highlights
        ("ENj9B.jpg", (200, 760, 380, 1000), 0.55),
        # Bowl loop tubular wrap
        ("ENj9B.jpg", (250, 580, 460, 780), 0.45),
    ],
}


def load_rgb(name: str) -> np.ndarray:
    path = CONCEPT / name
    if not path.exists():
        path = ROOT / "demo" / "qa-refs" / name
    return np.asarray(Image.open(path).convert("RGB"), dtype=np.float32)


def crush_pink_cream(rgb: np.ndarray, spare_oil: bool = True, keep_oil_chroma: float = 1.0) -> np.ndarray:
    """pink0 + cream kill; spare lime/gold/cyan oil chroma."""
    out = rgb.copy()
    r, g, b = out[..., 0], out[..., 1], out[..., 2]
    chroma = out.max(-1) - out.min(-1)
    luma = 0.2126 * r + 0.7152 * g + 0.0722 * b
    lime = (g > r + 4) & (g > b + 2) & (chroma > 14)
    gold = (r > 100) & (g > 85) & (b < 155) & (chroma > 14) & (r > b + 6)
    cyan = (b > r + 6) & (b > g - 4) & (chroma > 16) & (luma < 210)
    spare = (lime | gold | cyan) if spare_oil else np.zeros_like(lime)
    softbox = (luma > 195) & (chroma < 34)
    pink = np.maximum(0.0, r - g * 1.05) * np.maximum(0.0, b - g * 0.88)
    pink = np.where(spare | softbox, pink * 0.05, pink)
    mag = np.maximum(0.0, r - g * 1.02) * np.maximum(0.0, b - g * 0.95)
    mag = np.where(spare, mag * 0.04, mag)
    cream = np.maximum(0.0, r - b * 1.05)
    cream = np.maximum(cream, np.maximum(0.0, g * 0.9 - b))
    cream = np.where(spare | softbox, cream * 0.08, cream)
    out[..., 0] = r - pink * 1.1 - mag * 1.0 - cream * 0.85
    out[..., 1] = g - cream * 0.4 + pink * 0.12 + mag * 0.22
    out[..., 2] = b - pink * 0.9 - mag * 0.75 - cream * 0.12
    nr, ng, nb = out[..., 0], out[..., 1], out[..., 2]
    still_pink = np.maximum(0.0, nr - ng * 1.02) * np.maximum(0.0, nb - ng * 0.9)
    sil = 0.2126 * nr + 0.7152 * ng + 0.0722 * nb
    w = np.clip(still_pink * 1.5, 0.0, 1.0)[..., None]
    silver = np.stack([sil * 0.97, sil * 1.0, sil * 1.05], axis=-1)
    out = out * (1.0 - w) + silver * w
    # Optional oil chroma restore (chrome faces)
    if keep_oil_chroma > 0.01 and spare_oil:
        oil = rgb.copy()
        ow = (spare.astype(np.float32) * keep_oil_chroma)[..., None]
        out = out * (1.0 - ow * 0.35) + oil * (ow * 0.35)
    return np.clip(out, 0.0, 255.0)


def atlas_mask(glyph_id: str) -> np.ndarray:
    mask_path = ATLAS_DIR / f"{glyph_id}-mask.png"
    sdf_path = ATLAS_DIR / f"{glyph_id}.png"
    if mask_path.exists():
        m = np.asarray(Image.open(mask_path).convert("L"), dtype=np.float32) / 255.0
        return m > 0.45
    sdf = np.asarray(Image.open(sdf_path).convert("RGBA"), dtype=np.float32)
    return sdf[..., 0] < 127.5


def crop_to_atlas(rgb: np.ndarray, box: tuple[int, int, int, int], mask: np.ndarray) -> np.ndarray:
    """Resize crop into atlas space; keep metal only inside glyph mask."""
    x0, y0, x1, y1 = box
    patch = rgb[y0:y1, x0:x1].copy()
    if patch.size == 0:
        return np.zeros((SIZE, SIZE, 3), dtype=np.float32)
    luma = 0.2126 * patch[..., 0] + 0.7152 * patch[..., 1] + 0.0722 * patch[..., 2]
    chroma = patch.max(-1) - patch.min(-1)
    # Keep reflective metal + softbox cores; reject circuit-board hairlines
    metal = (luma > 42) & (chroma > 12) & (luma < 250)
    soft = (luma > 160) & (chroma < 45)
    # Also keep mid oil even if chroma modest
    mid_oil = (luma > 55) & (luma < 190) & (chroma > 10)
    keep = metal | soft | mid_oil
    patch = np.where(keep[..., None], patch, 0.0)
    ys, xs = np.where(keep)
    if len(ys) < 40:
        ys, xs = np.where(luma > 50)
    if len(ys) < 20:
        content = patch
    else:
        pad = 10
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
    outside = distance_transform_edt(~mask)
    feather = np.clip(1.0 - outside / 5.0, 0.0, 1.0)[..., None]
    out *= feather
    out *= mask[..., None].astype(np.float32)
    return out


def inpaint_mask_holes(plate: np.ndarray, mask: np.ndarray) -> np.ndarray:
    """Fill empty ink pixels from nearest metal so faces stay filled."""
    luma = 0.2126 * plate[..., 0] + 0.7152 * plate[..., 1] + 0.0722 * plate[..., 2]
    solid = mask & (luma > 18)
    empty = mask & ~solid
    if not empty.any() or not solid.any():
        return plate
    _, (iy, ix) = distance_transform_edt(~solid, return_indices=True)
    filled = plate.copy()
    filled[empty] = plate[iy[empty], ix[empty]]
    # Soft blend at hole borders
    dist_empty = distance_transform_edt(~empty)
    w = (empty.astype(np.float32) * np.clip(1.0 - dist_empty / 3.0, 0.0, 1.0))[..., None]
    # Actually for empty pixels w=1
    w = empty.astype(np.float32)[..., None]
    out = plate * (1.0 - w) + filled * w
    return out


def bake_glyph(glyph_id: str) -> Image.Image:
    mask = atlas_mask(glyph_id)
    plate = np.zeros((SIZE, SIZE, 3), dtype=np.float32)
    weight = np.zeros((SIZE, SIZE), dtype=np.float32)

    for name, box, gain in CROPS[glyph_id]:
        rgb = crush_pink_cream(load_rgb(name), keep_oil_chroma=0.85 if glyph_id == "chromeSansP" else 0.15)
        layer = crop_to_atlas(rgb, box, mask)
        layer = crush_pink_cream(layer, keep_oil_chroma=0.7 if glyph_id == "chromeSansP" else 0.1)
        w = (layer.max(axis=-1) > 8).astype(np.float32) * float(gain)
        plate += layer * gain
        weight += w

    w3 = np.maximum(weight, 1e-3)[..., None]
    plate = plate / w3
    plate = crush_pink_cream(plate, keep_oil_chroma=0.55 if glyph_id == "chromeSansP" else 0.08)

    luma = 0.2126 * plate[..., 0] + 0.7152 * plate[..., 1] + 0.0722 * plate[..., 2]
    plate = np.where(mask[..., None], plate, 0.0)
    plate = inpaint_mask_holes(plate, mask)
    charcoal = np.array([16.0, 18.0, 24.0], dtype=np.float32)
    luma2 = 0.2126 * plate[..., 0] + 0.7152 * plate[..., 1] + 0.0722 * plate[..., 2]
    empty = mask & (luma2 < 10)
    plate[empty] = charcoal

    im = Image.fromarray(np.clip(plate, 0, 255).astype(np.uint8), mode="RGB")
    im = im.filter(ImageFilter.GaussianBlur(radius=0.9))
    arr = crush_pink_cream(np.asarray(im, dtype=np.float32), keep_oil_chroma=0.45 if glyph_id == "chromeSansP" else 0.05)

    if glyph_id == "scriptProP":
        r, g, b = arr[..., 0], arr[..., 1], arr[..., 2]
        sil = 0.2126 * r + 0.7152 * g + 0.0722 * b
        # Tubular elegance: silver wrap from concept luma structure (pink→silver)
        cool = np.stack([sil * 0.94, sil * 1.0, sil * 1.08], axis=-1)
        # Preserve bright crest ribbons
        crest = sil > 130
        flank = sil < 70
        arr = cool.copy()
        arr[crest] = np.stack([sil * 0.98, sil * 1.0, sil * 1.04], axis=-1)[crest]
        arr[crest] = np.clip(arr[crest] * 1.12, 0, 255)
        arr[flank] = np.clip(arr[flank] * 0.55, 0, 255)
        # Faint cool fringe only
        chroma = arr.max(-1) - arr.min(-1)
        fringe = (b > r + 10) & (chroma > 28) & mask
        arr[fringe] = arr[fringe] * 0.4 + cool[fringe] * 0.6

    if glyph_id == "chromeSansP":
        r, g, b = arr[..., 0], arr[..., 1], arr[..., 2]
        sil = 0.2126 * r + 0.7152 * g + 0.0722 * b
        mid = (sil > 35) & (sil < 205) & mask
        # Enrich planar oil midtones toward 1c6PD/Z53Ve wet-mirror (gold + cyan, not mint flood)
        arr[mid, 0] = np.clip(arr[mid, 0] + 14.0, 0, 255)
        arr[mid, 1] = np.clip(arr[mid, 1] + 2.0, 0, 255)
        arr[mid, 2] = np.clip(arr[mid, 2] + 8.0, 0, 255)
        # Softbox peaks → cool silver (not cream)
        peak_sil = np.stack([sil * 0.96, sil * 1.0, sil * 1.06], axis=-1)
        pw = ((sil > 170) & (arr.max(-1) - arr.min(-1) < 38)).astype(np.float32)[..., None]
        arr = arr * (1.0 - pw * 0.65) + peak_sil * (pw * 0.65)
        # Crush swamp green → oil (gold/cyan bias)
        swamp = np.maximum(0.0, arr[..., 1] - arr[..., 0] * 1.05) * np.maximum(
            0.0, arr[..., 1] - arr[..., 2] * 1.02
        )
        swamp = np.where(sil > 150, swamp * 1.2, swamp * 0.7)
        w = np.clip(swamp / 45.0, 0.0, 1.0)[..., None]
        oilish = np.stack([
            np.clip(sil * 1.05 + 18, 0, 255),
            np.clip(sil * 0.95 + 8, 0, 255),
            np.clip(sil * 0.75 + 22, 0, 255),
        ], axis=-1)
        arr = arr * (1.0 - w * 0.7) + oilish * (w * 0.7)
        # Charcoal interstitial voids
        void = (sil < 52) & mask
        arr[void] = np.clip(arr[void] * 0.4 + np.array([12, 14, 20]) * 0.6, 0, 255)
        arr = crush_pink_cream(arr, keep_oil_chroma=0.55)

    arr *= mask[..., None].astype(np.float32)
    arr = inpaint_mask_holes(arr, mask)
    arr *= mask[..., None].astype(np.float32)
    luma2 = 0.2126 * arr[..., 0] + 0.7152 * arr[..., 1] + 0.0722 * arr[..., 2]
    # Alpha = height hint (crest bright for script; mid for chrome normals)
    if glyph_id == "scriptProP":
        alpha = np.clip((luma2 / 255.0) ** 0.85, 0.0, 1.0)
    else:
        alpha = np.clip(luma2 / 255.0, 0.0, 1.0)
    alpha = gaussian_filter(alpha, sigma=0.9) * mask.astype(np.float32)

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
