#!/usr/bin/env python3
"""
Bake geometric display wordmark mesh(es) for the scratch 3D pipeline.

- One mesh object per glyph (per-letter GravityMeltSim slots)
- Higher bevel + subdivision for round frozen pendants
- Bake-time SDF soft-boolean: pear drip tips unioned into letter bottoms,
  then voxel remesh so glyph densifies into filament (seamless letter→neck→bulb)
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
import math
import re
import sys
from pathlib import Path

try:
    import bpy  # type: ignore
    import bmesh  # type: ignore
    from mathutils import Vector  # type: ignore
except ImportError:
    print("Run inside Blender: blender --background --python scripts/bake-scratch-mesh.py", file=sys.stderr)
    raise SystemExit(2)

ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "demo" / "scratch" / "mesh"
TEXT = "klaut.pro"
EXTRUDE = 0.09
BEVEL_DEPTH = 0.02
# Density knobs — raised so glyph edges + melted necks stay smooth (not low-poly).
# Previous: bevel_res 8, resolution_u 12 (Blender default), subdiv 1, no remesh → ~93k verts.
BEVEL_RES = 16
RESOLUTION_U = 32
SUBDIV_LEVELS = 2
# Voxel remesh after tip soft-boolean only (single pass) — avoid double remesh blow-up.
# Prior pre-remesh 0.008 + tip 0.0065 → ~678k verts / 31MB hung demo load.
REMESH_VOXEL = 0.009
# Soft-boolean pear tips into letter bottoms (concept seamless drip).
SOFT_BOOLEAN_TIPS = True
TIP_RINGS = 16
TIP_SEGS = 18
# Alias kept for manifest; tip join uses REMESH_VOXEL after boolean.
TIP_REMESH_VOXEL = REMESH_VOXEL
TARGET_HEIGHT = 1.15
LETTER_GAP = 0.04  # extra tracking between separate letter objects

# Dual-leg / narrow-column glyphs — mirror demo/scratch.html preferential columns
DUAL_LEG_CHARS = set("kuanm")
NARROW_CHARS = set("plt.")
SPIKE_CHARS = set("p.gyj")

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
    curve.resolution_u = RESOLUTION_U
    curve.fill_mode = "BOTH"
    curve.align_x = "CENTER"
    curve.align_y = "CENTER"
    obj = bpy.data.objects.new(name, curve)
    bpy.context.collection.objects.link(obj)
    return obj


def convert_and_round(obj):
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


def remesh_dense(mesh_obj, voxel: float | None = None) -> None:
    """Voxel remesh in final world units for even melt-neck topology."""
    vs = REMESH_VOXEL if voxel is None else float(voxel)
    if vs <= 0:
        return
    bpy.ops.object.select_all(action="DESELECT")
    mesh_obj.select_set(True)
    bpy.context.view_layer.objects.active = mesh_obj
    rem = mesh_obj.modifiers.new(name="Remesh", type="REMESH")
    rem.mode = "VOXEL"
    rem.voxel_size = vs
    rem.use_smooth_shade = True
    bpy.ops.object.modifier_apply(modifier=rem.name)
    bpy.ops.object.shade_smooth()
    for poly in mesh_obj.data.polygons:
        poly.use_smooth = True


def _clamp01(v: float) -> float:
    return 0.0 if v < 0.0 else 1.0 if v > 1.0 else v


def _smoothstep(edge0: float, edge1: float, x: float) -> float:
    t = _clamp01((x - edge0) / max(edge1 - edge0, 1e-8))
    return t * t * (3.0 - 2.0 * t)


def honey_pendant_radius(u: float, neck_r: float, bulb_r: float, lip_r: float | None = None) -> float:
    """Match GravityMeltSim.honeyPendantRadius — lip → thick neck → pear bulb."""
    t = _clamp01(u)
    neck = max(neck_r, bulb_r * 0.72)
    bulb = max(bulb_r, neck * 1.28)
    lip = lip_r if lip_r is not None else neck * 1.2
    lip = max(min(lip, neck * 1.35), neck * 1.05)
    if t < 0.38:
        s = _smoothstep(0.0, 0.38, t) ** 0.85
        return lip + (neck - lip) * s
    if t < 0.78:
        s = _smoothstep(0.38, 0.72, t) ** 0.88
        return neck + (bulb - neck) * s
    tip = _smoothstep(0.78, 1.0, t) ** 1.3
    tip_r = bulb + (bulb * 0.42 - bulb) * tip
    tip_floor = bulb * (0.5 + (0.36 - 0.5) * tip)
    return max(tip_floor, tip_r)


def honey_pendant_y(u: float, lip_y: float, hang: float) -> float:
    """Match GravityMeltSim.honeyPendantY — short neck then pear body."""
    t = _clamp01(u)
    neck_frac = 0.22
    if t <= neck_frac:
        nu = t / max(neck_frac, 1e-6)
        return lip_y - hang * neck_frac * (nu ** 0.95)
    bu = (t - neck_frac) / (1.0 - neck_frac)
    return lip_y - hang * (neck_frac + (1.0 - neck_frac) * (bu ** 0.72))


def letter_drip_columns(ch: str, bb_min_x: float, bb_max_x: float) -> tuple[list[float], float]:
    """Preferential drip columns + half-width (demo/scratch.html parity)."""
    span_x = max(bb_max_x - bb_min_x, 1e-4)
    cx = (bb_min_x + bb_max_x) * 0.5
    if ch in DUAL_LEG_CHARS:
        inset = span_x * 0.32
        cols = [bb_min_x + inset, bb_max_x - inset]
    else:
        cols = [cx]
    narrow = ch in NARROW_CHARS
    col_w = max(span_x * (0.12 if len(cols) > 1 else 0.1 if narrow else 0.15), 0.02 if narrow else 0.026)
    return cols, col_w


def make_pear_tip_mesh(
    name: str,
    cx: float,
    lip_y: float,
    cz: float,
    hang: float,
    neck_r: float,
    bulb_r: float,
    lip_r: float,
    rings: int = TIP_RINGS,
    segs: int = TIP_SEGS,
):
    # Closed pear-of-revolution solid buried deep into letter lip (Y-up).
    rings = max(10, min(28, rings))
    segs = max(10, min(32, segs))
    # Deep bury so voxel remesh carves a concave fillet (kills hard shelf)
    bury = hang * 0.28
    lip_y_b = lip_y + bury

    mesh = bpy.data.meshes.new(name)
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)

    bm = bmesh.new()
    verts_grid: list[list] = []
    for ri in range(rings + 1):
        u = ri / rings
        R = honey_pendant_radius(u, neck_r, bulb_r, lip_r)
        y = honey_pendant_y(u, lip_y_b, hang + bury)
        row = []
        for s in range(segs):
            ang = (s / segs) * math.tau
            v = bm.verts.new((cx + math.cos(ang) * R, y, cz + math.sin(ang) * R * 0.96))
            row.append(v)
        verts_grid.append(row)
    # Tip pole
    tip_y = honey_pendant_y(1.0, lip_y_b, hang + bury)
    pole = bm.verts.new((cx, tip_y - hang * 0.01, cz))

    bm.verts.ensure_lookup_table()
    for ri in range(rings):
        for s in range(segs):
            s2 = (s + 1) % segs
            a = verts_grid[ri][s]
            b = verts_grid[ri][s2]
            c = verts_grid[ri + 1][s2]
            d = verts_grid[ri + 1][s]
            try:
                bm.faces.new((a, b, c, d))
            except ValueError:
                pass
    # Cap tip
    last = verts_grid[rings]
    for s in range(segs):
        s2 = (s + 1) % segs
        try:
            bm.faces.new((last[s], last[s2], pole))
        except ValueError:
            pass
    # Cap lip (closed solid for boolean)
    first = verts_grid[0]
    lip_center = bm.verts.new((cx, lip_y_b + hang * 0.01, cz))
    for s in range(segs):
        s2 = (s + 1) % segs
        try:
            bm.faces.new((lip_center, first[s2], first[s]))
        except ValueError:
            pass

    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(mesh)
    bm.free()
    mesh.update()
    return obj


def boolean_union(letter_obj, tip_obj) -> bool:
    """Exact boolean UNION; fall back to FLOAT if Exact fails."""
    bpy.ops.object.select_all(action="DESELECT")
    letter_obj.select_set(True)
    bpy.context.view_layer.objects.active = letter_obj
    for solver in ("EXACT", "FLOAT"):
        mod = letter_obj.modifiers.new(name=f"TipUnion_{solver}", type="BOOLEAN")
        mod.operation = "UNION"
        mod.solver = solver
        mod.object = tip_obj
        try:
            bpy.ops.object.modifier_apply(modifier=mod.name)
            return True
        except Exception as exc:
            print(f"  boolean {solver} failed on {letter_obj.name}: {exc}")
            if mod.name in letter_obj.modifiers:
                letter_obj.modifiers.remove(mod)
    return False


def dig_funnel_pits(
    mesh_obj,
    cols: list[float],
    cz: float,
    lip_y: float,
    lip_r: float,
    hang: float,
    neck_r: float,
) -> int:
    """Carve concave pits into letter underside before tip union (concept funnel)."""
    bm = bmesh.new()
    bm.from_mesh(mesh_obj.data)
    bm.verts.ensure_lookup_table()
    touched = 0
    for v in bm.verts:
        x, y, z = v.co.x, v.co.y, v.co.z
        if y > lip_y + hang * 0.08:
            continue
        best_d = 1e9
        cx = cols[0]
        for c in cols:
            d = math.hypot(x - c, z - cz)
            if d < best_d:
                best_d = d
                cx = c
        if best_d > lip_r:
            continue
        t = 1.0 - (best_d / max(lip_r, 1e-4)) ** 2
        sink = hang * 0.38 * t
        v.co.y = y - sink
        if best_d > 1e-6:
            gather = 0.55 * t
            s = 1.0 + (neck_r / best_d - 1.0) * gather
            s = max(0.28, min(1.0, s))
            v.co.x = cx + (x - cx) * s
            v.co.z = cz + (z - cz) * s * 0.96
        touched += 1
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(mesh_obj.data)
    bm.free()
    mesh_obj.data.update()
    return touched


def volume_soft_union(letter_obj, tip_obj, voxel: float) -> bool:
    """
    Blender 4.2 portable: Mesh→Volume modifiers cannot be stacked on a Volume
    object the way 3.x docs suggest. Keep hook for a future Geometry-Nodes SDF
    soft-union; always fall through to Exact/Float boolean + voxel remesh.
    """
    return False


def soft_boolean_lip_morph(
    mesh_obj,
    *,
    cols: list[float],
    cz: float,
    lip_y: float,
    hang: float,
    neck_r: float,
    bulb_r: float,
    lip_r: float,
    col_w: float,
) -> int:
    """
    Bake-time SDF soft-boolean on letter bottoms: pull near-lip verts onto
    softMin(letter disk, pear profile) so glyph densifies into the filament.
    """
    bpy.ops.object.select_all(action="DESELECT")
    mesh_obj.select_set(True)
    bpy.context.view_layer.objects.active = mesh_obj
    bm = bmesh.new()
    bm.from_mesh(mesh_obj.data)
    bm.verts.ensure_lookup_table()

    blend_k = max(col_w * 0.55, hang * 0.08)
    band = hang * 0.55
    touched = 0
    for v in bm.verts:
        x, y, z = v.co.x, v.co.y, v.co.z
        # Only morph the letter→filament collar (from shoulder into upper neck)
        if y > lip_y + hang * 0.22 or y < lip_y - hang * 0.55:
            continue
        best_ci = 0
        best_d = 1e9
        for ci, cx in enumerate(cols):
            d = math.hypot(x - cx, z - cz)
            if d < best_d:
                best_d = d
                best_ci = ci
        cx = cols[best_ci]
        if best_d > lip_r * 1.35:
            continue
        # Parametric u along pendant (0 at lip, 1 at tip)
        u = _clamp01((lip_y + hang * 0.05 - y) / max(hang, 1e-4))
        pear_r = honey_pendant_radius(u, neck_r, bulb_r, lip_r)
        # Soft-boolean: radial softMin of current radius vs pear (negative SDF style)
        r = math.hypot(x - cx, z - cz)
        # Quilez softMin on radii (smaller = inside): blend toward pear funnel
        # Use -softMin(-r, -pear) ≈ softMax(r, pear) for expanding into pear lip,
        # then mix back so letter underside sinks into neck.
        h = _clamp01(0.5 + 0.5 * (pear_r - r) / max(blend_k, 1e-4))
        blend_r = r * (1.0 - h) + pear_r * h - blend_k * h * (1.0 - h)
        # Weight stronger near lip, fade toward tip (tip already pear from boolean)
        w_y = _smoothstep(lip_y - hang * 0.45, lip_y + hang * 0.18, y)
        w = (1.0 - abs(w_y - 0.55) * 1.2) * _clamp01(1.0 - best_d / max(lip_r * 1.35, 1e-4))
        w = _clamp01(w) * 0.85
        if w < 0.05:
            continue
        # Target Y on pear profile
        want_y = honey_pendant_y(u, lip_y + hang * 0.04, hang)
        # Near original lip, pull DOWN into funnel (kill flat shelf)
        if y >= lip_y - hang * 0.02:
            want_y = min(want_y, lip_y - hang * 0.04 * (1.0 - u))
        ny = y + (want_y - y) * w * 0.65
        if r > 1e-6:
            s = blend_r / r
            nx = cx + (x - cx) * (1.0 + (s - 1.0) * w)
            nz = cz + (z - cz) * (1.0 + (s - 1.0) * w * 0.96)
        else:
            nx, nz = x, z
        v.co.x = nx
        v.co.y = ny
        v.co.z = nz
        touched += 1

    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(mesh_obj.data)
    bm.free()
    mesh_obj.data.update()
    return touched


def soft_boolean_letter_tips(mesh_obj, ch: str) -> dict:
    """
    SDF-style soft-boolean: pear tips unioned into letter bottom, then voxel
    remesh so topology densifies through letter→filament (kills hard shelf).
    """
    if not SOFT_BOOLEAN_TIPS:
        return {"tips": 0, "softBoolean": False}

    # Ensure evaluated bounds in world/local (transform already applied)
    bpy.context.view_layer.update()
    bb = [mesh_obj.matrix_world @ Vector(c) for c in mesh_obj.bound_box]
    xs = [v.x for v in bb]
    ys = [v.y for v in bb]
    zs = [v.z for v in bb]
    min_x, max_x = min(xs), max(xs)
    min_y, max_y = min(ys), max(ys)
    min_z, max_z = min(zs), max(zs)
    span_y = max(max_y - min_y, 1e-4)
    span_x = max(max_x - min_x, 1e-4)
    cz = (min_z + max_z) * 0.5
    lip_y = min_y

    cols, col_w = letter_drip_columns(ch, min_x, max_x)
    spike = ch in SPIKE_CHARS
    plump = 1.22 if spike else 1.12 if ch in "rt" else 1.05
    hang = span_y * (0.55 if spike else 0.48)
    # Wide shoulder into letter underside — remesh must form a funnel, not a stick
    neck_r = col_w * (1.05 if spike else 1.12) * plump
    lip_r = col_w * (1.85 if spike else 2.05) * plump
    bulb_r = col_w * (1.45 if spike else 1.35) * plump
    neck_r = max(neck_r, bulb_r * 0.72)
    bulb_r = max(bulb_r, neck_r * 1.28)
    # Cap lip so dual columns don't merge into a slab
    lip_r = min(lip_r, span_x * (0.42 if len(cols) > 1 else 0.55))
    lip_r = max(lip_r, neck_r * 1.25)

    tip_objs = []
    for ti, cx in enumerate(cols):
        tip = make_pear_tip_mesh(
            name=f"{mesh_obj.name}_tip{ti}",
            cx=cx,
            lip_y=lip_y,
            cz=cz,
            hang=hang,
            neck_r=neck_r,
            bulb_r=bulb_r,
            lip_r=lip_r,
            rings=TIP_RINGS + (2 if spike else 0),
            segs=TIP_SEGS + (4 if spike else 0),
        )
        tip_objs.append(tip)

    # Coarse remesh → manifold solid for reliable boolean
    remesh_dense(mesh_obj, voxel=max(REMESH_VOXEL * 1.35, 0.012))
    # Dig funnel pits AFTER remesh so voxels don't fill them back in
    dig_funnel_pits(mesh_obj, cols, cz, lip_y, lip_r, hang, neck_r)
    verts_before = len(mesh_obj.data.vertices)
    snap_name = f"{mesh_obj.name}_pre_tip"
    snap_mesh = mesh_obj.data.copy()
    snap_mesh.name = snap_name

    # Join all tips into one solid so dual-leg glyphs boolean once
    tip_union = tip_objs[0]
    if len(tip_objs) > 1:
        bpy.ops.object.select_all(action="DESELECT")
        for t in tip_objs:
            t.select_set(True)
        bpy.context.view_layer.objects.active = tip_objs[0]
        bpy.ops.object.join()
        tip_union = bpy.context.view_layer.objects.active

    united = 0
    tip_mesh = tip_union.data
    used_volume = volume_soft_union(mesh_obj, tip_union, TIP_REMESH_VOXEL)
    if used_volume:
        united = len(cols)
        print(f"  volume SDF soft-union ok on {mesh_obj.name}")
    elif boolean_union(mesh_obj, tip_union):
        united = len(cols)
    bpy.data.objects.remove(tip_union, do_unlink=True)
    if tip_mesh and tip_mesh.users == 0:
        bpy.data.meshes.remove(tip_mesh)

    # Voxel remesh = discrete SDF rebuild — soft fillet through the join
    if not used_volume:
        remesh_dense(mesh_obj, voxel=TIP_REMESH_VOXEL)
    else:
        remesh_dense(mesh_obj, voxel=TIP_REMESH_VOXEL)

    verts_after = len(mesh_obj.data.vertices)
    min_keep = max(8000, int(verts_before * 0.35))
    if united == 0 or verts_after < min_keep:
        print(
            f"  soft-boolean rollback {mesh_obj.name}: "
            f"united={united} verts {verts_before}->{verts_after} (min {min_keep})"
        )
        old = mesh_obj.data
        mesh_obj.data = snap_mesh
        if old.users == 0:
            bpy.data.meshes.remove(old)
        remesh_dense(mesh_obj, voxel=REMESH_VOXEL)
        united = 0
    else:
        if snap_mesh.users == 0:
            bpy.data.meshes.remove(snap_mesh)

    # Soft-boolean lip morph: densify letter underside into pear funnel (Quilez softMin)
    if united > 0:
        soft_boolean_lip_morph(
            mesh_obj,
            cols=cols,
            cz=cz,
            lip_y=lip_y,
            hang=hang,
            neck_r=neck_r,
            bulb_r=bulb_r,
            lip_r=lip_r,
            col_w=col_w,
        )

    # Light smooth on bottom band via Laplacian-ish (corrective smooth)
    bpy.ops.object.select_all(action="DESELECT")
    mesh_obj.select_set(True)
    bpy.context.view_layer.objects.active = mesh_obj
    try:
        sm = mesh_obj.modifiers.new(name="TipSmooth", type="SMOOTH")
        sm.factor = 0.35
        sm.iterations = 4
        bpy.ops.object.modifier_apply(modifier=sm.name)
    except Exception as exc:
        print(f"  tip smooth skipped: {exc}")

    bpy.ops.object.shade_smooth()
    for poly in mesh_obj.data.polygons:
        poly.use_smooth = True

    # Recompute after remesh: original letter lip is the tipU boundary
    bpy.context.view_layer.update()

    return {
        "tips": united,
        "softBoolean": united > 0,
        "columns": [float(c) for c in cols],
        "colW": float(col_w),
        "lipY": float(lip_y),
        "hang": float(hang),
        "neckR": float(neck_r),
        "bulbR": float(bulb_r),
        "lipR": float(lip_r),
        "spanY": float(span_y),
        "spanX": float(span_x),
    }


def build_wordmark(font_path: Path) -> tuple[list, list[dict]]:
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

    # Soft-boolean tips then single voxel remesh (SDF join densifies letter→filament).
    # Skip pre-tip remesh — double remesh blew past load budget (~678k verts).
    tip_meta: list[dict] = []
    for i, m in enumerate(mesh_objs):
        ch = TEXT[i] if i < len(TEXT) else "?"
        meta = soft_boolean_letter_tips(m, ch)
        meta["index"] = i
        meta["char"] = ch
        meta["meshName"] = m.name
        tip_meta.append(meta)
        print(
            f"  soft-boolean {m.name} ch={ch!r} tips={meta.get('tips', 0)} "
            f"verts={len(m.data.vertices)}"
        )

    return mesh_objs, tip_meta


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
    mesh_objs, tip_meta = build_wordmark(font_path)
    out_name = "wordmark-klaut-pro.glb" if primary else f"wordmark-{font_id}.glb"
    glb = export_glb(out_name)
    dims = {
        "x": sum(m.dimensions.x for m in mesh_objs) + 0.02 * (len(mesh_objs) - 1),
        "y": max(m.dimensions.y for m in mesh_objs),
        "z": max(m.dimensions.z for m in mesh_objs),
    }
    letters = []
    for i, ch in enumerate(TEXT):
        tm = tip_meta[i] if i < len(tip_meta) else {}
        letters.append({
            "index": i,
            "char": ch,
            "meshName": mesh_objs[i].name,
            "softBoolean": bool(tm.get("softBoolean")),
            "tips": int(tm.get("tips") or 0),
            "columns": tm.get("columns") or [],
            "colW": tm.get("colW"),
            "lipY": tm.get("lipY"),
            "hang": tm.get("hang"),
            "neckR": tm.get("neckR"),
            "bulbR": tm.get("bulbR"),
            "lipR": tm.get("lipR"),
        })
    entry = {
        "id": font_id,
        "label": label,
        "fontPath": str(font_path).replace("\\", "/"),
        "text": TEXT,
        "mesh": out_name,
        "primary": primary,
        "letters": letters,
        "softBooleanTips": SOFT_BOOLEAN_TIPS,
        "extrude": EXTRUDE,
        "bevelDepth": BEVEL_DEPTH,
        "bevelResolution": BEVEL_RES,
        "resolutionU": RESOLUTION_U,
        "subdivLevels": SUBDIV_LEVELS,
        "remeshVoxel": REMESH_VOXEL,
        "tipRemeshVoxel": TIP_REMESH_VOXEL,
        "targetHeight": TARGET_HEIGHT,
        "bakedDimensions": dims,
        "vertexCount": sum(len(m.data.vertices) for m in mesh_objs),
        "bytes": glb.stat().st_size,
    }
    print(
        f"wrote {glb} ({entry['bytes']} bytes) font={label} "
        f"letters={len(letters)} verts={entry['vertexCount']} "
        f"softBooleanTips={SOFT_BOOLEAN_TIPS}"
    )
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
            "softBooleanTips": e.get("softBooleanTips", False),
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
        "resolutionU": RESOLUTION_U,
        "subdivLevels": SUBDIV_LEVELS,
        "remeshVoxel": REMESH_VOXEL,
        "tipRemeshVoxel": TIP_REMESH_VOXEL,
        "softBooleanTips": SOFT_BOOLEAN_TIPS,
        "targetHeight": TARGET_HEIGHT,
        "bakedDimensions": primary_entry["bakedDimensions"],
        "vertexCount": primary_entry.get("vertexCount"),
        "mesh": primary_entry["mesh"],
        "letters": primary_entry["letters"],
        "perLetterMeshes": True,
        "legacyMesh": "letter-K.glb",
        "fontsCatalog": "fonts.json",
        "pipeline": [
            f"1-font: {primary_entry['label']} wordmark {TEXT} (per-glyph meshes)",
            "2-mesh: Blender extrude+bevel+subdiv+remesh → GLB",
            "2b-soft-boolean: pear tips ∪ letter bottoms + voxel remesh (SDF join)",
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
