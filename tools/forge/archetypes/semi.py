# The Lineup's semi slot (LINEUP_SPEC 'semi'): an electric 6x4 day-cab tractor of our own design at the researched size.
# A tall aero cab with a wraparound windshield and a built-in roof fairing, side fairings between the axles, cab
# extenders, a fifth wheel on bare rails, amber roof markers, camera arms. No trailer, no badges, no names.
import math


def build(kit, spec, rng):
    hl, hw, H = spec['l'] / 2, spec['w'] / 2, spec['h']
    steer, drive1, drive2 = spec['axles']
    back = 0.42 + rng.uniform(-0.04, 0.04)       # where the cab ends
    S = lambda **k: k
    stations = [
        (hl,        S(zb=0.55, zs=1.15, zt=1.32, w=hw * 0.84, wb=hw * 0.8, wt=hw * 0.78, n=2.6)),
        (hl - 0.05, S(zb=0.46, zs=1.45, zt=1.70, w=hw * 0.95, wb=hw * 0.9, wt=hw * 0.88, n=2.8, crown=0.01)),
        (hl - 0.22, S(zb=0.44, zs=1.80, zt=2.05, w=hw, wb=hw * 0.95, wt=hw * 0.94, n=3.0, crown=0.02)),
        (2.60,      S(zb=0.46, zs=2.08, zt=2.32, w=hw, wb=hw * 0.96, wt=hw * 0.92, n=3.4, crown=0.02)),
        (1.85,      S(zb=0.48, zs=2.20, zt=3.70, w=hw, wb=hw * 0.96, wt=hw * 0.86, n=4.2, crown=0.03, sh=0.035)),
        (1.15,      S(zb=0.48, zs=2.24, zt=H - 0.03, w=hw, wb=hw * 0.96, wt=hw * 0.84, n=4.6, crown=0.03, sh=0.04)),
        (back + 0.08, S(zb=0.48, zs=2.25, zt=H - 0.05, w=hw, wb=hw * 0.96, wt=hw * 0.86, n=4.8, crown=0.025, sh=0.04)),
        (back,      S(zb=0.50, zs=2.22, zt=H - 0.09, w=hw * 0.97, wb=hw * 0.93, wt=hw * 0.83, n=4.6, crown=0.02, sh=0.03)),
    ]
    cab = kit.body(stations, ring=8, mat='paint', sharp=30, name='cab')
    kit.paint_faces(cab, 'chassis', lambda c, n: n[2] < -0.6)
    kit.arches(cab, [steer], clearance=0.05)

    # glass: a wraparound windshield and the door windows
    kit.project(cab, [(-1.12, 2.40), (1.12, 2.40), (1.0, 3.62), (-1.0, 3.62)], plane='front', mat='glass', offset=0.008, thickness=0.004, density=0.16, name='windshield')
    kit.project(cab, [(2.12, 2.38), (1.0, 2.40), (0.9, 3.30), (1.45, 3.32), (1.9, 3.0)], plane='side', mat='glass', offset=0.008, thickness=0.004, density=0.16, name='door-glass')
    # lamps: a bar across the nose with two lamp pods, amber markers on the roof's leading edge
    kit.project(cab, [(-1.05, 1.58), (1.05, 1.58), (1.05, 1.66), (-1.05, 1.66)], plane='front', mat='lens', offset=0.004, thickness=0.005, density=0.12, name='barlens')
    kit.strip(cab, [(-1.0, 1.62), (1.0, 1.62)], 0.03, plane='front', mat='lamp_white', offset=0.009, name='bar')
    for s in (1, -1):
        kit.project(cab, [(s * 0.62, 1.20), (s * 1.0, 1.20), (s * 1.0, 1.36), (s * 0.62, 1.36)], plane='front', mat='lens', offset=0.004, thickness=0.005, name='pod')
        kit.strip(cab, [(s * 0.66, 1.28), (s * 0.96, 1.28)], 0.04, plane='front', mat='lamp_white', offset=0.009, name='podlamp')
    for k in range(5):
        x = (k - 2) * 0.3
        kit.project(cab, [(x - 0.05, 1.56), (x + 0.05, 1.56), (x + 0.05, 1.62), (x - 0.05, 1.62)], plane='top', mat='lamp_amber', offset=0.008, thickness=0.01, density=0.05, name='marker')
    # a lower intake and a bumper in satin black
    kit.project(cab, [(-1.12, 0.62), (1.12, 0.62), (1.12, 0.98), (-1.12, 0.98)], plane='front', mat='trim', offset=0.004, thickness=0.006, density=0.16, name='bumper')
    # camera arms at the A-pillars (the tractor's mirrors), out to the spec's width at the arms
    reach = spec['wMirrors'] / 2
    for s in (1, -1):
        kit.box((reach - hw + 0.08, 0.06, 0.05), at=(s * (hw + (reach - hw) / 2 - 0.04), 2.45, 2.75), mat='trim', bevel=0.015, segments=1, name='arm')
        kit.box((0.09, 0.14, 0.22), at=(s * (reach - 0.05), 2.45, 2.68), mat='trim', bevel=0.025, segments=1, name='camera')
        # grab handle and step under the door
        kit.box((0.06, 0.5, 0.05), at=(s * (hw - 0.06), 1.5, 0.62), mat='steel', bevel=0.012, segments=1, name='step')
        # cab extender: a fin closing the gap behind the cab
        kit.box((0.03, 0.42, 2.7), at=(s * (hw - 0.03), back - 0.18, 2.55), mat='paint', bevel=0.012, segments=1, name='extender')
        # side fairing between the steer and drive axles
        f0, f1 = steer['at'] - steer['r'] - 0.12, drive1['at'] + drive1['r'] + 0.12
        kit.box((0.05, f0 - f1, 0.86), at=(s * (hw - 0.04), (f0 + f1) / 2, 0.82), mat='paint', bevel=0.02, segments=1, name='fairing')
        kit.box((0.05, f0 - f1 - 0.04, 0.12), at=(s * (hw - 0.035), (f0 + f1) / 2, 0.42), mat='trim', bevel=0.012, segments=1, name='skirt')
        # fenders over the drive axles and the mud flaps
        for a in (drive1, drive2):
            kit.box((0.62, 0.95, 0.04), at=(s * (a['track'] / 2), a['at'], a['r'] * 2 + 0.1), mat='chassis', bevel=0.015, segments=1, name='fender')
        kit.box((0.62, 0.02, 0.5), at=(s * (drive2['track'] / 2), -hl + 0.05, 0.48), mat='rubber', name='flap')
    # the frame: rails, cross members, a deck behind the cab, the fifth wheel
    for s in (1, -1):
        kit.box((0.12, back + hl - 0.08, 0.3), at=(s * 0.47, (back - hl + 0.08) / 2, 1.0), mat='chassis', bevel=0.01, segments=1, name='rail')
    for y in (drive1['at'] + 0.5, drive1['at'] - 0.66, drive2['at'] - 0.5):
        kit.box((0.86, 0.1, 0.18), at=(0, y, 0.98), mat='chassis', name='cross')
    kit.box((2.1, 0.55, 1.15), at=(0, back - 0.32, 1.42), mat='paint_alt', bevel=0.04, segments=2, name='equipment')
    kit.box((1.0, 1.3, 0.03), at=(0, back - 1.05, 1.17), mat='steel', name='deck')
    fw = kit.cylinder(0.46, 0.09, at=(0, (drive1['at'] + drive2['at']) / 2 + 0.25, 1.24), mat='steel', verts=28, bevel=0.012, segments=1, name='fifth')
    kit.box((0.18, 0.5, 0.05), at=(0, (drive1['at'] + drive2['at']) / 2 - 0.05, 1.27), mat='chassis', name='jaw')
    # axle housings and the wheels (steel discs; duals on the drive axles)
    for a in spec['axles']:
        kit.cylinder(0.11, a['track'] - 0.2, at=(0, a['at'], a['r']), axis='X', mat='chassis', verts=12, name='axle')
        kit.axle_wheels(a, style='steel', rim='rim_silver')
