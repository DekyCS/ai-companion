# Builds the forest village in Blender from art/layout.json, renders previews, exports a .glb
# and the terrain the browser walks on.
# Run: npm run layout, then
#   /Applications/Blender.app/Contents/MacOS/Blender --background --python art/village.py
# Outputs: art/village.blend (editable), art/export/village.glb, art/export/terrain.json,
#          art/previews/village-*.png
#
# Look: a cosy storybook diorama. Organic shapes are smooth and lumpy, buildings have bevelled
# edges, tiled roofs and timber, everything is coloured per vertex (with fake ambient occlusion
# baked into the colours), so the browser needs only a few materials:
#   Village   most things (vertex colours)
#   Foliage   tree crowns, pine tiers and bushes (vertex colours; the browser sways them in the wind)
#   WaterM, GlowM
# Objects the browser changes at runtime are kept separate and named:
#   Glow.burrow, Glow.bakery, Glow.lamp (windows and the lamp, lit at night or when someone is in)
#   Flag.letterbox (origin at its pivot; raised when there is post), Water, Ground, Foliage.
# Coordinates: metres, x east, y north, z up. Fronts face south (-y), toward the default camera.

import json
import math
import os
import random

import bmesh
import bpy
from mathutils import Matrix, Vector, noise

HERE = os.path.dirname(os.path.abspath(__file__))
with open(os.path.join(HERE, "layout.json")) as f:
    L = json.load(f)
RNG = random.Random(11)

PLACES = {k: Vector((v[0], v[1])) for k, v in L["places"].items()}
NODES = {k: Vector((v[0], v[1])) for k, v in L["nodes"].items()}  # where paths meet places
SEGMENTS = [(NODES[a], NODES[b]) for a, b in L["paths"]]
SPOTS = L["spots"]
CENTRE = Vector((12, 6))

COLLIDERS = []  # for terrain.json: what the player cannot walk through


def circle(x, y, r, why=""):
    COLLIDERS.append({"kind": "circle", "x": round(x, 3), "y": round(y, 3), "r": round(r, 3), "_why": why})


def rect(x, y, w, d, rot=0.0, why=""):
    COLLIDERS.append({"kind": "box", "x": round(x, 3), "y": round(y, 3), "w": round(w, 3), "d": round(d, 3), "rot": round(rot, 4), "_why": why})


# ---------- colour ----------
def lin(hex_):
    out = []
    for i in (0, 2, 4):
        c = int(hex_[i : i + 2], 16) / 255
        out.append(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4)
    return Vector(out)


def rgba(v):
    return (min(1.0, max(0.0, v[0])), min(1.0, max(0.0, v[1])), min(1.0, max(0.0, v[2])), 1.0)


def col(hex_, jitter=0.0):
    v = lin(hex_)
    if jitter:
        f = 1 + RNG.uniform(-jitter, jitter)
        v = Vector([c * f * (1 + RNG.uniform(-jitter / 3, jitter / 3)) for c in v])
    return rgba(v)


def mixv(a, b, t):
    t = min(1.0, max(0.0, t))
    return a * (1 - t) + b * t


def smooth(e0, e1, x):
    t = min(1.0, max(0.0, (x - e0) / (e1 - e0)))
    return t * t * (3 - 2 * t)


def wave(x, y):
    """The old smooth sine noise. The height function depends on it, so it must not change."""
    return (math.sin(x * 0.13 + y * 0.07) + math.sin(x * 0.051 - y * 0.113 + 1.3) + 0.6 * math.sin(x * 0.31 + y * 0.27 + 4.1)) / 2.6


def n3(x, y=0.0, z=0.0):
    return noise.noise(Vector((x, y, z)))


def shade_fn(base_hex, jitter=0.08, freq=2.0, amount=0.12):
    """A colour with a little low-frequency mottling, so big surfaces are not flat paint."""
    base = lin(base_hex) * (1 + RNG.uniform(-jitter, jitter))
    seed = RNG.uniform(0, 99)

    def f(co):
        return rgba(base * (1 + amount * n3(co.x * freq + seed, co.y * freq, co.z * freq)))

    return f


# ---------- geometry ----------
def facing(direction):
    d = Vector(direction).normalized()
    up = "X" if abs(d.y) > 0.9 else "Y"
    return d.to_track_quat("Z", up).to_matrix().to_4x4()


def faces_of(verts):
    out = set()
    for v in verts:
        out.update(v.link_faces)
    return out


class Batch:
    """Many primitives in one mesh, each coloured per vertex. Smooth where organic, with edges
    sharper than ~57 degrees split, so bevelled boxes look rounded and caps stay crisp."""

    def __init__(self):
        self.bm = bmesh.new()
        self.col = self.bm.loops.layers.float_color.new("Col")
        self.cn = None  # optional per-vertex custom normals (soft foliage)

    def _finish(self, faces, color, smooth_shade=True):
        for f in faces:
            f.smooth = smooth_shade
            for loop in f.loops:
                loop[self.col] = color(loop.vert.co) if callable(color) else color

    def box_m(self, M, color, bevel=0.0, segs=2):
        res = bmesh.ops.create_cube(self.bm, size=1.0, matrix=M)
        verts = res["verts"]
        faces = faces_of(verts)
        if bevel > 0:
            edges = list({e for v in verts for e in v.link_edges})
            out = bmesh.ops.bevel(self.bm, geom=edges, offset=bevel, segments=segs, profile=0.5, affect="EDGES", clamp_overlap=True)
            faces = {f for f in faces if f.is_valid} | set(out["faces"])
            faces |= faces_of([v for v in out["verts"]])
        self._finish(faces, color, smooth_shade=bevel > 0)

    def box(self, corner, size, color, rz=0.0, centered=False, bevel=0.0, segs=2, rx=0.0, ry=0.0):
        """A box from its lowest corner (or, with centered=True, from the middle of its base)."""
        x, y, z = corner
        if not centered:
            x, y = x + size[0] / 2, y + size[1] / 2
        M = Matrix.Translation((x, y, z + size[2] / 2)) @ Matrix.Rotation(rz, 4, "Z") @ Matrix.Rotation(ry, 4, "Y") @ Matrix.Rotation(rx, 4, "X") @ Matrix.Diagonal((size[0], size[1], size[2], 1.0))
        self.box_m(M, color, bevel, segs)

    def beam(self, p0, p1, w, d, color, bevel=0.0):
        """A square beam from p0 to p1."""
        p0, p1 = Vector(p0), Vector(p1)
        ln = (p1 - p0).length
        M = Matrix.Translation((p0 + p1) / 2) @ facing(p1 - p0) @ Matrix.Diagonal((w, d, ln, 1.0))
        self.box_m(M, color, bevel, 1)

    def lathe(self, base, prof, color, segs=12, direction=(0, 0, 1), rough=0.0, freq=1.5, ridges=0, ridge_amp=0.05, seed=0.0, cap_top=True, cap_bottom=False, cap_color=None, smooth_shade=True, squash=(1.0, 1.0), phase=0.0):
        """A surface of revolution: prof is [(height, radius), ...] along `direction` from `base`."""
        R = Matrix.Translation(base) @ facing(direction)
        rings = []
        for z, r in prof:
            if r < 1e-5:
                rings.append([self.bm.verts.new(R @ Vector((0, 0, z)))])
                continue
            ring = []
            for k in range(segs):
                a = 2 * math.pi * k / segs + phase
                ca, sa = math.cos(a), math.sin(a)
                rr = r
                if rough:
                    rr *= 1 + rough * n3(ca * freq + seed, sa * freq + seed * 0.37, z * freq * 0.7)
                if ridges:
                    rr *= 1 + ridge_amp * math.sin(ridges * a + 1.7 * math.sin(z * 1.1 + seed))
                ring.append(self.bm.verts.new(R @ Vector((ca * rr * squash[0], sa * rr * squash[1], z))))
            rings.append(ring)
        side = []
        for i in range(len(rings) - 1):
            A, B = rings[i], rings[i + 1]
            if len(A) == 1 and len(B) == 1:
                continue
            for k in range(segs):
                k2 = (k + 1) % segs
                if len(A) == 1:
                    side.append(self.bm.faces.new((A[0], B[k2], B[k])))
                elif len(B) == 1:
                    side.append(self.bm.faces.new((A[k], A[k2], B[0])))
                else:
                    side.append(self.bm.faces.new((A[k], A[k2], B[k2], B[k])))
        caps = []
        if cap_top and len(rings[-1]) > 2:
            caps.append(self.bm.faces.new(rings[-1]))
        if cap_bottom and len(rings[0]) > 2:
            caps.append(self.bm.faces.new(list(reversed(rings[0]))))
        self._finish(side, color, smooth_shade)
        self._finish(caps, cap_color or color, smooth_shade)
        return [v for ring in rings for v in ring]

    def cyl(self, base, length, r1, r2, color, segs=12, direction=(0, 0, 1), cap_color=None, rough=0.0, smooth_shade=True):
        self.lathe(base, [(0, r1), (length, r2)], color, segs=segs, direction=direction, cap_bottom=True, cap_color=cap_color, rough=rough, smooth_shade=smooth_shade)

    def tube(self, pts, radii, color, segs=8, cap=True, smooth_shade=True):
        """A tube along a polyline, radius per point (0 makes a point)."""
        pts = [Vector(p) for p in pts]
        n = len(pts)
        rings, nrm = [], None
        for i, p in enumerate(pts):
            t = (pts[min(i + 1, n - 1)] - pts[max(i - 1, 0)]).normalized()
            if nrm is None:
                ref = Vector((0, 0, 1)) if abs(t.z) < 0.9 else Vector((1, 0, 0))
                nrm = t.cross(ref).normalized()
            else:
                nrm = (nrm - t * nrm.dot(t)).normalized()
            bnm = t.cross(nrm)
            r = radii[i] if isinstance(radii, (list, tuple)) else radii
            if r < 1e-5:
                rings.append([self.bm.verts.new(p)])
                continue
            rings.append([self.bm.verts.new(p + (nrm * math.cos(2 * math.pi * k / segs) + bnm * math.sin(2 * math.pi * k / segs)) * r) for k in range(segs)])
        faces = []
        for i in range(n - 1):
            A, B = rings[i], rings[i + 1]
            for k in range(segs):
                k2 = (k + 1) % segs
                if len(A) == 1 and len(B) == 1:
                    break
                if len(A) == 1:
                    faces.append(self.bm.faces.new((A[0], B[k], B[k2])))
                elif len(B) == 1:
                    faces.append(self.bm.faces.new((A[k], A[k2], B[0])))
                else:
                    faces.append(self.bm.faces.new((A[k], A[k2], B[k2], B[k])))
        if cap:
            for ring in (rings[0], rings[-1]):
                if len(ring) > 2:
                    faces.append(self.bm.faces.new(ring))
        self._finish(faces, color, smooth_shade)

    def blob(self, center, r, color, scale=(1, 1, 1), sub=2, amp=0.12, freq=1.4, seed=None, squash_bottom=None, smooth_shade=True, ncenter=None, nmix=0.75):
        """A lumpy smooth sphere: subdivided icosphere pushed in and out by 3D noise.
        With ncenter, its normals lean away from that point (the whole crown's centre), so a
        cluster of blobs shades like one soft round shape."""
        c = Vector(center)
        if ncenter is not None and self.cn is None:
            self.cn = self.bm.verts.layers.float_vector.new("cn")
        if seed is None:
            seed = RNG.uniform(0, 100)
        off = Vector((seed, seed * 0.61, seed * 1.37))
        res = bmesh.ops.create_icosphere(self.bm, subdivisions=sub, radius=1.0, matrix=Matrix.Identity(4))
        for v in res["verts"]:
            d = v.co.normalized()
            k = 1 + amp * noise.noise(d * freq + off)
            p = Vector((d.x * scale[0], d.y * scale[1], d.z * scale[2])) * (r * k)
            if squash_bottom is not None and p.z < -squash_bottom * r:
                p.z = -squash_bottom * r + (p.z + squash_bottom * r) * 0.25
            v.co = c + p
            if ncenter is not None:
                own = Vector((d.x / scale[0], d.y / scale[1], d.z / scale[2])).normalized()
                v[self.cn] = (own * (1 - nmix) + (v.co - Vector(ncenter)).normalized() * nmix).normalized()
        self._finish(faces_of(res["verts"]), color, smooth_shade)

    def flower(self, pos, r, petal_hex, centre_hex="f3c94a", petals=5, up=(0, 0, 1)):
        """A little flat flower head: lobed petals around a raised centre."""
        p = Vector(pos)
        M = Matrix.Translation(p) @ facing(up)
        rot = RNG.uniform(0, math.pi)
        c = self.bm.verts.new(M @ Vector((0, 0, r * 0.25)))
        inner, outer = [], []
        n = petals * 2
        for k in range(n):
            a = rot + 2 * math.pi * k / n
            inner.append(self.bm.verts.new(M @ Vector((math.cos(a) * r * 0.3, math.sin(a) * r * 0.3, r * 0.15))))
            rr = r if k % 2 == 0 else r * 0.5
            outer.append(self.bm.verts.new(M @ Vector((math.cos(a) * rr, math.sin(a) * rr, r * 0.28))))
        mid = [self.bm.faces.new((c, inner[k], inner[(k + 1) % n])) for k in range(n)]
        ring = [self.bm.faces.new((inner[k], outer[k], outer[(k + 1) % n], inner[(k + 1) % n])) for k in range(n)]
        self._finish(mid, col(centre_hex), True)
        pc = lin(petal_hex)
        self._finish(ring, lambda co: rgba(mixv(pc * 0.8, pc * 1.08, (co - p).length / r)), True)

    def to_object(self, name, mat, sharp_angle=1.0):
        bm = self.bm
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        bm.normal_update()
        for e in bm.edges:
            if len(e.link_faces) == 2 and e.calc_face_angle(0.0) > sharp_angle:
                e.smooth = False
        normals = None
        if self.cn is not None:
            normals = [tuple(v[self.cn]) if v[self.cn].length > 0.5 else tuple(v.normal) for v in bm.verts]
            bm.verts.layers.float_vector.remove(self.cn)
        me = bpy.data.meshes.new(name)
        bm.to_mesh(me)
        bm.free()
        if normals:
            me.normals_split_custom_set_from_vertices(normals)
        me.materials.append(mat)
        ob = bpy.data.objects.new(name, me)
        bpy.context.collection.objects.link(ob)
        return ob


