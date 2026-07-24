#!/usr/bin/env python3
"""
Concept-faithful klaut.pro wordmark bake (Blender bpy — no Blender MCP).

Recreates the molten chrome / honey-teardrop look from
`klaut.pro/concept_art/` (esp. 1c6PD, EL2Hz) as **baked mesh geometry**:
plump beveled glyphs + honey drip pendants soft-unioned into letter bottoms.

Does NOT fight GravityMeltSim topology at runtime — drips live in the GLB.

Run:
  "%LOCALAPPDATA%\\Programs\\blender-portable\\blender-4.2.16-windows-x64\\blender.exe" ^
    --background --python scripts/bake-concept-wordmark.py

Or: npm run bake:concept
     npm run bake:scratch   (defaults to concept path)

Outputs:
  demo/scratch/mesh/wordmark-klaut-pro.glb   (primary)
  demo/scratch/mesh/manifest.json
  demo/scratch/mesh/fonts.json
"""

from __future__ import annotations

import json
import math
import sys
from pathlib import Path

try:
    import bpy  # type: ignore
    import bmesh  # type: ignore
    from mathutils import Vector  # type: ignore
except ImportError:
    print(
        "Run inside Blender: blender --background --python scripts/bake-concept-wordmark.py",
        file=sys.stderr,
    )
    raise SystemExit(2)

ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "demo" / "scratch" / "mesh"
TEXT = "klaut.pro"
FONT_PATH = Path(r"C:\Windows\Fonts\ariblk.ttf")
CLOSED_COUNTER_FONT = Path(r"C:\Windows\Fonts\segoeuib.ttf")

# Plump concept letterforms (rounded chrome blocks)
EXTRUDE = 0.11
BEVEL_DEPTH = 0.028
BEVEL_RES = 10
RESOLUTION_U = 20
SUBDIV_LEVELS = 1
# Coarser voxels — keep GLB under ~12MB so scratch loads without freezing orbit.
REMESH_VOXEL = 0.016
POST_UNION_VOXEL = 0.014
TARGET_HEIGHT = 1.15
LETTER_GAP = 0.045
TIP_RINGS = 14
TIP_SEGS = 16
USE_GN_SDF = True
SDF_BAND = 4
SDF_SOFT = REMESH_VOXEL * 2.2

# Concept 1c6PD drip map: which letters get a honey teardrop, and where.
# Values: "left" | "center" | "right" | "dual" | None
CONCEPT_DRIPS: dict[str, str | None] = {
    "k": "left",
    "l": None,
    "a": None,
    "u": None,
    "t": "center",
    ".": "center",
    "p": "left",
    "r": "center",
    "o": "center",
}


def _clamp01(v: float) -> float:
    return 0.0 if v < 0.0 else 1.0 if v > 1.0 else v


def _smoothstep(e0: float, e1: float, x: float) -> float:
    t = _clamp01((x - e0) / max(e1 - e0, 1e-8))
    return t * t * (3.0 - 2.0 * t)


def concept_pendant_radius(u: float, neck_r: float, bulb_r: float, lip_r: float) -> float:
    """Concept honey bead: lip → thin neck → fat spherical teardrop (1c6PD)."""
    t = _clamp01(u)
    neck = max(neck_r, bulb_r * 0.38)
    bulb = max(bulb_r, neck * 1.55)
    lip = max(min(lip_r, neck * 1.45), neck * 1.08)
    if t < 0.32:
        s = _smoothstep(0.0, 0.32, t) ** 0.9
        return lip + (neck - lip) * s
    if t < 0.78:
        s = _smoothstep(0.32, 0.72, t) ** 0.82
        return neck + (bulb - neck) * s
    tip = _smoothstep(0.78, 1.0, t) ** 1.25
    return max(bulb * 0.42, bulb + (bulb * 0.4 - bulb) * tip)


