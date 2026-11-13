# The Free Drive car's body: the show roadster's own skin (roadster.bin) rebuilt as the reference, so the silhouette and
# every animated part's seat stay where they were, then refined: welded, bevelled (rolled edges), densified (so the
# baked AO has vertices to live on), real panel gaps cut in as grooves, weighted normals. Game frame throughout.
import math

import bmesh
from mathutils import Vector

import kit

V = Vector


def reference(st, folder, binio):
    """{old material suffix: (verts [Vector], tris)} from the stage's roadster."""
    out = {}
    for m, vs, tris in binio.read_mesh(st['roadster'], folder):
        n = m['name'].replace('roadster-', '')
        out[n] = ([V(v[:3]) for v in vs], tris)
    return out


def bm_from(ref, names, mat=0):
    bm = bmesh.new()
    for n in names:
        vs, tris = ref[n]
        bv = [bm.verts.new(p) for p in vs]
        for t in tris:
            try:
                f = bm.faces.new((bv[t[0]], bv[t[1]], bv[t[2]]))
                f.material_index = mat
            except ValueError:
                pass
    kit.weld(bm)
    bmesh.ops.dissolve_degenerate(bm, dist=1e-5, edges=bm.edges[:])
    return bm


# ---------------------------------------------------------------- panel gaps

def groove(bm, p, n, box, face_ok, gap_mat, w_in=0.0016, w_out=0.0034, depth=0.006):
    """Cut a shut line: the surface along the plane (p, n) inside box gets a 2 mm-wide, 4.5 mm-deep channel whose
    floor takes gap_mat; its walls stay in the panel's paint (the AO darkens them)."""
    p, n = V(p), V(n).normalized()
    lo, hi = V(box[0]), V(box[1])

    def inbox(c, pad=0.0):
        return all(lo[i] - pad <= c[i] <= hi[i] + pad for i in range(3))

    def region():
        return [f for f in bm.faces if face_ok(f) and any(inbox(v.co, 0.03) for v in f.verts)]

    for off in (-w_out, -w_in, w_in, w_out):
        fs = region()
        if not fs:
            return 0
        es = list({e for f in fs for e in f.edges})
        vs = list({v for f in fs for v in f.verts})
        bmesh.ops.bisect_plane(bm, geom=fs + es + vs, dist=1e-6, plane_co=p + n * off, plane_no=n)
    bm.normal_update()
    strip = []
    for f in region():
        c = f.calc_center_median()
        d = (c - p).dot(n)
        if abs(d) < w_in and inbox(c):
            strip.append(f)
    push = {}
    for f in strip:
        for v in f.verts:
            push.setdefault(v, V((0, 0, 0)))
            push[v] += f.normal * f.calc_area()
    for v, nn in push.items():
        if nn.length > 0:
            v.co -= nn.normalized() * depth
    for f in strip:
        f.material_index = gap_mat
    return len(strip)


def side(sign, ny=0.6):
    return lambda f: f.normal.x * sign > 0.5 and abs(f.normal.y) < ny


def top(f):
    return f.normal.y > 0.3


def cut_gaps(bm, gap_mat):
    n = 0
    for s in (1, -1):
        xs = (0.86, 1.02) if s > 0 else (-1.02, -0.86)
        # door: front and rear shut lines (where the show car's seams were)
        n += groove(bm, (0, 0, 0.95), (0, 0, 1), ((xs[0], 0.19, 0.93), (xs[1], 0.80, 0.97)), side(s), gap_mat)
        n += groove(bm, (0, 0, -0.27), (0, 0, 1), ((xs[0], 0.14, -0.29), (xs[1], 0.915, -0.25)), side(s), gap_mat)
        # frunk lid sides: along the old seam from the cowl to the nose
        a, b = V((0.705 * s, 0.752, 1.32)), V((0.640 * s, 0.481, 2.20))
        d = (b - a).normalized()
        nn = d.cross(V((0, 1, 0))).normalized()
        lo = V((min(a.x, b.x) - 0.01, 0.40, 1.335))
        hi = V((max(a.x, b.x) + 0.01, 0.80, 2.185))
        n += groove(bm, a, nn, (lo, hi), top, gap_mat)
    # frunk lid: rear edge (at the cowl, ahead of the wipers) and front edge (above the nose)
    n += groove(bm, (0, 0, 1.335), (0, 0, 1), ((-0.70, 0.60, 1.30), (0.70, 0.80, 1.37)), top, gap_mat)
    n += groove(bm, (0, 0, 2.185), (0, 0, 1), ((-0.645, 0.40, 2.15), (0.645, 0.62, 2.22)), top, gap_mat)
    # tail: the deck's shut line above the tail bar
    n += groove(bm, (0, 0, -1.80), (0, 0, 1), ((-0.93, 0.90, -1.83), (0.93, 0.97, -1.77)), top, gap_mat)
    # charge flap on the +x rear quarter
    fx = (0.86, 1.02)
    zf, yf = (-0.63, -0.47), (0.64, 0.75)
    n += groove(bm, (0, 0, zf[0]), (0, 0, 1), ((fx[0], yf[0] - 0.002, zf[0] - 0.01), (fx[1], yf[1] + 0.002, zf[0] + 0.01)), side(1), gap_mat)
    n += groove(bm, (0, 0, zf[1]), (0, 0, 1), ((fx[0], yf[0] - 0.002, zf[1] - 0.01), (fx[1], yf[1] + 0.002, zf[1] + 0.01)), side(1), gap_mat)
    n += groove(bm, (0, yf[0], 0), (0, 1, 0), ((fx[0], yf[0] - 0.01, zf[0] - 0.002), (fx[1], yf[0] + 0.01, zf[1] + 0.002)), side(1), gap_mat)
    n += groove(bm, (0, yf[1], 0), (0, 1, 0), ((fx[0], yf[1] - 0.01, zf[0] - 0.002), (fx[1], yf[1] + 0.01, zf[1] + 0.002)), side(1), gap_mat)
    return n


