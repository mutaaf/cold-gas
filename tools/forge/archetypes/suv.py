# The Lineup's crossover slot (LINEUP_SPEC 'suv'): a tall fastback crossover of our own design at the researched size.
# Satin-black cladding low on the body and round the wheels, a long glass roof, a lamp bar across the nose's top edge,
# a full-width tail bar, roof rails. No badges, no names.
from _car import car


def build(kit, spec, rng):
    hl, hw, H, zc = spec['l'] / 2, spec['w'] / 2, spec['h'], spec['clearance']
    tail = 1.30 + rng.uniform(-0.03, 0.03)       # where the liftback's roofline ends
    S = lambda **k: k
    stations = [
        (hl,        S(zb=0.42, zs=0.58, zt=0.62, w=hw * 0.42, wb=hw * 0.36, wt=hw * 0.36, n=2.0)),
        (hl - 0.025, S(zb=0.33, zs=0.64, zt=0.69, w=hw * 0.66, wb=hw * 0.6, wt=hw * 0.58, n=2.2, crown=0.005)),
        (hl - 0.09, S(zb=0.25, zs=0.70, zt=0.765, w=hw * 0.84, wb=hw * 0.78, wt=hw * 0.75, n=2.4, crown=0.01)),
        (hl - 0.24, S(zb=0.20, zs=0.75, zt=0.83, w=hw * 0.94, wb=hw * 0.88, wt=hw * 0.84, n=2.6, crown=0.015)),
        (hl - 0.52, S(zb=zc, zs=0.80, zt=0.89, w=hw * 0.995, wb=hw * 0.93, wt=hw * 0.87, n=2.8, crown=0.02)),
        (0.95,      S(zb=zc, zs=0.90, zt=1.01, w=hw, wb=hw * 0.94, wt=hw * 0.85, n=3.0, crown=0.02)),
        (0.30,      S(zb=zc, zs=0.96, zt=H - 0.07, w=hw, wb=hw * 0.94, wt=hw * 0.68, n=3.6, crown=0.02, sh=0.045)),
        (-0.30,     S(zb=zc, zs=0.975, zt=H - 0.025, w=hw, wb=hw * 0.94, wt=hw * 0.67, n=3.8, crown=0.02, sh=0.05)),
        (-1.20,     S(zb=zc, zs=0.99, zt=H - 0.075, w=hw * 0.995, wb=hw * 0.935, wt=hw * 0.68, n=3.6, crown=0.02, sh=0.05)),
        (-1.85,     S(zb=zc + 0.02, zs=1.0, zt=tail + 0.1, w=hw * 0.975, wb=hw * 0.91, wt=hw * 0.74, n=3.2, crown=0.015, sh=0.04)),
        (-hl + 0.18, S(zb=0.28, zs=0.99, zt=tail, w=hw * 0.94, wb=hw * 0.86, wt=hw * 0.78, n=2.8, crown=0.01, sh=0.02)),
        (-hl + 0.05, S(zb=0.35, zs=0.96, zt=tail - 0.04, w=hw * 0.86, wb=hw * 0.78, wt=hw * 0.72, n=2.4, crown=0.005)),
        (-hl,       S(zb=0.42, zs=0.92, zt=tail - 0.09, w=hw * 0.74, wb=hw * 0.66, wt=hw * 0.62, n=2.1)),
    ]
    car(kit, spec, rng, {
        'stations': stations, 'ring': 8, 'cladding': 0.40,
        'glass': {'a_base': 0.92, 'a_top': 0.27, 'c_top': -1.35, 'c_base': -1.95, 'b': -0.36, 'b_w': 0.11,
                  'roof': 'glass', 'belt': 0.025, 'top': 0.075, 'bl_lo': 1.06},
        'lamps': [
            {'plane': 'front', 'lens': [(0.52, 0.60), (0.86, 0.62), (0.86, 0.68), (0.54, 0.665)],
             'line': [(0.58, 0.64), (0.82, 0.652)], 'width': 0.026, 'mat': 'lamp_white'},
        ],
        'bars': [
            # the lamp bar along the nose's top edge, the tail bar across the liftback, a lower intake
            {'plane': 'front', 'line': [(-0.78, 0.735), (-0.4, 0.745), (0.4, 0.745), (0.78, 0.735)], 'width': 0.022, 'mat': 'lamp_white'},
            {'plane': 'front', 'outline': [(-0.62, 0.30), (0.62, 0.30), (0.55, 0.42), (-0.55, 0.42)], 'mat': 'trim'},
            {'plane': 'rear', 'line': [(-0.8, 1.02), (0.8, 1.02)], 'width': 0.03, 'mat': 'lamp_red'},
            {'plane': 'rear', 'outline': [(-0.84, 0.985), (0.84, 0.985), (0.84, 1.055), (-0.84, 1.055)], 'mat': 'lens', 'offset': 0.003},
        ],
        'mirror': {'y': 0.80, 'z': 1.07, 'in': 0.0, 'size': (0.11, 0.18, 0.11)},
        'handles': [0.42, -0.72],
        'wheels': {'style': 'spokes' if kit.seed % 3 != 2 else 'mesh', 'spokes': 6, 'rim': 'rim_silver'},
    })
    # roof rails: two slim satin bars on low feet
    for s in (1, -1):
        kit.box((0.035, 1.55, 0.03), at=(s * hw * 0.6, -0.45, H - 0.005), mat='trim', bevel=0.012, segments=1, name='rail')
        for y in (0.25, -1.15):
            kit.box((0.04, 0.08, 0.05), at=(s * hw * 0.6, y, H - 0.03), mat='trim', bevel=0.01, segments=1, name='railfoot')