def concept_pendant_y(u: float, lip_y: float, hang: float) -> float:
    t = _clamp01(u)
    if t <= 0.28:
        nu = t / 0.28
        return lip_y - hang * 0.28 * (nu ** 0.95)
    bu = (t - 0.28) / 0.72
    return lip_y - hang * (0.28 + 0.72 * (bu ** 0.7))


def clear_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for block in (bpy.data.meshes, bpy.data.curves, bpy.data.materials, bpy.data.fonts):
        for b in list(block):
            block.remove(b)


def make_chrome_glass_material(name: str = "ConceptChromeGlass"):
    """Principled molten chrome / liquid glass for Cycles preview + GLB export."""
    mat = bpy.data.materials.new(name=name)
    mat.use_nodes = True
    nt = mat.node_tree
    nodes, links = nt.nodes, nt.links
    nodes.clear()
    out = nodes.new("ShaderNodeOutputMaterial")
    out.location = (400, 0)
    bsdf = nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.location = (0, 0)
    # Iridescent chrome-glass hybrid (GLTF maps metallic/roughness/transmission)
    bsdf.inputs["Base Color"].default_value = (0.92, 0.95, 0.98, 1.0)
    bsdf.inputs["Metallic"].default_value = 0.72
    bsdf.inputs["Roughness"].default_value = 0.06
    if "Transmission Weight" in bsdf.inputs:
        bsdf.inputs["Transmission Weight"].default_value = 0.35
    elif "Transmission" in bsdf.inputs:
        bsdf.inputs["Transmission"].default_value = 0.35
    if "IOR" in bsdf.inputs:
        bsdf.inputs["IOR"].default_value = 1.45
    if "Coat Weight" in bsdf.inputs:
        bsdf.inputs["Coat Weight"].default_value = 1.0
        bsdf.inputs["Coat Roughness"].default_value = 0.03
    elif "Clearcoat" in bsdf.inputs:
        bsdf.inputs["Clearcoat"].default_value = 1.0
        bsdf.inputs["Clearcoat Roughness"].default_value = 0.03
    # Subtle cyan→gold facing tint via Layer Weight (preview; Three overrides look)
    lw = nodes.new("ShaderNodeLayerWeight")
    lw.location = (-400, 120)
    lw.inputs["Blend"].default_value = 0.45
    ramp = nodes.new("ShaderNodeValToRGB")
    ramp.location = (-200, 120)
    ramp.color_ramp.elements[0].position = 0.15
    ramp.color_ramp.elements[0].color = (0.15, 0.85, 1.0, 1.0)
    ramp.color_ramp.elements[1].position = 0.85
    ramp.color_ramp.elements[1].color = (1.0, 0.75, 0.25, 1.0)
    mid = ramp.color_ramp.elements.new(0.5)
    mid.color = (0.55, 1.0, 0.4, 1.0)
    links.new(lw.outputs["Facing"], ramp.inputs["Fac"])
    mix = nodes.new("ShaderNodeMix")
    mix.data_type = "RGBA"
    mix.location = (-40, 200)
    mix.inputs["Factor"].default_value = 0.22
    mix.inputs["A"].default_value = (0.92, 0.95, 0.98, 1.0)
    links.new(ramp.outputs["Color"], mix.inputs["B"])
    links.new(mix.outputs["Result"], bsdf.inputs["Base Color"])
    links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    return mat


def make_letter(font, ch: str, name: str, font_override=None):
    closed = ch in "oOe0"
    curve = bpy.data.curves.new(name=name, type="FONT")
    curve.body = ch if ch != " " else "·"
    curve.font = font_override or font
    curve.extrude = EXTRUDE * (0.32 if closed else 1.0)
    curve.bevel_depth = BEVEL_DEPTH * (0.35 if closed else 1.0)
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
    if SUBDIV_LEVELS > 0:
        mod = mesh_obj.modifiers.new(name="Subdiv", type="SUBSURF")
        mod.levels = SUBDIV_LEVELS
        mod.render_levels = SUBDIV_LEVELS
        bpy.ops.object.modifier_apply(modifier=mod.name)
    bpy.ops.object.shade_smooth()
    for poly in mesh_obj.data.polygons:
        poly.use_smooth = True
    return mesh_obj


