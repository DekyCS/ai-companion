# Builds the visitor (the player's bunny) in Blender, renders previews, exports a .glb.
# Run: /Applications/Blender.app/Contents/MacOS/Blender --background --python art/visitor.py
# Outputs: art/visitor.blend (editable), art/export/visitor.glb, art/previews/visitor-*.png
#
# A small needle-felted bunny: oatmeal fur with soft light-brown patches, white muzzle and chest,
# big glossy brown eyes, pink nose, long ears. Faces -Y (three.js +Z), like Khina.
# About 0.71 to the top of the head, ears to about 1.05.
#
# Rigid parts on pivots, animated in the browser (web/player.ts):
#   Visitor (root, on the ground) > BodyPivot (body centre: bobs, squashes, leans)
#   BodyPivot > HeadPivot (neck) > Ear.L / Ear.R (ear roots: flop and spring)
#   BodyPivot > Tail
#   Visitor > Paw.FL / Paw.FR (front paws), Foot.BL / Foot.BR (big back feet)
# Materials whose name starts with "Fur" get felt fuzz (shell layers) in the browser.

import math
import os

import bmesh
import bpy
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))

# ---------- palette (sRGB hex) ----------
OAT = "eadbc3"  # main coat
PATCH = "c49b73"  # soft light-brown patches
PATCH_DARK = "a77e5a"  # ear tips
WHITE = "faf5ec"  # muzzle, chest, belly, tail
RIM = "b4906e"  # the soft darker ring around the eyes
BLUSH = "f0b2a6"
EAR_PINK = "eeb2aa"
NOSE = "e08a8c"
MOUTH = "6b4a3a"
PUPIL = "0d0806"
IRIS = "4b2a17"
EYE_DARK = "1c120d"

# ---------- shape ----------
BODY_C = Vector((0.0, 0.05, 0.235))
BODY_R = Vector((0.25, 0.26, 0.232))
NECK = Vector((0.0, -0.04, 0.4))
HEAD_C = Vector((0.0, -0.1, 0.5))
HEAD_R = Vector((0.228, 0.205, 0.198))
EAR_LEN = 0.36


def srgb(hex_):
    out = []
    for i in (0, 2, 4):
        c = int(hex_[i : i + 2], 16) / 255
        out.append(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4)
    return (*out, 1.0)


def mix(a, b, t):
    t = min(1.0, max(0.0, t))
    return tuple(a[i] * (1 - t) + b[i] * t for i in range(4))


def smooth(e0, e1, x):
    t = min(1.0, max(0.0, (x - e0) / (e1 - e0)))
    return t * t * (3 - 2 * t)


def noise(p):
    return (math.sin(p.x * 11 + 1.3) * math.sin(p.y * 9 + 0.4) * math.sin(p.z * 10 + 2.1) + 0.5 * math.sin(p.x * 23 - p.z * 17 + p.y * 19)) / 1.5


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    return bpy.context.scene


def material(name, base, rough=0.8, vertex_colors=False, sheen=0.0, emission=0.0, coat=0.0):
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
    if coat > 0 and "Coat Weight" in bsdf.inputs:
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
    off = Vector((0, 0, 0))
    while ob is not None:
        off += ob.location
        ob = ob.parent
    return off


def obj_from_bmesh(name, bm, mat, parent=None, smooth_shade=True):
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


def sphere_bm(segments=40, rings=24):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=segments, v_segments=rings, radius=1.0)
    return bm


def ellipsoid(name, center, radii, mat, parent=None, segments=40, rings=24, rotate=None, warp=None):
    bm = sphere_bm(segments, rings)
    m = Matrix.Diagonal((*radii, 1.0))
    if rotate is not None:
        m = rotate @ m
    bmesh.ops.transform(bm, matrix=Matrix.Translation(Vector(center)) @ m, verts=bm.verts)
    if warp is not None:
        for v in bm.verts:
            v.co = warp(v.co)
    return obj_from_bmesh(name, bm, mat, parent)


def paint(ob, color_of):
    base = world_of(ob)
    attr = ob.data.color_attributes.new("Col", "FLOAT_COLOR", "POINT")
    for i, v in enumerate(ob.data.vertices):
        attr.data[i].color = color_of(base + v.co)


def empty(name, world_location, parent=None):
    e = bpy.data.objects.new(name, None)
    e.empty_display_size = 0.08
    bpy.context.collection.objects.link(e)
    if parent is not None:
        e.parent = parent
        e.location = Vector(world_location) - world_of(parent)
    else:
        e.location = world_location
    return e


def facing(direction):
    return Vector(direction).to_track_quat("Z", "Y").to_matrix().to_4x4()


