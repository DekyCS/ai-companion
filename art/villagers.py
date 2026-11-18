# Builds Khina's neighbours in Blender, renders a preview line-up, exports one .glb for the browser.
# Run: /Applications/Blender.app/Contents/MacOS/Blender --background --python art/villagers.py
# Outputs: art/villagers.blend (editable), art/export/villagers.glb, art/previews/villagers-*.png
#
# Needle-felted toys like Khina and the visitor bunny: soft egg bodies, big glossy eyes, felt colours.
#   Bramwell   the badger baker: grey coat, striped face, white apron and baker's hat, a loaf
#   Old Wren   the tortoise who keeps the vegetable patch: plated shell, straw hat, little spectacles
#   Tansy      the postmouse: big round ears, blue cap, a satchel on a strap, a letter in her paw
#   Pip, Nettle  two squirrel kids with bushy tails (Nettle wears a scarf, Pip holds an acorn)
#   the voles  a vole family from the mill: one grown-up, two little ones
#   traveller  a fox off the train, with a huge rucksack and a walking stick
#
# Every villager faces -Y (three.js +Z), like Khina, and sits on the ground at its root.
# Root objects are named Villager.<id> (bramwell, wren, tansy, kids, voles, traveller). Each animal
# under a root has a body pivot "<Name>.Body" and, inside it, a head pivot "<Name>.Head", so the
# browser can breathe and turn heads without a skeleton. Materials starting with "Fur" get felt fuzz.

import math
import os

import bmesh
import bpy
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))


# ---------- helpers (as in visitor.py) ----------
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


MATS = {}


def material(name, base, rough=0.85, vertex_colors=False, sheen=0.0, emission=0.0, coat=0.0):
    if name in MATS:
        return MATS[name]
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
    MATS[name] = m
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


def ellipsoid(name, center, radii, mat, parent=None, segments=24, rings=14, rotate=None, warp=None):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=segments, v_segments=rings, radius=1.0)
    m = Matrix.Diagonal((*radii, 1.0))
    if rotate is not None:
        m = rotate @ m
    bmesh.ops.transform(bm, matrix=Matrix.Translation(Vector(center)) @ m, verts=bm.verts)
    if warp is not None:
        for v in bm.verts:
            v.co = warp(v.co)
    return obj_from_bmesh(name, bm, mat, parent)


def box(name, center, size, mat, parent=None, rotate=None):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    m = Matrix.Diagonal((*size, 1.0))
    if rotate is not None:
        m = rotate @ m
    bmesh.ops.transform(bm, matrix=Matrix.Translation(Vector(center)) @ m, verts=bm.verts)
    bmesh.ops.bevel(bm, geom=list(bm.edges), offset=min(size) * 0.25, segments=2, affect="EDGES")
    return obj_from_bmesh(name, bm, mat, parent, smooth_shade=False)


def paint(ob, color_of):
    base = world_of(ob)
    attr = ob.data.color_attributes.new("Col", "FLOAT_COLOR", "POINT")
    for i, v in enumerate(ob.data.vertices):
        attr.data[i].color = color_of(base + v.co)


def empty(name, world_location, parent=None):
    e = bpy.data.objects.new(name, None)
    e.empty_display_size = 0.06
    bpy.context.collection.objects.link(e)
    if parent is not None:
        e.parent = parent
        e.location = Vector(world_location) - world_of(parent)
    else:
        e.location = world_location
    return e


def facing(direction):
    return Vector(direction).to_track_quat("Z", "Y").to_matrix().to_4x4()


def tube(name, points, radius, mat, parent, sides=8, radii=None, closed=False):
    """A round tube through points; radii (one per point) make it fat in places (a bushy tail)."""
    pts = [Vector(p) for p in points]
    bm = bmesh.new()
    rings = []
    n = len(pts)
    for i, p in enumerate(pts):
        if closed:
            a, b = pts[(i - 1) % n], pts[(i + 1) % n]
        else:
            a, b = pts[max(0, i - 1)], pts[min(n - 1, i + 1)]
        d = (b - a).normalized()
        u = d.orthogonal().normalized()
        v = d.cross(u)
        r = radii[i] if radii else radius * (0.55 if not closed and i in (0, n - 1) else 1.0)
        rings.append([bm.verts.new(p + (u * math.cos(2 * math.pi * k / sides) + v * math.sin(2 * math.pi * k / sides)) * r) for k in range(sides)])
    pairs = list(zip(rings, rings[1:] + ([rings[0]] if closed else [])))
    for r0, r1 in pairs:
        # Keep the rings lined up (the side vector can flip between rings).
        best = min(range(sides), key=lambda s: sum((r0[k].co - r1[(k + s) % sides].co).length for k in range(sides)))
        for k in range(sides):
            k2 = (k + 1) % sides
            bm.faces.new((r0[k], r0[k2], r1[(k2 + best) % sides], r1[(k + best) % sides]))
    if not closed:
        for ring, flip in ((rings[0], True), (rings[-1], False)):
            bm.faces.new(list(reversed(ring)) if flip else ring)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return obj_from_bmesh(name, bm, mat, parent)


def surface(c, r, d, out=0.0):
    """The point on an ellipsoid (centre c, radii r) in direction d, pushed out by `out`."""
    d = Vector(d).normalized()
    q = Vector((d.x / r[0], d.y / r[1], d.z / r[2]))
    return Vector(c) + d * (1.0 / q.length + out)


