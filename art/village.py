# Builds the forest village in Blender from art/layout.json, renders previews, exports a .glb.
# Run: npm run layout, then
#   /Applications/Blender.app/Contents/MacOS/Blender --background --python art/village.py
# Outputs: art/village.blend (editable), art/export/village.glb, art/previews/village-*.png
#
# Low-poly, flat-shaded, coloured per vertex: one material for nearly everything keeps it light
# in the browser. Objects the browser changes at runtime are kept separate and named:
#   Glow.burrow, Glow.bakery, Glow.lamp (windows and the lamp, lit at night or when someone is in)
#   Flag.letterbox (raised when there is post), Water.
# Coordinates: metres, x east, y north, z up. Fronts face south (-y), toward the default camera.

import json
import math
import os
import random

import bmesh
import bpy
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
with open(os.path.join(HERE, "layout.json")) as f:
    L = json.load(f)
RNG = random.Random(11)

PLACES = {k: Vector((v[0], v[1])) for k, v in L["places"].items()}
NODES = {k: Vector((v[0], v[1])) for k, v in L["nodes"].items()}  # where paths meet places
SEGMENTS = [(NODES[a], NODES[b]) for a, b in L["paths"]]
SPOTS = L["spots"]


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


def noise(x, y):
    return (math.sin(x * 0.13 + y * 0.07) + math.sin(x * 0.051 - y * 0.113 + 1.3) + 0.6 * math.sin(x * 0.31 + y * 0.27 + 4.1)) / 2.6


# ---------- geometry ----------
def facing(direction):
    d = Vector(direction).normalized()
    up = "X" if abs(d.y) > 0.9 else "Y"
    return d.to_track_quat("Z", up).to_matrix().to_4x4()


class Batch:
    """Many primitives in one mesh, each coloured by its own vertex colour."""

    def __init__(self):
        self.bm = bmesh.new()
        self.col = self.bm.loops.layers.float_color.new("Col")

    def _paint(self, verts, color):
        # Paint the faces of the new shape. (Not "every face after index n": bmesh reuses freed slots.)
        faces = set()
        for v in verts:
            faces.update(v.link_faces)
        for f in faces:
            for loop in f.loops:
                loop[self.col] = color

    def box(self, corner, size, color, rz=0.0, centered=False):
        """A box from its lowest corner (or, with centered=True, from the middle of its base)."""
        x, y, z = corner
        if not centered:
            x, y = x + size[0] / 2, y + size[1] / 2
        M = Matrix.Translation((x, y, z + size[2] / 2)) @ Matrix.Rotation(rz, 4, "Z") @ Matrix.Diagonal((size[0], size[1], size[2], 1.0))
        res = bmesh.ops.create_cube(self.bm, size=1.0, matrix=M)
        self._paint(res["verts"], color)

    def cyl(self, base, length, r1, r2, color, segs=8, direction=(0, 0, 1)):
        M = Matrix.Translation(base) @ facing(direction) @ Matrix.Translation((0, 0, length / 2))
        res = bmesh.ops.create_cone(self.bm, cap_ends=True, cap_tris=False, segments=segs, radius1=r1, radius2=r2, depth=length, matrix=M)
        self._paint(res["verts"], color)

    def ico(self, center, r, color, scale=(1, 1, 1), sub=1, rough=0.0):
        M = Matrix.Translation(center) @ Matrix.Diagonal((r * scale[0], r * scale[1], r * scale[2], 1.0))
        res = bmesh.ops.create_icosphere(self.bm, subdivisions=sub, radius=1.0, matrix=M)
        if rough:
            for v in res["verts"]:
                v.co += Vector((RNG.uniform(-1, 1), RNG.uniform(-1, 1), RNG.uniform(-1, 1))) * r * rough
        self._paint(res["verts"], color)

    def gable(self, base, w, d, h, color, over=0.3):
        """A pitched roof, ridge along x."""
        o = Vector(base)
        W, D = w / 2 + over, d / 2 + over
        pts = [(-W, -D, 0), (W, -D, 0), (W, D, 0), (-W, D, 0), (-W, 0, h), (W, 0, h)]
        v = [self.bm.verts.new(o + Vector(p)) for p in pts]
        for f in ((v[0], v[3], v[2], v[1]), (v[0], v[1], v[5], v[4]), (v[2], v[3], v[4], v[5]), (v[3], v[0], v[4]), (v[1], v[2], v[5])):
            self.bm.faces.new(f)
        self._paint(v, color)

    def to_object(self, name, mat, smooth_shade=False, recalc=True):
        if recalc:
            bmesh.ops.recalc_face_normals(self.bm, faces=self.bm.faces)
        me = bpy.data.meshes.new(name)
        self.bm.to_mesh(me)
        self.bm.free()
        for p in me.polygons:
            p.use_smooth = smooth_shade
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


