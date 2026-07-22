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
        # Z53Ve geometric chrome p — planar wet-mirror (gold/lime oil preferred)
        ("Z53Ve.jpg", (230, 620, 455, 930), 1.1),
        # 1c6PD stem/bowl oil — gold accents (cream crushed on face in post)
        ("1c6PD.jpg", (145, 700, 330, 1040), 0.8),
        # Z53Ve drip-adjacent oil accents
        ("Z53Ve.jpg", (210, 820, 380, 1000), 0.75),
        # 1c6PD upper bowl oil
        ("1c6PD.jpg", (170, 640, 340, 820), 0.55),
        # Z53Ve mid face iridescence
        ("Z53Ve.jpg", (250, 680, 420, 880), 0.7),
        # 1c6PD cream drip-bulb harvest (lower stem tip)
        ("1c6PD.jpg", (160, 900, 280, 1080), 0.85),
    ],
    "scriptProP": [
        # ENj9B molten script p (full bowl+stem)
        ("ENj9B.jpg", (175, 600, 450, 960), 1.2),
        # Extra stem/drip metal — tubular crest highlights
        ("ENj9B.jpg", (200, 760, 380, 1000), 0.75),
        # Bowl loop tubular wrap
        ("ENj9B.jpg", (250, 580, 460, 780), 0.65),
        # Stem crest fill (anti void)
        ("ENj9B.jpg", (180, 650, 320, 900), 0.6),
        # Tip fill metal
        ("ENj9B.jpg", (220, 880, 360, 1020), 0.55),
    ],
}


def load_rgb(name: str) -> np.ndarray:
    path = CONCEPT / name
    if not path.exists():
        path = ROOT / "demo" / "qa-refs" / name
    return np.asarray(Image.open(path).convert("RGB"), dtype=np.float32)


