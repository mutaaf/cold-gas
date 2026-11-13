# The Free Drive car's added detail: mirrors, flush handles, wipers, the intake's slats, the diffuser's strakes, arch
# liners, lamp units with inner structure, the plate recess (blank: no characters), the small named lamps the renderer
# drives, and a cabin (tub, dash, screen, console, two buckets, a wheel) to read through the glass. Game frame.
import math

import bmesh
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

import kit

V = Vector
RX = lambda deg: Matrix.Rotation(math.radians(deg), 3, 'X')
RY = lambda deg: Matrix.Rotation(math.radians(deg), 3, 'Y')
RZ = lambda deg: Matrix.Rotation(math.radians(deg), 3, 'Z')


def bvh_of(objs):
    vs, fs = [], []
    for ob in objs:
        o = len(vs)
        vs += [v.co.copy() for v in ob.data.vertices]
        fs += [[i + o for i in p.vertices] for p in ob.data.polygons]
    return BVHTree.FromPolygons(vs, fs)


def hit(bvh, origin, direction):
    loc, nor, idx, d = bvh.ray_cast(V(origin), V(direction).normalized())
    if loc is None:
        raise RuntimeError('detail placement ray missed the body at %r' % (origin,))
    if nor.dot(V(direction)) > 0:
        nor = -nor
    return loc, nor


class Parts:
    """Collects faces per material name into one bmesh per material (joined later)."""

    def __init__(self):
        self.bms = {}

    def bm(self, mat):
        if mat not in self.bms:
            self.bms[mat] = bmesh.new()
        return self.bms[mat]

    def objects(self, prefix, sharp=35):
        out = []
        for mat in sorted(self.bms):
            bm = self.bms[mat]
            bmesh.ops.triangulate(bm, faces=bm.faces[:])
            out.append(kit.obj_from_bm(prefix + '-' + mat, bm, [mat], sharp_deg=sharp))
        self.bms = {}
        return out


def surface_box(P, bm, p, n, along, size, lift, bevel=0.0, seg=2):
    """A box lying on the surface at p (normal n); `along` is its long axis hint; size = (long, short, thick)."""
    n = V(n).normalized()
    a = V(along)
    a = (a - n * a.dot(n)).normalized()
    b = n.cross(a)
    R = Matrix((a, b, n)).transposed()
    kit.add_box(bm, V(p) + n * (lift + size[2] / 2), size, R, bevel, seg)


# ---------------------------------------------------------------- exterior

def mirrors(P, bvh):
    for s in (1, -1):
        base, nb = hit(bvh, (2.0 * s, 0.795, 0.875), (-s, 0, 0))
        hc = V((1.050 * s, 0.868, 0.852))           # housing centre
        # arm: a swept, tapered blade from the door's top corner to the housing
        bm = P.bm('drive-gloss-black')
        a0 = base - V((0.004 * s, 0, 0))
        a1 = hc - V((0.055 * s, 0.006, 0))
        mid = (a0 + a1) / 2
        d = a1 - a0
        R = Matrix((d.normalized(), V((0, 1, 0)).cross(d.normalized()).normalized(),
                    d.normalized().cross(V((0, 1, 0)).cross(d.normalized()).normalized()))).transposed()
        kit.add_box(bm, mid, (d.length + 0.01, 0.050, 0.022), R, 0.008, 2)
        # housing: a rounded pod, nose forward
        kit.add_box(bm, hc, (0.150, 0.082, 0.098), None, 0.030, 3)
        # its glass on the rear face, a dark seal round it
        kit.add_box(P.bm('drive-trim'), hc + V((0, 0, -0.0465)), (0.136, 0.068, 0.004), None, 0.010, 2)
        kit.add_box(P.bm('drive-mirror'), hc + V((0, 0, -0.0495)), (0.126, 0.058, 0.004), None, 0.008, 2)


def handles(P, bvh):
    for s in (1, -1):
        p, n = hit(bvh, (2.0 * s, 0.715, -0.04), (-s, 0, 0))
        surface_box(P, P.bm('drive-gloss-black'), p, n, (0, 0, 1), (0.215, 0.040, 0.004), 0.0004, 0.010, 2)
        surface_box(P, P.bm('drive-satin'), p, n, (0, 0, 1), (0.185, 0.022, 0.006), 0.0012, 0.008, 2)