def ring_on(c, r, tilt, out, n=20):
    """Points round an ellipsoid on a tilted loop (a strap, a scarf)."""
    pts = []
    for k in range(n):
        a = 2 * math.pi * k / n
        d = Vector((math.cos(a), math.sin(a), math.cos(a) * math.tan(tilt)))
        pts.append(surface(c, r, d, out))
    return pts


# ---------- shared parts ----------
def eye_mats():
    return (
        material("Eye", "1c120d", rough=0.05, vertex_colors=True, coat=1.0),
        material("Shine", "ffffff", rough=0.2, emission=2.0),
    )


def add_eyes(prefix, head_c, head_r, pivot, spread=0.5, lift=0.0, size=0.05, iris="4b2a17"):
    eye_m, shine_m = eye_mats()
    for side, sx in (("L", 1), ("R", -1)):
        d = Vector((spread * sx, -0.85, lift)).normalized()
        c = surface(head_c, head_r, d, -size * 0.45)
        eye = ellipsoid(f"{prefix}.Eye.{side}", c, (size, size * 1.1, size * 0.72), eye_m, pivot, segments=20, rings=12, rotate=facing(d))

        def eye_color(p, d=d, c=c):
            k = (p - c).normalized().dot(d)
            if k > 0.9:
                return srgb("0d0806")
            return mix(srgb("1c120d"), srgb(iris), smooth(0.45, 0.8, k) * (1 - smooth(0.84, 0.9, k)))

        paint(eye, eye_color)
        up = Vector((0, 0, 1))
        side_v = d.cross(up).normalized()
        front = c + d * size * 0.68
        ellipsoid(f"{prefix}.Shine.{side}", front + up * size * 0.38 + side_v * (size * 0.28 * sx), (size * 0.24,) * 3, shine_m, pivot, segments=8, rings=6)


def add_mouth(prefix, at, width, pivot):
    m = material("Mouth", "3a2a21", rough=0.8)
    for side, sx in (("L", 1), ("R", -1)):
        pts = []
        for k in range(5):
            t = k / 4
            a = math.pi * (1.1 + 0.7 * t)
            pts.append(Vector(at) + Vector((sx * (width * 0.5 + width * 0.5 * math.cos(a)), -0.004 * math.sin(math.pi * t), 0.6 * width * math.sin(a))))
        tube(f"{prefix}.Mouth.{side}", pts, 0.0042, m, pivot, sides=6)


