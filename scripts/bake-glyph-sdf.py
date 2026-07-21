#!/usr/bin/env python3
"""
Bake high-quality glyph SDF atlases from real TrueType outlines.

When Blender height/mask outputs exist (scripts/bake-glyph-blender.py via
portable 4.2), prefer those for G-channel height + ink silhouette, then EDT
encode R the same way. Otherwise: font outline -> binary mask -> EDT.

Targets:
  chromeSansP — geometric block lowercase p (Impact / Arial Black family)
  scriptProP  — cursive tubular p (Segoe Script)
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy.ndimage import distance_transform_edt, gaussian_filter

ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "demo" / "glyph-atlases"
SRC_OUT = ROOT / "src" / "field" / "glyphAtlases.ts"

SIZE = 512
PAD = 0.14  # fraction of canvas reserved as margin
MAX_DIST = 48.0  # pixels encoded into [0,1] around the edge

GLYPHS = {
    "chromeSansP": {
        "char": "p",
        "fonts": [
            Path(r"C:\Windows\Fonts\ariblk.ttf"),  # Arial Black — geometric block
            Path(r"C:\Windows\Fonts\arialbd.ttf"),
            Path(r"C:\Windows\Fonts\verdanab.ttf"),
            Path(r"C:\Windows\Fonts\impact.ttf"),
        ],
        # Keep silhouette faithful — only light AA soften
        "dilate": 0.8,
        "round": 0.55,
    },
    "scriptProP": {
        "char": "p",
        "fonts": [
            Path(r"C:\Windows\Fonts\segoesc.ttf"),
            Path(r"C:\Windows\Fonts\segoepr.ttf"),
            Path(r"C:\Windows\Fonts\segoescb.ttf"),
        ],
        # Tubular thicken + smooth join — round-pipe elegance vs ENj9B
        "dilate": 8.2,
        "round": 4.0,
    },
}


def pick_font(candidates: list[Path]) -> Path:
    for p in candidates:
        if p.exists():
            return p
    raise FileNotFoundError(f"No font found among {[str(c) for c in candidates]}")


def render_mask(font_path: Path, char: str, size: int, dilate: float, round_px: float) -> np.ndarray:
    """Render a crisp glyph mask, then morphological round/dilate via SDF."""
    # Oversample for AA, then threshold
    over = size * 2
    font_size = int(over * (1.0 - 2 * PAD) * 0.92)
    font = ImageFont.truetype(str(font_path), font_size)
    img = Image.new("L", (over, over), 0)
    draw = ImageDraw.Draw(img)
    bbox = draw.textbbox((0, 0), char, font=font)
    gw, gh = bbox[2] - bbox[0], bbox[3] - bbox[1]
    x = (over - gw) // 2 - bbox[0]
    y = (over - gh) // 2 - bbox[1]
    draw.text((x, y), char, font=font, fill=255)

    arr = np.asarray(img, dtype=np.float32) / 255.0
    # Downsample with box filter
    arr = arr.reshape(size, 2, size, 2).mean(axis=(1, 3))
    binary = arr > 0.45

    # Distance-based dilate + round (preserves silhouette better than blob softMin)
    if dilate > 0 or round_px > 0:
        outside = distance_transform_edt(~binary)
        inside = distance_transform_edt(binary)
        signed = inside - outside
        signed = signed + dilate
        if round_px > 0:
            signed = gaussian_filter(signed, sigma=round_px * 0.35)
        binary = signed > 0

    return binary.astype(bool)


def load_blender_maps(gid: str) -> tuple[np.ndarray | None, np.ndarray | None]:
    """Load Blender-baked height (16-bit or 8-bit) + mask if present."""
    h_path = OUT_DIR / f"{gid}-blender-height.png"
    m_path = OUT_DIR / f"{gid}-blender-mask.png"
    if not h_path.exists() or not m_path.exists():
        return None, None
    h_im = Image.open(h_path)
    if h_im.mode == "I;16" or h_im.mode == "I":
        height = np.asarray(h_im, dtype=np.float32)
        if height.max() > 1.5:
            height = height / 65535.0
    else:
        height = np.asarray(h_im.convert("L"), dtype=np.float32) / 255.0
    if height.shape[0] != SIZE or height.shape[1] != SIZE:
        height = np.asarray(
            Image.fromarray((np.clip(height, 0, 1) * 255).astype(np.uint8), mode="L").resize(
                (SIZE, SIZE), Image.Resampling.BILINEAR
            ),
            dtype=np.float32,
        ) / 255.0
    mask = np.asarray(Image.open(m_path).convert("L").resize((SIZE, SIZE), Image.Resampling.NEAREST), dtype=np.float32)
    mask_b = mask > 127.5
    height = np.where(mask_b, np.clip(height, 0.0, 1.0), 0.0).astype(np.float32)
    return height, mask_b


def bake_sdf(
    mask: np.ndarray,
    max_dist: float,
    height_override: np.ndarray | None = None,
    force_profile: str | None = None,
) -> tuple[np.ndarray, np.ndarray]:
    """Signed distance + height bevel.

    R encode: 0.5 = edge, >0.5 inside, <0.5 outside (Quilez via decode).
    G encode: height bevel 0 at lip → 1 at plateau/tube crest (planar vs tubular).
    """
    inside = distance_transform_edt(mask)
    outside = distance_transform_edt(~mask)
    signed = outside - inside  # >0 outside, <0 inside
    encoded = 0.5 - (signed / max_dist) * 0.5
    encoded = np.clip(encoded, 0.0, 1.0).astype(np.float32)

    ink = mask.astype(bool)
    if height_override is not None:
        height = gaussian_filter(height_override, sigma=0.85)
        height = np.where(ink, np.clip(height, 0.0, 1.0), 0.0).astype(np.float32)
        return encoded, height

    # Analytic stand-in when Blender maps absent
    local_r = np.maximum(inside, 1e-3)
    medial = gaussian_filter(inside * ink, sigma=6.0)
    medial = np.maximum(medial, local_r)
    t = np.clip(inside / np.maximum(medial, 1e-3), 0.0, 1.0)
    height_tube = np.sqrt(np.maximum(0.001, 1.0 - (1.0 - t) ** 2))
    height_planar = np.clip(t * 2.4, 0.0, 1.0)
    height_planar = np.where(t > 0.35, 1.0, height_planar)
    if force_profile == "planar":
        height = height_planar
    elif force_profile == "tube":
        height = height_tube
    else:
        thick = np.clip(medial / 28.0, 0.0, 1.0)
        height = height_planar * (1.0 - thick * 0.85) + height_tube * (0.15 + thick * 0.85)
    height = np.where(ink, height, 0.0).astype(np.float32)
    height = gaussian_filter(height, sigma=1.1)
    height = np.where(ink, np.clip(height, 0.0, 1.0), 0.0).astype(np.float32)
    return encoded, height


def write_png_r8_as_rgba(path: Path, encoded: np.ndarray, height: np.ndarray | None = None) -> None:
    """Store SDF in R, height bevel in G, duplicate R in B."""
    u8 = (encoded * 255.0 + 0.5).astype(np.uint8)
    if height is None:
        g8 = u8
    else:
        g8 = (np.clip(height, 0.0, 1.0) * 255.0 + 0.5).astype(np.uint8)
    rgba = np.stack([u8, g8, u8, np.full_like(u8, 255)], axis=-1)
    Image.fromarray(rgba, mode="RGBA").save(path, optimize=True)


def ts_module(entries: dict[str, dict]) -> str:
    lines = [
        "/** Auto-generated by scripts/bake-glyph-sdf.py — do not hand-edit. */",
        "",
        "export type GlyphAtlasId = \"chromeSansP\" | \"scriptProP\";",
        "",
        "export type GlyphAtlas = {",
        "  id: GlyphAtlasId;",
        "  size: number;",
        "  maxDist: number;",
        "  /** Field-space half-extent covered by the atlas (maps UV 0..1). */",
        "  fieldExtent: number;",
        "  font: string;",
        "  /** RGBA8 PNG bytes as base64. */",
        "  pngBase64: string;",
        "};",
        "",
        "export const GLYPH_ATLASES: Record<GlyphAtlasId, GlyphAtlas> = {",
    ]
    for gid, meta in entries.items():
        b64 = meta["pngBase64"]
        # chunk base64 for readability
        chunks = [b64[i : i + 120] for i in range(0, len(b64), 120)]
        joined = '" +\n    "'.join(chunks)
        lines.append(f"  {gid}: {{")
        lines.append(f'    id: "{gid}",')
        lines.append(f"    size: {meta['size']},")
        lines.append(f"    maxDist: {meta['maxDist']},")
        lines.append(f"    fieldExtent: {meta['fieldExtent']},")
        lines.append(f'    font: "{meta["font"]}",')
        lines.append(f'    pngBase64: "{joined}",')
        lines.append("  },")
    lines.append("};")
    lines.append("")
    lines.append("export function glyphAtlasDataUrl(id: GlyphAtlasId): string {")
    lines.append('  return `data:image/png;base64,${GLYPH_ATLASES[id].pngBase64}`;')
    lines.append("}")
    lines.append("")
    return "\n".join(lines)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "--prefer-blender",
        action="store_true",
        help="Use *-blender-height/mask.png when present for G height + ink",
    )
    args = ap.parse_args()

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    entries: dict[str, dict] = {}
    used_blender = False
    manifest = {"pipeline": "font-outline->EDT-SDF", "blender": False, "glyphs": {}}

    for gid, spec in GLYPHS.items():
        font = pick_font(spec["fonts"])
        bl_height, bl_mask = (None, None)
        if args.prefer_blender:
            bl_height, bl_mask = load_blender_maps(gid)

        if bl_mask is not None and bl_height is not None and bl_mask.sum() > 100:
            # Blender silhouette already has bevel/offset thickness — light soften only
            mask = bl_mask
            dilate = 0.35 if gid == "chromeSansP" else 3.8
            round_px = 0.4 if gid == "chromeSansP" else 2.2
            if dilate > 0 or round_px > 0:
                outside = distance_transform_edt(~mask)
                inside = distance_transform_edt(mask)
                signed = inside - outside + dilate
                if round_px > 0:
                    signed = gaussian_filter(signed, sigma=round_px * 0.35)
                mask = signed > 0
            # Resample Blender height onto dilated mask: keep crest, fill joins
            height_src = bl_height.copy()
            if mask.sum() > bl_mask.sum():
                _, (iy, ix) = distance_transform_edt(~bl_mask, return_indices=True)
                filled = height_src[iy, ix]
                height_src = np.where(bl_mask, height_src, filled * 0.92)
                height_src = np.where(mask, height_src, 0.0)
            profile = "tube" if gid == "scriptProP" else "planar"
            encoded, height = bake_sdf(mask, MAX_DIST, height_override=height_src, force_profile=profile)
            used_blender = True
            source = f"blender+{font.name}"
        else:
            mask = render_mask(font, spec["char"], SIZE, spec["dilate"], spec["round"])
            profile = "tube" if gid == "scriptProP" else "planar"
            encoded, height = bake_sdf(mask, MAX_DIST, force_profile=profile)
            source = font.name

        png_path = OUT_DIR / f"{gid}.png"
        write_png_r8_as_rgba(png_path, encoded, height)
        preview = Image.fromarray((mask.astype(np.uint8) * 255), mode="L")
        preview.save(OUT_DIR / f"{gid}-mask.png")

        png_bytes = png_path.read_bytes()
        import base64

        b64 = base64.b64encode(png_bytes).decode("ascii")
        field_extent = 0.55
        entries[gid] = {
            "size": SIZE,
            "maxDist": MAX_DIST / SIZE * (2 * field_extent),
            "fieldExtent": field_extent,
            "font": font.name,
            "pngBase64": b64,
        }
        manifest["glyphs"][gid] = {
            "font": str(font),
            "source": source,
            "png": str(png_path.relative_to(ROOT)).replace("\\", "/"),
            "maxDistPx": MAX_DIST,
            "fieldExtent": field_extent,
            "inkPx": int(mask.sum()),
            "blenderHeight": bool(bl_height is not None),
        }
        print(f"baked {gid} from {source} ink={mask.sum()} blender={bl_height is not None} -> {png_path}")

    manifest["pipeline"] = "blender-height+EDT-SDF" if used_blender else "font-outline->EDT-SDF"
    manifest["blender"] = used_blender
    SRC_OUT.write_text(ts_module(entries), encoding="utf-8")
    (OUT_DIR / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(f"wrote {SRC_OUT}")


if __name__ == "__main__":
    main()
