# Builds Khina the bunny in Blender, renders previews, and exports a .glb for the browser.
# Run: /Applications/Blender.app/Contents/MacOS/Blender --background --python art/khina.py
# Outputs: art/khina.blend (editable), art/export/khina.glb, art/previews/khina-*.png
#
# The look is a needle-felted plush bunny: a head about as big as her chubby round body, long
# upright ears with pink felt inside (her left ear has a soft bend at the tip), big glossy brown
# eyes with a white shine, a tiny pink nose over two white muzzle puffs, round rosy cheeks, a
# cotton-ball tail, snow-white fur with caramel just at the ear tips, and a small moss-green knitted scarf.
# The browser grows short felt fuzz (shell layers) on every material whose name starts with "Fur";
# the first UV channel's U says how long the fuzz is there (0 next to the eyes and the mouth).
#
# Khina faces -Y (Blender's front view; three.js +Z). About 0.95 long, 0.65 wide, 0.86 to the top of
# her head and 1.25 to the tips of her ears.
# Rigid parts on pivots, so the browser can animate without a skeleton:
#   Khina (root, on the ground) > BodyPivot (body centre: hops, sits up, breathes, loafs)
#   BodyPivot > HeadPivot (the neck: nods, sniffs, looks) > Ear.L / Ear.R (ear roots: perk, lie back,
#     bounce) and Nose (twitches; carries the muzzle and mouth)
#   BodyPivot > Tail
#   Khina > Foot.FL / Foot.FR (front paws), Foot.BL / Foot.BR (long back feet)
#   Khina > Leg.FL / Leg.FR: short felt forelegs, which the browser stretches each frame from the paw up
#     to her chest, so the front paws never float apart from her.
#   EyeShut.L / EyeShut.R: closed-eye arcs, hidden by the browser except to blink and sleep.
# Each ear (EarOuter.*, EarInner.*) has a "Lie" shape key: the ear curled toward its pink front, her
# left one's bent tip straightened. The browser blends it in as she settles into a loaf, while it turns
# each ear half round and lays it back, so the ears wrap her head with their cream backs up.

import math
import os

import bmesh
import bpy
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))

# ---------- palette (sRGB hex) ----------
CREAM = "f8f1e6"  # main coat: soft cream-white
CREAM_SHADE = "efe4d3"
OAT = "f3e9dc"  # the faintest oatmeal on the back, the rump and the ear backs (she reads snow-white)
CARAMEL = "cf9c68"  # warm touch: just the very tips of her ears
CARAMEL_DARK = "b9844f"
WHITE = "fffcf6"  # muzzle, chest, tail
EAR_PINK = "f4b0b8"
EAR_PINK_DEEP = "e896a4"
BLUSH = "f6a0b0"
NOSE = "ee8f9a"
MOUTH = "6a4537"
PUPIL = "0a0605"
IRIS = "5a3720"
IRIS_LIGHT = "8a5a36"
EYE_DARK = "1b110c"
SCARF = "5f8a3c"
SCARF_DARK = "46702f"
SCARF_STRIPE = "efe3c8"
PAW = "f4ebdd"

# ---------- shape ----------
BODY_C = Vector((0.0, 0.09, 0.27))
BODY_R = Vector((0.3, 0.31, 0.258))
CHEST_C = Vector((0.0, -0.11, 0.33))
CHEST_R = Vector((0.215, 0.2, 0.2))
HEAD_C = Vector((0.0, -0.17, 0.605))
HEAD_R = Vector((0.29, 0.255, 0.25))
NECK = Vector((0.0, -0.06, 0.44))
HAUNCH = [(Vector((0.165 * sx, 0.2, 0.17)), Vector((0.135, 0.19, 0.15))) for sx in (1, -1)]
EAR_LEN = 0.42
LEG_HALF = 0.09  # half the length of a foreleg at rest (the browser stretches it)
EYE_DIR = {sx: Vector((0.46 * sx, -0.84, -0.06)).normalized() for sx in (1, -1)}
# Eye radii (across, up, depth): wide and fairly flat, so the glossy lens sits just proud of the felt.
EYE_R = (0.068, 0.076, 0.036)
EYE_SINK = 0.027
NOSE_C = HEAD_C + Vector((0.0, -0.243, -0.06))
MUZZLE = {sx: (HEAD_C + Vector((0.04 * sx, -0.222, -0.108)), Vector((0.05, 0.04, 0.04))) for sx in (1, -1)}


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
    e.empty_display_size = 0.08
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


