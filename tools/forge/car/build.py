# GENERATES ios/ColdGas/Resources/Car/ (body.bin, body-lod1.bin, wheel-{front,rear}-{spin,steer}.bin, car.json): the
# Free Drive car, a detailed rebuild of the show roadster (Stages/show/roadster.bin) on the same silhouette, so every
# animated part the renderer draws on top (DRL, heads, covers, tail bar, brake, wing, vanes, skirts, barge, fans,
# nozzles) still sits where it did. Our own design: no badges, lettering, logos or real names anywhere (AGENTS.md 3.7).
#
# Run from the repo root (deterministic: same script, same bytes):
#   /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup --python tools/forge/car/build.py
# Add `-- --shots` to also render the previews to docs/shots/0232/blender-*.png (Cycles, small, slow-ish).
# Then: python3 tools/forge/car/check.py
#
# Frame: game metres, y up, nose toward +z, ground at y = 0. Per vertex: position, normal, uv = (grime 0..1, 0),
# colour = baked ambient occlusion (white = open). Wheels are built for the -x side; the renderer mirrors with a -x
# scale for +x wheels (car.json wheels.mirrorX).
import json
import math
import os
import sys

import bmesh
import bpy
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import binio      # noqa: E402
import body       # noqa: E402
import details    # noqa: E402
import kit        # noqa: E402
import mats       # noqa: E402
import wheels     # noqa: E402

ROOT = os.path.normpath(os.path.join(HERE, '..', '..', '..'))
SHOW = os.path.join(ROOT, 'ios', 'ColdGas', 'Resources', 'Stages', 'show')
OUT = os.path.join(ROOT, 'ios', 'ColdGas', 'Resources', 'Car')
SHOTS = os.path.join(ROOT, 'docs', 'shots', '0232')
ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
V = Vector

FRONT = dict(R=0.343, W=0.295, Rr=0.254)   # 20" rim, 295 tyre (src/sim/spec.js)
REAR = dict(R=0.367, W=0.335, Rr=0.2667)   # 21" rim, 335 tyre


def log(*a):
    print('[car]', *a, flush=True)


def tris(ob):
    return sum(len(p.vertices) - 2 for p in ob.data.polygons)


# ---------------------------------------------------------------- build

def build_body(st, lod=0):
    """lod 0: the detailed body. lod 1 (distance): the same skin with a single rolled edge, no grooves, light density,
    and the same details with the heaviest ones decimated."""
    ref = body.reference(st, SHOW, binio)
    p = '' if lod == 0 else 'l1-'
    if lod == 0:
        objs = [
            body.shell(ref, ['paint'], 'b-paint', ['drive-paint', 'drive-under'], 0.028, 4, 20, 0.125, gaps=True),
            body.shell(ref, ['black'], 'b-black', ['drive-trim'], 0.005, 2, 30, 0.2),
            body.shell(ref, ['carbon'], 'b-carbon', ['drive-carbon'], 0.003, 1, 30, 0),
            body.shell(ref, ['under'], 'b-under', ['drive-under'], 0, 1, 30, 0.25),
            body.shell(ref, ['brass'], 'b-nozzle', ['drive-brass'], 0, 1, 30, 0, sharp=50),
            body.shell(ref, ['nozzleIn'], 'b-nozzleIn', ['drive-nozzleIn'], 0, 1, 30, 0),
        ]
        g, frit = body.glass(ref)
    else:
        objs = [
            body.shell(ref, ['paint'], p + 'b-paint', ['drive-paint', 'drive-under'], 0.024, 1, 20, 0.45),
            body.shell(ref, ['black'], p + 'b-black', ['drive-trim'], 0, 1, 30, 0.6),
            body.shell(ref, ['carbon'], p + 'b-carbon', ['drive-carbon'], 0, 1, 30, 0),
            body.shell(ref, ['under'], p + 'b-under', ['drive-under'], 0, 1, 30, 0),
            body.shell(ref, ['brass'], p + 'b-nozzle', ['drive-brass'], 0, 1, 30, 0, sharp=50),
            body.shell(ref, ['nozzleIn'], p + 'b-nozzleIn', ['drive-nozzleIn'], 0, 1, 30, 0),
        ]
        g, frit = body.glass(ref, dens=0.6)
        g.name, frit.name = p + 'glass', p + 'glass-frit'
    objs += [g, frit]
    bvh = details.bvh_of(objs[:2])
    P = details.Parts()
    details.mirrors(P, bvh)
    details.handles(P, bvh)
    details.wipers(P, details.bvh_of([g] + objs[:1]))
    details.intake(P)
    details.vents(P, bvh)
    details.diffuser(P)
    details.arch_liners(P)
    details.lamps(P, bvh)
    details.cabin(P)
    objs += P.objects(p + 'd')
    if lod == 1:
        for o in objs:
            n = tris(o)
            if n > 700 and not o.name.endswith('paint'):
                m = o.modifiers.new('dec', 'DECIMATE')
                m.decimate_type = 'COLLAPSE'
                m.ratio = 0.25 if n > 2000 else 0.5
                m.use_collapse_triangulate = True
                kit.apply_modifiers(o)
                kit.mark_sharp(o, 40)
    return objs


