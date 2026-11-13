# The Free Drive car's wheels, in the wheel's own frame (centred on the axle, the axle along x, metres). Built for the
# car's -x side (stage wheels 0 and 2): the face of the rim looks toward -x; the renderer mirrors with a -x scale for
# wheels 1 and 3. spin = tyre + open spoked rim + lug nuts (turns about x); steer = ventilated rotor + caliper.
# No sidewall lettering, no cap emblem: blank, our own design.
import math

import bmesh
from mathutils import Matrix, Vector

import kit

V = Vector
TAU = 2 * math.pi
X = V((1, 0, 0))


def orient_sheet(faces, away_from):
    """A sheet built with one consistent winding: flip it whole if, area-weighted, it faces toward away_from(c)."""
    s = 0.0
    for f in faces:
        f.normal_update()
        c = f.calc_center_median()
        s += f.normal.dot(c - away_from(c)) * f.calc_area()
    if s < 0:
        for f in faces:
            f.normal_flip()


def radial(c, k=0.0):
    return V((c.x, c.y * k, c.z * k))


def tyre(bm, R, W, Rr, mat, blocks=28, seg=64):
    hw = W / 2
    tw = W - 0.030
    rc = (R + Rr) / 2

    def toroid_centre(c):
        r = math.hypot(c.y, c.z)
        k = rc / max(r, 1e-6)
        return V((0.0, c.y * k, c.z * k))

    h = R - Rr
    # bead, rim protector, bulge, shoulder; the outboard wall at -x
    side = [(Rr + 0.004, hw - 0.022), (Rr + 0.013, hw - 0.004), (Rr + 0.020, hw - 0.006),
            (Rr + 0.42 * h, hw + 0.000), (Rr + 0.68 * h, hw - 0.004), (R - 0.024, hw - 0.014), (R - 0.011, tw / 2 - 0.002)]
    for sgn in (1, -1):
        fs = kit.lathe(bm, [(r, x * sgn) for r, x in side], seg, mat)
        orient_sheet(fs, toroid_centre)

    # tread: three circumferential grooves (profile), chevron lateral grooves across the shoulders (stations)
    gw, gd = 0.016, 0.007
    pts = [(-tw / 2, 'edge'), (-tw / 2 + 0.004, 'L'), (-0.40 * tw, 'L')]
    for g in (-0.26 * tw, 0.0, 0.26 * tw):
        pts += [(g - gw / 2, 'top'), (g - gw / 2 + 0.0015, 'groove'), (g + gw / 2 - 0.0015, 'groove'), (g + gw / 2, 'top')]
    pts += [(0.40 * tw, 'L'), (tw / 2 - 0.004, 'L'), (tw / 2, 'edge')]

    def r_at(x, kind, lateral):
        crown = R - 0.0055 * (2 * x / tw) ** 2
        if kind == 'edge':
            return R - 0.013
        if kind == 'groove':
            return crown - gd
        if kind == 'L' and lateral:
            return crown - 0.004
        return crown

    pitch = TAU / blocks
    rings = []
    for b in range(blocks):
        a = b * pitch
        rings += [(a, False), (a + 0.78 * pitch, False), (a + 0.78 * pitch, True), (a + pitch, True)]
    cache = {}

    def vert(ri, k):
        a, lat = rings[ri % len(rings)]
        x, kind = pts[k]
        r = r_at(x, kind, lat)
        aa = a + (0.55 * pitch * (2 * abs(x) / tw) if kind in ('L', 'edge') else 0.0)
        key = (round(aa, 9), k, round(r, 7))
        if key not in cache:
            cache[key] = bm.verts.new((x, r * math.cos(aa), r * math.sin(aa)))
        return cache[key]
    tf = []
    for i in range(len(rings)):
        for k in range(len(pts) - 1):
            u = []
            for v in (vert(i, k), vert(i + 1, k), vert(i + 1, k + 1), vert(i, k + 1)):
                if v not in u:
                    u.append(v)
            if len(u) < 3:
                continue
            if len(u) == 3 and (u[1].co - u[0].co).cross(u[2].co - u[0].co).length < 1e-10:
                continue
            f = bm.faces.new(u)
            f.material_index = mat
            tf.append(f)
    orient_sheet(tf, lambda c: V((c.x, 0, 0)))


