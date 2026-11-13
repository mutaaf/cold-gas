# Free Drive's spruce (0226): a tapering trunk under whorls of drooping branch skirts that shorten toward a spire. Each
# skirt is a lathe with a drooped rim and a notched underside, so the silhouette is layered, not a cone; the seed varies
# their spacing, droop and turn. Smooth-shaded; the AO bake darkens the inside of each skirt.
def build(kit, spec, rng):
    H, R = spec['h'], spec['l'] / 2
    kit.cylinder(0.26, H * 0.62, at=(0, 0, H * 0.31), mat='bark', verts=8, r_top=0.07, name='trunk')
    # the root flare
    kit.cylinder(0.36, 0.5, at=(0, 0, 0.25), mat='bark', verts=8, r_top=0.26, name='flare')
    tiers = 6
    base = 1.5
    for k in range(tiers):
        t = k / (tiers - 1)
        y0 = base + (H - base - 2.2) * (t ** 0.92) + rng.uniform(-0.12, 0.12) * (1 - t)
        r = R if k == 0 else R * (1 - 0.88 * t) * rng.uniform(0.92, 1.0)
        rise = 1.5 + 1.6 * (1 - t)
        droop = 0.35 + 0.25 * (1 - t) + rng.uniform(0, 0.1)
        top = H if k == tiers - 1 else y0 + rise + 0.9
        prof = [(0, y0 + 0.25), (r, y0 - droop), (r * 0.62, y0 + rise * 0.3), (r * 0.22, y0 + rise * 0.8), (0, top)]
        mat = 'needles_tip' if k % 2 else 'needles'
        kit.lathe(prof, mat=mat, segments=10 if k < 2 else 8, name=f'tier{k}')
