# Free Drive's guard rail (0226): one 4 m section of galvanised W-beam on two sigma posts with spacer blocks. The beam's
# W is three folded strips; the posts stand behind it (−x is the road side).
def build(kit, spec, rng):
    L, W, H = spec['l'], spec['w'], spec['h']
    for y in (-L / 2 + 0.6, L / 2 - 0.6):
        kit.box((0.1, 0.06, H - 0.02), at=(W / 2 - 0.05, y, (H - 0.02) / 2), mat='galvanised', name='post')
        kit.box((0.12, 0.08, 0.2), at=(W / 2 - 0.16, y, H - 0.25), mat='galvanised', name='spacer')
    # the W: two bulges and the valley between, folded at small angles
    zc = H - 0.25
    kit.box((0.03, L, 0.12), at=(-W / 2 + 0.06, 0, zc + 0.1), mat='galvanised', rot=(0, 0.35, 0), name='beam_top')
    kit.box((0.03, L, 0.1), at=(-W / 2 + 0.1, 0, zc), mat='galvanised', name='beam_mid')
    kit.box((0.03, L, 0.12), at=(-W / 2 + 0.06, 0, zc - 0.1), mat='galvanised', rot=(0, -0.35, 0), name='beam_low')
    kit.box((0.03, L, 0.02), at=(-W / 2 + 0.015, 0, zc + 0.165), mat='galvanised', name='lip')