def tube(name, points, radius, mat, parent, sides=8):
    """A thin round tube through points (for the little smile)."""
    bm = bmesh.new()
    rings = []
    for i, p in enumerate(points):
        a = points[max(0, i - 1)]
        b = points[min(len(points) - 1, i + 1)]
        d = (b - a).normalized()
        u = d.orthogonal().normalized()
        v = d.cross(u)
        r = radius * (0.55 if i in (0, len(points) - 1) else 1.0)
        rings.append([bm.verts.new(p + (u * math.cos(2 * math.pi * k / sides) + v * math.sin(2 * math.pi * k / sides)) * r) for k in range(sides)])
    for r0, r1 in zip(rings[:-1], rings[1:]):
        for k in range(sides):
            k2 = (k + 1) % sides
            bm.faces.new((r0[k], r0[k2], r1[k2], r1[k]))
    for ring, flip in ((rings[0], True), (rings[-1], False)):
        bm.faces.new(list(reversed(ring)) if flip else ring)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return obj_from_bmesh(name, bm, mat, parent)


# ---------- colouring ----------
EYE_DIRS = {s: Vector((0.5 * s, -0.84, 0.0)).normalized() for s in (1, -1)}


def head_point(d, inset=0.0):
    """The point on the head's surface in direction d (from the head centre)."""
    q = Vector((d.x / HEAD_R.x, d.y / HEAD_R.y, d.z / HEAD_R.z))
    return HEAD_C + d * (1.0 / q.length) - d * inset


def body_color(p):
    q = Vector(((p.x - BODY_C.x) / BODY_R.x, (p.y - BODY_C.y) / BODY_R.y, (p.z - BODY_C.z) / BODY_R.z))
    c = srgb(OAT)
    # Soft brown patches over the back and haunches.
    back = smooth(-0.1, 0.5, q.y) * smooth(-0.6, 0.1, q.z)
    c = mix(c, srgb(PATCH), back * (0.35 + 0.65 * smooth(-0.25, 0.35, noise(p))))
    # White chest and belly.
    chest = smooth(-0.15, -0.6, q.y) * smooth(0.55, -0.1, q.z)
    belly = smooth(-0.3, -0.75, q.z)
    return mix(c, srgb(WHITE), max(chest, belly))


def head_color(p):
    d = (p - HEAD_C).normalized()
    c = srgb(OAT)
    # Light brown cap over the top and back of the head, broken up.
    cap = smooth(0.15, 0.6, d.z * 0.8 + d.y * 0.6)
    c = mix(c, srgb(PATCH), cap * (0.7 + 0.3 * smooth(-0.4, 0.4, noise(p * 1.3))))
    # White muzzle and chin.
    muzzle = smooth(-0.55, -0.95, d.y) * smooth(0.25, -0.15, d.z)
    chin = smooth(-0.2, -0.7, d.z)
    c = mix(c, srgb(WHITE), max(muzzle, chin))
    for s, e in EYE_DIRS.items():
        # A soft darker ring around each eye, and a pink cheek just below and outside it.
        ring = smooth(0.86, 0.96, d.dot(e))
        c = mix(c, srgb(RIM), ring * 0.85)
        cheek = Vector((0.62 * s, -0.7, -0.36)).normalized()
        c = mix(c, srgb(BLUSH), smooth(0.9, 0.975, d.dot(cheek)) * 0.75)
    return c