# ---------- an upright animal (badger, mouse, squirrel, fox) ----------
def upright(prefix, P):
    """P: dims and colours. Builds at the origin; returns the animal's root empty."""
    k = P.get("scale", 1.0)
    root = empty(prefix, (0, 0, 0))
    body_c = Vector(P["body_c"]) * k
    body_r = Vector(P["body_r"]) * k
    head_c = Vector(P["head_c"]) * k
    head_r = Vector(P["head_r"]) * k
    neck = Vector((0, head_c.y * 0.6, head_c.z - head_r.z * 0.75))
    body_pivot = empty(f"{prefix}.Body", body_c, root)
    head_pivot = empty(f"{prefix}.Head", neck, body_pivot)

    fur = material(f"Fur.{P['coat_name']}", P["coat"], rough=0.9, vertex_colors=True, sheen=0.5)
    coat, belly = srgb(P["coat"]), srgb(P["belly"])
    dark = srgb(P.get("dark", P["coat"]))

    def body_color(p):
        q = Vector(((p.x - body_c.x) / body_r.x, (p.y - body_c.y) / body_r.y, (p.z - body_c.z) / body_r.z))
        c = mix(coat, dark, P.get("back_dark", 0.0) * smooth(-0.1, 0.8, q.y))
        c = mix(c, coat, 0.15 * smooth(-0.3, 0.3, noise(p * 3)))
        return mix(c, belly, smooth(-0.2, -0.65, q.y) * smooth(0.75, 0.2, q.z))

    def body_warp(co):
        dz = (co.z - body_c.z) / body_r.z
        s = 1 + 0.12 * smooth(0.3, -0.7, dz)
        return Vector((co.x * s, body_c.y + (co.y - body_c.y) * s, max(co.z, 0.01 * k)))

    b = ellipsoid(f"{prefix}.Torso", body_c, body_r, fur, body_pivot, warp=body_warp)
    paint(b, body_color)

    def head_color(p):
        d = (p - head_c).normalized()
        c = coat
        c = mix(c, belly, smooth(-0.55, -0.95, d.y) * smooth(0.3, -0.2, d.z) + smooth(-0.3, -0.8, d.z))
        if P.get("badger"):
            # White face, two black stripes from the snout through the eyes, back over the ears.
            stripe = smooth(0.17, 0.1, abs(abs(d.x) - 0.4)) * smooth(-0.6, -0.3, d.z) * smooth(0.8, 0.45, d.y)
            c = mix(srgb("faf6ef"), srgb("2a2522"), stripe)
            c = mix(c, coat, smooth(0.45, 0.85, d.y) * (1 - stripe) + smooth(-0.35, -0.7, d.z) * 0.5)
        return c

    def head_warp(co):
        dz = (co.z - head_c.z) / head_r.z
        s = 1 + 0.1 * smooth(0.3, -0.6, dz)
        return Vector((co.x * s, co.y, co.z))

    hs = P.get("head_seg", (24, 14))
    h = ellipsoid(f"{prefix}.Skull", head_c, head_r, fur, head_pivot, segments=hs[0], rings=hs[1], warp=head_warp)
    paint(h, head_color)

    # Snout and nose.
    sn_c = surface(head_c, head_r, Vector((0, -1, P.get("snout_lift", -0.25))), -P["snout"][1] * k * 0.55)
    sn_r = Vector(P["snout"]) * k
    sn = ellipsoid(f"{prefix}.Snout", sn_c, sn_r, fur, head_pivot, segments=18, rings=10, rotate=Matrix.Rotation(math.radians(P.get("snout_tilt", 8)), 4, "X"))

    def snout_color(p):
        if P.get("badger"):
            # White on top, the black stripes running down its sides to the nose.
            return mix(srgb("faf6ef"), srgb("2a2522"), smooth(0.45, 0.8, abs(p.x - sn_c.x) / sn_r.x) * smooth(-0.6, 0.2, (p.z - sn_c.z) / sn_r.z))
        return mix(belly, coat, P.get("snout_coat", 0.0))

    paint(sn, snout_color)
    nose_m = material(f"Nose.{P.get('nose_name', 'Dark')}", P.get("nose", "2a1d17"), rough=0.45)
    tip = surface(sn_c, sn_r, Vector((0, -1, 0.15)), -0.008 * k)
    ellipsoid(f"{prefix}.Nose", tip, Vector(P.get("nose_r", (0.035, 0.025, 0.026))) * k, nose_m, head_pivot, segments=14, rings=8)
    add_mouth(prefix, surface(sn_c, sn_r, Vector((0, -0.8, -0.6)), 0.002), 0.03 * k, head_pivot)

    add_eyes(prefix, head_c, head_r, head_pivot, spread=P.get("eye_spread", 0.5), lift=P.get("eye_lift", 0.05), size=P.get("eye", 0.05) * k)

    # Cheeks.
    blush = material("Felt.Blush", "eba69a", rough=0.9)
    if P.get("blush", True):
        for side, sx in (("L", 1), ("R", -1)):
            c = surface(head_c, head_r, Vector((0.66 * sx, -0.66, -0.3)), -0.012 * k)
            ellipsoid(f"{prefix}.Cheek.{side}", c, (0.035 * k, 0.012 * k, 0.025 * k), blush, head_pivot, segments=10, rings=6, rotate=facing(Vector((0.66 * sx, -0.66, -0.3))))

    # Ears.
    ear_kind = P["ears"]
    ear_m = material(f"Fur.{P['coat_name']}.Ear", P.get("ear", P["coat"]), rough=0.9, sheen=0.4)
    inner_m = material(f"Fur.Pink.{P['coat_name']}", P.get("ear_inner", "e8b0a8"), rough=0.9, sheen=0.3)
    for side, sx in (("L", 1), ("R", -1)):
        d = Vector((P.get("ear_spread", 0.55) * sx, 0.1, 0.82)).normalized()
        base = surface(head_c, head_r, d, -0.02 * k)
        if ear_kind == "round":
            er = Vector(P.get("ear_r", (0.06, 0.03, 0.06))) * k
            c = base + Vector((0, 0, er.z * 0.6))
            rot = Matrix.Rotation(math.radians(-18) * sx, 4, "Y")
            ellipsoid(f"{prefix}.Ear.{side}", c, er, ear_m, head_pivot, segments=16, rings=10, rotate=rot)
            ellipsoid(f"{prefix}.EarIn.{side}", c + Vector((0, -er.y * 0.6, -er.z * 0.08)), (er.x * 0.7, er.y * 0.4, er.z * 0.7), inner_m, head_pivot, segments=14, rings=8, rotate=rot)
        else:  # pointed (fox, squirrel tufts)
            ln = P.get("ear_len", 0.12) * k
            rot = Matrix.Rotation(math.radians(14) * sx, 4, "Y") @ Matrix.Rotation(math.radians(-6), 4, "X")
            c = base + rot.to_3x3() @ Vector((0, 0, ln * 0.45))

            def ear_warp(co, c=c, rot=rot):
                local = rot.to_3x3().transposed() @ (co - c)
                t = local.z / (ln * 0.5)
                local.x *= max(0.15, 1.0 - 0.75 * smooth(-0.6, 1.0, t))
                return c + rot.to_3x3() @ local

            ear = ellipsoid(f"{prefix}.Ear.{side}", c, (ln * 0.42, ln * 0.18, ln * 0.5), fur, head_pivot, segments=16, rings=12, rotate=rot, warp=ear_warp)
            tipc = srgb(P.get("ear_tip", P.get("dark", P["coat"])))
            paint(ear, lambda p, base=base: mix(coat, tipc, smooth(0.55, 0.95, (p - base).length / ln)))
            ellipsoid(f"{prefix}.EarIn.{side}", c + rot.to_3x3() @ Vector((0, -ln * 0.1, -ln * 0.06)), (ln * 0.24, ln * 0.06, ln * 0.33), inner_m, head_pivot, segments=12, rings=8, rotate=rot)

    # Arms (little paws in front) and feet.
    limb_m = material(f"Fur.{P['coat_name']}.Limb", P.get("limb", P["coat"]), rough=0.9, sheen=0.4)
    arm_z = body_c.z + body_r.z * 0.25
    for side, sx in (("L", 1), ("R", -1)):
        sh = Vector((body_r.x * 0.82 * sx, body_c.y - body_r.y * 0.25, arm_z))
        hand = Vector((body_r.x * 0.5 * sx, body_c.y - body_r.y * 0.92, body_c.z - body_r.z * 0.05))
        mid = (sh + hand) / 2 + Vector((0.02 * sx * k, 0, 0))
        ellipsoid(f"{prefix}.Arm.{side}", mid, ((sh - hand).length * 0.18 + 0.02 * k, (sh - hand).length * 0.2 + 0.02 * k, (sh - hand).length * 0.55), limb_m, body_pivot, segments=14, rings=8, rotate=facing(sh - hand))
        foot_c = Vector((body_r.x * 0.48 * sx, body_c.y - body_r.y * 0.55, 0.035 * k))
        foot_m = material(f"Fur.{P['coat_name']}.Feet", P["feet"], rough=0.9, sheen=0.4) if P.get("feet") else limb_m
        ellipsoid(f"{prefix}.Foot.{side}", foot_c, (0.07 * k, 0.11 * k, 0.04 * k), foot_m, root, segments=14, rings=8)

    # Tail.
    tail = P.get("tail")
    if tail == "thin":
        tm = material("Felt.MouseTail", "e3a39b", rough=0.8)
        pts = [Vector((0, body_c.y + body_r.y * 0.85, 0.06 * k))]
        for i in range(1, 9):
            t = i / 8
            pts.append(Vector((0.12 * k * math.sin(t * 3.0), body_c.y + body_r.y * 0.85 + 0.3 * k * t, 0.04 * k + 0.22 * k * t * t)))
        tube(f"{prefix}.Tail", pts, 0.016 * k, tm, body_pivot, sides=6)
    elif tail in ("bushy", "fox"):
        tail_m = material(f"Fur.{P['coat_name']}.Tail", P["coat"], rough=0.9, vertex_colors=True, sheen=0.5)
        y0 = body_c.y + body_r.y * 0.8
        if tail == "bushy":
            ctrl = [(0, y0, 0.08), (0, y0 + 0.12, 0.22), (0, y0 + 0.16, 0.42), (0, y0 + 0.1, 0.6), (0, y0 + 0.0, 0.68), (0, y0 - 0.06, 0.66)]
            rads = [0.05, 0.1, 0.13, 0.13, 0.1, 0.05]
        else:
            ctrl = [(0, y0 - 0.02, 0.2), (0.06, y0 + 0.12, 0.12), (0.16, y0 + 0.26, 0.08), (0.26, y0 + 0.34, 0.08), (0.34, y0 + 0.38, 0.1)]
            rads = [0.05, 0.1, 0.12, 0.1, 0.04]
        pts = [Vector(c) * k for c in ctrl]
        tl = tube(f"{prefix}.Tail", pts, 0.1, tail_m, body_pivot, sides=12, radii=[r * k for r in rads])
        tip_c = srgb(P.get("tail_tip", P["coat"]))
        end = pts[-1]
        paint(tl, lambda p, end=end: mix(mix(coat, dark, 0.25 * smooth(-0.3, 0.3, noise(p * 4))), tip_c, smooth(0.16 * k, 0.04 * k, (p - end).length)))
    return root, body_pivot, head_pivot, (body_c, body_r, head_c, head_r)


