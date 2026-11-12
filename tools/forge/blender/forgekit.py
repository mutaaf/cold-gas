# The forge's modelling kit (docs/backlog/0211): the ONLY API an archetype or a brief's script may use.
#
# Frame: metres, Blender's Z up, the vehicle's nose toward +Y, its right side toward +X, the ground at z = 0, centred on
# its physics box (x = 0, y = 0). finish.py turns it to the game's frame at export (nose +z in glTF, y up).
#
# Every call returns a Part (a Blender mesh object the kit owns). Every Part is a closed solid unless noted, so the
# whole stays manifold. Materials are palette names only (PALETTE below), never colours: the game remaps them to its
# own materials by name. There is no text, curve, font, image or import call here, on purpose (AGENTS.md 3.7).
import math
import bmesh
import bpy
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree

# --- The palette: names the game knows (src/render/forged.js remaps each to its own material) -----------------------
# base colour (linear), metallic, roughness, coat, emission strength
PALETTE = {
    'paint':      ((0.80, 0.80, 0.82), 0.5, 0.26, 1.0, 0.0),   # the slot's paint (set per asset: kit.paint_color)
    'paint_alt':  ((0.03, 0.03, 0.035), 0.3, 0.18, 1.0, 0.0),  # a contrast roof / two-tone
    'glass':      ((0.004, 0.006, 0.009), 0.3, 0.04, 1.0, 0.0),
    'trim':       ((0.0035, 0.004, 0.0045), 0.15, 0.55, 0.0, 0.0),   # satin black: surrounds, cladding, grilles
    'gloss':      ((0.0025, 0.0028, 0.0032), 0.3, 0.18, 1.0, 0.0),   # piano black
    'rubber':     ((0.006, 0.0065, 0.007), 0.0, 0.88, 0.0, 0.0),
    'rim_dark':   ((0.023, 0.025, 0.028), 0.8, 0.34, 0.6, 0.0),
    'rim_silver': ((0.39, 0.42, 0.45), 1.0, 0.26, 0.5, 0.0),
    'cover':      ((0.011, 0.012, 0.013), 0.35, 0.42, 0.8, 0.0),     # aero wheel cover
    'stainless':  ((0.46, 0.49, 0.52), 1.0, 0.5, 0.0, 0.0),
    'steel':      ((0.15, 0.16, 0.18), 0.9, 0.45, 0.0, 0.0),
    'chassis':    ((0.009, 0.0095, 0.011), 0.4, 0.6, 0.0, 0.0),
    'lamp_white': ((1.0, 1.0, 1.0), 0.0, 0.3, 0.0, 1.3),
    'lamp_red':   ((1.0, 0.04, 0.06), 0.0, 0.3, 0.0, 1.15),
    'lamp_red_dim': ((1.0, 0.04, 0.06), 0.0, 0.3, 0.0, 0.42),
    'lamp_amber': ((1.0, 0.42, 0.05), 0.0, 0.3, 0.0, 1.2),
    'lens':       ((0.02, 0.022, 0.026), 0.2, 0.08, 1.0, 0.0),       # a dark lamp housing
    'orange':     ((0.72, 0.075, 0.013), 0.0, 0.55, 0.0, 0.0),       # traffic orange (cone)
    'reflective': ((0.83, 0.85, 0.86), 0.2, 0.3, 0.0, 0.0),          # retroreflective collar
    'plastic_white': ((0.78, 0.79, 0.8), 0.0, 0.62, 0.0, 0.0),
    'plastic_red': ((0.6, 0.02, 0.025), 0.0, 0.6, 0.0, 0.0),
    'concrete':   ((0.3, 0.3, 0.29), 0.0, 0.9, 0.0, 0.0),
}

TAU = math.tau


class Part:
    """A mesh the kit made. `.obj` is the Blender object (kit-internal: scripts never touch bpy)."""
    def __init__(self, obj):
        self.obj = obj

    @property
    def name(self):
        return self.obj.name