def remesh(mesh_obj, voxel: float) -> None:
    if voxel <= 0:
        return
    bpy.ops.object.select_all(action="DESELECT")
    mesh_obj.select_set(True)
    bpy.context.view_layer.objects.active = mesh_obj
    rem = mesh_obj.modifiers.new(name="Remesh", type="REMESH")
    rem.mode = "VOXEL"
    rem.voxel_size = float(voxel)
    rem.use_smooth_shade = True
    bpy.ops.object.modifier_apply(modifier=rem.name)
    bpy.ops.object.shade_smooth()
    for poly in mesh_obj.data.polygons:
        poly.use_smooth = True


def drip_columns(ch: str, bb_min_x: float, bb_max_x: float) -> list[float]:
    mode = CONCEPT_DRIPS.get(ch)
    if mode is None:
        return []
    span = max(bb_max_x - bb_min_x, 1e-4)
    cx = (bb_min_x + bb_max_x) * 0.5
    if mode == "left":
        if ch == "k":
            # Left stem only (concept: drip from k stem, not full width)
            stem_max = bb_min_x + span * 0.48
            return [(bb_min_x + stem_max) * 0.5]
        return [bb_min_x + span * 0.28]
    if mode == "right":
        return [bb_max_x - span * 0.28]
    if mode == "dual":
        return [bb_min_x + span * 0.32, bb_max_x - span * 0.32]
    return [cx]


def make_pear_tip(name, cx, lip_y, cz, hang, neck_r, bulb_r, lip_r):
    rings, segs = TIP_RINGS, TIP_SEGS
    bury = hang * 0.42
    lip_y_b = lip_y + bury
    mesh = bpy.data.meshes.new(name)
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    bm = bmesh.new()
    grid: list[list] = []
    for ri in range(rings + 1):
        u = ri / rings
        R = concept_pendant_radius(u, neck_r, bulb_r, lip_r)
        y = concept_pendant_y(u, lip_y_b, hang + bury)
        row = []
        for s in range(segs):
            ang = (s / segs) * math.tau
            row.append(
                bm.verts.new(
                    (cx + math.cos(ang) * R, y, cz + math.sin(ang) * R * 0.96)
                )
            )
        grid.append(row)
    tip_y = concept_pendant_y(1.0, lip_y_b, hang + bury)
    pole = bm.verts.new((cx, tip_y - hang * 0.012, cz))
    bm.verts.ensure_lookup_table()
    for ri in range(rings):
        for s in range(segs):
            s2 = (s + 1) % segs
            try:
                bm.faces.new((grid[ri][s], grid[ri][s2], grid[ri + 1][s2], grid[ri + 1][s]))
            except ValueError:
                pass
    last = grid[rings]
    for s in range(segs):
        s2 = (s + 1) % segs
        try:
            bm.faces.new((last[s], last[s2], pole))
        except ValueError:
            pass
    first = grid[0]
    lip_c = bm.verts.new((cx, lip_y_b + hang * 0.01, cz))
    for s in range(segs):
        s2 = (s + 1) % segs
        try:
            bm.faces.new((lip_c, first[s2], first[s]))
        except ValueError:
            pass
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(mesh)
    bm.free()
    mesh.update()
    return obj


def boolean_union(letter_obj, tip_obj) -> bool:
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
            print(f"  boolean {solver} failed: {exc}")
            if mod.name in letter_obj.modifiers:
                letter_obj.modifiers.remove(mod)
    return False