# ---------- the villagers ----------
def bramwell():
    root, body, head, (bc, br, hc, hr) = upright(
        "Bramwell",
        dict(
            coat_name="Badger", coat="7a766f", belly="8f8a83", dark="55514c", back_dark=0.5, badger=True, head_seg=(48, 28),
            body_c=(0, 0.02, 0.44), body_r=(0.32, 0.29, 0.42), head_c=(0, -0.08, 0.98), head_r=(0.25, 0.24, 0.22),
            snout=(0.095, 0.15, 0.085), snout_lift=-0.3, snout_coat=0.0, ears="round", ear_r=(0.065, 0.03, 0.055), ear="2e2a27", ear_inner="faf6ef",
            ear_spread=0.75, eye=0.042, eye_spread=0.42, limb="3b3633", nose="1d1715", nose_r=(0.045, 0.032, 0.032), blush=False,
        ),
    )
    cloth = material("Cloth.Apron", "f6f0e4", rough=0.95, sheen=0.2)
    # Apron over the front, with straps round the neck and waist.
    ellipsoid("Bramwell.Apron", (0, bc.y - br.y * 0.72, 0.39), (br.x * 0.8, 0.1, br.z * 0.66), cloth, body, segments=24, rings=14)
    tube("Bramwell.ApronTie", ring_on(bc, br * 1.03, 0.0, 0.014, 24), 0.014, cloth, body, sides=6, closed=True)
    # Baker's hat.
    hat = material("Cloth.Hat", "fbf8f2", rough=0.95, sheen=0.2)
    top = hc.z + hr.z
    ellipsoid("Bramwell.HatBand", (0, hc.y + 0.02, top - 0.01), (0.17, 0.165, 0.06), hat, head, segments=24, rings=10)
    ellipsoid("Bramwell.HatPuff", (0, hc.y + 0.02, top + 0.11), (0.21, 0.2, 0.12), hat, head, segments=24, rings=12,
              warp=lambda co: co + Vector((0, 0, 0.02 * math.sin(math.atan2(co.y - hc.y, co.x) * 5))))
    # A loaf in the paws.
    bread = material("Felt.Bread", "c88a44", rough=0.9, sheen=0.3)
    bread = material("Felt.Bread", "c88a44", rough=0.9, sheen=0.3, vertex_colors=True)
    a = Vector((0.24, bc.y - br.y * 0.95, bc.z - 0.16))
    b = Vector((-0.1, bc.y - br.y * 1.02, bc.z + 0.2))
    loaf = tube("Bramwell.Baguette", [a.lerp(b, t) for t in (0, 0.25, 0.5, 0.75, 1)], 0.05, bread, body, sides=10, radii=[0.03, 0.048, 0.05, 0.048, 0.03])
    paint(loaf, lambda p: mix(srgb("b8742f"), srgb("efcf92"), smooth(0.8, 0.97, math.sin((p - a).dot((b - a).normalized()) * 28))))
    return root