class Kit:
    def __init__(self, spec, seed=0, paint=None):
        self.spec = spec
        self.seed = seed
        self.parts = []
        self.flags = []          # outlines that look like lettering or an emblem (finish.validate reports them)
        self.mats = {}
        self.paint_color = paint or PALETTE['paint'][0]
        self.coll = bpy.context.scene.collection

    # --- materials --------------------------------------------------------------------------------------------------
    def _mat(self, name):
        if name not in PALETTE:
            raise ValueError(f"unknown material '{name}': use one of {sorted(PALETTE)}")
        if name in self.mats:
            return self.mats[name]
        col, metal, rough, coat, emit = PALETTE[name]
        if name == 'paint':
            col = self.paint_color
        m = bpy.data.materials.new(name)
        m.use_nodes = True
        b = m.node_tree.nodes.get('Principled BSDF')
        b.inputs['Base Color'].default_value = (*col, 1)
        b.inputs['Metallic'].default_value = metal
        b.inputs['Roughness'].default_value = rough
        if coat > 0:
            b.inputs['Coat Weight'].default_value = coat
            b.inputs['Coat Roughness'].default_value = 0.05
        if emit > 0:
            b.inputs['Emission Color'].default_value = (*col, 1)
            b.inputs['Emission Strength'].default_value = emit
        m.diffuse_color = (*col, 1)
        self.mats[name] = m
        return m

    # --- bookkeeping ------------------------------------------------------------------------------------------------
    def _new(self, name, verts, faces, mat, smooth=True, mats=None):
        me = bpy.data.meshes.new(name)
        me.from_pydata([tuple(v) for v in verts], [], [tuple(f) for f in faces])
        me.validate(clean_customdata=False)
        me.update()
        obj = bpy.data.objects.new(name, me)
        self.coll.objects.link(obj)
        names = mats or [mat]
        for n in names:
            me.materials.append(self._mat(n))
        if smooth:
            me.shade_smooth()
        p = Part(obj)
        self.parts.append(p)
        return p

    def _from_bm(self, name, bm, mat, smooth=True):
        me = bpy.data.meshes.new(name)
        bm.to_mesh(me)
        bm.free()
        obj = bpy.data.objects.new(name, me)
        self.coll.objects.link(obj)
        me.materials.append(self._mat(mat))
        if smooth:
            me.shade_smooth()
        p = Part(obj)
        self.parts.append(p)
        return p

    def _apply(self, part):
        """Apply a part's modifiers into its mesh (no operator context needed)."""
        obj = part.obj
        if not obj.modifiers:
            return part
        dg = bpy.context.evaluated_depsgraph_get()
        ev = obj.evaluated_get(dg)
        me = bpy.data.meshes.new_from_object(ev, preserve_all_data_layers=True, depsgraph=dg)
        old = obj.data
        obj.modifiers.clear()
        obj.data = me
        if old.users == 0:
            bpy.data.meshes.remove(old)
        return part

    def remove(self, part):
        """Delete a part (e.g. a cutter you no longer need)."""
        if part in self.parts:
            self.parts.remove(part)
        me = part.obj.data
        bpy.data.objects.remove(part.obj)
        if me.users == 0:
            bpy.data.meshes.remove(me)

    # --- primitives -------------------------------------------------------------------------------------------------
    def box(self, size, at=(0, 0, 0), mat='trim', bevel=0.0, segments=2, rot=(0, 0, 0), name='box'):
        """A box of size (x, y, z), centred at `at`, turned by `rot` (radians, XYZ), its edges rounded by `bevel` m."""
        sx, sy, sz = (s / 2 for s in size)
        v = [(-sx, -sy, -sz), (sx, -sy, -sz), (sx, sy, -sz), (-sx, sy, -sz), (-sx, -sy, sz), (sx, -sy, sz), (sx, sy, sz), (-sx, sy, sz)]
        f = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
        p = self._new(name, v, f, mat, smooth=False)
        if bevel > 0:
            self.bevel(p, min(bevel, min(size) * 0.49), segments)
        self.place(p, at, rot)
        return p

    def cylinder(self, r, depth, at=(0, 0, 0), axis='Z', mat='trim', verts=24, bevel=0.0, segments=2, r_top=None, name='cyl'):
        """A cylinder (or a cone frustum with `r_top`) along `axis`, centred at `at`."""
        rt = r if r_top is None else r_top
        vs, fs = [], []
        for i in range(verts):
            a = TAU * i / verts
            vs.append((r * math.cos(a), r * math.sin(a), -depth / 2))
        for i in range(verts):
            a = TAU * i / verts
            vs.append((rt * math.cos(a), rt * math.sin(a), depth / 2))
        for i in range(verts):
            j = (i + 1) % verts
            fs.append((i, j, verts + j, verts + i))
        fs.append(tuple(reversed(range(verts))))
        fs.append(tuple(range(verts, 2 * verts)))
        p = self._new(name, vs, fs, mat, smooth=True)
        self._sharp(p, 40)
        if bevel > 0:
            self.bevel(p, bevel, segments)
        rot = {'Z': (0, 0, 0), 'X': (0, math.pi / 2, 0), 'Y': (math.pi / 2, 0, 0)}[axis]
        self.place(p, at, rot)
        return p

    def sphere(self, r, at=(0, 0, 0), mat='trim', segments=16, scale=(1, 1, 1), name='sphere'):
        """A UV sphere (scaled into an ellipsoid by `scale`)."""
        bm = bmesh.new()
        bmesh.ops.create_uvsphere(bm, u_segments=segments, v_segments=max(6, segments // 2), radius=r)
        p = self._from_bm(name, bm, mat)
        p.obj.scale = scale
        self.place(p, at)
        self._bake_transform(p)
        return p

    def lathe(self, profile, at=(0, 0, 0), axis='Z', mat='trim', segments=32, angle=TAU, loop=False, name='lathe'):
        """Revolve a profile [(radius, height), …] (bottom to top, radius ≥ 0; ends on the axis are capped) about
        `axis`. A full turn gives a closed solid when the profile starts and ends on the axis (radius 0) or is capped."""
        prof = [(max(0.0, r), h) for r, h in profile]
        n = len(prof)
        full = abs(angle - TAU) < 1e-6
        steps = segments if full else segments + 1
        vs, fs = [], []
        for s in range(steps):
            a = angle * s / segments
            ca, sa = math.cos(a), math.sin(a)
            for r, h in prof:
                vs.append((r * ca, r * sa, h))
        for s in range(segments):
            s2 = (s + 1) % steps if full else s + 1
            for k in range(n if loop else n - 1):
                k2 = (k + 1) % n
                a, b, c, d = s * n + k, s * n + k2, s2 * n + k2, s2 * n + k
                fs.append((a, d, c, b))
        # caps where the profile doesn't reach the axis (a `loop` profile is a closed section: a torus, no caps)
        if full and not loop:
            if prof[0][0] > 1e-6:
                fs.append(tuple(s * n for s in reversed(range(steps))))
            if prof[-1][0] > 1e-6:
                fs.append(tuple(s * n + n - 1 for s in range(steps)))
        p = self._new(name, vs, fs, mat)
        self._weld(p)
        self._sharp(p, 35)
        rot = {'Z': (0, 0, 0), 'X': (0, math.pi / 2, 0), 'Y': (-math.pi / 2, 0, 0)}[axis]
        self.place(p, at, rot)
        return p

    def extrude(self, outline, depth, at=(0, 0, 0), plane='YZ', mat='trim', bevel=0.0, segments=2, name='extrude'):
        """Extrude a closed 2D outline [(u, v), …] (counter-clockwise) by `depth`, centred. plane 'YZ' = a side
        profile extruded across X (u = y, v = z); 'XZ' = a front section extruded along Y (u = x, v = z);
        'XY' = a plan extruded up Z (u = x, v = y)."""
        pts = _dedupe(outline)
        self._check_outline(pts, name)
        bm = bmesh.new()
        lo = [bm.verts.new(_plane(u, v, -depth / 2, plane)) for u, v in pts]
        hi = [bm.verts.new(_plane(u, v, depth / 2, plane)) for u, v in pts]
        n = len(pts)
        f0 = bm.faces.new(list(reversed(lo)))
        f1 = bm.faces.new(hi)
        for i in range(n):
            j = (i + 1) % n
            bm.faces.new((lo[i], lo[j], hi[j], hi[i]))
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
        bmesh.ops.triangulate(bm, faces=[f0, f1], quad_method='BEAUTY', ngon_method='BEAUTY')
        p = self._from_bm(name, bm, mat, smooth=False)
        if bevel > 0:
            self.bevel(p, bevel, segments)
        self.place(p, at)
        return p

    def loft(self, rings, mat='paint', smooth=True, cap=True, name='loft'):
        """Skin a list of rings (each a closed loop of (x, y, z), all the same count, in order along the length) into a
        solid; the first and last rings are capped. The kit's body() builds its rings for you."""
        n = len(rings[0])
        vs, fs = [], []
        for r in rings:
            if len(r) != n:
                raise ValueError('loft: every ring needs the same number of points')
            vs.extend(r)
        for k in range(len(rings) - 1):
            for i in range(n):
                j = (i + 1) % n
                fs.append((k * n + i, k * n + j, (k + 1) * n + j, (k + 1) * n + i))
        if cap:
            fs.append(tuple(reversed(range(n))))
            last = (len(rings) - 1) * n
            fs.append(tuple(last + i for i in range(n)))
        p = self._new(name, vs, fs, mat, smooth=smooth)
        self._weld(p)
        self._recalc(p)
        return p

    # --- vehicles ---------------------------------------------------------------------------------------------------
    def body(self, stations, ring=14, mat='paint', smooth=True, sharp=30, name='body'):
        """A vehicle body lofted from cross-sections. `stations`: [(y, s), …] nose (+y) last or first, where s is a dict:
             zb  underside height      zs  shoulder (belt) height     zt  roof/hood/deck top height
             w   half-width at the shoulder    wb  half-width at the sill (tuck-under, ≤ w)
             wt  half-width of the top (tumblehome: < w on a cabin)    n  squareness of the shoulder→top curve (2 round, 4+ square)
             crown  extra height at the centre line of the top
           Values between stations are interpolated smoothly (monotone cubic). `ring` = points per quarter."""
        ys = sorted(set(y for y, _ in stations))
        keys = {}
        for y, s in stations:
            for k, v in s.items():
                keys.setdefault(k, []).append((y, v))
        f = {k: _mono(sorted(v)) for k, v in keys.items()}
        y0, y1 = ys[0], ys[-1]
        count = max(24, int((y1 - y0) / 0.07))
        rings = []
        for i in range(count + 1):
            # denser at the ends, where the shape turns fastest
            t = i / count
            t = 0.5 - 0.5 * math.cos(math.pi * t)
            y = y0 + (y1 - y0) * t
            g = {k: fn(y) for k, fn in f.items()}
            rings.append(_section(y, g, ring))
        # pinch the ends a touch so the caps are small and the nose/tail read as rounded
        p = self.loft(rings, mat=mat, smooth=smooth, name=name)
        self._sharp(p, sharp)
        return p

    def curve(self, keys):
        """A smooth function through [(t, v), …] that never overshoots a key (monotone cubic), clamped outside."""
        return _mono(sorted(keys))

    def wheel(self, at, r, width, rim_r, side=1, style='spokes', spokes=5, rim='rim_dark', name='wheel'):
        """A wheel and tyre whose centre is `at`, its outer face toward `side` (+1 right, −1 left). style 'spokes' |
        'cover' (a flat aero disc) | 'steel' (a dished truck wheel with hand holes) | 'mesh' (many fine spokes)."""
        x, y, z = at
        w = width
        sw = min(0.11, (r - rim_r) * 0.55)
        # tyre: a rounded section revolved about X
        prof = []
        for k in range(7):
            a = -math.pi / 2 + math.pi * k / 6
            prof.append((r - sw * 0.5 + sw * 0.5 * math.cos(a) * 1.0, w / 2 * math.sin(a) * 0.98))
        tyre = [(rim_r - 0.004, -w / 2 + 0.02)] + [(rr, h) for rr, h in prof] + [(rim_r - 0.004, w / 2 - 0.02)]
        tyre = [(rr, -h) for rr, h in reversed(tyre)]
        t = self.lathe(tyre, mat='rubber', axis='X', segments=32, loop=True, name=name + '-tyre')
        self._close_lathe_inner(t)
        self.place(t, at)
        parts = [t]
        face = x + side * (w / 2 - 0.035)
        # the barrel: the rim's inside, its outer end the dark dish set back behind the spokes or the cover
        x_in, x_out = x - side * (w / 2 - 0.03), face - side * (0.055 if style in ('spokes', 'mesh') else 0.03)
        barrel = self.cylinder(rim_r - 0.003, abs(x_out - x_in), at=((x_in + x_out) / 2, y, z), axis='X', mat='chassis', verts=28, name=name + '-barrel')
        parts.append(barrel)
        if style == 'cover':
            prof = [(0, 0.012), (rim_r * 0.25, 0.012), (rim_r * 0.5, 0.008), (rim_r * 0.92, 0.0), (rim_r * 0.995, -0.01), (rim_r * 0.995, -0.03), (0, -0.03)]
            c = self.lathe([(rr, h) for rr, h in prof], axis='X', mat='cover', segments=28, name=name + '-cover')
            self.place(c, (face + side * 0.0, y, z), (0, 0, 0 if side > 0 else math.pi))
            parts.append(c)
            # a few shallow aero vanes on the disc
            for k in range(spokes):
                a = TAU * k / spokes
                v = self.box((0.012, rim_r * 0.5, 0.018), at=(face + side * 0.008, y + math.cos(a) * rim_r * 0.55, z + math.sin(a) * rim_r * 0.55), mat='rim_dark', bevel=0.004, segments=1, rot=(a + math.pi / 2, 0, 0), name=name + '-vane')
                parts.append(v)
        elif style == 'steel':
            prof = [(0, 0.03), (rim_r * 0.3, 0.03), (rim_r * 0.42, 0.0), (rim_r * 0.85, -0.02), (rim_r * 0.99, 0.01), (rim_r * 0.99, -0.03), (0, -0.04)]
            c = self.lathe(prof, axis='X', mat='rim_silver', segments=40, name=name + '-dish')
            self.place(c, (face, y, z), (0, 0, 0 if side > 0 else math.pi))
            hub = self.cylinder(rim_r * 0.22, 0.05, at=(face + side * 0.005, y, z), axis='X', mat='steel', verts=20, bevel=0.01, name=name + '-hub')
            parts += [c, hub]
            for k in range(10):
                a = TAU * k / 10
                nut = self.cylinder(0.014, 0.02, at=(face + side * 0.022, y + math.cos(a) * rim_r * 0.3, z + math.sin(a) * rim_r * 0.3), axis='X', mat='steel', verts=6, name=name + '-nut')
                parts.append(nut)
        else:
            n = 10 if style == 'mesh' else spokes
            lip = self.lathe([(rim_r * 0.9, -0.02), (rim_r * 1.0, -0.02), (rim_r * 1.0, 0.012), (rim_r * 0.9, 0.012)], axis='X', mat=rim, segments=32, loop=True, name=name + '-lip')
            self.place(lip, (face, y, z))
            hub = self.cylinder(rim_r * 0.2, 0.05, at=(face, y, z), axis='X', mat=rim, verts=16, bevel=0.01, segments=1, name=name + '-hub')
            cap = self.cylinder(rim_r * 0.09, 0.012, at=(face + side * 0.026, y, z), axis='X', mat='gloss', verts=16, name=name + '-cap')
            parts += [lip, hub, cap]
            # spokes: tapered slabs from the hub to the lip, turned evenly about the axle
            root, tip = (0.13, 0.065) if style != 'mesh' else (0.05, 0.03)
            for k in range(n):
                a = TAU * k / n + (0.15 if style == 'mesh' else 0)
                sp = self.extrude([(-rim_r * root, rim_r * 0.18), (rim_r * root, rim_r * 0.18), (rim_r * tip, rim_r * 0.94), (-rim_r * tip, rim_r * 0.94)],
                                  0.03, plane='YZ', mat=rim, name=name + '-spoke')
                self.place(sp, (face - side * 0.008, y, z), (a, 0, 0))
                parts.append(sp)
        return self.join(parts, name=name)

    def axle_wheels(self, axle, style='spokes', spokes=5, rim='rim_dark', dual=False, name='axle'):
        """Both wheels of one of the spec's axles ({'at', 'track', 'r', 'w', 'rimR'?, 'dual'?}), on the ground."""
        out = []
        r, w = axle['r'], axle['w']
        rim_r = axle.get('rimR', self.spec.get('rimR', r * 0.68))
        for side in (1, -1):
            if axle.get('dual') or dual:
                for k in (0, 1):
                    xo = axle['track'] / 2 + (k - 0.5) * (w + 0.03)
                    out.append(self.wheel((side * xo, axle['at'], r), r, w, rim_r, side=side if k == 1 else -side, style='steel', rim=rim, name=f'{name}{side}{k}'))
            else:
                out.append(self.wheel((side * axle['track'] / 2, axle['at'], r), r, w, rim_r, side=side, style=style, spokes=spokes, rim=rim, name=f'{name}{side}'))
        return out

    def arches(self, body, axles, clearance=0.035, liner='trim', name='arch'):
        """Cut a wheel well for every axle out of `body` (a cylinder a little bigger than the tyre), lined in `liner`."""
        cutters = []
        for a in axles:
            r = a['r'] + clearance
            span = a['track'] + a['w'] * (3.2 if a.get('dual') else 1.6) + 0.4
            if a.get('dual'):
                cutters.append(self.cylinder(r, span, at=(0, a['at'], a['r']), axis='X', mat=liner, verts=36, name=name))
            else:
                for side in (1, -1):
                    # a well only through the side, not across the floor
                    c = self.cylinder(r, a['w'] + 0.5, at=(side * (a['track'] / 2 + 0.12), a['at'], a['r']), axis='X', mat=liner, verts=36, name=name)
                    cutters.append(c)
        cut = self.join(cutters, name=name + 's')
        before = self.copy(body, name='arch-src')
        self.boolean(body, cut, 'DIFFERENCE')
        self.remove(cut)
        self.keep_normals(body, before, liner)
        self.remove(before)
        self.sharp_borders(body)
        return body

    def sharp_borders(self, part):
        """Mark the edges between two materials sharp (a cut's rim), leaving the rest of the shading as it was."""
        me = part.obj.data
        bm = bmesh.new()
        bm.from_mesh(me)
        for e in bm.edges:
            if len(e.link_faces) == 2 and e.link_faces[0].material_index != e.link_faces[1].material_index:
                e.smooth = False
        bm.to_mesh(me)
        bm.free()
        return part

    def keep_normals(self, part, source, skip_mat=None):
        """Give `part` the smooth shading normals of `source` (the same surface before a boolean), so the long thin
        triangles a cut leaves don't streak the paint. Faces in `skip_mat` (the cut's own walls) keep their own."""
        from mathutils.interpolate import poly_3d_calc
        src = source.obj.data
        src.calc_loop_triangles()
        tris = [t.vertices[:] for t in src.loop_triangles]
        sv = [v.co.copy() for v in src.vertices]
        sn = [Vector(n.vector) for n in src.vertex_normals]
        bvh = BVHTree.FromPolygons(sv, tris)
        me = part.obj.data
        names = [m.name for m in me.materials]
        skip = names.index(skip_mat) if skip_mat in names else -1
        cn = me.corner_normals
        out = [Vector(cn[i].vector) for i in range(len(me.loops))]
        keep = [0.0] * len(me.vertices)
        for poly in me.polygons:
            if poly.material_index == skip:
                continue
            for li in poly.loop_indices:
                vi = me.loops[li].vertex_index
                co = me.vertices[vi].co
                hit = bvh.find_nearest(co)
                if hit[0] is None or hit[3] > 0.01:
                    continue
                a, b, c = tris[hit[2]]
                w = poly_3d_calc([sv[a], sv[b], sv[c]], hit[0])
                n = (sn[a] * w[0] + sn[b] * w[1] + sn[c] * w[2])
                if n.length > 1e-6 and n.normalized().dot(poly.normal) > 0.2:
                    out[li] = n.normalized()
                    keep[vi] = 1.0
        me.normals_split_custom_set(out)
        import os
        if os.environ.get('FORGE_DEBUG'):
            print('DBG keep', sum(keep), len(keep), 'skip', skip, len(me.polygons))
        attr = me.attributes.get('keep_n') or me.attributes.new('keep_n', 'FLOAT', 'POINT')
        for i, k in enumerate(keep):
            attr.data[i].value = k
        return part

    def project(self, target, outline, plane='side', mat='glass', offset=0.004, thickness=0.006, mirror=True, density=0.1, name='panel'):
        """Lay a panel on `target`'s surface: a 2D outline (counter-clockwise) cast onto the body and lifted `offset` off
        it, `thickness` thick. plane 'side' (u = y, v = z, cast toward −X from the right; `mirror` adds the left one),
        'front' (u = x, v = z, cast toward −Y onto the nose), 'rear' (u = x, v = z, toward +Y onto the tail), 'top'
        (u = x, v = y, cast down). Glass, lamps, window surrounds, grilles and badges-free trim all go on this way."""
        dg = bpy.context.evaluated_depsgraph_get()
        tobj = target.obj
        bvh = BVHTree.FromObject(tobj, dg)
        mw = tobj.matrix_world
        mwi = mw.inverted()
        base = _dedupe(outline)
        self._check_outline(base, name)
        pts = _resample(base, density)
        # the panel's triangles: the outline plus a grid of interior points, by a constrained Delaunay triangulation
        # (deterministic for the same input, unlike the bmesh fills, whose hash order varies run to run)
        from mathutils.geometry import delaunay_2d_cdt
        us, vs_ = [p[0] for p in pts], [p[1] for p in pts]
        inner = []
        step = density * 1.4
        u = min(us) + step / 2
        while u < max(us):
            v = min(vs_) + step / 2
            while v < max(vs_):
                if _inside((u, v), pts) and min((u - a) ** 2 + (v - b) ** 2 for a, b in pts) > (step * 0.45) ** 2:
                    inner.append((u, v))
                v += step
            u += step
        n0 = len(pts)
        allp = [Vector((u, v)) for u, v in pts + inner]
        edges = [(i, (i + 1) % n0) for i in range(n0)]
        out = delaunay_2d_cdt(allp, edges, [], 2, 1e-7)   # output_type 2: the triangles inside the constraint loop
        bm = bmesh.new()
        bverts = [bm.verts.new((c.x, c.y, 0)) for c in out[0]]
        for f in out[2]:
            try:
                bm.faces.new([bverts[i] for i in f])
            except ValueError:
                pass
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
        lift = []
        far = 8.0
        miss = 0
        for v in bm.verts:
            u, w = v.co.x, v.co.y
            if plane == 'side':
                o, d = Vector((far, u, w)), Vector((-1, 0, 0))
            elif plane == 'front':
                o, d = Vector((u, far, w)), Vector((0, -1, 0))
            elif plane == 'rear':
                o, d = Vector((u, -far, w)), Vector((0, 1, 0))
            else:
                o, d = Vector((u, w, far)), Vector((0, 0, -1))
            lo, ld = mwi @ o, (mwi.to_3x3() @ d).normalized()
            hit, nrm, _i, _dist = bvh.ray_cast(lo, ld)
            if hit is None:
                miss += 1
                hit, nrm = lo + ld * (far - 0.5), -ld
            hit, nrm = mw @ hit, (mw.to_3x3() @ nrm).normalized()
            if nrm.dot(d) > 0:
                nrm = -nrm
            v.co = hit + nrm * offset
            lift.append((v, nrm))
        if miss > len(lift) * 0.02:
            raise ValueError(f"project '{name}': {miss} of {len(lift)} points missed the body (outline outside its silhouette)")
        # thickness: extrude back along the surface normal → a closed shell
        geom = bmesh.ops.extrude_face_region(bm, geom=bm.faces[:])
        newv = [g for g in geom['geom'] if isinstance(g, bmesh.types.BMVert)]
        nmap = {}
        for v, n in lift:
            nmap[v.index] = n
        bm.verts.index_update()
        avg = Vector((0, 0, 0))
        for _v, n in lift:
            avg += n
        avg.normalize()
        for v in newv:
            v.co -= avg * thickness
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
        # the rim's quads split along their shorter diagonal: the same triangles whatever loop the extrude started them on
        bmesh.ops.triangulate(bm, faces=[f for f in bm.faces if len(f.verts) > 3], quad_method='SHORT_EDGE', ngon_method='EAR_CLIP')
        p = self._from_bm(name, bm, mat, smooth=True)
        self._sharp(p, 50)
        if mirror and plane == 'side':
            m = self.mirrored(p, name=name + '-L')
            return self.join([p, m], name=name)
        return p

    def strip(self, target, points, width, plane='front', mat='lamp_white', offset=0.005, thickness=0.006, mirror=False, name='strip'):
        """A lamp strip or trim line `width` m wide along a 2D polyline `points` on the given plane (see project())."""
        pts = list(points)
        left, right = [], []
        for i, (u, v) in enumerate(pts):
            a = pts[max(0, i - 1)]
            b = pts[min(len(pts) - 1, i + 1)]
            du, dv = b[0] - a[0], b[1] - a[1]
            l = math.hypot(du, dv) or 1
            nu, nv = -dv / l * width / 2, du / l * width / 2
            left.append((u + nu, v + nv))
            right.append((u - nu, v - nv))
        outline = right + list(reversed(left))
        if _area(outline) < 0:
            outline = list(reversed(outline))
        p = self.project(target, outline, plane=plane, mat=mat, offset=offset, thickness=thickness, mirror=mirror and plane == 'side', density=max(0.05, width * 2.0), name=name)
        if mirror and plane != 'side':
            m = self.mirrored(p, name=name + '-L')
            return self.join([p, m], name=name)
        return p

    # --- operations -------------------------------------------------------------------------------------------------
    def place(self, part, at=(0, 0, 0), rot=(0, 0, 0)):
        """Turn (radians, XYZ) then move a part, baking the transform into its mesh."""
        part.obj.rotation_euler = rot
        part.obj.location = at
        self._bake_transform(part)
        return part

    def bevel(self, part, width, segments=2, angle=30, clamp=True):
        """Round every edge sharper than `angle` degrees (real geometry, harden-normals shading)."""
        m = part.obj.modifiers.new('bevel', 'BEVEL')
        m.width = width
        m.segments = segments
        m.limit_method = 'ANGLE'
        m.angle_limit = math.radians(angle)
        m.use_clamp_overlap = clamp
        m.harden_normals = False
        m.miter_outer = 'MITER_ARC'
        self._apply(part)
        return part

    def subdivide(self, part, levels=1):
        """Catmull–Clark subdivision (smooths and multiplies faces by 4 per level: watch the budget)."""
        m = part.obj.modifiers.new('subsurf', 'SUBSURF')
        m.levels = levels
        m.render_levels = levels
        self._apply(part)
        return part

    def boolean(self, part, cutter, op='DIFFERENCE', solver='EXACT'):
        """Boolean `part` with `cutter`: 'DIFFERENCE' | 'UNION' | 'INTERSECT'. New faces take the cutter's material."""
        for m in cutter.obj.data.materials:
            if m.name not in [x.name for x in part.obj.data.materials if x]:
                part.obj.data.materials.append(m)
        mod = part.obj.modifiers.new('bool', 'BOOLEAN')
        mod.operation = op
        mod.object = cutter.obj
        try:
            mod.solver = solver       # EXACT: deterministic (MANIFOLD runs in parallel and its output order varies run to run)
        except TypeError:
            mod.solver = 'EXACT'
        try:
            mod.material_mode = 'TRANSFER'
        except (AttributeError, TypeError):
            pass
        cutter.obj.hide_render = True
        self._apply(part)
        return part

    def array(self, part, count, offset, name=None):
        """`count` copies of a part, each `offset` (x, y, z) m from the last, joined into one."""
        copies = [part]
        for k in range(1, count):
            c = self.copy(part)
            self.place(c, (offset[0] * k, offset[1] * k, offset[2] * k))
            copies.append(c)
        return self.join(copies, name=name or part.name)

    def radial(self, part, count, axis='X', center=(0, 0, 0), name=None):
        """`count` copies of a part turned evenly about an axis through `center`."""
        copies = [part]
        for k in range(1, count):
            c = self.copy(part)
            a = TAU * k / count
            rot = Matrix.Rotation(a, 4, axis)
            T = Matrix.Translation(Vector(center)) @ rot @ Matrix.Translation(-Vector(center))
            c.obj.data.transform(T)
            copies.append(c)
        return self.join(copies, name=name or part.name)

    def mirrored(self, part, axis='X', name=None):
        """A mirror copy of a part across x = 0 (or y = 0 / z = 0)."""
        c = self.copy(part, name=name)
        s = {'X': (-1, 1, 1), 'Y': (1, -1, 1), 'Z': (1, 1, -1)}[axis]
        c.obj.data.transform(Matrix.Diagonal((*s, 1)))
        c.obj.data.flip_normals()
        c.obj.data.update()
        return c

    def symmetric(self, part, name=None):
        """A part and its mirror across x = 0, joined."""
        return self.join([part, self.mirrored(part)], name=name or part.name)

    def copy(self, part, name=None):
        obj = part.obj.copy()
        obj.data = part.obj.data.copy()
        if name:
            obj.name = name
        self.coll.objects.link(obj)
        p = Part(obj)
        self.parts.append(p)
        return p

    def join(self, parts, name='group'):
        """Merge parts into one (materials kept per face)."""
        parts = [p for p in parts if p is not None]
        if len(parts) == 1:
            parts[0].obj.name = name
            return parts[0]
        base = parts[0]
        bm = bmesh.new()
        mats = []
        for p in parts:
            me = p.obj.data
            idx = []
            for m in me.materials:
                if m.name not in [x.name for x in mats]:
                    mats.append(m)
                idx.append([x.name for x in mats].index(m.name))
            # (remapped here, in the joined bmesh: written back to the part's own mesh, an index past its slots is clamped)
            start = len(bm.faces)
            bm.from_mesh(me)
            bm.faces.ensure_lookup_table()
            for k in range(start, len(bm.faces)):
                f = bm.faces[k]
                f.material_index = idx[min(f.material_index, len(idx) - 1)] if idx else 0
        me = bpy.data.meshes.new(name)
        for m in mats:              # slots first: to_mesh clamps an index past them to 0
            me.materials.append(m)
        bm.to_mesh(me)
        bm.free()
        for p in parts[1:]:
            self.remove(p)
        old = base.obj.data
        base.obj.data = me
        base.obj.name = name
        if old.users == 0:
            bpy.data.meshes.remove(old)
        return base

    def set_material(self, part, mat):
        """Give every face of a part one palette material."""
        me = part.obj.data
        me.materials.clear()
        me.materials.append(self._mat(mat))
        for poly in me.polygons:
            poly.material_index = 0
        return part

    def paint_faces(self, part, mat, where):
        """Give the faces whose centre (x, y, z) and normal (nx, ny, nz) satisfy where(c, n) a palette material."""
        me = part.obj.data
        m = self._mat(mat)
        names = [x.name for x in me.materials]
        if m.name not in names:
            me.materials.append(m)
            names.append(m.name)
        k = names.index(m.name)
        for poly in me.polygons:
            c, n = poly.center, poly.normal
            if where(tuple(c), tuple(n)):
                poly.material_index = k
        return part

    def _check_outline(self, pts, name):
        # A small outline with many concave corners reads as a letter or an emblem: flagged, and the gate refuses it.
        us, vs = [p[0] for p in pts], [p[1] for p in pts]
        span = max(max(us) - min(us), max(vs) - min(vs))
        reflex = _reflex(pts)
        if span < 0.4 and reflex > 4:
            self.flags.append({'part': name, 'span': round(span, 3), 'concave': reflex})

    # --- internal helpers -------------------------------------------------------------------------------------------
    def _bake_transform(self, part):
        obj = part.obj
        obj.data.transform(obj.matrix_basis)
        if obj.matrix_basis.determinant() < 0:
            obj.data.flip_normals()
        obj.matrix_basis = Matrix.Identity(4)
        obj.data.update()

    def _weld(self, part, dist=1e-5):
        bm = bmesh.new()
        bm.from_mesh(part.obj.data)
        bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=dist)
        bm.to_mesh(part.obj.data)
        bm.free()

    def _recalc(self, part):
        bm = bmesh.new()
        bm.from_mesh(part.obj.data)
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
        bm.to_mesh(part.obj.data)
        bm.free()

    def _sharp(self, part, deg):
        me = part.obj.data
        me.shade_smooth()
        me.set_sharp_from_angle(angle=math.radians(deg))

    def _close_lathe_inner(self, part):
        self._weld(part, 1e-4)
        self._recalc(part)


# --- geometry helpers (module-level, pure) ------------------------------------------------------------------------
def _plane(u, v, d, plane):
    if plane == 'YZ':
        return (d, u, v)
    if plane == 'XZ':
        return (u, d, v)
    return (u, v, d)


def _area(pts):
    a = 0.0
    for i in range(len(pts)):
        x0, y0 = pts[i]
        x1, y1 = pts[(i + 1) % len(pts)]
        a += x0 * y1 - x1 * y0
    return a / 2


def _inside(p, poly):
    x, y = p
    c = False
    n = len(poly)
    for i in range(n):
        x0, y0 = poly[i]
        x1, y1 = poly[(i + 1) % n]
        if (y0 > y) != (y1 > y) and x < (x1 - x0) * (y - y0) / (y1 - y0) + x0:
            c = not c
    return c


def _reflex(pts):
    n, k = len(pts), 0
    for i in range(n):
        a, b, c = pts[i - 1], pts[i], pts[(i + 1) % n]
        cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0])
        if cross < -1e-9:
            k += 1
    return k