def build_wheels():
    out = {}
    for key, spec in (('front', FRONT), ('rear', REAR)):
        bm, names = wheels.build_spin(**spec)
        bmesh.ops.triangulate(bm, faces=bm.faces[:])
        out[key + 'Spin'] = kit.obj_from_bm('w-%s-spin' % key, bm, names, sharp_deg=38)
        bm, names = wheels.build_steer()
        bmesh.ops.triangulate(bm, faces=bm.faces[:])
        out[key + 'Steer'] = kit.obj_from_bm('w-%s-steer' % key, bm, names, sharp_deg=38)
    return out


def wheel_instances(W):
    """Linked copies of the wheel meshes at the four stage wheels (for the body's AO bake and the previews)."""
    st = binio.load_stage(SHOW)
    inst = []
    for w in st['wheels']:
        front = w['index'] < 2
        spec = FRONT if front else REAR
        for part in ('Spin', 'Steer'):
            src = W[('front' if front else 'rear') + part]
            ob = bpy.data.objects.new('inst-%d-%s' % (w['index'], part), src.data)
            bpy.context.scene.collection.objects.link(ob)
            ob.location = (w['x'], spec['R'], w['z'])
            ob.scale = (-1 if w['x'] > 0 else 1, 1, 1)
            inst.append(ob)
    return inst


# ---------------------------------------------------------------- AO + grime

def ensure_floor():
    if bpy.data.objects.get('floor'):
        return bpy.data.objects['floor']
    me = bpy.data.meshes.new('floor')
    s = 40
    me.from_pydata([(-s, 0, -s), (-s, 0, s), (s, 0, s), (s, 0, -s)], [], [(0, 1, 2, 3)])
    fl = bpy.data.objects.new('floor', me)
    bpy.context.scene.collection.objects.link(fl)
    return fl


def bake_ao(targets, hidden, samples=48, distance=0.45):
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.cycles.samples = samples
    sc.cycles.seed = 3
    sc.cycles.use_denoising = False
    if sc.world is None:
        sc.world = bpy.data.worlds.new('bake')
    sc.world.light_settings.distance = distance
    sc.render.bake.target = 'VERTEX_COLORS'
    for ob in hidden:
        ob.hide_render = True
    for ob in bpy.context.view_layer.objects:
        ob.select_set(False)
    for ob in targets:
        me = ob.data
        if 'ao' not in me.color_attributes:
            me.color_attributes.new('ao', 'FLOAT_COLOR', 'POINT')
        me.color_attributes.active_color = me.color_attributes['ao']
        ob.select_set(True)
    bpy.context.view_layer.objects.active = targets[0]
    bpy.ops.object.bake(type='AO')
    for ob in hidden:
        ob.hide_render = False


