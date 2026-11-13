# Small bmesh / bpy helpers for the Free Drive car (tools/forge/car/build.py). Everything is built in the GAME frame
# (metres, y up, nose toward +z); only the preview renders put the car under a +90 deg X root so Blender sees it Z-up.
import math

import bmesh
import bpy
from mathutils import Matrix, Vector

V = Vector


# ---------------------------------------------------------------- objects and materials

def link(ob):
    bpy.context.scene.collection.objects.link(ob)
    return ob


def blender_mat(name):
    m = bpy.data.materials.get(name)
    if m is None:
        m = bpy.data.materials.new(name)
    return m


def obj_from_bm(name, bm, mats, smooth=True, sharp_deg=None):
    """mats: list of material names (slot order = face.material_index). sharp_deg: mark edges sharper than this."""
    if sharp_deg is not None:
        lim = math.radians(sharp_deg)
        for e in bm.edges:
            if len(e.link_faces) == 2:
                e.smooth = e.calc_face_angle(0.0) < lim
            else:
                e.smooth = True
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for p in me.polygons:
        p.use_smooth = smooth
    for n in mats:
        me.materials.append(blender_mat(n))
    return link(bpy.data.objects.new(name, me))


def apply_modifiers(ob):
    dg = bpy.context.evaluated_depsgraph_get()
    ev = ob.evaluated_get(dg)
    me = bpy.data.meshes.new_from_object(ev, preserve_all_data_layers=True, depsgraph=dg)
    old = ob.data
    ob.modifiers.clear()
    ob.data = me
    bpy.data.meshes.remove(old)
    return ob


def bm_of(ob):
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    return bm


def bm_back(ob, bm, sharp_deg=None):
    if sharp_deg is not None:
        lim = math.radians(sharp_deg)
        for e in bm.edges:
            e.smooth = not (len(e.link_faces) == 2 and e.calc_face_angle(0.0) >= lim)
    bm.to_mesh(ob.data)
    bm.free()
    for p in ob.data.polygons:
        p.use_smooth = True


def mark_sharp(ob, deg):
    bm = bm_of(ob)
    bm_back(ob, bm, deg)


def bevel_mod(ob, width, segments=3, angle=30, profile=0.5, clamp=True):
    m = ob.modifiers.new('bevel', 'BEVEL')
    m.width = width
    m.segments = segments
    m.limit_method = 'ANGLE'
    m.angle_limit = math.radians(angle)
    m.profile = profile
    m.use_clamp_overlap = clamp
    m.miter_outer = 'MITER_ARC'
    m.harden_normals = False
    return m


def weighted_normals(ob, weight=50):
    m = ob.modifiers.new('wn', 'WEIGHTED_NORMAL')
    m.mode = 'FACE_AREA'
    m.weight = weight
    m.keep_sharp = True
    return m


# ---------------------------------------------------------------- bmesh building blocks

def densify(bm, maxlen, passes=6):
    for _ in range(passes):
        long = [e for e in bm.edges if e.calc_length() > maxlen]
        if not long:
            break
        bmesh.ops.subdivide_edges(bm, edges=long, cuts=1, use_grid_fill=False)
        bmesh.ops.triangulate(bm, faces=bm.faces[:], quad_method='BEAUTY', ngon_method='BEAUTY')


def weld(bm, dist=0.0008):
    bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=dist)


def add_box(bm, center, size, rot=None, bevel=0.0, seg=2, mat=0):
    """An axis box (size = full extents) rotated by rot (3x3 Matrix) about its centre, optional rounded edges."""
    res = bmesh.ops.create_cube(bm, size=1.0)
    vs = res['verts']
    M = Matrix.Diagonal((size[0], size[1], size[2], 1.0))
    if rot is not None:
        M = rot.to_4x4() @ M
    M = Matrix.Translation(V(center)) @ M
    bmesh.ops.transform(bm, matrix=M, verts=vs)
    faces = list({f for v in vs for f in v.link_faces})
    if bevel > 0:
        edges = list({e for v in vs for e in v.link_edges})
        r = bmesh.ops.bevel(bm, geom=vs + edges, offset=bevel, offset_type='OFFSET', segments=seg, profile=0.5,
                            affect='EDGES', clamp_overlap=True)
        faces = list({f for f in faces if f.is_valid} | set(r['faces']))
        faces = list({f for v in r['verts'] for f in v.link_faces} | set(faces))
    for f in faces:
        if f.is_valid:
            f.material_index = mat
    return [f for f in faces if f.is_valid]