# ---------------------------------------------------------------- shells

def shell(ref, names, name, mats, bevel_w, seg, angle, dens, gaps=False, sharp=48):
    bm = bm_from(ref, names)
    bmesh.ops.triangulate(bm, faces=bm.faces[:])
    ob = kit.obj_from_bm(name, bm, mats, sharp_deg=None)
    if bevel_w > 0:
        kit.bevel_mod(ob, bevel_w, seg, angle)
        kit.apply_modifiers(ob)
    bm = kit.bm_of(ob)
    bmesh.ops.triangulate(bm, faces=bm.faces[:])
    if dens:
        kit.densify(bm, dens)
    if gaps:
        cut_gaps(bm, 1)
        bmesh.ops.triangulate(bm, faces=bm.faces[:])
    kit.bm_back(ob, bm, sharp)
    kit.weighted_normals(ob)
    kit.apply_modifiers(ob)
    return ob


def glass(ref, dens=0.15, frit_w=0.032):
    """The canopy, densified so reflections roll, plus a black ceramic frit band (opaque) just under its edge."""
    bm = bm_from(ref, ['glass'])
    bmesh.ops.triangulate(bm, faces=bm.faces[:])
    kit.densify(bm, dens)
    # relax the canopy into one smooth sheet (its edges pinned) so the sky slides across it instead of breaking
    # into facets; it moves a few millimetres at most
    inner = [v for v in bm.verts if not v.is_boundary]
    for _ in range(8):
        bmesh.ops.smooth_vert(bm, verts=inner, factor=0.5, use_axis_x=True, use_axis_y=True, use_axis_z=True)
    bm.normal_update()
    # the frit: a strip from each boundary edge inward along the glass, 1 mm beneath it
    from mathutils.bvhtree import BVHTree
    tree = BVHTree.FromBMesh(bm)
    fb = bmesh.new()
    for e in bm.edges:
        if not e.is_boundary:
            continue
        f = e.link_faces[0]
        a, b = e.verts[0].co, e.verts[1].co
        t = (b - a).normalized()
        nrm = f.normal
        inward = nrm.cross(t).normalized()
        if inward.dot(f.calc_center_median() - (a + b) / 2) < 0:
            inward = -inward
        # an open seam inside the canopy (a T-junction in the source mesh) has glass on its far side too: no frit
        probe = (a + b) / 2 - inward * 0.004
        near = tree.find_nearest(probe)
        if near[0] is not None and near[3] < 0.002:
            continue
        lift = -nrm * 0.001
        q = [fb.verts.new(a + lift - t * 0.004), fb.verts.new(b + lift + t * 0.004),
             fb.verts.new(b + lift + t * 0.004 + inward * frit_w), fb.verts.new(a + lift - t * 0.004 + inward * frit_w)]
        nf = fb.faces.new(q)
        nf.normal_update()
        if nf.normal.dot(nrm) < 0:
            nf.normal_flip()
    bmesh.ops.triangulate(fb, faces=fb.faces[:])
    frit = kit.obj_from_bm('glass-frit', fb, ['drive-gloss-black'], sharp_deg=None)
    ob = kit.obj_from_bm('glass', bm, ['drive-glass'], sharp_deg=40)
    return ob, frit
