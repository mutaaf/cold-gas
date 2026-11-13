# The Free Drive car's materials: one record per name, written into car.json exactly as the stage.json materials are
# (linear colours; unlit ones carry HDR colours that bloom). Plain python (no bpy) so check.py can import it too.

BASE = {
    "effect": None, "alphaMap": None, "kind": "MeshPhysicalMaterial", "emissive": [0, 0, 0], "emissiveIntensity": 1,
    "unlit": False, "metalness": 0.0, "roughness": 0.5, "clearcoat": 0.0, "clearcoatRoughness": 0.0, "opacity": 1,
    "transparent": False, "depthWrite": True, "doubleSided": False, "additive": False, "polygonOffset": None,
    "vertexColors": False, "fog": True, "wet": False, "map": None, "roughnessMap": None, "bumpMap": None,
    "bumpScale": 1, "emissiveMap": None,
}

# name: (color, metal, rough, clearcoat, clearcoatRough, opacity, unlit, doubleSided, renderOrder)
TABLE = {
    # body
    'drive-paint':       ([0.77, 0.78, 0.76], 0.08, 0.30, 1.0, 0.04, 1, False, False, 0),
    'drive-paint-dark':  ([0.028, 0.030, 0.034], 0.35, 0.32, 1.0, 0.04, 1, False, False, 0),
    'drive-gloss-black': ([0.004, 0.0045, 0.005], 0.0, 0.08, 1.0, 0.02, 1, False, False, 0),
    'drive-trim':        ([0.010, 0.011, 0.012], 0.0, 0.60, 0.0, 0.0, 1, False, False, 0),
    'drive-satin':       ([0.40, 0.41, 0.42], 0.6, 0.45, 0.0, 0.0, 1, False, False, 0),
    'drive-chrome':      ([0.90, 0.91, 0.92], 1.0, 0.12, 0.0, 0.0, 1, False, False, 0),
    'drive-rubber-seal': ([0.008, 0.008, 0.009], 0.0, 0.80, 0.0, 0.0, 1, False, False, 0),
    'drive-carbon':      ([0.010, 0.011, 0.013], 0.30, 0.38, 1.0, 0.08, 1, False, False, 0),
    'drive-under':       ([0.0035, 0.0038, 0.0042], 0.0, 0.90, 0.0, 0.0, 1, False, False, 0),
    'drive-mirror':      ([0.85, 0.87, 0.90], 1.0, 0.02, 0.0, 0.0, 1, False, False, 0),
    'drive-reflector':   ([0.80, 0.81, 0.83], 1.0, 0.15, 0.0, 0.0, 1, False, False, 0),
    'drive-plate':       ([0.55, 0.56, 0.56], 0.0, 0.45, 0.3, 0.2, 1, False, False, 0),
    'drive-brass':       ([0.533, 0.323, 0.122], 1.0, 0.28, 0.0, 0.0, 1, False, False, 0),
    # cabin
    'drive-interior':    ([0.010, 0.0105, 0.012], 0.0, 0.80, 0.0, 0.0, 1, False, False, 0),
    'drive-seat':        ([0.024, 0.022, 0.021], 0.0, 0.62, 0.0, 0.0, 1, False, False, 0),
    # lamps (unlit, HDR); the renderer drives the drive-amber/-marker/-plateLamp/-ambient brightness by name
    'drive-drl':         ([3.0, 3.0, 3.2], 0, 1, 0, 0, 1, True, False, 0),
    'drive-tail':        ([2.4, 0.05, 0.06], 0, 1, 0, 0, 1, True, False, 0),
    'drive-amber':       ([2.2, 1.21, 0.264], 0, 1, 0, 0, 1, True, False, 0),
    'drive-marker':      ([2.4, 0.192, 0.24], 0, 1, 0, 0, 1, True, False, 0),
    'drive-plateLamp':   ([1.6, 1.6, 1.6], 0, 1, 0, 0, 1, True, False, 0),
    'drive-ambient':     ([2.2, 0.264, 0.22], 0, 1, 0, 0, 1, True, False, 0),
    'drive-nozzleIn':    ([0.0015, 0.0015, 0.0015], 0, 1, 0, 0, 1, True, False, 0),
    # transparent last
    'drive-lens':        ([0.020, 0.021, 0.024], 0.0, 0.03, 1.0, 0.02, 0.25, False, False, 2),
    'drive-glass':       ([0.030, 0.034, 0.040], 0.2, 0.03, 1.0, 0.02, 0.62, False, False, 1),
    # wheels
    'drive-tyre':        ([0.012, 0.012, 0.013], 0.0, 0.85, 0.0, 0.0, 1, False, False, 0),
    'drive-rim':         ([0.30, 0.31, 0.32], 1.0, 0.30, 0.6, 0.1, 1, False, False, 0),
    'drive-rim-barrel':  ([0.12, 0.125, 0.13], 1.0, 0.45, 0.0, 0.0, 1, False, False, 0),
    'drive-lug':         ([0.90, 0.91, 0.92], 1.0, 0.12, 0.0, 0.0, 1, False, False, 0),
    'drive-caliper':     ([0.60, 0.02, 0.02], 0.2, 0.35, 1.0, 0.05, 1, False, False, 0),
    'roadster-rotor':    ([0.20, 0.205, 0.21], 1.0, 0.42, 0.0, 0.0, 1, False, False, 0),
    'drive-hub':         ([0.05, 0.052, 0.055], 0.8, 0.5, 0.0, 0.0, 1, False, False, 0),
}

# materials that carry the baked AO in the colour channel
NO_AO = {'drive-drl', 'drive-tail', 'drive-amber', 'drive-marker', 'drive-plateLamp', 'drive-ambient',
         'drive-nozzleIn', 'drive-glass', 'drive-lens', 'drive-mirror'}

# generic words a material name must not carry (check.py adds the marque list from tools/forge/lib/gate.mjs)
GENERIC_BANNED = ['logo', 'badge', 'emblem', 'brand', 'lettering', 'marque', 'trademark']


def record(name, vertex_colors):
    c, met, rough, cc, ccr, op, unlit, ds, order = TABLE[name]
    m = dict(BASE)
    m.update({"name": name, "color": list(c), "metalness": met, "roughness": rough, "clearcoat": cc,
              "clearcoatRoughness": ccr, "opacity": op, "transparent": op < 1, "unlit": unlit, "doubleSided": ds,
              "vertexColors": bool(vertex_colors)})
    if unlit:
        m["kind"] = "MeshBasicMaterial"
    return m, order


def order_key(name):
    c, met, rough, cc, ccr, op, unlit, ds, order = TABLE[name]
    return (order, list(TABLE).index(name))