def _dedupe(pts):
    out = []
    for p in pts:
        if not out or math.hypot(p[0] - out[-1][0], p[1] - out[-1][1]) > 1e-5:
            out.append((float(p[0]), float(p[1])))
    if len(out) > 2 and math.hypot(out[0][0] - out[-1][0], out[0][1] - out[-1][1]) < 1e-5:
        out.pop()
    if _area(out) < 0:
        out.reverse()
    return out


def _resample(pts, step):
    out = []
    n = len(pts)
    for i in range(n):
        a, b = pts[i], pts[(i + 1) % n]
        l = math.hypot(b[0] - a[0], b[1] - a[1])
        k = max(1, int(l / step))
        for j in range(k):
            t = j / k
            out.append((a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t))
    return out


def _mono(keys):
    """Monotone cubic (Fritsch–Carlson) through [(t, v), …], clamped outside: never overshoots a key."""
    t = [k[0] for k in keys]
    v = [k[1] for k in keys]
    n = len(keys)
    if n == 1:
        return lambda x: v[0]
    d = [(v[i + 1] - v[i]) / (t[i + 1] - t[i]) for i in range(n - 1)]
    m = [0.0] * n
    m[0], m[-1] = d[0], d[-1]
    for i in range(1, n - 1):
        m[i] = 0.0 if d[i - 1] * d[i] <= 0 else (d[i - 1] + d[i]) / 2
    for i in range(n - 1):
        if d[i] == 0:
            m[i] = m[i + 1] = 0.0
            continue
        a, b = m[i] / d[i], m[i + 1] / d[i]
        s = a * a + b * b
        if s > 9:
            k = 3 / math.sqrt(s)
            m[i], m[i + 1] = k * a * d[i], k * b * d[i]

    def f(x):
        if x <= t[0]:
            return v[0]
        if x >= t[-1]:
            return v[-1]
        i = 0
        while x > t[i + 1]:
            i += 1
        h = t[i + 1] - t[i]
        s = (x - t[i]) / h
        h00, h10, h01, h11 = 2 * s ** 3 - 3 * s ** 2 + 1, s ** 3 - 2 * s ** 2 + s, -2 * s ** 3 + 3 * s ** 2, s ** 3 - s ** 2
        return h00 * v[i] + h10 * h * m[i] + h01 * v[i + 1] + h11 * h * m[i + 1]
    return f