WHEEL_AXLES = [(1.62, 0.343), (-1.205, 0.367)]


def grime_body(p, n, ao):
    if abs(p.x) < 0.70 and 0.3 < p.y < 1.15 and -1.65 < p.z < 1.3 and abs(n.x) < 0.99:
        cabin = True
    else:
        cabin = False
    g = max(0.0, min(1.0, (0.55 - p.y) / 0.45)) * 0.55
    g += max(0.0, -n.y) * 0.35
    for zc, yc in WHEEL_AXLES:
        d = math.hypot(p.y - yc, p.z - zc)
        if d < 0.75:
            k = 1 - max(0.0, d - 0.35) / 0.40
            behind = 1.0 if p.z < zc else 0.45
            g += 0.5 * k * behind
    if p.z < -1.7 and p.y < 0.65:
        g += 0.3
    g += (1 - ao) * 0.5
    if n.y > 0.6 and p.y > 0.6:
        g *= 0.15
    if cabin:
        g = (1 - ao) * 0.15
    return max(0.0, min(1.0, g))


def grime_wheel(p, n, ao, mat):
    r = math.hypot(p.y, p.z)
    if mat == 'drive-tyre':
        return min(1.0, 0.55 + (1 - ao) * 0.5)
    return min(1.0, 0.15 + (1 - ao) * 0.6 + (0.25 if r > 0.2 else 0.0))


# ---------------------------------------------------------------- export

def collect(objs, grime_fn):
    """-> {material: (verts [11-tuples], tris [(i,j,k)])}, deterministic order, vertices welded by full attribute."""
    groups = {}
    for ob in sorted(objs, key=lambda o: o.name):
        me = ob.data
        me.calc_loop_triangles()
        cn = me.corner_normals
        col = me.color_attributes.get('ao')
        for lt in me.loop_triangles:
            mat = me.materials[lt.material_index].name
            G = groups.setdefault(mat, ([], [], {}))
            tri = []
            for li in lt.loops:
                vi = me.loops[li].vertex_index
                p = me.vertices[vi].co
                nv = cn[li].vector
                nn = nv.normalized() if nv.length > 1e-8 else V((0, 1, 0))
                if col is not None and mat not in mats.NO_AO:
                    c = col.data[vi].color
                    ao = max(0.0, min(1.0, c[0]))
                    ao = round(ao * 255) / 255
                else:
                    ao = 1.0
                gr = round(grime_fn(p, nn, ao, mat) * 255) / 255
                key = (round(p.x, 5), round(p.y, 5), round(p.z, 5), round(nn.x, 4), round(nn.y, 4), round(nn.z, 4),
                       gr, ao)
                idx = G[2].get(key)
                if idx is None:
                    idx = len(G[0])
                    G[2][key] = idx
                    G[0].append((key[0], key[1], key[2], key[3], key[4], key[5], gr, 0.0, ao, ao, ao))
                tri.append(idx)
            if len(set(tri)) == 3:
                G[1].append(tuple(tri))
    return {m: (v, t) for m, (v, t, _) in groups.items()}


def write(file_name, groups):
    order = sorted(groups, key=mats.order_key)
    recs = []
    for m in order:
        rec, ro = mats.record(m, m not in mats.NO_AO)
        recs.append((rec, ro, groups[m][0], groups[m][1]))
    meta = binio.write_mesh(os.path.join(OUT, file_name), file_name, recs)
    log(file_name, sum(len(groups[m][1]) for m in order), 'tris', {m: len(groups[m][1]) for m in order})
    return meta


# ---------------------------------------------------------------- main