def _gn_sockets(ng) -> None:
    if not hasattr(ng, "interface"):
        return
    has_in = any(
        getattr(i, "in_out", "") == "INPUT" and i.socket_type == "NodeSocketGeometry"
        for i in ng.interface.items_tree
    )
    has_out = any(
        getattr(i, "in_out", "") == "OUTPUT" and i.socket_type == "NodeSocketGeometry"
        for i in ng.interface.items_tree
    )
    if not has_in:
        ng.interface.new_socket(name="Geometry", in_out="INPUT", socket_type="NodeSocketGeometry")
    if not has_out:
        ng.interface.new_socket(name="Geometry", in_out="OUTPUT", socket_type="NodeSocketGeometry")


def gn_sdf_union(letter_obj, tip_obj, voxel: float, soft: float) -> bool:
    if not USE_GN_SDF:
        return False
    bpy.ops.object.select_all(action="DESELECT")
    letter_obj.select_set(True)
    bpy.context.view_layer.objects.active = letter_obj
    verts_before = len(letter_obj.data.vertices)
    snap = letter_obj.data.copy()
    ng = bpy.data.node_groups.new(f"ConceptSDF_{tip_obj.name}", "GeometryNodeTree")
    _gn_sockets(ng)
    nodes, links = ng.nodes, ng.links
    nin = nodes.new("NodeGroupInput")
    nout = nodes.new("NodeGroupOutput")
    tip_info = nodes.new("GeometryNodeObjectInfo")
    tip_info.inputs[0].default_value = tip_obj
    tip_info.transform_space = "RELATIVE"
    vs = max(float(voxel), 1e-4)
    m2a = nodes.new("GeometryNodeMeshToSDFGrid")
    m2a.inputs[1].default_value = vs
    m2a.inputs[2].default_value = SDF_BAND
    m2b = nodes.new("GeometryNodeMeshToSDFGrid")
    m2b.inputs[1].default_value = vs
    m2b.inputs[2].default_value = SDF_BAND
    booln = nodes.new("GeometryNodeSDFGridBoolean")
    booln.operation = "UNION"
    multi = booln.inputs[1]
    g2m = nodes.new("GeometryNodeGridToMesh")
    g2m.inputs[1].default_value = -max(float(soft), 0.0)
    g2m.inputs[2].default_value = 0.0
    links.new(nin.outputs[0], m2a.inputs[0])
    links.new(tip_info.outputs["Geometry"], m2b.inputs[0])
    links.new(m2a.outputs[0], multi)
    links.new(m2b.outputs[0], multi)
    links.new(booln.outputs[0], g2m.inputs[0])
    links.new(g2m.outputs[0], nout.inputs[0])
    mod = letter_obj.modifiers.new(name="GN_ConceptSDF", type="NODES")
    mod.node_group = ng
    try:
        bpy.ops.object.modifier_apply(modifier=mod.name)
        ok = len(letter_obj.data.vertices) >= max(400, int(verts_before * 0.2))
        if not ok:
            old = letter_obj.data
            letter_obj.data = snap
            if old.users == 0:
                bpy.data.meshes.remove(old)
            return False
        if snap.users == 0:
            bpy.data.meshes.remove(snap)
        bpy.ops.object.shade_smooth()
        for poly in letter_obj.data.polygons:
            poly.use_smooth = True
        print(f"  GN SDF ok {letter_obj.name}: {verts_before}->{len(letter_obj.data.vertices)}")
        return True
    except Exception as exc:
        print(f"  GN SDF failed: {exc}")
        if mod.name in letter_obj.modifiers:
            letter_obj.modifiers.remove(mod)
        old = letter_obj.data
        letter_obj.data = snap
        if old.users == 0:
            bpy.data.meshes.remove(old)
        return False
    finally:
        try:
            bpy.data.node_groups.remove(ng)
        except Exception:
            pass


