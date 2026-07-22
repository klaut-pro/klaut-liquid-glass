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
        ("Z53Ve.jpg", (230, 620, 455, 930), 1.05),
        # 1c6PD stem/bowl oil — gold accents (cream crushed in post)
        ("1c6PD.jpg", (145, 700, 330, 1040), 0.75),
        # Z53Ve drip-adjacent oil accents
        ("Z53Ve.jpg", (210, 820, 380, 1000), 0.7),
        # 1c6PD upper bowl oil
        ("1c6PD.jpg", (170, 640, 340, 820), 0.5),
        # Z53Ve mid face iridescence
        ("Z53Ve.jpg", (250, 680, 420, 880), 0.65),
    ],
    "scriptProP": [
        # ENj9B molten script p (full bowl+stem)
        ("ENj9B.jpg", (175, 600, 450, 960), 1.15),
        # Extra stem/drip metal — tubular crest highlights
        ("ENj9B.jpg", (200, 760, 380, 1000), 0.7),
        # Bowl loop tubular wrap
        ("ENj9B.jpg", (250, 580, 460, 780), 0.6),
        # Stem crest fill (anti void)
        ("ENj9B.jpg", (180, 650, 320, 900), 0.55),
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
        # Continuous tubular silver — crest ribbons + darker flanks (ENj9B elegance)
        sil_s = gaussian_filter(sil * mask.astype(np.float32), sigma=1.8)
        sil_s = np.where(mask, sil_s, 0.0)
        sil_n = sil_s / max(float(np.percentile(sil_s[mask], 97)), 1e-3) if mask.any() else sil_s
        sil_n = np.clip(sil_n, 0.0, 1.0)
        crest_w = np.power(sil_n, 0.7)
        flank_w = np.power(1.0 - sil_n, 1.1)
        mid_col = np.array([118.0, 118.0, 116.0], dtype=np.float32)
        crest_col = np.array([242.0, 240.0, 232.0], dtype=np.float32)
        # Lighter flanks — anti tube void / dark tip lag vs ENj9B
        flank_col = np.array([58.0, 58.0, 56.0], dtype=np.float32)
        arr = (
            mid_col * (0.5 + 0.28 * sil_n)[..., None]
            + crest_col * (crest_w * 0.78)[..., None]
            + flank_col * (flank_w * 0.4)[..., None]
        )
        arr = np.where(mask[..., None], np.clip(arr, 0, 255), 0.0)
        concept_boost = np.clip((sil - 90.0) / 120.0, 0.0, 1.0)
        arr = np.clip(arr * (1.0 + concept_boost[..., None] * 0.12), 0, 255)
        for thresh in (18.0, 32.0, 48.0, 62.0):
            arr = inpaint_mask_holes(arr, mask, luma_thresh=thresh)
        sil2 = 0.2126 * arr[..., 0] + 0.7152 * arr[..., 1] + 0.0722 * arr[..., 2]
        dark = mask & (sil2 < 58)
        arr[dark] = np.clip(arr[dark] * 0.2 + mid_col * 0.8, 0, 255)
        # Tip/descender fill (lower atlas third)
        yy, _xx = np.mgrid[0:SIZE, 0:SIZE]
        tip_m = mask & (yy > int(SIZE * 0.62)) & (sil2 < 110)
        tip_col = np.array([148.0, 147.0, 145.0], dtype=np.float32)
        arr[tip_m] = np.clip(arr[tip_m] * 0.35 + tip_col * 0.65, 0, 255)
        icy = (arr[..., 2] > arr[..., 0] * 1.01) & mask
        sil3 = 0.2126 * arr[..., 0] + 0.7152 * arr[..., 1] + 0.0722 * arr[..., 2]
        warm2 = np.stack([sil3 * 1.01, sil3 * 1.0, sil3 * 0.97], axis=-1)
        arr[icy] = warm2[icy]
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
            0.9 * np.exp(-(((xx - 235) / 55.0) ** 2 + ((yy - 280) / 65.0) ** 2))
            + 0.7 * np.exp(-(((xx - 300) / 48.0) ** 2 + ((yy - 330) / 55.0) ** 2))
            + 0.55 * np.exp(-(((xx - 260) / 50.0) ** 2 + ((yy - 210) / 50.0) ** 2))
        )
        mid_band = mid & (sil3 > 55) & (sil3 < 165)
        gw = (mid_band.astype(np.float32) * np.clip(puddle, 0, 1) * 0.55)[..., None]
        gold_col = np.array([205.0, 158.0, 78.0], dtype=np.float32)
        arr = arr * (1.0 - gw) + (arr * 0.4 + gold_col * 0.6) * gw
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
        # Cream desat
        sil3 = 0.2126 * arr[..., 0] + 0.7152 * arr[..., 1] + 0.0722 * arr[..., 2]
        ch2 = arr.max(-1) - arr.min(-1)
        cream_low = (sil3 > 55) & (sil3 < 200) & (ch2 < 30) & (
            (arr[..., 0] > arr[..., 2] + 4) | (arr[..., 1] * 0.9 > arr[..., 2])
        ) & ~oil_keep
        cool4 = np.stack([sil3 * 1.0, sil3 * 1.0, sil3 * 0.99], axis=-1)
        arr = arr * (1.0 - cream_low[..., None] * 0.88) + cool4 * (cream_low[..., None] * 0.88)
        void = (sil < 42) & mask
        arr[void] = np.clip(arr[void] * 0.45 + np.array([16, 18, 24]) * 0.55, 0, 255)
        arr = crush_pink_cream(arr, keep_oil_chroma=0.55, spare_cyan=False)
        silf = 0.2126 * arr[..., 0] + 0.7152 * arr[..., 1] + 0.0722 * arr[..., 2]
        chf = arr.max(-1) - arr.min(-1)
        mintf = (arr[..., 1] > arr[..., 0]) & (arr[..., 1] > arr[..., 2] * 0.98) & (chf < 38) & (puddle < 0.3)
        coolf = np.stack([silf * 1.0, silf * 1.0, silf * 0.99], axis=-1)
        arr = arr * (1.0 - mintf[..., None] * 0.92) + coolf * (mintf[..., None] * 0.92)
        # Final B cap outside gold
        arr[..., 2] = np.where(
            mask & (puddle < 0.35),
            np.minimum(arr[..., 2], np.maximum(arr[..., 0], arr[..., 1]) * 0.98),
            arr[..., 2],
        )

    arr *= mask[..., None].astype(np.float32)
    # Aggressive void fill for script; chrome keeps soft charcoal contrast
    if glyph_id == "scriptProP":
        for thresh in (22.0, 38.0, 55.0, 70.0):
            arr = inpaint_mask_holes(arr, mask, luma_thresh=thresh)
        silf2 = 0.2126 * arr[..., 0] + 0.7152 * arr[..., 1] + 0.0722 * arr[..., 2]
        still_dark = mask & (silf2 < 72)
        arr[still_dark] = np.clip(arr[still_dark] * 0.25 + np.array([128.0, 127.0, 122.0]) * 0.75, 0, 255)
        yy2, _ = np.mgrid[0:SIZE, 0:SIZE]
        tip2 = mask & (yy2 > int(SIZE * 0.58)) & (silf2 < 130)
        arr[tip2] = np.clip(arr[tip2] * 0.4 + np.array([158.0, 157.0, 154.0]) * 0.6, 0, 255)
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
