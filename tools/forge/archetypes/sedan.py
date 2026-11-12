# The Lineup's sedan slot (LINEUP_SPEC 'sedan'): a low fastback saloon of our own design at the researched size.
# A glass roof, slim lamp lines, a crisp belt, five-spoke or aero-covered wheels (seeded). No badges, no names.
from _car import car


def build(kit, spec, rng):
    hl, hw, H, zc = spec['l'] / 2, spec['w'] / 2, spec['h'], spec['clearance']
    peak = -0.15 + rng.uniform(-0.08, 0.08)       # where the roof peaks
    deck = 0.96 + rng.uniform(-0.012, 0.012)     # the tail's deck height
    S = lambda **k: k
    stations = [
        (hl,        S(zb=0.40, zs=0.47, zt=0.50, w=hw * 0.40, wb=hw * 0.34, wt=hw * 0.34, n=2.0)),
        (hl - 0.02, S(zb=0.31, zs=0.52, zt=0.56, w=hw * 0.64, wb=hw * 0.57, wt=hw * 0.56, n=2.2, crown=0.005)),
        (hl - 0.08, S(zb=0.22, zs=0.57, zt=0.62, w=hw * 0.81, wb=hw * 0.74, wt=hw * 0.72, n=2.4, crown=0.01)),
        (hl - 0.22, S(zb=0.17, zs=0.615, zt=0.685, w=hw * 0.925, wb=hw * 0.86, wt=hw * 0.82, n=2.6, crown=0.015)),
        (hl - 0.5, S(zb=zc, zs=0.655, zt=0.745, w=hw * 0.99, wb=hw * 0.92, wt=hw * 0.86, n=2.7, crown=0.02)),
        (0.92,      S(zb=zc, zs=0.755, zt=0.855, w=hw, wb=hw * 0.93, wt=hw * 0.84, n=3.0, crown=0.02, sh=0.0)),
        (0.30,      S(zb=zc, zs=0.795, zt=H - 0.075, w=hw, wb=hw * 0.93, wt=hw * 0.62, n=3.3, crown=0.025, sh=0.05)),
        (peak,      S(zb=zc, zs=0.81, zt=H - 0.04, w=hw, wb=hw * 0.93, wt=hw * 0.6, n=3.4, crown=0.03, sh=0.06)),
        (-0.85,     S(zb=zc, zs=0.825, zt=H - 0.105, w=hw * 0.995, wb=hw * 0.925, wt=hw * 0.61, n=3.3, crown=0.03, sh=0.06)),
        (-1.45,     S(zb=zc, zs=0.845, zt=1.13, w=hw * 0.985, wb=hw * 0.915, wt=hw * 0.68, n=3.0, crown=0.025, sh=0.045)),
        (-1.95,     S(zb=zc + 0.02, zs=0.855, zt=deck + 0.012, w=hw * 0.965, wb=hw * 0.89, wt=hw * 0.82, n=2.7, crown=0.015, sh=0.01)),
        (-hl + 0.25, S(zb=0.24, zs=0.855, zt=deck, w=hw * 0.94, wb=hw * 0.85, wt=hw * 0.83, n=2.5, crown=0.01, sh=0.0)),
        (-hl + 0.10, S(zb=0.30, zs=0.84, zt=deck - 0.012, w=hw * 0.9, wb=hw * 0.8, wt=hw * 0.79, n=2.4, crown=0.006)),
        (-hl + 0.03, S(zb=0.36, zs=0.815, zt=deck - 0.03, w=hw * 0.83, wb=hw * 0.74, wt=hw * 0.72, n=2.2, crown=0.003)),
        (-hl,       S(zb=0.42, zs=0.78, zt=deck - 0.06, w=hw * 0.7, wb=hw * 0.62, wt=hw * 0.6, n=2.0)),
    ]
    style = 'cover' if kit.seed % 3 == 2 else 'spokes'
    car(kit, spec, rng, {
        'stations': stations, 'ring': 8,
        'glass': {'a_base': 0.88, 'a_top': 0.26, 'c_top': -0.95, 'c_base': -1.72, 'b': -0.28, 'b_w': 0.1,
                  'roof': 'glass', 'belt': 0.025, 'top': 0.07, 'bl_lo': deck + 0.07},
        'lamps': [
            {'plane': 'front', 'lens': [(0.30, 0.545), (0.74, 0.565), (0.78, 0.61), (0.32, 0.592)],
             'line': [(0.34, 0.572), (0.64, 0.586), (0.75, 0.602)], 'width': 0.02, 'mat': 'lamp_white'},
            {'plane': 'rear', 'lens': [(0.40, deck - 0.115), (0.84, deck - 0.135), (0.84, deck - 0.07), (0.42, deck - 0.06)],
             'line': [(0.44, deck - 0.09), (0.82, deck - 0.104)], 'width': 0.024, 'mat': 'lamp_red'},
        ],
        'bars': [
            {'plane': 'front', 'outline': [(-0.5, 0.30), (0.5, 0.30), (0.45, 0.39), (-0.45, 0.39)], 'mat': 'trim'},
            {'plane': 'rear', 'outline': [(-0.56, 0.46), (-0.5, 0.40), (0.5, 0.40), (0.56, 0.46)], 'mat': 'trim'},
        ],
        'mirror': {'y': 0.74, 'z': 0.93, 'in': 0.0},
        'handles': [0.45, -0.62],
        'wheels': {'style': style, 'spokes': 5, 'rim': 'rim_silver'},
    })
