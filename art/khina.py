# Builds Khina the hedgehog in Blender, renders previews, and exports a .glb for the browser.
# Run: /Applications/Blender.app/Contents/MacOS/Blender --background --python art/khina.py
# Outputs: art/khina.blend (editable), art/export/khina.glb, art/previews/khina-*.png
#
# Khina faces -Y (Blender's front view) and is about 1.4 long and 0.9 tall.
# Rigid parts on pivots, so the browser can animate without a skeleton:
#   Khina (root, on the ground) > BodyPivot (body centre: rolls for curling, bobs for breathing)
#   BodyPivot > HeadPivot (the neck: nods, sniffs, tucks in)
#   Khina > Foot.FL / Foot.FR / Foot.BL / Foot.BR (each steps on its own for the waddle)

import math
import os
import random

import bmesh
import bpy
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
RNG = random.Random(7)

# ---------- palette (sRGB hex), taken from the reference photos ----------
SPINE_DARK = "3e2a1d"
SPINE_MID = "5b3e2a"
SPINE_TIP = "efe0c2"
COAT = "4a3426"  # skin between the spines
FACE = "dcbf97"
BELLY = "c9a982"
MASK = "8a6646"  # the soft darker band around the eyes
NOSE = "231915"
EYE = "18110e"
BLUSH = "eea097"
FEET = "dfa999"
EAR_INNER = "e3a196"

# ---------- shape ----------
BODY_C = Vector((0.0, 0.12, 0.46))
BODY_R = Vector((0.46, 0.56, 0.40))
HEAD_C = Vector((0.0, -0.35, 0.49))
HEAD_R = 0.33
NECK = Vector((0.0, -0.16, 0.46))


def srgb(hex_):
    """Hex sRGB to linear RGBA, as Blender stores colours."""
    out = []
    for i in (0, 2, 4):
        c = int(hex_[i : i + 2], 16) / 255
        out.append(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4)
    return (*out, 1.0)


def mix(a, b, t):
    return tuple(a[i] * (1 - t) + b[i] * t for i in range(4))


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    return bpy.context.scene


def material(name, base, rough=0.7, vertex_colors=False, sheen=0.0, emission=0.0):
    m = bpy.data.materials.new(name)
    try:
        m.use_nodes = True
    except Exception:
        pass
    nodes = m.node_tree.nodes
    bsdf = nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = srgb(base)
    bsdf.inputs["Roughness"].default_value = rough
    if "Sheen Weight" in bsdf.inputs:
        bsdf.inputs["Sheen Weight"].default_value = sheen
    if emission > 0:
        bsdf.inputs["Emission Color"].default_value = srgb(base)
        bsdf.inputs["Emission Strength"].default_value = emission
    if vertex_colors:
        attr = nodes.new("ShaderNodeVertexColor")
        attr.layer_name = "Col"
        m.node_tree.links.new(attr.outputs["Color"], bsdf.inputs["Base Color"])
    return m


def world_of(ob):
    """World position of an object's origin (pivots are only ever moved, never rotated, at build time)."""
    off = Vector((0, 0, 0))
    while ob is not None:
        off += ob.location
        ob = ob.parent
    return off


def obj_from_bmesh(name, bm, mat, parent=None, smooth=True):
    """Shapes are built in world coordinates; the mesh is stored relative to its pivot."""
    if parent is not None:
        bmesh.ops.translate(bm, vec=-world_of(parent), verts=bm.verts)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    if smooth:
        for p in me.polygons:
            p.use_smooth = True
    me.materials.append(mat)
    ob = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(ob)
    if parent is not None:
        ob.parent = parent
    return ob


def ellipsoid(name, center, radii, mat, parent=None, segments=40, rings=24, rotate=None):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=segments, v_segments=rings, radius=1.0)
    m = Matrix.Diagonal((*radii, 1.0))
    if rotate is not None:
        m = rotate @ m
    bmesh.ops.transform(bm, matrix=Matrix.Translation(Vector(center)) @ m, verts=bm.verts)
    return obj_from_bmesh(name, bm, mat, parent)


