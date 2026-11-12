# An 80s rally hatch with light pods (a trope, not any real car): a boxy two-box shell, square flares, a pod bar of four
# round lamps on the nose, a roof vent, mud flaps, a contrast stripe along the flank, dished wheels.
import math


def build(kit, spec, rng):
    hl, hw, H, zc = spec['l'] / 2, spec['w'] / 2, spec['h'], spec['clearance']
    roof = H - 0.03
    S = lambda **k: k
    stations = [
        (hl, S(zb=0.32, zs=0.60, zt=0.64, w=hw * 0.9, wb=hw * 0.86, wt=hw * 0.84, n=5)),
        (hl - 0.05, S(zb=0.22, zs=0.68, zt=0.72, w=hw * 0.97, wb=hw * 0.93, wt=hw * 0.9, n=5, crown=0.004)),
        (1.55, S(zb=zc, zs=0.73, zt=0.79, w=hw, wb=hw * 0.96, wt=hw * 0.92, n=6, crown=0.008)),
        (1.05, S(zb=zc, zs=0.79, zt=0.86, w=hw, wb=hw * 0.96, wt=hw * 0.9, n=6, crown=0.01)),
        (0.50, S(zb=zc, zs=0.85, zt=roof - 0.02, w=hw, wb=hw * 0.96, wt=hw * 0.8, n=6, crown=0.012, sh=0.04)),
        (-1.40, S(zb=zc, zs=0.87, zt=roof, w=hw, wb=hw * 0.96, wt=hw * 0.8, n=6, crown=0.012, sh=0.04)),
        (-1.90, S(zb=zc + 0.02, zs=0.88, zt=roof - 0.05, w=hw * 0.99, wb=hw * 0.95, wt=hw * 0.82, n=6, crown=0.01, sh=0.03)),
        (-hl + 0.06, S(zb=0.28, zs=0.88, zt=1.16, w=hw * 0.97, wb=hw * 0.92, wt=hw * 0.86, n=5)),
        (-hl, S(zb=0.34, zs=0.86, zt=1.10, w=hw * 0.92, wb=hw * 0.86, wt=hw * 0.82, n=5)),
    ]
    body = kit.body(stations, ring=7, mat='paint', sharp=24, name='body')
    kit.paint_faces(body, 'chassis', lambda c, n: n[2] < -0.6)
    kit.arches(body, spec['axles'], clearance=0.04)

    # glass: an upright windshield, two side windows each side, the hatch's glass
    kit.project(body, [(-0.72, 0.9), (0.72, 0.9), (0.62, roof - 0.07), (-0.62, roof - 0.07)], plane='front', mat='glass', offset=0.007, thickness=0.004, density=0.12, name='windshield')
    kit.project(body, [(1.0, 0.9), (-0.12, 0.91), (-0.12, roof - 0.09), (0.55, roof - 0.09)], plane='side', mat='glass', offset=0.008, thickness=0.004, density=0.12, name='door')
    kit.project(body, [(-0.24, 0.91), (-1.78, 0.93), (-1.84, roof - 0.12), (-0.24, roof - 0.09)], plane='side', mat='glass', offset=0.008, thickness=0.004, density=0.12, name='quarter')
    kit.project(body, [(-0.64, 0.92), (0.64, 0.92), (0.6, 1.1), (-0.6, 1.1)], plane='rear', mat='glass', offset=0.007, thickness=0.004, density=0.12, name='hatchglass')

    # the nose: a black grille between square lamps, and the pod bar of four round lamps in front of it
    kit.project(body, [(-0.5, 0.42), (0.5, 0.42), (0.5, 0.58), (-0.5, 0.58)], plane='front', mat='trim', offset=0.004, thickness=0.006, name='grille')
    for s in (1, -1):
        kit.project(body, [(s * 0.55, 0.45), (s * 0.78, 0.45), (s * 0.78, 0.58), (s * 0.55, 0.58)] if s > 0 else [(s * 0.78, 0.45), (s * 0.55, 0.45), (s * 0.55, 0.58), (s * 0.78, 0.58)],
                    plane='front', mat='lamp_white', offset=0.005, thickness=0.006, name='headlamp')
    kit.box((1.5, 0.05, 0.04), at=(0, hl - 0.02, 0.36), mat='trim', bevel=0.01, segments=1, name='podbar')
    for x in (-0.6, -0.22, 0.22, 0.6):
        kit.cylinder(0.085, 0.07, at=(x, hl - 0.03, 0.36), axis='Y', mat='trim', verts=20, bevel=0.01, segments=1, name='pod')
        kit.cylinder(0.07, 0.012, at=(x, hl + 0.006, 0.36), axis='Y', mat='lamp_white', verts=20, name='podlens')
    # tail lamps and a black hatch panel between them
    for s in (1, -1):
        kit.project(body, [(s * 0.55, 0.66), (s * 0.82, 0.66), (s * 0.82, 0.86), (s * 0.55, 0.86)] if s > 0 else [(s * 0.82, 0.66), (s * 0.55, 0.66), (s * 0.55, 0.86), (s * 0.82, 0.86)],
                    plane='rear', mat='lamp_red', offset=0.005, thickness=0.006, name='tail')
    kit.project(body, [(-0.5, 0.7), (0.5, 0.7), (0.5, 0.82), (-0.5, 0.82)], plane='rear', mat='trim', offset=0.004, thickness=0.006, name='hatchpanel')

    # a contrast stripe along each flank (no numbers, no lettering) and square flares round the wells
    kit.strip(body, [(hl - 0.15, 0.66), (-hl + 0.15, 0.68)], 0.06, plane='side', mat='paint_alt', offset=0.003, mirror=True, name='stripe')
    for a in spec['axles']:
        r = a['r'] + 0.04
        out = [(a['at'] - r - 0.06, a['r'] - 0.1), (a['at'] - r - 0.06, a['r'] + r * 0.6), (a['at'] - r * 0.6, a['r'] + r + 0.06),
               (a['at'] + r * 0.6, a['r'] + r + 0.06), (a['at'] + r + 0.06, a['r'] + r * 0.6), (a['at'] + r + 0.06, a['r'] - 0.1),
               (a['at'] + r, a['r'] - 0.1), (a['at'] + r, a['r'] + r * 0.55), (a['at'] + r * 0.55, a['r'] + r),
               (a['at'] - r * 0.55, a['r'] + r), (a['at'] - r, a['r'] + r * 0.55), (a['at'] - r, a['r'] - 0.1)]
        for s in (1, -1):
            kit.extrude(out, 0.04, at=(s * (hw - 0.026), 0, 0), plane='YZ', mat='trim', bevel=0.008, segments=1, name='flare')
            # a mud flap behind each wheel
            kit.box((0.2, 0.012, 0.22), at=(s * (a['track'] / 2), a['at'] - a['r'] - 0.06, 0.2), mat='rubber', name='flap')
    # the roof vent
    kit.box((0.5, 0.42, 0.04), at=(0, -0.3, roof + 0.012), mat='trim', bevel=0.012, segments=1, name='vent')
    for a in spec['axles']:
        kit.axle_wheels(a, style='steel', rim='rim_silver')
