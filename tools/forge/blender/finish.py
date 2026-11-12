# The forge's finishing pass (0211): merge, normals, UVs, ambient occlusion baked into vertex colours, LODs, validation,
# glTF export (meshopt-compressed, read by three's GLTFLoader with its bundled decoder), all deterministic.
import math
import os
import random
import bmesh
import bpy
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree


def merge_all(kit, name):
    """Every part into one object (one glTF mesh, one primitive per material)."""
    parts = list(kit.parts)
    if not parts:
        raise ValueError('the build made nothing')
    whole = kit.join(parts, name=name)
    bm = bmesh.new()
    bm.from_mesh(whole.obj.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=1e-5)
    bmesh.ops.dissolve_degenerate(bm, edges=bm.edges[:], dist=1e-6)
    # one canonical mesh: every face a triangle (quads on their shorter diagonal), vertices and faces in coordinate
    # order, so the same build exports the same bytes (bmesh's own ops leave elements in hash order)
    bmesh.ops.triangulate(bm, faces=[f for f in bm.faces if len(f.verts) > 3], quad_method='SHORT_EDGE', ngon_method='EAR_CLIP')
    key = lambda co: (round(co.x, 5), round(co.y, 5), round(co.z, 5))
    vrank = {v: i for i, v in enumerate(sorted(bm.verts, key=lambda v: key(v.co)))}
    bm.verts.sort(key=lambda v: vrank[v])
    bm.verts.index_update()
    frank = {f: i for i, f in enumerate(sorted(bm.faces, key=lambda f: (f.material_index, sorted(v.index for v in f.verts))))}
    bm.faces.sort(key=lambda f: frank[f])
    bm.to_mesh(whole.obj.data)
    bm.free()
    _drop_unused_materials(whole.obj)
    return whole.obj


def _drop_unused_materials(obj):
    me = obj.data
    used = sorted({p.material_index for p in me.polygons})
    keep = [me.materials[i] for i in used]
    remap = {old: new for new, old in enumerate(used)}
    idx = [remap[p.material_index] for p in me.polygons]
    me.materials.clear()          # (clearing drops the faces' indices: set them after)
    for m in keep:
        me.materials.append(m)
    for p, k in zip(me.polygons, idx):
        p.material_index = k


def weighted_normals(obj):
    """Face-area weighted normals (flat panels stay flat up to their rounded edges), except where a cut kept the
    surface's own normals (kit.keep_normals marks those vertices 'keep_n')."""
    m = obj.modifiers.new('wn', 'WEIGHTED_NORMAL')
    m.keep_sharp = True
    m.weight = 50
    keep = obj.data.attributes.get('keep_n')
    if keep is not None:
        vg = obj.vertex_groups.new(name='keep_n')
        vg.add([i for i, d in enumerate(keep.data) if d.value > 0.5], 1.0, 'REPLACE')
        m.vertex_group = 'keep_n'
        m.invert_vertex_group = True
    _apply(obj)
    obj.vertex_groups.clear()
    if obj.data.attributes.get('keep_n') is not None:
        obj.data.attributes.remove(obj.data.attributes['keep_n'])


def _apply(obj):
    dg = bpy.context.evaluated_depsgraph_get()
    ev = obj.evaluated_get(dg)
    me = bpy.data.meshes.new_from_object(ev, preserve_all_data_layers=True, depsgraph=dg)
    old = obj.data
    obj.modifiers.clear()
    obj.data = me
    if old.users == 0:
        bpy.data.meshes.remove(old)


def unwrap(obj, scale=1.0):
    """UVs for every face, by box projection along each face's dominant axis, in metres (1 UV unit = `scale` m): the
    layout a tiling detail texture or a triplanar material reads. Computed here rather than by Smart UV Project, whose
    island packing lands differently run to run: a forged asset must be the same bytes every time."""
    me = obj.data
    uv = me.uv_layers.get('UVMap') or me.uv_layers.new(name='UVMap')
    for p in me.polygons:
        n = p.normal
        ax = max(range(3), key=lambda i: abs(n[i]))
        for li in p.loop_indices:
            co = me.vertices[me.loops[li].vertex_index].co
            if ax == 0:
                u, v = co.y * (1 if n.x > 0 else -1), co.z
            elif ax == 1:
                u, v = co.x * (-1 if n.y > 0 else 1), co.z
            else:
                u, v = co.x, co.y * (1 if n.z > 0 else -1)
            uv.data[li].uv = (u / scale, v / scale)