def rim(bm, R, W, Rr, m_rim, m_barrel, m_lug, m_cap, spokes=5):
    xo = -(W / 2 - 0.014)               # outboard lip plane
    xi = (W / 2 - 0.014)
    seg = 48
    outer = [(Rr - 0.010, xo + 0.004), (Rr + 0.006, xo - 0.001), (Rr + 0.016, xo + 0.004), (Rr + 0.012, xo + 0.012),
             (Rr - 0.002, xo + 0.016), (Rr - 0.002, xi - 0.016), (Rr + 0.012, xi - 0.008), (Rr + 0.014, xi)]
    orient_sheet(kit.lathe(bm, outer, seg, m_rim), lambda c: V((c.x + 0.03, 0, 0)))
    inner = [(Rr + 0.014, xi), (Rr - 0.014, xi + 0.002), (Rr - 0.016, xo + 0.05), (Rr - 0.010, xo + 0.004)]
    orient_sheet(kit.lathe(bm, inner, seg, m_barrel), lambda c: V((c.x, c.y * 2, c.z * 2)))
    # hub: a dished centre, a blank cap
    hx = xo + 0.050
    cap = [(0.0, hx - 0.016), (0.026, hx - 0.016), (0.031, hx - 0.010), (0.036, hx - 0.002)]
    hub = [(0.036, hx - 0.002), (0.086, hx - 0.002), (0.094, hx + 0.006), (0.094, hx + 0.03)]
    orient_sheet(kit.lathe(bm, cap, 32, m_cap), lambda c: V((c.x + 0.05, 0, 0)))
    orient_sheet(kit.lathe(bm, hub, 32, m_rim), lambda c: V((c.x + 0.05, 0, 0)))
    # five twin spokes, concave: the hub sits deep, the spokes sweep out to the lip
    rh, rt = 0.084, Rr - 0.006
    st = 7

    def face_x(r):
        t = (r - rh) / (rt - rh)
        return (hx - 0.004) - ((hx - 0.004) - (xo + 0.006)) * (1 - (1 - t) ** 1.6)
    for k in range(spokes):
        base = TAU * k / spokes
        for side in (-1, 1):
            rings = []
            for i in range(st + 1):
                t = i / st
                r = rh + (rt - rh) * t
                ang = base + side * math.radians(5.5 + 5.0 * t)
                hw = 0.5 * (0.058 - 0.026 * t)
                depth = 0.034 - 0.012 * t
                fx = face_x(r)
                rad = V((0, math.cos(ang), math.sin(ang)))
                tan = V((0, -math.sin(ang), math.cos(ang)))
                sec = [(-hw, depth), (-hw * 0.92, 0.003), (-hw * 0.6, 0.0), (hw * 0.6, 0.0), (hw * 0.92, 0.003), (hw, depth)]
                rings.append([bm.verts.new(rad * r + tan * u + V((fx + d, 0, 0))) for u, d in sec])
            fs = []
            for i in range(st):
                for j in range(len(rings[0]) - 1):
                    f = bm.faces.new((rings[i][j], rings[i][j + 1], rings[i + 1][j + 1], rings[i + 1][j]))
                    f.material_index = m_rim
                    fs.append(f)
            orient_sheet(fs, lambda c: V((c.x + 0.02, c.y, c.z)))
    # lug nuts (hex) on a 5 x 114.3 circle, between the spoke pairs; a valve stem
    for k in range(5):
        a = TAU * (k + 0.5) / 5
        c = V((0, math.cos(a), math.sin(a))) * 0.05715
        p0 = V((hx - 0.002, c.y, c.z))
        fs = kit.add_cyl(bm, p0, p0 - X * 0.016, 0.0105, 0.0105, seg=6, cap0=False, cap1=False, mat=m_lug)
        orient_sheet(fs, lambda q, c=c: V((q.x, c.y, c.z)))
        fs = kit.add_cyl(bm, p0 - X * 0.016, p0 - X * 0.022, 0.0105, 0.0055, seg=6, cap0=False, cap1=True, mat=m_lug)
        orient_sheet(fs, lambda q, p0=p0: V((p0.x - 0.005, p0.y, p0.z)))
    a = TAU * 0.5 / 5 + 0.25
    vb = V((xo + 0.024, math.cos(a) * (Rr - 0.016), math.sin(a) * (Rr - 0.016)))
    fs = kit.add_cyl(bm, vb, vb - X * 0.018, 0.004, 0.003, seg=6, mat=m_lug)
    orient_sheet(fs, lambda q: V((vb.x - 0.009, vb.y, vb.z)))