def _section(y, g, q):
    """One closed cross-section ring (right half then left), from the station's parameters."""
    zb, zs, zt = g['zb'], g['zs'], max(g['zt'], g['zs'] + 0.01)
    w = max(g['w'], 0.02)
    wb = min(g.get('wb', w * 0.96), w)
    wt = min(g.get('wt', w * 0.9), w)
    n = g.get('n', 3.0)
    crown = g.get('crown', 0.0)
    rb = min(0.06, (zs - zb) * 0.3, wb * 0.4)
    half = []
    # bottom, centre → sill corner
    for k in range(3):
        half.append(((wb - rb) * 0.7 * k / 2, zb))
    for k in range(4):
        a = -math.pi / 2 + (math.pi / 2) * k / 3
        half.append((wb - rb + rb * math.cos(a), zb + rb + rb * math.sin(a)))
    # sill → shoulder: a slight convex bulge
    m = max(3, q // 2)
    for k in range(1, m + 1):
        s = k / m
        x = wb + (w - wb) * math.sin(s * math.pi / 2)
        half.append((x, zb + rb + (zs - zb - rb) * s))
    # the shoulder's step in (sh: the glass sits inboard of the body side, a crisp belt line)
    sh = min(g.get('sh', 0.0), max(0.0, w - wt - 0.01))
    half.append((w - sh * 0.75, zs + 0.006 + sh * 0.12))
    w2 = w - sh
    # shoulder → top: superellipse quadrant
    for k in range(1, q + 1):
        u = (math.pi / 2) * k / q
        cx = abs(math.cos(u)) ** (2 / n)
        sz = abs(math.sin(u)) ** (2 / n)
        half.append((wt + (w2 - wt) * cx if wt < w2 else w2 * cx, zs + 0.006 + sh * 0.12 + (zt - zs) * sz))
    # top: wt → centre with the crown
    for k in range(1, 4):
        s = k / 3
        x = wt * (1 - s)
        half.append((x, zt + crown * math.sin(s * math.pi / 2)))
    # (a fixed count on every ring, never deduplicated: a ring that drops a point twists the loft)
    right = half
    # ring: bottom centre → right side → top centre → left side (mirror, without the two centre points)
    left = [(-x, z) for x, z in reversed(right[1:-1])]
    loop = right + left
    return [(x, y, z) for x, z in loop]