def paint(ob, color_of):
    """Per-vertex colour from a function of the vertex's world position."""
    base = world_of(ob)
    attr = ob.data.color_attributes.new("Col", "FLOAT_COLOR", "POINT")
    for i, v in enumerate(ob.data.vertices):
        attr.data[i].color = color_of(base + v.co)


def empty(name, world_location, parent=None):
    e = bpy.data.objects.new(name, None)
    e.empty_display_size = 0.1
    bpy.context.collection.objects.link(e)
    if parent is not None:
        e.parent = parent
        e.location = Vector(world_location) - world_of(parent)
    else:
        e.location = world_location
    return e


def facing(direction):
    """Rotation that turns local +Z toward `direction` (for flat discs like the cheeks)."""
    return Vector(direction).to_track_quat("Z", "Y").to_matrix().to_4x4()


# ---------- coat ----------
def body_q(p):
    return Vector(((p.x - BODY_C.x) / BODY_R.x, (p.y - BODY_C.y) / BODY_R.y, (p.z - BODY_C.z) / BODY_R.z))


def body_has_spines(p):
    q = body_q(p)
    return q.z > -0.38 - 0.1 * q.y


def head_has_spines(p):
    d = (p - HEAD_C).normalized()
    return d.z * 0.9 + d.y * 0.6 > 0.3


def fibonacci(n):
    golden = math.pi * (3 - math.sqrt(5))
    for i in range(n):
        z = 1 - 2 * (i + 0.5) / n
        r = math.sqrt(1 - z * z)
        a = i * golden
        yield Vector((math.cos(a) * r, math.sin(a) * r, z))


def add_spine(bm, cols, base, normal, length, radius, dark, tip_c, sides=6):
    # Spines lean back (toward +Y) along the surface, as on a real coat.
    back = Vector((0, 1, 0))
    t = back - normal * back.dot(normal)
    t = t.normalized() if t.length > 1e-4 else Vector((1, 0, 0))
    tilt = math.radians(RNG.uniform(56, 70))
    d = (normal * math.cos(tilt) + t * math.sin(tilt)).normalized()
    u = d.orthogonal().normalized()
    v = d.cross(u)
    b = base - normal * 0.015
    rings = []
    # Dark along most of the length, then a cream point: the banded look of the photos.
    for at, r_scale, c in ((0.0, 1.0, dark), (0.62, 0.55, dark)):
        ring = []
        for k in range(sides):
            a = 2 * math.pi * k / sides
            ring.append(bm.verts.new(b + d * (length * at) + (u * math.cos(a) + v * math.sin(a)) * radius * r_scale))
            cols.append(c)
        rings.append(ring)
    tip = bm.verts.new(b + d * length)
    cols.append(tip_c)
    lo, hi = rings
    for k in range(sides):
        k2 = (k + 1) % sides
        bm.faces.new((lo[k], lo[k2], hi[k2], hi[k]))
        bm.faces.new((hi[k], hi[k2], tip))


def spines(name, mat, parent, points):
    bm = bmesh.new()
    cols = []
    dark_c, mid_c, tip_c = srgb(SPINE_DARK), srgb(SPINE_MID), srgb(SPINE_TIP)
    for p, n, scale in points:
        # A few pale spines among the dark ones give the speckle.
        pale = RNG.random() < 0.18
        dark = mix(mid_c, tip_c, RNG.uniform(0.35, 0.6)) if pale else mix(dark_c, mid_c, RNG.uniform(0, 1))
        add_spine(
            bm, cols, p, n,
            length=RNG.uniform(0.12, 0.16) * scale,
            radius=RNG.uniform(0.021, 0.027) * scale,
            dark=dark,
            tip_c=mix(tip_c, mid_c, RNG.uniform(0, 0.2)),
        )
    ob = obj_from_bmesh(name, bm, mat, parent)
    attr = ob.data.color_attributes.new("Col", "FLOAT_COLOR", "POINT")
    for i, c in enumerate(cols):
        attr.data[i].color = c
    return ob


