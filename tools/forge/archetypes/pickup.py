# The Lineup's pickup slot (LINEUP_SPEC 'pickup'): a full-size electric crew-cab pickup of our own design at the
# researched size, drawn the conventional way: a long flat hood standing proud of the fenders' shoulder, a tall grille
# panel (blanked, with bars) between two separate headlamps, a bumper below, a crew cab with a B-pillar and four doors,
# and a separate open bed behind it with its rails, wheel-well humps, a tailgate with its seam and handle, tall lamps at
# the bed's corners and a bumper. Round wheel lips, a little satin cladding at the sills. No badges, no names.
import math

from _car import car


def build(kit, spec, rng):
    hl, hw, H, zc = spec['l'] / 2, spec['w'] / 2, spec['h'], spec['clearance']
    rail = 1.30 + rng.uniform(-0.02, 0.02)      # the bed rail's height
    cab_back = -0.66                            # the cab's back wall; the bed starts behind a small gap
    S = lambda **k: k
    stations = [
        (hl,        S(zb=0.50, zs=1.00, zt=1.10, w=hw * 0.9, wb=hw * 0.86, wt=hw * 0.84, n=5)),
        (hl - 0.05, S(zb=0.40, zs=1.08, zt=1.19, w=hw * 0.97, wb=hw * 0.92, wt=hw * 0.9, n=5.5, crown=0.01)),
        (hl - 0.25, S(zb=0.34, zs=1.12, zt=1.24, w=hw, wb=hw * 0.95, wt=hw * 0.9, n=6, crown=0.02)),
        (1.30,      S(zb=zc, zs=1.16, zt=1.29, w=hw, wb=hw * 0.96, wt=hw * 0.9, n=6, crown=0.025)),
        (1.02,      S(zb=zc, zs=1.19, zt=1.33, w=hw, wb=hw * 0.96, wt=hw * 0.88, n=6, crown=0.025)),
        (0.40,      S(zb=zc, zs=1.24, zt=H - 0.05, w=hw, wb=hw * 0.96, wt=hw * 0.76, n=5, crown=0.03, sh=0.05)),
        (-0.42,     S(zb=zc, zs=1.26, zt=H - 0.025, w=hw, wb=hw * 0.96, wt=hw * 0.77, n=5, crown=0.03, sh=0.05)),
        (cab_back + 0.05, S(zb=zc, zs=1.27, zt=H - 0.07, w=hw, wb=hw * 0.96, wt=hw * 0.8, n=5, crown=0.02, sh=0.04)),
        (cab_back - 0.04, S(zb=zc, zs=1.27, zt=rail, w=hw, wb=hw * 0.96, wt=hw * 0.97, n=8, crown=0.0)),
        (-hl + 0.10, S(zb=0.40, zs=1.26, zt=rail, w=hw, wb=hw * 0.96, wt=hw * 0.97, n=8)),
        (-hl,       S(zb=0.52, zs=1.24, zt=rail - 0.02, w=hw * 0.97, wb=hw * 0.93, wt=hw * 0.95, n=8)),
    ]
    body = car(kit, spec, rng, {
        'stations': stations, 'ring': 7, 'cladding': 0.42, 'sharp': 28,
        'glass': {'a_base': 1.0, 'a_top': 0.40, 'c_top': -0.52, 'c_base': -0.6, 'b': -0.08, 'b_w': 0.12,
                  'backlight': False, 'belt': 0.03, 'top': 0.07},
        'lamps': [
            # headlamps: a housing either side of the grille, a running-light line along its top, a lamp under it
            {'plane': 'front', 'lens': [(0.66, 0.92), (0.95, 0.92), (0.95, 1.1), (0.66, 1.09)],
             'line': [(0.68, 1.065), (0.93, 1.07)], 'width': 0.02, 'mat': 'lamp_white'},
            {'plane': 'front', 'line': [(0.72, 0.97), (0.84, 0.97)], 'width': 0.05, 'mat': 'lamp_white'},
            # tall tail lamps at the bed's corners: a red stack with a white reverse lamp in it
            {'plane': 'rear', 'lens': [(0.86, 0.84), (0.98, 0.84), (0.98, 1.24), (0.86, 1.24)],
             'line': [(0.92, 1.0), (0.92, 1.2)], 'width': 0.06, 'mat': 'lamp_red'},
            {'plane': 'rear', 'line': [(0.92, 0.88), (0.92, 0.94)], 'width': 0.05, 'mat': 'lamp_white'},
        ],
        'bars': [
            # the grille panel between the lamps, and the front bumper below it
            {'plane': 'front', 'outline': [(-0.62, 0.80), (0.62, 0.80), (0.62, 1.1), (-0.62, 1.1)], 'mat': 'gloss', 'offset': 0.004},
        ],
        'mirror': {'y': 0.94, 'z': 1.44, 'in': 0.0, 'size': (0.13, 0.22, 0.2), 'mat': 'trim'},
        'handles': [0.55, -0.3],
        'doors': [0.97, -0.02, -0.14, -0.6], 'hood': (hl - 0.12, 1.04, 0.86),
        'wheels': {'style': 'spokes', 'spokes': 6, 'rim': 'rim_silver', 'segments': 22},
    })
    bw = spec['w'] - 0.14                       # the bed's inside width
    yb0, yb1 = cab_back - 0.06, -hl + 0.07      # the bed's front and back walls (inside)
    floor = 0.84
    # the bed: cut down from the rails to its floor
    bed = kit.box((bw, yb0 - yb1, 1.0), at=(0, (yb0 + yb1) / 2, floor + 0.5), mat='trim', name='bedcut')
    kit.boolean(body, bed, 'DIFFERENCE')
    kit.remove(bed)
    # in the bed: the wheel-well humps; rail caps along the top
    ra = spec['axles'][1]
    for s in (1, -1):
        kit.box((0.24, 0.9, 0.3), at=(s * (bw / 2 - 0.12), ra['at'], floor + 0.15), mat='trim', name='hump')
        kit.box((0.09, yb0 - yb1 + 0.1, 0.025), at=(s * (hw - 0.045), (yb0 + yb1) / 2, rail + 0.008), mat='trim', name='railcap')
    # the seam between the cab and the bed down each side
    kit.strip(body, [(cab_back - 0.02, rail - 0.01), (cab_back - 0.02, zc + 0.12)], 0.012, plane='side', mat='trim', offset=0.0022, mirror=True, name='bed-gap')
    # the tailgate: its seam round the rear face, a handle at its top, and the rear bumper under it
    kit.strip(body, [(-0.83, rail - 0.03), (-0.83, 0.62), (0.83, 0.62), (0.83, rail - 0.03)], 0.008, plane='rear', mat='trim', offset=0.0022, name='tailgate')
    kit.box((0.26, 0.03, 0.05), at=(0, -hl - 0.012, rail - 0.12), mat='trim', bevel=0.01, segments=1, name='gate-handle')
    kit.box((1.7, 0.16, 0.16), at=(0, -hl + 0.04, 0.5), mat='rim_silver', bevel=0.02, segments=1, name='rear-bumper')
    # round wheel lips in satin black, the front bumper with its intake, a running board under the doors
    for a in spec['axles']:
        r = a['r'] + 0.035
        for s in (1, -1):
            n = 8
            arc = [(a['at'] + (r + 0.06) * math.cos(math.pi * k / n), a['r'] + (r + 0.06) * math.sin(math.pi * k / n)) for k in range(n + 1)]
            arc += [(a['at'] + r * math.cos(math.pi * k / n), a['r'] + r * math.sin(math.pi * k / n)) for k in range(n, -1, -1)]
            kit.extrude(arc, 0.05, at=(s * (hw + 0.005), 0, 0), plane='YZ', mat='trim', name='lip')
    kit.box((1.98, 0.14, 0.3), at=(0, hl - 0.05, 0.6), mat='trim', bevel=0.03, segments=1, name='bumper')
    kit.box((1.3, 0.02, 0.07), at=(0, hl + 0.012, 0.6), mat='gloss', name='bumper-intake')
    for s in (1, -1):
        kit.box((0.14, 1.5, 0.045), at=(s * (hw - 0.07), 0.18, zc + 0.12), mat='trim', bevel=0.012, segments=1, name='step')
