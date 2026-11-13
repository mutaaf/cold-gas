#!/usr/bin/env python3
# Verifies ios/ColdGas/Resources/Car/ (written by tools/forge/car/build.py): car.json against the .bin files, the
# vertex data (finite, unit normals, AO and grime in 0..1), per-submesh index ranges (relative to vertexStart),
# triangle budgets, the body's bounds against the show roadster's (so the renderer's animated parts still fit), the
# wheels against the spec's tyres, and material names (no marque words, AGENTS.md 3.7).
# Plain python3, no dependencies:  python3 tools/forge/car/check.py
import json
import math
import os
import re
import struct
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, '..', '..', '..'))
CAR = os.path.join(ROOT, 'ios', 'ColdGas', 'Resources', 'Car')
SHOW = os.path.join(ROOT, 'ios', 'ColdGas', 'Resources', 'Stages', 'show')
sys.path.insert(0, HERE)
import mats  # noqa: E402

FAIL = []


def fail(msg):
    FAIL.append(msg)
    print('  FAIL', msg)


def banned_words():
    words = list(mats.GENERIC_BANNED)
    try:
        src = open(os.path.join(ROOT, 'tools', 'forge', 'lib', 'gate.mjs')).read()
        block = src.split('export const BANNED = [', 1)[1].split('];', 1)[0]
        words += re.findall(r"'([^']+)'", block)
    except (OSError, IndexError):
        fail('could not read the marque list from tools/forge/lib/gate.mjs')
    return words


def load(meta, folder, label, budget=None):
    path = os.path.join(folder, meta['file'])
    b = open(path, 'rb').read()
    n, stride, io = meta['vertexCount'], meta['vertexStride'], meta['indexOffsetBytes']
    if stride != 44:
        fail('%s: stride %d' % (label, stride))
    if io != n * 44:
        fail('%s: indexOffsetBytes %d != vertexCount*44 %d' % (label, io, n * 44))
    total_idx = sum(s['indexCount'] for s in meta['submeshes'])
    if len(b) != io + total_idx * 4:
        fail('%s: file is %d bytes, expected %d' % (label, len(b), io + total_idx * 4))
    V = [struct.unpack_from('<11f', b, i * 44) for i in range(n)]
    bad_n = bad_f = bad_r = 0
    for v in V:
        if not all(math.isfinite(x) for x in v):
            bad_f += 1
            continue
        L = math.sqrt(v[3] ** 2 + v[4] ** 2 + v[5] ** 2)
        if abs(L - 1) > 2e-3:
            bad_n += 1
        if not (0 <= v[6] <= 1 and v[7] == 0 and all(0 <= c <= 1.0001 for c in v[8:11])):
            bad_r += 1
    if bad_f:
        fail('%s: %d vertices with non-finite numbers' % (label, bad_f))
    if bad_n:
        fail('%s: %d normals not unit length' % (label, bad_n))
    if bad_r:
        fail('%s: %d vertices with grime/AO outside 0..1 (or uv.y != 0)' % (label, bad_r))
    vs_cursor = is_cursor = 0
    per = {}
    tri_total = 0
    seen_transparent = False
    for s in meta['submeshes']:
        m = s['material']
        name = m['name']
        if s['vertexStart'] != vs_cursor or s['indexStart'] != is_cursor:
            fail('%s/%s: submesh ranges are not contiguous' % (label, name))
        vs_cursor = s['vertexStart'] + s['vertexCount']
        is_cursor = s['indexStart'] + s['indexCount']
        if s['indexCount'] % 3:
            fail('%s/%s: indexCount not a multiple of 3' % (label, name))
        idx = struct.unpack_from('<%dI' % s['indexCount'], b, io + s['indexStart'] * 4)
        if idx and max(idx) >= s['vertexCount']:
            fail('%s/%s: index %d out of range (vertexCount %d; indices are relative to vertexStart)'
                 % (label, name, max(idx), s['vertexCount']))
        for k in range(0, len(idx), 3):
            if len({idx[k], idx[k + 1], idx[k + 2]}) < 3:
                fail('%s/%s: degenerate triangle at %d' % (label, name, k))
                break
        if m['transparent']:
            seen_transparent = True
            if s['renderOrder'] < 1:
                fail('%s/%s: transparent submesh with renderOrder 0' % (label, name))
        elif seen_transparent:
            fail('%s/%s: opaque submesh after a transparent one' % (label, name))
        if m['transparent'] != (m['opacity'] < 1):
            fail('%s/%s: transparent flag disagrees with opacity' % (label, name))
        tri_total += s['indexCount'] // 3
        per[name] = per.get(name, 0) + s['indexCount'] // 3
    if vs_cursor != n:
        fail('%s: submeshes cover %d of %d vertices' % (label, vs_cursor, n))
    if budget and not (budget[0] <= tri_total <= budget[1]):
        fail('%s: %d triangles outside budget %s' % (label, tri_total, budget))
    bounds = [(min(v[i] for v in V), max(v[i] for v in V)) for i in range(3)]
    aos = [v[8] for v in V]
    print('  %-22s %6d tris %6d verts  x[%.3f %.3f] y[%.3f %.3f] z[%.3f %.3f]  AO min %.2f mean %.2f'
          % (meta['file'], tri_total, n, *bounds[0], *bounds[1], *bounds[2], min(aos), sum(aos) / len(aos)))
    for k in sorted(per, key=lambda k: -per[k]):
        print('      %-20s %6d' % (k, per[k]))
    return V, meta, bounds