def build():
    fur = material("Fur", FACE, rough=0.85, vertex_colors=True, sheen=0.4)
    spine_m = material("Spines", SPINE_DARK, rough=0.55, vertex_colors=True)
    snout_m = material("Snout", FACE, rough=0.85, sheen=0.4)
    nose_m = material("Nose", NOSE, rough=0.15)
    eye_m = material("Eye", EYE, rough=0.06)
    shine_m = material("Shine", "ffffff", rough=0.2, emission=1.5)
    blush_m = material("Blush", BLUSH, rough=0.9)
    feet_m = material("Feet", FEET, rough=0.8)
    ear_in_m = material("EarInner", EAR_INNER, rough=0.9)

    root = empty("Khina", (0, 0, 0))
    body_pivot = empty("BodyPivot", BODY_C, root)
    head_pivot = empty("HeadPivot", NECK, body_pivot)

    coat, belly, face, mask = srgb(COAT), srgb(BELLY), srgb(FACE), srgb(MASK)

    body = ellipsoid("Body", BODY_C, BODY_R, fur, body_pivot)
    paint(body, lambda p: coat if body_has_spines(p) else belly)

    head = ellipsoid("Head", HEAD_C, (HEAD_R, HEAD_R, HEAD_R * 0.94), fur, head_pivot)

    def head_color(p):
        if head_has_spines(p):
            return coat
        d = (p - HEAD_C).normalized()
        eyes = max(0.0, 1 - abs(d.z - 0.3) / 0.25) * max(0.0, 1 - abs(abs(d.x) - 0.42) / 0.32)
        chin = max(0.0, -d.z - 0.2)
        return mix(mix(face, mask, min(1.0, eyes * 1.0)), belly, min(1.0, chin * 1.5))

    paint(head, head_color)

    pts = []
    for s in fibonacci(3200):
        p = BODY_C + Vector((s.x * BODY_R.x, s.y * BODY_R.y, s.z * BODY_R.z))
        if not body_has_spines(p) or (p - HEAD_C).length < HEAD_R + 0.02:
            continue
        n = Vector((s.x / BODY_R.x, s.y / BODY_R.y, s.z / BODY_R.z)).normalized()
        pts.append((p, n, 1.0))
    spines("BodySpines", spine_m, body_pivot, pts)
    pts = []
    for s in fibonacci(1100):
        p = HEAD_C + s * HEAD_R
        if not head_has_spines(p) or body_q(p).length < 0.97:
            continue
        pts.append((p, s, 0.9))
    spines("HeadSpines", spine_m, head_pivot, pts)

    # Snout and nose.
    snout_c = HEAD_C + Vector((0, -0.28, -0.08))
    ellipsoid("Snout", snout_c, (0.13, 0.17, 0.11), snout_m, head_pivot, rotate=Matrix.Rotation(math.radians(-12), 4, "X"))
    ellipsoid("Nose", snout_c + Vector((0, -0.165, 0.03)), (0.058, 0.05, 0.048), nose_m, head_pivot)

    for side, sx in (("L", 1), ("R", -1)):
        # Big glossy eyes with a highlight.
        d = Vector((0.42 * sx, -0.84, 0.3)).normalized()
        c = HEAD_C + d * (HEAD_R - 0.035)
        ellipsoid(f"Eye.{side}", c, (0.066, 0.066, 0.076), eye_m, head_pivot, segments=24, rings=16)
        ellipsoid(f"Shine.{side}", c + d * 0.05 + Vector((-0.018 * sx, 0, 0.03)), (0.019, 0.019, 0.019), shine_m, head_pivot, segments=12, rings=8)
        # Blush: a flat disc lying on the cheek.
        dc = Vector((0.66 * sx, -0.68, -0.2)).normalized()
        ellipsoid(f"Cheek.{side}", HEAD_C + dc * (HEAD_R - 0.004), (0.058, 0.046, 0.012), blush_m, head_pivot, segments=20, rings=10, rotate=facing(dc))
        # Small round ears at the edge of the spines.
        de = Vector((0.66 * sx, -0.2, 0.68)).normalized()
        ec = HEAD_C + de * (HEAD_R - 0.01)
        rot = Matrix.Rotation(math.atan2(de.x, de.z), 4, "Y")
        ear = ellipsoid(f"Ear.{side}", ec, (0.07, 0.034, 0.078), fur, head_pivot, segments=20, rings=12, rotate=rot)
        paint(ear, lambda p: mask)
        ellipsoid(f"EarInner.{side}", ec + Vector((0, -0.024, 0)), (0.046, 0.014, 0.052), ear_in_m, head_pivot, segments=16, rings=10, rotate=rot)

    # Feet: little pink nubs peeking out under the body.
    for name, x, y in (("Foot.FL", 0.18, -0.22), ("Foot.FR", -0.18, -0.22), ("Foot.BL", 0.22, 0.4), ("Foot.BR", -0.22, 0.4)):
        ellipsoid(name, (x, y, 0.05), (0.07, 0.09, 0.055), feet_m, root, segments=20, rings=12)

    return root


