# Free Drive's roadside fence (0226): one 4 m bay of a post-and-rail field fence, sawn timber, two rails let into two
# posts (the next bay shares nothing: each bay is its own body when the car knocks it, 0227).
def build(kit, spec, rng):
    L, W, H = spec['l'], spec['w'], spec['h']
    for y in (-L / 2 + W / 2, L / 2 - W / 2):
        kit.box((W, W, H), at=(0, y, H / 2), mat='timber', rot=(0, 0, rng.uniform(-0.04, 0.04)), name='post')
    for z in (0.45, 0.9):
        kit.box((W * 0.45, L - 0.02, 0.11), at=(W * 0.2, 0, z), mat='timber', rot=(rng.uniform(-0.01, 0.01), 0, 0), name='rail')