def add_cyl(bm, p0, p1, r0, r1=None, seg=16, cap0=True, cap1=True, mat=0, a0=0.0, a1=None, up=None):
    """A (cone) cylinder from p0 to p1. Returns faces."""
    r1 = r0 if r1 is None else r1
    p0, p1 = V(p0), V(p1)
    ax = (p1 - p0).normalized()
    u = (up if up is not None else (V((0, 1, 0)) if abs(ax.y) < 0.9 else V((1, 0, 0))))
    u = (u - ax * u.dot(ax)).normalized()
    w = ax.cross(u)
    full = a1 is None
    a1 = 2 * math.pi if a1 is None else a1
    n = seg if full else seg + 1
    ring0, ring1 = [], []
    for i in range(n):
        a = a0 + (a1 - a0) * i / seg
        d = u * math.cos(a) + w * math.sin(a)
        ring0.append(bm.verts.new(p0 + d * r0))
        ring1.append(bm.verts.new(p1 + d * r1))
    faces = []
    m = seg if full else seg
    for i in range(m):
        j = (i + 1) % n
        faces.append(bm.faces.new((ring0[i], ring0[j], ring1[j], ring1[i])))
    if full and cap0 and r0 > 0:
        faces.append(bm.faces.new(list(reversed(ring0))))
    if full and cap1 and r1 > 0:
        faces.append(bm.faces.new(ring1))
    for f in faces:
        f.material_index = mat
    return faces


def lathe(bm, prof, seg, mat=0, a0=0.0, a1=2 * math.pi, closed=True, axis='x'):
    """Revolve a profile [(r, x)] about the x axis (the wheel axle). Returns faces; profile order sets the facing."""
    n = seg if closed else seg + 1
    rings = []
    for i in range(n):
        a = a0 + (a1 - a0) * i / seg
        ca, sa = math.cos(a), math.sin(a)
        rings.append([bm.verts.new((x, r * ca, r * sa)) for r, x in prof])
    faces = []
    for i in range(seg if closed else seg):
        j = (i + 1) % n
        for k in range(len(prof) - 1):
            q = (rings[i][k], rings[j][k], rings[j][k + 1], rings[i][k + 1])
            if len({id(v) for v in q}) == 4:
                faces.append(bm.faces.new(q))
    for f in faces:
        f.material_index = mat
    return faces


def torus(bm, center, normal, R, r, seg=32, rseg=8, mat=0, a0=0.0, a1=None):
    c, n = V(center), V(normal).normalized()
    u = (V((0, 1, 0)) - n * n.y)
    if u.length < 1e-4:
        u = V((1, 0, 0)) - n * n.x
    u.normalize()
    w = n.cross(u)
    full = a1 is None
    a1 = 2 * math.pi if full else a1
    cnt = seg if full else seg + 1
    rings = []
    for i in range(cnt):
        a = a0 + (a1 - a0) * i / seg
        d = u * math.cos(a) + w * math.sin(a)
        ring = []
        for k in range(rseg):
            b = 2 * math.pi * k / rseg
            ring.append(bm.verts.new(c + d * (R + r * math.cos(b)) + n * (r * math.sin(b))))
        rings.append(ring)
    faces = []
    for i in range(seg):
        j = (i + 1) % cnt
        for k in range(rseg):
            l = (k + 1) % rseg
            faces.append(bm.faces.new((rings[i][k], rings[j][k], rings[j][l], rings[i][l])))
    for f in faces:
        f.material_index = mat
    return faces


def prism(bm, outline, p0, axis, depth, mat=0, bevel=0.0, seg=2):
    """Extrude a planar outline [(u, v)] in the plane spanned by (U, Vv) at p0 along axis by depth.
    p0 = (origin, U, Vv). Returns faces."""
    o, U, W = (V(p0[0]), V(p0[1]), V(p0[2]))
    ax = V(axis)
    a = [bm.verts.new(o + U * u + W * v) for u, v in outline]
    b = [bm.verts.new(o + U * u + W * v + ax * depth) for u, v in outline]
    faces = [bm.faces.new(list(reversed(a))), bm.faces.new(b)]
    n = len(outline)
    for i in range(n):
        j = (i + 1) % n
        faces.append(bm.faces.new((a[i], a[j], b[j], b[i])))
    bmesh.ops.recalc_face_normals(bm, faces=faces)
    if bevel > 0:
        vs = a + b
        edges = list({e for v in vs for e in v.link_edges})
        r = bmesh.ops.bevel(bm, geom=vs + edges, offset=bevel, offset_type='OFFSET', segments=seg, profile=0.5,
                            affect='EDGES', clamp_overlap=True)
        faces = [f for f in faces if f.is_valid] + list(r['faces'])
        faces = list({f for v in r['verts'] for f in v.link_faces} | set(faces))
    for f in faces:
        if f.is_valid:
            f.material_index = mat
    return [f for f in faces if f.is_valid]


def frame_from(normal, up_hint=(0, 1, 0)):
    """3x3 rotation whose local z = normal, local y ~ up_hint."""
    n = V(normal).normalized()
    up = V(up_hint)
    x = up.cross(n)
    if x.length < 1e-5:
        x = V((1, 0, 0))
    x.normalize()
    y = n.cross(x).normalized()
    return Matrix((x, y, n)).transposed()
