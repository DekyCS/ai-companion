# Builds Khina the hedgehog in Blender, renders previews, and exports a .glb for the browser.
# Run: /Applications/Blender.app/Contents/MacOS/Blender --background --python art/khina.py
# Outputs: art/khina.blend (editable), art/export/khina.glb, art/previews/khina-*.png
#
# The look is a needle-felted toy: a big dome of long banded spines, a white fluffy face with a
# pointed tan snout, big glossy brown eyes in dark rims, brown felt ears and feet.
# The browser grows short felt fuzz (shell layers) on every material whose name starts with
# "Fur"; the vertex colour's alpha says how long the fuzz is there (0 next to the eyes and mouth).
#
# Khina faces -Y (Blender's front view) and is about 1.1 long and 0.8 tall with spines.
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
from mathutils.bvhtree import BVHTree

HERE = os.path.dirname(os.path.abspath(__file__))
RNG = random.Random(7)

# ---------- palette (sRGB hex), from the felt reference ----------
CREAM = "ede2cf"  # face, cheeks, belly
CREAM_SHADE = "dccdb6"
MUZZLE = "a77a57"  # the snout darkens toward the nose
MUZZLE_DARK = "74503b"
RIM = "4b3325"  # felt ring around the eyes
SKIN = "4a3527"  # under the spines
SPINE_ROOT = "2c1e15"
SPINE_BAND = "4a3324"
SPINE_LIGHT = "cdb898"
SPINE_TIP_DARK = "553a28"
EAR = "7e5d48"
EAR_INNER = "5f4334"
NOSE = "3b2720"
FEET = "7f604c"
IRIS = "6b3f24"
IRIS_EDGE = "2c1a11"
PUPIL = "0d0807"
SCLERA = "efe6da"
MOUTH = "3a2a21"

# ---------- shape ----------
BODY_C = Vector((0.0, 0.10, 0.37))
BODY_R = Vector((0.40, 0.46, 0.35))
HEAD_C = Vector((0.0, -0.27, 0.36))
HEAD_R = Vector((0.265, 0.25, 0.245))
NECK = Vector((0.0, -0.12, 0.38))
SNOUT_C = Vector((0.0, -0.53, 0.30))
SNOUT_R = Vector((0.112, 0.17, 0.102))
EYE_R = 0.067


def srgb(hex_, a=1.0):
    """Hex sRGB to linear RGBA, as Blender stores colours."""
    out = []
    for i in (0, 2, 4):
        c = int(hex_[i : i + 2], 16) / 255
        out.append(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4)
    return (*out, a)


def mix(a, b, t):
    t = min(1.0, max(0.0, t))
    return tuple(a[i] * (1 - t) + b[i] * t for i in range(4))


def smooth(e0, e1, x):
    t = min(1.0, max(0.0, (x - e0) / (e1 - e0)))
    return t * t * (3 - 2 * t)


def with_alpha(c, a):
    return (c[0], c[1], c[2], a)


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    return bpy.context.scene


def material(name, base, rough=0.7, vertex_colors=False, sheen=0.0, emission=0.0, coat=0.0):
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
    if coat and "Coat Weight" in bsdf.inputs:
        bsdf.inputs["Coat Weight"].default_value = coat
        bsdf.inputs["Coat Roughness"].default_value = 0.03
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


def obj_from_bmesh(name, bm, mat, parent=None, smooth_shade=True):
    """Shapes are built in world coordinates; the mesh is stored relative to its pivot."""
    if parent is not None:
        bmesh.ops.translate(bm, vec=-world_of(parent), verts=bm.verts)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    if smooth_shade:
        for p in me.polygons:
            p.use_smooth = True
    me.materials.append(mat)
    ob = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(ob)
    if parent is not None:
        ob.parent = parent
    return ob


def sphere_bm(segments=48, rings=32):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=segments, v_segments=rings, radius=1.0)
    return bm


