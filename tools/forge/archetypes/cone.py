# Free Drive's / the Sandbox's traffic cone (src/sim/props.js CONE): the 28-inch highway class as its body is, a square
# rubber base with rounded corners and a moulded orange cone wearing two retroreflective collars. No markings.
def build(kit, spec, rng):
    b, c = spec['base'], spec['cone']
    # the base: a rubber slab, its corners rounded, a raised ring where the cone seats
    kit.box((b['hx'] * 2, b['hz'] * 2, b['hy'] * 2), at=(0, 0, b['hy']), mat='rubber', bevel=0.012, segments=2, name='base')
    kit.lathe([(c['r0'] + 0.018, b['hy'] * 2 - 0.002), (c['r0'] + 0.018, c['y0'] + 0.008), (c['r0'] + 0.004, c['y0'] + 0.012), (0, c['y0'] + 0.012)],
              mat='rubber', segments=28, name='seat')
    # the cone: a slightly flared foot, straight flanks, a rounded tip
    H = c['y1'] - c['y0']
    r_at = lambda z: c['r0'] + (c['r1'] - c['r0']) * (z - c['y0']) / H
    prof = [(0, c['y0']), (c['r0'] + 0.008, c['y0']), (c['r0'] + 0.006, c['y0'] + 0.012)]
    for k in range(1, 6):
        z = c['y0'] + 0.012 + (c['y1'] - 0.02 - c['y0'] - 0.012) * k / 5
        prof.append((r_at(z), z))
    prof += [(c['r1'] * 0.8, c['y1'] - 0.006), (c['r1'] * 0.45, c['y1']), (0, c['y1'])]
    kit.lathe(prof, mat='orange', segments=28, name='cone')
    # two collars, proud of the cone by 2 mm
    for z0, z1 in ((0.36, 0.44), (0.50, 0.555)):
        kit.lathe([(r_at(z0) + 0.0005, z0), (r_at(z0) + 0.0025, z0 + 0.003), (r_at(z1) + 0.0025, z1 - 0.003), (r_at(z1) + 0.0005, z1)],
                  mat='reflective', segments=28, loop=True, name='collar')
