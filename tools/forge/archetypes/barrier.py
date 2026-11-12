# Free Drive's / the Sandbox's plastic road barrier (src/sim/props.js BARRIER): a water-fillable safety-shape section as
# its body is, with fork pockets through its foot, two lifting handles, a fill cap, interlocking lugs at its ends and a
# retroreflective strip along each face. Built along y (the loader lays it along x, as the sim does). No markings.
def build(kit, spec, rng):
    L, D, Hh, top = spec['l'], spec['w'], spec['h'], spec['top']
    # the section (x across, z up), extruded along y
    sec = [(-D / 2, 0.0), (D / 2, 0.0), (D / 2, 0.07), (D / 2 - 0.05, 0.25), (top / 2 + 0.02, Hh - 0.04), (top / 2 - 0.01, Hh),
           (-top / 2 + 0.01, Hh), (-top / 2 - 0.02, Hh - 0.04), (-D / 2 + 0.05, 0.25), (-D / 2, 0.07)]
    body = kit.extrude(sec, L - 0.08, plane='XZ', mat='plastic_white', bevel=0.018, segments=2, name='body')
    # fork pockets through the foot and two lifting handles near the top, both straight through
    for y in (-0.45, 0.45):
        cut = kit.box((D + 0.2, 0.26, 0.09), at=(0, y, 0.035), mat='plastic_white', bevel=0.01, segments=1, name='pocket')
        kit.boolean(body, cut, 'DIFFERENCE')
        kit.remove(cut)
    for y in (-0.28, 0.28):
        cut = kit.box((D + 0.2, 0.2, 0.07), at=(0, y, Hh - 0.13), mat='plastic_white', bevel=0.015, segments=1, name='handle')
        kit.boolean(body, cut, 'DIFFERENCE')
        kit.remove(cut)
    # the fill cap
    kit.cylinder(0.045, 0.02, at=(0, 0.62, Hh - 0.002), mat='plastic_red', verts=16, bevel=0.006, segments=1, name='cap')
    # interlocking lugs: one set high on one end, low on the other
    kit.cylinder(0.05, 0.16, at=(0, L / 2 - 0.05, Hh - 0.25), mat='plastic_white', verts=16, bevel=0.01, segments=1, name='lug')
    kit.cylinder(0.05, 0.16, at=(0, -L / 2 + 0.05, 0.3), mat='plastic_white', verts=16, bevel=0.01, segments=1, name='lug')
    # a red band and a retroreflective strip on each face
    kit.strip(body, [(-L / 2 + 0.12, 0.5), (L / 2 - 0.12, 0.5)], 0.1, plane='side', mat='plastic_red', offset=0.003, thickness=0.004, mirror=True, name='band')
    kit.strip(body, [(-L / 2 + 0.2, 0.5), (L / 2 - 0.2, 0.5)], 0.035, plane='side', mat='reflective', offset=0.006, thickness=0.003, mirror=True, name='strip')