def material(name, base="ffffff", rough=0.9, vertex_colors=True, emission=0.0, metallic=0.0):
    m = bpy.data.materials.new(name)
    try:
        m.use_nodes = True
    except Exception:
        pass
    nodes = m.node_tree.nodes
    bsdf = nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = rgba(lin(base))
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metallic
    if emission > 0:
        bsdf.inputs["Emission Color"].default_value = rgba(lin(base))
        bsdf.inputs["Emission Strength"].default_value = emission
    if vertex_colors:
        attr = nodes.new("ShaderNodeVertexColor")
        attr.layer_name = "Col"
        m.node_tree.links.new(attr.outputs["Color"], bsdf.inputs["Base Color"])
    return m


# ---------- the lie of the land ----------
def seg_dist(p, a, b):
    ab = b - a
    t = max(0.0, min(1.0, (p - a).dot(ab) / max(ab.length_squared, 1e-9)))
    return (p - (a + ab * t)).length


def catmull(points, per=6):
    pts = [Vector(p) for p in points]
    out = []
    for i in range(len(pts) - 1):
        p0, p1, p2, p3 = pts[max(0, i - 1)], pts[i], pts[i + 1], pts[min(len(pts) - 1, i + 2)]
        for k in range(per):
            t = k / per
            t2, t3 = t * t, t * t * t
            out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3))
    out.append(pts[-1])
    return out


STREAM_CTRL = [(-80, -10), (-52, -14), (-30, -20.5), (-10, -18.5), (4, -17.8), (16, -18.2), (26, -21), (33, -29), (36, -44), (37, -70)]
STREAM = catmull(STREAM_CTRL)
STREAM_SEGS = list(zip(STREAM[:-1], STREAM[1:]))
RAILS_X = 47.0


def stream_dist(p):
    return min(seg_dist(p, a, b) for a, b in STREAM_SEGS)


def path_dist(p):
    return min(seg_dist(p, a, b) for a, b in SEGMENTS)


def height(x, y, ds=None):
    p = Vector((x, y))
    r = (p - Vector((12, 6))).length
    h = smooth(44, 80, r) * 9 + wave(x * 1.7, y * 1.7) * 0.5 * smooth(36, 56, r)
    h *= smooth(3.5, 8.0, abs(x - RAILS_X))
    h *= smooth(3.0, 9.0, stream_dist(p) if ds is None else ds)
    return h


SQUARE = PLACES["square"]
PATCH_RECT = (14.6, 21.6, 9.0, 13.6)
CLEARING = PLACES["clearing"]
WOODS = PLACES["woods"]
OAK = Vector((0.0, 2.8))
SHED = Vector((6.6, 6.9))
BAKERY = Vector((33.0, 7.6))
PLATFORM = (43.2, 46.0, -15.5, -2.5, 0.45)  # x0, x1, y0, y1, top

# ---------- trees ----------
LEAVES = ["5e9e3e", "6aa84f", "73ad48", "5a9440", "7fb64e", "689f3f"]
BIRCH_LEAVES = ["9cc75a", "a6cb5e", "8fbf55"]
NEEDLES = ["2f6b42", "3a7a48", "2c6440", "35714a"]
BARK = "6e4f36"
TREES = []  # (x, y, trunk radius, crown radius) for colliders and ground shade
TREE_KINDS = {}


def leaf_shader(base, C, R, warm=1.0):
    """Darker and cooler underneath and inside, lighter and sun-warmed on top."""
    dark = Vector((base.x * 0.34, base.y * 0.45, base.z * 0.55))
    light = Vector((base.x * 1.32 + 0.015, base.y * 1.2 + 0.01, base.z * 0.78))
    seed = RNG.uniform(0, 50)

    def f(co):
        d = co - C
        up = d.z / R
        out = min(1.0, Vector((d.x, d.y, d.z * 0.5)).length / R)
        t = 0.5 + 0.45 * up + 0.3 * (out - 0.75) + 0.12 * n3(co.x * 1.3 + seed, co.y * 1.3, co.z * 1.3)
        return rgba(mixv(dark, light, t * warm))

    return f


def bark_shader(base_hex, cx, cy, z0, ridges, seed, moss=0.5):
    base = lin(base_hex) * RNG.uniform(0.88, 1.12)
    dark = base * 0.5
    mossc = lin("5f7f3a")

    def f(co):
        a = math.atan2(co.y - cy, co.x - cx)
        r = math.sin(ridges * a + 1.7 * math.sin(co.z * 1.1 + seed))
        c = mixv(dark, base * 1.12, 0.5 + 0.5 * r)
        m = smooth(0.9, 0.0, co.z - z0) * moss * (0.6 + 0.4 * n3(co.x * 2 + seed, co.y * 2, co.z * 2))
        return rgba(mixv(c, mossc, m))

    return f


def lod_of(x, y):
    p = Vector((x, y))
    d = min([(p - q).length for q in PLACES.values()] + [(p - Vector(s["at"])).length for s in SPOTS.values()])
    return 0 if d < 15 else (1 if d < 32 else 2)


def round_tree(trunks, foliage, x, y, s=1.0, lod=0):
    z = height(x, y)
    h = RNG.uniform(1.8, 2.8) * s
    seed = RNG.uniform(0, 50)
    tr = 0.3 * s
    segs = 10 if lod == 0 else 7
    prof = [(-0.3, tr * 1.6), (0.0, tr * 1.4), (0.3, tr * 1.08), (h * 0.5, tr * 0.92), (h + 0.6, tr * 0.7)]
    bark = bark_shader(BARK, x, y, z, 6, seed)
    trunks.lathe((x, y, z), prof, bark, segs=segs, ridges=6, ridge_amp=0.07, rough=0.06, seed=seed, cap_top=False)
    if lod == 0:
        for k in range(3):
            a = seed + k * 2.1
            d = Vector((math.cos(a), math.sin(a), 0))
            p0 = Vector((x, y, z + h * 0.75))
            trunks.tube([p0, p0 + d * 0.5 * s + Vector((0, 0, 0.45 * s)), p0 + d * 1.0 * s + Vector((0, 0, 1.15 * s))], [tr * 0.55, tr * 0.38, tr * 0.15], bark, segs=6, cap=False)
    top = z + h + 0.4
    leaf = lin(RNG.choice(LEAVES)) * RNG.uniform(0.9, 1.1)
    C = Vector((x, y, top + 0.6 * s))
    R = 2.1 * s
    shade = leaf_shader(leaf, C, R)
    sub = 2 if lod < 2 else 1
    foliage.blob(C + Vector((0, 0, 0.35 * s)), 1.7 * s, shade, scale=(1, 1, 0.88), sub=3 if lod == 0 else sub, amp=0.15, ncenter=C)
    nb = 3 if lod == 0 else 2
    a0 = RNG.uniform(0, 2 * math.pi)
    for i in range(nb):
        a = a0 + i * 2 * math.pi / nb + RNG.uniform(-0.4, 0.4)
        off = Vector((math.cos(a) * 1.15 * s, math.sin(a) * 1.15 * s, RNG.uniform(-0.55, 0.45) * s))
        foliage.blob(C + off, RNG.uniform(1.1, 1.4) * s, shade, sub=sub, amp=0.12 if lod == 0 else 0.18, ncenter=C)
    TREES.append((x, y, tr * 1.4, 2.4 * s))


def birch(trunks, foliage, x, y, s=1.0, lod=0):
    z = height(x, y)
    h = RNG.uniform(3.4, 4.4) * s
    seed = RNG.uniform(0, 50)
    tr = 0.17 * s
    white, darkc = lin("e9e4d8"), lin("3a3430")

    def bark(co):
        m = n3(co.x * 4 + seed, co.y * 4, co.z * 9)
        c = mixv(white * (0.92 + 0.08 * n3(co.z * 3, seed)), darkc, smooth(0.32, 0.5, m))
        c = mixv(c, darkc * 1.2, smooth(0.4, 0.0, co.z - z) * 0.8)
        return rgba(c)

    rings = 12 if lod == 0 else 5
    prof = [(-0.2, tr * 1.3)] + [(h * k / rings, tr * (1.1 - 0.4 * k / rings)) for k in range(rings + 1)]
    trunks.lathe((x, y, z), prof, bark, segs=8 if lod == 0 else 6, rough=0.05, seed=seed, cap_top=False)
    leaf = lin(RNG.choice(BIRCH_LEAVES)) * RNG.uniform(0.92, 1.08)
    C = Vector((x, y, z + h + 0.6 * s))
    shade = leaf_shader(leaf, C, 1.6 * s)
    sub = 2 if lod < 2 else 1
    foliage.blob(C, 1.15 * s, shade, scale=(1, 1, 1.45), sub=3 if lod == 0 else sub, amp=0.16, ncenter=C)
    for i in range(3 if lod == 0 else 1):
        a = RNG.uniform(0, 2 * math.pi)
        foliage.blob(C + Vector((math.cos(a) * 0.7 * s, math.sin(a) * 0.7 * s, RNG.uniform(-1.0, 0.2) * s)), 0.8 * s, shade, scale=(1, 1, 1.2), sub=sub, amp=0.2, ncenter=C)
    TREES.append((x, y, tr * 1.3, 1.5 * s))


def pine_tier(b, x, y, z0, R, hh, base, segs=8, droop=0.25):
    """One drooping skirt of needles: lobed rim, slightly concave underside."""
    n = segs * 2
    rot = RNG.uniform(0, math.pi)
    top = b.bm.verts.new((x, y, z0 + hh))
    mid, rim = [], []
    for k in range(n):
        a = rot + 2 * math.pi * k / n
        lob = 1.0 if k % 2 == 0 else 0.8
        mid.append(b.bm.verts.new((x + math.cos(a) * R * 0.5 * (0.95 + 0.05 * lob), y + math.sin(a) * R * 0.5, z0 + hh * 0.42)))
        rr = R * lob * RNG.uniform(0.94, 1.06)
        rim.append(b.bm.verts.new((x + math.cos(a) * rr, y + math.sin(a) * rr, z0 - droop * hh * lob)))
    under = b.bm.verts.new((x, y, z0 + hh * 0.22))
    dark = Vector((base.x * 0.35, base.y * 0.45, base.z * 0.55))
    light = Vector((base.x * 1.3, base.y * 1.22, base.z * 0.95))
    C = Vector((x, y, z0))
    top_faces = [b.bm.faces.new((top, mid[(k + 1) % n], mid[k])) for k in range(n)]
    top_faces += [b.bm.faces.new((mid[k], mid[(k + 1) % n], rim[(k + 1) % n], rim[k])) for k in range(n)]
    under_faces = [b.bm.faces.new((under, rim[k], rim[(k + 1) % n])) for k in range(n)]

    def upper(co):
        d = co - C
        t = 0.35 + 0.35 * min(1.0, Vector((d.x, d.y, 0)).length / R) + 0.25 * (d.z / hh) + 0.1 * n3(co.x * 2, co.y * 2, co.z * 2)
        return rgba(mixv(dark, light, t))

    b._finish(top_faces, upper, True)
    b._finish(under_faces, rgba(dark * 0.8), True)


def pine(trunks, foliage, x, y, s=1.0, lod=0):
    z = height(x, y)
    seed = RNG.uniform(0, 50)
    tr = 0.22 * s
    tiers = 5 if lod == 0 else (4 if lod == 1 else 3)
    total = 5.8 * s
    trunks.lathe((x, y, z), [(-0.2, tr * 1.5), (0.0, tr * 1.3), (0.4, tr), (total * 0.8, tr * 0.4)], bark_shader("5e4330", x, y, z, 5, seed), segs=8 if lod == 0 else 6, ridges=5, rough=0.05, seed=seed, cap_top=False)
    base = lin(RNG.choice(NEEDLES)) * RNG.uniform(0.9, 1.1)
    for k in range(tiers):
        t = k / max(1, tiers - 1)
        z0 = z + 1.1 * s + t * (total - 2.6 * s)
        R = (2.0 - 1.35 * t) * s
        hh = (1.7 - 0.4 * t) * s
        pine_tier(foliage, x, y, z0, R, hh, base * (0.92 + 0.16 * t), segs=8 if lod < 2 else 6)
    TREES.append((x, y, tr * 1.3, 2.0 * s))