def crush_pink_cream(rgb: np.ndarray, spare_oil: bool = True, keep_oil_chroma: float = 1.0, spare_cyan: bool = False) -> np.ndarray:
    """pink0 + cream kill; spare lime/gold oil only — crush cyan softbox (anti B-boost)."""
    out = rgb.copy()
    r, g, b = out[..., 0], out[..., 1], out[..., 2]
    chroma = out.max(-1) - out.min(-1)
    luma = 0.2126 * r + 0.7152 * g + 0.0722 * b
    lime = (g > r + 4) & (g > b + 2) & (chroma > 14)
    gold = (r > 95) & (g > 80) & (b < 160) & (chroma > 12) & (r > b + 5)
    cyan = (b > r + 4) & (b > g - 6) & (chroma > 12) & (luma < 220)
    spare = (lime | gold | (cyan if spare_cyan else False)) if spare_oil else np.zeros_like(lime)
    softbox = (luma > 195) & (chroma < 34)
    pink = np.maximum(0.0, r - g * 1.05) * np.maximum(0.0, b - g * 0.88)
    pink = np.where(spare | softbox, pink * 0.05, pink)
    mag = np.maximum(0.0, r - g * 1.02) * np.maximum(0.0, b - g * 0.95)
    mag = np.where(spare, mag * 0.04, mag)
    cream = np.maximum(0.0, r - b * 1.05)
    cream = np.maximum(cream, np.maximum(0.0, g * 0.9 - b))
    cream = np.where(spare | softbox, cream * 0.08, cream)
    # Cyan softbox = any B-lead (milk + softbox plate) — kill unless spare_cyan oil
    cyan_soft = np.maximum(0.0, b - r * 0.98) * np.maximum(0.0, b - g * 0.96)
    cyan_soft = np.where(spare, cyan_soft * 0.08, cyan_soft)
    cyan_milk = np.maximum(0.0, b - r * 0.96) * (1.0 - np.clip(chroma / 50.0, 0.0, 1.0))
    cyan_milk = np.where(spare | softbox, 0.0, cyan_milk)
    out[..., 0] = r - pink * 1.1 - mag * 1.0 - cream * 0.85
    out[..., 1] = g - cream * 0.4 + pink * 0.12 + mag * 0.22
    out[..., 2] = b - pink * 0.9 - mag * 0.75 - cream * 0.12 - cyan_milk * 0.95 - cyan_soft * 0.85
    nr, ng, nb = out[..., 0], out[..., 1], out[..., 2]
    still_pink = np.maximum(0.0, nr - ng * 1.02) * np.maximum(0.0, nb - ng * 0.9)
    sil = 0.2126 * nr + 0.7152 * ng + 0.0722 * nb
    w = np.clip(still_pink * 1.5, 0.0, 1.0)[..., None]
    # Warm-neutral silver (B ≤ R) — B-boost reads as cyan softbox
    silver = np.stack([sil * 1.0, sil * 1.0, sil * 0.99], axis=-1)
    out = out * (1.0 - w) + silver * w
    # Restore lime/gold oil chroma only (not cyan softbox)
    if keep_oil_chroma > 0.01 and spare_oil:
        oil = rgb.copy()
        oil_mask = lime | gold | (cyan if spare_cyan else False)
        ow = (oil_mask.astype(np.float32) * keep_oil_chroma)[..., None]
        out = out * (1.0 - ow * 0.38) + oil * (ow * 0.38)
    # Kill olive swamp: G-lead + crushed B → warm-neutral silver (spare true gold/lime)
    nr, ng, nb = out[..., 0], out[..., 1], out[..., 2]
    sil = 0.2126 * nr + 0.7152 * ng + 0.0722 * nb
    ch = out.max(-1) - out.min(-1)
    olive = (ng > nr * 1.05) & (nb < sil * 0.75) & (ch > 8)
    true_oil = (gold | lime) & (ch > 22)
    olive = olive & ~true_oil
    cool = np.stack([sil * 1.0, sil * 1.0, sil * 0.99], axis=-1)
    ow = olive.astype(np.float32)[..., None] * 0.9
    out = out * (1.0 - ow) + cool * ow
    # Final B-lead hard kill → warm silver
    still_cyan = (out[..., 2] > out[..., 0] * 1.0) & (out[..., 2] > out[..., 1] * 0.98)
    still_cyan = still_cyan & ~((out[..., 0] > out[..., 2] + 10) & (ch > 22))
    sil2 = 0.2126 * out[..., 0] + 0.7152 * out[..., 1] + 0.0722 * out[..., 2]
    warm = np.stack([sil2 * 1.0, sil2 * 1.0, sil2 * 0.99], axis=-1)
    cw = still_cyan.astype(np.float32)[..., None] * 0.92
    out = out * (1.0 - cw) + warm * cw
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


