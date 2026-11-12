# The Lineup's pickup slot (LINEUP_SPEC 'pickup'): a full-size electric crew-cab pickup of our own design at the
# researched size. Square-shouldered brushed-metal body, a covered bed, squared black arch flares, a lamp bar across
# the nose, tall tail lamps at the bed's corners. No badges, no names.
from _car import car


def build(kit, spec, rng):
    hl, hw, H, zc = spec['l'] / 2, spec['w'] / 2, spec['h'], spec['clearance']
    rail = 1.30 + rng.uniform(-0.02, 0.02)      # the bed rail's height
    S = lambda **k: k
    stations = [
        (hl,        S(zb=0.58, zs=1.02, zt=1.08, w=hw * 0.86, wb=hw * 0.8, wt=hw * 0.8, n=6)),
        (hl - 0.04, S(zb=0.46, zs=1.10, zt=1.17, w=hw * 0.96, wb=hw * 0.9, wt=hw * 0.9, n=6, crown=0.005)),
        (hl - 0.25, S(zb=0.36, zs=1.14, zt=1.22, w=hw, wb=hw * 0.95, wt=hw * 0.93, n=7, crown=0.01)),
        (1.25,      S(zb=zc, zs=1.19, zt=1.28, w=hw, wb=hw * 0.96, wt=hw * 0.93, n=7, crown=0.015)),
        (0.95,      S(zb=zc, zs=1.22, zt=1.33, w=hw, wb=hw * 0.96, wt=hw * 0.9, n=7, crown=0.015)),
        (0.35,      S(zb=zc, zs=1.25, zt=H - 0.04, w=hw, wb=hw * 0.96, wt=hw * 0.76, n=6, crown=0.02, sh=0.05)),
        (-0.45,     S(zb=zc, zs=1.26, zt=H - 0.02, w=hw, wb=hw * 0.96, wt=hw * 0.76, n=6, crown=0.02, sh=0.05)),
        (-0.62,     S(zb=zc, zs=1.27, zt=H - 0.06, w=hw, wb=hw * 0.96, wt=hw * 0.8, n=6, crown=0.015, sh=0.03)),
        (-0.82,     S(zb=zc, zs=1.27, zt=rail, w=hw, wb=hw * 0.96, wt=hw * 0.97, n=8, crown=0.0)),
        (-hl + 0.10, S(zb=0.40, zs=1.26, zt=rail, w=hw, wb=hw * 0.95, wt=hw * 0.97, n=8)),
        (-hl,       S(zb=0.55, zs=1.22, zt=rail - 0.03, w=hw * 0.96, wb=hw * 0.9, wt=hw * 0.93, n=7)),
    ]
    body = car(kit, spec, rng, {
        'stations': stations, 'ring': 7, 'cladding': 0.55, 'sharp': 26,
        'glass': {'a_base': 1.0, 'a_top': 0.40, 'c_top': -0.50, 'c_base': -0.62, 'b': -0.08, 'b_w': 0.11,
                  'backlight': False, 'belt': 0.03, 'top': 0.07},
        'lamps': [
            {'plane': 'rear', 'lens': [(0.86, 0.80), (0.99, 0.80), (0.99, 1.22), (0.86, 1.22)],
             'line': [(0.93, 0.84), (0.93, 1.18)], 'width': 0.05, 'mat': 'lamp_red'},
        ],
        'bars': [
            {'plane': 'front', 'outline': [(-0.92, 1.03), (0.92, 1.03), (0.92, 1.1), (-0.92, 1.1)], 'mat': 'lens', 'offset': 0.003},
            {'plane': 'front', 'line': [(-0.88, 1.065), (0.88, 1.065)], 'width': 0.026, 'mat': 'lamp_white'},
            {'plane': 'front', 'outline': [(-0.8, 0.62), (0.8, 0.62), (0.8, 0.86), (-0.8, 0.86)], 'mat': 'trim'},
            {'plane': 'rear', 'outline': [(-0.78, 0.86), (0.78, 0.86), (0.78, 1.2), (-0.78, 1.2)], 'mat': 'trim', 'offset': 0.003},
        ],
        'mirror': {'y': 0.92, 'z': 1.42, 'in': 0.0, 'size': (0.13, 0.2, 0.16), 'mat': 'trim'},
        'handles': [0.55, -0.3],
        'wheels': {'style': 'spokes', 'spokes': 6, 'rim': 'rim_dark'},
    })
    # the bed: cut down from the rails, closed by a flat cover
    bed = kit.box((spec['w'] - 0.14, 1.86, 0.9), at=(0, -0.86 - 0.93, rail + 0.4), mat='trim', name='bedcut')
    kit.boolean(body, bed, 'DIFFERENCE')
    kit.remove(bed)
    kit.box((spec['w'] - 0.15, 1.85, 0.03), at=(0, -0.86 - 0.93, rail - 0.04), mat='trim', bevel=0.008, segments=1, name='cover')
    # squared arch flares: a satin-black frame round each wheel well
    for a in spec['axles']:
        r = a['r'] + 0.035
        for s in (1, -1):
            out = [(a['at'] - r - 0.07, a['r'] - 0.12), (a['at'] - r - 0.07, a['r'] + r * 0.55), (a['at'] - r * 0.55, a['r'] + r + 0.07),
                   (a['at'] + r * 0.55, a['r'] + r + 0.07), (a['at'] + r + 0.07, a['r'] + r * 0.55), (a['at'] + r + 0.07, a['r'] - 0.12),
                   (a['at'] + r, a['r'] - 0.12), (a['at'] + r, a['r'] + r * 0.5), (a['at'] + r * 0.5, a['r'] + r),
                   (a['at'] - r * 0.5, a['r'] + r), (a['at'] - r, a['r'] + r * 0.5), (a['at'] - r, a['r'] - 0.12)]
            f = kit.extrude(out, 0.05, at=(s * (hw - 0.005), 0, 0), plane='YZ', mat='trim', bevel=0.01, segments=1, name='flare')
    # a step under each door
    for s in (1, -1):
        kit.box((0.12, 1.5, 0.04), at=(s * (hw - 0.05), 0.15, zc + 0.12), mat='trim', bevel=0.012, segments=1, name='step')
