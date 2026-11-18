# Builds the little train that runs through the halt, renders a preview, exports one .glb for the browser.
# Run: /Applications/Blender.app/Contents/MacOS/Blender --background --python art/train.py
# Outputs: art/train.blend (editable), art/export/train.glb, art/previews/train.png
#
# A felt toy steam train in the same soft style as the villagers: a moss-green engine with a brass
# dome and a black funnel, and two carriages (cream and plum, then cream and teal) with round-cornered
# windows. No face: it is the village's own train, not anyone else's.
#
# The train runs along Blender +Y (the rails are at x = 47 in the village); its middle is at the
# origin and the wheels sit on the rail tops at z = 0. Named for the browser:
#   Train                 the root
#   Train.Axle.<n>        one empty per axle (wheels as children), so the page can spin them
#   Train.Smoke           an empty at the top of the funnel, where the puffs start
#   Train.Front           an empty at the front buffer beam (the engine leads toward -Y)

import math
import os

import bmesh
import bpy
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))


def srgb(hex_):
    out = []
    for i in (0, 2, 4):
        c = int(hex_[i : i + 2], 16) / 255
        out.append(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4)
    return (*out, 1.0)


MATS = {}


def material(name, base, rough=0.9, sheen=0.25, emission=0.0, coat=0.0, metal=0.0):
    if name in MATS:
        return MATS[name]
    m = bpy.data.materials.new(name)
    try:
        m.use_nodes = True
    except Exception:
        pass
    bsdf = m.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = srgb(base)
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metal
    if "Sheen Weight" in bsdf.inputs:
        bsdf.inputs["Sheen Weight"].default_value = sheen
    if coat > 0 and "Coat Weight" in bsdf.inputs:
        bsdf.inputs["Coat Weight"].default_value = coat
    if emission > 0:
        bsdf.inputs["Emission Color"].default_value = srgb(base)
        bsdf.inputs["Emission Strength"].default_value = emission
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
    for p in me.polygons:
        p.use_smooth = smooth_shade
    me.materials.append(mat)
    ob = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(ob)
    if parent is not None:
        ob.parent = parent
    return ob


def empty(name, world_location, parent=None):
    e = bpy.data.objects.new(name, None)
    e.empty_display_size = 0.15
    bpy.context.collection.objects.link(e)
    if parent is not None:
        e.parent = parent
        e.location = Vector(world_location) - world_of(parent)
    else:
        e.location = world_location
    return e


