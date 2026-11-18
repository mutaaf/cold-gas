# The Lineup's semi slot (LINEUP_SPEC 'semi'): a heavy electric 6x4 day-cab tractor of our own design at the researched
# size. A flat-fronted cab-over with a little rake: a split two-pane windshield on a centre post with a sun visor and two
# wipers, separate headlamp clusters (a projector pair under an L-shaped running light), a blanked front panel with
# cooling slats where a radiator would be, a step bumper with fog lamps; the door over the front axle with its window,
# handle and grab bar, two treads behind the wheel; mirror heads on arms; a roof fairing and cab extenders; battery packs
# strapped between the axles under a side fairing; bare rails behind the cab with air tanks, the trailer lines and a
# fifth wheel; quarter fenders, dual drive wheels on hub-piloted discs, mud flaps and lamps on the frame's end.
# No trailer, no badges, no names.
import math


def build(kit, spec, rng):
    hl, hw, H = spec['l'] / 2, spec['w'] / 2, spec['h']
    steer, drive1, drive2 = spec['axles']
    cw = hw * 0.965                                # the cab's half-width
    back = 1.0 + rng.uniform(-0.03, 0.03)          # where the cab ends
    front = hl - 0.02
    S = lambda **k: k
    stations = [
        (front,        S(zb=0.62, zs=1.10, zt=1.95, w=cw * 0.975, wb=cw * 0.955, wt=cw * 0.955, n=8)),
        (front - 0.02, S(zb=0.60, zs=1.30, zt=2.35, w=cw * 0.99, wb=cw * 0.97, wt=cw * 0.97, n=8)),
        (front - 0.06, S(zb=0.58, zs=1.50, zt=2.80, w=cw * 0.997, wb=cw * 0.975, wt=cw * 0.965, n=8, crown=0.01)),
        (front - 0.14, S(zb=0.58, zs=1.70, zt=3.12, w=cw, wb=cw * 0.98, wt=cw * 0.955, n=7, crown=0.02)),
        (front - 0.30, S(zb=0.58, zs=1.80, zt=3.20, w=cw, wb=cw * 0.98, wt=cw * 0.945, n=7, crown=0.03)),
        (2.50,         S(zb=0.60, zs=1.80, zt=3.21, w=cw, wb=cw * 0.98, wt=cw * 0.945, n=7, crown=0.03)),
        (2.22,         S(zb=1.02, zs=1.80, zt=3.215, w=cw, wb=cw * 0.98, wt=cw * 0.945, n=7, crown=0.03)),
        (back + 0.10,  S(zb=1.05, zs=1.78, zt=3.21, w=cw * 0.995, wb=cw * 0.975, wt=cw * 0.94, n=7, crown=0.03)),
        (back,         S(zb=1.07, zs=1.72, zt=3.15, w=cw * 0.98, wb=cw * 0.96, wt=cw * 0.925, n=6, crown=0.02)),
    ]
    cab = kit.body(stations, ring=8, mat='paint', sharp=30, name='cab')
    kit.paint_faces(cab, 'chassis', lambda c, n: n[2] < -0.6)
    kit.arches(cab, [steer], clearance=0.06)

    # the roof fairing: a smooth hood over the cab's roof, up to the box's height at its trailing edge
    roof = [
        (front - 0.36, S(zb=3.10, zs=3.17, zt=3.24, w=cw * 0.78, wb=cw * 0.78, wt=cw * 0.6, n=2.4)),
        (2.30,         S(zb=3.10, zs=3.26, zt=3.58, w=cw * 0.9, wb=cw * 0.9, wt=cw * 0.74, n=2.8, crown=0.02)),
        (1.60,         S(zb=3.10, zs=3.36, zt=3.98, w=cw * 0.95, wb=cw * 0.95, wt=cw * 0.8, n=3.4, crown=0.03)),
        (back + 0.12,  S(zb=3.10, zs=3.42, zt=H - 0.01, w=cw * 0.96, wb=cw * 0.96, wt=cw * 0.82, n=4.0, crown=0.03)),
        (back + 0.02,  S(zb=3.10, zs=3.42, zt=H - 0.04, w=cw * 0.95, wb=cw * 0.95, wt=cw * 0.8, n=4.0, crown=0.02)),
    ]
    kit.body(roof, ring=6, mat='paint', sharp=35, name='roof-fairing')

    # --- the front ---
    # windshield: two panes on a black surround, the centre post between them; a sun visor over it; two wipers
    kit.project(cab, [(-1.17, 2.02), (1.17, 2.02), (1.14, 3.07), (-1.14, 3.07)], plane='front', mat='trim', offset=0.004, thickness=0.004, density=0.16, name='ws-surround')
    for s in (1, -1):
        pane = [(0.045, 2.07), (1.125, 2.07), (1.1, 3.02), (0.045, 3.02)]
        kit.project(cab, [(s * u, v) for u, v in (pane if s > 0 else reversed(pane))], plane='front', mat='glass', offset=0.008, thickness=0.004, density=0.14, mirror=False, name='windshield')
        kit.box((0.86, 0.016, 0.022), at=(s * 0.55, front + 0.01, 2.12), rot=(0, s * -0.1, 0), mat='trim', bevel=0.006, segments=1, name='wiper')
        kit.box((0.05, 0.05, 0.05), at=(s * 0.16, front + 0.015, 2.09), mat='trim', bevel=0.01, segments=1, name='wiper-pivot')
    kit.box((2.2, 0.2, 0.035), at=(0, front - 0.06, 3.16), rot=(-0.25, 0, 0), mat='trim', bevel=0.012, segments=1, name='visor')
    # the blanked front panel with its slats, and the paint band under the windshield
    kit.project(cab, [(-0.86, 1.32), (0.86, 1.32), (0.86, 1.88), (-0.86, 1.88)], plane='front', mat='gloss', offset=0.004, thickness=0.005, density=0.14, name='panel')
    for k in range(5):
        z = 1.40 + k * 0.105
        kit.box((1.6, 0.03, 0.04), at=(0, front + 0.018, z), mat='trim', bevel=0.008, segments=1, name='slat')
    # headlamp clusters: a dark housing, two projectors, an L-shaped running light, the turn lamp outboard
    for s in (1, -1):
        hs = [(0.60, 0.96), (1.13, 0.96), (1.15, 1.22), (0.60, 1.22)]
        kit.project(cab, [(s * u, v) for u, v in (hs if s > 0 else reversed(hs))], plane='front', mat='lens', offset=0.003, thickness=0.006, density=0.08, mirror=False, name='head-housing')
        for x in (0.74, 0.9):
            kit.cylinder(0.05, 0.03, at=(s * x, front + 0.012, 1.065), axis='Y', mat='steel', verts=16, name='reflector')
            kit.cylinder(0.034, 0.03, at=(s * x, front + 0.02, 1.065), axis='Y', mat='lamp_white', verts=14, name='projector')
        kit.box((0.46, 0.012, 0.022), at=(s * 0.84, front + 0.014, 1.18), mat='lamp_white', name='drl')
        kit.box((0.022, 0.012, 0.16), at=(s * 1.09, front + 0.014, 1.09), mat='lamp_white', name='drl')
        kit.box((0.05, 0.012, 0.2), at=(s * 1.15, front + 0.006, 1.09), mat='lamp_amber', name='turn')
        # a marker on each upper cab corner, and one on the side behind the wheel
        kit.box((0.05, 0.1, 0.04), at=(s * (cw - 0.04), front - 0.25, 3.2), mat='lamp_amber', bevel=0.008, segments=1, name='marker')
    # the step bumper: a black beam with steel treads, fog lamps and a tow recess
    kit.box((2.46, 0.13, 0.42), at=(0, hl - 0.03, 0.69), mat='trim', bevel=0.035, segments=1, name='bumper')
    kit.box((2.3, 0.09, 0.06), at=(0, hl - 0.03, 0.47), mat='chassis', bevel=0.012, segments=1, name='lip')
    for s in (1, -1):
        kit.box((0.42, 0.11, 0.014), at=(s * 0.62, hl - 0.03, 0.905), mat='steel', name='tread')
        kit.box((0.2, 0.012, 0.075), at=(s * 0.98, hl + 0.037, 0.66), mat='lens', bevel=0.005, segments=1, name='fog')
        kit.box((0.16, 0.012, 0.035), at=(s * 0.98, hl + 0.043, 0.66), mat='lamp_white', name='foglamp')
    kit.box((0.24, 0.012, 0.12), at=(0, hl + 0.037, 0.66), mat='chassis', bevel=0.01, segments=1, name='tow')

    # --- the cab's sides ---
    d0, d1 = 2.44, 1.24                           # the door's front and rear edges (over the front axle)
    for s in (1, -1):
        X = s * (cw + 0.002)
        # mirror heads on two arms, out to the spec's width at the arms (a main glass over a wide-angle one)
        reach = spec['wMirrors'] / 2 - 0.035
        for z in (2.85, 2.2):
            kit.box((reach - cw + 0.06, 0.04, 0.035), at=(s * (cw + (reach - cw) / 2 - 0.02), front - 0.16, z), mat='trim', bevel=0.01, segments=1, name='arm')
        kit.box((0.03, 0.03, 0.75), at=(s * (reach - 0.03), front - 0.16, 2.52), mat='trim', bevel=0.008, segments=1, name='post')
        kit.box((0.07, 0.11, 0.4), at=(s * reach, front - 0.2, 2.6), mat='trim', bevel=0.02, segments=1, name='mirror')
        kit.box((0.06, 0.012, 0.36), at=(s * reach, front - 0.258, 2.6), mat='glass', name='mirror-glass')
        kit.box((0.07, 0.11, 0.17), at=(s * reach, front - 0.2, 2.24), mat='trim', bevel=0.02, segments=1, name='mirror-wide')
        kit.box((0.06, 0.012, 0.14), at=(s * reach, front - 0.258, 2.24), mat='glass', name='mirror-glass')
        # grab bar behind the door, steps under it
        kit.box((0.03, 0.03, 1.0), at=(X + s * 0.03, d1 - 0.08, 2.05), mat='steel', bevel=0.01, segments=1, name='grab')
        for z in (1.6, 2.5):
            kit.box((0.04, 0.03, 0.03), at=(X + s * 0.012, d1 - 0.08, z), mat='steel', name='grab-foot')
        kit.box((0.34, 0.44, 0.66), at=(s * (cw - 0.2), 1.17, 0.76), mat='chassis', bevel=0.02, segments=1, name='step-box')
        for z in (0.56, 0.86):
            kit.box((0.36, 0.42, 0.032), at=(s * (cw - 0.17), 1.17, z), mat='steel', bevel=0.006, segments=1, name='step')
        # cab extender: a fin closing the gap behind the cab
        kit.box((0.03, 0.4, 2.1), at=(s * (cw - 0.02), back - 0.18, 2.15), mat='paint', bevel=0.012, segments=1, name='extender')
        # side fairing over the battery packs, the packs and their straps below it, a charge-port door
        f0, f1 = 0.94, drive1['at'] + drive1['r'] + 0.1
        kit.box((0.05, f0 - f1, 0.5), at=(s * (cw - 0.05), (f0 + f1) / 2, 1.0), mat='paint', bevel=0.02, segments=1, name='fairing')
        kit.box((0.035, 0.22, 0.17), at=(s * (cw - 0.022), f0 - 0.25, 1.05), mat='gloss', bevel=0.01, segments=1, name='port')
        kit.box((0.5, f0 - f1 - 0.06, 0.42), at=(s * (cw - 0.3), (f0 + f1) / 2, 0.52), mat='chassis', bevel=0.02, segments=1, name='pack')
        for k in range(3):
            y = f0 - 0.3 - k * (f0 - f1 - 0.6) / 2
            kit.box((0.52, 0.05, 0.44), at=(s * (cw - 0.3), y, 0.52), mat='steel', name='strap')
        # quarter fenders over the drive axles, mud flaps behind
        for a in (drive1, drive2):
            kit.box((0.64, 0.95, 0.04), at=(s * (a['track'] / 2), a['at'], a['r'] * 2 + 0.11), mat='chassis', bevel=0.015, segments=1, name='fender')
        kit.box((0.62, 0.02, 0.52), at=(s * (drive2['track'] / 2), -hl - 0.075, 0.5), mat='rubber', name='flap')
        kit.box((0.05, 0.3, 0.04), at=(s * (drive2['track'] / 2 - 0.25), -hl + 0.06, 0.78), mat='steel', name='flap-hanger')

    # door seams, window and handle (projected onto the side; mirrored)
    kit.strip(cab, [(d0, 1.2), (d0, 3.03), (d1, 3.03), (d1, 1.2)], 0.01, plane='side', mat='trim', offset=0.0025, mirror=True, name='door-seam')
    kit.project(cab, [(d1 + 0.1, 2.12), (d0 - 0.1, 2.12), (d0 - 0.1, 2.78), (d0 - 0.22, 2.94), (d1 + 0.1, 2.94)], plane='side', mat='trim', offset=0.004, thickness=0.004, density=0.14, name='window-surround')
    kit.project(cab, [(d1 + 0.13, 2.15), (d0 - 0.13, 2.15), (d0 - 0.13, 2.77), (d0 - 0.24, 2.91), (d1 + 0.13, 2.91)], plane='side', mat='glass', offset=0.008, thickness=0.004, density=0.12, name='door-glass')
    kit.strip(cab, [(d1 + 0.12, 1.98), (d1 + 0.34, 1.98)], 0.035, plane='side', mat='trim', offset=0.004, mirror=True, name='handle')

    # --- the frame and what's on it ---
    for s in (1, -1):
        kit.box((0.1, back + hl - 0.12, 0.28), at=(s * 0.47, (back - hl + 0.12) / 2, 1.0), mat='chassis', bevel=0.01, segments=1, name='rail')
    for y in (drive1['at'] + 0.55, (drive1['at'] + drive2['at']) / 2, drive2['at'] - 0.5):
        kit.box((0.86, 0.1, 0.18), at=(0, y, 0.98), mat='chassis', name='cross')
    # behind the cab: the power electronics box, the air tanks, the trailer lines on their stand
    kit.box((1.6, 0.42, 0.72), at=(0, back - 0.3, 1.5), mat='paint_alt', bevel=0.04, segments=2, name='inverter')
    for x in (-0.25, 0.25):
        kit.cylinder(0.13, 0.75, at=(x, back - 0.2, 0.72), axis='Y', mat='steel', verts=14, bevel=0.03, segments=1, name='air-tank')
    kit.box((0.06, 0.06, 0.95), at=(0, back - 0.6, 1.62), mat='steel', name='line-stand')
    for x, m in ((-0.07, 'plastic_red'), (0.07, 'trim')):
        L = 1.05
        a = math.atan2(0.75, L)
        kit.box((0.025, L * 1.15, 0.025), at=(x, back - 0.6 - L / 2, 1.62), rot=(a, 0, 0), mat=m, name='air-line')
    kit.box((1.0, 1.3, 0.03), at=(0, back - 1.25, 1.16), mat='steel', name='deck')
    mid = (drive1['at'] + drive2['at']) / 2
    kit.cylinder(0.46, 0.09, at=(0, mid + 0.25, 1.24), mat='steel', verts=24, bevel=0.012, segments=1, name='fifth')
    kit.box((0.18, 0.5, 0.05), at=(0, mid - 0.05, 1.27), mat='chassis', name='jaw')
    for s in (1, -1):
        kit.box((0.12, 0.55, 0.06), at=(s * 0.36, mid - 0.3, 1.2), rot=(0.25, 0, 0), mat='steel', name='ramp')
    # the frame's end: a crossmember with the rear lamps
    kit.box((2.0, 0.1, 0.16), at=(0, -hl + 0.13, 0.86), mat='chassis', bevel=0.01, segments=1, name='end')
    for s in (1, -1):
        kit.box((0.2, 0.03, 0.1), at=(s * 0.78, -hl + 0.075, 0.86), mat='lens', bevel=0.008, segments=1, name='tail-housing')
        kit.box((0.09, 0.012, 0.07), at=(s * 0.72, -hl + 0.058, 0.86), mat='lamp_red', name='tail')
        kit.box((0.05, 0.012, 0.07), at=(s * 0.84, -hl + 0.058, 0.86), mat='lamp_amber', name='tail-turn')
    # axle housings and the wheels (hub-piloted discs; duals on the drive axles)
    for a in spec['axles']:
        kit.cylinder(0.11, a['track'] - 0.2, at=(0, a['at'], a['r']), axis='X', mat='chassis', verts=12, name='axle')
        kit.axle_wheels(a, style='steel', rim='rim_silver', segments=20)
