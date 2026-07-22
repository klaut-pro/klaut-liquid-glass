#!/usr/bin/env python3
"""
Bake geometric display wordmark mesh(es) for the scratch 3D pipeline.

- One mesh object per glyph (per-letter GravityMeltSim slots)
- Higher bevel + subdivision for round frozen pendants
- Font selectable via --font / --font-path

Run:

  "%LOCALAPPDATA%\\Programs\\blender-portable\\blender-4.2.16-windows-x64\\blender.exe" ^
    --background --python scripts/bake-scratch-mesh.py -- --font "Arial Black"

Or: npm run bake:scratch
     npm run bake:scratch -- --all-fonts

Outputs:
  demo/scratch/mesh/wordmark-klaut-pro.glb          (default / Arial Black)
  demo/scratch/mesh/wordmark-{slug}.glb             (extra fonts)
  demo/scratch/mesh/manifest.json
  demo/scratch/mesh/fonts.json                      (catalog for demo picker)
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

try:
    import bpy  # type: ignore
except ImportError:
    print("Run inside Blender: blender --background --python scripts/bake-scratch-mesh.py", file=sys.stderr)
    raise SystemExit(2)

ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "demo" / "scratch" / "mesh"
TEXT = "klaut.pro"
EXTRUDE = 0.09
BEVEL_DEPTH = 0.02
BEVEL_RES = 8
SUBDIV_LEVELS = 1
TARGET_HEIGHT = 1.15
LETTER_GAP = 0.04  # extra tracking between separate letter objects

# Display name → Windows font path (plus any already used in demos)
FONT_CATALOG: list[dict[str, str]] = [
    {"id": "arial-black", "label": "Arial Black", "path": r"C:\Windows\Fonts\ariblk.ttf"},
    {"id": "impact", "label": "Impact", "path": r"C:\Windows\Fonts\impact.ttf"},
    {"id": "segoe-ui-bold", "label": "Segoe UI Bold", "path": r"C:\Windows\Fonts\segoeuib.ttf"},
    {"id": "arial-bold", "label": "Arial Bold", "path": r"C:\Windows\Fonts\arialbd.ttf"},
    {"id": "verdana-bold", "label": "Verdana Bold", "path": r"C:\Windows\Fonts\verdanab.ttf"},
    {"id": "tahoma-bold", "label": "Tahoma Bold", "path": r"C:\Windows\Fonts\tahomabd.ttf"},
    {"id": "trebuchet-bold", "label": "Trebuchet MS Bold", "path": r"C:\Windows\Fonts\trebucbd.ttf"},
    {"id": "bahnschrift", "label": "Bahnschrift", "path": r"C:\Windows\Fonts\bahnschrift.ttf"},
]


def slugify(label: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", label.lower()).strip("-")
    return s or "font"


def clear_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for block in (bpy.data.meshes, bpy.data.curves, bpy.data.materials, bpy.data.fonts):
        for b in list(block):
            block.remove(b)


def make_letter(font, ch: str, name: str):
    curve = bpy.data.curves.new(name=name, type="FONT")
    curve.body = ch if ch != " " else "·"
    curve.font = font
    curve.extrude = EXTRUDE
    curve.bevel_depth = BEVEL_DEPTH
    curve.bevel_resolution = BEVEL_RES
    curve.fill_mode = "BOTH"
    curve.align_x = "CENTER"
    curve.align_y = "CENTER"
    obj = bpy.data.objects.new(name, curve)
    bpy.context.collection.objects.link(obj)
    return obj


def convert_and_round(obj) -> None:
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.convert(target="MESH")
    mesh_obj = bpy.context.view_layer.objects.active

    # Subdivision for denser melt region (rounder sag, less faceting)
    if SUBDIV_LEVELS > 0:
        mod = mesh_obj.modifiers.new(name="Subdiv", type="SUBSURF")
        mod.levels = SUBDIV_LEVELS
        mod.render_levels = SUBDIV_LEVELS
        bpy.ops.object.modifier_apply(modifier=mod.name)

    bpy.ops.object.shade_smooth()
    for poly in mesh_obj.data.polygons:
        poly.use_smooth = True
    return mesh_obj


def build_wordmark(font_path: Path) -> list:
    if not font_path.exists():
        raise FileNotFoundError(font_path)

    clear_scene()
    font = bpy.data.fonts.load(str(font_path))

    # Build each glyph as its own object so GravityMeltSim gets one slot / letter
    raw_objs = []
    for i, ch in enumerate(TEXT):
        safe = "dot" if ch == "." else ch
        name = f"letter_{i}_{safe}"
        raw_objs.append(make_letter(font, ch, name))

    # Convert + measure widths in Blender font XY plane (before Y-up rotate)
    mesh_objs = []
    widths = []
    for obj in raw_objs:
        m = convert_and_round(obj)
        mesh_objs.append(m)
        bpy.ops.object.origin_set(type="ORIGIN_GEOMETRY", center="BOUNDS")
        widths.append(max(m.dimensions.x, 0.02))

    # Layout along +X with small gaps, centered
    total_w = sum(widths) + LETTER_GAP * (len(widths) - 1)
    x = -total_w * 0.5
    for m, w in zip(mesh_objs, widths):
        m.location = (x + w * 0.5, 0.0, 0.0)
        x += w + LETTER_GAP

    # Normalize whole wordmark height by Y, then rotate to Three.js Y-up
    # Parent under empty for joint scale, or scale each relative to max height
    max_h = max(m.dimensions.y for m in mesh_objs)
    scale = TARGET_HEIGHT / max(max_h, 1e-6)
    for m in mesh_objs:
        m.scale = (scale, scale, scale)
        bpy.ops.object.select_all(action="DESELECT")
        m.select_set(True)
        bpy.context.view_layer.objects.active = m
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

    # Re-layout after scale (locations were scaled with transform_apply)
    widths2 = [max(m.dimensions.x, 0.02) for m in mesh_objs]
    total_w2 = sum(widths2) + LETTER_GAP * scale * (len(widths2) - 1)
    gap = LETTER_GAP * scale
    x = -total_w2 * 0.5
    for m, w in zip(mesh_objs, widths2):
        m.location = (x + w * 0.5, 0.0, 0.0)
        x += w + gap
        bpy.ops.object.select_all(action="DESELECT")
        m.select_set(True)
        bpy.context.view_layer.objects.active = m
        bpy.ops.object.transform_apply(location=True, rotation=False, scale=False)

    # Rotate each +90° X so letter height → Y
    for m in mesh_objs:
        bpy.ops.object.select_all(action="DESELECT")
        m.select_set(True)
        bpy.context.view_layer.objects.active = m
        m.rotation_euler = (1.57079632679, 0.0, 0.0)
        bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
        bpy.ops.object.origin_set(type="ORIGIN_GEOMETRY", center="BOUNDS")

    # Center group on origin
    min_x = min(m.location.x - m.dimensions.x * 0.5 for m in mesh_objs)
    max_x = max(m.location.x + m.dimensions.x * 0.5 for m in mesh_objs)
    mid = (min_x + max_x) * 0.5
    for m in mesh_objs:
        m.location.x -= mid
        bpy.ops.object.select_all(action="DESELECT")
        m.select_set(True)
        bpy.context.view_layer.objects.active = m
        bpy.ops.object.transform_apply(location=True, rotation=False, scale=False)
        bpy.ops.object.shade_smooth()

    return mesh_objs


def export_glb(out_name: str) -> Path:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    glb = OUT_DIR / out_name
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.export_scene.gltf(
        filepath=str(glb),
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_yup=True,
    )
    return glb


def bake_one(font_id: str, label: str, font_path: Path, primary: bool) -> dict:
    mesh_objs = build_wordmark(font_path)
    out_name = "wordmark-klaut-pro.glb" if primary else f"wordmark-{font_id}.glb"
    glb = export_glb(out_name)
    dims = {
        "x": sum(m.dimensions.x for m in mesh_objs) + 0.02 * (len(mesh_objs) - 1),
        "y": max(m.dimensions.y for m in mesh_objs),
        "z": max(m.dimensions.z for m in mesh_objs),
    }
    letters = []
    for i, ch in enumerate(TEXT):
        letters.append({
            "index": i,
            "char": ch,
            "meshName": mesh_objs[i].name,
        })
    entry = {
        "id": font_id,
        "label": label,
        "fontPath": str(font_path).replace("\\", "/"),
        "text": TEXT,
        "mesh": out_name,
        "primary": primary,
        "letters": letters,
        "extrude": EXTRUDE,
        "bevelDepth": BEVEL_DEPTH,
        "bevelResolution": BEVEL_RES,
        "subdivLevels": SUBDIV_LEVELS,
        "targetHeight": TARGET_HEIGHT,
        "bakedDimensions": dims,
        "bytes": glb.stat().st_size,
    }
    print(f"wrote {glb} ({entry['bytes']} bytes) font={label} letters={len(letters)}")
    return entry


def parse_args(argv: list[str]) -> argparse.Namespace:
    p = argparse.ArgumentParser()
    p.add_argument("--font", default="Arial Black", help="Font label from catalog")
    p.add_argument("--font-path", default="", help="Override TTF/OTF path")
    p.add_argument("--font-id", default="", help="Output slug override")
    p.add_argument("--all-fonts", action="store_true", help="Bake every catalog font that exists")
    p.add_argument("--primary-id", default="arial-black", help="Which bake writes wordmark-klaut-pro.glb")
    return p.parse_args(argv)


def main(argv: list[str] | None = None) -> None:
    args = parse_args(argv or [])
    available = []
    for f in FONT_CATALOG:
        if Path(f["path"]).exists():
            available.append(f)
        else:
            print(f"skip missing font: {f['label']} ({f['path']})")

    baked = []
    if args.all_fonts:
        for f in available:
            primary = f["id"] == args.primary_id
            baked.append(bake_one(f["id"], f["label"], Path(f["path"]), primary))
    else:
        font_path = Path(args.font_path) if args.font_path else None
        label = args.font
        font_id = args.font_id or slugify(label)
        if font_path is None:
            match = next((f for f in FONT_CATALOG if f["label"].lower() == label.lower() or f["id"] == label.lower()), None)
            if not match:
                # fuzzy contains
                match = next((f for f in FONT_CATALOG if label.lower() in f["label"].lower()), None)
            if not match:
                raise SystemExit(f"Unknown font '{label}'. Use --font-path or one of: {[f['label'] for f in FONT_CATALOG]}")
            font_path = Path(match["path"])
            label = match["label"]
            font_id = match["id"]
        if not font_path.exists():
            raise FileNotFoundError(font_path)
        primary = font_id == args.primary_id or not args.font_path
        baked.append(bake_one(font_id, label, font_path, primary))

    # Merge into fonts.json catalog (keep prior entries for fonts we didn't rebake)
    fonts_path = OUT_DIR / "fonts.json"
    prev = {}
    if fonts_path.exists() and not args.all_fonts:
        try:
            prev_list = json.loads(fonts_path.read_text(encoding="utf-8")).get("fonts", [])
            prev = {e["id"]: e for e in prev_list}
        except Exception:
            prev = {}
    for e in baked:
        prev[e["id"]] = {
            "id": e["id"],
            "label": e["label"],
            "mesh": e["mesh"],
            "fontPath": e["fontPath"],
            "primary": e.get("primary", False),
            "letters": e["letters"],
        }
    # Drop catalog entries whose mesh file is missing
    cleaned = {}
    for fid, v in prev.items():
        mesh_path = OUT_DIR / v["mesh"]
        if mesh_path.exists():
            cleaned[fid] = v
        else:
            print(f"drop catalog entry (missing mesh): {fid}")
    prev = cleaned
    # Ensure only one primary
    if any(v.get("primary") for v in prev.values()):
        seen = False
        for v in prev.values():
            if v.get("primary"):
                if seen:
                    v["primary"] = False
                seen = True

    catalog = {
        "text": TEXT,
        "defaultId": args.primary_id,
        "fonts": sorted(prev.values(), key=lambda x: (not x.get("primary", False), x["label"])),
    }
    fonts_path.write_text(json.dumps(catalog, indent=2) + "\n", encoding="utf-8")

    primary_entry = next((e for e in baked if e.get("primary")), baked[0])
    manifest = {
        "font": primary_entry["label"],
        "fontPath": primary_entry["fontPath"],
        "fontId": primary_entry["id"],
        "text": TEXT,
        "char": TEXT,
        "extrude": EXTRUDE,
        "bevelDepth": BEVEL_DEPTH,
        "bevelResolution": BEVEL_RES,
        "subdivLevels": SUBDIV_LEVELS,
        "targetHeight": TARGET_HEIGHT,
        "bakedDimensions": primary_entry["bakedDimensions"],
        "mesh": primary_entry["mesh"],
        "letters": primary_entry["letters"],
        "perLetterMeshes": True,
        "legacyMesh": "letter-K.glb",
        "fontsCatalog": "fonts.json",
        "pipeline": [
            f"1-font: {primary_entry['label']} wordmark {TEXT} (per-glyph meshes)",
            "2-mesh: Blender extrude+bevel+subdiv → GLB",
            "3-glass: Three.js MeshPhysicalMaterial (demo/scratch.html)",
            "4-liquid: GravityMeltSim per-letter overrides",
            "5-sag: frozen viscoplastic neck/bulb (no drip blobs)",
        ],
    }
    (OUT_DIR / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"baked": [e["mesh"] for e in baked], "catalog": str(fonts_path)}, indent=2))


if __name__ == "__main__":
    argv = sys.argv
    if "--" in argv:
        argv = argv[argv.index("--") + 1 :]
    else:
        # When Blender passes only the script path, no user args
        argv = []
    main(argv)