def bake_ao(obj, seed, rays=28, reach=0.7, ground=True, floor=0.18):
    """Ambient occlusion per vertex, ray-cast against the model and the ground (z = 0), into the 'Color' attribute
    (multiplied into the base colour by the game). Seeded, so a build is byte-stable."""
    rng = random.Random(seed * 7919 + 17)
    dirs = []
    for _ in range(rays):
        # cosine-weighted hemisphere samples around +Z, turned onto each normal below
        u, v = rng.random(), rng.random()
        r, a = math.sqrt(u), math.tau * v
        dirs.append(Vector((r * math.cos(a), r * math.sin(a), math.sqrt(max(0.0, 1 - u)))))
    dg = bpy.context.evaluated_depsgraph_get()
    bvh = BVHTree.FromObject(obj, dg)
    me = obj.data
    me.calc_loop_triangles()
    # per-vertex normal (area-weighted)
    nrm = [Vector((0, 0, 0)) for _ in me.vertices]
    for p in me.polygons:
        for vi in p.vertices:
            nrm[vi] += p.normal * p.area
    occ = []
    for i, v in enumerate(me.vertices):
        n = nrm[i].normalized() if nrm[i].length > 1e-9 else Vector((0, 0, 1))
        t = n.orthogonal().normalized()
        b = n.cross(t)
        o = v.co + n * 0.003
        hits = 0.0
        for d in dirs:
            w = (t * d.x + b * d.y + n * d.z).normalized()
            h = bvh.ray_cast(o, w, reach)
            if h[0] is not None:
                hits += 1.0 - (h[3] / reach) * 0.5
            elif ground and w.z < -1e-3:
                dist = -o.z / w.z
                if 0 <= dist < reach:
                    hits += 1.0 - (dist / reach) * 0.5
        a = 1.0 - hits / rays
        if os.environ.get('FORGE_NOAO'):
            a = 1.0
        occ.append(floor + (1 - floor) * max(0.0, min(1.0, a)) ** 0.8)
    attr = me.color_attributes.get('Color') or me.color_attributes.new('Color', 'FLOAT_COLOR', 'POINT')
    for i, a in enumerate(occ):
        attr.data[i].color = (a, a, a, 1.0)
    me.color_attributes.active_color = attr
    me.color_attributes.render_color_index = me.color_attributes.find('Color')
    return sum(occ) / max(1, len(occ))


def tris(obj):
    obj.data.calc_loop_triangles()
    return len(obj.data.loop_triangles)


def make_lod(obj, budget, name):
    """A decimated copy under `budget` triangles (collapse, symmetric, keeping material borders)."""
    c = obj.copy()
    c.data = obj.data.copy()
    c.name = name
    bpy.context.scene.collection.objects.link(c)
    n = tris(c)
    if n > budget:
        m = c.modifiers.new('dec', 'DECIMATE')
        m.decimate_type = 'COLLAPSE'
        m.ratio = max(0.02, budget / n * 0.97)
        m.use_symmetry = True
        m.symmetry_axis = 'X'
        m.use_collapse_triangulate = True
        _apply(c)
    return c