def wren():
    root = empty("Wren", (0, 0, 0))
    shell_c, shell_r = Vector((0, 0.06, 0.16)), Vector((0.36, 0.43, 0.3))
    body = empty("Wren.Body", shell_c, root)
    shell_m = material("Felt.Shell", "8a7a45", rough=0.9, vertex_colors=True)  # no fuzz: it hides the plates

    def shell_color(p):
        # Scutes: one on top, a ring of six round it, twelve small ones round the rim; each light in
        # the middle, darker toward its edge, with dark seams between.
        q = Vector(((p.x - shell_c.x) / shell_r.x, (p.y - shell_c.y) / shell_r.y, (p.z - shell_c.z) / shell_r.z))
        el = math.atan2(q.z, math.hypot(q.x, q.y))
        az = (math.atan2(q.y, q.x) + math.pi) / (2 * math.pi)
        if el > 1.05:
            e = (math.pi / 2 - el) / (math.pi / 2 - 1.05)
            e = min(e, 1 - e) * 0.9 + 0.1
        elif el > 0.42:
            n = 6
            f = (az * n + 0.5) % 1.0
            g = (el - 0.42) / (1.05 - 0.42)
            e = min(f, 1 - f, g, 1 - g)
        else:
            n = 12
            f = (az * n) % 1.0
            g = (el - (-0.25)) / (0.42 + 0.25)
            e = min(f, 1 - f, max(0.0, g) if g < 1 else 1 - g, 1 - g)
        plate = mix(srgb("54401d"), srgb("8a6d34"), smooth(0.05, 0.45, e))
        plate = mix(plate, srgb("a3874a"), smooth(0.3, 0.5, e) * 0.6)
        return mix(srgb("2e2416"), plate, smooth(0.0, 0.07, e))

    s = ellipsoid("Wren.Shell", shell_c, shell_r, shell_m, body, segments=28, rings=16,
                  warp=lambda co: Vector((co.x, co.y, max(co.z, 0.1))))
    paint(s, shell_color)
    skin = material("Fur.Tortoise", "9ea27a", rough=0.9, vertex_colors=True, sheen=0.3)
    belly = material("Felt.Plastron", "dccb94", rough=0.95)
    ellipsoid("Wren.Plastron", (0, 0.06, 0.1), (0.34, 0.41, 0.05), belly, body, segments=24, rings=8)
    neck = Vector((0, -0.3, 0.18))
    head = empty("Wren.Head", neck, body)
    hc, hr = Vector((0, -0.5, 0.33)), Vector((0.12, 0.14, 0.11))
    tube("Wren.Neck", [neck + Vector((0, 0.05, -0.02)), Vector((0, -0.4, 0.24)), hc + Vector((0, 0.06, -0.04))], 0.075, skin, head, sides=10)
    h = ellipsoid("Wren.Skull", hc, hr, skin, head, segments=20, rings=12)
    for ob in list(head.children):
        if ob.type == "MESH" and ob.data.materials[0] == skin and "Col" not in ob.data.color_attributes:
            paint(ob, lambda p: mix(srgb("a3a77f"), srgb("d9d2a6"), smooth(-0.02, -0.08, p.z - hc.z) * smooth(-0.4, -0.55, p.y)))
    add_eyes("Wren", hc, hr, head, spread=0.55, lift=0.12, size=0.032)
    add_mouth("Wren", surface(hc, hr, Vector((0, -1, -0.35)), 0.001), 0.04, head)
    # Little round spectacles.
    gold = material("Metal.Spectacles", "c9a24a", rough=0.3)
    for side, sx in (("L", 1), ("R", -1)):
        d = Vector((0.55 * sx, -0.85, 0.12)).normalized()
        c = surface(hc, hr, d, 0.012)
        u = d.cross(Vector((0, 0, 1))).normalized()
        v = u.cross(d).normalized()
        tube(f"Wren.Lens.{side}", [c + (u * math.cos(a) + v * math.sin(a)) * 0.038 for a in [2 * math.pi * i / 14 for i in range(14)]], 0.004, gold, head, sides=5, closed=True)
    tube("Wren.Bridge", [surface(hc, hr, Vector((0.2, -1, 0.15)), 0.014), surface(hc, hr, Vector((0, -1, 0.18)), 0.02), surface(hc, hr, Vector((-0.2, -1, 0.15)), 0.014)], 0.004, gold, head, sides=5)
    # Straw sun hat with a red band.
    straw = material("Felt.Straw", "e2c67a", rough=0.95)
    ribbon = material("Felt.Ribbon", "c8473d", rough=0.9)
    top = hc.z + hr.z
    ellipsoid("Wren.Brim", (0, hc.y + 0.01, top - 0.025), (0.22, 0.22, 0.014), straw, head, segments=28, rings=8)
    ellipsoid("Wren.Crown", (0, hc.y + 0.01, top + 0.02), (0.1, 0.1, 0.06), straw, head, segments=20, rings=10, warp=lambda co: Vector((co.x, co.y, max(co.z, top - 0.02))))
    ellipsoid("Wren.Band", (0, hc.y + 0.01, top + 0.0), (0.104, 0.104, 0.022), ribbon, head, segments=20, rings=6)
    # Stubby legs and a little tail.
    for name, x, y in (("FL", 0.26, -0.24), ("FR", -0.26, -0.24), ("BL", 0.26, 0.32), ("BR", -0.26, 0.32)):
        leg = ellipsoid(f"Wren.Leg.{name}", (x, y, 0.07), (0.09, 0.1, 0.075), skin, root, segments=14, rings=8)
        paint(leg, lambda p: srgb("8f936b"))
    t = ellipsoid("Wren.Tail", (0, 0.5, 0.1), (0.04, 0.08, 0.04), skin, body, segments=10, rings=6)
    paint(t, lambda p: srgb("8f936b"))
    return root