def soft_box(name, center, size, mat, parent, bevel=0.3, segs=3):
    """A puffy felt box: a cube with deeply rounded edges."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.transform(bm, matrix=Matrix.Translation(Vector(center)) @ Matrix.Diagonal((*size, 1.0)), verts=bm.verts)
    bmesh.ops.bevel(bm, geom=list(bm.edges), offset=min(size) * bevel, segments=segs, affect="EDGES")
    return obj_from_bmesh(name, bm, mat, parent)


def cylinder(name, a, b, radius, mat, parent, sides=20, r2=None):
    """A capped cylinder (or a cone, with r2) from a to b, its rims softened."""
    a, b = Vector(a), Vector(b)
    d = (b - a).normalized()
    u = d.orthogonal().normalized()
    v = d.cross(u)
    bm = bmesh.new()
    rings = []
    for p, r in ((a, radius), (b, r2 if r2 is not None else radius)):
        rings.append([bm.verts.new(p + (u * math.cos(2 * math.pi * k / sides) + v * math.sin(2 * math.pi * k / sides)) * r) for k in range(sides)])
    for k in range(sides):
        k2 = (k + 1) % sides
        bm.faces.new((rings[0][k], rings[0][k2], rings[1][k2], rings[1][k]))
    bm.faces.new(list(reversed(rings[0])))
    bm.faces.new(rings[1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    rim = [e for e in bm.edges if all(len(f.verts) > 4 for f in e.link_faces) is False and len(e.link_faces) == 2 and any(len(f.verts) > 4 for f in e.link_faces)]
    if rim:
        bmesh.ops.bevel(bm, geom=rim, offset=min(radius, (b - a).length) * 0.18, segments=2, affect="EDGES")
    return obj_from_bmesh(name, bm, mat, parent)


def ellipsoid(name, center, radii, mat, parent, segments=20, rings=12):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=segments, v_segments=rings, radius=1.0)
    bmesh.ops.transform(bm, matrix=Matrix.Translation(Vector(center)) @ Matrix.Diagonal((*radii, 1.0)), verts=bm.verts)
    return obj_from_bmesh(name, bm, mat, parent)


AXLES = []


def wheels(root, y, radius, wheel_m, hub_m, gauge=1.5):
    """Two wheels on an axle at y, under the rails (x = ±gauge/2), on the rail tops (z = 0)."""
    axle = empty(f"Train.Axle.{len(AXLES)}", (0, y, radius), root)
    AXLES.append(axle)
    for sx in (1, -1):
        x = sx * gauge / 2
        cylinder(f"Train.Wheel.{len(AXLES)}.{sx}", (x - 0.07 * sx, y, radius), (x + 0.07 * sx, y, radius), radius, wheel_m, axle, sides=22)
        cylinder(f"Train.Hub.{len(AXLES)}.{sx}", (x + 0.06 * sx, y, radius), (x + 0.11 * sx, y, radius), radius * 0.38, hub_m, axle, sides=14)
        # A spoke bar, so the turning shows.
        soft_box(f"Train.Spoke.{len(AXLES)}.{sx}", (x + 0.085 * sx, y, radius), (0.04, radius * 1.6, radius * 0.22), hub_m, axle, bevel=0.3, segs=1)
    return axle


def engine(root, front_y):
    """The engine, its front buffer beam at front_y (it leads toward -Y). Returns its back end."""
    green = material("Felt.Engine", "4f7a4a")
    dark = material("Felt.EngineDark", "2f3b2c")
    red = material("Felt.Red", "b5473a")
    black = material("Felt.Funnel", "2a2624", rough=0.8)
    brass = material("Felt.Brass", "d8a94a", rough=0.5, sheen=0.4, coat=0.4)
    cream = material("Felt.Cream", "f1e6cc")
    glass = material("Felt.Window", "3d4a52", rough=0.3, coat=0.6)
    lamp = material("Felt.Lamp", "ffe2a0", rough=0.3, emission=1.5)
    length = 2.7
    y0, y1 = front_y, front_y + length
    # Chassis and buffer beam.
    soft_box("Train.Chassis", (0, (y0 + y1) / 2, 0.62), (1.5, length, 0.22), dark, root, bevel=0.25)
    soft_box("Train.Beam", (0, y0 + 0.06, 0.62), (1.6, 0.14, 0.3), red, root, bevel=0.3)
    for sx in (1, -1):
        cylinder(f"Train.Buffer.{sx}", (0.5 * sx, y0 + 0.05, 0.62), (0.5 * sx, y0 - 0.16, 0.62), 0.07, black, root, sides=12)
        ellipsoid(f"Train.BufferPad.{sx}", (0.5 * sx, y0 - 0.17, 0.62), (0.12, 0.04, 0.12), black, root, segments=14, rings=8)
    # Boiler: a fat felt cylinder, a darker smokebox at the front, brass bands.
    by0, by1 = y0 + 0.15, y0 + 1.75
    cylinder("Train.Boiler", (0, by0 + 0.25, 1.15), (0, by1, 1.15), 0.5, green, root, sides=28)
    cylinder("Train.Smokebox", (0, by0, 1.15), (0, by0 + 0.3, 1.15), 0.53, dark, root, sides=28)
    ellipsoid("Train.SmokeDoor", (0, by0 - 0.01, 1.15), (0.44, 0.06, 0.44), dark, root, segments=24, rings=10)
    for yy in (by0 + 0.75, by1 - 0.2):
        cylinder(f"Train.Band.{yy:.2f}", (0, yy, 1.15), (0, yy + 0.06, 1.15), 0.515, brass, root, sides=28)
    # Funnel (a little flared) and a brass dome.
    fy = by0 + 0.2
    cylinder("Train.FunnelStem", (0, fy, 1.5), (0, fy, 2.05), 0.13, black, root, sides=16)
    cylinder("Train.FunnelTop", (0, fy, 2.0), (0, fy, 2.2), 0.14, black, root, sides=16, r2=0.21)
    empty("Train.Smoke", (0, fy, 2.25), root)
    ellipsoid("Train.Dome", (0, by0 + 1.05, 1.62), (0.18, 0.2, 0.2), brass, root, segments=18, rings=10)
    # A round lamp on the front.
    ellipsoid("Train.LampLight", (0, by0 - 0.06, 1.62), (0.08, 0.05, 0.08), lamp, root, segments=12, rings=8)
    soft_box("Train.LampBox", (0, by0 - 0.0, 1.62), (0.22, 0.14, 0.2), black, root, bevel=0.3, segs=2)
    # Cab, roof and windows.
    cy0, cy1 = by1 - 0.05, y1
    soft_box("Train.Cab", (0, (cy0 + cy1) / 2, 1.35), (1.4, cy1 - cy0, 1.25), green, root, bevel=0.12)
    soft_box("Train.CabRoof", (0, (cy0 + cy1) / 2 + 0.03, 2.03), (1.6, cy1 - cy0 + 0.24, 0.14), red, root, bevel=0.35)
    for sx in (1, -1):
        soft_box(f"Train.CabWindow.{sx}", (0.705 * sx, (cy0 + cy1) / 2, 1.58), (0.03, 0.5, 0.42), glass, root, bevel=0.4, segs=2)
        soft_box(f"Train.CabFrame.{sx}", (0.7 * sx, (cy0 + cy1) / 2, 1.58), (0.03, 0.62, 0.54), cream, root, bevel=0.4, segs=2)
    for sx in (1, -1):
        soft_box(f"Train.FrontWindow.{sx}", (0.35 * sx, cy0 - 0.01, 1.68), (0.32, 0.03, 0.28), glass, root, bevel=0.4, segs=2)
    # Running boards along the boiler.
    for sx in (1, -1):
        soft_box(f"Train.Board.{sx}", (0.66 * sx, (by0 + by1) / 2, 0.76), (0.2, by1 - by0, 0.05), red, root, bevel=0.3, segs=1)
    # Big driving wheels (three axles) in red.
    wheel_m = material("Felt.Wheel", "a23b30")
    hub_m = material("Felt.Hub", "2a2624", rough=0.7)
    for yy in (y0 + 0.55, y0 + 1.3, y0 + 2.05):
        wheels(root, yy, 0.34, wheel_m, hub_m)
    # Coupling at the back.
    soft_box("Train.CouplingE", (0, y1 + 0.12, 0.6), (0.18, 0.3, 0.1), dark, root, bevel=0.3, segs=1)
    return y1


def carriage(root, y0, n, body_hex, band_hex):
    body = material(f"Felt.Carriage{n}", body_hex)
    band = material(f"Felt.CarriageBand{n}", band_hex)
    roof = material("Felt.Roof", "6b6560")
    dark = material("Felt.EngineDark", "2f3b2c")
    glass = material("Felt.Window", "3d4a52", rough=0.3, coat=0.6)
    warm = material("Felt.WindowWarm", "ffdca0", rough=0.4, emission=0.25)
    length = 2.5
    y1 = y0 + length
    mid = (y0 + y1) / 2
    soft_box(f"Train.Car{n}.Floor", (0, mid, 0.62), (1.4, length - 0.1, 0.18), dark, root, bevel=0.25)
    soft_box(f"Train.Car{n}.Body", (0, mid, 1.32), (1.5, length, 1.2), body, root, bevel=0.14)
    soft_box(f"Train.Car{n}.Band", (0, mid, 1.0), (1.53, length + 0.02, 0.2), band, root, bevel=0.3, segs=2)
    soft_box(f"Train.Car{n}.Roof", (0, mid, 2.0), (1.66, length + 0.18, 0.22), roof, root, bevel=0.45, segs=3)
    # Windows: three a side, one of them lit warm (someone reading inside).
    for sx in (1, -1):
        for k, wy in enumerate((mid - 0.75, mid, mid + 0.75)):
            m = warm if (k + n + (sx > 0)) % 3 == 0 else glass
            soft_box(f"Train.Car{n}.Window.{sx}.{k}", (0.755 * sx, wy, 1.45), (0.03, 0.5, 0.42), m, root, bevel=0.4, segs=2)
    for sx in (1, -1):
        soft_box(f"Train.Car{n}.Step.{sx}", (0.72 * sx, mid, 0.62), (0.12, 0.6, 0.06), dark, root, bevel=0.3, segs=1)
    wheel_m = material("Felt.CarWheel", "3a3430", rough=0.7)
    hub_m = material("Felt.Hub", "2a2624", rough=0.7)
    for yy in (y0 + 0.45, y1 - 0.45):
        wheels(root, yy, 0.24, wheel_m, hub_m)
    soft_box(f"Train.Car{n}.Coupling", (0, y1 + 0.12, 0.6), (0.18, 0.3, 0.1), dark, root, bevel=0.3, segs=1)
    return y1


def build():
    root = empty("Train", (0, 0, 0))
    gap = 0.28
    total = 2.7 + gap + 2.5 + gap + 2.5
    y = -total / 2
    empty("Train.Front", (0, y - 0.2, 0.62), root)
    y = engine(root, y) + gap
    y = carriage(root, y, 1, "efe2c4", "7d3f5c") + gap
    carriage(root, y, 2, "efe2c4", "3f7d7a")
    return root


def join_parts(root):
    """One mesh per material under each pivot (the root and each axle): fewer draw calls."""
    for pv in [root, *AXLES]:
        groups = {}
        for ch in pv.children:
            if ch.type == "MESH":
                groups.setdefault(ch.data.materials[0].name, []).append(ch)
        for name, obs in groups.items():
            if len(obs) < 2:
                continue
            bpy.ops.object.select_all(action="DESELECT")
            for o in obs:
                o.select_set(True)
            bpy.context.view_layer.objects.active = obs[0]
            bpy.ops.object.join()
            obs[0].name = f"{pv.name}.{name}"


def look_at(cam, target):
    d = Vector(target) - cam.location
    cam.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()


def render_preview(scene):
    for engine_name in ("BLENDER_EEVEE", "BLENDER_EEVEE_NEXT", "CYCLES"):
        try:
            scene.render.engine = engine_name
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
    fill.data.energy = 600
    fill.data.size = 8
    fill.location = (-7, -6, 4)
    look_at(fill, (0, 0, 1))
    scene.collection.objects.link(fill)
    ground = bpy.data.meshes.new("Ground")
    bm = bmesh.new()
    bmesh.ops.create_circle(bm, cap_ends=True, radius=16, segments=48)
    bm.to_mesh(ground)
    bm.free()
    g = bpy.data.objects.new("Ground", ground)
    g.data.materials.append(material("GroundM", "a9c48f", rough=1.0))
    scene.collection.objects.link(g)
    rails = []
    for x in (-0.75, 0.75):
        bm = bmesh.new()
        bmesh.ops.create_cube(bm, size=1.0)
        bmesh.ops.transform(bm, matrix=Matrix.Translation(Vector((x, 0, -0.06))) @ Matrix.Diagonal((0.08, 24, 0.12, 1.0)), verts=bm.verts)
        me = bpy.data.meshes.new("Rail")
        bm.to_mesh(me)
        bm.free()
        r = bpy.data.objects.new("Rail", me)
        r.data.materials.append(material("RailM", "8d8f93", rough=0.5))
        scene.collection.objects.link(r)
        rails.append(r)
    cam = bpy.data.objects.new("Cam", bpy.data.cameras.new("Cam"))
    cam.data.lens = 45
    scene.collection.objects.link(cam)
    scene.camera = cam
    cam.location = (9.5, -6.5, 3.4)
    look_at(cam, (0, -0.4, 1.0))
    out = os.path.join(HERE, "previews")
    os.makedirs(out, exist_ok=True)
    scene.render.filepath = os.path.join(out, "train.png")
    bpy.ops.render.render(write_still=True)
    for ob in (sun, fill, g, cam, *rails):
        bpy.data.objects.remove(ob)


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    root = build()
    join_parts(root)
    render_preview(scene)
    os.makedirs(os.path.join(HERE, "export"), exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=os.path.join(HERE, "export", "train.glb"), export_format="GLB")
    bpy.context.preferences.filepaths.save_version = 0
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(HERE, "train.blend"))
    print("TRAIN-DONE", scene.render.engine)


main()