def surface(c, r, d, out=0.0):
    """The point on an ellipsoid (centre c, radii r) in direction d, pushed out by `out`."""
    d = Vector(d).normalized()
    q = Vector((d.x / r[0], d.y / r[1], d.z / r[2]))
    return Vector(c) + d * (1.0 / q.length + out)


def exit_dist(o, d, c, r):
    """How far along the ray o + t d (o inside the ellipsoid) it leaves the ellipsoid; 0 if o is outside."""
    oc = Vector(((o.x - c.x) / r.x, (o.y - c.y) / r.y, (o.z - c.z) / r.z))
    dd = Vector((d.x / r.x, d.y / r.y, d.z / r.z))
    a = dd.dot(dd)
    b = 2 * oc.dot(dd)
    cc = oc.dot(oc) - 1
    disc = b * b - 4 * a * cc
    if disc < 0:
        return 0.0
    return max(0.0, (-b + math.sqrt(disc)) / (2 * a))


TORSO = [(BODY_C, BODY_R), (CHEST_C, CHEST_R), (HEAD_C, HEAD_R)]


def on_torso(origin, d, out=0.0):
    """Where a ray from inside Khina leaves her body, chest and head together, pushed out by `out`."""
    d = Vector(d).normalized()
    t = max(exit_dist(origin, d, c, r) for c, r in TORSO)
    return origin + d * (t + out)


# The scarf's ring round the neck (low under the chin, high behind the head), worked out first so the
# fuzz can be kept short where it lies.
SCARF_AXIS = Vector((0.0, -0.1, 0.0))
SCARF_OUT = 0.03


def scarf_at(a, out=SCARF_OUT):
    """A point on the scarf ring; a = 0 at the front, going round to her left."""
    z = 0.455 - 0.088 * math.cos(a)
    return on_torso(Vector((SCARF_AXIS.x, SCARF_AXIS.y, z)), Vector((math.sin(a), -math.cos(a), 0.0)), out)


SCARF_PTS = [scarf_at(2 * math.pi * k / 48) for k in range(48)]
SCARF_KNOT_A = math.radians(46)
SCARF_KNOT = scarf_at(SCARF_KNOT_A, 0.055)


def scarf_end_pts():
    """The hanging end: from the knot down over her chest."""
    end = [SCARF_KNOT + Vector((0.0, -0.012, -0.02))]
    for j in range(1, 9):
        t = j / 8
        a = SCARF_KNOT_A - math.radians(8) * t
        o = Vector((SCARF_AXIS.x, SCARF_AXIS.y + 0.04, SCARF_KNOT.z - 0.03 - 0.2 * t))
        end.append(on_torso(o, Vector((math.sin(a), -math.cos(a), 0.1)), 0.034 + 0.008 * t))
    return end


SCARF_END = scarf_end_pts()


def near_scarf(p):
    return min(min((p - q).length for q in SCARF_PTS), min((p - q).length for q in SCARF_END) + 0.01)


def scarf_fuzz(p):
    """Fuzz length on the fur next to the scarf: short, so the knit shows."""
    return smooth(0.03, 0.085, near_scarf(p))


def tube(name, points, radius, mat, parent, sides=8, radii=None, closed=False, ring_warp=None):
    """A round tube through points; radii (one per point) make it fat in places. ring_warp(i, k, offset)
    can reshape each ring (a flattened ribbon, knitted ribs)."""
    pts = [Vector(p) for p in points]
    bm = bmesh.new()
    rings = []
    n = len(pts)
    prev_u = None
    for i, p in enumerate(pts):
        if closed:
            a, b = pts[(i - 1) % n], pts[(i + 1) % n]
        else:
            a, b = pts[max(0, i - 1)], pts[min(n - 1, i + 1)]
        d = (b - a).normalized()
        # Carry the side vector along the tube so rings don't twist.
        u = (prev_u - d * prev_u.dot(d)).normalized() if prev_u is not None else d.orthogonal().normalized()
        prev_u = u
        v = d.cross(u)
        r = radii[i] if radii else radius * (0.55 if not closed and i in (0, n - 1) else 1.0)
        ring = []
        for k in range(sides):
            ang = 2 * math.pi * k / sides
            off = (u * math.cos(ang) + v * math.sin(ang)) * r
            if ring_warp is not None:
                off = ring_warp(i, k, off, u, v, d)
            ring.append(bm.verts.new(p + off))
        rings.append(ring)
    pairs = list(zip(rings, rings[1:] + ([rings[0]] if closed else [])))
    for r0, r1 in pairs:
        best = min(range(sides), key=lambda s: sum((r0[k].co - r1[(k + s) % sides].co).length for k in range(sides)))
        for k in range(sides):
            k2 = (k + 1) % sides
            bm.faces.new((r0[k], r0[k2], r1[(k2 + best) % sides], r1[(k + best) % sides]))
    if not closed:
        for ring, flip in ((rings[0], True), (rings[-1], False)):
            bm.faces.new(list(reversed(ring)) if flip else ring)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return obj_from_bmesh(name, bm, mat, parent)