def ellipsoid(name, center, radii, mat, parent=None, segments=40, rings=24, rotate=None):
    bm = sphere_bm(segments, rings)
    m = Matrix.Diagonal((*radii, 1.0))
    if rotate is not None:
        m = rotate @ m
    bmesh.ops.transform(bm, matrix=Matrix.Translation(Vector(center)) @ m, verts=bm.verts)
    return obj_from_bmesh(name, bm, mat, parent)


def paint(ob, color_of):
    """Per-vertex colour (RGBA, alpha = fuzz length) from a function of world position and normal."""
    base = world_of(ob)
    attr = ob.data.color_attributes.new("Col", "FLOAT_COLOR", "POINT")
    for i, v in enumerate(ob.data.vertices):
        attr.data[i].color = color_of(base + v.co, v.normal)
    ob.data.color_attributes.active_color = attr
    # glTF drops colour alpha, so the fuzz length also rides in the first UV channel's U.
    uv = ob.data.uv_layers.new(name="Fuzz")
    for loop in ob.data.loops:
        uv.data[loop.index].uv = (attr.data[loop.vertex_index].color[3], 0.0)
    return attr


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
    """Rotation that turns local +Z toward `direction`."""
    return Vector(direction).normalized().to_track_quat("Z", "Y").to_matrix().to_4x4()


def on_ellipsoid(center, radii, direction):
    d = Vector(direction).normalized()
    t = 1.0 / math.sqrt((d.x / radii.x) ** 2 + (d.y / radii.y) ** 2 + (d.z / radii.z) ** 2)
    return center + d * t


# ---------- where things are ----------
def eye_center(sx):
    d = Vector((0.56 * sx, -0.80, 0.17))
    return on_ellipsoid(HEAD_C, HEAD_R, d) - d.normalized() * 0.026, d.normalized()


EYES = [eye_center(1), eye_center(-1)]


def body_q(p):
    return Vector(((p.x - BODY_C.x) / BODY_R.x, (p.y - BODY_C.y) / BODY_R.y, (p.z - BODY_C.z) / BODY_R.z))


def body_spiny(p):
    """How far into the spiny mantle a body point is (>0 inside). The edge runs from high at the
    front down to low at the back, like the felt toy's skirt."""
    q = body_q(p)
    edge = -0.02 - 0.42 * (q.y + 1) / 2
    return q.z - edge


def head_spiny(p):
    d = (p - HEAD_C).normalized()
    return d.z * 0.95 + d.y * 0.8 - 0.3


# ---------- spines ----------
def fibonacci(n):
    golden = math.pi * (3 - math.sqrt(5))
    for i in range(n):
        z = 1 - 2 * (i + 0.5) / n
        r = math.sqrt(1 - z * z)
        a = i * golden
        yield Vector((math.cos(a) * r, math.sin(a) * r, z))


def add_spine(bm, cols, base, normal, sweep, length, radius, tilt_deg, palette, sides=4):
    t = sweep - normal * sweep.dot(normal)
    t = t.normalized() if t.length > 1e-4 else normal.orthogonal().normalized()
    side = normal.cross(t)
    jitter = math.radians(RNG.uniform(-20, 20))
    t = (t * math.cos(jitter) + side * math.sin(jitter)).normalized()
    tilt = math.radians(tilt_deg)
    d = (normal * math.cos(tilt) + t * math.sin(tilt)).normalized()
    u = d.orthogonal().normalized()
    v = d.cross(u)
    b = base - normal * 0.02
    rings = []
    roll = RNG.uniform(0, math.pi)
    # The spine bends a little toward the body as it goes, like real quills lying in a coat.
    for at, r_scale, c in ((0.0, 1.0, palette[0]), (0.42, 0.85, palette[1]), (0.78, 0.55, palette[2])):
        ring = []
        sag = -normal * (length * 0.06 * at * at)
        for k in range(sides):
            a = roll + 2 * math.pi * k / sides
            ring.append(bm.verts.new(b + d * (length * at) + sag + (u * math.cos(a) + v * math.sin(a)) * radius * r_scale))
            cols.append(c)
        rings.append(ring)
    tip = bm.verts.new(b + d * length - normal * (length * 0.06))
    cols.append(palette[3])
    for lo, hi in zip(rings, rings[1:]):
        for k in range(sides):
            k2 = (k + 1) % sides
            bm.faces.new((lo[k], lo[k2], hi[k2], hi[k]))
    hi = rings[-1]
    for k in range(sides):
        bm.faces.new((hi[k], hi[(k + 1) % sides], tip))