STREAM = catmull([(-80, -10), (-52, -14), (-30, -20.5), (-10, -18.5), (4, -17.8), (16, -18.2), (26, -21), (33, -29), (36, -44), (37, -70)])
STREAM_SEGS = list(zip(STREAM[:-1], STREAM[1:]))
RAILS_X = 47.0


def stream_dist(p):
    return min(seg_dist(p, a, b) for a, b in STREAM_SEGS)


def path_dist(p):
    return min(seg_dist(p, a, b) for a, b in SEGMENTS)


def height(x, y, ds=None):
    p = Vector((x, y))
    r = (p - Vector((12, 6))).length
    h = smooth(44, 80, r) * 9 + noise(x * 1.7, y * 1.7) * 0.5 * smooth(36, 56, r)
    h *= smooth(3.5, 8.0, abs(x - RAILS_X))
    h *= smooth(3.0, 9.0, stream_dist(p) if ds is None else ds)
    return h


SQUARE = PLACES["square"]
PATCH_RECT = (14.6, 21.6, 9.0, 13.6)
CLEARING = PLACES["clearing"]
WOODS = PLACES["woods"]


def ground_color(x, y, ds, dp):
    p = Vector((x, y))
    n = noise(x * 2.3, y * 2.3)
    grass = mixv(lin("86b05c"), lin("a1c46c"), 0.5 + 0.5 * n)
    grass = mixv(grass, lin("6e954c"), smooth(18, 6, (p - WOODS).length) * 0.8)
    grass = mixv(grass, lin("93b35a"), smooth(7, 4, (p - CLEARING).length))
    c = grass
    c = mixv(c, lin("cdb788"), smooth(3.2, 1.8, ds))  # sandy banks
    c = mixv(c, lin("c9ab7c") * (0.95 + 0.05 * n), smooth(1.25, 0.75, dp))  # dirt paths
    c = mixv(c, lin("bdb3a2") * (0.92 + 0.08 * noise(x * 9, y * 9)), smooth(5.8, 5.2, (p - SQUARE).length))
    x0, x1, y0, y1 = PATCH_RECT
    if x0 < x < x1 and y0 < y < y1:
        c = lin("7c5b3d")
    c = mixv(c, lin("a39a8b"), smooth(2.2, 1.4, abs(x - RAILS_X)))  # ballast
    return rgba(c)


def build_ground(mat):
    bm = bmesh.new()
    lay = bm.loops.layers.float_color.new("Col")
    x0, x1, y0, y1, step = -72, 90, -62, 72, 1.0
    nx, ny = int((x1 - x0) / step), int((y1 - y0) / step)
    rows, colors = [], {}
    for j in range(ny + 1):
        row = []
        for i in range(nx + 1):
            x, y = x0 + i * step, y0 + j * step
            p = Vector((x, y))
            ds = stream_dist(p)
            dp = path_dist(p)
            v = bm.verts.new((x, y, height(x, y, ds)))
            colors[v] = ground_color(x, y, ds, dp)
            row.append(v)
        rows.append(row)
    for j in range(ny):
        for i in range(nx):
            f = bm.faces.new((rows[j][i], rows[j][i + 1], rows[j + 1][i + 1], rows[j + 1][i]))
            for loop in f.loops:
                loop[lay] = colors[loop.vert]
    me = bpy.data.meshes.new("Ground")
    bm.to_mesh(me)
    bm.free()
    for p in me.polygons:
        p.use_smooth = True
    me.materials.append(mat)
    ob = bpy.data.objects.new("Ground", me)
    bpy.context.collection.objects.link(ob)
    return ob


def build_water(mat):
    bm = bmesh.new()
    left, right = [], []
    for i, p in enumerate(STREAM):
        a = STREAM[max(0, i - 1)]
        b = STREAM[min(len(STREAM) - 1, i + 1)]
        t = (b - a).normalized()
        n = Vector((-t.y, t.x))
        w = 3.3 + 0.5 * math.sin(i * 0.7)
        left.append(bm.verts.new((*(p + n * w / 2), 0.06)))
        right.append(bm.verts.new((*(p - n * w / 2), 0.06)))
    for i in range(len(STREAM) - 1):
        bm.faces.new((right[i], right[i + 1], left[i + 1], left[i]))
    me = bpy.data.meshes.new("Water")
    bm.to_mesh(me)
    bm.free()
    for p in me.polygons:
        p.use_smooth = True
    me.materials.append(mat)
    ob = bpy.data.objects.new("Water", me)
    bpy.context.collection.objects.link(ob)
    return ob


# ---------- trees ----------
LEAVES = ["6aa84f", "7cb35a", "5b9a48", "8bbf5f", "74a94c"]
NEEDLES = ["3f7a4a", "4b8a52", "2f6b42", "457f4c"]
BARK = "6e4f36"