# ---------- colouring ----------
def q_of(p, c, r):
    return Vector(((p.x - c.x) / r.x, (p.y - c.y) / r.y, (p.z - c.z) / r.z))


def coat_color(p):
    """Cream-white all over, oatmeal along the back and over the rump, white on the chest and belly."""
    q = q_of(p, BODY_C, BODY_R)
    c = mix(srgb(CREAM), srgb(CREAM_SHADE), 0.35 * smooth(-0.2, 0.4, noise(p * 1.4)))
    back = smooth(-0.35, 0.55, q.y) * smooth(-0.15, 0.65, q.z)
    c = mix(c, srgb(OAT), back * (0.6 + 0.2 * smooth(-0.4, 0.4, noise(p * 0.9))))
    chest = smooth(-0.1, -0.75, q.y) * smooth(0.5, -0.1, q.z)
    belly = smooth(-0.35, -0.8, q.z)
    return mix(c, srgb(WHITE), max(chest, belly) * 0.85)


def head_color(p, n):
    d = (p - HEAD_C).normalized()
    c = mix(srgb(CREAM), srgb(CREAM_SHADE), 0.3 * smooth(-0.2, 0.4, noise(p * 1.6)))
    # No crown patch: in the village's green light any tan on her head read as dust on a white bunny.
    c = mix(c, srgb(OAT), smooth(0.2, 0.75, d.y) * smooth(-0.3, 0.4, d.z) * 0.5)
    # White muzzle and chin.
    muzzle = smooth(-0.6, -0.92, d.y) * smooth(0.12, -0.3, d.z)
    chin = smooth(-0.35, -0.8, d.z)
    c = mix(c, srgb(WHITE), max(muzzle, chin) * 0.9)
    fuzz = 1.0
    for sx, e in EYE_DIR.items():
        # A faint warm ring round each eye, and a round rosy patch on the cheek below and outside it
        # (a tight edge, so in shade it stays a pink felt circle and not a smudge).
        ring = smooth(0.9, 0.955, d.dot(e)) * (1 - smooth(0.975, 0.985, d.dot(e)))
        c = mix(c, srgb(OAT), ring * 0.5)
        cheek = Vector((0.66 * sx, -0.62, -0.42)).normalized()
        c = mix(c, srgb(BLUSH), smooth(0.9, 0.98, d.dot(cheek)) * 0.65)
        fuzz = min(fuzz, smooth(0.975, 0.93, d.dot(e)))
    # Short fuzz round the nose and mouth so they stay crisp, and along the scarf.
    fuzz = min(fuzz, 0.35 + 0.65 * smooth(0.04, 0.11, (p - (NOSE_C + Vector((0, 0, -0.04)))).length))
    fuzz = min(fuzz, 0.15 + 0.85 * scarf_fuzz(p))
    return with_alpha(c, fuzz)


# ---------- parts ----------
def ear_shape(L, half_w, half_t, cup, bend_axis, bend_deg, bend_from, segments=32, rings=24):
    """A long felt ear along local +Z (root at the origin): narrow at the root, widest two-thirds up,
    a rounded tip, the front (-Y) cupped in; past `bend_from` (0..1) it curls by up to `bend_deg`."""
    bm = sphere_bm(segments, rings)
    zb = bend_from * L
    for v in bm.verts:
        x, y, z = v.co
        t = (z + 1) / 2  # 0 at the root, 1 at the tip
        w = half_w * (0.62 + 0.5 * t - 0.18 * t * t)
        px = x * w
        py = y * half_t
        if y < 0:  # the cup
            py += cup * (1 - min(1.0, x * x)) * math.sin(math.pi * min(1.0, t * 1.1)) * 0.9
        pz = t * L
        p = Vector((px, py, pz))
        if bend_deg and pz > zb:
            k = (pz - zb) / (L - zb)
            ang = math.radians(bend_deg) * k * (0.6 + 0.4 * k)
            pivot = Vector((0, 0, zb))
            p = pivot + Matrix.Rotation(ang, 3, bend_axis) @ (p - pivot)
        v.co = p
    return bm