def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    os.makedirs(OUT, exist_ok=True)
    st = binio.load_stage(SHOW)
    objs = build_body(st)
    W = build_wheels()
    for o in objs:
        log('obj', o.name, tris(o))
    objs1 = build_body(st, lod=1)
    floor = ensure_floor()
    inst = wheel_instances(W)
    everything = objs + objs1 + inst + list(W.values()) + [floor]

    def only(visible):
        for ob in everything:
            ob.hide_render = ob not in visible
    glassy = {o for o in objs + objs1 if any(m.name in ('drive-glass', 'drive-lens') for m in o.data.materials)}
    # body AO (each LOD on its own): the wheels at their stations and the floor occlude, glass and lenses don't
    for group in (objs, objs1):
        only(set(group) - glassy | set(inst) | {floor})
        bake_ao([o for o in group if o not in glassy], [])
    # wheel AO: each wheel alone (it turns under the arch, so the body mustn't print into it)
    for wo in W.values():
        only({wo})
        bake_ao([wo], [])
    only(set(everything))

    car = {"note": "GENERATED by tools/forge/car/build.py (Blender, headless) from Stages/show/roadster.bin: the Free "
                   "Drive car. Do not edit by hand; rerun the script. Frame: metres, y up, nose +z. uv.x = grime mask "
                   "0..1, colour = baked AO. Wheels built for the -x side (stage wheels 0 and 2), mirrorX for +x."}
    bodyg = lambda p, n, ao, m: grime_body(p, n, ao)
    car['body'] = write('body.bin', collect(objs, bodyg))
    car['bodyLod1'] = write('body-lod1.bin', collect(objs1, bodyg))
    wj = {}
    for key, fname in (('frontSpin', 'wheel-front-spin.bin'), ('frontSteer', 'wheel-front-steer.bin'),
                       ('rearSpin', 'wheel-rear-spin.bin'), ('rearSteer', 'wheel-rear-steer.bin')):
        wj[key] = write(fname, collect([W[key]], grime_wheel))
    wj['builtFor'] = 'right'
    wj['builtForX'] = -1
    wj['mirrorX'] = True
    wj['radius'] = {'front': FRONT['R'], 'rear': REAR['R']}
    wj['width'] = {'front': FRONT['W'], 'rear': REAR['W']}
    car['wheels'] = wj
    with open(os.path.join(OUT, 'car.json'), 'w') as f:
        json.dump(car, f, indent=1, sort_keys=False)
        f.write('\n')
    log('wrote', os.path.join(OUT, 'car.json'))

    if '--shots' in ARGS or '--shot' in ARGS:
        import preview
        os.makedirs(SHOTS, exist_ok=True)
        bpy.data.objects.remove(floor)
        for ob in objs1 + list(W.values()):
            ob.hide_render = True
        preview.setup_materials()
        parts = preview.renderer_parts(binio.load_stage(SHOW), SHOW, binio)
        cam = preview.setup_scene(objs + inst + parts, res=(1200, 800), samples=int(os.environ.get('CAR_SAMPLES', '32')))
        only = [a for a in ARGS if not a.startswith('--')]
        shots = {
            'front34': ((4.3, 1.25, 5.3), (0.05, 0.50, 0.55), 42),
            'rear34': ((-4.2, 1.55, -5.0), (0.0, 0.55, -0.55), 42),
            'side': ((6.6, 0.85, 0.15), (0.0, 0.52, 0.15), 38),
            'wheel': ((2.15, 1.05, 2.95), (0.78, 0.48, 1.30), 40),
        }
        extra = {   # debugging close-ups, only when named
            'tail': ((-0.9, 0.85, -3.6), (-0.3, 0.6, -1.9), 45),
            'nose': ((1.0, 0.6, 4.3), (0.55, 0.40, 2.4), 45),
            'cabin': ((1.6, 2.2, 1.6), (0.2, 0.6, 0.0), 35),
        }
        shots.update({k: v for k, v in extra.items() if k in only})
        for name, (e, t, lens) in shots.items():
            if only and name not in only:
                continue
            preview.shoot(cam, e, t, lens, os.path.join(SHOTS, 'blender-%s.png' % name))


if __name__ == '__main__':
    main()