def rotor(bm, m_rotor, m_hat, m_slot, r0=0.118, r1=0.200, x0=0.013, x1=0.047):
    seg = 48
    t = 0.0085
    for a, b in ((x0, x0 + t), (x1 - t, x1)):
        mid = (a + b) / 2
        fs = kit.lathe(bm, [(r0, a), (r1, a), (r1, b), (r0, b), (r0, a)], seg, m_rotor)
        orient_sheet(fs, lambda c, mid=mid: V((mid,) + tuple(V((c.y, c.z)).normalized() * (r0 + r1) / 2)))
    # 36 curved vanes between the faces
    for k in range(36):
        a0 = TAU * k / 36
        p_in = V((0, math.cos(a0), math.sin(a0))) * (r0 + 0.004)
        p_out = V((0, math.cos(a0 + 0.12), math.sin(a0 + 0.12))) * (r1 - 0.004)
        d = p_out - p_in
        ax = d.normalized()
        Rm = Matrix((ax, X.cross(ax).normalized(), X)).transposed()
        kit.add_box(bm, (p_in + p_out) / 2 + X * ((x0 + x1) / 2), (d.length, 0.006, x1 - x0 - 2 * t + 0.001), Rm, mat=m_rotor)
    # slotted faces: six swept slots a side (shallow, dark)
    for xf, sgn in ((x0 - 0.0004, -1), (x1 + 0.0004, 1)):
        for k in range(6):
            a0 = TAU * k / 6 + (0.3 if sgn > 0 else 0.0)
            pa = V((0, math.cos(a0), math.sin(a0))) * (r0 + 0.018)
            pb = V((0, math.cos(a0 + 0.35), math.sin(a0 + 0.35))) * (r1 - 0.014)
            d = pb - pa
            ax = d.normalized()
            Rm = Matrix((ax, X.cross(ax).normalized(), X)).transposed()
            kit.add_box(bm, (pa + pb) / 2 + X * xf, (d.length, 0.004, 0.0012), Rm, mat=m_slot)
    # the hat (bell) back toward the hub face
    hat = [(r0 + 0.002, x0 + 0.001), (0.100, x0 - 0.004), (0.090, -0.050), (0.040, -0.062), (0.0, -0.062)]
    orient_sheet(kit.lathe(bm, hat, 32, m_hat), lambda c: V((0.03, 0, 0)))


def caliper(bm, m, x0=0.013, x1=0.047, a0=-70, a1=-6, r_in=0.128, r_out=0.226):
    """A monobloc caliper straddling the rotor at the top-rear (wheel frame: y up, -z toward the car's rear)."""
    seg = 12
    A0, A1 = math.radians(a0), math.radians(a1)
    xa, xb = x0 - 0.020, x1 + 0.016
    prof = [(r_in, xb), (r_in, xa + 0.006), (r_in + 0.006, xa), (r_out - 0.010, xa), (r_out, xa + 0.010),
            (r_out, xb - 0.004), (r_out - 0.004, xb), (r_in, xb)]
    fs = kit.lathe(bm, prof, seg, m, a0=A0, a1=A1, closed=False)
    rc, xc = (r_in + r_out) / 2, (xa + xb) / 2

    def centre(c):
        ang = min(max(math.atan2(c.z, c.y), A0 + 0.02), A1 - 0.02)
        return V((xc, rc * math.cos(ang), rc * math.sin(ang)))
    orient_sheet(fs, centre)
    for A, sg in ((A0, -1), (A1, 1)):
        ca, sa = math.cos(A), math.sin(A)
        f = bm.faces.new([bm.verts.new((x, r * ca, r * sa)) for r, x in prof[:-1]])
        f.material_index = m
        f.normal_update()
        tang = V((0, -sa, ca)) * sg
        if f.normal.dot(tang) < 0:
            f.normal_flip()
    am = (A0 + A1) / 2
    p = V((xc, math.cos(am) * r_out, math.sin(am) * r_out))
    dn = V((0, math.cos(am), math.sin(am)))
    fs = kit.add_cyl(bm, p, p + dn * 0.010, 0.005, 0.004, seg=6, mat=m)
    orient_sheet(fs, lambda c: p + dn * (c - p).dot(dn))


def build_spin(R, W, Rr):
    bm = bmesh.new()
    tyre(bm, R, W, Rr, 0)
    rim(bm, R, W, Rr, 1, 2, 3, 4)
    return bm, ['drive-tyre', 'drive-rim', 'drive-rim-barrel', 'drive-lug', 'drive-satin']


def build_steer():
    bm = bmesh.new()
    rotor(bm, 0, 1, 1)
    caliper(bm, 2)
    return bm, ['roadster-rotor', 'drive-hub', 'drive-caliper']