def attach_concept_drips(mesh_obj, ch: str) -> dict:
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
    cols = drip_columns(ch, min_x, max_x)
    closed = ch in "oOe0"

    if not cols:
        return {
            "tips": 0,
            "softBoolean": False,
            "sdfUnion": False,
            "columns": [],
            "colW": span_x * 0.12,
            "lipY": float(lip_y),
            "hang": 0.0,
            "neckR": 0.02,
            "bulbR": 0.03,
            "lipR": 0.035,
            "closedCounter": closed,
            "conceptDrip": CONCEPT_DRIPS.get(ch),
        }

    spike = ch in "p.gyj"
    # Closed o: short drip under the ring — Exact boolean only (SDF fills aperture)
    hang = span_y * (0.48 if closed else 0.72 if spike else 0.58 if ch == "k" else 0.62)
    col_w = max(span_x * (0.08 if closed else 0.11 if spike else 0.14), 0.024)
    neck_r = col_w * (0.42 if closed else 0.55)
    bulb_r = col_w * (0.95 if closed else 1.2)  # honey bead (concept)
    lip_r = col_w * (1.15 if closed else 1.45)
    lip_r = min(lip_r, span_x * (0.22 if closed else 0.35))
    lip_r = max(lip_r, neck_r * 1.15)

    if not closed:
        remesh(mesh_obj, REMESH_VOXEL * 1.15)
    tip_objs = []
    for ti, cx in enumerate(cols):
        tip_objs.append(
            make_pear_tip(
                f"{mesh_obj.name}_cdrip{ti}",
                cx,
                lip_y,
                cz,
                hang,
                neck_r,
                bulb_r,
                lip_r,
            )
        )

    united = 0
    used_sdf = False
    for tip in tip_objs:
        tip_mesh = tip.data
        # Closed counters: Exact/Float only — GN soft iso plugs the aperture
        if not closed and gn_sdf_union(mesh_obj, tip, REMESH_VOXEL, SDF_SOFT):
            united += 1
            used_sdf = True
        elif boolean_union(mesh_obj, tip):
            united += 1
        bpy.data.objects.remove(tip, do_unlink=True)
        if tip_mesh.users == 0:
            bpy.data.meshes.remove(tip_mesh)

    if united > 0 and not closed:
        remesh(mesh_obj, POST_UNION_VOXEL if used_sdf else REMESH_VOXEL)
        bpy.ops.object.select_all(action="DESELECT")
        mesh_obj.select_set(True)
        bpy.context.view_layer.objects.active = mesh_obj
        try:
            sm = mesh_obj.modifiers.new(name="ConceptSmooth", type="SMOOTH")
            sm.factor = 0.4
            sm.iterations = 6
            bpy.ops.object.modifier_apply(modifier=sm.name)
        except Exception as exc:
            print(f"  smooth skipped: {exc}")
        bpy.ops.object.shade_smooth()
        for poly in mesh_obj.data.polygons:
            poly.use_smooth = True
    elif united > 0 and closed:
        bpy.ops.object.select_all(action="DESELECT")
        mesh_obj.select_set(True)
        bpy.context.view_layer.objects.active = mesh_obj
        bpy.ops.object.shade_smooth()
        for poly in mesh_obj.data.polygons:
            poly.use_smooth = True

    print(
        f"  concept drip {ch!r}: tips={united} sdf={used_sdf} closed={closed} "
        f"hang={hang:.3f} bulb={bulb_r:.3f} verts={len(mesh_obj.data.vertices)}"
    )
    return {
        "tips": united,
        "softBoolean": united > 0,
        "sdfUnion": used_sdf,
        "columns": [float(c) for c in cols],
        "colW": float(col_w),
        "lipY": float(lip_y),
        "hang": float(hang),
        "neckR": float(neck_r),
        "bulbR": float(bulb_r),
        "lipR": float(lip_r),
        "closedCounter": closed,
        "conceptDrip": CONCEPT_DRIPS.get(ch),
    }