def tree_ok(p, trees, spacing):
    for k in list(PLACES.values()) + list(NODES.values()):
        if (p - k).length < 6.0:
            return False
    for s in SPOTS.values():
        if (p - Vector(s["at"])).length < 3.0:
            return False
    if path_dist(p) < 2.6 or stream_dist(p) < 3.4 or abs(p.x - RAILS_X) < 5.0:
        return False
    if (p - Vector((0, 2.8))).length < 7.5 or (p - SQUARE).length < 8 or (p - CLEARING).length < 7:
        return False
    if 26 < p.x < 40 and 1 < p.y < 13:
        return False
    x0, x1, y0, y1 = PATCH_RECT
    if x0 - 3 < p.x < x1 + 3 and y0 - 3 < p.y < y1 + 3:
        return False
    if 2 < p.x < 10 and 2 < p.y < 10:
        return False
    key = (int(p.x // 3), int(p.y // 3))
    for dx in (-1, 0, 1):
        for dy in (-1, 0, 1):
            for q in trees.get((key[0] + dx, key[1] + dy), ()):
                if (p - q).length < spacing:
                    return False
    return True


def build_trees(trunks, foliage):
    trees = {}
    placed = 0
    for _ in range(9000):
        p = Vector((RNG.uniform(-70, 88), RNG.uniform(-60, 70)))
        core = -8 < p.x < 42 and -14 < p.y < 18
        in_woods = (p - WOODS).length < 20 or (p - CLEARING).length < 14
        prob = 0.05 if core and not in_woods else 0.95 if in_woods else 0.7
        if RNG.random() > prob:
            continue
        spacing = 2.6 if in_woods else 3.3
        if not tree_ok(p, trees, spacing):
            continue
        trees.setdefault((int(p.x // 3), int(p.y // 3)), []).append(p)
        lod = lod_of(p.x, p.y)
        s = RNG.uniform(0.85, 1.25)
        r = RNG.random()
        if r < (0.5 if in_woods or p.y > 30 else 0.28):
            pine(trunks, foliage, p.x, p.y, s * 1.1, lod)
            kind = "pine"
        elif r < (0.62 if in_woods else 0.42):
            birch(trunks, foliage, p.x, p.y, s, lod)
            kind = "birch"
        else:
            round_tree(trunks, foliage, p.x, p.y, s, lod)
            kind = "round"
        TREE_KINDS[(kind, lod)] = TREE_KINDS.get((kind, lod), 0) + 1
        circle(p.x, p.y, TREES[-1][2] + 0.1, "tree")
        placed += 1
        if placed >= 560:
            break
    return placed


# ---------- ground and water ----------
def tree_shade_lookup():
    grid = {}
    for t in TREES:
        grid.setdefault((int(t[0] // 4), int(t[1] // 4)), []).append(t)

    def shade(x, y):
        s = 0.0
        gx, gy = int(x // 4), int(y // 4)
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for tx, ty, _, cr in grid.get((gx + dx, gy + dy), ()):
                    d = math.hypot(x - tx, y - ty)
                    s = max(s, smooth(cr * 1.15, cr * 0.35, d))
        return s

    return shade


def ground_color(x, y, ds, dp, shade):
    p = Vector((x, y))
    nlo = n3(x * 0.045, y * 0.045, 1.3)
    nmid = n3(x * 0.2, y * 0.2, 7.1)
    nhi = n3(x * 1.3, y * 1.3, 3.3)
    c = mixv(lin("5f9038"), lin("9dc155"), 0.5 + 0.6 * nlo)
    c = mixv(c, lin("b3bf5c"), max(0.0, nmid) * 0.45)
    c = c * (1 + 0.07 * nhi)
    woods = max(smooth(21, 9, (p - WOODS).length), smooth(16, 8, (p - CLEARING).length) * 0.6)
    floor = mixv(lin("486a30"), lin("6a5a37"), 0.5 + 0.5 * nmid)
    c = mixv(c, floor, woods * 0.7)
    c = mixv(c, lin("8fb24f"), smooth(6.5, 3.5, (p - CLEARING).length) * 0.8)
    c = c * (1 - 0.38 * shade)
    c = mixv(c, lin("c9b48a") * (1 + 0.06 * nhi), smooth(3.0, 2.15, ds))  # sandy bank
    c = mixv(c, lin("7a705a"), smooth(2.1, 1.75, ds))  # wet edge
    c = mixv(c, lin("34443a"), smooth(1.6, 0.5, ds))  # stream bed, seen through the water
    earth = mixv(lin("b48858"), lin("cfa671"), 0.5 + 0.55 * nhi)
    earth = mixv(earth, lin("94704a"), smooth(0.55, 1.15, dp) * 0.55)  # trodden edge
    c = mixv(c, earth, smooth(1.4, 0.85, dp))
    c = mixv(c, lin("c2b49c") * (0.95 + 0.08 * nhi), smooth(6.1, 5.5, (p - SQUARE).length))
    x0, x1, y0, y1 = PATCH_RECT
    if x0 - 0.2 < x < x1 + 0.2 and y0 - 0.2 < y < y1 + 0.2:
        c = lin("6a4a31") * (1 + 0.1 * nhi)
    c = mixv(c, lin("9c9384") * (1 + 0.1 * nhi), smooth(2.3, 1.5, abs(x - RAILS_X)))  # ballast
    px0, px1, py0, py1, _ = PLATFORM
    if px0 - 0.6 < x < px1 + 0.3 and py0 - 0.3 < y < py1 + 0.3:
        c = lin("9c9384")
    c = mixv(c, earth * 0.92, smooth(1.4, 0.6, (p - Vector((0, 0.9))).length))  # burrow doorstep
    return rgba(c)


CORE = (-14, 42, -22, 26)  # finer ground here


def build_ground(mat):
    shade = tree_shade_lookup()
    bm = bmesh.new()
    lay = bm.loops.layers.float_color.new("Col")
    cache = {}

    def vert(x, y):
        key = (round(x * 2), round(y * 2))
        v = cache.get(key)
        if v is None:
            p = Vector((x, y))
            ds = stream_dist(p)
            dp = path_dist(p)
            v = bm.verts.new((x, y, height(x, y, ds)))
            cache[key] = v
            colors[v] = ground_color(x, y, ds, dp, shade(x, y))
        return v

    colors = {}
    cx0, cx1, cy0, cy1 = CORE

    def quad(xa, ya, s):
        # Outer and core grids never share vertices, so the seam is a hairline at most (and flat).
        f = bm.faces.new((vert(xa, ya), vert(xa + s, ya), vert(xa + s, ya + s), vert(xa, ya + s)))
        for loop in f.loops:
            loop[lay] = colors[loop.vert]
        f.smooth = True

    x0, x1, y0, y1 = -72, 90, -62, 72
    for j in range(int(y1 - y0)):
        for i in range(int(x1 - x0)):
            xa, ya = x0 + i, y0 + j
            if cx0 <= xa and xa + 1 <= cx1 and cy0 <= ya and ya + 1 <= cy1:
                continue
            quad(xa, ya, 1.0)
    # The core grid gets its own vertices so the two grids stay separate meshes in one object.
    cache.clear()
    n = int((cx1 - cx0) * 2)
    m = int((cy1 - cy0) * 2)
    for j in range(m):
        for i in range(n):
            quad(cx0 + i * 0.5, cy0 + j * 0.5, 0.5)
    me = bpy.data.meshes.new("Ground")
    bm.to_mesh(me)
    bm.free()
    me.materials.append(mat)
    ob = bpy.data.objects.new("Ground", me)
    bpy.context.collection.objects.link(ob)
    return ob


def build_water(mat):
    bm = bmesh.new()
    pts = catmull(STREAM_CTRL, per=14)
    left, right, mid = [], [], []
    for i, p in enumerate(pts):
        a = pts[max(0, i - 1)]
        b = pts[min(len(pts) - 1, i + 1)]
        t = (b - a).normalized()
        n = Vector((-t.y, t.x))
        w = 3.3 + 0.5 * math.sin(i * 6 / 14 * 0.7)
        left.append(bm.verts.new((*(p + n * w / 2), 0.06)))
        mid.append(bm.verts.new((*p, 0.06)))
        right.append(bm.verts.new((*(p - n * w / 2), 0.06)))
    for i in range(len(pts) - 1):
        bm.faces.new((right[i], right[i + 1], mid[i + 1], mid[i]))
        bm.faces.new((mid[i], mid[i + 1], left[i + 1], left[i]))
    me = bpy.data.meshes.new("Water")
    bm.to_mesh(me)
    bm.free()
    for p in me.polygons:
        p.use_smooth = True
    me.materials.append(mat)
    ob = bpy.data.objects.new("Water", me)
    bpy.context.collection.objects.link(ob)
    return ob


# ---------- small things ----------
def rock(b, x, y, r, z=None, moss=0.6, scale=(1.3, 1.0, 0.62), sub=2):
    z = height(x, y) if z is None else z
    grey = lin(RNG.choice(["9c968c", "a8a196", "8f8a82", "b0aa9e"])) * RNG.uniform(0.9, 1.08)
    mossc = lin("6c8f3f")
    c = Vector((x, y, z + r * 0.15))
    seed = RNG.uniform(0, 50)

    def f(co):
        d = co - c
        up = d.z / (r * scale[2])
        nn = n3(co.x * 3 + seed, co.y * 3, co.z * 3)
        g = grey * (0.82 + 0.25 * up + 0.08 * nn)
        return rgba(mixv(g, mossc * (0.9 + 0.2 * nn), smooth(0.25, 0.75, up + 0.35 * nn) * moss))

    b.blob(c, r, f, scale=scale, sub=sub, amp=0.22, freq=1.1, squash_bottom=0.25)


def clear_of_walks(x, y, path=0.9, spot=0.7):
    """Nothing that sticks up may sit where Khina walks or stands."""
    p = Vector((x, y))
    return path_dist(p) >= path and all((p - Vector(s["at"])).length >= spot for s in SPOTS.values())


def mushroom(b, x, y, small=False, z=None):
    if not clear_of_walks(x, y):
        return
    s = RNG.uniform(0.7, 1.05) * (0.65 if small else 1.0)
    z = height(x, y) if z is None else z
    stem_h = 0.26 * s
    lean = Vector((RNG.uniform(-0.15, 0.15), RNG.uniform(-0.15, 0.15), 1)).normalized()
    b.lathe((x, y, z - 0.02), [(0, 0.055 * s), (stem_h * 0.4, 0.06 * s), (stem_h, 0.045 * s)], col("f3ecdf"), segs=8, direction=lean, cap_top=False)
    top = Vector((x, y, z)) + lean * stem_h
    red = RNG.random() < 0.72
    capc = lin("d43f33" if red else "c58d4e")
    under = lin("efe2c6")
    R = 0.16 * s

    def f(co):
        d = (co - top).z / R
        return rgba(mixv(under, capc * (0.85 + 0.35 * max(0, d)), smooth(-0.05, 0.15, d)))

    b.blob(top + Vector((0, 0, 0.02 * s)), R, f, scale=(1, 1, 0.62), sub=2 if not small else 1, amp=0.05, squash_bottom=0.1)
    if red:
        for k in range(5 if not small else 3):
            a = RNG.uniform(0, 2 * math.pi)
            el = RNG.uniform(0.35, 1.2)
            d = Vector((math.cos(a) * math.cos(el), math.sin(a) * math.cos(el), math.sin(el) * 0.62))
            b.blob(top + Vector((0, 0, 0.02 * s)) + d * R * 1.0, R * RNG.uniform(0.12, 0.18), col("fbf6ec"), scale=(1, 1, 0.45), sub=1, amp=0.0)


def fern(b, x, y, s=1.0, z=None):
    z = height(x, y) if z is None else z
    base = lin(RNG.choice(["4f8f3e", "5a9a44", "4a8540"])) * RNG.uniform(0.9, 1.1)
    fronds = RNG.randint(6, 8)
    rot = RNG.uniform(0, math.pi)
    for k in range(fronds):
        a = rot + 2 * math.pi * k / fronds + RNG.uniform(-0.2, 0.2)
        d = Vector((math.cos(a), math.sin(a), 0))
        side = Vector((-d.y, d.x, 0))
        ln = RNG.uniform(0.7, 1.0) * s
        rise = RNG.uniform(0.5, 0.8)
        spine, lefts, rights = [], [], []
        N = 7
        for i in range(N + 1):
            t = i / N
            p = Vector((x, y, z)) + d * ln * t + Vector((0, 0, ln * (rise * t - (rise + 0.25) * t * t)))
            w = 0.16 * s * math.sin(math.pi * min(1, t * 1.15)) * (1.0 if i % 2 else 0.6)
            spine.append(b.bm.verts.new(p))
            lefts.append(b.bm.verts.new(p + side * w + Vector((0, 0, -0.02))))
            rights.append(b.bm.verts.new(p - side * w + Vector((0, 0, -0.02))))
        faces = []
        for i in range(N):
            faces.append(b.bm.faces.new((spine[i], spine[i + 1], lefts[i + 1], lefts[i])))
            faces.append(b.bm.faces.new((spine[i], rights[i], rights[i + 1], spine[i + 1])))
        o = Vector((x, y, z))
        b._finish(faces, lambda co: rgba(mixv(base * 0.55, base * 1.3, (co - o).length / ln)), True)


def reeds(b, x, y, n=6, z=None):
    z = height(x, y) if z is None else z
    for _ in range(n):
        px, py = x + RNG.uniform(-0.35, 0.35), y + RNG.uniform(-0.35, 0.35)
        h = RNG.uniform(0.8, 1.4)
        lean = Vector((RNG.uniform(-0.18, 0.18), RNG.uniform(-0.18, 0.18), 1))
        g = lin(RNG.choice(["6f9a4a", "7fa552", "5f8c42"]))
        b.lathe((px, py, z - 0.05), [(0, 0.025), (h * 0.6, 0.018), (h, 0.0)], lambda co, g=g: rgba(mixv(g * 0.6, g * 1.2, (co.z - z) / 1.2)), segs=4, direction=lean, cap_top=False)
        if RNG.random() < 0.45:
            top = Vector((px, py, z)) + lean.normalized() * h * 0.78
            b.lathe(top, [(0, 0.0), (0.02, 0.035), (0.2, 0.035), (0.22, 0.0)], col("6b4528"), segs=6, direction=lean, cap_top=False)


def bush(foliage, x, y, s=1.0, z=None, flowers=None, deco=None):
    z = height(x, y) if z is None else z
    leaf = lin(RNG.choice(["4f8f3e", "5b9a48", "629f44", "4c8a3c"])) * RNG.uniform(0.9, 1.1)
    C = Vector((x, y, z + 0.5 * s))
    shade = leaf_shader(leaf, C, 0.75 * s)
    foliage.blob(C, 0.6 * s, shade, scale=(1.15, 1.05, 0.95), sub=2, amp=0.2, squash_bottom=0.8, ncenter=C - Vector((0, 0, 0.25 * s)))
    for _ in range(3):
        a = RNG.uniform(0, 2 * math.pi)
        foliage.blob(C + Vector((math.cos(a) * 0.45 * s, math.sin(a) * 0.45 * s, RNG.uniform(-0.2, 0.05) * s)), RNG.uniform(0.36, 0.46) * s, shade, sub=2 if s > 0.6 else 1, amp=0.2, squash_bottom=0.75, ncenter=C - Vector((0, 0, 0.25 * s)))
    if flowers and deco is not None:
        for _ in range(RNG.randint(4, 8)):
            a = RNG.uniform(0, 2 * math.pi)
            el = RNG.uniform(0.2, 1.1)
            d = Vector((math.cos(a) * math.cos(el) * 1.25, math.sin(a) * math.cos(el) * 1.1, math.sin(el) * 0.85))
            deco.flower(C + d * 0.62 * s * 1.02, 0.06, flowers, up=d)


def lily(b, x, y):
    r = RNG.uniform(0.18, 0.3)
    notch = RNG.uniform(0, 2 * math.pi)
    segs = 12
    c = b.bm.verts.new((x, y, 0.078))
    ring = []
    for k in range(segs + 1):
        a = notch + 0.35 + (2 * math.pi - 0.7) * k / segs
        ring.append(b.bm.verts.new((x + math.cos(a) * r, y + math.sin(a) * r, 0.072)))
    faces = [b.bm.faces.new((c, ring[k], ring[k + 1])) for k in range(segs)]
    g = lin("5f9a48")
    b._finish(faces, lambda co: rgba(mixv(g * 1.2, g * 0.75, math.hypot(co.x - x, co.y - y) / r)), True)
    if RNG.random() < 0.35:
        b.flower((x + 0.05, y + 0.03, 0.08), 0.08, RNG.choice(["f6c6d6", "fbf6ec"]), centre_hex="f3c94a", petals=6)


# ---------- places ----------
def build_burrow(b, foliage, glow, flag):
    """Khina's home: a round door in the roots of a great oak."""
    ox, oy = OAK
    seed = 3.0
    bark = bark_shader("6a4b33", ox, oy, 0.0, 9, seed, moss=0.9)
    prof = [(-0.3, 2.25), (0.0, 2.05), (0.4, 1.82), (0.9, 1.64), (1.6, 1.52), (2.6, 1.42), (3.6, 1.34), (4.6, 1.26), (5.6, 1.1), (6.4, 0.8)]
    trunk = b.lathe((ox, oy, 0), prof, bark, segs=30, ridges=9, ridge_amp=0.045, rough=0.06, freq=1.2, seed=seed, cap_top=False)
    # Flatten the trunk's front where the door sits, so the flare does not bulge over the door.
    plane = oy - 1.58 + 0.08
    for v in trunk:
        if v.co.y < plane:
            w = smooth(1.35, 0.85, abs(v.co.x - ox)) * smooth(2.4, 1.9, v.co.z)
            v.co.y += (plane - v.co.y) * w
    circle(ox, oy, 1.85, "oak")
    COLLIDERS[-1]["_keep"] = True  # the burrow-fork path in layout.ts cuts through the trunk; the tree wins
    # Roots flowing out and down into the ground (none in front of the door).
    for deg in (18, 62, 108, 150, 192, 226, 322):
        a = math.radians(deg + RNG.uniform(-6, 6))
        d = Vector((math.cos(a), math.sin(a), 0))
        side = Vector((-d.y, d.x, 0)) * RNG.uniform(-0.3, 0.3)
        reach = RNG.uniform(2.9, 3.6)
        pts = [Vector((ox, oy, 0)) + d * 1.2 + Vector((0, 0, 1.15)), Vector((ox, oy, 0)) + d * 1.9 + Vector((0, 0, 0.62)) + side * 0.3, Vector((ox, oy, 0)) + d * 2.6 + Vector((0, 0, 0.22)) + side * 0.7, Vector((ox, oy, 0)) + d * reach + Vector((0, 0, -0.12)) + side]
        b.tube(pts, [0.5, 0.36, 0.22, 0.06], bark, segs=10, cap=False)
    for deg, up in ((40, 0.8), (160, 0.7), (280, 0.75)):
        a = math.radians(deg)
        p0 = Vector((ox, oy, 4.4))
        d = Vector((math.cos(a), math.sin(a), up)).normalized()
        b.tube([p0, p0 + d * 1.4 + Vector((0, 0, 0.2)), p0 + d * 2.8 + Vector((0, 0, 0.6))], [0.5, 0.33, 0.14], bark, segs=8, cap=False)
    # Crown.
    leaf = lin("5e9e3e")
    C = Vector((ox, oy, 7.6))
    shade = leaf_shader(leaf, C, 4.2)
    for dx, dy, dz, r in ((0, 0, 7.8, 3.2), (-2.7, -0.5, 6.9, 2.5), (2.7, 0.5, 7.0, 2.6), (0.5, 2.6, 7.3, 2.6), (-1.3, 1.5, 9.0, 2.3), (1.5, -1.8, 8.3, 2.3), (-0.8, -2.2, 6.7, 2.0), (2.2, -1.0, 6.4, 1.7), (-2.3, 1.8, 6.6, 1.9)):
        foliage.blob((ox + dx, oy + dy, dz), r, shade, sub=3, amp=0.14, freq=1.3, ncenter=C, nmix=0.6)
    TREES.append((ox, oy, 1.9, 4.6))
    # Round door with a frame of wood, planks, iron hinges and a brass knob.
    door_c = Vector((ox, oy - 1.58, 0.95))
    ring = [door_c + Vector((math.cos(2 * math.pi * k / 28) * 0.86, 0, math.sin(2 * math.pi * k / 28) * 0.86)) for k in range(29)]
    b.tube(ring, 0.13, shade_fn("4a3222", amount=0.15, freq=4), segs=8, cap=False)
    green = lin("4f8a52")

    def door_col(co):
        stripe = math.sin((co.x - ox) * math.pi / 0.25)
        return rgba(green * (0.9 + 0.12 * stripe + 0.05 * n3(co.x * 6, co.z * 6)))

    b.lathe(door_c + Vector((0, 0.42, 0)), [(0, 0.78), (0.4, 0.78), (0.42, 0.74)], door_col, segs=28, direction=(0, -1, 0), cap_color=door_col)
    for k in range(-2, 3):
        x = ox + k * 0.25 + 0.125
        h = math.sqrt(max(0.0, 0.74**2 - (x - ox) ** 2)) * 0.96
        if h > 0.1:
            b.box((x, door_c.y - 0.01, door_c.z - h), (0.025, 0.02, 2 * h), rgba(green * 0.55), centered=True)
    for dz in (0.38, -0.38):
        b.box((ox - 0.62, door_c.y - 0.04, door_c.z + dz - 0.04), (0.8, 0.04, 0.08), col("2f2f30"), bevel=0.012)
    b.blob(door_c + Vector((0.46, -0.08, -0.05)), 0.07, col("e0b44c"), sub=2, amp=0.0)
    # Round window up and to the right, lit from inside when Khina is home.
    a = math.radians(-58)
    wd = Vector((math.cos(a), math.sin(a), 0.0))
    wc = Vector((ox, oy, 2.4)) + wd * 1.38
    side = Vector((-wd.y, wd.x, 0))
    ring = [wc + wd * 0.06 + (side * math.cos(2 * math.pi * k / 24) + Vector((0, 0, math.sin(2 * math.pi * k / 24)))) * 0.45 for k in range(25)]
    b.tube(ring, 0.09, col("4a3222"), segs=8, cap=False)
    b.lathe(wc - wd * 0.2, [(0, 0.44), (0.24, 0.44)], col("3a281b"), segs=20, direction=wd, cap_top=False)
    glow.lathe(wc - wd * 0.1, [(0, 0.4), (0.12, 0.4)], col("ffffff"), segs=20, direction=wd)
    b.beam(wc + wd * 0.04 - Vector((0, 0, 0.4)), wc + wd * 0.04 + Vector((0, 0, 0.4)), 0.05, 0.05, col("4a3222"))
    b.beam(wc + wd * 0.04 - side * 0.4, wc + wd * 0.04 + side * 0.4, 0.05, 0.05, col("4a3222"))
    b.box((wc.x, wc.y, wc.z - 0.58), (0.9, 0.22, 0.07), col("6a4630"), rz=math.atan2(side.y, side.x), centered=True, bevel=0.02)
    # Stove pipe through the roots.
    cx, cy, cz = L["chimneys"]["burrow"]
    b.lathe((cx, cy, 0.0), [(0, 0.17), (cz - 0.3, 0.17)], lambda co: rgba(mixv(lin("4f4a47"), lin("7a5a42"), smooth(0.3, 0.7, n3(co.x * 4, co.y * 4, co.z * 3)))), segs=12, cap_top=False)
    b.lathe((cx, cy, cz - 0.32), [(0, 0.24), (0.05, 0.26), (0.32, 0.2)], col("3f3b39"), segs=12, cap_top=False)
    for z in (1.2, 2.2):
        b.lathe((cx, cy, z), [(0, 0.2), (0.06, 0.2)], col("2f2c2a"), segs=12)
    # Doorstep stones and a little mat.
    # (Khina walks over these at ground height: tops stay within 0.04 m of the ground.)
    b.lathe((ox, oy - 2.15, -0.17), [(0, 0.82), (0.16, 0.8), (0.2, 0.72), (0.21, 0.0)], shade_fn("b9ae9c", freq=3), segs=16, rough=0.06, cap_top=False)
    b.lathe((ox - 1.1, oy - 2.55, -0.13), [(0, 0.38), (0.14, 0.36), (0.17, 0.0)], shade_fn("aea493", freq=3), segs=10, rough=0.1, cap_top=False)
    b.lathe((ox + 1.05, oy - 2.6, -0.12), [(0, 0.33), (0.13, 0.31), (0.16, 0.0)], shade_fn("b5ab9a", freq=3), segs=10, rough=0.1, cap_top=False)
    # Woodpile: logs with pale end grain.
    for k in range(6):
        lx = -2.25 + (k % 3) * 0.42 + (0.21 if k >= 3 else 0)
        lz = 0.18 + (k // 3) * 0.34
        if k == 5:
            continue
        b.lathe((lx, 0.5, lz), [(0, 0.17), (1.0, 0.17)], bark_shader("7a5638", lx, 0.5, -9, 5, k), segs=10, direction=(0, 1, 0), cap_bottom=True, cap_color=col("dcb98a"), rough=0.05)
    rect(-1.8, 1.0, 1.3, 1.1, 0, "woodpile")
    # Flower pots by the door.
    for px, flower in ((1.25, "f2a0b5"), (-1.2, "f6d55e")):
        b.lathe((px, 1.0, 0), [(0, 0.17), (0.3, 0.24), (0.31, 0.27), (0.38, 0.27), (0.39, 0.23)], shade_fn("b8673f", freq=5), segs=14, cap_bottom=True, cap_color=col("4a3526"))
        bush(foliage, px, 1.0, 0.42, z=0.18)
        for _ in range(5):
            a2 = RNG.uniform(0, 2 * math.pi)
            b.flower((px + math.cos(a2) * 0.18, 1.0 + math.sin(a2) * 0.16, 0.62 + RNG.uniform(-0.05, 0.05)), 0.075, flower)
    # Moss and mushrooms in the roots.
    for k in range(6):
        a = math.radians(RNG.choice([40, 90, 130, 170, 205, 240]) + RNG.uniform(-10, 10))
        r = RNG.uniform(2.0, 2.6)
        mushroom(b, ox + math.cos(a) * r, oy + math.sin(a) * r, small=True, z=0.0)
    # Letterbox: a red box on a post; its flag rises when there is post.
    lx, ly = SPOTS["letterbox"]["face"]
    b.box((lx - 0.06, ly - 0.06, 0), (0.12, 0.12, 1.02), col("6b4a30"), bevel=0.02)
    red = shade_fn("c4493b", freq=3, amount=0.06)
    b.box((lx - 0.22, ly - 0.3, 1.0), (0.44, 0.6, 0.34), red, bevel=0.03)
    b.lathe((lx, ly - 0.3, 1.34), [(0, 0.22), (0.6, 0.22)], red, segs=16, direction=(0, 1, 0), cap_bottom=True, squash=(1.0, 0.75))
    b.box((lx - 0.15, ly - 0.32, 1.1), (0.3, 0.02, 0.05), col("2b2b2b"))  # slot
    rect(lx, ly, 0.14, 0.14, 0, "letterbox post")
    flag.box((lx + 0.24, ly - 0.05, 1.05), (0.04, 0.06, 0.5), col("3d3d3d"), bevel=0.01)
    flag.box((lx + 0.24, ly - 0.05, 1.45), (0.04, 0.26, 0.16), col("f0c13e"), bevel=0.012)


def tiled_roof(b, cx, cy, z, w, d, h, over, tile_hex, gable, tw=0.42, row=0.3, slab=0.1, ridge_hex=None, tile_t=0.04):
    """A pitched roof (ridge along x) with gable walls, a solid slab and rows of tiles."""
    hd = d / 2
    th = math.atan2(h, hd)
    ln = (hd + over) / math.cos(th)
    for sx in (-1, 1):
        x = cx + sx * w / 2
        vs = [b.bm.verts.new((x, cy - hd, z)), b.bm.verts.new((x, cy + hd, z)), b.bm.verts.new((x, cy, z + h))]
        b._finish([b.bm.faces.new(vs)], gable, False)
    ridge = Vector((cx, cy, z + h))
    X = Vector((1, 0, 0))
    base = lin(tile_hex)
    W = w + 2 * over
    for side in (-1, 1):
        down = Vector((0, side * math.cos(th), -math.sin(th)))
        nrm = Vector((0, side * math.sin(th), math.cos(th)))
        basis = Matrix((X, down, nrm)).transposed().to_4x4()
        centre = ridge + down * (ln / 2) + nrm * (slab / 2)
        b.box_m(Matrix.Translation(centre) @ basis @ Matrix.Diagonal((W, ln, slab, 1)), rgba(base * 0.55), bevel=0.02, segs=1)
        rows = int(ln / row)
        for j in range(rows):
            u = ln - j * row - row * 0.55
            stagger = tw / 2 if j % 2 else 0.0
            xo = -W / 2 - stagger
            while xo < W / 2 - 0.01:
                a0, a1 = max(xo, -W / 2), min(xo + tw, W / 2)
                if a1 - a0 > 0.05:
                    c = ridge + X * ((a0 + a1) / 2) + down * u + nrm * (slab + 0.03)
                    M = Matrix.Translation(c) @ basis @ Matrix.Rotation(0.09, 4, "X") @ Matrix.Diagonal(((a1 - a0) * 0.93, row * 1.5, tile_t, 1))
                    shade = RNG.uniform(0.78, 1.12) * (0.9 + 0.1 * (j / max(1, rows)))
                    b.box_m(M, rgba(base * shade))
                xo += tw
    b.lathe((cx - W / 2, cy, z + h + slab * 0.9), [(0, 0.1), (W, 0.1)], rgba(lin(ridge_hex or tile_hex) * 0.8), segs=10, direction=(1, 0, 0), cap_bottom=True)


def window(b, glow, x, y, z, w, h, frame_hex="6a4630", shutter_hex=None, box_flowers=None, lit=True, foliage=None):
    """A framed window in a south-facing wall at y (front face), bottom at z."""
    fr = col(frame_hex)
    b.box((x - w / 2 - 0.1, y - 0.1, z - 0.08), (w + 0.2, 0.12, h + 0.16), fr, bevel=0.025)
    if lit:
        glow.box((x - w / 2, y - 0.13, z), (w, 0.05, h), col("ffffff"))
    else:
        b.box((x - w / 2, y - 0.13, z), (w, 0.05, h), col("3d4a52"))
    b.box((x - 0.03, y - 0.17, z), (0.06, 0.05, h), fr)
    b.box((x - w / 2, y - 0.17, z + h / 2 - 0.03), (w, 0.05, 0.06), fr)
    b.box((x - w / 2 - 0.16, y - 0.26, z - 0.14), (w + 0.32, 0.22, 0.07), col("8a6a4c"), bevel=0.02)  # sill
    if shutter_hex:
        sh = lin(shutter_hex)
        for sx in (-1, 1):
            cx = x + sx * (w / 2 + 0.1 + w * 0.27)
            b.box((cx - w * 0.25, y - 0.12, z - 0.02), (w * 0.5, 0.06, h + 0.04), rgba(sh * RNG.uniform(0.95, 1.05)), bevel=0.015)
            for k in range(3):
                b.box((cx - w * 0.22, y - 0.16, z + 0.12 + k * (h - 0.2) / 2.0), (w * 0.44, 0.04, 0.05), rgba(sh * 0.75))
    if box_flowers:
        b.box((x - w / 2 - 0.12, y - 0.55, z - 0.42), (w + 0.24, 0.36, 0.28), shade_fn("8a5a3a", freq=4), bevel=0.02)
        n = int((w + 0.1) / 0.16)
        for k in range(n):
            px = x - w / 2 + 0.02 + k * 0.16 + RNG.uniform(-0.03, 0.03)
            foliage.blob((px, y - 0.38, z - 0.12), 0.11, col("5f9d43", 0.12), sub=1, amp=0.2)
            b.flower((px + RNG.uniform(-0.04, 0.04), y - 0.44 + RNG.uniform(-0.05, 0.05), z - 0.03 + RNG.uniform(0, 0.08)), 0.065, RNG.choice(box_flowers))


def build_shed(b, foliage):
    sx, sy = SHED
    W, D, H = 3.4, 2.6, 2.2
    x0, y0 = sx - W / 2, sy - D / 2
    b.box((x0 + 0.04, y0 + 0.04, 0), (W - 0.08, D - 0.08, H), col("8f6440"))
    plank = lin("a8774f")
    # Vertical boards all round.
    for face in ("front", "back", "left", "right"):
        if face in ("front", "back"):
            n = 10
            for k in range(n):
                bw = W / n
                y = y0 - 0.02 if face == "front" else y0 + D - 0.03
                b.box((x0 + k * bw + 0.005, y, 0.0), (bw - 0.012, 0.05, H), rgba(plank * RNG.uniform(0.85, 1.12)), bevel=0.01, segs=1)
        else:
            n = 8
            for k in range(n):
                bw = D / n
                x = x0 - 0.02 if face == "left" else x0 + W - 0.03
                b.box((x, y0 + k * bw + 0.005, 0.0), (0.05, bw - 0.012, H), rgba(plank * RNG.uniform(0.85, 1.12)), bevel=0.01, segs=1)
    for px in (x0 - 0.05, x0 + W - 0.07):
        for py in (y0 - 0.05, y0 + D - 0.07):
            b.box((px, py, 0), (0.12, 0.12, H + 0.05), col("6b4a30"), bevel=0.02)
    tiled_roof(b, sx, sy, H, W, D, 1.2, 0.35, "5f7458", col("9a6b44"), tw=0.36, row=0.26, slab=0.08)
    # Door with a Z brace, and a window with shutters.
    dx = sx + 0.97
    door = lin("6b4a30")
    b.box((dx - 0.47, y0 - 0.1, 0), (0.94, 0.08, 1.75), col("4f3522"), bevel=0.02)
    for k in range(4):
        b.box((dx - 0.42 + k * 0.21, y0 - 0.13, 0.02), (0.2, 0.05, 1.66), rgba(door * RNG.uniform(0.9, 1.1)), bevel=0.008, segs=1)
    for z in (0.3, 1.4):
        b.box((dx - 0.42, y0 - 0.17, z), (0.84, 0.05, 0.1), rgba(door * 0.8))
    b.beam((dx - 0.36, y0 - 0.15, 0.4), (dx + 0.36, y0 - 0.15, 1.4), 0.09, 0.04, rgba(door * 0.8))
    b.blob((dx - 0.3, y0 - 0.2, 0.9), 0.04, col("2f2f30"), sub=1, amp=0)
    window(b, None, sx - 0.8, y0 - 0.02, 1.0, 0.7, 0.55, frame_hex="5a3e28", shutter_hex="6f8f7a", lit=False)
    rect(sx, sy, W + 0.25, D + 0.25, 0, "shed")
    # Workbench in front, low enough for a hedgehog: top at 0.45..0.55 as before.
    bx, by = 5.0, 4.6
    wood = lin("b08458")
    for k in range(3):
        b.box((bx - 1.6, by - 0.4 + k * 0.267 + 0.004, 0.45), (3.2, 0.259, 0.1), rgba(wood * RNG.uniform(0.92, 1.08)), bevel=0.015, segs=1)
    for lx in (-1.5, 1.4):
        for ly in (-0.32, 0.25):
            b.box((bx + lx, by + ly, 0), (0.1, 0.1, 0.45), col("8a6040"), bevel=0.015, segs=1)
    b.box((bx - 1.5, by - 0.3, 0.12), (3.0, 0.6, 0.05), col("8a6040"), bevel=0.01, segs=1)
    rect(bx, by, 3.2, 0.8, 0, "workbench")
    # On the bench: shavings, a mallet, a jar of charcoal, a little carved bird, paper, cogs, a tray.
    for k in range(7):
        p = Vector((bx - 0.15 + RNG.uniform(-0.25, 0.25), by - 0.05 + RNG.uniform(-0.12, 0.12), 0.56))
        pts = [p + Vector((math.cos(t * 5) * 0.03, math.sin(t * 5) * 0.03, t * 0.012)) + Vector((t * 0.06, 0, 0)) for t in [i / 6 for i in range(7)]]
        b.tube(pts, 0.008, col("e8c896"), segs=4, cap=False)
    b.lathe((bx + 0.9, by, 0.6), [(-0.1, 0.075), (0.1, 0.075)], col("8a6040"), segs=10, direction=(1, 0, 0), cap_bottom=True)
    b.beam((bx + 0.9, by, 0.6), (bx + 0.85, by - 0.42, 0.58), 0.035, 0.035, col("c9a46e"))
    b.lathe((bx - 1.1, by + 0.1, 0.55), [(0, 0.085), (0.2, 0.09), (0.22, 0.07)], col("cfe3e6"), segs=12, cap_bottom=True)
    for k in range(3):
        b.beam((bx - 1.1 + 0.02 * k, by + 0.1, 0.56), (bx - 1.13 + 0.05 * k, by + 0.12, 0.84), 0.015, 0.015, col("222222"))
    b.blob((bx + 0.3, by + 0.15, 0.63), 0.08, col("d9b98a"), scale=(1.4, 1, 1), sub=2, amp=0.05)
    b.blob((bx + 0.4, by + 0.15, 0.7), 0.05, col("d9b98a"), sub=1, amp=0.05)
    b.box((5.9 - 0.2, by - 0.25, 0.555), (0.4, 0.3, 0.008), col("f7f1e3"), rz=0.1)  # paper for drawing
    b.beam((5.95, by - 0.1, 0.57), (6.15, by + 0.05, 0.57), 0.015, 0.015, col("e0a43a"))
    for k, (gx, gy, gr) in enumerate(((5.25, by - 0.05, 0.07), (5.42, by + 0.06, 0.05))):
        teeth = 10
        prof_r = [(0, gr), (0.03, gr)]
        b.lathe((gx, gy, 0.55), prof_r, col("b9a27a"), segs=teeth * 2, cap_bottom=True)
    b.box((4.1 - 0.2, by - 0.2, 0.55), (0.4, 0.28, 0.04), col("8a6040"), bevel=0.01, segs=1)
    for k in range(6):
        b.blob((4.1 + RNG.uniform(-0.14, 0.14), by - 0.06 + RNG.uniform(-0.08, 0.08), 0.61), 0.03, col(RNG.choice(["a8a196", "c4493b", "f0c13e", "efe7d4"])), sub=1, amp=0.1)
    # Sawhorse and offcuts.
    for sxo in (-0.4, 0.4):
        b.beam((sx + 2.3 + sxo, sy - 2.2 - 0.3, 0), (sx + 2.3 + sxo, sy - 2.2, 0.55), 0.07, 0.07, col("8a6040"))
        b.beam((sx + 2.3 + sxo, sy - 2.2 + 0.3, 0), (sx + 2.3 + sxo, sy - 2.2, 0.55), 0.07, 0.07, col("8a6040"))
    b.box((sx + 1.8, sy - 2.33, 0.53), (1.0, 0.25, 0.12), col("b08458"), bevel=0.015, segs=1)
    b.box((sx + 1.6, sy - 1.6, 0), (0.5, 0.2, 0.08), col("c09868"), rz=0.4, bevel=0.01, segs=1)
    rect(sx + 2.3, sy - 2.2, 1.1, 0.7, 0, "sawhorse")
    # A rain barrel by the corner.
    barrel(b, x0 + W + 0.45, y0 + 0.5, 0.36, 0.8)
    circle(x0 + W + 0.45, y0 + 0.5, 0.42, "barrel")


def barrel(b, x, y, r, h, wood="8a5f3c"):
    prof = [(0, r * 0.86), (h * 0.25, r * 0.97), (h * 0.5, r), (h * 0.75, r * 0.97), (h, r * 0.86)]
    w = lin(wood)
    b.lathe((x, y, 0), prof, lambda co: rgba(w * (0.85 + 0.2 * (0.5 + 0.5 * math.sin(math.atan2(co.y - y, co.x - x) * 9)))), segs=18, cap_color=col("6b4a30"))
    for t in (0.18, 0.82):
        z = h * t
        rr = r * (0.94 if t < 0.5 else 0.94) + 0.012
        b.lathe((x, y, z - 0.03), [(0, rr), (0.06, rr)], col("3b3b3b"), segs=18, cap_top=False)


def build_bakery(b, glow, foliage):
    x, y = BAKERY
    w, d = 6.0, 4.8
    front = y - d / 2
    x0, x1, y1 = x - w / 2, x + w / 2, y + d / 2
    plaster = shade_fn("efe0c4", amount=0.05, freq=1.5)
    timber = lin("6a4630")
    # Stone plinth, two courses of rounded stones.
    for row in range(2):
        z = row * 0.24
        for seg_start, seg_end, axis, fixed in ((x0, x1, "x", front), (x0, x1, "x", y1), (front, y1, "y", x0), (front, y1, "y", x1)):
            t = seg_start - (0.18 if row % 2 else 0)
            while t < seg_end:
                sw = RNG.uniform(0.35, 0.55)
                a0, a1 = max(t, seg_start), min(t + sw, seg_end)
                if a1 - a0 > 0.12:
                    c = rgba(lin(RNG.choice(["a39b8e", "b2aa9c", "968e82", "aaa293"])) * RNG.uniform(0.9, 1.08))
                    if axis == "x":
                        b.box(((a0 + a1) / 2, fixed, z), (a1 - a0 - 0.02, 0.3, 0.24), c, centered=True, bevel=0.05, segs=1)
                    else:
                        b.box((fixed, (a0 + a1) / 2, z), (0.3, a1 - a0 - 0.02, 0.24), c, centered=True, bevel=0.05, segs=1)
                t += sw
    b.box((x0 + 0.05, front + 0.05, 0.4), (w - 0.1, d - 0.1, 2.6), plaster, bevel=0.03, segs=1)
    # Timber framing on the front.
    def post(px, py, h0, h1, wd=0.18):
        b.box((px - wd / 2, py - 0.08, h0), (wd, 0.12, h1 - h0), rgba(timber * RNG.uniform(0.9, 1.1)), bevel=0.02, segs=1)

    for px in (x0 + 0.09, 32.25, 33.75, x1 - 0.09):
        post(px, front, 0.45, 3.0)
    for z in (0.45, 2.88):
        b.box((x0, front - 0.1, z), (w, 0.14, 0.14), rgba(timber * 0.95), bevel=0.02, segs=1)
    # Sides: posts and braces.
    for sxw in (x0, x1):
        for py in (front, y, y1):
            b.box((sxw - 0.08 if sxw == x0 else sxw - 0.06, py - 0.09, 0.45), (0.14, 0.18, 2.55), rgba(timber), bevel=0.02, segs=1)
        xx = sxw - 0.03 if sxw == x0 else sxw + 0.03
        b.beam((xx, front + 0.15, 0.6), (xx, y - 0.15, 2.75), 0.12, 0.14, rgba(timber * 0.9))
        b.beam((xx, y1 - 0.15, 0.6), (xx, y + 0.15, 2.75), 0.12, 0.14, rgba(timber * 0.9))
        b.box((xx, (front + y1) / 2, 1.6), (0.14, d, 0.12), rgba(timber * 0.95), centered=True, bevel=0.02, segs=1)
    tiled_roof(b, x, y, 3.0, w, d, 2.4, 0.45, "b5573f", plaster, tw=0.4, row=0.3, slab=0.12)
    # Stone chimney with a pot; smoke leaves at its top (layout chimney z).
    cx, cy, cz = L["chimneys"]["bakery"]
    z = 3.0
    while z < cz - 0.5:
        for k in range(2):
            c = rgba(lin(RNG.choice(["9a8f84", "a89c8f", "8c8278"])) * RNG.uniform(0.9, 1.1))
            off = (k - 0.5) * 0.36 + (0.09 if int(z * 4) % 2 else -0.09)
            b.box((cx + off, cy, z), (0.38, 0.76, 0.26), c, centered=True, bevel=0.04, segs=1)
        z += 0.26
    b.box((cx, cy, cz - 0.55), (0.9, 0.9, 0.12), col("7f776d"), centered=True, bevel=0.03, segs=1)
    b.lathe((cx, cy, cz - 0.45), [(0, 0.16), (0.3, 0.18), (0.42, 0.15), (0.45, 0.17)], col("b5673f"), segs=12, cap_top=False)
    # Door with a frame, planks, iron straps and a little round window.
    dx, _ = L["doors"]["bakery"]
    b.box((dx - 0.68, front - 0.14, 0.42), (1.36, 0.14, 2.0), rgba(timber * 0.85), bevel=0.03)
    door = lin("6a3f2a")
    for k in range(5):
        b.box((dx - 0.55 + k * 0.22, front - 0.18, 0.45), (0.21, 0.06, 1.85), rgba(door * RNG.uniform(0.9, 1.1)), bevel=0.01, segs=1)
    for z in (0.8, 1.9):
        b.box((dx - 0.55, front - 0.22, z), (1.1, 0.04, 0.07), col("2f2f30"), bevel=0.01, segs=1)
    b.blob((dx + 0.38, front - 0.24, 1.25), 0.06, col("e0b44c"), sub=2, amp=0)
    b.lathe((dx, front - 0.2, 1.62), [(0, 0.2), (0.05, 0.2)], col("3a2a1e"), segs=16, direction=(0, -1, 0))
    glow.lathe((dx, front - 0.22, 1.62), [(0, 0.15), (0.04, 0.15)], col("ffffff"), segs=16, direction=(0, -1, 0))
    b.box((dx - 0.8, front - 0.75, -0.14), (1.6, 0.68, 0.18), shade_fn("b9ae9c", freq=3), bevel=0.04, segs=1)  # step, flush for Khina
    # Windows with shutters and flower boxes.
    for wx in (x - 1.9, x + 1.9):
        window(b, glow, wx, front - 0.02, 1.1, 1.0, 0.9, shutter_hex="5f8fa0", box_flowers=["e8535a", "f2a0b5", "f6d55e"], foliage=foliage)
    # Hanging sign with a loaf.
    b.box((x1 - 0.1, front - 0.95, 2.45), (0.08, 1.05, 0.08), col("3d3d3d"), bevel=0.01, segs=1)
    for t in (0.25, 0.75):
        b.beam((x1 - 0.06, front - 0.95 + t * 0.9, 2.45), (x1 - 0.06, front - 0.95 + t * 0.9, 2.37), 0.015, 0.015, col("3d3d3d"))
    b.box((x1 - 0.12, front - 0.85, 1.75), (0.06, 0.8, 0.62), col("d9b26a"), bevel=0.02)
    b.blob((x1 - 0.18, front - 0.45, 2.06), 0.22, lambda co: rgba(mixv(lin("8a4f1f"), lin("d39a4c"), 0.5 + 2.5 * (co.z - 2.06))), scale=(0.5, 1.3, 0.8), sub=2, amp=0.05)
    rect(x, y, w + 0.3, d + 0.3, 0, "bakery")
    # A crate of yesterday's crusts out front.
    cx2, cy2 = SPOTS["crusts"]["face"]
    slat = lin("b08458")
    for k in range(3):
        z = 0.04 + k * 0.14
        b.box((cx2 - 0.4, cy2 - 0.3, z), (0.8, 0.04, 0.1), rgba(slat * RNG.uniform(0.9, 1.1)), bevel=0.01, segs=1)
        b.box((cx2 - 0.4, cy2 + 0.26, z), (0.8, 0.04, 0.1), rgba(slat * RNG.uniform(0.9, 1.1)), bevel=0.01, segs=1)
        b.box((cx2 - 0.4, cy2 - 0.3, z), (0.04, 0.6, 0.1), rgba(slat * RNG.uniform(0.9, 1.1)), bevel=0.01, segs=1)
        b.box((cx2 + 0.36, cy2 - 0.3, z), (0.04, 0.6, 0.1), rgba(slat * RNG.uniform(0.9, 1.1)), bevel=0.01, segs=1)
    for px in (cx2 - 0.38, cx2 + 0.34):
        for py in (cy2 - 0.28, cy2 + 0.24):
            b.box((px, py, 0), (0.05, 0.05, 0.45), rgba(slat * 0.8), bevel=0.01, segs=1)
    b.box((cx2 - 0.36, cy2 - 0.26, 0.05), (0.72, 0.52, 0.03), rgba(slat * 0.7))
    crust = lambda co: rgba(mixv(lin("8a4f1f"), lin("d9a453"), 0.4 + 3 * (co.z - 0.42)))
    for k in range(5):
        b.blob((cx2 - 0.26 + k * 0.13, cy2 + RNG.uniform(-0.12, 0.12), 0.43 + RNG.uniform(0, 0.04)), 0.12, crust, scale=(1.3, 0.85, 0.65), sub=2, amp=0.08)
    rect(cx2, cy2, 0.85, 0.65, 0, "crate")
    # Barrels and flour sacks round the side.
    for bx, by2 in ((x1 + 0.55, front + 0.6), (x1 + 0.6, front + 1.45)):
        barrel(b, bx, by2, 0.38, 0.85)
        circle(bx, by2, 0.42, "barrel")
    for k, (sx2, sy2) in enumerate(((x1 + 0.35, front - 0.55), (x1 + 0.95, front - 0.35))):
        sack = lin("e6dcc6")
        c = Vector((sx2, sy2, 0.3))
        b.blob(c, 0.3, lambda co, c=c: rgba(sack * (0.85 + 0.25 * (co.z - c.z + 0.3))), scale=(1, 0.9, 1.15), sub=2, amp=0.1, squash_bottom=0.75)
        b.lathe((sx2, sy2, 0.62), [(0, 0.08), (0.08, 0.05), (0.14, 0.11), (0.16, 0.0)], col("d8cdb5"), segs=8, cap_top=False)
        circle(sx2, sy2, 0.3, "sack")


def build_square(b, glow, foliage):
    sx, sy = SQUARE
    # Cobbles.
    k = 0
    row = 0
    yy = sy - 5.6
    while yy < sy + 5.6:
        xx = sx - 5.6 + (0.17 if row % 2 else 0)
        while xx < sx + 5.6:
            px, py = xx + RNG.uniform(-0.04, 0.04), yy + RNG.uniform(-0.04, 0.04)
            if math.hypot(px - sx, py - sy) < 5.3 and math.hypot(px - sx, py - (sy - 0.4)) > 1.0:
                r = RNG.uniform(0.15, 0.18)
                c = rgba(lin(RNG.choice(["b5ab9b", "a99f90", "c2b8a6", "9f968a", "bbb09e"])) * RNG.uniform(0.9, 1.08))
                b.lathe((px, py, -0.04), [(0, r), (0.05, r * 0.95), (0.075, r * 0.72), (0.08, 0.0)], c, segs=6, cap_top=False, phase=RNG.uniform(0, 1))
                k += 1
            xx += 0.34
        yy += 0.3
        row += 1
    # Kerb.
    for k in range(40):
        a = 2 * math.pi * k / 40
        kx, ky = sx + math.cos(a) * 5.6, sy + math.sin(a) * 5.6
        on_path = path_dist(Vector((kx, ky))) < 1.1
        z0 = -0.14 if on_path else -0.05  # flush where Khina walks across
        b.box((kx, ky, z0), (0.82, 0.32, 0.17), col("a39b8e", 0.06), rz=a + math.pi / 2, centered=True, bevel=0.05, segs=1)
    # Well: courses of stones, posts, a tiled roof, a crank and a bucket.
    wx, wy = sx, sy - 0.4
    for course in range(3):
        n = 14
        for k in range(n):
            a = 2 * math.pi * (k + 0.5 * (course % 2)) / n
            c = rgba(lin(RNG.choice(["a59f95", "b0a99e", "989086"])) * RNG.uniform(0.9, 1.08))
            b.box((wx + math.cos(a) * 0.88, wy + math.sin(a) * 0.88, course * 0.27), (0.27, 0.42, 0.27), c, rz=a, centered=True, bevel=0.05, segs=1)
    b.lathe((wx, wy, 0.81), [(0, 0.98), (0.08, 0.98), (0.1, 0.74), (0.02, 0.72)], col("9a9388"), segs=24, cap_top=False)
    b.lathe((wx, wy, 0.55), [(0, 0.72)], col("2c4652"), segs=20)
    for px in (-0.85, 0.85):
        b.box((wx + px - 0.07, wy - 0.07, 0.8), (0.14, 0.14, 1.55), col("6b4a30"), bevel=0.025, segs=1)
    tiled_roof(b, wx, wy, 2.3, 1.9, 1.4, 0.7, 0.15, "b5573f", col("6b4a30"), tw=0.3, row=0.22, slab=0.06)
    b.lathe((wx - 0.95, wy, 1.95), [(0, 0.06), (1.9, 0.06)], col("6b4a30"), segs=8, direction=(1, 0, 0), cap_bottom=True)
    b.beam((wx + 0.95, wy, 1.95), (wx + 1.05, wy, 1.75), 0.04, 0.04, col("3d3d3d"))
    b.beam((wx + 1.05, wy, 1.75), (wx + 1.05, wy - 0.25, 1.75), 0.04, 0.04, col("3d3d3d"))
    b.beam((wx + 0.2, wy, 1.92), (wx + 0.2, wy, 1.45), 0.012, 0.012, col("c9b48a"))
    b.lathe((wx + 0.2, wy, 1.2), [(0, 0.14), (0.26, 0.17)], lambda co: rgba(lin("8a6040") * (0.85 + 0.2 * math.sin(math.atan2(co.y - wy, co.x - wx - 0.2) * 8))), segs=12, cap_bottom=True, cap_top=False)
    b.lathe((wx + 0.2, wy, 1.4), [(0, 0.17), (0.03, 0.17)], col("3b3b3b"), segs=12, cap_top=False)
    circle(wx, wy, 1.05, "well")
    # Bench facing the well, deep enough for a hedgehog to sit on (seat top at the spot's z).
    bx, by = SPOTS["bench"]["at"]
    seat = SPOTS["bench"]["z"]
    wood = lin("b08458")
    for k in range(3):
        b.box((bx - 1.3, by - 0.3 + k * 0.317 + 0.004, seat - 0.08), (2.6, 0.309, 0.08), rgba(wood * RNG.uniform(0.92, 1.08)), bevel=0.015, segs=1)
    for k in range(2):
        b.box((bx - 1.3, by + 0.62, seat + 0.1 + k * 0.24), (2.6, 0.08, 0.18), rgba(wood * RNG.uniform(0.92, 1.08)), bevel=0.015, segs=1)
    for lx in (-1.2, 1.1):
        for ly in (-0.25, 0.55):
            b.box((bx + lx, by + ly, 0), (0.1, 0.1, seat - 0.08), col("6b4a30"), bevel=0.015, segs=1)
        b.box((bx + lx, by + 0.62, seat), (0.1, 0.08, 0.6), col("6b4a30"), bevel=0.015, segs=1)
    rect(bx, by + 0.175, 2.6, 0.95, 0, "bench")
    # Lamp post.
    lx, ly = sx + 4.4, sy - 3.6
    b.lathe((lx, ly, 0), [(0, 0.17), (0.1, 0.15), (0.25, 0.08), (2.5, 0.06), (2.55, 0.09)], col("3b3b3b"), segs=12)
    b.box((lx - 0.22, ly - 0.22, 2.55), (0.44, 0.44, 0.06), col("3b3b3b"), bevel=0.015, segs=1)
    glow.box((lx - 0.17, ly - 0.17, 2.61), (0.34, 0.34, 0.42), col("ffffff"))
    for ex in (-0.18, 0.15):
        for ey in (-0.18, 0.15):
            b.box((lx + ex, ly + ey, 2.61), (0.03, 0.03, 0.42), col("2f2f2f"))
    b.lathe((lx, ly, 3.03), [(0, 0.28), (0.05, 0.28), (0.26, 0.04), (0.33, 0.0)], col("3b3b3b"), segs=4, phase=math.pi / 4)
    b.blob((lx, ly, 3.4), 0.05, col("3b3b3b"), sub=1, amp=0)
    circle(lx, ly, 0.2, "lamp")
    # Flower beds by the kerb.
    for k in range(15):
        a = math.radians(202 + k * 9.6 + RNG.uniform(-2, 2))
        r = 6.45 + RNG.uniform(-0.1, 0.15)
        px, py = sx + math.cos(a) * r, sy + math.sin(a) * r
        if path_dist(Vector((px, py))) < 1.3:
            continue
        bush(foliage, px, py, RNG.uniform(0.45, 0.6), z=-0.05, flowers=RNG.choice(["e8535a", "f2a0b5", "f6d55e", "b79be0", "fbf6ec"]), deco=b)


def build_patch(b, foliage):
    x0, x1, y0, y1 = PATCH_RECT
    cx = (x0 + x1) / 2
    soil = lin("5b3f2a")
    for i in range(4):
        by = 9.7 + i * 1.05
        b.box((cx - 3.05, by - 0.38, 0), (6.1, 0.76, 0.24), col("7a5a3e"), bevel=0.03, segs=1)  # board frame
        b.box((cx - 2.98, by - 0.31, 0.2), (5.96, 0.62, 0.06), lambda co: rgba(soil * (0.85 + 0.25 * n3(co.x * 5, co.y * 5))))
        for k in range(10):
            px = cx - 2.7 + k * 0.6
            if i == 0:  # peas up poles
                b.lathe((px, by, 0.2), [(0, 0.025), (1.3, 0.02)], col("a07d52"), segs=5)
                for z in (0.5, 0.78, 1.06, 1.3):
                    foliage.blob((px + RNG.uniform(-0.08, 0.08), by - 0.04, z), 0.14, col("6fae4f", 0.12), sub=1, amp=0.3)
                for z in (0.62, 0.95):
                    b.blob((px + 0.1, by - 0.15, z), 0.045, col("9cd06b"), scale=(0.7, 0.7, 2.0), sub=1, amp=0.05)
                if k % 3 == 0:
                    b.flower((px - 0.08, by - 0.15, 1.15), 0.05, "fbf6ec", petals=5, up=(0, -1, 0.4))
            elif i == 1:  # cabbages
                C = Vector((px, by, 0.32))
                g = lin("a4cf77") * RNG.uniform(0.9, 1.08)
                b.blob(C, 0.17, lambda co, C=C, g=g: rgba(mixv(g * 0.8, g * 1.25, (co.z - C.z) / 0.17 + 0.3)), sub=2, amp=0.08)
                for a in range(5):
                    aa = a * 2 * math.pi / 5 + RNG.uniform(-0.3, 0.3)
                    d = Vector((math.cos(aa), math.sin(aa), 0.35))
                    b.blob(C + d * 0.13 - Vector((0, 0, 0.05)), 0.15, rgba(g * 0.75), scale=(1, 1, 0.45), sub=1, amp=0.15)
            elif i == 2:  # carrots: orange shoulders and feathery tops
                b.lathe((px, by, 0.2), [(0, 0.05), (0.05, 0.045), (0.06, 0.0)], col("e07a2e"), segs=8, cap_top=False)
                for t in range(5):
                    a = t * 2 * math.pi / 5
                    d = Vector((math.cos(a) * 0.35, math.sin(a) * 0.35, 1))
                    b.lathe((px, by, 0.24), [(0, 0.018), (0.3, 0.0)], col("5f9d43"), segs=4, direction=d, cap_top=False)
                    b.blob(Vector((px, by, 0.24)) + d.normalized() * 0.26, 0.05, col("6fae4f", 0.1), scale=(1, 1, 0.6), sub=1, amp=0.3)
            else:  # lettuces
                C = Vector((px, by, 0.3))
                g = lin("8fc25f") * RNG.uniform(0.92, 1.08)
                b.blob(C, 0.19, lambda co, C=C, g=g: rgba(mixv(g * 0.75, g * 1.3, (co.z - C.z) / 0.19 + 0.4)), scale=(1, 1, 0.65), sub=2, amp=0.28, freq=4.0)
    # Wattle fence on three sides, open toward the path.
    stake = col("7a5a3e")
    rod = lin("a07d52")
    sides = [((x0, y0), (x0, y1)), ((x0, y1), (x1, y1)), ((x1, y1), (x1, y0))]
    for (ax, ay), (bx, by) in sides:
        ln = math.hypot(bx - ax, by - ay)
        n = int(ln / 0.55)
        for k in range(n + 1):
            t = k / n
            b.lathe((ax + (bx - ax) * t, ay + (by - ay) * t, 0), [(0, 0.045), (0.85, 0.04), (0.9, 0.0)], stake, segs=6, cap_top=False)
        nx, ny = -(by - ay) / ln, (bx - ax) / ln
        for h in (0.25, 0.4, 0.55, 0.7):
            pts = []
            steps = n * 4
            for k in range(steps + 1):
                t = k / steps
                wob = 0.045 * math.sin(t * n * math.pi + h * 20)
                pts.append((ax + (bx - ax) * t + nx * wob, ay + (by - ay) * t + ny * wob, h + 0.01 * math.sin(k)))
            b.tube(pts, 0.022, rgba(rod * RNG.uniform(0.85, 1.1)), segs=5, cap=False)
    rect(x0, (y0 + y1) / 2, 0.15, y1 - y0, 0, "fence W")
    rect(x1, (y0 + y1) / 2, 0.15, y1 - y0, 0, "fence E")
    rect((x0 + x1) / 2, y1, x1 - x0, 0.15, 0, "fence N")
    # Watering can.
    wx, wy = x0 + 0.9, y0 - 0.6
    b.lathe((wx, wy, 0), [(0, 0.19), (0.32, 0.18), (0.38, 0.12)], col("7c9aa6"), segs=14, cap_bottom=True)
    b.tube([(wx + 0.12, wy, 0.1), (wx + 0.3, wy, 0.3), (wx + 0.42, wy, 0.45)], [0.035, 0.03, 0.025], col("7c9aa6"), segs=6)
    b.lathe((wx + 0.42, wy, 0.45), [(0, 0.03), (0.06, 0.06)], col("6a8a96"), segs=8, direction=(1, 0, 0.6))
    b.tube([(wx - 0.15, wy, 0.3), (wx - 0.05, wy, 0.52), (wx + 0.1, wy, 0.42)], 0.02, col("6a8a96"), segs=5, cap=False)
    # A little scarecrow-ish pole with a hat, for charm.
    b.lathe((x1 - 0.6, y1 - 0.5, 0), [(0, 0.04), (1.6, 0.035)], col("8a6040"), segs=6)
    b.beam((x1 - 1.0, y1 - 0.5, 1.2), (x1 - 0.2, y1 - 0.5, 1.2), 0.04, 0.04, col("8a6040"))
    b.blob((x1 - 0.6, y1 - 0.5, 1.5), 0.13, col("e6dcc6"), sub=2, amp=0.05)
    b.lathe((x1 - 0.6, y1 - 0.5, 1.58), [(0, 0.24), (0.02, 0.24), (0.03, 0.12), (0.16, 0.1), (0.17, 0.0)], col("c9a05a"), segs=14, cap_top=False)
    b.blob((x1 - 0.6, y1 - 0.6, 1.0), 0.15, col("c4493b"), scale=(1.6, 0.6, 1.3), sub=1, amp=0.1)


def build_stream(b, foliage):
    rnd = RNG
    for i in range(0, len(STREAM) - 1):
        p = STREAM[i]
        a = STREAM[min(len(STREAM) - 1, i + 1)]
        t = (a - p).normalized()
        n = Vector((-t.y, t.x))
        for side in (1, -1):
            q = p + n * side * rnd.uniform(1.85, 2.4)
            if any((q - Vector(s["at"])).length < 1.2 for s in SPOTS.values()) or path_dist(q) < 1.2:
                continue
            if rnd.random() < 0.75:
                rock(b, q.x, q.y, rnd.uniform(0.12, 0.32), moss=0.4)
            if rnd.random() < 0.45:
                q2 = p + n * side * rnd.uniform(2.1, 2.9)
                reeds(b, q2.x, q2.y, n=rnd.randint(4, 8))
            if rnd.random() < 0.25:
                q3 = p + n * side * rnd.uniform(3.0, 4.0)
                if path_dist(q3) > 1.6:
                    fern(b, q3.x, q3.y, rnd.uniform(0.7, 1.0))
            if rnd.random() < 0.18:
                q4 = p + n * side * rnd.uniform(0.6, 1.2)
                if all((q4 - Vector(s["at"])).length > 2.0 for s in SPOTS.values()) and abs(q4.x + 3.8) > 2:
                    lily(b, q4.x, q4.y)
    # Khina's pebble dam, half built.
    dx, dy = SPOTS["dam"]["face"]
    for k in range(10):
        rock(b, dx - 0.95 + k * 0.21, dy + rnd.uniform(-0.1, 0.1), rnd.uniform(0.11, 0.18), z=0.0, moss=0.15, scale=(1.2, 1, 0.7))
    for k in range(4):
        rock(b, dx - 0.6 + k * 0.3, dy + 0.18, rnd.uniform(0.09, 0.13), z=0.12, moss=0.0, scale=(1.2, 1, 0.7), sub=1)
    # Stepping stones further west.
    for k in range(5):
        q = Vector((-4.0 + k * 0.15, -16.5 - k * 0.8))
        b.lathe((q.x, q.y, -0.05), [(0, 0.44), (0.16, 0.42), (0.21, 0.3), (0.22, 0.0)], shade_fn("b2aca2", freq=3), segs=12, rough=0.1, cap_top=False)


def build_halt(b):
    for x in (RAILS_X - 0.75, RAILS_X + 0.75):
        b.box((x - 0.06, -72, 0.16), (0.12, 144, 0.12), col("8d8f93"))
        b.box((x - 0.04, -72, 0.27), (0.08, 144, 0.02), col("c8ccd0"))
    y = -72.0
    while y < 72:
        b.box((RAILS_X - 1.2, y, 0.0), (2.4, 0.3, 0.16), col("6b5442", 0.1))
        y += 0.9
    hx, hy = 44.6, -9.0
    px0, px1, py0, py1, top = PLATFORM
    b.box((hx - 1.4, hy - 6.5, 0), (2.8, 13, top - 0.02), shade_fn("b9ae9a", freq=0.6), bevel=0.03, segs=1)
    # Paving slabs on top, and a white edge line.
    yy = hy - 6.5
    while yy < hy + 6.5 - 0.01:
        for k, xs in enumerate((hx - 1.38, hx - 0.45, hx + 0.48)):
            b.box((xs, yy + 0.01, top - 0.03), (0.9, 0.58, 0.03), rgba(lin("c7bda9") * RNG.uniform(0.9, 1.06)), bevel=0.01, segs=1)
        yy += 0.6
    b.box((hx + 1.28, hy - 6.5, top - 0.01), (0.12, 13, 0.02), col("f3ecd8"))
    for k, h in enumerate((0.15, 0.3)):
        b.box((hx - 1.4 - 0.6 * (2 - k), hy - 0.9, 0), (0.6, 1.8, h), shade_fn("b2a998", freq=2), bevel=0.02, segs=1)
    # Shelter: posts, back wall, tiled roof, bench.
    green = col("4e6b5a")
    for px, py in ((hx - 1.1, hy - 4.6), (hx - 1.1, hy - 2.6), (hx + 0.9, hy - 4.6), (hx + 0.9, hy - 2.6)):
        b.box((px - 0.06, py - 0.06, top), (0.12, 0.12, 2.2), green, bevel=0.02, segs=1)
        circle(px, py, 0.12, "shelter post")
    for k in range(6):
        b.box((hx - 1.25, hy - 4.6 + k * 0.33, top), (0.06, 0.3, 1.9), rgba(lin("4e6b5a") * RNG.uniform(0.9, 1.1)), bevel=0.01, segs=1)
    b.box((hx - 1.4, hy - 4.9, 2.65), (2.6, 2.6, 0.12), green, bevel=0.03, segs=1)
    for k in range(9):
        b.box((hx - 1.45, hy - 4.95 + k * 0.3, 2.77), (2.7, 0.32, 0.04), rgba(lin("7a8f80") * RNG.uniform(0.9, 1.1)), rx=0.06)
    b.box((hx - 1.2, hy - 4.5, 0.85), (0.5, 1.8, 0.08), col("b08458"), bevel=0.015, segs=1)
    for py in (hy - 4.3, hy - 2.9):
        b.box((hx - 1.15, py, top), (0.08, 0.08, 0.4), green)
    # Name board and timetable.
    for py in (hy + 3.0, hy + 4.4):
        b.box((hx - 0.05, py, top), (0.1, 0.1, 1.8), col("3b3b3b"), bevel=0.015, segs=1)
        circle(hx, py + 0.05, 0.1, "board post")
    b.box((hx - 0.06, hy + 2.9, 1.9), (0.12, 1.7, 0.45), col("2f4f6f"), bevel=0.02)
    b.box((hx - 0.08, hy + 3.0, 1.98), (0.12, 1.5, 0.29), col("efe7d4"))
    tx, ty = SPOTS["timetable"]["face"]
    b.box((tx - 0.05, ty - 0.05, top), (0.1, 0.1, 1.0), col("3b3b3b"), bevel=0.015, segs=1)
    b.box((tx - 0.05, ty - 0.45, 1.0), (0.08, 0.9, 0.65), col("efe7d4"), bevel=0.015)
    for k in range(4):
        b.box((tx - 0.08, ty - 0.35, 1.5 - k * 0.13), (0.04, 0.7, 0.04), col("555555"))
    circle(tx, ty, 0.1, "timetable post")
    # Planters on the platform.
    for py in (hy - 6.0, hy + 5.6):
        b.box((hx - 1.2, py - 0.25, top), (0.5, 0.5, 0.4), shade_fn("8a5a3a", freq=4), bevel=0.02)


def build_woods_and_clearing(b, foliage):
    # A big stump where the birds are heard, and mushrooms where Khina forages.
    sx, sy = -19.6, 20.0
    z = height(sx, sy)
    bark = bark_shader("7a5638", sx, sy, z, 8, 2.0, moss=0.8)
    b.lathe((sx, sy, z - 0.1), [(0, 1.05), (0.15, 0.92), (0.4, 0.82), (0.74, 0.78)], bark, segs=20, ridges=8, rough=0.08, cap_color=None)
    rings = lin("d2b48c")

    def top_rings(co):
        r = math.hypot(co.x - sx, co.y - sy)
        return rgba(rings * (0.85 + 0.12 * math.sin(r * 40)))

    b.lathe((sx, sy, z + 0.64), [(0, 0.74), (0.005, 0.0)], top_rings, segs=20, cap_top=False)
    for k in range(5):
        a = k * 2 * math.pi / 5 + 0.3
        d = Vector((math.cos(a), math.sin(a), 0))
        b.tube([Vector((sx, sy, z + 0.3)) + d * 0.7, Vector((sx, sy, z + 0.05)) + d * 1.3, Vector((sx, sy, z - 0.1)) + d * 1.7], [0.22, 0.12, 0.03], bark, segs=8, cap=False)
    circle(sx, sy, 0.95, "stump")
    for k in range(10):
        a = RNG.uniform(0, 2 * math.pi)
        r = RNG.uniform(0.8, 2.6)
        mushroom(b, -15.0 + math.cos(a) * r, 15.0 + math.sin(a) * r)
    # The clearing: a fallen log and a fairy ring.
    cx, cy = CLEARING
    ang = 0.35
    d = Vector((math.cos(ang), math.sin(ang), 0.0))
    start = Vector((cx + 2.2, cy + 3.0, 0.4))
    b.lathe(start, [(0, 0.47), (1.5, 0.44), (3.4, 0.4)], bark_shader("7a5638", -999, -999, -9, 6, 4.0, moss=0), segs=14, direction=d, ridges=0, rough=0.08, cap_bottom=True, cap_color=col("c9a679"))
    for k in range(5):
        foliage.blob(start + d * (0.5 + k * 0.65) + Vector((0, 0, 0.38)), 0.24, col("6f9f45", 0.1), scale=(1.2, 1, 0.45), sub=1, amp=0.25)
    mushroom(b, start.x + d.x * 2.7 + 0.1, start.y + d.y * 2.7 - 0.45, small=True)
    mid = start + d * 1.7
    rect(mid.x, mid.y, 3.5, 1.0, ang, "fallen log")
    for k in range(14):
        a = 2 * math.pi * k / 14
        mushroom(b, cx - 2.2 + math.cos(a) * 1.5, cy + 1.2 + math.sin(a) * 1.5, small=True)
    for k in range(6):
        a = RNG.uniform(0, 2 * math.pi)
        r = RNG.uniform(4.0, 6.0)
        fern(b, cx + math.cos(a) * r, cy + math.sin(a) * r, RNG.uniform(0.8, 1.1))


def build_decor(b, foliage):
    """Rocks, bushes and ferns around the village, kept off paths, water and spots."""
    n = 0
    for _ in range(4000):
        p = Vector((RNG.uniform(-12, 46), RNG.uniform(-20, 24)))
        if path_dist(p) < 1.9 or stream_dist(p) < 3.0 or (p - SQUARE).length < 6.9 or abs(p.x - RAILS_X) < 3.5:
            continue
        if any((p - Vector(s["at"])).length < 2.0 for s in SPOTS.values()):
            continue
        if any((p - k).length < 2.5 for k in NODES.values()):
            continue
        if 26 < p.x < 40 and 2 < p.y < 12 or 2.5 < p.x < 10.5 and 3 < p.y < 10 or -3.5 < p.x < 3.5 and -0.5 < p.y < 6.5:
            continue
        x0, x1, y0, y1 = PATCH_RECT
        if x0 - 1.0 < p.x < x1 + 1.0 and y0 - 1.5 < p.y < y1 + 1.0:
            continue
        if 42 < p.x < 47 and -16 < p.y < -1:
            continue
        r = RNG.random()
        if r < 0.3:
            rr = RNG.uniform(0.15, 0.55)
            rock(b, p.x, p.y, rr)
            if rr > 0.35:
                circle(p.x, p.y, rr * 1.0, "rock")
        elif r < 0.62:
            s = RNG.uniform(0.7, 1.3)
            bush(foliage, p.x, p.y, s, flowers=RNG.choice([None, None, "f2a0b5", "fbf6ec", "f6d55e"]), deco=b)
        else:
            fern(b, p.x, p.y, RNG.uniform(0.6, 1.0))
        n += 1
        if n > 120:
            break
    # The woods floor: ferns, rocks and mushrooms between the trees.
    for _ in range(140):
        a = RNG.uniform(0, 2 * math.pi)
        r = RNG.uniform(2, 20)
        p = WOODS + Vector((math.cos(a) * r, math.sin(a) * r))
        if path_dist(p) < 1.9 or any((p - Vector(s["at"])).length < 1.8 for s in SPOTS.values()):
            continue
        k = RNG.random()
        if k < 0.55:
            fern(b, p.x, p.y, RNG.uniform(0.8, 1.2))
        elif k < 0.8:
            rr = RNG.uniform(0.2, 0.6)
            rock(b, p.x, p.y, rr, moss=0.9)
            if rr > 0.35:
                circle(p.x, p.y, rr, "rock")
        else:
            mushroom(b, p.x, p.y, small=RNG.random() < 0.5)


# ---------- terrain for the browser ----------
def build_terrain_json(path):
    x0, x1, y0, y1 = -72, 90, -62, 72
    nx, ny = x1 - x0 + 1, y1 - y0 + 1
    shade = tree_shade_lookup()
    px0, px1, py0, py1, top = PLATFORM
    hs, gs = [], []
    for j in range(ny):
        for i in range(nx):
            x, y = x0 + i, y0 + j
            p = Vector((x, y))
            ds = stream_dist(p)
            dp = path_dist(p)
            h = height(x, y, ds)
            if px0 <= x <= px1 and py0 <= y <= py1:
                h = top
            g = 1.0 - 0.65 * smooth(18, 10, (p - WOODS).length)
            g *= 1.0 - 0.45 * shade(x, y)
            g = max(g, smooth(6.5, 4.0, (p - CLEARING).length))  # the clearing is a meadow
            g *= smooth(0.9, 1.5, dp)
            g *= smooth(5.9, 6.3, (p - SQUARE).length)
            g *= smooth(2.15, 2.6, ds)
            g *= smooth(2.2, 2.8, abs(x - RAILS_X))
            if px0 - 1.4 <= x <= px1 + 0.3 and py0 - 0.3 <= y <= py1 + 0.3:
                g = 0.0
            xa, xb, ya, yb = PATCH_RECT
            if xa - 0.3 <= x <= xb + 0.3 and ya - 0.3 <= y <= yb + 0.3:
                g = 0.0
            if abs(x - SHED.x) <= 1.9 and abs(y - SHED.y) <= 1.6:
                g = 0.0
            if 29.8 <= x <= 36.2 and 4.4 <= y <= 10.2:
                g = 0.0
            if (p - OAK).length < 2.3 or (p - Vector((0, 0.7))).length < 0.9:
                g = 0.0
            hs.append(round(h, 3))
            gs.append(round(g, 2))
    colliders = [{k: v for k, v in c.items() if not k.startswith("_")} for c in COLLIDERS]
    data = {"origin": [x0, y0], "step": 1, "nx": nx, "ny": ny, "height": hs, "grass": gs, "colliders": colliders}
    with open(path, "w") as f:
        json.dump(data, f, separators=(",", ":"))
    return nx, ny


def overlaps(c, x, y, r):
    if c["kind"] == "circle":
        return math.hypot(x - c["x"], y - c["y"]) < c["r"] + r
    cs, sn = math.cos(-c["rot"]), math.sin(-c["rot"])
    lx = (x - c["x"]) * cs - (y - c["y"]) * sn
    ly = (x - c["x"]) * sn + (y - c["y"]) * cs
    qx = max(-c["w"] / 2, min(c["w"] / 2, lx))
    qy = max(-c["d"] / 2, min(c["d"] / 2, ly))
    return math.hypot(lx - qx, ly - qy) < r


def check_colliders():
    """No collider may sit on a path or on a spot Khina stands at (spots on props are exempt)."""
    bad = set()
    for name, s in SPOTS.items():
        if "z" in s or s.get("inside"):
            continue
        for i, c in enumerate(COLLIDERS):
            if overlaps(c, s["at"][0], s["at"][1], 0.2):
                print("COLLIDER-ON-SPOT", name, c["_why"], c)
                bad.add(i)
    for a, b in SEGMENTS:
        n = max(2, int((b - a).length / 0.4))
        for k in range(n + 1):
            p = a + (b - a) * (k / n)
            for i, c in enumerate(COLLIDERS):
                if i not in bad and not c.get("_keep") and overlaps(c, p.x, p.y, 0.15):
                    print("COLLIDER-ON-PATH", c["_why"], c, "at", tuple(round(v, 2) for v in p))
                    bad.add(i)
    for i in sorted(bad, reverse=True):
        COLLIDERS.pop(i)
    return len(bad)


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
    for vt in ("AgX", "Filmic", "Standard"):
        try:
            scene.view_settings.view_transform = vt
            break
        except TypeError:
            continue
    try:
        scene.view_settings.look = "AgX - Medium High Contrast"
    except TypeError:
        pass
    ee = scene.eevee
    for attr, val in (("taa_render_samples", 48), ("use_fast_gi", True), ("use_raytracing", True), ("shadow_ray_count", 2), ("shadow_step_count", 8)):
        try:
            setattr(ee, attr, val)
        except Exception:
            pass
    world = bpy.data.worlds.new("World")
    scene.world = world
    try:
        world.use_nodes = True
    except Exception:
        pass
    nt = world.node_tree
    bg = nt.nodes.get("Background")
    # Sky-coloured light from above, warmer near the horizon.
    bg.inputs["Color"].default_value = rgba(lin("b9d6ee"))
    bg.inputs["Strength"].default_value = 1.1
    sun = bpy.data.objects.new("Sun", bpy.data.lights.new("Sun", "SUN"))
    sun.data.energy = 4.2
    sun.data.color = (1.0, 0.9, 0.76)
    try:
        sun.data.angle = math.radians(4)
    except Exception:
        pass
    sun.rotation_euler = (math.radians(50), math.radians(14), math.radians(-35))
    scene.collection.objects.link(sun)
    cam = bpy.data.objects.new("Cam", bpy.data.cameras.new("Cam"))
    scene.collection.objects.link(cam)
    scene.camera = cam
    out = os.path.join(HERE, "previews")
    os.makedirs(out, exist_ok=True)
    shots = {
        "map": dict(loc=(10, 5, 140), target=(10, 5, 0), ortho=150, size=(1000, 900)),
        "village": dict(loc=(14, -38, 24), target=(16, 4, 0), lens=30, size=(1400, 800)),
        "home": dict(loc=(5.5, -9.5, 3.8), target=(1.5, 2.0, 1.6), lens=28, size=(1200, 800)),
        "square": dict(loc=(22, -15, 5), target=(30, 2, 1.2), lens=26, size=(1200, 800)),
    }
    # Extra close-ups for checking by eye (SHOTS=stream,woods DEBUG_OUT=/some/dir); not saved as previews.
    extra = {
        "stream": dict(loc=(17, -10.5, 3.2), target=(11, -17.5, 0.2), lens=26, size=(1200, 800)),
        "woods": dict(loc=(-8.5, 13.6, 2.6), target=(-17, 18, 0.8), lens=26, size=(1200, 800)),
        "tree": dict(loc=(-4, -6, 3.0), target=(-10, -1, 3.0), lens=35, size=(900, 700)),
    }
    only = os.environ.get("SHOTS")
    debug_out = os.environ.get("DEBUG_OUT")
    if only and debug_out:
        shots.update(extra)
    for name, s in shots.items():
        if only and name not in only.split(","):
            continue
        cam.location = s["loc"]
        look_at(cam, s["target"])
        if "ortho" in s:
            cam.data.type = "ORTHO"
            cam.data.ortho_scale = s["ortho"]
            cam.rotation_euler = (0, 0, 0)
        else:
            cam.data.type = "PERSP"
            cam.data.lens = s["lens"]
        cam.data.clip_end = 500
        scene.render.resolution_x, scene.render.resolution_y = s["size"]
        scene.render.filepath = os.path.join(debug_out if name in extra else out, f"village-{name}.png")
        bpy.ops.render.render(write_still=True)
    for ob in (sun, cam):
        bpy.data.objects.remove(ob)


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    village = material("Village", rough=0.9)
    foliage_m = material("Foliage", rough=0.8)
    water_m = material("WaterM", "6fb4d6", rough=0.08, vertex_colors=False)
    glow_m = material("GlowM", "ffcf73", rough=0.5, vertex_colors=False, emission=2.0)

    trunks, foliage = Batch(), Batch()
    n = build_trees(trunks, foliage)

    burrow, glow_b, flag = Batch(), Batch(), Batch()
    build_burrow(burrow, foliage, glow_b, flag)
    shed = Batch()
    build_shed(shed, foliage)
    bakery, glow_k = Batch(), Batch()
    build_bakery(bakery, glow_k, foliage)
    square, glow_l = Batch(), Batch()
    build_square(square, glow_l, foliage)
    patch, stream, halt, woods, decor = Batch(), Batch(), Batch(), Batch(), Batch()
    build_patch(patch, foliage)
    build_stream(stream, foliage)
    build_halt(halt)
    build_woods_and_clearing(woods, foliage)
    build_decor(decor, foliage)

    build_ground(village)
    build_water(water_m)
    trunks.to_object("Trunks", village)
    foliage.to_object("Foliage", foliage_m, sharp_angle=1.4)
    burrow.to_object("Burrow", village)
    glow_b.to_object("Glow.burrow", glow_m)
    flag_ob = flag.to_object("Flag.letterbox", village)
    shed.to_object("Shed", village)
    bakery.to_object("Bakery", village)
    glow_k.to_object("Glow.bakery", glow_m)
    square.to_object("Square", village)
    glow_l.to_object("Glow.lamp", glow_m)
    for name, bt in (("Patch", patch), ("Stream", stream), ("Halt", halt), ("WoodsAndClearing", woods), ("Decor", decor)):
        bt.to_object(name, village)

    # The flag pivots on its post: move the object origin there so the browser can rotate it.
    lx, ly = SPOTS["letterbox"]["face"]
    pivot = Vector((lx + 0.26, ly - 0.02, 1.08))
    flag_ob.data.transform(Matrix.Translation(-pivot))
    flag_ob.location = pivot

    dropped = check_colliders()
    os.makedirs(os.path.join(HERE, "export"), exist_ok=True)
    nx, ny = build_terrain_json(os.path.join(HERE, "export", "terrain.json"))
    if not os.environ.get("NO_PREVIEW"):
        render_previews(scene)
    bpy.ops.export_scene.gltf(filepath=os.path.join(HERE, "export", "village.glb"), export_format="GLB")
    bpy.context.preferences.filepaths.save_version = 0  # no .blend1 backups
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(HERE, "village.blend"))
    per = {ob.name: sum(len(p.vertices) - 2 for p in ob.data.polygons) for ob in bpy.data.objects if ob.type == "MESH"}
    kinds = {}
    for c in COLLIDERS:
        kinds[c["kind"]] = kinds.get(c["kind"], 0) + 1
    print("VILLAGE-TRIS", per)
    print("VILLAGE-TREES", sorted(TREE_KINDS.items()))
    print("VILLAGE-DONE trees", n, "triangles", sum(per.values()), "colliders", kinds, "dropped", dropped, "terrain", nx, ny)


main()
