# Free Drive's broadleaf tree (0226): a trunk that forks into two limbs under a crown of overlapping leaf masses, a big
# one on top and a ring of smaller ones round it, each squashed a little, so the crown reads as clumps, not a ball.
import math


def build(kit, spec, rng):
    H, R = spec['h'], spec['l'] / 2
    crown_r = 2.6
    cz = H - crown_r * 0.86
    kit.cylinder(0.3, cz * 0.62, at=(0, 0, cz * 0.31), mat='bark', verts=8, r_top=0.2, name='trunk')
    kit.cylinder(0.42, 0.45, at=(0, 0, 0.22), mat='bark', verts=8, r_top=0.3, name='flare')
    for s in (-1, 1):
        a = s * 0.42 + rng.uniform(-0.08, 0.08)
        L = cz * 0.5
        limb = kit.cylinder(0.15, L, mat='bark', verts=7, r_top=0.08, name='limb')
        kit.place(limb, at=(math.sin(a) * L * 0.5, 0, cz * 0.62 + math.cos(a) * L * 0.5 - 0.1), rot=(0, a, 0))
    # the crown: the top mass, then a ring of six
    kit.sphere(crown_r, at=(0, 0, cz), mat='leaves', segments=10, scale=(1, 1, 0.86), name='crown')
    n = 6
    for k in range(n):
        a = k / n * math.tau
        d = R - 1.55
        r = 1.55
        kit.sphere(r, at=(math.cos(a) * d, math.sin(a) * d, cz - 0.9 + rng.uniform(-0.4, 0.6)), mat='leaves_dark' if k % 2 else 'leaves',
                   segments=6, scale=(1, 1, 0.8), name='clump')
