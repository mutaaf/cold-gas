# Preview renders of the Free Drive car (docs/shots/0229/blender-*.png): a studio floor, a sky, a key and two
# strips. The car is built in the game frame (y up); a root empty turns it +90 deg about X so Blender sees it Z-up.
import math

import bpy
from mathutils import Vector

import mats

V = Vector


def setup_materials():
    for name, (c, met, rough, cc, ccr, op, unlit, ds, order) in mats.TABLE.items():
        m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
        m.use_nodes = True
        nt = m.node_tree
        nt.nodes.clear()
        out = nt.nodes.new('ShaderNodeOutputMaterial')
        if unlit:
            em = nt.nodes.new('ShaderNodeEmission')
            em.inputs['Color'].default_value = (min(c[0], 1), min(c[1], 1), min(c[2], 1), 1)
            em.inputs['Strength'].default_value = max(1.0, max(c)) * 1.5
            nt.links.new(em.outputs[0], out.inputs[0])
            continue
        b = nt.nodes.new('ShaderNodeBsdfPrincipled')
        b.inputs['Base Color'].default_value = (*c, 1)
        b.inputs['Metallic'].default_value = met
        b.inputs['Roughness'].default_value = rough
        b.inputs['Coat Weight'].default_value = cc
        b.inputs['Coat Roughness'].default_value = ccr
        b.inputs['Alpha'].default_value = op
        nt.links.new(b.outputs[0], out.inputs[0])
        if op < 1:
            try:
                m.surface_render_method = 'BLENDED'
            except Exception:
                pass
    for m in bpy.data.materials:
        if m.name not in mats.TABLE and m.name.startswith('studio') is False:
            pass


def renderer_parts(st, folder, binio):
    """The animated parts the renderer draws over the body (preview only, lamps on, wing stowed), so the shots show
    the car as the game composes it. Their materials keep the stage's own records."""
    from mathutils import Matrix
    cp = st['carParts']
    M = cp['meshes']
    T = Matrix.Translation
    wing = T(cp['wing']['position']) @ Matrix.Rotation(cp['wing']['rotationX'], 4, 'X')
    want = [('wingBlade', wing), ('vanes', T(cp['vanes']['position'])), ('barge', Matrix()),
            ('drl', T(cp['drl']['position'])), ('tailBar', Matrix()), ('tailDim', Matrix()), ('heads', Matrix())]
    for f in cp['fans']:
        want.append(('rotor', T(f['position']) @ Matrix.Rotation(f['rotationX'], 4, 'X')))
    out = []
    for i, (name, mtx) in enumerate(want):
        me = bpy.data.meshes.new('part-%s' % name)
        verts, faces, mids, slots = [], [], [], []
        for mat, vs, tris in binio.read_mesh(M[name], folder):
            o = len(verts)
            verts += [tuple(v[:3]) for v in vs]
            faces += [(a + o, b + o, c + o) for a, b, c in tris]
            mids += [len(slots)] * len(tris)
            slots.append(mat)
        me.from_pydata(verts, [], faces)
        for k, mat in enumerate(slots):
            bm_ = bpy.data.materials.get('part-' + mat['name'])
            if bm_ is None:
                bm_ = bpy.data.materials.new('part-' + mat['name'])
                bm_.use_nodes = True
                nt = bm_.node_tree
                nt.nodes.clear()
                out_n = nt.nodes.new('ShaderNodeOutputMaterial')
                c = mat['color']
                if mat.get('unlit'):
                    em = nt.nodes.new('ShaderNodeEmission')
                    em.inputs['Color'].default_value = (min(c[0], 1), min(c[1], 1), min(c[2], 1), 1)
                    em.inputs['Strength'].default_value = max(1.0, max(c)) * 1.5
                    nt.links.new(em.outputs[0], out_n.inputs[0])
                else:
                    b = nt.nodes.new('ShaderNodeBsdfPrincipled')
                    b.inputs['Base Color'].default_value = (*c, 1)
                    b.inputs['Metallic'].default_value = mat.get('metalness', 0)
                    b.inputs['Roughness'].default_value = mat.get('roughness', 0.5)
                    nt.links.new(b.outputs[0], out_n.inputs[0])
            me.materials.append(bm_)
        for p, mi in zip(me.polygons, mids):
            p.material_index = mi
        ob = bpy.data.objects.new('part-%s-%d' % (name, i), me)
        bpy.context.scene.collection.objects.link(ob)
        ob.matrix_basis = mtx
        out.append(ob)
    return out


