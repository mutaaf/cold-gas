# Free Drive's shrub (0226): three or four low, overlapping leaf masses, the middle one tallest.
import math


def build(kit, spec, rng):
    R, H = spec['l'] / 2, spec['h']
    kit.sphere(0.62, at=(0, 0, H - 0.62 * 0.85), mat='leaves', segments=8, scale=(1, 1, 0.85), name='heart')
    n = 4
    for k in range(n):
        a = k / n * math.tau + 0.4
        r = rng.uniform(0.42, 0.5)
        d = R - r
        kit.sphere(r, at=(math.cos(a) * d, math.sin(a) * d, r * 0.8), mat='leaves_dark' if k % 2 else 'leaves', segments=6, scale=(1, 1, 0.8), name='mass')