# ---------- preview ----------
def look_at(cam, target):
    d = Vector(target) - cam.location
    cam.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()


def render_previews(scene):
    for engine in ("BLENDER_EEVEE", "BLENDER_EEVEE_NEXT", "CYCLES"):
        try:
            scene.render.engine = engine
            break
        except TypeError:
            continue
    scene.render.resolution_x = 900
    scene.render.resolution_y = 900
    scene.view_settings.view_transform = "Standard"
    world = bpy.data.worlds.new("World")
    scene.world = world
    try:
        world.use_nodes = True
    except Exception:
        pass
    bg = world.node_tree.nodes.get("Background")
    bg.inputs["Color"].default_value = srgb("dfe8d6")
    bg.inputs["Strength"].default_value = 0.9

    sun = bpy.data.objects.new("Sun", bpy.data.lights.new("Sun", "SUN"))
    sun.data.energy = 3.2
    sun.rotation_euler = (math.radians(50), math.radians(10), math.radians(-35))
    scene.collection.objects.link(sun)
    fill = bpy.data.objects.new("Fill", bpy.data.lights.new("Fill", "AREA"))
    fill.data.energy = 120
    fill.data.size = 3
    fill.location = (-2.5, -2.5, 1.5)
    look_at(fill, (0, 0, 0.4))
    scene.collection.objects.link(fill)

    ground = bpy.data.meshes.new("Ground")
    bm = bmesh.new()
    bmesh.ops.create_circle(bm, cap_ends=True, radius=4, segments=48)
    bm.to_mesh(ground)
    bm.free()
    g = bpy.data.objects.new("Ground", ground)
    g.data.materials.append(material("GroundM", "a9c48f", rough=1.0))
    scene.collection.objects.link(g)

    cam = bpy.data.objects.new("Cam", bpy.data.cameras.new("Cam"))
    cam.data.lens = 70
    scene.collection.objects.link(cam)
    scene.camera = cam
    out = os.path.join(HERE, "previews")
    os.makedirs(out, exist_ok=True)
    views = {
        "34": ((2.4, -3.4, 1.4), (0, -0.05, 0.42)),
        "front": ((0, -4.2, 0.9), (0, 0, 0.42)),
        "side": ((4.2, 0, 0.8), (0, 0, 0.42)),
        "back": ((-2.4, 3.6, 1.8), (0, 0, 0.42)),
    }
    for name, (loc, target) in views.items():
        cam.location = loc
        look_at(cam, target)
        scene.render.filepath = os.path.join(out, f"khina-{name}.png")
        bpy.ops.render.render(write_still=True)
    # Only Khina goes into the exported file.
    for ob in (sun, fill, g, cam):
        bpy.data.objects.remove(ob)


def main():
    scene = reset()
    build()
    os.makedirs(os.path.join(HERE, "export"), exist_ok=True)
    render_previews(scene)
    bpy.ops.export_scene.gltf(filepath=os.path.join(HERE, "export", "khina.glb"), export_format="GLB")
    bpy.context.preferences.filepaths.save_version = 0  # no .blend1 backups
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(HERE, "khina.blend"))
    print("KHINA-DONE", scene.render.engine)


main()