def spine_palette():
    root, band, light, tip_dark = srgb(SPINE_ROOT), srgb(SPINE_BAND), srgb(SPINE_LIGHT), srgb(SPINE_TIP_DARK)
    r = RNG.random()
    if r < 0.1:  # a pale quill
        light2 = mix(light, srgb("efe4d0"), RNG.uniform(0, 1))
        return (mix(root, band, 0.6), mix(band, light, 0.5), light2, light2)
    band2 = mix(root, band, RNG.uniform(0.3, 1.0))
    if RNG.random() < 0.45:  # dark all the way
        return (root, band2, mix(band2, light, RNG.uniform(0.0, 0.25)), mix(tip_dark, band2, RNG.uniform(0, 1)))
    light2 = mix(light, band, RNG.uniform(0.0, 0.3))
    tip = light2 if RNG.random() < 0.6 else mix(tip_dark, light, RNG.uniform(0, 0.3))
    return (root, band2, light2, tip)


def spines(name, mat, parent, points):
    bm = bmesh.new()
    cols = []
    for p, n, sweep, length, tilt in points:
        add_spine(bm, cols, p, n, sweep, length, RNG.uniform(0.0105, 0.0135) * (0.8 + 0.4 * length / 0.2), tilt, spine_palette())
    ob = obj_from_bmesh(name, bm, mat, parent)
    attr = ob.data.color_attributes.new("Col", "FLOAT_COLOR", "POINT")
    for i, c in enumerate(cols):
        attr.data[i].color = c
    ob.data.color_attributes.active_color = attr
    return ob


