#!/usr/bin/env python3
"""
Bake a geometric display wordmark mesh for the scratch 3D pipeline.

Font: Arial Black (C:/Windows/Fonts/ariblk.ttf) — heavy geometric sans,
available on Windows, reads clearly when extruded + bevelled.

Wordmark: "klaut.pro" (full brand string, not a single letter).

Run:

  "%LOCALAPPDATA%\\Programs\\blender-portable\\blender-4.2.16-windows-x64\\blender.exe" ^
    --background --python scripts/bake-scratch-mesh.py

Or: npm run bake:scratch

Outputs:
  demo/scratch/mesh/wordmark-klaut-pro.glb
  demo/scratch/mesh/manifest.json
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

try:
    import bpy  # type: ignore
except ImportError:
    print("Run inside Blender: blender --background --python scripts/bake-scratch-mesh.py", file=sys.stderr)
    raise SystemExit(2)

ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "demo" / "scratch" / "mesh"
FONT = Path(r"C:\Windows\Fonts\ariblk.ttf")
TEXT = "klaut.pro"
MESH_NAME = "wordmark-klaut-pro.glb"
# Slightly thinner extrude for wide word (keeps glass readable, lighter mesh)
EXTRUDE = 0.09
BEVEL_DEPTH = 0.014
BEVEL_RES = 3
# Normalize so height ≈ TARGET_HEIGHT (wide word keeps natural aspect)
TARGET_HEIGHT = 1.15


def clear_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for block in (bpy.data.meshes, bpy.data.curves, bpy.data.materials, bpy.data.fonts):
        for b in list(block):
            block.remove(b)


def build_wordmark() -> None:
    if not FONT.exists():
        raise FileNotFoundError(FONT)

    clear_scene()
    font = bpy.data.fonts.load(str(FONT))
    curve = bpy.data.curves.new(name="ScratchWordmark", type="FONT")
    curve.body = TEXT
    curve.font = font
    curve.extrude = EXTRUDE
    curve.bevel_depth = BEVEL_DEPTH
    curve.bevel_resolution = BEVEL_RES
    curve.fill_mode = "BOTH"
    curve.align_x = "CENTER"
    curve.align_y = "CENTER"
    curve.space_character = 1.02

    obj = bpy.data.objects.new("ScratchWordmark", curve)
    bpy.context.collection.objects.link(obj)
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)

    # Convert to mesh for stable GLB normals
    bpy.ops.object.convert(target="MESH")
    mesh_obj = bpy.context.view_layer.objects.active

    # Font curves: X=width, Y=cap height, Z=extrude depth.
    # Normalize by Y (letter height) BEFORE rotating into Three.js Y-up.
    bpy.ops.object.origin_set(type="ORIGIN_GEOMETRY", center="BOUNDS")
    mesh_obj.location = (0.0, 0.0, 0.0)
    dims = mesh_obj.dimensions
    scale = TARGET_HEIGHT / max(dims.y, 1e-6)
    mesh_obj.scale = (scale, scale, scale)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

    # Face +Y toward camera-friendly default (Three.js Y-up):
    # Blender font XY plane → rotate +90° X so letter height lands on Y.
    mesh_obj.rotation_euler = (1.57079632679, 0.0, 0.0)  # +90° X
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
    bpy.ops.object.origin_set(type="ORIGIN_GEOMETRY", center="BOUNDS")
    mesh_obj.location = (0.0, 0.0, 0.0)

    # Shade smooth for glass
    bpy.ops.object.shade_smooth()
    for poly in mesh_obj.data.polygons:
        poly.use_smooth = True


def export_glb() -> Path:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    glb = OUT_DIR / MESH_NAME
    bpy.ops.export_scene.gltf(
        filepath=str(glb),
        export_format="GLB",
        use_selection=False,
        export_apply=True,
        export_yup=True,
    )
    return glb


def main() -> None:
    build_wordmark()
    glb = export_glb()
    dims = bpy.context.view_layer.objects.active.dimensions
    manifest = {
        "font": "Arial Black",
        "fontPath": str(FONT).replace("\\", "/"),
        "text": TEXT,
        "char": TEXT,
        "extrude": EXTRUDE,
        "bevelDepth": BEVEL_DEPTH,
        "bevelResolution": BEVEL_RES,
        "targetHeight": TARGET_HEIGHT,
        "bakedDimensions": {"x": dims.x, "y": dims.y, "z": dims.z},
        "mesh": MESH_NAME,
        "legacyMesh": "letter-K.glb",
        "pipeline": [
            "1-font: Arial Black (ariblk.ttf) wordmark klaut.pro",
            "2-mesh: Blender extrude+bevel → GLB",
            "3-glass: Three.js MeshPhysicalMaterial (demo/scratch.html)",
            "4-liquid: vertex liquify (demo)",
            "5-drip: viscosity-driven pendants (demo)",
        ],
    }
    (OUT_DIR / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {glb} ({glb.stat().st_size} bytes)")
    print(json.dumps(manifest, indent=2))


if __name__ == "__main__":
    # Blender may pass argv after `--`
    if "--" in sys.argv:
        sys.argv = [sys.argv[0], *sys.argv[sys.argv.index("--") + 1 :]]
    main()
