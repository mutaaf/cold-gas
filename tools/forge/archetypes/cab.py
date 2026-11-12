# The Lineup's cab slot (LINEUP_SPEC 'cab'): a two-seat city pod of our own design at the researched size. A teardrop
# body under one wrapped glass canopy, no mirrors (cameras), no rear window, a lamp bar at each end, bigger rear wheels
# under aero covers. No badges, no names.
from _car import car


def build(kit, spec, rng):
    hl, hw, H, zc = spec['l'] / 2, spec['w'] / 2, spec['h'], spec['clearance']
    S = lambda **k: k
    stations = [
        (hl,        S(zb=0.40, zs=0.52, zt=0.56, w=hw * 0.45, wb=hw * 0.4, wt=hw * 0.4, n=2.0)),
        (hl - 0.03, S(zb=0.30, zs=0.58, zt=0.635, w=hw * 0.7, wb=hw * 0.64, wt=hw * 0.62, n=2.2, crown=0.005)),
        (hl - 0.11, S(zb=0.22, zs=0.63, zt=0.71, w=hw * 0.87, wb=hw * 0.81, wt=hw * 0.78, n=2.4, crown=0.01)),
        (hl - 0.30, S(zb=0.17, zs=0.67, zt=0.79, w=hw * 0.96, wb=hw * 0.9, wt=hw * 0.84, n=2.6, crown=0.015)),
        (1.15,      S(zb=zc, zs=0.72, zt=0.86, w=hw, wb=hw * 0.93, wt=hw * 0.8, n=2.8, crown=0.02)),
        (0.55,      S(zb=zc, zs=0.76, zt=H - 0.12, w=hw, wb=hw * 0.93, wt=hw * 0.6, n=3.0, crown=0.03, sh=0.04)),
        (-0.15,     S(zb=zc, zs=0.78, zt=H - 0.035, w=hw, wb=hw * 0.93, wt=hw * 0.56, n=3.2, crown=0.035, sh=0.05)),
        (-0.95,     S(zb=zc, zs=0.80, zt=H - 0.16, w=hw * 0.99, wb=hw * 0.92, wt=hw * 0.6, n=3.0, crown=0.03, sh=0.04)),
        (-1.65,     S(zb=zc + 0.04, zs=0.82, zt=1.0, w=hw * 0.96, wb=hw * 0.88, wt=hw * 0.72, n=2.7, crown=0.02, sh=0.02)),
        (-hl + 0.12, S(zb=0.30, zs=0.82, zt=0.93, w=hw * 0.9, wb=hw * 0.82, wt=hw * 0.76, n=2.4, crown=0.01)),
        (-hl + 0.03, S(zb=0.37, zs=0.80, zt=0.9, w=hw * 0.8, wb=hw * 0.72, wt=hw * 0.68, n=2.2, crown=0.005)),
        (-hl,       S(zb=0.43, zs=0.77, zt=0.86, w=hw * 0.66, wb=hw * 0.58, wt=hw * 0.56, n=2.0)),
    ]
    car(kit, spec, rng, {
        'stations': stations, 'ring': 8,
        # one canopy: no B-pillar glass split, no backlight
        'glass': {'a_base': 0.95, 'a_top': 0.45, 'c_top': -0.95, 'c_base': -1.5, 'b': -2.5, 'b_w': 0.0, 'quarter': False,
                  'backlight': False, 'roof': 'glass', 'belt': 0.03, 'top': 0.06},
        'lamps': [],
        'bars': [
            {'plane': 'front', 'line': [(-0.62, 0.62), (-0.3, 0.635), (0.3, 0.635), (0.62, 0.62)], 'width': 0.024, 'mat': 'lamp_white'},
            {'plane': 'rear', 'outline': [(-0.66, 0.855), (0.66, 0.855), (0.66, 0.915), (-0.66, 0.915)], 'mat': 'lens', 'offset': 0.003},
            {'plane': 'rear', 'line': [(-0.62, 0.885), (0.62, 0.885)], 'width': 0.026, 'mat': 'lamp_red'},
            {'plane': 'front', 'outline': [(-0.45, 0.30), (0.45, 0.30), (0.4, 0.38), (-0.4, 0.38)], 'mat': 'trim'},
        ],
        'mirror': None,
        'handles': [],
        'wheels': {'style': 'cover', 'spokes': 6, 'rim': 'rim_dark'},
    })
    # the side cameras: small pods at the canopy's foot
    for s in (1, -1):
        kit.box((0.05, 0.09, 0.05), at=(s * (hw - 0.02), 0.9, 0.8), mat='gloss', bevel=0.018, segments=2, name='camera')