# ---------- build ----------
def build():
    fur = material("Fur", CREAM, rough=0.95, vertex_colors=True, sheen=0.6)
    ear_m = material("Fur.Ear", EAR, rough=0.95, vertex_colors=True, sheen=0.5)
    nose_m = material("Fur.Nose", NOSE, rough=0.7, sheen=0.3)
    feet_m = material("Fur.Feet", FEET, rough=0.95, sheen=0.4)
    spine_m = material("Spines", SPINE_BAND, rough=0.5, vertex_colors=True)
    eye_m = material("Eye", PUPIL, rough=0.04, vertex_colors=True, coat=1.0)
    shine_m = material("Shine", "ffffff", rough=0.2, emission=2.0)
    mouth_m = material("Mouth", MOUTH, rough=0.8)

    root = empty("Khina", (0, 0, 0))
    body_pivot = empty("BodyPivot", BODY_C, root)
    head_pivot = empty("HeadPivot", NECK, body_pivot)

    cream, shade, skin = srgb(CREAM), srgb(CREAM_SHADE), srgb(SKIN)

    # Body: a soft loaf, a little flatter underneath.
    bm = sphere_bm(56, 36)
    for v in bm.verts:
        x, y, z = v.co
        if z < 0:
            z *= 0.82
        v.co = BODY_C + Vector((x * BODY_R.x, y * BODY_R.y, z * BODY_R.z))
    body = obj_from_bmesh("Body", bm, fur, body_pivot)

    def body_color(p, n):
        s = body_spiny(p)
        if s > 0.02:
            return with_alpha(skin, 0.45)
        belly = mix(cream, shade, smooth(0.0, -0.6, body_q(p).z) * 0.6)
        return with_alpha(mix(belly, skin, smooth(-0.12, 0.02, s)), 1.0)

    paint(body, body_color)

    # Head: round, a bit wider at the cheeks.
    bm = sphere_bm(64, 40)
    for v in bm.verts:
        x, y, z = v.co
        cheek = 1 + 0.12 * smooth(0.4, -0.5, z) * smooth(0.2, -0.6, y)
        v.co = HEAD_C + Vector((x * HEAD_R.x * cheek, y * HEAD_R.y, z * HEAD_R.z))
    head = obj_from_bmesh("Head", bm, fur, head_pivot)

    def head_color(p, n):
        s = head_spiny(p)
        c = cream
        d = (p - HEAD_C).normalized()
        # Toward the snout the felt turns tan.
        c = mix(c, srgb(MUZZLE), smooth(-0.55, -0.95, d.y) * smooth(0.45, 0.0, d.z) * 0.55)
        fuzz = 1.0
        for e, ed in EYES:
            dist = (p - e).length
            c = mix(c, srgb(RIM), smooth(EYE_R + 0.05, EYE_R + 0.012, dist))
            fuzz = min(fuzz, smooth(EYE_R + 0.004, EYE_R + 0.04, dist))
        if s > 0.0:
            c = mix(c, skin, smooth(0.0, 0.08, s))
            fuzz = min(fuzz, 0.5)
        return with_alpha(c, fuzz)

    paint(head, head_color)

    # Snout: tapers to a slightly upturned point.
    bm = sphere_bm(48, 32)
    for v in bm.verts:
        x, y, z = v.co
        f = min(1.0, max(0.0, (y + 1) / 2))  # 0 at the tip, 1 at the base
        taper = 0.4 + 0.6 * f**0.55
        v.co = SNOUT_C + Vector((x * SNOUT_R.x * taper, y * SNOUT_R.y, z * SNOUT_R.z * taper + 0.04 * (1 - f) ** 2))
    snout_tree = BVHTree.FromBMesh(bm)
    tip = SNOUT_C + Vector((0, -SNOUT_R.y, 0.04))

    # A small smile along each side of the snout, laid onto its surface.
    mouth_pts = []
    for sx in (1, -1):
        side = []
        for k in range(9):
            t = k / 8
            target = Vector((sx * 0.072 * t, -0.672 + 0.115 * t, 0.272 - 0.012 * t + 0.03 * t**3))
            axis = Vector((0, target.y, SNOUT_C.z + 0.01))
            hit = snout_tree.ray_cast(axis, (target - axis).normalized(), 1.0)
            if hit[0] is not None:
                side.append(hit[0] + hit[1].normalized() * 0.003)
        mouth_pts.append(side)
    snout = obj_from_bmesh("Snout", bm, fur, head_pivot)

    def snout_color(p, n):
        f = smooth(SNOUT_C.y + SNOUT_R.y, SNOUT_C.y - SNOUT_R.y, p.y)  # 0 at the base, 1 at the tip
        c = mix(mix(cream, srgb(MUZZLE), f * 1.5), srgb(MUZZLE_DARK), smooth(0.65, 1.0, f) * 0.8)
        fuzz = 0.75 - 0.4 * f
        for side in mouth_pts:
            for q in side:
                fuzz = min(fuzz, smooth(0.008, 0.03, (p - q).length) * fuzz)
        return with_alpha(c, fuzz)

    paint(snout, snout_color)
    ellipsoid("Nose", tip + Vector((0, 0.008, 0.002)), (0.046, 0.04, 0.04), nose_m, head_pivot, segments=28, rings=18)

    for side in mouth_pts:
        if len(side) < 3:
            continue
        bm = bmesh.new()
        prev = None
        for i, q in enumerate(side):
            a = side[min(i + 1, len(side) - 1)] - side[max(i - 1, 0)]
            r = 0.0055 * (1 - 0.5 * (i / (len(side) - 1)))
            res = bmesh.ops.create_circle(bm, cap_ends=False, segments=6, radius=r, matrix=Matrix.Translation(q) @ facing(a))
            ring = res["verts"]
            if prev is not None:
                for k in range(6):
                    bm.faces.new((prev[k], prev[(k + 1) % 6], ring[(k + 1) % 6], ring[k]))
            prev = ring
        obj_from_bmesh("Mouth", bm, mouth_m, head_pivot)

    # Eyes: big glossy brown eyes with a lighter iris ring, a white lower rim and catch-lights.
    pupil, iris, iris_edge, sclera = srgb(PUPIL), srgb(IRIS), srgb(IRIS_EDGE), srgb(SCLERA)
    for (c, d), side, sx in zip(EYES, ("L", "R"), (1, -1)):
        look = (d + Vector((-0.18 * sx, -0.25, 0.05))).normalized()  # looking a touch forward
        eye = ellipsoid(f"Eye.{side}", c, (EYE_R, EYE_R, EYE_R * 1.04), eye_m, head_pivot, segments=96, rings=64)

        def eye_color(p, n, c=c, look=look):
            q = (p - c).normalized()
            a = math.degrees(q.angle(look))
            if a < 15:
                return pupil
            if a < 34:
                return mix(mix(srgb("9a6238"), iris, smooth(15, 24, a)), iris_edge, smooth(26, 34, a))
            if 34 <= a < 43 and q.z < -0.35:
                return mix(sclera, iris_edge, smooth(39, 43, a) + smooth(-0.5, -0.35, q.z))
            return iris_edge

        paint(eye, eye_color)
        up = Vector((0, 0, 1))
        ellipsoid(f"Shine.{side}", c + look * (EYE_R - 0.004) + up * 0.022 + Vector((0.012 * sx, 0, 0)), (0.014, 0.014, 0.014), shine_m, head_pivot, segments=12, rings=8)
        ellipsoid(f"Shine2.{side}", c + look * (EYE_R - 0.003) - up * 0.018 - Vector((0.014 * sx, 0, 0)), (0.006, 0.006, 0.006), shine_m, head_pivot, segments=10, rings=6)

        # Ears: round felt cups at the edge of the spines, open toward the front.
        de = Vector((0.78 * sx, -0.02, 0.62))
        ec = on_ellipsoid(HEAD_C, HEAD_R, de) + de.normalized() * 0.01
        face = Vector((0.55 * sx, -1.0, 0.25)).normalized()
        bm = sphere_bm(32, 20)
        for v in bm.verts:
            x, y, z = v.co
            # A cup: the front face is pushed in.
            if z > 0:
                z -= 0.55 * z * (1 - (x * x + y * y))
            v.co = Vector((x * 0.088, y * 0.094, z * 0.034))
        bmesh.ops.transform(bm, matrix=Matrix.Translation(ec) @ facing(face), verts=bm.verts)
        ear = obj_from_bmesh(f"Ear.{side}", bm, ear_m, head_pivot)
        paint(ear, lambda p, n, face=face, ec=ec: with_alpha(mix(srgb(EAR), srgb(EAR_INNER), smooth(0.2, 0.7, n.dot(face)) * smooth(0.09, 0.03, (p - ec).length)), 0.6))

    # Spines on the body: dense, long, swept back and down.
    pts = []
    for s in fibonacci(12000):
        p = BODY_C + Vector((s.x * BODY_R.x, s.y * BODY_R.y, s.z * BODY_R.z))
        sp = body_spiny(p)
        if sp < 0:
            continue
        if ((p - HEAD_C).x / HEAD_R.x) ** 2 + ((p - HEAD_C).y / HEAD_R.y) ** 2 + ((p - HEAD_C).z / HEAD_R.z) ** 2 < 1.15:
            continue
        n = Vector((s.x / BODY_R.x, s.y / BODY_R.y, s.z / BODY_R.z)).normalized()
        edge = smooth(0.0, 0.35, sp)  # shorter and more splayed at the skirt
        length = RNG.uniform(0.17, 0.235) * (0.6 + 0.4 * edge)
        tilt = RNG.uniform(58, 74) - 8 * (1 - edge)
        pts.append((p, n, Vector((0, 1, -0.35)), length, tilt))
    spines("BodySpines", spine_m, body_pivot, pts)

    # And on the crown of the head, ending in a fringe above the eyes and between the ears.
    pts = []
    for s in fibonacci(4200):
        p = HEAD_C + Vector((s.x * HEAD_R.x, s.y * HEAD_R.y, s.z * HEAD_R.z))
        sp = head_spiny(p)
        if sp < 0:
            continue
        if any(((p - (on_ellipsoid(HEAD_C, HEAD_R, Vector((0.78 * sx, -0.02, 0.62))))).length < 0.075) for sx in (1, -1)):
            continue
        n = Vector((s.x / HEAD_R.x, s.y / HEAD_R.y, s.z / HEAD_R.z)).normalized()
        edge = smooth(0.0, 0.3, sp)
        length = RNG.uniform(0.11, 0.16) * (0.65 + 0.35 * edge)
        pts.append((p, n, Vector((0, 1, 0.25)), length, RNG.uniform(60, 74)))
    spines("HeadSpines", spine_m, head_pivot, pts)

    # Feet: little brown paws peeking out, with three toe bumps each.
    for name, x, y in (("Foot.FL", 0.15, -0.28), ("Foot.FR", -0.15, -0.28), ("Foot.BL", 0.2, 0.34), ("Foot.BR", -0.2, 0.34)):
        bm = sphere_bm(24, 14)
        bmesh.ops.transform(bm, matrix=Matrix.Translation((x, y, 0.045)) @ Matrix.Diagonal((0.065, 0.085, 0.048, 1)), verts=bm.verts)
        for k in (-1, 0, 1):
            toe = Matrix.Translation((x + k * 0.032, y - 0.075 + abs(k) * 0.012, 0.022)) @ Matrix.Diagonal((0.019, 0.022, 0.018, 1))
            bmesh.ops.create_uvsphere(bm, u_segments=12, v_segments=8, radius=1.0, matrix=toe)
        obj_from_bmesh(name, bm, feet_m, root)

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
    for vt in ("AgX", "Filmic", "Standard"):
        try:
            scene.view_settings.view_transform = vt
            break
        except TypeError:
            continue
    world = bpy.data.worlds.new("World")
    scene.world = world
    try:
        world.use_nodes = True
    except Exception:
        pass
    bg = world.node_tree.nodes.get("Background")
    bg.inputs["Color"].default_value = srgb("efe6d8")
    bg.inputs["Strength"].default_value = 1.0

    sun = bpy.data.objects.new("Sun", bpy.data.lights.new("Sun", "SUN"))
    sun.data.energy = 3.0
    sun.data.angle = math.radians(8)
    sun.rotation_euler = (math.radians(50), math.radians(10), math.radians(-35))
    scene.collection.objects.link(sun)
    fill = bpy.data.objects.new("Fill", bpy.data.lights.new("Fill", "AREA"))
    fill.data.energy = 140
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
    g.data.materials.append(material("GroundM", "e9e1d3", rough=1.0))
    scene.collection.objects.link(g)

    cam = bpy.data.objects.new("Cam", bpy.data.cameras.new("Cam"))
    cam.data.lens = 70
    scene.collection.objects.link(cam)
    scene.camera = cam
    out = os.path.join(HERE, "previews")
    os.makedirs(out, exist_ok=True)
    views = {
        "34": ((-2.3, -3.2, 1.25), (0, -0.08, 0.38)),
        "front": ((0, -4.0, 0.8), (0, -0.1, 0.38)),
        "side": ((4.0, -0.2, 0.7), (0, 0, 0.38)),
        "back": ((-2.4, 3.6, 1.8), (0, 0, 0.38)),
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
    tris = sum(len(p.vertices) - 2 for ob in bpy.data.objects if ob.type == "MESH" for p in ob.data.polygons)
    print("KHINA-DONE", scene.render.engine, "triangles", tris)


main()