def ear_lie_field(L, start=0.1, ramp=0.3, total=1.6, steps=240):
    """The ear's centre line when it lies back: straight up to start*L, then curling toward the ear's
    own front (-Y, the pink side) ever more, by `total` radians at the tip. The browser turns the ear
    half round on its long axis as it lays it back, so the front faces her head: the ear then wraps the
    round of her head pink side in, with its cream back up, as a real rabbit's does.
    Returns a function from an unbent ear-local point to where it goes."""
    top = L * 1.1
    dz = top / steps
    k_max = total / (L * (1 - start - ramp / 2))
    table = []
    phi, c = 0.0, Vector((0.0, 0.0, 0.0))
    for i in range(steps + 1):
        z = i * dz
        table.append((phi, c.copy()))
        k = k_max * smooth(start * L, (start + ramp) * L, z)
        c += Vector((0.0, -math.sin(phi), math.cos(phi))) * dz
        phi += k * dz

    def at(p):
        f = min(steps - 1e-6, max(0.0, p.z / dz))
        i = int(f)
        t = f - i
        (p0, c0), (p1, c1) = table[i], table[i + 1]
        phi_ = p0 + (p1 - p0) * t
        cc = c0.lerp(c1, t)
        return cc + Vector((p.x, 0.0, 0.0)) + Vector((0.0, math.cos(phi_), math.sin(phi_))) * p.y

    return at


def add_shape_key(ob, name, world_pts):
    """A shape key from points in world coordinates, one per vertex in the mesh's own order."""
    off = world_of(ob.parent) if ob.parent is not None else Vector((0, 0, 0))
    if ob.data.shape_keys is None:
        ob.shape_key_add(name="Basis", from_mix=False)
    key = ob.shape_key_add(name=name, from_mix=False)
    for i, p in enumerate(world_pts):
        key.data[i].co = p - off
    return key


