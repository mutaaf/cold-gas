# Free Drive's bend marker (0226): a galvanised post carrying a white board with a red border and one large chevron, the
# warning a bend gives. A shape only: no lettering, no symbol of any agency.
def build(kit, spec, rng):
    L, W, H = spec['l'], spec['w'], spec['h']
    kit.cylinder(0.04, H, at=(0, 0, H / 2), mat='galvanised', verts=10, name='post')
    bw, bh, z = L, 0.62, H - 0.62 / 2
    kit.box((0.03, bw, bh), at=(W / 2 - 0.02, 0, z), mat='plastic_white', name='board')
    # the red border, a frame of four bars just proud of the board
    t = 0.07
    for zz in (z - bh / 2 + t / 2, z + bh / 2 - t / 2):
        kit.box((0.012, bw, t), at=(W / 2 + 0.002, 0, zz), mat='plastic_red', name='border')
    for yy in (-bw / 2 + t / 2, bw / 2 - t / 2):
        kit.box((0.012, t, bh - 2 * t), at=(W / 2 + 0.002, yy, z), mat='plastic_red', name='border')
    # one chevron, pointing along +y, retroreflective
    c = [(-0.18, -0.2), (0.02, -0.2), (0.2, 0.0), (0.02, 0.2), (-0.18, 0.2), (0.0, 0.0)]
    kit.extrude([(y, zz + z) for y, zz in c], 0.012, at=(W / 2 + 0.002, 0, 0), plane='YZ', mat='reflective', name='chevron')