def round_tree(b, x, y, s=1.0, blobs=3):
    z = height(x, y)
    h = RNG.uniform(1.8, 2.8) * s
    b.cyl((x, y, z - 0.2), h + 0.6, 0.32 * s, 0.2 * s, col(BARK, 0.15), segs=7)
    leaf = RNG.choice(LEAVES)
    top = z + h + 0.4
    b.ico((x, y, top + 0.6 * s), 1.8 * s, col(leaf, 0.12), scale=(1, 1, 0.9), rough=0.12)
    for _ in range(blobs - 1):
        a = RNG.uniform(0, 2 * math.pi)
        b.ico((x + math.cos(a) * 1.0 * s, y + math.sin(a) * 1.0 * s, top + RNG.uniform(-0.2, 0.9) * s), RNG.uniform(1.1, 1.5) * s, col(leaf, 0.14), rough=0.14)


def pine(b, x, y, s=1.0):
    z = height(x, y)
    b.cyl((x, y, z - 0.2), 1.4 * s, 0.24 * s, 0.18 * s, col(BARK, 0.15), segs=6)
    c = RNG.choice(NEEDLES)
    for k, (r, hh) in enumerate(((1.7, 2.4), (1.3, 2.1), (0.85, 1.7))):
        b.cyl((x, y, z + (0.9 + k * 1.15) * s), hh * s, r * s, 0.05, col(c, 0.1 + 0.03 * k), segs=7)


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