def build():
    fur = material("Fur", CREAM, rough=0.92, vertex_colors=True, sheen=0.6)
    ear_m = material("Fur.Ear", OAT, rough=0.92, vertex_colors=True, sheen=0.5)
    pink_m = material("Fur.Pink", EAR_PINK, rough=0.9, vertex_colors=True, sheen=0.4)
    white_m = material("Fur.White", WHITE, rough=0.9, vertex_colors=True, sheen=0.5)
    feet_m = material("Fur.Feet", PAW, rough=0.92, vertex_colors=True, sheen=0.4)
    nose_m = material("Fur.Nose", NOSE, rough=0.6, sheen=0.3)
    scarf_m = material("Fur.Scarf", SCARF, rough=0.95, vertex_colors=True, sheen=0.3)
    eye_m = material("Eye", EYE_DARK, rough=0.04, vertex_colors=True, coat=1.0)
    # Under the browser's bloom threshold (0.92), so the catch-lights stay crisp dots and don't halo.
    shine_m = material("Shine", "ffffff", rough=0.2, emission=0.9)
    mouth_m = material("Mouth", MOUTH, rough=0.8)

    root = empty("Khina", (0, 0, 0))
    body_pivot = empty("BodyPivot", BODY_C, root)
    head_pivot = empty("HeadPivot", NECK, body_pivot)

    # Body: a chubby round loaf, flat underneath, fuller low down.
    def body_warp(co):
        dz = (co.z - BODY_C.z) / BODY_R.z
        k = 1 + 0.08 * smooth(0.3, -0.7, dz)
        return Vector((co.x * k, BODY_C.y + (co.y - BODY_C.y) * k, max(co.z, 0.03)))

    body = ellipsoid("Body", BODY_C, BODY_R, fur, body_pivot, segments=56, rings=36, warp=body_warp)
    paint(body, lambda p, n: with_alpha(coat_color(p), 0.15 + 0.85 * scarf_fuzz(p)))

    # Chest: fills in under the chin so the head sits on the body like a plush toy's.
    chest = ellipsoid("Chest", CHEST_C, CHEST_R, fur, body_pivot, segments=40, rings=24)
    paint(chest, lambda p, n: with_alpha(mix(coat_color(p), srgb(WHITE), 0.7 * smooth(-0.2, -0.8, q_of(p, CHEST_C, CHEST_R).y)), 0.15 + 0.85 * scarf_fuzz(p)))

    # Round haunches at the back.
    for (c, r), side in zip(HAUNCH, ("L", "R")):
        h = ellipsoid(f"Haunch.{side}", c, r, fur, body_pivot, segments=36, rings=22, warp=lambda co: Vector((co.x, co.y, max(co.z, 0.03))))
        paint(h, lambda p, n, c=c: with_alpha(mix(coat_color(p), srgb(OAT), 0.35 * smooth(-0.2, 0.6, (p.y - c.y) / 0.19)), 1.0))

    # Head: big and round, with chubby lower cheeks.
    def head_warp(co):
        dz = (co.z - HEAD_C.z) / HEAD_R.z
        dy = (co.y - HEAD_C.y) / HEAD_R.y
        k = 1 + 0.1 * smooth(0.35, -0.55, dz) * smooth(0.5, -0.4, dy)
        return Vector((co.x * k, co.y, co.z))

    head = ellipsoid("Head", HEAD_C, HEAD_R, fur, head_pivot, segments=64, rings=40, warp=head_warp)
    paint(head, head_color)

    # Nose pivot: the twitchy bit, with the muzzle puffs and the mouth.
    nose_pivot = empty("Nose", NOSE_C, head_pivot)
    for sx, side in ((1, "L"), (-1, "R")):
        mc, mr = MUZZLE[sx]
        m = ellipsoid(f"Muzzle.{side}", mc, mr, white_m, nose_pivot, segments=28, rings=16)
        paint(m, lambda p, n: with_alpha(srgb(WHITE), 0.45))

    def nose_warp(co):
        # Wider at the top, like a soft little triangle.
        dz = (co.z - NOSE_C.z) / 0.02
        k = 1 + 0.38 * dz
        return Vector((NOSE_C.x + (co.x - NOSE_C.x) * k, co.y, co.z))

    ellipsoid("NoseTip", NOSE_C, (0.027, 0.017, 0.019), nose_m, nose_pivot, segments=20, rings=12, warp=nose_warp)

    def on_muzzle(x, z):
        best = None
        for sx in (1, -1):
            mc, mr = MUZZLE[sx]
            t = 1 - ((x - mc.x) / mr.x) ** 2 - ((z - mc.z) / mr.z) ** 2
            if t > 0:
                y = mc.y - mr.y * math.sqrt(t)
                best = y if best is None else min(best, y)
        y = best if best is not None else HEAD_C.y - 0.24
        return Vector((x, y - 0.004, z))

    philtrum = [on_muzzle(0, NOSE_C.z - 0.016 - k * 0.007) for k in range(4)]
    tube("Mouth.Mid", philtrum, 0.004, mouth_m, nose_pivot, sides=6)
    for side, sx in (("L", 1), ("R", -1)):
        pts = []
        for k in range(7):
            t = k / 6
            a = math.pi * (1.05 + 0.75 * t)
            x = sx * (0.02 + 0.02 * math.cos(a))
            z = NOSE_C.z - 0.037 + 0.016 * math.sin(a) + 0.004 * t
            pts.append(on_muzzle(x, z))
        tube(f"Mouth.{side}", pts, 0.004, mouth_m, nose_pivot, sides=6)

    # Eyes: big, low and wide, glossy dark with a warm iris and two catch-lights.
    for side, sx in (("L", 1), ("R", -1)):
        d = EYE_DIR[sx]
        c = surface(HEAD_C, HEAD_R, d, -EYE_SINK)
        eye_rot = facing(d)
        eye = ellipsoid(f"Eye.{side}", c, EYE_R, eye_m, head_pivot, segments=48, rings=40, rotate=eye_rot)
        up = Vector((0, 0, 1))
        side_v = d.cross(up).normalized()  # points to her outside (+X for the left eye)
        rot3 = eye_rot.to_3x3()
        ex, ey = rot3 @ Vector((1, 0, 0)), rot3 @ Vector((0, 1, 0))

        def eye_color(p, n, c=c, ex=ex, ey=ey):
            # By how far out from the middle of the lens (0 at the centre, 1 at its rim; about 0.8
            # shows past the felt): a big dark pupil, a warm brown iris ring lighter at the bottom,
            # and a dark rim.
            q = p - c
            r = math.hypot(q.dot(ex) / EYE_R[0], q.dot(ey) / EYE_R[1])
            if r < 0.4:
                return srgb(PUPIL)
            below = smooth(0.1, -0.7, q.dot(ey) / EYE_R[1])
            iris = mix(srgb(IRIS), srgb(IRIS_LIGHT), below)
            iris = mix(srgb(PUPIL), iris, smooth(0.4, 0.46, r))
            return mix(iris, srgb(EYE_DARK), smooth(0.66, 0.74, r))

        paint(eye, eye_color)

        def on_eye(offset):
            """The point on the eye's glossy front at this sideways offset, and the outward normal there."""
            lx, ly = offset.dot(ex), offset.dot(ey)
            q = max(0.0, 1 - (lx / EYE_R[0]) ** 2 - (ly / EYE_R[1]) ** 2)
            lz = EYE_R[2] * math.sqrt(q)
            n = (rot3 @ Vector((lx / EYE_R[0] ** 2, ly / EYE_R[1] ** 2, lz / EYE_R[2] ** 2))).normalized()
            return c + rot3 @ Vector((lx, ly, lz)), n

        # Two catch-lights lying on the lens (thin, so they never stand off it).
        for name, offset, r in ((f"Shine.{side}", up * 0.026 + side_v * (0.017 * sx), (0.018, 0.018, 0.004)), (f"Shine2.{side}", -up * 0.022 - side_v * (0.016 * sx), (0.008, 0.008, 0.003))):
            at, n = on_eye(offset)
            ellipsoid(name, at - n * 0.0015, r, shine_m, head_pivot, segments=14, rings=8, rotate=facing(n))

        # Closed eye: a soft downward arc on the fur, for blinking and sleeping (hidden by the browser).
        pts = []
        for k in range(9):
            t = k / 8 * 2 - 1
            dd = (d + side_v * (t * 0.2 * sx) + up * (-0.05 - 0.05 * (1 - t * t))).normalized()
            pts.append(surface(HEAD_C, HEAD_R, dd, 0.004))
        tube(f"EyeShut.{side}", pts, 0.0065, mouth_m, head_pivot, sides=6)

    # Ears: long and upright, a little splayed, pale pink inside; her left one bends softly at the tip.
    for side, sx in (("L", 1), ("R", -1)):
        root_dir = Vector((0.4 * sx, 0.2, 0.9)).normalized()
        root_pt = surface(HEAD_C, HEAD_R, root_dir, -0.035)
        ear_pivot = empty(f"Ear.{side}", root_pt, head_pivot)
        rot = (Matrix.Rotation(math.radians(13) * sx, 4, "Y") @ Matrix.Rotation(math.radians(-7), 4, "X") @ Matrix.Rotation(math.radians(-14) * sx, 4, "Z"))
        bend = (Vector((0.55, 0.0, 0.0)) + Vector((0.0, 0.8 * sx, 0.0))).normalized() if sx == 1 else Vector((1, 0, 0))
        bend_deg = 62 if sx == 1 else 0
        place = Matrix.Translation(root_pt) @ rot
        bm = ear_shape(EAR_LEN, 0.072, 0.03, 0.02, bend, bend_deg, 0.56)
        bmesh.ops.transform(bm, matrix=place, verts=bm.verts)
        outer = obj_from_bmesh(f"EarOuter.{side}", bm, ear_m, ear_pivot)
        inv = place.inverted()
        # Lying back: the same ear, unbent, curled back along her head (vertices in the same order).
        lie = ear_lie_field(EAR_LEN)
        flat = ear_shape(EAR_LEN, 0.072, 0.03, 0.02, bend, 0, 0.56)
        add_shape_key(outer, "Lie", [place @ lie(v.co) for v in flat.verts])
        flat.free()

        def ear_color(p, n, inv=inv):
            local = inv @ p
            t = local.z / EAR_LEN
            # Cream backs (a step warmer up the ear), caramel only on the last few millimetres of the tip.
            c = mix(srgb(CREAM), srgb(OAT), smooth(0.0, 0.45, t))
            c = mix(c, srgb(CARAMEL), smooth(0.9, 0.99, t) * 0.7)
            c = mix(c, srgb(CARAMEL_DARK), smooth(0.96, 1.0, t) * 0.3)
            return with_alpha(c, 0.75)

        paint(outer, ear_color)
        bm = ear_shape(EAR_LEN * 0.84, 0.046, 0.01, 0.0, bend, bend_deg, 0.56 / 0.84 * 0.97, segments=24, rings=18)
        # Sit the pink felt in the cup, a little up from the root.
        bmesh.ops.transform(bm, matrix=place @ Matrix.Translation((0, -0.012, EAR_LEN * 0.07)), verts=bm.verts)
        inner = obj_from_bmesh(f"EarInner.{side}", bm, pink_m, ear_pivot)
        paint(inner, lambda p, n, inv=inv: with_alpha(mix(srgb(EAR_PINK), srgb(EAR_PINK_DEEP), smooth(0.25, 0.6, (inv @ p).z / EAR_LEN) * 0.5), 0.5))
        flat = ear_shape(EAR_LEN * 0.84, 0.046, 0.01, 0.0, bend, 0, 0.56, segments=24, rings=18)
        sit = Matrix.Translation((0, -0.012, EAR_LEN * 0.07))
        add_shape_key(inner, "Lie", [place @ lie(sit @ v.co) for v in flat.verts])
        flat.free()

    # Cotton-ball tail, a little lumpy.
    tail = empty("Tail", (0, 0.41, 0.22), body_pivot)
    tc = Vector((0, 0.445, 0.235))
    t = ellipsoid("TailPuff", tc, (0.085, 0.075, 0.08), white_m, tail, segments=28, rings=16, warp=lambda co: tc + (co - tc) * (1 + 0.1 * noise((co - tc) * 9)))
    paint(t, lambda p, n: with_alpha(mix(srgb(WHITE), srgb(CREAM_SHADE), 0.3 * smooth(0.0, 0.5, noise(p * 7))), 1.0))

    # Front paws: little mittens under the chest. Back feet: long and flat, out from the haunches.
    for name, x in (("Foot.FL", 0.095), ("Foot.FR", -0.095)):
        pivot = empty(name, (x, -0.23, 0.04), root)
        f = ellipsoid(f"{name}.Mesh", (x, -0.235, 0.036), (0.05, 0.066, 0.038), feet_m, pivot, segments=24, rings=14)
        paint(f, lambda p, n: with_alpha(srgb(PAW), 0.7))
    # Forelegs: short felt sausages from each front paw up into her chest. Built standing on their
    # pivot (LEG_HALF up and down from it); the browser aims and stretches them every frame.
    for name, x in (("Leg.FL", 0.09), ("Leg.FR", -0.09)):
        mid = Vector((x, -0.2, 0.15))
        pivot = empty(name, mid, root)
        leg = ellipsoid(f"{name}.Mesh", mid, (0.04, 0.043, LEG_HALF), feet_m, pivot, segments=20, rings=16)
        paint(leg, lambda p, n: with_alpha(mix(srgb(PAW), srgb(WHITE), smooth(0.08, 0.2, p.z)), 0.7))
    for name, x in (("Foot.BL", 0.2), ("Foot.BR", -0.2)):
        pivot = empty(name, (x, 0.12, 0.035), root)
        f = ellipsoid(f"{name}.Mesh", (x, 0.04, 0.034), (0.066, 0.155, 0.036), feet_m, pivot, segments=28, rings=14)
        paint(f, lambda p, n: with_alpha(mix(srgb(PAW), srgb(OAT), smooth(0.03, 0.065, p.z) * smooth(-0.05, 0.12, p.y) * 0.6), 0.8))

    # The scarf: a moss-green knitted ring round the neck, tied at her left with one end hanging.
    build_scarf(scarf_m, head_pivot)
    return root


