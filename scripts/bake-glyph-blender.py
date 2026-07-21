#!/usr/bin/env python3
"""
Blender glyph heightfield / bevel-normal bake for chromeSansP + scriptProP.

Run via portable Blender 4.2 (no UAC):

  "%LOCALAPPDATA%\\Programs\\blender-portable\\blender-4.2.16-windows-x64\\blender.exe" ^
    --background --python scripts/bake-glyph-blender.py -- --all

Or single glyph:

  blender --background --python scripts/bake-glyph-blender.py -- \\
    --glyph chromeSansP --font "C:/Windows/Fonts/ariblk.ttf" \\
    --out-dir demo/glyph-atlases

Outputs (per glyph):
  {id}-blender-height.png  — float height packed as 16-bit grayscale (0..1)
  {id}-blender-mask.png    — binary silhouette
  {id}-blender.glb         — extruded/bevelled mesh for inspection

Host step `scripts/bake-glyph-sdf.py --prefer-blender` merges these into the
R8 SDF + G height atlas + glyphAtlases.ts embed.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

# ---------------------------------------------------------------------------
# bpy is only available inside Blender
# ---------------------------------------------------------------------------
try:
    import bpy  # type: ignore
    from mathutils import Vector  # type: ignore
    from mathutils.bvhtree import BVHTree  # type: ignore
except ImportError:
    print(
        "Blender Python (bpy) not available.\n"
        "Run via: blender --background --python scripts/bake-glyph-blender.py -- ...",
        file=sys.stderr,
    )
    raise SystemExit(2)

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUT = ROOT / "demo" / "glyph-atlases"
FIELD_EXTENT = 0.55
SIZE = 512

GLYPH_SPECS = {
    "chromeSansP": {
        # Planar knife: flat plateau + sharp lip bevel (1c6PD / Z53Ve)
        "fonts": [
            Path(r"C:\Windows\Fonts\ariblk.ttf"),
            Path(r"C:\Windows\Fonts\arialbd.ttf"),
            Path(r"C:\Windows\Fonts\impact.ttf"),
        ],
        "char": "p",
        "extrude": 0.055,
        "bevel_depth": 0.008,
        "bevel_resolution": 2,
        "offset": 0.0,
        "fill_mode": "BOTH",
        "fit": 0.58,  # match EDT PAD ~0.14 field coverage
        "remesh": False,
        "profile": "planar",
    },
    "scriptProP": {
        # Tubular elegance: round-pipe bevel (no voxel remesh — destroys thin strokes)
        "fonts": [
            Path(r"C:\Windows\Fonts\segoesc.ttf"),
            Path(r"C:\Windows\Fonts\segoepr.ttf"),
            Path(r"C:\Windows\Fonts\segoescb.ttf"),
        ],
        "char": "p",
        "extrude": 0.008,
        "bevel_depth": 0.022,
        "bevel_resolution": 4,
        "offset": 0.002,
        "fill_mode": "BOTH",
        "fit": 0.66,
        "remesh": False,
        "profile": "tube",
    },
}


def pick_font(candidates: list[Path]) -> Path:
    for p in candidates:
        if p.exists():
            return p
    raise FileNotFoundError(f"No font among {[str(c) for c in candidates]}")


def clear_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for block in (bpy.data.meshes, bpy.data.curves, bpy.data.fonts, bpy.data.materials):
        for b in list(block):
            block.remove(b)


def build_glyph_mesh(gid: str, font_path: Path, char: str) -> "bpy.types.Object":
    spec = GLYPH_SPECS[gid]
    clear_scene()

    bpy.ops.object.text_add(location=(0.0, 0.0, 0.0))
    obj = bpy.context.object
    assert obj is not None
    curve = obj.data
    assert curve is not None

    font = bpy.data.fonts.load(str(font_path))
    curve.font = font
    curve.body = char
    curve.align_x = "CENTER"
    curve.align_y = "CENTER"
    curve.size = 1.0
    curve.extrude = float(spec["extrude"])
    curve.bevel_depth = float(spec["bevel_depth"])
    curve.bevel_resolution = int(spec["bevel_resolution"])
    curve.offset = float(spec.get("offset", 0.0))
    if hasattr(curve, "fill_mode"):
        curve.fill_mode = spec.get("fill_mode", "BOTH")

    # Convert curve → mesh
    bpy.ops.object.convert(target="MESH")
    obj = bpy.context.object
    assert obj is not None

    # Apply scale so glyph fits field extent with margin
    bpy.ops.object.origin_set(type="ORIGIN_GEOMETRY", center="BOUNDS")
    obj.location = (0.0, 0.0, 0.0)

    # Compute bounds in local space
    depsgraph = bpy.context.evaluated_depsgraph_get()
    eval_obj = obj.evaluated_get(depsgraph)
    bbox = [eval_obj.matrix_world @ Vector(corner) for corner in eval_obj.bound_box]
    xs = [v.x for v in bbox]
    ys = [v.y for v in bbox]
    zs = [v.z for v in bbox]
    span_xy = max(max(xs) - min(xs), max(ys) - min(ys), 1e-6)
    fit = float(spec.get("fit", 0.7))
    target = FIELD_EXTENT * 2.0 * fit  # margin inside ±extent
    s = target / span_xy
    obj.scale = (s, s, s)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)

    # Re-center after scale
    bpy.ops.object.origin_set(type="ORIGIN_GEOMETRY", center="BOUNDS")
    obj.location = (0.0, 0.0, 0.0)
    bpy.ops.object.transform_apply(location=True, rotation=False, scale=False)

    # Optional voxel remesh (off by default — shreds thin script strokes)
    if spec.get("remesh"):
        mod = obj.modifiers.new(name="VoxelRemesh", type="REMESH")
        mod.mode = "VOXEL"
        mod.voxel_size = float(spec.get("voxel", 0.008))
        mod.use_smooth_shade = True
        bpy.ops.object.modifier_apply(modifier=mod.name)
        bpy.ops.object.shade_smooth()
    else:
        bpy.ops.object.shade_smooth()

    # Lift so minimum Z sits near 0 (height = Z of front hits)
    depsgraph = bpy.context.evaluated_depsgraph_get()
    eval_obj = obj.evaluated_get(depsgraph)
    bbox = [eval_obj.matrix_world @ Vector(corner) for corner in eval_obj.bound_box]
    z0 = min(v.z for v in bbox)
    obj.location.z -= z0
    bpy.ops.object.transform_apply(location=True, rotation=False, scale=False)

    return obj


def raycast_heightfield(obj: "bpy.types.Object", size: int, extent: float) -> tuple[np.ndarray, np.ndarray]:
    """Orthographic −Z raycast → height (0..1) + ink mask. Image row 0 = +Y field."""
    depsgraph = bpy.context.evaluated_depsgraph_get()
    eval_obj = obj.evaluated_get(depsgraph)
    bvh = BVHTree.FromObject(eval_obj, depsgraph)

    bbox = [eval_obj.matrix_world @ Vector(corner) for corner in eval_obj.bound_box]
    z_max = max(v.z for v in bbox)
    z_min = min(v.z for v in bbox)
    z_span = max(z_max - z_min, 1e-6)

    height = np.zeros((size, size), dtype=np.float32)
    mask = np.zeros((size, size), dtype=bool)
    origin_z = z_max + 1.5
    direction = Vector((0.0, 0.0, -1.0))

    for yi in range(size):
        # PNG row 0 at top → field +Y (matches WebGL flipY uploads used elsewhere)
        fy = (0.5 - yi / (size - 1)) * 2.0 * extent
        for xi in range(size):
            fx = (xi / (size - 1) - 0.5) * 2.0 * extent
            origin = Vector((fx, fy, origin_z))
            hit = bvh.ray_cast(origin, direction)
            if hit[0] is None:
                continue
            loc = hit[0]
            # Normalize height: plateau/crest → 1, back → 0
            h = (loc.z - z_min) / z_span
            height[yi, xi] = float(np.clip(h, 0.0, 1.0))
            mask[yi, xi] = True

    return height, mask


def shape_height_profile(height: np.ndarray, mask: np.ndarray, profile: str) -> np.ndarray:
    """Post-shape Blender Z into planar plateau vs tubular crest."""
    out = height.copy()
    if not mask.any():
        return out
    ink_h = out[mask]
    lo = float(np.percentile(ink_h, 5))
    hi = float(np.percentile(ink_h, 98))
    span = max(hi - lo, 1e-5)
    norm = np.clip((out - lo) / span, 0.0, 1.0)
    norm = np.where(mask, norm, 0.0)

    if profile == "planar":
        # Fast rise → flat knife face (wet-mirror plateau)
        t = np.clip(norm * 1.55, 0.0, 1.0)
        plateau = np.where(t > 0.42, 1.0, t / 0.42)
        # Keep a little Blender lip curvature near edges
        out = plateau * 0.88 + norm * 0.12
    else:
        # Circular tube cross-section from normalized crest
        t = np.clip(norm, 0.0, 1.0)
        tube = np.sqrt(np.maximum(0.001, 1.0 - (1.0 - t) ** 2))
        out = tube * 0.82 + norm * 0.18

    out = np.where(mask, np.clip(out, 0.0, 1.0), 0.0).astype(np.float32)
    return out


def write_height_png(path: Path, height: np.ndarray) -> None:
    """16-bit grayscale PNG (0..65535)."""
    u16 = (np.clip(height, 0.0, 1.0) * 65535.0 + 0.5).astype(np.uint16)
    # Blender image API
    img = bpy.data.images.new(name=path.stem, width=height.shape[1], height=height.shape[0], alpha=False, float_buffer=False)
    # bpy stores bottom-up; our array is top-down — flip for Blender save, then we also write via numpy path
    # Prefer pure file write without color-space surprises:
    try:
        import struct
        import zlib

        h, w = u16.shape
        raw = b""
        # PNG 16-bit grayscale, top-down
        for row in u16:
            raw += b"\x00" + row.astype(">u2").tobytes()
        def chunk(tag: bytes, data: bytes) -> bytes:
            return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

        ihdr = struct.pack(">IIBBBBB", w, h, 16, 0, 0, 0, 0)
        png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")
        path.write_bytes(png)
    finally:
        bpy.data.images.remove(img)


def write_mask_png(path: Path, mask: np.ndarray) -> None:
    u8 = (mask.astype(np.uint8) * 255)
    h, w = u8.shape
    import struct
    import zlib

    raw = b""
    for row in u8:
        raw += b"\x00" + row.tobytes()

    def chunk(tag: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    ihdr = struct.pack(">IIBBBBB", w, h, 8, 0, 0, 0, 0)
    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")
    path.write_bytes(png)


def export_glb(obj: "bpy.types.Object", path: Path) -> None:
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    path.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=str(path), use_selection=True, export_format="GLB")


def bake_one(gid: str, out_dir: Path, font_override: Path | None, size: int) -> dict:
    spec = GLYPH_SPECS[gid]
    font = font_override if font_override else pick_font(spec["fonts"])
    print(f"[blender] baking {gid} from {font}")

    obj = build_glyph_mesh(gid, font, spec["char"])
    height, mask = raycast_heightfield(obj, size, FIELD_EXTENT)
    height = shape_height_profile(height, mask, spec["profile"])

    out_dir.mkdir(parents=True, exist_ok=True)
    h_path = out_dir / f"{gid}-blender-height.png"
    m_path = out_dir / f"{gid}-blender-mask.png"
    g_path = out_dir / f"{gid}-blender.glb"
    write_height_png(h_path, height)
    write_mask_png(m_path, mask)
    try:
        export_glb(obj, g_path)
    except Exception as exc:  # noqa: BLE001
        print(f"[blender] GLB export skipped: {exc}")

    meta = {
        "glyph": gid,
        "font": str(font),
        "profile": spec["profile"],
        "extrude": spec["extrude"],
        "bevel_depth": spec["bevel_depth"],
        "inkPx": int(mask.sum()),
        "heightMean": float(height[mask].mean()) if mask.any() else 0.0,
        "heightPng": str(h_path.relative_to(ROOT)).replace("\\", "/"),
        "maskPng": str(m_path.relative_to(ROOT)).replace("\\", "/"),
    }
    print(f"[blender] {gid} ink={meta['inkPx']} heightMean={meta['heightMean']:.3f} -> {h_path.name}")
    return meta


def parse_args(argv: list[str]) -> argparse.Namespace:
    # Blender passes args after "--"
    if "--" in argv:
        argv = argv[argv.index("--") + 1 :]
    else:
        argv = []
    ap = argparse.ArgumentParser(description="Bake glyph heightfields via Blender")
    ap.add_argument("--glyph", choices=list(GLYPH_SPECS.keys()))
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--font", type=str, default="")
    ap.add_argument("--out-dir", type=str, default=str(DEFAULT_OUT))
    ap.add_argument("--res", type=int, default=SIZE)
    # Legacy stub flags (ignored / mapped)
    ap.add_argument("--char", default="")
    ap.add_argument("--out", default="")
    ap.add_argument("--extrude", type=float, default=-1.0)
    ap.add_argument("--bevel", type=float, default=-1.0)
    return ap.parse_args(argv)


def main() -> int:
    args = parse_args(sys.argv)
    out_dir = Path(args.out_dir)
    font_override = Path(args.font) if args.font else None

    glyphs: list[str]
    if args.all or (not args.glyph and not args.out):
        glyphs = list(GLYPH_SPECS.keys())
    elif args.glyph:
        glyphs = [args.glyph]
    else:
        # Legacy single --out path
        glyphs = ["chromeSansP"]

    # Allow per-run extrude/bevel override into chromeSansP when legacy flags set
    if args.extrude > 0:
        GLYPH_SPECS["chromeSansP"]["extrude"] = args.extrude
        GLYPH_SPECS["scriptProP"]["extrude"] = args.extrude * 0.2
    if args.bevel > 0:
        GLYPH_SPECS["chromeSansP"]["bevel_depth"] = args.bevel
        GLYPH_SPECS["scriptProP"]["bevel_depth"] = max(args.bevel * 3.5, 0.04)

    results = []
    for gid in glyphs:
        fo = font_override
        results.append(bake_one(gid, out_dir, fo, args.res))

    manifest = out_dir / "blender-bake-manifest.json"
    manifest.write_text(json.dumps({"blender": True, "fieldExtent": FIELD_EXTENT, "size": args.res, "glyphs": results}, indent=2), encoding="utf-8")
    print(f"[blender] wrote {manifest}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
