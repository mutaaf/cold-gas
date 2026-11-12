# A passenger car from a design sheet (0211): the body lofted from stations, the wheel wells cut, the glasshouse,
# lamps and mirrors laid on from the same curves, the wheels on the spec's axles. The sedan, crossover and cab
# archetypes are design sheets for this. Our own designs: no badges, no lettering, no real model's lines.
import math


def car(kit, spec, rng, P):
    hw = spec['w'] / 2
    st = P['stations']
    body = kit.body(st, ring=P.get('ring', 8), mat='paint', sharp=P.get('sharp', 32), name='body')
    kit.paint_faces(body, 'chassis', lambda c, n: n[2] < -0.6)
    if P.get('cladding'):
        zc = P['cladding']
        kit.paint_faces(body, 'trim', lambda c, n: c[2] < zc and n[2] > -0.6)
    import os
    if not os.environ.get('FORGE_NOARCH'):
        kit.arches(body, spec['axles'], clearance=P.get('arch', 0.035))

    curves = {k: kit.curve([(y, s[k]) for y, s in st if k in s]) for k in ('zs', 'zt', 'w', 'wt', 'sh')}
    zs, zt, wt = curves['zs'], curves['zt'], curves['wt']
    G = P['glass']
    a0, a1, c1, c0 = G['a_base'], G['a_top'], G['c_top'], G['c_base']   # A-pillar foot/top, C-pillar top/foot (y)
    belt = G.get('belt', 0.03)
    top = G.get('top', 0.075)

    def side_outline(y_front, y_back, inset, a_side, c_side):
        """A daylight opening: the belt, then the C line (or a vertical cut at a B-pillar), the roof edge, and the A line
        (or a vertical cut), all `inset` m inside the opening."""
        lo = lambda y: zs(y) + belt + inset
        hi = lambda y: zt(y) - top - inset
        yf_top = a1 - inset if a_side else y_front
        yb_top = c1 + inset if c_side else y_back
        pts = [(y_front + (y_back - y_front) * k / 8, lo(y_front + (y_back - y_front) * k / 8)) for k in range(9)]
        for k in range(1, 7):
            t = k / 6
            y = y_back + (yb_top - y_back) * t
            pts.append((y, lo(y_back) + (hi(yb_top) - lo(y_back)) * t))
        for k in range(1, 10):
            y = yb_top + (yf_top - yb_top) * k / 10
            pts.append((y, hi(y)))
        for k in range(0, 6):
            t = k / 6
            y = yf_top + (y_front - yf_top) * t
            pts.append((y, hi(yf_top) + (lo(y_front) - hi(yf_top)) * t))
        return pts

    kit.project(body, side_outline(a0, c0, 0.0, True, True), plane='side', mat='trim', offset=0.005, thickness=0.004, density=0.16, name='dlo')
    b, bw = G['b'], G.get('b_w', 0.09)
    gi = 0.022
    single = not G.get('quarter', True)   # one side window from the A line to the C line (no B-pillar)
    kit.project(body, side_outline(a0 - gi, c0 + gi, gi, True, True) if single else side_outline(a0 - gi, b + bw / 2, gi, True, False), plane='side', mat='glass', offset=0.008, thickness=0.004, density=0.12, name='glass-front')
    if G.get('quarter', True):
        kit.project(body, side_outline(b - bw / 2, c0 + gi, gi, False, True), plane='side', mat='glass', offset=0.008, thickness=0.004, density=0.12, name='glass-rear')

    # windshield: from the cowl to the header, its sides inside the A-pillars
    ws_lo, ws_hi = zt(a0) + 0.03, zt(a1) - 0.06
    ww_lo, ww_hi = wt(a0) * G.get('ws_w_lo', 0.86), wt(a1) * G.get('ws_w_hi', 0.82)
    kit.project(body, [(-ww_lo, ws_lo), (ww_lo, ws_lo), (ww_hi, ws_hi), (-ww_hi, ws_hi)], plane='front', mat='glass', offset=0.007, thickness=0.004, density=0.11, name='windshield')
    if G.get('backlight', True):
        bl_lo, bl_hi = G.get('bl_lo', zt(c0) + 0.06), zt(c1) - 0.07
        bw_lo, bw_hi = wt(c0) * 0.84, wt(c1) * 0.8
        kit.project(body, [(-bw_lo, bl_lo), (bw_lo, bl_lo), (bw_hi, bl_hi), (-bw_hi, bl_hi)], plane='rear', mat='glass', offset=0.007, thickness=0.004, density=0.11, name='backlight')
    if G.get('roof') in ('glass', 'paint_alt'):
        r0, r1 = a1 - 0.03, c1 + 0.05
        rw = min(wt(a1), wt(c1)) * 0.86
        kit.project(body, [(-rw, r1), (rw, r1), (rw, r0), (-rw, r0)], plane='top', mat=G['roof'], offset=0.007, thickness=0.004, density=0.14, name='roof')

    # lamps: each a dark lens with the lit line on it
    for s in (1, -1):
        for lamp in P.get('lamps', []):
            plane = lamp['plane']
            o = lambda pts: [(s * u, v) for u, v in pts]
            if lamp.get('lens'):
                kit.project(body, o(lamp['lens']), plane=plane, mat='lens', offset=0.003, thickness=0.005, mirror=False, name='lens')
            kit.strip(body, o(lamp['line']), lamp['width'], plane=plane, mat=lamp['mat'], offset=0.0072, name='lamp')
    for bar in P.get('bars', []):   # full-width features (a light bar, an intake), drawn once across the centre line
        if bar.get('line'):
            kit.strip(body, bar['line'], bar['width'], plane=bar['plane'], mat=bar['mat'], offset=bar.get('offset', 0.0072), name='bar')
        else:
            kit.project(body, bar['outline'], plane=bar['plane'], mat=bar['mat'], offset=bar.get('offset', 0.003), thickness=0.005, mirror=False, name='panel')

    # mirrors (or side cameras): a pod on a stalk at the A-pillar's foot
    M = P.get('mirror')
    if M:
        for s in (1, -1):
            y, z = M['y'], M['z']
            x = s * (hw - M.get('in', 0.02))
            kit.box((0.05, 0.06, 0.035), at=(x - s * 0.05, y + 0.03, z - 0.04), mat='trim', bevel=0.012, name='stalk')
            kit.box(M.get('size', (0.11, 0.17, 0.095)), at=(x + s * 0.01, y, z), mat=M.get('mat', 'paint'), bevel=0.032, segments=2, name='mirror')
            kit.box((0.012, M.get('size', (0.11, 0.17, 0.095))[1] * 0.78, M.get('size', (0.11, 0.17, 0.095))[2] * 0.7), at=(x + s * 0.01, y - 0.07, z), mat='glass', bevel=0.004, name='mirrorglass')
    # flush handles: a slim satin bar on each door
    for y in P.get('handles', []):
        kit.strip(body, [(y + 0.1, zs(y) - 0.05), (y - 0.1, zs(y) - 0.05)], 0.028, plane='side', mat='trim', offset=0.003, mirror=True, name='handle')
    W = P.get('wheels', {})
    for a in spec['axles']:
        kit.axle_wheels(a, style=W.get('style', 'spokes'), spokes=W.get('spokes', 5), rim=W.get('rim', 'rim_silver'))
    return body