def tansy():
    root, body, head, (bc, br, hc, hr) = upright(
        "Tansy",
        dict(
            scale=0.85, coat_name="Mouse", coat="b99a7c", belly="f1e6d4", dark="9b7d60", back_dark=0.3,
            body_c=(0, 0.02, 0.22), body_r=(0.16, 0.15, 0.22), head_c=(0, -0.05, 0.52), head_r=(0.15, 0.14, 0.135),
            snout=(0.055, 0.085, 0.05), snout_lift=-0.15, snout_coat=0.4, ears="round", ear_r=(0.105, 0.025, 0.1), ear_spread=0.78,
            ear_inner="eeaaa2", eye=0.034, eye_spread=0.5, eye_lift=0.08, nose="e48f93", nose_name="Pink", nose_r=(0.022, 0.018, 0.018),
            tail="thin", limb="d9bba0",
        ),
    )
    # Whiskers.
    wm = material("Felt.Whisker", "5a463a", rough=0.6)
    sn = surface(hc, hr, Vector((0, -1, -0.15)), 0.03)
    for side, sx in (("L", 1), ("R", -1)):
        for i, dz in enumerate((0.012, -0.004, -0.02)):
            a = sn + Vector((0.02 * sx, 0.0, dz))
            tube(f"Tansy.Whisker.{side}{i}", [a, a + Vector((0.07 * sx, 0.01, dz * 0.8)), a + Vector((0.13 * sx, 0.03, dz * 2.0))], 0.0025, wm, head, sides=4)
    # Blue postal cap with a peak.
    cap = material("Felt.Cap", "3f5f8a", rough=0.9, sheen=0.2)
    top = hc.z + hr.z
    ellipsoid("Tansy.Cap", (0, hc.y, top - 0.02), (0.11, 0.105, 0.055), cap, head, segments=20, rings=10, warp=lambda co: Vector((co.x, co.y, max(co.z, top - 0.045))))
    ellipsoid("Tansy.Peak", (0, hc.y - 0.1, top - 0.04), (0.075, 0.05, 0.01), cap, head, segments=16, rings=6)
    # Satchel on a strap over the shoulder, and a letter in her paws.
    leather = material("Felt.Satchel", "8b5a34", rough=0.9)
    tube("Tansy.Strap", ring_on(bc + Vector((0, 0, 0.02)), br, math.radians(38), 0.03, 22), 0.011, leather, body, sides=6, closed=True)
    box("Tansy.Bag", (-br.x * 0.95, bc.y + 0.01, bc.z - 0.06), (0.06, 0.15, 0.12), leather, body)
    box("Tansy.Flap", (-br.x * 1.0 - 0.012, bc.y + 0.01, bc.z - 0.02), (0.03, 0.155, 0.07), material("Felt.SatchelFlap", "a26d42", rough=0.9), body)
    paper = material("Felt.Letter", "fbf6ea", rough=0.95)
    box("Tansy.Letter", (0.0, bc.y - br.y * 1.05, bc.z - 0.02), (0.11, 0.012, 0.075), paper, body, rotate=Matrix.Rotation(math.radians(-12), 4, "Y"))
    seal = material("Felt.Seal", "c8473d", rough=0.7)
    ellipsoid("Tansy.Seal", (0.0, bc.y - br.y * 1.05 - 0.008, bc.z - 0.02), (0.012, 0.004, 0.012), seal, body, segments=10, rings=6)
    return root


def squirrel(prefix, coat, dark, scarf=False, acorn=False):
    root, body, head, (bc, br, hc, hr) = upright(
        prefix,
        dict(
            scale=0.9, coat_name=prefix, coat=coat, belly="f2e3cc", dark=dark, back_dark=0.4,
            body_c=(0, 0.02, 0.19), body_r=(0.14, 0.13, 0.19), head_c=(0, -0.04, 0.45), head_r=(0.15, 0.14, 0.135),
            snout=(0.05, 0.06, 0.045), snout_lift=-0.3, snout_coat=0.0, ears="pointed", ear_len=0.11, ear_spread=0.6, ear_tip=dark,
            eye=0.042, eye_spread=0.48, eye_lift=0.06, nose="4a2e22", nose_r=(0.02, 0.015, 0.015), tail="bushy", tail_tip=dark,
        ),
    )
    if scarf:
        wool = material("Felt.Scarf", "6f9a52", rough=0.95, sheen=0.3)
        neck_c = Vector((0, -0.02, hc.z - hr.z * 0.95))
        tube(f"{prefix}.Scarf", ring_on(neck_c, (0.12, 0.115, 0.05), 0.0, 0.0, 18), 0.028, wool, head, sides=8, closed=True)
        tube(f"{prefix}.ScarfEnd", [neck_c + Vector((0.07, -0.09, 0)), neck_c + Vector((0.09, -0.12, -0.08)), neck_c + Vector((0.1, -0.12, -0.15))], 0.024, wool, head, sides=8)
    if acorn:
        nut = material("Felt.Acorn", "b7834a", rough=0.85)
        cup = material("Felt.AcornCup", "6f5236", rough=0.95)
        a = Vector((0, bc.y - br.y * 1.05, bc.z + 0.0))
        ellipsoid(f"{prefix}.Acorn", a, (0.035, 0.035, 0.045), nut, body, segments=12, rings=8)
        ellipsoid(f"{prefix}.AcornCup", a + Vector((0, 0, 0.03)), (0.04, 0.04, 0.022), cup, body, segments=12, rings=6)
    return root