def layout_and_orient(mesh_objs: list) -> None:
    widths = []
    for m in mesh_objs:
        bpy.ops.object.select_all(action="DESELECT")
        m.select_set(True)
        bpy.context.view_layer.objects.active = m
        bpy.ops.object.origin_set(type="ORIGIN_GEOMETRY", center="BOUNDS")
        widths.append(max(m.dimensions.x, 0.02))

    total_w = sum(widths) + LETTER_GAP * (len(widths) - 1)
    x = -total_w * 0.5
    for m, w in zip(mesh_objs, widths):
        m.location = (x + w * 0.5, 0.0, 0.0)
        x += w + LETTER_GAP

    max_h = max(m.dimensions.y for m in mesh_objs)
    scale = TARGET_HEIGHT / max(max_h, 1e-6)
    for m in mesh_objs:
        m.scale = (scale, scale, scale)
        bpy.ops.object.select_all(action="DESELECT")
        m.select_set(True)
        bpy.context.view_layer.objects.active = m
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

    widths2 = [max(m.dimensions.x, 0.02) for m in mesh_objs]
    gap = LETTER_GAP * scale
    total_w2 = sum(widths2) + gap * (len(widths2) - 1)
    x = -total_w2 * 0.5
    for m, w in zip(mesh_objs, widths2):
        m.location = (x + w * 0.5, 0.0, 0.0)
        x += w + gap
        bpy.ops.object.select_all(action="DESELECT")
        m.select_set(True)
        bpy.context.view_layer.objects.active = m
        bpy.ops.object.transform_apply(location=True, rotation=False, scale=False)

    for m in mesh_objs:
        bpy.ops.object.select_all(action="DESELECT")
        m.select_set(True)
        bpy.context.view_layer.objects.active = m
        m.rotation_euler = (1.57079632679, 0.0, 0.0)
        bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
        bpy.ops.object.origin_set(type="ORIGIN_GEOMETRY", center="BOUNDS")

    min_x = min(m.location.x - m.dimensions.x * 0.5 for m in mesh_objs)
    max_x = max(m.location.x + m.dimensions.x * 0.5 for m in mesh_objs)
    mid = (min_x + max_x) * 0.5
    for m in mesh_objs:
        m.location.x -= mid
        bpy.ops.object.select_all(action="DESELECT")
        m.select_set(True)
        bpy.context.view_layer.objects.active = m
        bpy.ops.object.transform_apply(location=True, rotation=False, scale=False)


def assign_materials(mesh_objs: list, mat) -> None:
    for m in mesh_objs:
        m.data.materials.clear()
        m.data.materials.append(mat)


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
        export_materials="EXPORT",
    )
    return glb


