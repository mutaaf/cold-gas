# Read and write the native mesh format (stage.json / car.json "mesh" records): vertexCount x 44-byte vertices
# (float32 x 11: position xyz, normal xyz, uv xy, colour rgb), then uint32 indices at indexOffsetBytes. A submesh's
# indices are relative to its vertexStart. Plain python (no bpy) so check.py can share it.
import json
import struct

STRIDE = 44


def read_mesh(meta, folder):
    """-> list of (material dict, verts [(11 floats)], tris [(i,j,k)] local to the submesh)."""
    with open(folder + '/' + meta['file'], 'rb') as f:
        b = f.read()
    out = []
    for s in meta['submeshes']:
        vs = [struct.unpack_from('<11f', b, (s['vertexStart'] + i) * STRIDE) for i in range(s['vertexCount'])]
        idx = struct.unpack_from('<%dI' % s['indexCount'], b, meta['indexOffsetBytes'] + s['indexStart'] * 4)
        tris = [tuple(idx[i:i + 3]) for i in range(0, len(idx), 3)]
        out.append((s['material'], vs, tris))
    return out


def write_mesh(path, file_name, groups):
    """groups: list of (material dict, renderOrder, verts [(11 floats)], tris [(i,j,k) local]).
    Writes the .bin and returns its mesh record."""
    vbuf = bytearray()
    ibuf = bytearray()
    subs = []
    vstart = 0
    istart = 0
    for mat, order, verts, tris in groups:
        for v in verts:
            vbuf += struct.pack('<11f', *v)
        for t in tris:
            ibuf += struct.pack('<3I', *t)
        subs.append({'material': mat, 'renderOrder': order, 'vertexStart': vstart, 'vertexCount': len(verts),
                     'indexStart': istart, 'indexCount': len(tris) * 3})
        vstart += len(verts)
        istart += len(tris) * 3
    with open(path, 'wb') as f:
        f.write(bytes(vbuf) + bytes(ibuf))
    return {'file': file_name, 'vertexStride': STRIDE, 'vertexCount': vstart, 'indexOffsetBytes': len(vbuf),
            'submeshes': subs}


def load_stage(folder):
    with open(folder + '/stage.json') as f:
        return json.load(f)