def kids():
    root = empty("Villager.kids", (0, 0, 0))
    pip = squirrel("Pip", "c9662f", "8a3f1c", acorn=True)
    nettle = squirrel("Nettle", "a8673f", "6e4026", scarf=True)
    for ob, x, yaw in ((pip, -0.3, 50), (nettle, 0.3, -50)):  # turned toward each other
        ob.parent = root
        ob.location = (x, 0, 0)
        ob.rotation_euler = (0, 0, math.radians(yaw))
    return root


def vole(prefix, k):
    root = empty(prefix, (0, 0, 0))
    bc, br = Vector((0, 0.03, 0.11)) * k, Vector((0.13, 0.16, 0.11)) * k
    body = empty(f"{prefix}.Body", bc, root)
    fur = material("Fur.Vole", "7d5b41", rough=0.9, vertex_colors=True, sheen=0.5)
    b = ellipsoid(f"{prefix}.Torso", bc, br, fur, body, segments=20, rings=12, warp=lambda co: Vector((co.x, co.y, max(co.z, 0.008))))
    paint(b, lambda p: mix(srgb("7d5b41"), srgb("cbb08f"), smooth(-0.3, -0.85, (p.z - bc.z) / br.z) + 0.6 * smooth(-0.5, -0.95, (p.y - bc.y) / br.y)))
    hc, hr = Vector((0, -0.12, 0.13)) * k, Vector((0.09, 0.085, 0.08)) * k
    head = empty(f"{prefix}.Head", Vector((0, -0.06, 0.12)) * k, body)
    h = ellipsoid(f"{prefix}.Skull", hc, hr, fur, head, segments=18, rings=12)
    paint(h, lambda p: mix(srgb("84624a"), srgb("d8c09e"), smooth(-0.3, -0.9, (p - hc).normalized().z)))
    pink = material("Nose.Pink", "e48f93", rough=0.45)
    ellipsoid(f"{prefix}.Nose", surface(hc, hr, Vector((0, -1, -0.1)), 0.004 * k), (0.016 * k, 0.012 * k, 0.012 * k), pink, head, segments=10, rings=6)
    add_eyes(prefix, hc, hr, head, spread=0.55, lift=0.12, size=0.026 * k)
    ear_m = material("Fur.Vole.Ear", "6a4c36", rough=0.9)
    for side, sx in (("L", 1), ("R", -1)):
        c = surface(hc, hr, Vector((0.6 * sx, 0.1, 0.8)), 0.0)
        ellipsoid(f"{prefix}.Ear.{side}", c, (0.032 * k, 0.014 * k, 0.03 * k), ear_m, head, segments=10, rings=6)
    feet = material("Felt.VoleFeet", "d99b92", rough=0.9)
    for side, sx in (("L", 1), ("R", -1)):
        ellipsoid(f"{prefix}.Foot.{side}", (0.07 * k * sx, -0.08 * k, 0.012 * k), (0.03 * k, 0.04 * k, 0.014 * k), feet, root, segments=10, rings=6)
    return root


def voles():
    root = empty("Villager.voles", (0, 0, 0))
    for name, k, x, y, yaw in (("Vole.Ma", 1.3, 0.0, 0.0, 0), ("Vole.Bit", 0.9, 0.36, 0.12, -25), ("Vole.Bob", 0.8, -0.34, 0.18, 30)):
        v = vole(name, k)
        v.parent = root
        v.location = (x, y, 0)
        v.rotation_euler = (0, 0, math.radians(yaw))
    return root