def validate(obj, spec, kind):
    """What the gate checks, measured here (the Node side holds the thresholds, tools/forge/lib/gate.mjs)."""
    me = obj.data
    bm = bmesh.new()
    bm.from_mesh(me)
    edges = len(bm.edges)
    nonman = sum(1 for e in bm.edges if not e.is_manifold)
    boundary = sum(1 for e in bm.edges if e.is_boundary)
    # islands: connected components, for the emblem/text check (a small, flat, finely cut island on the skin)
    bm.verts.ensure_lookup_table()
    seen = set()
    islands = []
    for v in bm.verts:
        if v.index in seen:
            continue
        stack, comp = [v], []
        seen.add(v.index)
        while stack:
            a = stack.pop()
            comp.append(a)
            for e in a.link_edges:
                b = e.other_vert(a)
                if b.index not in seen:
                    seen.add(b.index)
                    stack.append(b)
        xs = [p.co.x for p in comp]
        ys = [p.co.y for p in comp]
        zs = [p.co.z for p in comp]
        size = sorted([max(xs) - min(xs), max(ys) - min(ys), max(zs) - min(zs)])
        nf = len({f.index for p in comp for f in p.link_faces})
        islands.append({'verts': len(comp), 'faces': nf, 'size': size,
                        'center': [(max(xs) + min(xs)) / 2, (max(ys) + min(ys)) / 2, (max(zs) + min(zs)) / 2]})
    bm.free()
    co = [v.co for v in me.vertices]
    lo = Vector((min(c.x for c in co), min(c.y for c in co), min(c.z for c in co)))
    hi = Vector((max(c.x for c in co), max(c.y for c in co), max(c.z for c in co)))
    # Text and emblems (AGENTS.md 3.7). The kit has no font or curve, so lettering could only be (a) a small panel or
    # extrusion with an intricate outline (the kit flags those as it builds them: kit.flags) or (b) a cluster of small,
    # thin islands side by side, like glyphs. Wheels are left out of (b): their lug nuts and vanes are rings of small parts.
    wheels = spec.get('wheelZones', [])

    def in_wheel(c):
        return any(abs(c[1] - z['y']) < z['r'] + 0.05 and abs(c[2] - z['z']) < z['r'] + 0.05 for z in wheels)
    glyphs = [i for i in islands if i['size'][2] < 0.15 and i['size'][0] < 0.02 and not in_wheel(i['center'])]
    clusters = []
    for g in glyphs:
        near = [h for h in glyphs if (Vector(h['center']) - Vector(g['center'])).length < 0.45]
        if len(near) >= 6:
            clusters.append({'center': g['center'], 'count': len(near)})
    return {
        'tris': tris(obj), 'verts': len(me.vertices), 'edges': edges,
        'nonManifoldEdges': nonman, 'boundaryEdges': boundary, 'islands': len(islands),
        'glyphClusters': clusters[:4], 'glyphClusterCount': len(clusters),
        # in Blender's frame (x width, y length, z up); finish turns it to glTF's at export
        'bounds': {'min': list(lo), 'max': list(hi)},
        'materials': [m.name for m in me.materials],
        'trisByMaterial': _tris_by_material(me),
        'objectTypes': sorted({o.type for o in bpy.data.objects}),
        'fonts': len(bpy.data.fonts), 'curves': len(bpy.data.curves), 'images': len(bpy.data.images),
    }


def _tris_by_material(me):
    me.calc_loop_triangles()
    out = {}
    for t in me.loop_triangles:
        k = me.materials[t.material_index].name if me.materials else '?'
        out[k] = out.get(k, 0) + 1
    return dict(sorted(out.items(), key=lambda kv: -kv[1]))


def to_game_frame(obj):
    """Nose +Y → glTF +z: a half turn about Z (the exporter maps Blender +Y to glTF −z)."""
    obj.data.transform(Matrix.Rotation(math.pi, 4, 'Z'))
    obj.data.update()


def export(lods, path, extras):
    root = bpy.data.objects.new(extras['id'], None)
    bpy.context.scene.collection.objects.link(root)
    for o in lods:
        o.parent = root
    root['forge'] = extras
    # nose +Y → glTF +z: a half turn about Z on the root (the exporter maps Blender +Y to glTF −z)
    root.rotation_euler = (0, 0, math.pi)
    bpy.ops.object.select_all(action='DESELECT')
    for o in [root, *lods]:
        o.select_set(True)
    bpy.ops.export_scene.gltf(
        filepath=path, export_format='GLB', use_selection=True, export_apply=True, export_yup=True,
        export_normals=True, export_tangents=False, export_materials='EXPORT',
        export_vertex_color='ACTIVE', export_all_vertex_colors=False, export_extras=True, export_cameras=False, export_lights=False,
        export_meshopt_compression_enable=False,   # tools/forge/lib/pack.mjs quantizes and compresses
    )