def build_trees(b):
    trees = {}
    placed = 0
    for _ in range(9000):
        p = Vector((RNG.uniform(-70, 88), RNG.uniform(-60, 70)))
        core = -8 < p.x < 42 and -14 < p.y < 18
        in_woods = (p - WOODS).length < 20 or (p - CLEARING).length < 14
        prob = 0.05 if core and not in_woods else 0.95 if in_woods else 0.7
        if RNG.random() > prob:
            continue
        spacing = 2.5 if in_woods else 3.2
        if not tree_ok(p, trees, spacing):
            continue
        trees.setdefault((int(p.x // 3), int(p.y // 3)), []).append(p)
        far = (p - Vector((12, 6))).length > 50
        s = RNG.uniform(0.85, 1.25)
        if RNG.random() < (0.55 if in_woods or p.y > 30 else 0.3):
            pine(b, p.x, p.y, s * 1.1)
        else:
            round_tree(b, p.x, p.y, s, blobs=2 if far else 3)
        placed += 1
        if placed >= 560:
            break
    return placed


# ---------- places ----------
def build_burrow(b, glow, flag):
    """Khina's home: a round door in the roots of a great oak."""
    ox, oy = 0.0, 2.8
    b.cyl((ox, oy, -0.2), 5.6, 1.95, 1.15, col("6a4b33"), segs=12)
    for deg in (25, 75, 130, 180, 215, 335):
        a = math.radians(deg)
        d = Vector((math.cos(a), math.sin(a), -0.32)).normalized()
        b.cyl((ox + math.cos(a) * 1.0, oy + math.sin(a) * 1.0, 0.75), 2.5, 0.6, 0.16, col("634631", 0.08), segs=7, direction=d)
    # Branches into the crown, and the crown.
    for deg, up in ((40, 0.8), (160, 0.7), (280, 0.75)):
        a = math.radians(deg)
        b.cyl((ox, oy, 4.6), 2.6, 0.45, 0.2, col("634631"), segs=6, direction=(math.cos(a), math.sin(a), up))
    for dx, dy, dz, r in ((0, 0, 7.6, 3.3), (-2.7, -0.5, 6.9, 2.6), (2.7, 0.5, 7.0, 2.7), (0.5, 2.6, 7.3, 2.6), (-1.3, 1.5, 8.9, 2.3), (1.5, -1.8, 8.2, 2.3), (-0.8, -2.2, 6.6, 2.1)):
        b.ico((ox + dx, oy + dy, dz), r, col(RNG.choice(LEAVES[:3]), 0.1), sub=2, rough=0.08)
    # Round door with a frame and a brass knob, facing the path.
    front = oy - 1.62
    b.cyl((ox, front, 0.92), 0.22, 0.9, 0.9, col("4a3222"), segs=20, direction=(0, -1, 0))
    b.cyl((ox, front - 0.05, 0.92), 0.22, 0.74, 0.74, col("4f8a52"), segs=20, direction=(0, -1, 0))
    b.ico((ox + 0.42, front - 0.3, 0.88), 0.07, col("e0b44c"), sub=1)
    # Round window up and to the right, lit from inside when Khina is home.
    a = math.radians(-58)
    wd = Vector((math.cos(a), math.sin(a), 0.0))
    wc = Vector((ox, oy, 2.4)) + wd * 1.38
    b.cyl(wc, 0.24, 0.5, 0.5, col("4a3222"), segs=16, direction=wd)
    glow.cyl(wc + wd * 0.1, 0.18, 0.38, 0.38, col("ffffff"), segs=16, direction=wd)
    b.box((wc.x - 0.03, wc.y - 0.02, wc.z - 0.38), (0.06, 0.06, 0.76), col("4a3222"))  # glazing bar
    # Stove pipe through the roots.
    cx, cy, cz = L["chimneys"]["burrow"]
    b.cyl((cx, cy, 0.0), cz - 0.25, 0.16, 0.16, col("5c5652"), segs=8)
    b.cyl((cx, cy, cz - 0.3), 0.3, 0.26, 0.2, col("4b4643"), segs=8)
    # Doorstep, woodpile, flower pots.
    b.cyl((ox, oy - 2.05, -0.1), 0.18, 0.75, 0.8, col("b9ae9c"), segs=10)
    for k in range(5):
        b.cyl((-2.1 + (k % 3) * 0.42 - (k // 3) * 0.2, 0.5, 0.2 + (k // 3) * 0.36), 1.0, 0.18, 0.18, col("8a6040", 0.1), segs=7, direction=(0, 1, 0))
    for px, flower in ((1.25, "f2a0b5"), (-1.2, "f6d55e")):
        b.cyl((px, 1.0, 0), 0.32, 0.2, 0.25, col("b8673f"), segs=8)
        b.ico((px, 1.0, 0.42), 0.2, col("6aa84f"), rough=0.2)
        b.ico((px + 0.05, 0.92, 0.55), 0.08, col(flower), sub=1)
    # Letterbox: a red box on a post; its flag rises when there is post.
    lx, ly = SPOTS["letterbox"]["face"]
    b.box((lx - 0.06, ly - 0.06, 0), (0.12, 0.12, 1.0), col("6b4a30"))
    b.box((lx - 0.22, ly - 0.3, 1.0), (0.44, 0.6, 0.34), col("c4493b"))
    b.cyl((lx, ly - 0.3, 1.34), 0.6, 0.22, 0.22, col("c4493b"), segs=10, direction=(0, 1, 0))
    b.box((lx - 0.15, ly - 0.32, 1.1), (0.3, 0.02, 0.06), col("2b2b2b"))  # slot
    flag.box((lx + 0.24, ly - 0.05, 1.05), (0.04, 0.06, 0.5), col("3d3d3d"))
    flag.box((lx + 0.24, ly - 0.05, 1.45), (0.04, 0.26, 0.16), col("f0c13e"))


def build_shed(b):
    sx, sy = 6.6, 6.9
    b.box((sx - 1.7, sy - 1.3, 0), (3.4, 2.6, 2.2), col("a8774f"))
    for k in range(7):  # planks
        b.box((sx - 1.72 + k * 0.5, sy - 1.33, 0), (0.04, 0.04, 2.2), col("8a5f3c"))
    b.gable((sx, sy, 2.2), 3.4, 2.6, 1.2, col("5d6b55"), over=0.35)
    b.box((sx + 0.55, sy - 1.36, 0), (0.85, 0.08, 1.65), col("6b4a30"))
    b.box((sx - 1.15, sy - 1.36, 1.0), (0.8, 0.06, 0.6), col("3d4a52"))
    # Workbench in front, low enough for a hedgehog.
    bx, by = 5.0, 4.6
    b.box((bx - 1.6, by - 0.4, 0.45), (3.2, 0.8, 0.1), col("b08458"))
    for lx in (-1.5, 1.4):
        for ly in (-0.32, 0.25):
            b.box((bx + lx, by + ly, 0), (0.1, 0.1, 0.45), col("8a6040"))
    b.box((bx - 1.5, by - 0.3, 0.12), (3.0, 0.6, 0.05), col("8a6040"))
    # On the bench: shavings, a mallet, a jar of charcoal, a little carved bird.
    b.box((bx - 0.2, by - 0.1, 0.55), (0.5, 0.2, 0.06), col("e3c08c"))
    b.cyl((bx + 0.9, by, 0.55), 0.18, 0.1, 0.1, col("8a6040"), segs=8, direction=(1, 0, 0))
    b.cyl((bx + 0.8, by - 0.05, 0.6), 0.45, 0.03, 0.03, col("c9a46e"), segs=5, direction=(0, -1, 0.1))
    b.cyl((bx - 1.1, by + 0.1, 0.55), 0.22, 0.09, 0.09, col("cfe3e6"), segs=10)
    b.cyl((bx - 1.12, by + 0.1, 0.6), 0.22, 0.015, 0.015, col("222222"), segs=4, direction=(0.2, 0, 1))
    b.ico((bx + 0.3, by + 0.15, 0.62), 0.08, col("d9b98a"), scale=(1.4, 1, 1))
    # Sawhorse and offcuts.
    b.box((sx + 2.3, sy - 2.2, 0.0), (0.12, 0.9, 0.5), col("8a6040"))
    b.box((sx + 2.0, sy - 2.2, 0.5), (1.0, 0.25, 0.12), col("b08458"))


def build_bakery(b, glow):
    x, y = 33.0, 7.6
    w, d = 6.0, 4.8
    front = y - d / 2
    b.box((x - w / 2, y - d / 2, 0), (w, d, 3.0), col("efe0c4"))
    for dx in (-w / 2, w / 2 - 0.2):  # corner beams
        b.box((x + dx, front - 0.05, 0), (0.2, 0.2, 3.0), col("6a4630"))
    b.box((x - w / 2, front - 0.06, 2.85), (w, 0.2, 0.18), col("6a4630"))
    b.gable((x, y, 3.0), w, d, 2.4, col("b5573f"), over=0.4)
    cx, cy, cz = L["chimneys"]["bakery"]
    b.box((cx - 0.35, cy - 0.35, 3.0), (0.7, 0.7, cz - 3.0), col("9a4d3a"))
    b.box((cx - 0.42, cy - 0.42, cz - 0.15), (0.84, 0.84, 0.15), col("7f3f30"))
    dx, dy = L["doors"]["bakery"]
    b.box((dx - 0.6, front - 0.1, 0), (1.2, 0.12, 2.1), col("6a3f2a"))
    b.ico((dx + 0.38, front - 0.2, 1.0), 0.06, col("e0b44c"))
    b.box((dx - 0.75, front - 0.65, -0.1), (1.5, 0.6, 0.16), col("b9ae9c"))  # step
    for wx in (x - 1.9, x + 1.9):
        b.box((wx - 0.62, front - 0.08, 1.05), (1.24, 0.1, 1.1), col("6a4630"))
        glow.box((wx - 0.5, front - 0.12, 1.15), (1.0, 0.06, 0.9), col("ffffff"))
        b.box((wx - 0.03, front - 0.16, 1.15), (0.06, 0.06, 0.9), col("6a4630"))
        b.box((wx - 0.7, front - 0.5, 0.75), (1.4, 0.42, 0.3), col("8a5a3a"))  # flower box
        for k in range(5):
            b.ico((wx - 0.55 + k * 0.27, front - 0.3, 1.1), 0.16, col("6aa84f", 0.1), rough=0.2)
            b.ico((wx - 0.55 + k * 0.27, front - 0.42, 1.24), 0.07, col(RNG.choice(["e8535a", "f2a0b5", "f6d55e"])))
    # Hanging sign with a loaf.
    b.box((x + w / 2 - 0.1, front - 0.9, 2.45), (0.08, 1.0, 0.08), col("3d3d3d"))
    b.box((x + w / 2 - 0.12, front - 0.85, 1.75), (0.06, 0.8, 0.62), col("d9b26a"))
    b.ico((x + w / 2 - 0.17, front - 0.45, 2.06), 0.22, col("b7742f"), scale=(0.5, 1.3, 0.8))
    # A crate of yesterday's crusts out front.
    cx2, cy2 = SPOTS["crusts"]["face"]
    b.box((cx2 - 0.4, cy2 - 0.3, 0), (0.8, 0.6, 0.45), col("b08458"))
    for k in range(4):
        b.ico((cx2 - 0.25 + k * 0.17, cy2 + RNG.uniform(-0.1, 0.1), 0.5), 0.14, col("c58a45", 0.1), scale=(1.3, 0.9, 0.7))


def build_square(b, glow):
    sx, sy = SQUARE
    for k in range(36):  # kerb
        a = 2 * math.pi * k / 36
        b.box((sx + math.cos(a) * 5.6, sy + math.sin(a) * 5.6, -0.05), (0.7, 0.35, 0.16), col("a39b8e", 0.06), rz=a + math.pi / 2, centered=True)
    # Well with a little roof.
    wx, wy = sx, sy - 0.4
    b.cyl((wx, wy, 0), 0.8, 1.0, 1.0, col("a59f95"), segs=14)
    b.cyl((wx, wy, 0.79), 0.03, 0.78, 0.78, col("34515e"), segs=14)
    for px in (-0.85, 0.85):
        b.box((wx + px - 0.07, wy - 0.07, 0.8), (0.14, 0.14, 1.5), col("6b4a30"))
    b.gable((wx, wy, 2.3), 1.9, 1.4, 0.7, col("b5573f"), over=0.15)
    b.cyl((wx - 0.8, wy, 1.9), 1.6, 0.06, 0.06, col("6b4a30"), segs=6, direction=(1, 0, 0))
    b.cyl((wx + 0.2, wy, 1.2), 0.32, 0.18, 0.2, col("8a6040"), segs=8)
    # Bench facing the well, deep enough for a hedgehog to sit on.
    bx, by = SPOTS["bench"]["at"]
    seat = SPOTS["bench"]["z"]
    b.box((bx - 1.3, by - 0.3, seat - 0.08), (2.6, 0.95, 0.08), col("b08458"))
    b.box((bx - 1.3, by + 0.62, seat), (2.6, 0.08, 0.55), col("b08458"))
    for lx in (-1.2, 1.1):
        for ly in (-0.25, 0.55):
            b.box((bx + lx, by + ly, 0), (0.1, 0.1, seat - 0.08), col("6b4a30"))
    # Lamp post.
    lx, ly = sx + 4.4, sy - 3.6
    b.cyl((lx, ly, 0), 2.6, 0.09, 0.07, col("3b3b3b"), segs=8)
    b.box((lx - 0.22, ly - 0.22, 2.55), (0.44, 0.44, 0.06), col("3b3b3b"))
    glow.box((lx - 0.17, ly - 0.17, 2.61), (0.34, 0.34, 0.42), col("ffffff"))
    b.gable((lx, ly, 3.03), 0.44, 0.44, 0.25, col("3b3b3b"), over=0.04)
    # Flower beds by the kerb.
    for k in range(24):
        a = math.radians(200 + k * 6)
        r = 6.3 + RNG.uniform(-0.2, 0.3)
        b.ico((sx + math.cos(a) * r, sy + math.sin(a) * r, 0.18), 0.26, col("6aa84f", 0.12), rough=0.2)
        b.ico((sx + math.cos(a) * r, sy + math.sin(a) * r, 0.42), 0.09, col(RNG.choice(["e8535a", "f2a0b5", "f6d55e", "b79be0"])))


def build_patch(b):
    x0, x1, y0, y1 = PATCH_RECT
    cx = (x0 + x1) / 2
    for i in range(4):
        by = 9.7 + i * 1.05
        b.box((cx - 3.0, by - 0.35, 0), (6.0, 0.7, 0.22), col("6b4a33", 0.05))
        for k in range(10):
            px = cx - 2.7 + k * 0.6
            if i == 0:  # peas up poles
                b.cyl((px, by, 0.2), 1.3, 0.03, 0.02, col("a07d52"), segs=4)
                for z in (0.55, 0.85, 1.15):
                    b.ico((px + RNG.uniform(-0.1, 0.1), by - 0.05, z), 0.16, col("6fae4f", 0.12), rough=0.25)
                b.ico((px + 0.1, by - 0.16, 0.7), 0.05, col("9cd06b"), scale=(0.7, 0.7, 1.8))
            elif i == 1:  # cabbages
                b.ico((px, by, 0.36), 0.24, col("a4cf77", 0.08), scale=(1, 1, 0.75), rough=0.15)
            elif i == 2:  # carrots
                for t in range(3):
                    b.cyl((px + (t - 1) * 0.06, by, 0.2), 0.35, 0.05, 0.0, col("5f9d43"), segs=3, direction=((t - 1) * 0.3, 0, 1))
            else:  # lettuces
                b.ico((px, by, 0.3), 0.2, col("8fc25f", 0.1), scale=(1, 1, 0.6), rough=0.2)
    # Wicker fence on three sides, open toward the path.
    for k in range(13):
        for x, y in ((x0, y0 + k * (y1 - y0) / 12), (x1, y0 + k * (y1 - y0) / 12)):
            b.box((x - 0.05, y - 0.05, 0), (0.1, 0.1, 0.8), col("8a6040"))
    for k in range(15):
        x = x0 + k * (x1 - x0) / 14
        b.box((x - 0.05, y1 - 0.05, 0), (0.1, 0.1, 0.8), col("8a6040"))
    for z in (0.35, 0.65):
        b.box((x0 - 0.04, y0, z), (0.08, y1 - y0, 0.06), col("a07d52"))
        b.box((x1 - 0.04, y0, z), (0.08, y1 - y0, 0.06), col("a07d52"))
        b.box((x0, y1 - 0.04, z), (x1 - x0, 0.08, 0.06), col("a07d52"))
    # Watering can.
    b.cyl((x0 + 0.9, y0 - 0.6, 0), 0.4, 0.2, 0.18, col("7c9aa6"), segs=10)
    b.cyl((x0 + 1.05, y0 - 0.6, 0.15), 0.4, 0.04, 0.03, col("7c9aa6"), segs=5, direction=(1, 0, 0.7))


def build_stream(b):
    for i in range(0, len(STREAM) - 1, 1):
        p = STREAM[i]
        a = STREAM[min(len(STREAM) - 1, i + 1)]
        t = (a - p).normalized()
        n = Vector((-t.y, t.x))
        for side in (1, -1):
            if RNG.random() < 0.7:
                q = p + n * side * RNG.uniform(1.8, 2.4)
                b.ico((q.x, q.y, height(q.x, q.y) + 0.05), RNG.uniform(0.12, 0.3), col("9c968c", 0.12), scale=(1.2, 1, 0.6), sub=1, rough=0.15)
            if RNG.random() < 0.35:
                q = p + n * side * RNG.uniform(2.0, 2.8)
                for k in range(5):
                    b.cyl((q.x + RNG.uniform(-0.3, 0.3), q.y + RNG.uniform(-0.3, 0.3), 0), RNG.uniform(0.7, 1.2), 0.05, 0.0, col("6f9a4a", 0.1), segs=3, direction=(RNG.uniform(-0.2, 0.2), RNG.uniform(-0.2, 0.2), 1))
    # Khina's pebble dam, half built.
    dx, dy = SPOTS["dam"]["face"]
    for k in range(9):
        b.ico((dx - 0.9 + k * 0.22, dy + RNG.uniform(-0.1, 0.1), 0.08), RNG.uniform(0.12, 0.2), col("a8a196", 0.12), scale=(1.2, 1, 0.7), rough=0.15)
    # Stepping stones further west.
    for k in range(5):
        q = Vector((-4.0 + k * 0.15, -16.5 - k * 0.8))
        b.cyl((q.x, q.y, -0.05), 0.2, 0.42, 0.38, col("b2aca2", 0.08), segs=8)


def build_halt(b):
    for x in (RAILS_X - 0.75, RAILS_X + 0.75):
        b.box((x - 0.06, -72, 0.16), (0.12, 144, 0.12), col("8d8f93"))
    y = -72.0
    while y < 72:
        b.box((RAILS_X - 1.2, y, 0.0), (2.4, 0.3, 0.16), col("6b5442", 0.08))
        y += 0.9
    hx, hy = 44.6, -9.0
    b.box((hx - 1.4, hy - 6.5, 0), (2.8, 13, 0.45), col("c2b8a6"))
    b.box((hx + 1.3, hy - 6.5, 0.45), (0.12, 13, 0.02), col("efe7d4"))  # edge line
    for k, h in enumerate((0.15, 0.3)):
        b.box((hx - 1.4 - 0.6 * (2 - k), hy - 0.9, 0), (0.6, 1.8, h), col("b2a998"))
    # Shelter with a bench.
    for px, py in ((hx - 1.1, hy - 4.6), (hx - 1.1, hy - 2.6), (hx + 0.9, hy - 4.6), (hx + 0.9, hy - 2.6)):
        b.box((px - 0.06, py - 0.06, 0.45), (0.12, 0.12, 2.2), col("4e6b5a"))
    b.box((hx - 1.4, hy - 4.9, 2.65), (2.6, 2.6, 0.12), col("4e6b5a"))
    b.box((hx - 1.2, hy - 4.5, 0.85), (0.5, 1.8, 0.08), col("b08458"))
    # Name board and timetable.
    for py in (hy + 3.0, hy + 4.4):
        b.box((hx - 0.05, py, 0.45), (0.1, 0.1, 1.8), col("3b3b3b"))
    b.box((hx - 0.06, hy + 2.9, 1.9), (0.12, 1.7, 0.45), col("2f4f6f"))
    b.box((hx - 0.08, hy + 3.0, 1.98), (0.12, 1.5, 0.29), col("efe7d4"))
    tx, ty = SPOTS["timetable"]["face"]
    b.box((tx - 0.05, ty - 0.05, 0.45), (0.1, 0.1, 1.0), col("3b3b3b"))
    b.box((tx - 0.05, ty - 0.45, 1.0), (0.08, 0.9, 0.65), col("efe7d4"))
    for k in range(4):
        b.box((tx - 0.08, ty - 0.35, 1.5 - k * 0.13), (0.04, 0.7, 0.04), col("555555"))


def build_woods_and_clearing(b):
    # A big stump where the birds are heard, and mushrooms where Khina forages.
    sx, sy = -19.6, 20.0
    b.cyl((sx, sy, -0.1), 0.75, 0.85, 0.75, col("7a5638"), segs=10)
    b.cyl((sx, sy, 0.64), 0.03, 0.72, 0.72, col("d2b48c"), segs=10)
    for k in range(10):
        a = RNG.uniform(0, 2 * math.pi)
        r = RNG.uniform(0.8, 2.6)
        mushroom(b, -15.0 + math.cos(a) * r, 15.0 + math.sin(a) * r)
    # The clearing: a fallen log and a fairy ring.
    cx, cy = CLEARING
    b.cyl((cx + 2.2, cy + 3.0, 0.4), 3.4, 0.45, 0.4, col("7a5638"), segs=9, direction=(math.cos(0.35), math.sin(0.35), 0.0))
    for k in range(4):
        b.ico((cx + 2.6 + k * 0.7, cy + 3.3 + k * 0.25, 0.85), 0.22, col("7fae55", 0.1), scale=(1, 1, 0.5), rough=0.2)
    for k in range(14):
        a = 2 * math.pi * k / 14
        mushroom(b, cx - 2.2 + math.cos(a) * 1.5, cy + 1.2 + math.sin(a) * 1.5, small=True)


def mushroom(b, x, y, small=False):
    s = RNG.uniform(0.6, 1.0) * (0.7 if small else 1.0)
    z = height(x, y)
    b.cyl((x, y, z), 0.22 * s, 0.05 * s, 0.045 * s, col("f1eadb"), segs=6)
    b.ico((x, y, z + 0.22 * s), 0.13 * s, col("d64a3a" if RNG.random() < 0.7 else "c9944f"), scale=(1, 1, 0.6))


def build_decor(b):
    # Flowers, rocks and bushes around the village, kept off paths and water.
    n = 0
    for _ in range(4000):
        p = Vector((RNG.uniform(-10, 44), RNG.uniform(-16, 20)))
        if path_dist(p) < 1.6 or stream_dist(p) < 2.6 or (p - SQUARE).length < 6.5 or abs(p.x - RAILS_X) < 3.5:
            continue
        if any((p - Vector(s["at"])).length < 1.5 for s in SPOTS.values()):
            continue
        if 26 < p.x < 40 and 4 < p.y < 11 or 2.5 < p.x < 10 and 3 < p.y < 9.5 or -2.5 < p.x < 2.5 and 0.5 < p.y < 5:
            continue
        x0, x1, y0, y1 = PATCH_RECT
        if x0 - 0.5 < p.x < x1 + 0.5 and y0 - 0.5 < p.y < y1 + 0.5:
            continue
        r = RNG.random()
        if r < 0.75:
            b.ico((p.x, p.y, 0.12), 0.085, col(RNG.choice(["f4a6c0", "f7d65c", "f6f2e8", "b79be0", "f6f2e8"])), sub=0)
        elif r < 0.88:
            b.ico((p.x, p.y, 0.05), RNG.uniform(0.15, 0.45), col("9c968c", 0.12), scale=(1.3, 1, 0.6), rough=0.15)
        else:
            b.ico((p.x, p.y, 0.3), RNG.uniform(0.45, 0.8), col("5f9a48", 0.12), scale=(1.2, 1, 0.8), rough=0.15)
        n += 1
        if n > 520:
            break


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
    scene.view_settings.view_transform = "Standard"
    world = bpy.data.worlds.new("World")
    scene.world = world
    try:
        world.use_nodes = True
    except Exception:
        pass
    bg = world.node_tree.nodes.get("Background")
    bg.inputs["Color"].default_value = rgba(lin("cfe3ef"))
    bg.inputs["Strength"].default_value = 0.8
    sun = bpy.data.objects.new("Sun", bpy.data.lights.new("Sun", "SUN"))
    sun.data.energy = 3.0
    sun.rotation_euler = (math.radians(48), math.radians(12), math.radians(-30))
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
    for name, s in shots.items():
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
        scene.render.filepath = os.path.join(out, f"village-{name}.png")
        bpy.ops.render.render(write_still=True)
    for ob in (sun, cam):
        bpy.data.objects.remove(ob)


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    toon = material("Village", rough=0.92)
    water_m = material("WaterM", "6fb4d6", rough=0.08, vertex_colors=False)
    glow_m = material("GlowM", "ffcf73", rough=0.5, vertex_colors=False, emission=2.0)

    build_ground(toon)
    build_water(water_m)
    trees = Batch()
    n = build_trees(trees)
    trees.to_object("Trees", toon)

    burrow, glow_b, flag = Batch(), Batch(), Batch()
    build_burrow(burrow, glow_b, flag)
    burrow.to_object("Burrow", toon)
    glow_b.to_object("Glow.burrow", glow_m)
    flag_ob = flag.to_object("Flag.letterbox", toon)

    shed = Batch()
    build_shed(shed)
    shed.to_object("Shed", toon)
    bakery, glow_k = Batch(), Batch()
    build_bakery(bakery, glow_k)
    bakery.to_object("Bakery", toon)
    glow_k.to_object("Glow.bakery", glow_m)
    square, glow_l = Batch(), Batch()
    build_square(square, glow_l)
    square.to_object("Square", toon)
    glow_l.to_object("Glow.lamp", glow_m)
    for name, fn in (("Patch", build_patch), ("Stream", build_stream), ("Halt", build_halt), ("WoodsAndClearing", build_woods_and_clearing), ("Decor", build_decor)):
        b = Batch()
        fn(b)
        b.to_object(name, toon)

    # The flag pivots on its post: move the object origin there so the browser can rotate it.
    lx, ly = SPOTS["letterbox"]["face"]
    pivot = Vector((lx + 0.26, ly - 0.02, 1.08))
    flag_ob.data.transform(Matrix.Translation(-pivot))
    flag_ob.location = pivot

    render_previews(scene)
    os.makedirs(os.path.join(HERE, "export"), exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=os.path.join(HERE, "export", "village.glb"), export_format="GLB")
    bpy.context.preferences.filepaths.save_version = 0  # no .blend1 backups
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(HERE, "village.blend"))
    tris = sum(len(p.vertices) - 2 for ob in bpy.data.objects if ob.type == "MESH" for p in ob.data.polygons)
    print("VILLAGE-DONE trees", n, "triangles", tris)


main()