def traveller():
    root, body, head, (bc, br, hc, hr) = upright(
        "Traveller",
        dict(
            coat_name="Fox", coat="c86b33", belly="f4ece0", dark="7a3a1b", back_dark=0.35,
            body_c=(0, 0.02, 0.4), body_r=(0.26, 0.24, 0.38), head_c=(0, -0.06, 0.9), head_r=(0.21, 0.2, 0.19),
            snout=(0.07, 0.14, 0.06), snout_lift=-0.25, snout_coat=0.0, ears="pointed", ear_len=0.17, ear_spread=0.62, ear_tip="2f1f16",
            eye=0.04, eye_spread=0.5, eye_lift=0.08, nose="1d1715", nose_r=(0.03, 0.022, 0.022), tail="fox", tail_tip="f4ece0", limb="b45a2a", feet="3a2a22",
        ),
    )
    canvas = material("Felt.Rucksack", "6f7a4e", rough=0.95, sheen=0.2)
    strap = material("Felt.Strap", "4a3a2a", rough=0.9)
    roll = material("Felt.Bedroll", "9b4a3c", rough=0.95, sheen=0.2)
    pack_c = Vector((0, bc.y + br.y + 0.13, bc.z + 0.12))
    box("Traveller.Pack", pack_c, (0.42, 0.24, 0.62), canvas, body)
    box("Traveller.Pocket", pack_c + Vector((0, 0.13, -0.12)), (0.28, 0.06, 0.2), material("Felt.Pocket", "5f6a42", rough=0.95), body)
    tube("Traveller.Roll", [pack_c + Vector((x, 0.0, 0.4)) for x in (-0.26, -0.13, 0, 0.13, 0.26)], 0.075, roll, body, sides=12)
    for side, sx in (("L", 1), ("R", -1)):
        over = [surface(bc, br * 1.06, Vector(d), 0.012) for d in ((0.38 * sx, 0.35, 0.9), (0.42 * sx, -0.3, 0.8), (0.5 * sx, -0.75, 0.45), (0.85 * sx, -0.45, 0.2), (0.95 * sx, 0.25, 0.0), (0.7 * sx, 0.7, -0.1))]
        tube(f"Traveller.Strap.{side}", [pack_c + Vector((0.12 * sx, -0.1, 0.27))] + over, 0.016, strap, body, sides=6)
    stick = material("Felt.Stick", "7a5534", rough=0.9)
    tube("Traveller.Stick", [Vector((0.34, -0.2, 0.0)), Vector((0.345, -0.21, 0.5)), Vector((0.35, -0.22, 1.0))], 0.022, stick, root, sides=8)
    # A spotted neckerchief.
    cloth = material("Felt.Neckerchief", "3f6f8f", rough=0.95, sheen=0.2)
    neck_c = Vector((0, hc.y + 0.02, hc.z - hr.z * 0.95))
    tube("Traveller.Neckerchief", ring_on(neck_c, (0.17, 0.16, 0.05), 0.0, 0.0, 20), 0.03, cloth, head, sides=8, closed=True)
    ellipsoid("Traveller.Knot", neck_c + Vector((0, -0.17, -0.05)), (0.06, 0.03, 0.07), cloth, head, segments=12, rings=8)
    return root


# ---------- tidy up: one mesh per pivot and material (fewer draw calls) ----------
def join_parts():
    pivots = [o for o in bpy.data.objects if o.type == "EMPTY"]
    for pv in pivots:
        groups = {}
        for ch in pv.children:
            if ch.type == "MESH":
                groups.setdefault(ch.data.materials[0].name, []).append(ch)
        for name, obs in groups.items():
            if len(obs) < 2:
                continue
            has_col = ["Col" in o.data.color_attributes for o in obs]
            if any(has_col) and not all(has_col):
                continue
            bpy.ops.object.select_all(action="DESELECT")
            for o in obs:
                o.select_set(True)
            bpy.context.view_layer.objects.active = obs[0]
            bpy.ops.object.join()
            obs[0].name = f"{pv.name}.{name}"


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
    scene.render.resolution_x = 1600
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
    fill.data.energy = 300
    fill.data.size = 6
    fill.location = (-3, -6, 3)
    look_at(fill, (0, 0, 0.5))
    scene.collection.objects.link(fill)
    ground = bpy.data.meshes.new("Ground")
    bm = bmesh.new()
    bmesh.ops.create_circle(bm, cap_ends=True, radius=12, segments=48)
    bm.to_mesh(ground)
    bm.free()
    g = bpy.data.objects.new("Ground", ground)
    g.data.materials.append(material("GroundM", "a9c48f", rough=1.0))
    scene.collection.objects.link(g)
    cam = bpy.data.objects.new("Cam", bpy.data.cameras.new("Cam"))
    cam.data.lens = 50
    scene.collection.objects.link(cam)
    scene.camera = cam
    out = os.path.join(HERE, "previews")
    os.makedirs(out, exist_ok=True)
    views = {"lineup": ((0.2, -10.5, 2.6), (0.2, 0, 0.55)), "left": ((-1.9, -4.4, 1.5), (-1.9, 0, 0.62)), "right": ((2.3, -4.4, 1.5), (2.3, 0, 0.62))}
    for name, (loc, target) in views.items():
        cam.location = loc
        look_at(cam, target)
        scene.render.filepath = os.path.join(out, f"villagers-{name}.png")
        bpy.ops.render.render(write_still=True)
    for ob in (sun, fill, g, cam):
        bpy.data.objects.remove(ob)


def main():
    scene = reset()
    roots = []
    # Single animals get a Villager.<id> root around their own root (kids and voles make theirs).
    for vid, make in (("bramwell", bramwell), ("wren", wren), ("tansy", tansy), ("traveller", traveller)):
        r = empty(f"Villager.{vid}", (0, 0, 0))
        a = make()
        a.parent = r
        roots.append(r)
    roots.insert(3, kids())
    roots.insert(4, voles())
    join_parts()
    # Line them up for the preview (the browser places each one itself).
    x = -3.2
    for r, w in zip(roots, (1.0, 1.0, 0.6, 1.0, 0.9, 1.0)):
        r.location.x = x + w / 2
        x += w + 0.25
    render_previews(scene)
    for r in roots:
        r.location = (0, 0, 0)
    os.makedirs(os.path.join(HERE, "export"), exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=os.path.join(HERE, "export", "villagers.glb"), export_format="GLB")
    bpy.context.preferences.filepaths.save_version = 0
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(HERE, "villagers.blend"))
    print("VILLAGERS-DONE", scene.render.engine)


main()
