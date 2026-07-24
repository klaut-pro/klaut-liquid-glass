#!/usr/bin/env python3
"""
Concept-faithful klaut.pro wordmark bake (Blender bpy — no Blender MCP).

Recreates the molten chrome / honey-teardrop look from
`klaut.pro/concept_art/` (esp. 1c6PD, EL2Hz) as **baked mesh geometry**:
plump beveled glyphs + honey drip pendants soft-unioned into letter *undersides*
(world -Z after orient / glTF -Y) — continuous bottom lip → neck → teardrop,
never blobs stuck on the front face.

Brand fonts (IBM Plex) live in demo/scratch/fonts/; system Arial Black remains
available. Drip columns sample real bottom mass (not AABB guesses) so every
intended letter matches the continuous k stem hang.

Run:
  "%LOCALAPPDATA%\\Programs\\blender-portable\\blender-4.2.16-windows-x64\\blender.exe" ^
    --background --python scripts/bake-concept-wordmark.py

Or: npm run bake:concept
     npm run bake:scratch

Outputs:
  demo/scratch/mesh/wordmark-klaut-pro.glb   (primary)
  demo/scratch/mesh/wordmark-klaut-pro-*.glb (other fonts)
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
FONT_DIR = ROOT / "demo" / "scratch" / "fonts"
TEXT = "klaut.pro"

# Brand + display faces for scratch font picker / bake
FONT_CATALOG: list[dict] = [
    {
        "id": "ibm-plex-sans-bold",
        "label": "IBM Plex Sans Bold",
        "path": FONT_DIR / "IBMPlexSans-Bold.otf",
        "brand": True,
        "primary": True,
    },
    {
        "id": "ibm-plex-sans-semibold",
        "label": "IBM Plex Sans SemiBold",
        "path": FONT_DIR / "IBMPlexSans-SemiBold.otf",
        "brand": True,
        "primary": False,
    },
    {
        "id": "ibm-plex-serif-bold",
        "label": "IBM Plex Serif Bold",
        "path": FONT_DIR / "IBMPlexSerif-Bold.otf",
        "brand": True,
        "primary": False,
    },
    {
        "id": "arial-black",
        "label": "Arial Black",
        "path": Path(r"C:\Windows\Fonts\ariblk.ttf"),
        "brand": False,
        "primary": False,
    },
]

CLOSED_COUNTER_FONT = Path(r"C:\Windows\Fonts\segoeuib.ttf")

# Plump concept letterforms (rounded chrome blocks)
EXTRUDE = 0.11
BEVEL_DEPTH = 0.028
BEVEL_RES = 10
RESOLUTION_U = 20
SUBDIV_LEVELS = 1
# Coarser voxels — keep GLB under ~12MB so scratch loads without freezing orbit.
REMESH_VOXEL = 0.016
POST_UNION_VOXEL = 0.012
TARGET_HEIGHT = 1.15
LETTER_GAP = 0.045
TIP_RINGS = 16
TIP_SEGS = 18
USE_GN_SDF = True
SDF_BAND = 4
# Softer than before but below neck floor so thin necks survive remesh
SDF_SOFT = REMESH_VOXEL * 2.05
# Hard floor: neck must outlive SDF soft-iso + voxel remesh (k survived because thicker)
NECK_FLOOR = max(REMESH_VOXEL * 4.25, SDF_SOFT * 1.45, 0.048)

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


def _argv_after_double_dash() -> list[str]:
    if "--" in sys.argv:
        i = sys.argv.index("--")
        return sys.argv[i + 1 :]
    return []


def _clamp01(v: float) -> float:
    return 0.0 if v < 0.0 else 1.0 if v > 1.0 else v


def _smoothstep(e0: float, e1: float, x: float) -> float:
    t = _clamp01((x - e0) / max(e1 - e0, 1e-8))
    return t * t * (3.0 - 2.0 * t)


def concept_pendant_radius(u: float, neck_r: float, bulb_r: float, lip_r: float) -> float:
    """Concept honey bead: lip → thin neck → fat spherical teardrop (1c6PD)."""
    t = _clamp01(u)
    neck = max(neck_r, bulb_r * 0.42, NECK_FLOOR)
    bulb = max(bulb_r, neck * 1.65)
    lip = max(min(lip_r, neck * 1.55), neck * 1.18)
    if t < 0.28:
        s = _smoothstep(0.0, 0.28, t) ** 0.85
        return lip + (neck - lip) * s
    if t < 0.72:
        s = _smoothstep(0.28, 0.70, t) ** 0.8
        return neck + (bulb - neck) * s
    tip = _smoothstep(0.72, 1.0, t) ** 1.2
    return max(bulb * 0.45, bulb + (bulb * 0.38 - bulb) * tip)


def concept_pendant_hang(u: float, lip: float, hang: float) -> float:
    """Axis position along hang direction: lip → tip (lip decreases by hang)."""
    t = _clamp01(u)
    # Longer continuous filament before bulb (matches k readability)
    if t <= 0.34:
        nu = t / 0.34
        return lip - hang * 0.34 * (nu ** 0.92)
    bu = (t - 0.34) / 0.66
    return lip - hang * (0.34 + 0.66 * (bu ** 0.72))


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


def _world_verts(mesh_obj) -> list[Vector]:
    mw = mesh_obj.matrix_world
    return [mw @ v.co for v in mesh_obj.data.vertices]


def bottom_mass_x(mesh_obj, mode: str, ch: str) -> float:
    """
    Pick drip column X from actual underside mass (histogram of bottom verts).
    AABB fractions miss stems on t/p/r and leave floating bulbs.
    """
    verts = _world_verts(mesh_obj)
    if not verts:
        return 0.0
    xs = [v.x for v in verts]
    zs = [v.z for v in verts]
    min_x, max_x = min(xs), max(xs)
    min_z, max_z = min(zs), max(zs)
    span_x = max(max_x - min_x, 1e-4)
    span_z = max(max_z - min_z, 1e-4)
    band = min_z + span_z * (0.28 if ch == "." else 0.20)
    bottom = [v for v in verts if v.z <= band]
    if len(bottom) < 8:
        bottom = sorted(verts, key=lambda v: v.z)[: max(24, len(verts) // 5)]

    if mode == "left":
        # k / p: left stem only
        x_hi = min_x + span_x * (0.48 if ch == "k" else 0.42)
        pool = [v for v in bottom if v.x <= x_hi]
    elif mode == "right":
        x_lo = max_x - span_x * 0.42
        pool = [v for v in bottom if v.x >= x_lo]
    else:
        # center: middle 55% (t / r / o / .)
        lo = min_x + span_x * 0.22
        hi = max_x - span_x * 0.22
        pool = [v for v in bottom if lo <= v.x <= hi]
        if ch == "t":
            # Prefer stem under crossbar — densest mid third
            lo2 = min_x + span_x * 0.32
            hi2 = max_x - span_x * 0.32
            mid = [v for v in bottom if lo2 <= v.x <= hi2]
            if len(mid) >= 6:
                pool = mid

    if not pool:
        pool = bottom

    # Histogram: densest bin = solid lip under the stem/ring
    n_bins = 14 if ch != "." else 8
    best_i, best_n = 0, -1
    for i in range(n_bins):
        a = min_x + span_x * (i / n_bins)
        b = min_x + span_x * ((i + 1) / n_bins)
        n = sum(1 for v in pool if a <= v.x < b or (i == n_bins - 1 and v.x <= b))
        if n > best_n:
            best_n, best_i = n, i
    cx = min_x + span_x * ((best_i + 0.5) / n_bins)
    # Clamp to the mode window so we don't snap across the glyph
    if mode == "left":
        cx = min(cx, min_x + span_x * (0.48 if ch == "k" else 0.42))
        cx = max(cx, min_x + span_x * 0.08)
    elif mode == "right":
        cx = max(cx, max_x - span_x * 0.42)
        cx = min(cx, max_x - span_x * 0.08)
    else:
        cx = max(min_x + span_x * 0.18, min(cx, max_x - span_x * 0.18))
    return float(cx)


def sample_lip_at_column(mesh_obj, cx: float, probe_r: float) -> tuple[float, float, float]:
    """
    Sample true underside lip at drip column: (lip_z, cy, local_half_width).
    Uses bottom-band verts near cx so pear buries into solid, not empty AABB.
    """
    verts = _world_verts(mesh_obj)
    if not verts:
        return 0.0, 0.0, probe_r
    zs = [v.z for v in verts]
    ys = [v.y for v in verts]
    min_z, max_z = min(zs), max(zs)
    span_z = max(max_z - min_z, 1e-4)
    band = min_z + span_z * 0.22

    def near(r: float) -> list[Vector]:
        return [v for v in verts if abs(v.x - cx) <= r and v.z <= band]

    hit = near(probe_r)
    if len(hit) < 6:
        hit = near(probe_r * 1.85)
    if len(hit) < 4:
        # Fall back: lowest verts near column (ignore band)
        cand = [v for v in verts if abs(v.x - cx) <= probe_r * 2.4]
        hit = sorted(cand, key=lambda v: v.z)[: max(10, len(cand) // 6)]
    if not hit:
        return float(min_z), float(sum(ys) / len(ys)), float(probe_r)

    # Lip = low percentile (true underside), not AABB min of whole glyph
    hit_z = sorted(v.z for v in hit)
    lip_z = hit_z[max(0, int(len(hit_z) * 0.12))]
    cy = sum(v.y for v in hit) / len(hit)
    local_xs = [v.x for v in hit]
    local_w = max((max(local_xs) - min(local_xs)) * 0.5, probe_r * 0.65)
    return float(lip_z), float(cy), float(local_w)


def drip_columns(mesh_obj, ch: str, bb_min_x: float, bb_max_x: float) -> list[float]:
    mode = CONCEPT_DRIPS.get(ch)
    if mode is None:
        return []
    if mode == "dual":
        span = max(bb_max_x - bb_min_x, 1e-4)
        return [bb_min_x + span * 0.32, bb_max_x - span * 0.32]
    return [bottom_mass_x(mesh_obj, mode, ch)]


def make_pear_tip(name, cx, cy, lip_z, hang, neck_r, bulb_r, lip_r):
    """
    Honey teardrop hanging from letter *underside* (world -Z after layout_and_orient).

    Post-orient axes: X = width, Y = extrusion thickness, Z = letter height.
    Pendant axis is -Z (below baseline). Cross-section lies in XY at mid-thickness
    so the drip is not stuck on the front face (+Y / -Y).
    export_yup maps Blender Z → glTF Y, so hang becomes below in Three.
    """
    rings, segs = TIP_RINGS, TIP_SEGS
    # Deep bury into solid underside so SDF/boolean soft-unions continuous lip→neck
    bury = hang * 0.72
    lip_z_b = lip_z + bury
    mesh = bpy.data.meshes.new(name)
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    bm = bmesh.new()
    grid: list[list] = []
    for ri in range(rings + 1):
        u = ri / rings
        R = concept_pendant_radius(u, neck_r, bulb_r, lip_r)
        z = concept_pendant_hang(u, lip_z_b, hang + bury)
        row = []
        for s in range(segs):
            ang = (s / segs) * math.tau
            row.append(
                bm.verts.new(
                    (cx + math.cos(ang) * R, cy + math.sin(ang) * R * 0.96, z)
                )
            )
        grid.append(row)
    tip_z = concept_pendant_hang(1.0, lip_z_b, hang + bury)
    pole = bm.verts.new((cx, cy, tip_z - hang * 0.012))
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
    lip_c = bm.verts.new((cx, cy, lip_z_b + hang * 0.01))
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


def dig_funnel_at_lip(mesh_obj, cx: float, cy: float, lip_z: float, lip_r: float, hang: float) -> int:
    """Pull underside verts down into a concave funnel so union starts continuous."""
    bm = bmesh.new()
    bm.from_mesh(mesh_obj.data)
    bm.verts.ensure_lookup_table()
    mw = mesh_obj.matrix_world
    imw = mw.inverted()
    touched = 0
    sink = hang * 0.22
    for v in bm.verts:
        w = mw @ v.co
        dx, dy = w.x - cx, w.y - cy
        r = math.hypot(dx, dy)
        if r > lip_r * 1.35:
            continue
        if w.z > lip_z + hang * 0.18:
            continue
        # Weight: center of column, near underside
        wr = _clamp01(1.0 - r / max(lip_r, 1e-4))
        wz = _clamp01(1.0 - abs(w.z - lip_z) / max(hang * 0.25, 1e-4))
        wgt = (wr ** 1.1) * (wz ** 0.85)
        if wgt < 0.05:
            continue
        nw = Vector((w.x, w.y, w.z - sink * wgt))
        v.co = imw @ nw
        touched += 1
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(mesh_obj.data)
    bm.free()
    mesh_obj.data.update()
    return touched


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
    """
    Soft-union honey pendants onto letter *bottom lips* (min Z), not front face.

    After layout_and_orient (+90° X): height→Z, thickness→Y. Lip is sampled from
    bottom-mass verts at the drip column (not whole-glyph AABB), hang is -Z,
    column sits at mid-thickness of the sampled lip.
    """
    bpy.context.view_layer.update()
    bb = [mesh_obj.matrix_world @ Vector(c) for c in mesh_obj.bound_box]
    xs = [v.x for v in bb]
    ys = [v.y for v in bb]
    zs = [v.z for v in bb]
    min_x, max_x = min(xs), max(xs)
    min_y, max_y = min(ys), max(ys)
    min_z, max_z = min(zs), max(zs)
    span_z = max(max_z - min_z, 1e-4)
    span_x = max(max_x - min_x, 1e-4)
    closed = ch in "oOe0"
    cols = drip_columns(mesh_obj, ch, min_x, max_x)

    if not cols:
        return {
            "tips": 0,
            "softBoolean": False,
            "sdfUnion": False,
            "columns": [],
            "colW": span_x * 0.12,
            "lipY": float(min_z),
            "hang": 0.0,
            "neckR": 0.02,
            "bulbR": 0.03,
            "lipR": 0.035,
            "closedCounter": closed,
            "conceptDrip": CONCEPT_DRIPS.get(ch),
            "dripAxis": "negZ",
            "lipSampled": False,
        }

    spike = ch in "p.gyj"
    # Match k hang readability on all drip letters; closed o shorter
    hang = span_z * (0.52 if closed else 0.68 if spike else 0.62 if ch == "t" else 0.60)
    probe = max(span_x * 0.14, 0.04)

    # Sample real underside at each column (k quality for all)
    sampled = [sample_lip_at_column(mesh_obj, cx, probe) for cx in cols]
    lip_z = min(s[0] for s in sampled)
    cy = sum(s[1] for s in sampled) / len(sampled)
    local_w = max(s[2] for s in sampled)

    col_w = max(
        local_w * (0.95 if closed else 1.15),
        span_x * (0.10 if closed else 0.13 if spike else 0.15),
        NECK_FLOOR * 1.35,
    )
    neck_r = max(col_w * (0.62 if closed else 0.78), NECK_FLOOR)
    bulb_r = max(col_w * (1.05 if closed else 1.35), neck_r * 1.7)
    lip_r = max(col_w * (1.55 if closed else 1.95), neck_r * 1.35)
    lip_r = min(lip_r, span_x * (0.32 if closed else 0.48))
    lip_r = max(lip_r, neck_r * 1.28)

    if not closed:
        remesh(mesh_obj, REMESH_VOXEL * 1.05)
        # Re-sample after remesh (topology moved)
        sampled = [sample_lip_at_column(mesh_obj, cx, probe) for cx in cols]
        lip_z = min(s[0] for s in sampled)
        cy = sum(s[1] for s in sampled) / len(sampled)
        for cx in cols:
            dig_funnel_at_lip(mesh_obj, cx, cy, lip_z, lip_r, hang)

    tip_objs = []
    for ti, cx in enumerate(cols):
        tip_objs.append(
            make_pear_tip(
                f"{mesh_obj.name}_cdrip{ti}",
                cx,
                cy,
                lip_z,
                hang,
                neck_r,
                bulb_r,
                lip_r,
            )
        )

    united = 0
    used_sdf = False
    # Soft iso scaled to neck so thin letters don't dissolve the filament
    soft = min(SDF_SOFT, neck_r * 0.55)
    for tip in tip_objs:
        tip_mesh = tip.data
        # Prefer Exact boolean first for continuous join, then SDF soften via remesh
        # Closed counters: Exact/Float only — GN soft iso plugs the aperture
        ok = False
        if closed:
            ok = boolean_union(mesh_obj, tip)
        else:
            if gn_sdf_union(mesh_obj, tip, REMESH_VOXEL * 0.92, soft):
                ok = True
                used_sdf = True
            elif boolean_union(mesh_obj, tip):
                ok = True
        if ok:
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
            sm.factor = 0.32
            sm.iterations = 5
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
        f"axis=-Z lipZ={lip_z:.3f} hang={hang:.3f} neck={neck_r:.3f} bulb={bulb_r:.3f} "
        f"cols={[round(c, 3) for c in cols]} verts={len(mesh_obj.data.vertices)}"
    )
    return {
        "tips": united,
        "softBoolean": united > 0,
        "sdfUnion": used_sdf,
        "columns": [float(c) for c in cols],
        "colW": float(col_w),
        "lipY": float(lip_z),
        "hang": float(hang),
        "neckR": float(neck_r),
        "bulbR": float(bulb_r),
        "lipR": float(lip_r),
        "closedCounter": closed,
        "conceptDrip": CONCEPT_DRIPS.get(ch),
        "dripAxis": "negZ",
        "lipSampled": True,
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


def bake_one_font(font_entry: dict) -> dict:
    font_path = Path(font_entry["path"])
    if not font_path.exists():
        raise FileNotFoundError(font_path)

    clear_scene()
    font = bpy.data.fonts.load(str(font_path))
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
        if not meta.get("softBoolean") and not meta.get("closedCounter"):
            remesh(m, REMESH_VOXEL * 1.35)
            meta["remeshed"] = True
        meta["index"] = i
        meta["char"] = ch
        meta["meshName"] = m.name
        tip_meta.append(meta)

    mat = make_chrome_glass_material(f"ConceptChrome_{font_entry['id']}")
    assign_materials(mesh_objs, mat)

    fid = font_entry["id"]
    out_name = "wordmark-klaut-pro.glb" if font_entry.get("primary") else f"wordmark-klaut-pro-{fid}.glb"
    glb = export_glb(out_name)
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
                "lipSampled": bool(tm.get("lipSampled")),
            }
        )

    return {
        "id": fid,
        "label": font_entry["label"],
        "fontPath": str(font_path).replace("\\", "/"),
        "brand": bool(font_entry.get("brand")),
        "text": TEXT,
        "mesh": out_name,
        "primary": bool(font_entry.get("primary")),
        "conceptBake": True,
        "softBooleanTips": True,
        "letters": letters,
        "bakedDimensions": dims,
        "vertexCount": sum(len(m.data.vertices) for m in mesh_objs),
        "bytes": glb.stat().st_size,
    }


def resolve_fonts_to_bake(argv: list[str]) -> list[dict]:
    available = [f for f in FONT_CATALOG if Path(f["path"]).exists()]
    if not available:
        raise SystemExit("No fonts found — vendor IBM Plex into demo/scratch/fonts/")

    font_arg = None
    all_flag = False
    for a in argv:
        if a in ("--all", "--fonts=all"):
            all_flag = True
        elif a.startswith("--font="):
            font_arg = a.split("=", 1)[1].strip()
        elif a.startswith("--font-id="):
            font_arg = a.split("=", 1)[1].strip()

    if all_flag or font_arg is None:
        # Default: bake every available catalog face (brand + Arial Black)
        return available

    match = next(
        (
            f
            for f in available
            if f["id"] == font_arg or f["label"].lower() == font_arg.lower()
        ),
        None,
    )
    if not match:
        raise SystemExit(
            f"Unknown font '{font_arg}'. Available: {[f['id'] for f in available]}"
        )
    return [match]


def main() -> None:
    argv = _argv_after_double_dash()
    to_bake = resolve_fonts_to_bake(argv)
    # Ensure one primary among selected
    if not any(f.get("primary") for f in to_bake):
        to_bake[0] = {**to_bake[0], "primary": True}

    entries = []
    for fe in to_bake:
        print(f"=== baking {fe['id']} ({fe['label']}) ===")
        entries.append(bake_one_font(fe))

    primary = next((e for e in entries if e.get("primary")), entries[0])
    # If primary mesh isn't wordmark-klaut-pro.glb, copy naming via re-export already handled

    catalog = {
        "text": TEXT,
        "defaultId": primary["id"],
        "conceptBake": True,
        "blenderMcp": False,
        "brandFonts": [e["id"] for e in entries if e.get("brand")],
        "fonts": [
            {
                "id": e["id"],
                "label": e["label"],
                "mesh": e["mesh"],
                "fontPath": e["fontPath"],
                "brand": bool(e.get("brand")),
                "primary": bool(e.get("primary")),
                "conceptBake": True,
                "softBooleanTips": True,
                "letters": e["letters"],
            }
            for e in entries
        ],
    }
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    (OUT_DIR / "fonts.json").write_text(json.dumps(catalog, indent=2) + "\n", encoding="utf-8")

    manifest = {
        "font": primary["label"],
        "fontPath": primary["fontPath"],
        "fontId": primary["id"],
        "brand": bool(primary.get("brand")),
        "text": TEXT,
        "mesh": primary["mesh"],
        "conceptBake": True,
        "blenderMcp": False,
        "blenderMcpNote": "No Blender MCP server in Cursor; bake via portable Blender 4.2 bpy.",
        "softBooleanTips": True,
        "gnSdfUnion": USE_GN_SDF,
        "targetHeight": TARGET_HEIGHT,
        "bakedDimensions": primary["bakedDimensions"],
        "vertexCount": primary["vertexCount"],
        "bytes": primary["bytes"],
        "letters": primary["letters"],
        "perLetterMeshes": True,
        "fontsCatalog": "fonts.json",
        "conceptRefs": [
            "klaut.pro/concept_art/1c6PD.jpg",
            "klaut.pro/concept_art/EL2Hz.jpg",
        ],
        "pipeline": [
            "0-mcp: Blender MCP unavailable — use portable bpy bake",
            f"1-font: {primary['label']} klaut.pro (per-glyph meshes, plump bevel)",
            "2-concept-drip: honey teardrops from letter bottoms (-Z / export Y) on k/t/./p/r/o",
            "2a-lip: bottom-mass column + lip sample (not AABB) so every drip letter matches k",
            "2b-union: GN SDF soft-union underside→neck→bulb (neck floor vs remesh) + funnel dig",
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
                "wrote": [e["mesh"] for e in entries],
                "bytes": {e["id"]: e["bytes"] for e in entries},
                "verts": {e["id"]: e["vertexCount"] for e in entries},
                "defaultId": primary["id"],
                "brandFonts": catalog["brandFonts"],
                "conceptBake": True,
                "blenderMcp": False,
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