def wipers(P, bvh):
    bm = P.bm('drive-trim')
    for x0, x1, piv in ((-0.66, -0.07, -0.05), (0.00, 0.60, 0.62)):
        pa, na = hit(bvh, (x0, 2.0, 1.258), (0, -1, 0))
        pb, nb = hit(bvh, (x1, 2.0, 1.258), (0, -1, 0))
        n = (na + nb).normalized()
        d = pb - pa
        mid = (pa + pb) / 2
        a = d.normalized()
        b = n.cross(a)
        R = Matrix((a, b, n)).transposed()
        # blade (rubber + spine) and the arm above it, running back to a pivot on the cowl
        kit.add_box(P.bm('drive-rubber-seal'), mid + n * 0.004, (d.length, 0.006, 0.008), R, 0.002, 1)
        kit.add_box(bm, mid + n * 0.011, (d.length, 0.013, 0.008), R, 0.003, 1)
        pp, npv = hit(bvh, (piv, 2.0, 1.36), (0, -1, 0))
        ae = mid + a * (d.length * 0.30) * (1 if piv > mid.x else -1) + n * 0.020
        ps = pp + npv * 0.012
        dd = ps - ae
        Ra = Matrix((dd.normalized(), npv.cross(dd.normalized()).normalized(),
                     dd.normalized().cross(npv.cross(dd.normalized()).normalized()))).transposed()
        kit.add_box(bm, (ae + ps) / 2, (dd.length, 0.012, 0.007), Ra, 0.003, 1)
        kit.add_cyl(bm, pp - npv * 0.004, pp + npv * 0.016, 0.016, 0.013, seg=12)


def intake(P):
    bm = P.bm('drive-gloss-black')
    for y in (0.205, 0.245, 0.285, 0.325, 0.365):
        kit.add_box(bm, (0, y, 2.405), (1.30, 0.007, 0.085), RX(-14), 0.003, 1)
    bmd = P.bm('drive-trim')
    for x in (-0.44, -0.22, 0.0, 0.22, 0.44):
        kit.add_box(bmd, (x, 0.29, 2.39), (0.008, 0.22, 0.12), None, 0.003, 1)
    # a fine mesh backing behind the slats
    bmm = P.bm('drive-under')
    for i in range(27):
        x = -0.65 + i * 0.05
        kit.add_box(bmm, (x, 0.29, 2.335), (0.004, 0.23, 0.02), None)
    for j in range(5):
        kit.add_box(bmm, (0, 0.19 + j * 0.05, 2.335), (1.30, 0.004, 0.02), None)


def vents(P, bvh):
    """Louvres across the open channels between the frunk lid and the front fenders (they read as holes otherwise)."""
    bm = P.bm('drive-gloss-black')
    for s in (1, -1):
        z = 1.30
        while z < 1.99:
            try:
                pb, _ = hit(bvh, (0.600 * s, 2.0, z), (0, -1, 0))
                y = pb.y - 0.022
                pf, _ = hit(bvh, (0.650 * s, y, z), (s, 0, 0))
            except RuntimeError:
                z += 0.075
                continue
            x1 = abs(pf.x) - 0.004
            if x1 > 0.68:
                kit.add_box(bm, ((0.648 + x1) / 2 * s, y, z), (x1 - 0.648, 0.006, 0.055), RX(35), 0.002, 1)
            z += 0.075


def diffuser(P):
    bm = P.bm('drive-carbon')
    for x in (-0.62, -0.31, 0.0, 0.31, 0.62):
        out = [(0.0, 0.0), (0.0, 0.135), (0.30, 0.04), (0.30, 0.0)]
        kit.prism(bm, out, ((x - 0.004, 0.15, -1.875), (0, 0, -1), (0, 1, 0)), (1, 0, 0), 0.008)
    # the shelf's lip
    kit.add_box(bm, (0, 0.152, -2.19), (1.30, 0.012, 0.02), None, 0.003, 1)


def arch_liners(P):
    bm = P.bm('drive-under')
    for zc, yc, r in ((1.62, 0.343, 0.402), (-1.205, 0.367, 0.432)):
        for s in (1, -1):
            seg = 22
            a0, a1 = math.radians(-22), math.radians(202)
            rings = []
            for i in range(seg + 1):
                a = a0 + (a1 - a0) * i / seg
                z, y = zc + r * math.cos(a), yc + r * math.sin(a)
                rings.append([bm.verts.new((x * s, y, z)) for x in (0.63, 0.79, 0.955)])
            for i in range(seg):
                for k in range(2):
                    q = [rings[i][k], rings[i + 1][k], rings[i + 1][k + 1], rings[i][k + 1]]
                    f = bm.faces.new(q if s > 0 else list(reversed(q)))
            # face the axle
    bm.normal_update()
    for f in bm.faces:
        c = f.calc_center_median()
        zc, yc = (1.62, 0.343) if c.z > 0 else (-1.205, 0.367)
        toward = V((0, yc - c.y, zc - c.z))
        if f.normal.dot(toward) < 0:
            f.normal_flip()


