# Free Drive's boulder (0226): a weathered granite lump: a low, long mass with a few broad planes (a coarse sphere,
# squashed and leaning), a second block shouldered against it, a lichened cap; sitting on the ground.
def build(kit, spec, rng):
    L, W, H = spec['l'], spec['w'], spec['h']
    a = H * 0.5
    m = kit.sphere(1.0, mat='stone', segments=8, scale=(W * 0.5, L * 0.38, a), name='mass')
    kit.place(m, at=(0, -L * 0.09, a))
    b = H * 0.36
    s = kit.box((W * 0.62, L * 0.4, b * 2), mat='stone_dark', name='shoulder')
    kit.bevel(s, 0.16, 2)
    kit.place(s, at=(0, L * 0.27, b))
    c = H * 0.2
    kit.sphere(1.0, at=(0, -L * 0.08, H - c), mat='lichen', segments=8, scale=(W * 0.3, L * 0.24, c), name='cap')