# ---------- build ----------
def build():
    fur = material("Fur", OAT, rough=0.9, vertex_colors=True, sheen=0.5)
    fur_pink = material("Fur.Pink", EAR_PINK, rough=0.9, sheen=0.4)
    fur_white = material("Fur.White", WHITE, rough=0.9, sheen=0.5)
    eye_m = material("Eye", EYE_DARK, rough=0.05, vertex_colors=True, coat=1.0)
    shine_m = material("Shine", "ffffff", rough=0.2, emission=2.0)
    nose_m = material("Nose", NOSE, rough=0.55)
    mouth_m = material("Mouth", MOUTH, rough=0.8)

    root = empty("Visitor", (0, 0, 0))
    body_pivot = empty("BodyPivot", BODY_C, root)
    head_pivot = empty("HeadPivot", NECK, body_pivot)

    # Body: an egg, a little fuller low down, with round haunches.
    def body_warp(co):
        dz = (co.z - BODY_C.z) / BODY_R.z
        k = 1 + 0.1 * smooth(0.3, -0.7, dz)
        return Vector((co.x * k, BODY_C.y + (co.y - BODY_C.y) * k, max(co.z, 0.012)))

    body = ellipsoid("Body", BODY_C, BODY_R, fur, body_pivot, warp=body_warp)
    paint(body, body_color)
    for side, sx in (("L", 1), ("R", -1)):
        h = ellipsoid(f"Haunch.{side}", (0.145 * sx, 0.1, 0.15), (0.115, 0.16, 0.125), fur, body_pivot, segments=28, rings=18)
        paint(h, body_color)

    # Head: big and round, with chubby lower cheeks.
    def head_warp(co):
        dz = (co.z - HEAD_C.z) / HEAD_R.z
        k = 1 + 0.12 * smooth(0.3, -0.6, dz)
        return Vector((co.x * k, co.y, co.z))

    head = ellipsoid("Head", HEAD_C, HEAD_R, fur, head_pivot, warp=head_warp)
    paint(head, head_color)

    # Muzzle: two white puffs, a pink nose above them, a small smile below.
    for side, sx in (("L", 1), ("R", -1)):
        ellipsoid(f"Muzzle.{side}", HEAD_C + Vector((0.046 * sx, -0.168, -0.075)), (0.06, 0.05, 0.048), fur_white, head_pivot, segments=24, rings=14)
    nose_c = HEAD_C + Vector((0, -0.212, -0.035))

    def nose_warp(co):
        # Wider at the top, like a soft triangle.
        dz = (co.z - nose_c.z) / 0.022
        k = 1 + 0.35 * dz
        return Vector((nose_c.x + (co.x - nose_c.x) * k, co.y, co.z))

    ellipsoid("Nose", nose_c, (0.03, 0.02, 0.022), nose_m, head_pivot, segments=20, rings=12, warp=nose_warp)

    def on_muzzle(x, z):
        best = None
        for sx in (1, -1):
            mc = HEAD_C + Vector((0.046 * sx, -0.168, -0.075))
            rx, ry, rz = 0.06, 0.05, 0.048
            t = 1 - ((x - mc.x) / rx) ** 2 - ((z - mc.z) / rz) ** 2
            if t > 0:
                y = mc.y - ry * math.sqrt(t)
                best = y if best is None else min(best, y)
        y = best if best is not None else HEAD_C.y - 0.19
        return Vector((x, y - 0.004, z))

    philtrum = [on_muzzle(0, nose_c.z - 0.018 - k * 0.008) for k in range(4)]
    tube("Mouth.Mid", philtrum, 0.0045, mouth_m, head_pivot)
    for side, sx in (("L", 1), ("R", -1)):
        pts = []
        for k in range(7):
            t = k / 6
            a = math.pi * (1.05 + 0.75 * t)
            x = sx * (0.022 + 0.022 * math.cos(a))
            z = nose_c.z - 0.042 + 0.018 * math.sin(a) + 0.004 * t
            pts.append(on_muzzle(x, z))
        tube(f"Mouth.{side}", pts, 0.0045, mouth_m, head_pivot)

    # Eyes: big, low, glossy, with a brown iris, a dark pupil and two catch-lights.
    for side, sx in (("L", 1), ("R", -1)):
        d = EYE_DIRS[sx]
        c = head_point(d, inset=0.026)
        eye = ellipsoid(f"Eye.{side}", c, (0.058, 0.064, 0.042), eye_m, head_pivot, segments=32, rings=20, rotate=facing(d))

        def eye_color(p, d=d, c=c):
            k = (p - c).normalized().dot(d)
            if k > 0.9:
                return srgb(PUPIL)
            return mix(srgb(EYE_DARK), srgb(IRIS), smooth(0.45, 0.8, k) * (1 - smooth(0.84, 0.9, k)))

        paint(eye, eye_color)
        up = Vector((0, 0, 1))
        side_v = d.cross(up).normalized()
        front = c + d * 0.04
        ellipsoid(f"Shine.{side}", front + up * 0.022 + side_v * (0.016 * sx), (0.014, 0.014, 0.014), shine_m, head_pivot, segments=12, rings=8)
        ellipsoid(f"Shine2.{side}", front - up * 0.02 - side_v * (0.012 * sx), (0.006, 0.006, 0.006), shine_m, head_pivot, segments=10, rings=6)

    # Ears: long, a little splayed and swept back; pivots at the roots so they can flop.
    for side, sx in (("L", 1), ("R", -1)):
        root_pt = head_point(Vector((0.52 * sx, 0.14, 0.84)).normalized(), inset=0.035)
        ear_pivot = empty(f"Ear.{side}", root_pt, head_pivot)
        rot = Matrix.Rotation(math.radians(20) * sx, 4, "Y") @ Matrix.Rotation(math.radians(14), 4, "X") @ Matrix.Rotation(math.radians(-16) * sx, 4, "Z")
        rot3 = rot.to_3x3()
        centre = root_pt + rot3 @ Vector((0, 0, EAR_LEN * 0.5))

        def ear_warp(co, centre=centre, rot3=rot3):
            # Narrower at the root, widest two-thirds up, softly cupped toward the front.
            local = rot3.transposed() @ (co - centre)
            t = local.z / (EAR_LEN * 0.5)
            w = 0.78 + 0.3 * smooth(-1.0, 0.35, t) - 0.12 * smooth(0.5, 1.0, t)
            local.x *= w
            local.y += 0.012 * (1 - (local.x / 0.06) ** 2) if abs(local.x) < 0.06 else 0
            return centre + rot3 @ local

        outer = ellipsoid(f"EarOuter.{side}", centre, (0.06, 0.03, EAR_LEN * 0.5), fur, ear_pivot, segments=28, rings=20, rotate=rot, warp=ear_warp)

        def ear_color(p, root_pt=root_pt):
            t = (p - root_pt).length / EAR_LEN
            return mix(mix(srgb(OAT), srgb(PATCH), smooth(0.0, 0.5, t)), srgb(PATCH_DARK), smooth(0.7, 1.0, t))

        paint(outer, ear_color)
        inner_c = centre + rot3 @ Vector((0, -0.021, -0.01))
        ellipsoid(f"EarInner.{side}", inner_c, (0.038, 0.012, EAR_LEN * 0.4), fur_pink, ear_pivot, segments=24, rings=16, rotate=rot, warp=ear_warp)

    # Cotton tail.
    tail = empty("Tail", (0, 0.31, 0.17), body_pivot)
    ellipsoid("TailPuff", (0, 0.33, 0.18), (0.075, 0.07, 0.072), fur_white, tail, segments=24, rings=14)

    # Front paws: little white mittens. Back feet: long, flat, white underneath.
    for name, x, y, z, r in (("Paw.FL", 0.08, -0.15, 0.045, (0.05, 0.064, 0.045)), ("Paw.FR", -0.08, -0.15, 0.045, (0.05, 0.064, 0.045))):
        pivot = empty(name, (x, y, 0.075), root)
        ellipsoid(f"{name}.Mesh", (x, y, z), r, fur_white, pivot, segments=24, rings=14)
    for name, x in (("Foot.BL", 0.17), ("Foot.BR", -0.17)):
        pivot = empty(name, (x, 0.08, 0.04), root)
        f = ellipsoid(f"{name}.Mesh", (x, -0.02, 0.036), (0.06, 0.135, 0.036), fur, pivot, segments=28, rings=14)
        paint(f, lambda p: mix(srgb(OAT), srgb(WHITE), smooth(0.04, 0.0, p.z) + smooth(-0.08, -0.13, p.y)))

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
    scene.render.resolution_x = 800
    scene.render.resolution_y = 800
    scene.view_settings.view_transform = "Standard"
    world = bpy.data.worlds.new("World")
    scene.world = world
    try:
        world.use_nodes = True
    except Exception:
        pass
    bg = world.node_tree.nodes.get("Background")
    bg.inputs["Color"].default_value = srgb("e6eadc")
    bg.inputs["Strength"].default_value = 0.9

    sun = bpy.data.objects.new("Sun", bpy.data.lights.new("Sun", "SUN"))
    sun.data.energy = 3.0
    sun.rotation_euler = (math.radians(50), math.radians(10), math.radians(-35))
    scene.collection.objects.link(sun)
    fill = bpy.data.objects.new("Fill", bpy.data.lights.new("Fill", "AREA"))
    fill.data.energy = 90
    fill.data.size = 3
    fill.location = (-2.2, -2.4, 1.4)
    look_at(fill, (0, 0, 0.45))
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
        "34": ((2.1, -3.2, 1.3), (0, -0.05, 0.5)),
        "front": ((0, -3.8, 0.75), (0, 0, 0.5)),
        "side": ((3.8, 0, 0.75), (0, 0, 0.5)),
    }
    for name, (loc, target) in views.items():
        cam.location = loc
        look_at(cam, target)
        scene.render.filepath = os.path.join(out, f"visitor-{name}.png")
        bpy.ops.render.render(write_still=True)
    for ob in (sun, fill, g, cam):
        bpy.data.objects.remove(ob)


def main():
    scene = reset()
    build()
    render_previews(scene)
    os.makedirs(os.path.join(HERE, "export"), exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=os.path.join(HERE, "export", "visitor.glb"), export_format="GLB")
    bpy.context.preferences.filepaths.save_version = 0  # no .blend1 backups
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(HERE, "visitor.blend"))
    print("VISITOR-DONE", scene.render.engine)


main()