def main() -> None:
    if not FONT_PATH.exists():
        raise FileNotFoundError(FONT_PATH)

    clear_scene()
    font = bpy.data.fonts.load(str(FONT_PATH))
    closed_font = None
    if CLOSED_COUNTER_FONT.exists():
        closed_font = bpy.data.fonts.load(str(CLOSED_COUNTER_FONT))

    raw = []
    for i, ch in enumerate(TEXT):
        safe = "dot" if ch == "." else ch
        face = closed_font if (closed_font and ch in "oOe0") else None
        raw.append(make_letter(font, ch, f"letter_{i}_{safe}", font_override=face))

    mesh_objs = [convert_and_round(o) for o in raw]
    layout_and_orient(mesh_objs)

    tip_meta = []
    for i, m in enumerate(mesh_objs):
        ch = TEXT[i]
        meta = attach_concept_drips(m, ch)
        # Even density on letters without drip remesh (keeps GLB lean / orbit smooth)
        if not meta.get("softBoolean") and not meta.get("closedCounter"):
            remesh(m, REMESH_VOXEL * 1.35)
            meta["remeshed"] = True
        meta["index"] = i
        meta["char"] = ch
        meta["meshName"] = m.name
        tip_meta.append(meta)

    mat = make_chrome_glass_material()
    assign_materials(mesh_objs, mat)

    glb = export_glb("wordmark-klaut-pro.glb")
    dims = {
        "x": sum(m.dimensions.x for m in mesh_objs) + 0.02 * (len(mesh_objs) - 1),
        "y": max(m.dimensions.y for m in mesh_objs),
        "z": max(m.dimensions.z for m in mesh_objs),
    }
    letters = []
    for tm in tip_meta:
        letters.append(
            {
                "index": tm["index"],
                "char": tm["char"],
                "meshName": tm["meshName"],
                "softBoolean": bool(tm.get("softBoolean")),
                "sdfUnion": bool(tm.get("sdfUnion")),
                "tips": int(tm.get("tips") or 0),
                "columns": tm.get("columns") or [],
                "colW": tm.get("colW"),
                "lipY": tm.get("lipY"),
                "hang": tm.get("hang"),
                "neckR": tm.get("neckR"),
                "bulbR": tm.get("bulbR"),
                "lipR": tm.get("lipR"),
                "closedCounter": bool(tm.get("closedCounter")),
                "conceptDrip": tm.get("conceptDrip"),
            }
        )

    entry = {
        "id": "arial-black",
        "label": "Arial Black",
        "fontPath": str(FONT_PATH).replace("\\", "/"),
        "text": TEXT,
        "mesh": "wordmark-klaut-pro.glb",
        "primary": True,
        "conceptBake": True,
        "softBooleanTips": True,
        "letters": letters,
        "bakedDimensions": dims,
        "vertexCount": sum(len(m.data.vertices) for m in mesh_objs),
        "bytes": glb.stat().st_size,
    }

    catalog = {
        "text": TEXT,
        "defaultId": "arial-black",
        "conceptBake": True,
        "blenderMcp": False,
        "fonts": [
            {
                "id": entry["id"],
                "label": entry["label"],
                "mesh": entry["mesh"],
                "fontPath": entry["fontPath"],
                "primary": True,
                "conceptBake": True,
                "softBooleanTips": True,
                "letters": letters,
            }
        ],
    }
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    (OUT_DIR / "fonts.json").write_text(json.dumps(catalog, indent=2) + "\n", encoding="utf-8")

    manifest = {
        "font": "Arial Black",
        "fontPath": entry["fontPath"],
        "fontId": "arial-black",
        "text": TEXT,
        "mesh": "wordmark-klaut-pro.glb",
        "conceptBake": True,
        "blenderMcp": False,
        "blenderMcpNote": "No Blender MCP server in Cursor; bake via portable Blender 4.2 bpy.",
        "softBooleanTips": True,
        "gnSdfUnion": USE_GN_SDF,
        "targetHeight": TARGET_HEIGHT,
        "bakedDimensions": dims,
        "vertexCount": entry["vertexCount"],
        "bytes": entry["bytes"],
        "letters": letters,
        "perLetterMeshes": True,
        "fontsCatalog": "fonts.json",
        "conceptRefs": [
            "klaut.pro/concept_art/1c6PD.jpg",
            "klaut.pro/concept_art/EL2Hz.jpg",
        ],
        "pipeline": [
            "0-mcp: Blender MCP unavailable — use portable bpy bake",
            "1-font: Arial Black klaut.pro (per-glyph meshes, plump bevel)",
            "2-concept-drip: honey teardrops on k/t/./p/r/o (1c6PD map) baked into mesh",
            "2b-union: GN SDF soft-union (fallback Exact/Float boolean) + remesh/smooth",
            "3-material: Principled chrome/glass (metallic+transmission) exported in GLB",
            "4-scratch: Three honeyChrome Physical + OrbitControls; GravityMeltSim optional (stage 5)",
        ],
        "matchHonesty": (
            "Geometry targets concept honey beads + letter plumpness. "
            "Full iridescent chrome of concept art is approximated in Three "
            "(softbox PMREM + fringe), not pixel-matched Cycles render."
        ),
    }
    (OUT_DIR / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(
        json.dumps(
            {
                "wrote": str(glb),
                "bytes": entry["bytes"],
                "verts": entry["vertexCount"],
                "conceptBake": True,
                "blenderMcp": False,
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