def inpaint_mask_holes(plate: np.ndarray, mask: np.ndarray, luma_thresh: float = 12.0) -> np.ndarray:
    """Fill empty / dark ink pixels from nearest metal so faces stay filled (void kill)."""
    luma = 0.2126 * plate[..., 0] + 0.7152 * plate[..., 1] + 0.0722 * plate[..., 2]
    solid = mask & (luma > luma_thresh)
    empty = mask & ~solid
    if not empty.any() or not solid.any():
        return plate
    _, (iy, ix) = distance_transform_edt(~solid, return_indices=True)
    filled = plate.copy()
    filled[empty] = plate[iy[empty], ix[empty]]
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

    # Global olive + cyan softbox kill (no B restore — B restore → cyan softbox)
    if glyph_id == "chromeSansP":
        sil0 = 0.2126 * arr[..., 0] + 0.7152 * arr[..., 1] + 0.0722 * arr[..., 2]
        ch0 = arr.max(-1) - arr.min(-1)
        olive0 = (arr[..., 1] > arr[..., 0] * 1.04) & (arr[..., 2] < sil0 * 0.85) & mask
        gold0 = (arr[..., 0] > arr[..., 2] + 12) & (ch0 > 24) & (sil0 < 175)
        lime0 = (arr[..., 1] > arr[..., 0] + 8) & (arr[..., 1] > arr[..., 2] + 6) & (ch0 > 28)
        olive0 = olive0 & ~gold0 & ~lime0
        cool0 = np.stack([sil0 * 1.0, sil0 * 1.0, sil0 * 0.99], axis=-1)
        arr = arr * (1.0 - olive0[..., None] * 0.92) + cool0 * (olive0[..., None] * 0.92)
        # Cap G to max(R,B) outside true oil
        g_cap = np.maximum(arr[..., 0], arr[..., 2])
        arr[..., 1] = np.where(mask & ~gold0 & ~lime0, np.minimum(arr[..., 1], g_cap * 1.01), arr[..., 1])
        # Hard cyan softbox → warm-neutral (B ≤ R)
        cyan0 = (arr[..., 2] > arr[..., 0] * 0.99) & (arr[..., 2] > arr[..., 1] * 0.97) & mask & ~gold0
        arr = arr * (1.0 - cyan0[..., None] * 0.95) + cool0 * (cyan0[..., None] * 0.95)
        arr[..., 2] = np.where(mask & ~gold0, np.minimum(arr[..., 2], np.maximum(arr[..., 0], arr[..., 1]) * 0.98), arr[..., 2])

    if glyph_id == "scriptProP":
        r, g, b = arr[..., 0], arr[..., 1], arr[..., 2]
        sil = 0.2126 * r + 0.7152 * g + 0.0722 * b
        # Tubular elegance: narrow crest ribbon + mid flanks (anti soft-white flood / voids)
        sil_s = gaussian_filter(sil * mask.astype(np.float32), sigma=2.2)
        sil_s = np.where(mask, sil_s, 0.0)
        sil_n = sil_s / max(float(np.percentile(sil_s[mask], 96)), 1e-3) if mask.any() else sil_s
        sil_n = np.clip(sil_n, 0.0, 1.0)
        # Steeper crest (pow↑) → silverRatio ~0.55–0.70 elegance, not 0.87 flood
        crest_w = np.power(sil_n, 1.15)
        flank_w = np.power(1.0 - sil_n, 0.85)
        mid_col = np.array([108.0, 108.0, 105.0], dtype=np.float32)
        crest_col = np.array([236.0, 234.0, 226.0], dtype=np.float32)
        # Mid flanks — continuous pipe, never near-black voids
        flank_col = np.array([72.0, 72.0, 70.0], dtype=np.float32)
        arr = (
            mid_col * (0.55 + 0.22 * sil_n)[..., None]
            + crest_col * (crest_w * 0.62)[..., None]
            + flank_col * (flank_w * 0.48)[..., None]
        )
        arr = np.where(mask[..., None], np.clip(arr, 0, 255), 0.0)
        concept_boost = np.clip((sil - 100.0) / 130.0, 0.0, 1.0)
        arr = np.clip(arr * (1.0 + concept_boost[..., None] * 0.08), 0, 255)
        for thresh in (18.0, 32.0, 48.0, 62.0, 78.0):
            arr = inpaint_mask_holes(arr, mask, luma_thresh=thresh)
        sil2 = 0.2126 * arr[..., 0] + 0.7152 * arr[..., 1] + 0.0722 * arr[..., 2]
        dark = mask & (sil2 < 70)
        arr[dark] = np.clip(arr[dark] * 0.15 + mid_col * 0.85, 0, 255)
        # Tip/descender fill (lower atlas third) — filled tip, mid crest
        yy, _xx = np.mgrid[0:SIZE, 0:SIZE]
        tip_m = mask & (yy > int(SIZE * 0.58)) & (sil2 < 140)
        tip_col = np.array([162.0, 160.0, 155.0], dtype=np.float32)
        arr[tip_m] = np.clip(arr[tip_m] * 0.3 + tip_col * 0.7, 0, 255)
        icy = (arr[..., 2] > arr[..., 0] * 1.01) & mask
        sil3 = 0.2126 * arr[..., 0] + 0.7152 * arr[..., 1] + 0.0722 * arr[..., 2]
        warm2 = np.stack([sil3 * 1.01, sil3 * 1.0, sil3 * 0.97], axis=-1)
        arr[icy] = warm2[icy]
        # Kill soft-white flood mid-body (keep crest peaks)
        soft_flood = mask & (sil3 > 210) & (crest_w < 0.55)
        arr[soft_flood] = np.clip(arr[soft_flood] * 0.35 + mid_col * 0.65, 0, 255)
        arr = crush_pink_cream(arr, spare_oil=False, keep_oil_chroma=0.0)

    if glyph_id == "chromeSansP":
        r, g, b = arr[..., 0], arr[..., 1], arr[..., 2]
        sil = 0.2126 * r + 0.7152 * g + 0.0722 * b
        mid = (sil > 35) & (sil < 205) & mask
        chroma = arr.max(-1) - arr.min(-1)
        # Softbox peaks → warm-neutral silver (anti cyan B-boost)
        peak_sil = np.stack([sil * 1.0, sil * 1.0, sil * 0.99], axis=-1)
        pw = ((sil > 140) & (chroma < 40)).astype(np.float32)[..., None]
        arr = arr * (1.0 - pw * 0.88) + peak_sil * (pw * 0.88)
        # Cream/mint/cyan swamp → warm silver; spare high-chroma gold/lime only
        swamp = np.maximum(0.0, arr[..., 1] - arr[..., 0] * 1.0) * np.maximum(
            0.0, arr[..., 1] - arr[..., 2] * 0.95
        )
        cream = np.maximum(0.0, arr[..., 0] - arr[..., 2] * 0.98)
        cream = np.maximum(cream, np.maximum(0.0, arr[..., 1] * 0.9 - arr[..., 2]))
        cyan_sw = np.maximum(0.0, arr[..., 2] - arr[..., 0] * 0.98) * np.maximum(
            0.0, arr[..., 2] - arr[..., 1] * 0.96
        )
        swamp = np.maximum(np.maximum(swamp * 1.35, cream), cyan_sw * 1.4)
        w = np.clip(swamp / 14.0, 0.0, 1.0)
        cool = np.stack([sil * 1.0, sil * 1.0, sil * 0.99], axis=-1)
        goldish = (arr[..., 0] > arr[..., 2] + 10) & (arr[..., 1] > arr[..., 2] + 4) & (chroma > 24) & (sil < 170)
        limeish = (arr[..., 1] > arr[..., 0] + 6) & (arr[..., 1] > arr[..., 2] + 4) & (chroma > 24)
        w = np.where(goldish | limeish, w * 0.1, w)
        arr = arr * (1.0 - w[..., None] * 0.92) + cool * (w[..., None] * 0.92)
        for _ in range(3):
            mint2 = np.maximum(0.0, arr[..., 1] - arr[..., 0] * 1.01) * np.maximum(
                0.0, arr[..., 1] - arr[..., 2] * 0.97
            )
            cream2 = np.maximum(0.0, arr[..., 0] - arr[..., 2] * 1.0) + np.maximum(
                0.0, arr[..., 1] * 0.88 - arr[..., 2]
            )
            # Full cyan softbox (not milk-only) — B-lead anywhere outside gold
            cyan2 = np.maximum(0.0, arr[..., 2] - arr[..., 0] * 0.98) * np.maximum(
                0.0, arr[..., 2] - arr[..., 1] * 0.96
            )
            w2 = np.clip(np.maximum(np.maximum(mint2, cream2), cyan2 * 1.6) / 14.0, 0.0, 1.0)
            sil2 = 0.2126 * arr[..., 0] + 0.7152 * arr[..., 1] + 0.0722 * arr[..., 2]
            cool2 = np.stack([sil2 * 1.0, sil2 * 1.0, sil2 * 0.99], axis=-1)
            chs = arr.max(-1) - arr.min(-1)
            spare2 = ((arr[..., 0] > arr[..., 2] + 10) & (chs > 24) & (sil2 < 170)) | (
                (arr[..., 1] > arr[..., 0] + 6) & (chs > 24) & (arr[..., 1] > arr[..., 2] + 4)
            )
            w2 = np.where(spare2, w2 * 0.1, w2)
            arr = arr * (1.0 - w2[..., None] * 0.94) + cool2 * (w2[..., None] * 0.94)
        # SMALL localized gold oil stamps only (not face-wide olive)
        sil3 = 0.2126 * arr[..., 0] + 0.7152 * arr[..., 1] + 0.0722 * arr[..., 2]
        yy, xx = np.mgrid[0:SIZE, 0:SIZE]
        puddle = (
            0.95 * np.exp(-(((xx - 235) / 58.0) ** 2 + ((yy - 280) / 68.0) ** 2))
            + 0.8 * np.exp(-(((xx - 300) / 50.0) ** 2 + ((yy - 330) / 58.0) ** 2))
            + 0.65 * np.exp(-(((xx - 260) / 52.0) ** 2 + ((yy - 210) / 52.0) ** 2))
            + 0.5 * np.exp(-(((xx - 280) / 45.0) ** 2 + ((yy - 360) / 48.0) ** 2))
        )
        mid_band = mid & (sil3 > 50) & (sil3 < 175)
        gw = (mid_band.astype(np.float32) * np.clip(puddle, 0, 1) * 0.62)[..., None]
        gold_col = np.array([198.0, 162.0, 98.0], dtype=np.float32)
        # Soft gold oil accents on planar softbox (1c6PD/Z53Ve wet-mirror)
        gw = gw * 0.72
        arr = arr * (1.0 - gw) + (arr * 0.42 + gold_col * 0.58) * gw
        # Hard mint G cap outside oil puddles
        ch3 = arr.max(-1) - arr.min(-1)
        oil_keep = puddle > 0.35
        g_dom = (arr[..., 1] > arr[..., 0] * 1.0) & (arr[..., 1] > arr[..., 2] * 0.98) & ~oil_keep
        cool3 = np.stack([sil3 * 1.0, sil3 * 1.0, sil3 * 0.99], axis=-1)
        arr = arr * (1.0 - g_dom[..., None] * 0.9) + cool3 * (g_dom[..., None] * 0.9)
        soft_g = (ch3 < 36) & mask & ~oil_keep
        g_cap = np.maximum(arr[..., 0], arr[..., 2]) * 1.0
        arr[..., 1] = np.where(soft_g, np.minimum(arr[..., 1], g_cap), arr[..., 1])
        # Cyan softbox crush (any B-lead outside gold puddles)
        b_cyan = (arr[..., 2] > arr[..., 0] * 0.99) & ~oil_keep
        arr = arr * (1.0 - b_cyan[..., None] * 0.92) + cool3 * (b_cyan[..., None] * 0.92)
        arr[..., 2] = np.where(~oil_keep & mask, np.minimum(arr[..., 2], np.maximum(arr[..., 0], arr[..., 1]) * 0.98), arr[..., 2])
        # Cream desat on face only — spare lower drip-bulb cream (1c6PD/Z53Ve)
        sil3 = 0.2126 * arr[..., 0] + 0.7152 * arr[..., 1] + 0.0722 * arr[..., 2]
        ch2 = arr.max(-1) - arr.min(-1)
        yy_c, xx_c = np.mgrid[0:SIZE, 0:SIZE]
        # Place cream bulb from mask bbox bottom (atlas-aligned) — localized, no face flood
        my, mx = np.where(mask)
        if len(my) > 10:
            y_lo, y_hi = int(my.min()), int(my.max())
            x_lo, x_hi = int(mx.min()), int(mx.max())
            bx = 0.5 * (x_lo + x_hi)
            by = y_lo + 0.86 * (y_hi - y_lo)
            brx = max(22.0, 0.16 * (x_hi - x_lo))
            bry = max(18.0, 0.11 * (y_hi - y_lo))
        else:
            bx, by, brx, bry = 200.0, 440.0, 52.0, 42.0
        drip_bulb = (
            0.92 * np.exp(-(((xx_c - bx) / brx) ** 2 + ((yy_c - by) / bry) ** 2))
            + 0.55 * np.exp(-(((xx_c - bx) / (brx * 0.7)) ** 2 + ((yy_c - (by + bry * 0.4)) / (bry * 0.75)) ** 2))
        )
        drip_m = drip_bulb > 0.28
        cream_low = (sil3 > 55) & (sil3 < 200) & (ch2 < 30) & (
            (arr[..., 0] > arr[..., 2] + 4) | (arr[..., 1] * 0.9 > arr[..., 2])
        ) & ~oil_keep & ~drip_m
        cool4 = np.stack([sil3 * 1.0, sil3 * 1.0, sil3 * 0.99], axis=-1)
        arr = arr * (1.0 - cream_low[..., None] * 0.92) + cool4 * (cream_low[..., None] * 0.92)
        # Cream drip-bulb stamp — warm pearlescent tip only (~0.19 face cream target)
        cream_bulb = np.array([228.0, 218.0, 188.0], dtype=np.float32)
        dark_bulb = np.array([28.0, 30.0, 34.0], dtype=np.float32)
        bulb_w = (mask.astype(np.float32) * np.clip(drip_bulb, 0, 1) * 0.62)[..., None]
        bulb_shade = np.clip((yy_c - (by - bry * 0.55)) / max(bry * 1.35, 1.0), 0.0, 1.0)[..., None]
        bulb_col = cream_bulb * (1.0 - bulb_shade * 0.7) + dark_bulb * (bulb_shade * 0.7)
        arr = arr * (1.0 - bulb_w) + (arr * 0.28 + bulb_col * 0.72) * bulb_w
        # Planar wet-mirror softbox rebuild — continuous frontal lobes (anti mottled noise)
        silp = 0.2126 * arr[..., 0] + 0.7152 * arr[..., 1] + 0.0722 * arr[..., 2]
        my2, mx2 = np.where(mask)
        if len(my2) > 10:
            cy = 0.5 * (float(my2.min()) + float(my2.max()))
            cx = 0.5 * (float(mx2.min()) + float(mx2.max()))
            hw = max(40.0, 0.35 * (float(mx2.max()) - float(mx2.min())))
            hh = max(50.0, 0.38 * (float(my2.max()) - float(my2.min())))
        else:
            cx, cy, hw, hh = 256.0, 240.0, 90.0, 110.0
        softbox = (
            1.0 * np.exp(-(((xx_c - cx) / (hw * 1.15)) ** 2 + ((yy_c - (cy - hh * 0.15)) / (hh * 0.95)) ** 2))
            + 0.75 * np.exp(-(((xx_c - (cx - hw * 0.25)) / (hw * 0.85)) ** 2 + ((yy_c - cy) / (hh * 0.8)) ** 2))
            + 0.55 * np.exp(-(((xx_c - (cx + hw * 0.2)) / (hw * 0.7)) ** 2 + ((yy_c - (cy + hh * 0.1)) / (hh * 0.7)) ** 2))
        )
        softbox = np.clip(softbox, 0.0, 1.0) * mask.astype(np.float32)
        # Continuous softbox silver plate + sparse gold oil (planar wet-mirror)
        soft_col = np.stack(
            [
                168.0 + softbox * 72.0,
                166.0 + softbox * 68.0,
                160.0 + softbox * 58.0,
            ],
            axis=-1,
        )
        face_w = ((~drip_m).astype(np.float32) * mask.astype(np.float32) * 0.82)[..., None]
        arr = arr * (1.0 - face_w) + (arr * 0.22 + soft_col * 0.78) * face_w
        # Stronger planar blur — softbox oil fidelity (anti mottled concept noise)
        blur_f = gaussian_filter(arr, sigma=(2.8, 2.8, 0.0))
        arr = np.where(mask[..., None] & ~drip_m[..., None], arr * 0.2 + blur_f * 0.8, arr)
        # Sparse gold oil after softbox (1c6PD/Z53Ve wet-mirror accents)
        silp2 = 0.2126 * arr[..., 0] + 0.7152 * arr[..., 1] + 0.0722 * arr[..., 2]
        mid_band2 = mask & (silp2 > 65) & (silp2 < 180) & ~drip_m
        gw2 = (mid_band2.astype(np.float32) * np.clip(puddle, 0, 1) * 0.55)[..., None]
        gold_col2 = np.array([200.0, 164.0, 98.0], dtype=np.float32)
        arr = arr * (1.0 - gw2) + (arr * 0.4 + gold_col2 * 0.6) * gw2
        # Softbox peaks — warm-neutral (anti cyan / cream flood)
        ch2b = arr.max(-1) - arr.min(-1)
        peak = mask & (softbox > 0.45) & (ch2b < 48) & ~drip_m
        peak_col = np.stack([silp2 * 1.02, silp2 * 1.0, silp2 * 0.97], axis=-1)
        arr[peak] = np.clip(arr[peak] * 0.3 + peak_col[peak] * 0.7, 0, 255)
        silp = 0.2126 * arr[..., 0] + 0.7152 * arr[..., 1] + 0.0722 * arr[..., 2]
        void = (silp < 38) & mask & ~drip_m
        arr[void] = np.clip(arr[void] * 0.35 + np.array([14, 16, 22]) * 0.65, 0, 255)
        arr = crush_pink_cream(arr, keep_oil_chroma=0.55, spare_cyan=False)
        silf = 0.2126 * arr[..., 0] + 0.7152 * arr[..., 1] + 0.0722 * arr[..., 2]
        chf = arr.max(-1) - arr.min(-1)
        mintf = (arr[..., 1] > arr[..., 0]) & (arr[..., 1] > arr[..., 2] * 0.98) & (chf < 38) & (puddle < 0.3) & ~drip_m
        coolf = np.stack([silf * 1.0, silf * 1.0, silf * 0.99], axis=-1)
        arr = arr * (1.0 - mintf[..., None] * 0.92) + coolf * (mintf[..., None] * 0.92)
        # Face cream crush (keep bulb only) — target cream~0.19 localized
        cream_face = (silf > 60) & (silf < 210) & (chf < 36) & (
            (arr[..., 0] > arr[..., 2] + 5) | (arr[..., 1] * 0.9 > arr[..., 2])
        ) & ~drip_m & (puddle < 0.35)
        arr = arr * (1.0 - cream_face[..., None] * 0.9) + coolf * (cream_face[..., None] * 0.9)
        # Final B cap outside gold + drip bulb
        arr[..., 2] = np.where(
            mask & (puddle < 0.35) & ~drip_m,
            np.minimum(arr[..., 2], np.maximum(arr[..., 0], arr[..., 1]) * 0.98),
            arr[..., 2],
        )

    arr *= mask[..., None].astype(np.float32)
    # Aggressive void fill for script; chrome keeps soft charcoal contrast
    if glyph_id == "scriptProP":
        for thresh in (22.0, 38.0, 55.0, 70.0, 85.0, 95.0, 110.0):
            arr = inpaint_mask_holes(arr, mask, luma_thresh=thresh)
        silf2 = 0.2126 * arr[..., 0] + 0.7152 * arr[..., 1] + 0.0722 * arr[..., 2]
        still_dark = mask & (silf2 < 105)
        arr[still_dark] = np.clip(arr[still_dark] * 0.06 + np.array([136.0, 135.0, 130.0]) * 0.94, 0, 255)
        yy2, xx2 = np.mgrid[0:SIZE, 0:SIZE]
        # Tip = warm silver tube continuity (NOT cream liquid fill-line)
        tip2 = mask & (yy2 > int(SIZE * 0.58))
        tip_w = np.clip((yy2.astype(np.float32) - SIZE * 0.58) / (SIZE * 0.32), 0, 1)
        tip_crest = np.clip(1.0 - np.abs(xx2.astype(np.float32) - float(np.mean(xx2[mask]))) / 90.0, 0, 1)
        tip_col = np.stack(
            [
                142.0 + tip_crest * 48.0 + tip_w * 18.0,
                141.0 + tip_crest * 46.0 + tip_w * 16.0,
                136.0 + tip_crest * 42.0 + tip_w * 14.0,
            ],
            axis=-1,
        )
        arr[tip2] = np.clip(arr[tip2] * 0.2 + tip_col[tip2] * 0.8, 0, 255)
        # Cap soft-white flood mid-body (tubular elegance, not matte flood)
        soft2 = mask & (silf2 > 195) & (yy2 < int(SIZE * 0.55))
        arr[soft2] = np.clip(arr[soft2] * 0.3 + np.array([122.0, 121.0, 116.0]) * 0.7, 0, 255)
        # Extra void kill — any near-black island → mid metal (ENj9B continuous pipe)
        silf3 = 0.2126 * arr[..., 0] + 0.7152 * arr[..., 1] + 0.0722 * arr[..., 2]
        holes = mask & (silf3 < 112)
        arr[holes] = np.clip(arr[holes] * 0.05 + np.array([140.0, 139.0, 134.0]) * 0.95, 0, 255)
        # Stem↔loop junction boost via EDT thickness (fill thin necks without puff)
        edt = distance_transform_edt(mask)
        thin = mask & (edt < 14.0) & (edt > 0.5) & (yy2 < int(SIZE * 0.62)) & (yy2 > int(SIZE * 0.22))
        junc_col = np.array([158.0, 156.0, 150.0], dtype=np.float32)
        arr[thin] = np.clip(arr[thin] * 0.2 + junc_col * 0.8, 0, 255)
        # Smooth tubular grade: blur then re-mask (kill jagged void edges)
        blur = gaussian_filter(arr, sigma=(1.8, 1.8, 0.0))
        arr = np.where(mask[..., None], blur, 0.0)
        silf4 = 0.2126 * arr[..., 0] + 0.7152 * arr[..., 1] + 0.0722 * arr[..., 2]
        arr = np.where(
            mask[..., None],
            np.clip(
                arr * 0.5
                + np.stack([silf4 * 1.01, silf4, silf4 * 0.97], axis=-1) * 0.5,
                0,
                255,
            ),
            0.0,
        )
        # Crest ribbon after blur — steeper for silverRatio ~0.63 elegance
        crest_n = np.clip(silf4 / max(float(np.percentile(silf4[mask], 95)), 1e-3), 0, 1) if mask.any() else silf4
        crest_n = np.power(crest_n, 1.35)
        crest_add = (crest_n * 48.0)[..., None] * np.array([1.0, 0.99, 0.96])
        arr = np.where(mask[..., None], np.clip(arr + crest_add * 0.5, 0, 255), 0.0)
        # Final void floor
        silf5 = 0.2126 * arr[..., 0] + 0.7152 * arr[..., 1] + 0.0722 * arr[..., 2]
        still = mask & (silf5 < 100)
        arr[still] = np.clip(arr[still] * 0.08 + np.array([138.0, 137.0, 132.0]) * 0.92, 0, 255)
    else:
        arr = inpaint_mask_holes(arr, mask, luma_thresh=14.0)
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