def build_scarf(mat, parent):
    """A moss-green knitted ring round the neck (on the head pivot, so it turns with her head), knotted
    at her left with one striped end hanging over her chest."""
    ox, oy = SCARF_AXIS.x, SCARF_AXIS.y
    # Ribbed: every other column round the tube stands out, and each row bulges a little.
    ring = tube("Scarf", SCARF_PTS, 0.042, mat, parent, sides=14, closed=True, ring_warp=lambda i, k, off, u, v, d: off * (1.08 if k % 2 == 0 else 0.92) * (1 + 0.07 * math.cos(i * math.pi)))
    paint(ring, lambda p, n: with_alpha(mix(srgb(SCARF), srgb(SCARF_DARK), 0.35 * smooth(-0.3, 0.3, noise(p * 9))), 0.3))

    # The knot, on her left at the front.
    knot_at = SCARF_KNOT
    k = ellipsoid("ScarfKnot", knot_at, (0.044, 0.038, 0.042), mat, parent, segments=20, rings=12, warp=lambda co: knot_at + (co - knot_at) * (1 + 0.08 * math.cos(9 * math.atan2(co.z - knot_at.z, co.x - knot_at.x))))
    paint(k, lambda p, n: with_alpha(mix(srgb(SCARF), srgb(SCARF_DARK), 0.4), 0.4))

    # One end hanging from the knot down over her chest: a flat knitted strip with two cream stripes.
    end = SCARF_END

    def flat(i, k, off, u, v, d):
        # Flatten the tube against the chest: wide sideways, thin outward.
        out = (end[i] - Vector((ox, oy + 0.04, end[i].z))).normalized()
        out = (out - d * out.dot(d)).normalized()
        along_out = out * off.dot(out)
        return (off - along_out) * 1.3 + along_out * 0.32

    strip = tube("ScarfEnd", end, 0.036, mat, parent, sides=12, ring_warp=flat)
    bands = [(end[3].z, end[4].z), (end[6].z, end[7].z)]

    def strip_color(p, n):
        c = mix(srgb(SCARF), srgb(SCARF_DARK), 0.3 * smooth(-0.3, 0.3, noise(p * 9)))
        if any(hi > p.z > lo for hi, lo in bands):
            c = mix(c, srgb(SCARF_STRIPE), 0.85)
        return with_alpha(c, 0.4)

    paint(strip, strip_color)
    # A little fringe at the bottom.
    bottom = end[-1]
    out = (bottom - Vector((ox, oy + 0.04, bottom.z))).normalized()
    side = out.cross(Vector((0, 0, 1))).normalized()
    for f in range(5):
        s = (f - 2) * 0.016
        a0 = bottom + side * s + Vector((0, 0, 0.005))
        fr = tube(f"ScarfFringe.{f}", [a0, a0 + Vector((0, 0, -0.025)), a0 + out * 0.004 + Vector((0, 0, -0.045))], 0.0065, mat, parent, sides=6)
        paint(fr, lambda p, n: with_alpha(srgb(SCARF), 0.3))