def body_bounds_check(V, meta, label, old):
    """Every body vertex inside the old roadster's box (+3 cm), except the mirrors (<= 0.15 m past the side)."""
    tol = 0.03
    out = 0
    worst = 0
    for v in V:
        x, y, z = v[0], v[1], v[2]
        dx = max(0, abs(x) - max(abs(old[0][0]), abs(old[0][1])))
        dy = max(0, old[1][0] - y, y - old[1][1])
        dz = max(0, old[2][0] - z, z - old[2][1])
        mirror = 0.80 < y < 0.93 and 0.78 < z < 0.92 and dx <= 0.15
        if (dx > tol and not mirror) or dy > tol or dz > tol:
            out += 1
            worst = max(worst, dx, dy, dz)
    if out:
        fail('%s: %d vertices outside the show roadster bounds by up to %.3f m' % (label, out, worst))


def main():
    car = json.load(open(os.path.join(CAR, 'car.json')))
    stage = json.load(open(os.path.join(SHOW, 'stage.json')))
    oldV = []
    b = open(os.path.join(SHOW, stage['roadster']['file']), 'rb').read()
    oldV = [struct.unpack_from('<3f', b, i * 44) for i in range(stage['roadster']['vertexCount'])]
    old = [(min(v[i] for v in oldV), max(v[i] for v in oldV)) for i in range(3)]
    print('show roadster bounds x[%.3f %.3f] y[%.3f %.3f] z[%.3f %.3f]' % (*old[0], *old[1], *old[2]))
    print('car.json:', car.get('note', '')[:60] + '...')
    words = banned_words()
    names = set()
    print('body')
    V, meta, bb = load(car['body'], CAR, 'body', (35000, 60000))
    body_bounds_check(V, meta, 'body', old)
    for i in range(3):
        if abs(bb[i][0] - old[i][0]) > 0.03 and i != 0:
            fail('body min %s %.3f vs show %.3f' % ('xyz'[i], bb[i][0], old[i][0]))
        if abs(bb[i][1] - old[i][1]) > 0.03 and i != 0:
            fail('body max %s %.3f vs show %.3f' % ('xyz'[i], bb[i][1], old[i][1]))
    names |= {s['material']['name'] for s in meta['submeshes']}
    V, meta, bb = load(car['bodyLod1'], CAR, 'bodyLod1', (6000, 14000))
    body_bounds_check(V, meta, 'bodyLod1', old)
    names |= {s['material']['name'] for s in meta['submeshes']}
    for need in ('drive-amber', 'drive-marker', 'drive-plateLamp', 'drive-ambient', 'drive-drl', 'drive-tail',
                 'drive-paint', 'drive-glass', 'drive-lens'):
        if need not in names:
            fail('body has no %s submesh' % need)
    W = car['wheels']
    print('wheels (built for %s, mirrorX %s)' % (W.get('builtFor'), W.get('mirrorX')))
    for key, R, Wd in (('front', 0.343, 0.295), ('rear', 0.367, 0.335)):
        V, meta, bb = load(W[key + 'Spin'], CAR, key + 'Spin', (1000, 7000))
        names |= {s['material']['name'] for s in meta['submeshes']}
        r = max(math.hypot(v[1], v[2]) for v in V)
        w = bb[0][1] - bb[0][0]
        if abs(r - R) > 0.004:
            fail('%sSpin radius %.4f vs spec %.3f' % (key, r, R))
        if abs(w - Wd) > 0.012:
            fail('%sSpin width %.4f vs spec %.3f' % (key, w, Wd))
        if abs(bb[0][0] + bb[0][1]) > 0.02:
            fail('%sSpin not centred on the axle in x (%.3f..%.3f)' % (key, *bb[0]))
        print('      radius %.4f m, width %.4f m (spec %.3f / %.3f)' % (r, w, R, Wd))
        V, meta, bb = load(W[key + 'Steer'], CAR, key + 'Steer', (200, 2500))
        names |= {s['material']['name'] for s in meta['submeshes']}
        if 'roadster-rotor' not in {s['material']['name'] for s in meta['submeshes']}:
            fail('%sSteer has no roadster-rotor submesh' % key)
        if max(math.hypot(v[1], v[2]) for v in V) > 0.245:
            fail('%sSteer reaches past the barrel' % key)
    for n in sorted(names):
        hits = [w for w in words if re.search(r'(^|[^a-z])' + re.escape(w) + r'([^a-z]|$)', n.lower())]
        if hits:
            fail('material %s carries %s' % (n, hits))
    print('materials:', ', '.join(sorted(names)))
    print('FAILED (%d)' % len(FAIL) if FAIL else 'OK: all checks passed')
    return 1 if FAIL else 0


if __name__ == '__main__':
    sys.exit(main())
