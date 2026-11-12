# The review turntable (0211): eight views around the model on a dusk slab, stitched into one 4 × 2 PNG strip.
# EEVEE, headless. What a reviewer looks at before an asset may reach the game.
import math
import os
import bpy
import numpy as np
from mathutils import Vector


def _world():
    w = bpy.data.worlds.new('dusk')
    w.use_nodes = True
    nt = w.node_tree
    bg = nt.nodes.get('Background')
    grad = nt.nodes.new('ShaderNodeTexGradient')
    grad.gradient_type = 'LINEAR'
    coord = nt.nodes.new('ShaderNodeTexCoord')
    sep = nt.nodes.new('ShaderNodeSeparateXYZ')
    ramp = nt.nodes.new('ShaderNodeValToRGB')
    ramp.color_ramp.elements[0].position = 0.45
    ramp.color_ramp.elements[0].color = (0.32, 0.26, 0.24, 1)      # the horizon's warm haze (scene.js PALETTE)
    ramp.color_ramp.elements[1].position = 0.75
    ramp.color_ramp.elements[1].color = (0.05, 0.07, 0.12, 1)      # the blue-hour zenith
    nt.links.new(coord.outputs['Generated'], sep.inputs[0])
    nt.links.new(sep.outputs['Z'], ramp.inputs['Fac'])
    nt.links.new(ramp.outputs['Color'], bg.inputs['Color'])
    bg.inputs['Strength'].default_value = 1.4
    del grad
    return w


def _show_occlusion(obj):
    """Multiply the baked occlusion (the 'Color' attribute) into each material's base colour, as the game does."""
    for m in obj.data.materials:
        nt = m.node_tree
        b = nt.nodes.get('Principled BSDF')
        if b is None or b.inputs['Base Color'].is_linked:
            continue
        attr = nt.nodes.new('ShaderNodeVertexColor')
        attr.layer_name = 'Color'
        mix = nt.nodes.new('ShaderNodeMix')
        mix.data_type = 'RGBA'
        mix.blend_type = 'MULTIPLY'
        mix.inputs['Factor'].default_value = 1.0
        mix.inputs[6].default_value = b.inputs['Base Color'].default_value
        nt.links.new(attr.outputs['Color'], mix.inputs[7])
        nt.links.new(mix.outputs[2], b.inputs['Base Color'])


def render(obj, out_png, frames=8, size=(400, 250)):
    scene = bpy.context.scene
    scene.render.engine = 'BLENDER_EEVEE'
    scene.render.resolution_x, scene.render.resolution_y = size
    scene.render.film_transparent = False
    scene.view_settings.view_transform = 'AgX'
    scene.view_settings.look = 'AgX - Medium High Contrast'
    try:
        scene.eevee.taa_render_samples = 32
        scene.eevee.use_shadows = True
        scene.eevee.use_raytracing = False   # (screen-space reflections streak the paint near the wheels; the game has none)
    except AttributeError:
        pass
    scene.world = _world()
    _show_occlusion(obj)
    co = [obj.matrix_world @ v.co for v in obj.data.vertices]
    lo = Vector((min(c.x for c in co), min(c.y for c in co), min(c.z for c in co)))
    hi = Vector((max(c.x for c in co), max(c.y for c in co), max(c.z for c in co)))
    c = (lo + hi) / 2
    span = max((hi - lo).length, 0.5)
    # the slab
    me = bpy.data.meshes.new('slab')
    s = span * 6
    me.from_pydata([(-s, -s, 0), (s, -s, 0), (s, s, 0), (-s, s, 0)], [], [(0, 1, 2, 3)])
    slab = bpy.data.objects.new('slab', me)
    scene.collection.objects.link(slab)
    m = bpy.data.materials.new('slab')
    m.use_nodes = True
    b = m.node_tree.nodes.get('Principled BSDF')
    b.inputs['Base Color'].default_value = (0.09, 0.085, 0.08, 1)
    b.inputs['Roughness'].default_value = 0.85
    me.materials.append(m)
    # key (warm, low: the Lineup's sun) and a cool rim
    key = bpy.data.objects.new('key', bpy.data.lights.new('key', 'SUN'))
    key.data.energy = 3.2
    key.data.color = (1.0, 0.82, 0.68)
    key.data.angle = math.radians(3)
    key.rotation_euler = (math.radians(58), 0, math.radians(-140))
    if os.environ.get('FORGE_NOSHADOW'):
        key.data.use_shadow = False
    rim = bpy.data.objects.new('rim', bpy.data.lights.new('rim', 'AREA'))
    rim.data.energy = 60 * span
    rim.data.size = span
    rim.data.color = (0.62, 0.77, 1.0)
    rim.location = (c.x - span, c.y + span, c.z + span * 0.8)
    rim.rotation_euler = (math.radians(-50), math.radians(-35), 0)
    for o in (key, rim):
        scene.collection.objects.link(o)
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    cam.data.lens = 50
    scene.collection.objects.link(cam)
    scene.camera = cam
    dist = max(span * 1.7, (hi.z - lo.z) * 3.6)   # (a tall small prop needs the height in frame)
    tiles = []
    base = os.path.splitext(out_png)[0]
    for k in range(frames):
        a = math.radians(35) + math.tau * k / frames
        h = 0.32 if k % 2 == 0 else 0.55
        cam.location = (c.x + math.cos(a) * dist, c.y + math.sin(a) * dist, c.z + span * h * 0.5 + 0.04 * span)
        d = c - Vector(cam.location)
        cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
        f = f'{base}-{k}.png'
        scene.render.filepath = f
        bpy.ops.render.render(write_still=True)
        tiles.append(f)
    # stitch 4 × 2
    w, hgt = size
    sheet = np.zeros((hgt * 2, w * 4, 4), dtype=np.float32)
    for k, f in enumerate(tiles):
        img = bpy.data.images.load(f)
        px = np.array(img.pixels[:], dtype=np.float32).reshape(hgt, w, 4)
        row, col = k // 4, k % 4
        # images are bottom-up: the first row goes on top
        sheet[(1 - row) * hgt:(2 - row) * hgt, col * w:(col + 1) * w] = px
        bpy.data.images.remove(img)
        os.remove(f)
    out = bpy.data.images.new('turntable', w * 4, hgt * 2, alpha=False)
    out.pixels = sheet.ravel()
    out.filepath_raw = out_png
    out.file_format = 'PNG'
    out.save()
    for o in (slab, key, rim, cam):
        bpy.data.objects.remove(o)