def lamps(P, bvh):
    for s in (1, -1):
        # headlamp unit on the nose pod, under the renderer's head triangle
        x0, x1, y0, y1 = 0.714, 0.908, 0.326, 0.450
        cx, cy = (x0 + x1) / 2 * s, (y0 + y1) / 2
        zf = 2.470
        kit.add_box(P.bm('drive-gloss-black'), (cx, cy, zf + 0.002), (x1 - x0, y1 - y0, 0.008), None, 0.012, 2)
        # a chrome reflector bed, three projector modules (bowl, dark lens, LED ring), a light guide above them
        kit.add_box(P.bm('drive-reflector'), (cx, 0.372, zf + 0.0062), (x1 - x0 - 0.020, 0.064, 0.002), None, 0.006, 2)
        for px in (0.752, 0.811, 0.870):
            c0 = V((px * s, 0.372, zf + 0.0065))
            kit.add_cyl(P.bm('drive-reflector'), c0, c0 + V((0, 0, 0.006)), 0.0235, 0.0215, seg=20, cap0=False)
            kit.add_cyl(P.bm('drive-gloss-black'), c0 + V((0, 0, 0.006)), c0 + V((0, 0, 0.0085)), 0.0145, 0.0125, seg=16, cap0=False)
            kit.torus(P.bm('drive-drl'), c0 + V((0, 0, 0.0062)), (0, 0, 1), 0.0185, 0.0018, seg=24, rseg=4)
        kit.add_box(P.bm('drive-drl'), (cx, 0.428, zf + 0.0085), (x1 - x0 - 0.026, 0.008, 0.003), None)
        kit.add_box(P.bm('drive-drl'), ((x1 - 0.011) * s, 0.392, zf + 0.0085), (0.008, 0.064, 0.003), None)
        kit.add_box(P.bm('drive-lens'), (cx, cy, zf + 0.0125), (x1 - x0 + 0.004, y1 - y0 + 0.004, 0.003), None, 0.008, 2)
    # tail: a full-width gloss-black band on the rear face, a red light line, L-shaped ends, a clear cover
    zr = -1.861
    kit.add_box(P.bm('drive-gloss-black'), (0, 0.758, zr - 0.004), (1.87, 0.072, 0.008), None, 0.006, 2)
    kit.add_box(P.bm('drive-tail'), (0, 0.766, zr - 0.0085), (1.70, 0.018, 0.002), None)
    for s in (1, -1):
        kit.add_box(P.bm('drive-tail'), (0.905 * s, 0.748, zr - 0.0085), (0.040, 0.054, 0.002), None)
        kit.add_box(P.bm('drive-reflector'), (0.780 * s, 0.738, zr - 0.0084), (0.15, 0.014, 0.0015), None)
    kit.add_box(P.bm('drive-lens'), (0, 0.758, zr - 0.0105), (1.874, 0.074, 0.002), None, 0.006, 2)
    # plate recess (blank plate; no characters), its two lamps, the rear-face reflectors
    kit.add_box(P.bm('drive-gloss-black'), (0, 0.600, -1.864), (0.34, 0.19, 0.012), None, 0.006, 2)
    kit.add_box(P.bm('drive-plate'), (0, 0.600, -1.8705), (0.31, 0.155, 0.003), None, 0.006, 2)
    for s in (1, -1):
        kit.add_box(P.bm('drive-plateLamp'), (0.05 * s, 0.695, -1.8705), (0.030, 0.006, 0.006), None)
        kit.add_box(P.bm('drive-marker'), (0.60 * s, 0.502, -1.8655), (0.12, 0.010, 0.006), None, 0.002, 1)
        # side markers (rear quarter) and amber repeaters (front fender), where the show car had them
        kit.add_box(P.bm('drive-marker'), (0.962 * s, 0.430, -1.790), (0.008, 0.090, 0.030), None, 0.002, 1)
        kit.add_box(P.bm('drive-amber'), (0.968 * s, 0.630, 1.000), (0.007, 0.022, 0.070), None, 0.002, 1)


# ---------------------------------------------------------------- cabin