def join(name, obs):
    """One mesh from several on the same pivot with the same material (fewer draw calls)."""
    bpy.ops.object.select_all(action="DESELECT")
    for o in obs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = obs[0]
    bpy.ops.object.join()
    obs[0].name = name
    obs[0].data.name = name
    return obs[0]


def tidy():
    by = lambda prefix: [o for o in bpy.data.objects if o.type == "MESH" and o.name.startswith(prefix)]
    join("Body", by("Body") + by("Chest") + by("Haunch."))
    join("Scarf", by("Scarf"))
    join("Muzzle", by("Muzzle."))
    join("Mouth", by("Mouth."))


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
    bg.inputs["Color"].default_value = srgb("e6eadc")
    bg.inputs["Strength"].default_value = 0.9

    sun = bpy.data.objects.new("Sun", bpy.data.lights.new("Sun", "SUN"))
    sun.data.energy = 3.0
    sun.data.angle = math.radians(8)
    sun.rotation_euler = (math.radians(50), math.radians(10), math.radians(-35))
    scene.collection.objects.link(sun)
    fill = bpy.data.objects.new("Fill", bpy.data.lights.new("Fill", "AREA"))
    fill.data.energy = 90
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
    g.data.materials.append(material("GroundM", "b5cc98", rough=1.0))
    scene.collection.objects.link(g)

    cam = bpy.data.objects.new("Cam", bpy.data.cameras.new("Cam"))
    cam.data.lens = 70
    scene.collection.objects.link(cam)
    scene.camera = cam
    out = os.path.join(HERE, "previews")
    os.makedirs(out, exist_ok=True)
    views = {
        "34": ((-2.3, -3.4, 1.5), (0, -0.05, 0.55)),
        "front": ((0, -4.2, 0.9), (0, -0.1, 0.58)),
        "side": ((4.2, -0.2, 0.8), (0, 0, 0.55)),
        "back": ((-2.4, 3.6, 1.9), (0, 0, 0.55)),
    }
    only = os.environ.get("VIEWS")
    for name, (loc, target) in views.items():
        if only and name not in only.split(","):
            continue
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
    tidy()
    os.makedirs(os.path.join(HERE, "export"), exist_ok=True)
    render_previews(scene)
    bpy.ops.export_scene.gltf(filepath=os.path.join(HERE, "export", "khina.glb"), export_format="GLB")
    bpy.context.preferences.filepaths.save_version = 0  # no .blend1 backups
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(HERE, "khina.blend"))
    tris = sum(len(p.vertices) - 2 for ob in bpy.data.objects if ob.type == "MESH" for p in ob.data.polygons)
    print("KHINA-DONE", scene.render.engine, "triangles", tris)


main()
