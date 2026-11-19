# The Lineup's cab slot (LINEUP_SPEC 'cab'): a two-seat driverless city cab of our own design at the researched size.
# A teardrop body under one wrapped glass canopy, no mirrors (cameras on the fenders), no rear window; round-cornered
# lamp pods at the four corners (a running-light arc over each headlamp), a roof sensor dome on a low plinth, a satin
# band at the sills, door shut lines and flush handles, bigger rear wheels under aero covers. No badges, no names.
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
        'lamps': [
            {'plane': 'front', 'lens': [(0.40, 0.55), (0.66, 0.53), (0.70, 0.6), (0.62, 0.65), (0.42, 0.635)],
             'line': [(0.43, 0.63), (0.6, 0.632), (0.67, 0.6)], 'width': 0.016, 'mat': 'lamp_white'},
            {'plane': 'rear', 'lens': [(0.38, 0.82), (0.66, 0.8), (0.70, 0.86), (0.64, 0.9), (0.40, 0.9)],
             'line': [(0.42, 0.865), (0.62, 0.86), (0.68, 0.835)], 'width': 0.022, 'mat': 'lamp_red'},
        ],
        'bars': [
            {'plane': 'front', 'outline': [(-0.45, 0.30), (0.45, 0.30), (0.4, 0.38), (-0.4, 0.38)], 'mat': 'trim'},
            {'plane': 'rear', 'outline': [(-0.55, 0.36), (0.55, 0.36), (0.5, 0.44), (-0.5, 0.44)], 'mat': 'trim'},
        ],
        'mirror': None,
        'handles': [0.35],
        'doors': [0.93, -0.82], 'hood': (hl - 0.28, 1.02, 0.82),
        'cladding': 0.3,
        'wheels': {'style': 'cover', 'spokes': 6, 'rim': 'rim_dark'},
    })
    # the side cameras: small pods on the front fenders
    for s in (1, -1):
        kit.box((0.05, 0.09, 0.05), at=(s * (hw - 0.02), 0.9, 0.8), mat='gloss', bevel=0.018, segments=2, name='camera')
    # the roof sensor dome on its plinth, over the canopy's crown
    kit.cylinder(0.2, 0.02, at=(0, -0.15, H - 0.008), mat='trim', verts=20, bevel=0.008, segments=1, name='plinth')
    kit.lathe([(0, 0.0), (0.12, 0.0), (0.12, 0.012), (0.09, 0.022), (0, 0.026)], at=(0, -0.15, H - 0.006), mat='gloss', segments=20, name='dome')