def cabin(P):
    I, S, T, G = P.bm('drive-interior'), P.bm('drive-seat'), P.bm('drive-satin'), P.bm('drive-gloss-black')
    kit.add_box(I, (0, 0.330, 0.05), (1.24, 0.06, 1.80), None, 0.01, 1)                  # floor
    for s in (1, -1):
        kit.add_box(I, (0.6925 * s, 0.580, 0.075), (0.055, 0.44, 1.75), None, 0.02, 2)    # door cards
        kit.add_box(T, (0.668 * s, 0.700, 0.30), (0.006, 0.012, 0.50), None)             # door pull trim
    kit.add_box(I, (0, 0.695, 0.7875), (1.33, 0.23, 0.525), None, 0.035, 3)               # dash
    kit.add_box(I, (0, 0.745, 1.17), (1.36, 0.02, 0.26), RX(-12), 0.006, 1)               # cowl panel
    kit.add_box(G, (0.31, 0.835, 0.585), (0.23, 0.05, 0.11), RX(18), 0.012, 2)            # binnacle
    kit.add_box(G, (0, 0.895, 0.505), (0.30, 0.18, 0.012), RX(-14), 0.008, 2)             # centre screen
    kit.add_box(T, (0, 0.830, 0.535), (0.05, 0.05, 0.03), None, 0.006, 1)                 # its mount
    kit.add_box(T, (0, 0.765, 0.531), (1.10, 0.014, 0.012), None, 0.004, 1)               # dash trim line
    kit.add_box(I, (0, 0.46, 0.12), (0.15, 0.20, 0.86), None, 0.025, 2)                   # console
    kit.add_box(G, (0, 0.562, 0.12), (0.11, 0.006, 0.60), None, 0.004, 1)                 # its top panel
    kit.add_box(I, (0, 0.70, -0.86), (1.24, 0.68, 0.03), None, 0.01, 1)                   # bulkhead
    kit.add_box(I, (0, 0.885, -1.25), (1.24, 0.02, 0.78), None, 0.01, 1)                  # rear deck under the glass
    for s in (1, -1):
        x0 = 0.31 * s
        kit.add_box(S, (x0, 0.475, -0.12), (0.40, 0.075, 0.48), RX(-5), 0.03, 3)          # cushion
        for b in (1, -1):
            kit.add_box(S, (x0 + 0.205 * b, 0.505, -0.13), (0.07, 0.11, 0.46), RX(-5), 0.03, 3)
        R = RX(-16)
        kit.add_box(S, (x0, 0.775, -0.465), (0.40, 0.58, 0.085), R, 0.03, 3)              # back
        for b in (1, -1):
            kit.add_box(S, V((x0 + 0.21 * b, 0.0, 0.0)) + V((0, 0.755, -0.44)), (0.07, 0.50, 0.15), R, 0.03, 3)
        kit.add_box(G, V((x0, 0.0, 0.0)) + V((0, 0.985, -0.505)), (0.12, 0.035, 0.09), R, 0.01, 2)  # harness slot plate
    # the wheel (driver at +x): rim, hub, three spokes, column
    c = V((0.31, 0.740, 0.405))
    n = V((0, 0.42, -0.907)).normalized()
    kit.torus(I, c, n, 0.170, 0.0165, seg=32, rseg=7)
    kit.add_cyl(G, c - n * 0.01, c + n * 0.03, 0.050, 0.045, seg=20)
    u = V((1, 0, 0))
    w = n.cross(u).normalized()
    for d in (u, -u, -w):
        p0, p1 = c + d * 0.045 + n * 0.012, c + d * 0.158
        dd = p1 - p0
        R = Matrix((dd.normalized(), n.cross(dd.normalized()).normalized(), n)).transposed()
        kit.add_box(T, (p0 + p1) / 2, (dd.length, 0.028, 0.012), R, 0.004, 1)
    kit.add_cyl(I, c - n * 0.005, V((0.31, 0.700, 0.62)), 0.03, 0.04, seg=14)
    # cabin ambient strips (the renderer drives drive-ambient): doors, dash, bulkhead, where the show car had them
    A = P.bm('drive-ambient')
    for s in (1, -1):
        kit.add_box(A, (0.666 * s, 0.660, 0.05), (0.006, 0.008, 0.90), None)
    kit.add_box(A, (0, 0.800, 0.522), (1.15, 0.008, 0.006), None)
    kit.add_box(A, (0, 0.900, -0.8425), (0.05, 0.14, 0.006), None)