def setup_scene(objs, res=(1100, 700), samples=32):
    sc = bpy.context.scene
    root = bpy.data.objects.get('root') or bpy.data.objects.new('root', None)
    if root.name not in sc.collection.objects:
        sc.collection.objects.link(root)
    root.rotation_euler = (math.pi / 2, 0, 0)
    for ob in objs:
        ob.parent = root
    sc.render.engine = 'CYCLES'
    sc.cycles.samples = samples
    sc.cycles.use_denoising = True
    sc.cycles.seed = 7
    sc.cycles.device = 'CPU'
    sc.cycles.max_bounces = 6
    sc.cycles.transparent_max_bounces = 12
    sc.render.resolution_x, sc.render.resolution_y = res
    sc.render.film_transparent = False
    sc.view_settings.view_transform = 'AgX'
    sc.view_settings.look = 'AgX - Medium High Contrast'
    # world: a sky
    w = bpy.data.worlds.get('studio') or bpy.data.worlds.new('studio')
    sc.world = w
    w.use_nodes = True
    nt = w.node_tree
    nt.nodes.clear()
    sky = nt.nodes.new('ShaderNodeTexSky')
    for t in ('MULTIPLE_SCATTERING', 'NISHITA', 'HOSEK_WILKIE'):
        try:
            sky.sky_type = t
            break
        except Exception:
            continue
    try:
        sky.sun_elevation = math.radians(22)
        sky.sun_rotation = math.radians(140)
    except Exception:
        pass
    bg = nt.nodes.new('ShaderNodeBackground')
    bg.inputs['Strength'].default_value = 0.12
    out = nt.nodes.new('ShaderNodeOutputWorld')
    nt.links.new(sky.outputs[0], bg.inputs[0])
    nt.links.new(bg.outputs[0], out.inputs[0])
    # floor
    if not bpy.data.objects.get('floor'):
        me = bpy.data.meshes.new('floor')
        s = 40
        me.from_pydata([(-s, -s, 0), (s, -s, 0), (s, s, 0), (-s, s, 0)], [], [(0, 1, 2, 3)])
        fl = bpy.data.objects.new('floor', me)
        sc.collection.objects.link(fl)
        fm = bpy.data.materials.new('studio-floor')
        fm.use_nodes = True
        p = fm.node_tree.nodes['Principled BSDF']
        p.inputs['Base Color'].default_value = (0.10, 0.104, 0.11, 1)
        p.inputs['Roughness'].default_value = 0.42
        me.materials.append(fm)
    # lights: a big soft key overhead and two long strips for the paint's highlights
    def area(name, loc, rot, size, power, shape='RECTANGLE', sx=None):
        L = bpy.data.objects.get(name)
        if not L:
            L = bpy.data.objects.new(name, bpy.data.lights.new(name, 'AREA'))
            sc.collection.objects.link(L)
        L.data.shape = shape
        L.data.size = size
        if sx is not None:
            L.data.size_y = sx
        L.data.energy = power
        L.location = loc
        L.rotation_euler = rot
    area('key', (0, 0, 6.0), (0, 0, 0), 5.0, 260, 'RECTANGLE', 3.0)
    area('stripL', (5.0, -1.0, 2.6), (math.radians(65), 0, math.radians(90)), 0.5, 220, 'RECTANGLE', 7.0)
    area('stripR', (-5.0, 1.5, 3.0), (math.radians(-60), 0, math.radians(90)), 0.5, 140, 'RECTANGLE', 7.0)
    cam = bpy.data.objects.get('cam')
    if not cam:
        cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
        sc.collection.objects.link(cam)
    sc.camera = cam
    return cam


def shoot(cam, game_eye, game_target, lens, path):
    """eye/target in the game frame (y up, nose +z)."""
    g2b = lambda p: V((p[0], -p[2], p[1]))
    e, t = g2b(game_eye), g2b(game_target)
    cam.location = e
    cam.rotation_euler = (t - e).to_track_quat('-Z', 'Y').to_euler()
    cam.data.lens = lens
    bpy.context.scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
