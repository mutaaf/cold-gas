// SCENERY: the trees, shrubs and boulders beside Free Drive's roads, placed once, for the renderer
// and the physics alike. Pure and deterministic like the rest of src/sim (integer hashing, + − × ÷
// √ and dmath): what the renderer draws is a pure function of the road (or the seed), and the
// physics streams the same props near the car (src/sim/world.js). What you see is what you hit.
//
// A prop is placed on a jittered grid per 128 m tile (the renderer's level-0 terrain tile): one
// candidate per grid cell, kept where the land says so. The grid spacing is fixed (the same on every
// graphics tier): a tier may not draw a tree the physics doesn't have, or hide one it does.
//
// What each prop is to the car:
//   tree (conifer, broadleaf)  a solid trunk, a Rapier static cylinder (src/sim/world.js), from the
//                              ground up into the crown. A real trunk 20–70 cm across stops a car
//                              (a 0.4 m spruce is a rigid pole to a 2.4 t car at any speed we drive).
//                              Its foliage is soft: branches drag at a car flying through them.
//   shrub                      soft: a car pushes through brush losing a little speed (a drag force
//                              while its footprint overlaps the bush), as a real car flattens it.
//   rock (boulder)             solid: a static convex hull of the very boulder the renderer draws.
import { MATERIALS } from './courses.js';
import { terrainAt, groundAt, nearestSeg, LAND } from './roads.js';
import { dsin, dcos } from './dmath.js';
import { hash2, fbm } from './noise.js';

export const TILE = 128;                    // m: the placement tile (the renderer's level-0 tile)
export const TREE_SPACING = 7;              // m: the baked roads' tree grid
export const VEG_TYPES = ['conifer', 'broad', 'shrub', 'rock'];
export const VEG_SPACING = { conifer: 8, broad: 10, shrub: 8, rock: 9 };    // m: the endless world's grids

// The prop geometries' proportions at scale 1 (src/render/road.js CONIFER_GEO / BROAD_GEO and
// src/world/look.js SHRUB_GEO / ROCK_GEO are built from these numbers).
export const SHAPES = {
  conifer: { trunkR: 0.03, trunkTop: 0.85, crownR: 0.3, crownY0: 0.13 },      // trunk radius × width; solid to 85 % of the height (inside the crown)
  broad: { trunkR: 0.06, trunkTop: 0.7, crownR: 0.504, crownY0: 0.284 },
  shrub: { rx: 0.5, ry: 0.31, cy: 0.28 },                                   // an ellipsoid: radii × (sx, h, sz), centre × h
};

const hashU = (a, b) => { let h = Math.imul(a, 374761393) ^ Math.imul(b, 668265263); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
const t3 = [0, 0, 0], g3 = [0, 0, 0], q = { seg: -1, t: 0, lat: 0, yc: 0, hw: 0, bank: 0, u: 0, other: Infinity };

// A prop: { type, x, y (its foot), z, c, s (cos, sin of its yaw), sx, sy, sz (its scale: width, height,
// depth), r1, r2, r3 (its hashes, for tints), w1, w2 (coast and desert weights, endless) }.
function prop(type, x, y, z, yaw, sx, sy, sz, r1, r2, r3) {
  return { type, x, y, z, yaw, c: dcos(yaw), s: dsin(yaw), sx, sy, sz, r1, r2, r3, w1: 0, w2: 0 };
}

// ---- The baked roads -------------------------------------------------------------------------------
// Candidate (i, j) of the tile at (x0, z0): kept where OSM maps woods (plus a scatter of lone trees),
// below the tree line, on ground a tree can stand on, and clear of the road. Returns a prop or null.
export function bakedTreeAt(road, x0, z0, i, j, spacing = TREE_SPACING) {
  const tr = road.data.trees, B = LAND[road.meta.id] || LAND.stelvio;
  const gi = Math.round(x0 / spacing), gj = Math.round(z0 / spacing);
  const r1 = hashU(gi + i, gj + j), r2 = hashU(gi + i + 7919, gj + j - 104729), r3 = hashU(gi + i - 31, gj + j + 977);
  const x = x0 + (i + r1) * spacing, z = z0 + (j + r2) * spacing;
  const ti = Math.floor((x - tr.x0) / tr.cell), tj = Math.floor((z - tr.z0) / tr.cell);
  const cover = ti >= 0 && tj >= 0 && ti < tr.nx && tj < tr.nz ? tr.data[tj * tr.nx + ti] / 255 : 0;
  if (r3 > cover * 0.9 + B.lone) return null;
  const h = terrainAt(road, x, z, t3)[0];
  if (h < 1.5 || h > B.treeline + (r1 - 0.5) * 160) return null;
  const e = 3;
  const sx = (terrainAt(road, x + e, z, t3)[0] - terrainAt(road, x - e, z, t3)[0]) / (2 * e);
  const sz = (terrainAt(road, x, z + e, t3)[0] - terrainAt(road, x, z - e, t3)[0]) / (2 * e);
  if (sx * sx + sz * sz > 1.1) return null;
  // Clear of the road: 9 m past its edge (any leg near enough to matter, by plan distance).
  if (nearestSeg(road, x, h, z, q)) {
    const al = q.lat < 0 ? -q.lat : q.lat;
    if (al < q.hw + 9 || q.other < q.hw + 9) return null;
  }
  // On the ground the car drives on (the graded roadside near the road, the land beyond), sunk 0.3 m.
  const y = groundAt(road, x, h, z, g3)[0] - 0.3;
  const hgt = B.broad ? 7 + r1 * 9 : 9 + r1 * 15, wid = hgt * (B.broad ? 1.0 : 0.7 + r2 * 0.25);
  return prop(B.broad ? 'broad' : 'conifer', x, y, z, r3 * 6.283, wid, hgt, wid, r1, r2, r3);
}

/** Every tree on the tile at (x0, z0) (size TILE), in grid order. */
export function bakedTrees(road, x0, z0, size = TILE, spacing = TREE_SPACING, out = []) {
  const n = Math.floor(size / spacing);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const p = bakedTreeAt(road, x0, z0, i, j, spacing); if (p) out.push(p); }
  return out;
}

// ---- The endless world -----------------------------------------------------------------------------
const wv = [0, 0, 0, 0], h3 = [0, 0, 0], f3 = [0, 0, 0];
const sstep = (e0, e1, v) => { const t = Math.min(1, Math.max(0, (v - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
// Candidate (a, b) of type t (VEG_TYPES index) on a tile of level `lvl` at (x0, z0), grid spacing sp:
// kept where the biome, the slope, the height and the forest density say so, and clear of the road.
export function endlessPropAt(road, t, sp, lvl, x0, z0, a, b) {
  const terrain = road.terrain, seed = road.seed, type = VEG_TYPES[t];
  const gi = Math.round(x0 / sp), gj = Math.round(z0 / sp);
  const r1 = hash2(seed ^ (t * 0x9e3779b1), gi + a, gj + b), r2 = hash2(seed ^ 0x51ed ^ t, gi + a, gj + b), r3 = hash2(seed ^ 0xc0ffee ^ t, gi + a, gj + b);
  const x = x0 + (a + r1) * sp, z = z0 + (b + r2) * sp;
  const h = terrain.heightAt(x, z, h3)[0];
  const slope = Math.sqrt(h3[1] * h3[1] + h3[2] * h3[2]);
  if (h < 1.2) return null;                                    // the sea and the beach
  terrain.weightsAt(x, z, wv);
  fbm(seed ^ 0xf0e57, x, z, 260, 3, 0.5, f3);
  const forest = f3[0];
  let p = 0;
  // Each prop's chance here: its biomes, squared so a blend fades them out quickly (no spruce in
  // the desert), the forest density, and the ground it can stand on.
  const m2 = wv[0] * wv[0], c2 = wv[1] * wv[1], d2 = wv[2] * wv[2], f2 = wv[3] * wv[3];
  const dry = (1 - wv[2]) * (1 - wv[2]) * (1 - wv[2]);
  if (type === 'conifer') p = (m2 * (h < 820 ? 1 : 0) + f2 * 0.6) * dry * (1 - wv[1]) * sstep(-0.05, 0.25, forest) * (slope < 0.9 ? 1 : 0);
  else if (type === 'broad') p = (f2 * 0.55 + c2 * 0.3) * dry * sstep(0.0, 0.3, forest) * (slope < 0.6 ? 1 : 0);
  else if (type === 'shrub') p = (d2 * 0.35 + c2 * 0.5 + m2 * 0.12 + f2 * 0.1) * (0.4 + sstep(-0.2, 0.3, forest)) * (slope < 0.7 ? 1 : 0);
  else p = m2 * (0.02 + sstep(0.3, 0.7, slope)) + d2 * (0.05 + sstep(0.2, 0.45, slope)) + c2 * sstep(0.35, 0.7, slope) * 0.6 + f2 * 0.015;
  if (r3 > p) return null;
  // Clear of the road (and its bridges' shadows): 8 m past the edge for trees, 4.5 for the rest.
  if (nearestSeg(road, x, h, z, q)) {
    const edge = (q.lat < 0 ? -q.lat : q.lat) - q.hw;
    if (edge < (type === 'conifer' || type === 'broad' ? 8 : 4.5)) return null;
  }
  let sx, sy, sz;
  if (type === 'conifer') { const hh = 9 + r2 * 16; sx = hh * (0.62 + r3 * 0.3); sy = hh; sz = sx; }
  else if (type === 'broad') { const hh = 7 + r2 * 8; sx = hh * (0.9 + r3 * 0.3); sy = hh; sz = sx; }
  else if (type === 'shrub') { const hh = 0.7 + r2 * 1.4; sx = hh * (1.4 + r3); sy = hh; sz = hh * (1.2 + r1); }
  else { const hh = 0.6 + r2 * r2 * (lvl ? 3 : 4.5); sx = hh * (1 + r3 * 0.8); sy = hh * (0.6 + r1 * 0.5); sz = hh * (0.8 + r2 * 0.6); }
  const sink = type === 'rock' ? sy * 0.3 : 0.3;
  // On the ground the car drives on (the road's earthwork reaches 36 m out here).
  const y = groundAt(road, x, h, z, g3)[0] - sink;
  const o = prop(type, x, y, z, r1 * 6.2831853, sx, sy, sz, r1, r2, r3);
  o.w1 = wv[1]; o.w2 = wv[2];
  return o;
}

/** Every prop on an endless tile, per type: { conifer: [...], ... } (only the types with a spacing). */
export function endlessProps(road, lvl, x0, z0, size, spacing) {
  const lists = {};
  for (let t = 0; t < VEG_TYPES.length; t++) {
    const type = VEG_TYPES[t], sp = spacing[type];
    if (!sp) continue;
    const n = Math.floor(size / sp), list = [];
    for (let b = 0; b < n; b++) for (let a = 0; a < n; a++) { const p = endlessPropAt(road, t, sp, lvl, x0, z0, a, b); if (p) list.push(p); }
    if (list.length) lists[type] = list;
  }
  return lists;
}

// ---- The boulder -----------------------------------------------------------------------------------
// The boulder the renderer draws (src/world/look.js ROCK_GEO): an icosahedron of radius 0.5,
// subdivided once (42 vertices), each pushed about by a fixed pattern, flat side down. Its convex
// hull is the collider.
let ROCK = null;
export function rockPoints() {
  if (ROCK) return ROCK;
  const t = (1 + Math.sqrt(5)) / 2;
  const V = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]];
  const F = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
  const pts = [], seen = new Set();
  const add = (x, y, z) => {
    const l = Math.sqrt(x * x + y * y + z * z), k = 0.5 / l;
    x *= k; y *= k; z *= k;
    const key = `${Math.round(x * 1e6)},${Math.round(y * 1e6)},${Math.round(z * 1e6)}`;
    if (seen.has(key)) return;
    seen.add(key);
    const f = 1 + 0.22 * dsin(x * 9.1 + z * 3.7) * dcos(y * 7.3 - x * 2.1);
    const py = y * f * 0.8;
    pts.push(x * f, (py > -0.12 ? py : -0.12) + 0.12, z * f);
  };
  for (const [a, b, c] of F) {
    const A = V[a], B = V[b], C = V[c];
    add(...A); add(...B); add(...C);
    add((A[0] + B[0]) / 2, (A[1] + B[1]) / 2, (A[2] + B[2]) / 2);
    add((B[0] + C[0]) / 2, (B[1] + C[1]) / 2, (B[2] + C[2]) / 2);
    add((A[0] + C[0]) / 2, (A[1] + C[1]) / 2, (A[2] + C[2]) / 2);
  }
  ROCK = Float64Array.from(pts);
  return ROCK;
}

// ---- What the physics streams ----------------------------------------------------------------------
// A course's scenery as the physics reads it: `cell(ix, iz, out)` lists the solids and soft
// volumes of one CELL × CELL square (props whose foot lies in it), as colliders to build:
//   { kind: 'trunk', x, y, z, r, h, mat }            a vertical cylinder from y to y + h
//   { kind: 'hull', x, y, z, yaw, points, mat }       a static convex hull (points local, turned by yaw)
//   { kind: 'soft', x, y, z, rx, ry, rz, k }          brush: drag k (N per m/s) while the car overlaps it
export const CELL = 16;

function solidsOf(p, out) {
  if (p.type === 'conifer' || p.type === 'broad') {
    const S = SHAPES[p.type], r = S.trunkR * p.sx, top = S.trunkTop * p.sy;
    out.push({ kind: 'trunk', x: p.x, y: p.y, z: p.z, r, h: top, mat: MATERIALS.wood });
    // The crown: soft foliage over the trunk, from its lowest branches up.
    const rc = S.crownR * p.sx * 0.8, y0 = p.y + S.crownY0 * p.sy;
    out.push({ kind: 'soft', x: p.x, y: (y0 + p.y + p.sy) / 2, z: p.z, rx: rc, ry: (p.y + p.sy - y0) / 2, rz: rc, k: 900 });
  } else if (p.type === 'shrub') {
    const S = SHAPES.shrub;
    // Brush: ≈ 1.5 kN per m of bush height at 10 m/s (ESTIMATE: a car through dense 1–2 m scrub
    // loses ≈ 1 m/s per bush; roadside vegetation crash tests, cf. FHWA breakaway-shrub studies).
    out.push({ kind: 'soft', x: p.x, y: p.y + S.cy * p.sy, z: p.z, rx: S.rx * p.sx, ry: S.ry * p.sy, rz: S.rx * p.sz, k: 150 * p.sy });
  } else if (p.type === 'rock') {
    const P = rockPoints(), pts = new Float32Array(P.length);
    for (let k = 0; k < P.length; k += 3) { pts[k] = P[k] * p.sx; pts[k + 1] = P[k + 1] * p.sy; pts[k + 2] = P[k + 2] * p.sz; }
    out.push({ kind: 'hull', x: p.x, y: p.y, z: p.z, yaw: p.yaw, points: pts, mat: MATERIALS.rock });
  }
}

// Cell (ix, iz)'s props from a tile placement: the candidates whose grid cells overlap it, kept if
// their foot lies inside it (each prop belongs to exactly one cell).
function cellFromGrid(ix, iz, sp, n, at, out) {
  const cx0 = ix * CELL, cz0 = iz * CELL, x0 = Math.floor(cx0 / TILE) * TILE, z0 = Math.floor(cz0 / TILE) * TILE;
  const a0 = Math.max(0, Math.floor((cx0 - x0) / sp) - 1), a1 = Math.min(n - 1, Math.floor((cx0 + CELL - x0) / sp));
  const b0 = Math.max(0, Math.floor((cz0 - z0) / sp) - 1), b1 = Math.min(n - 1, Math.floor((cz0 + CELL - z0) / sp));
  for (let b = b0; b <= b1; b++) for (let a = a0; a <= a1; a++) {
    const p = at(x0, z0, a, b);
    if (p && p.x >= cx0 && p.x < cx0 + CELL && p.z >= cz0 && p.z < cz0 + CELL) solidsOf(p, out);
  }
  return out;
}

/** The scenery of a baked road, for the physics. */
export function bakedScenery(road) {
  const n = Math.floor(TILE / TREE_SPACING);
  return { cell: (ix, iz, out = []) => cellFromGrid(ix, iz, TREE_SPACING, n, (x0, z0, a, b) => bakedTreeAt(road, x0, z0, a, b), out) };
}

/** The scenery of the endless world, for the physics (the level-0 props, every type). */
export function endlessScenery(road) {
  return {
    cell(ix, iz, out = []) {
      if ((iz + 1) * CELL + road.reach + 40 > road.zMax) road.ensure((iz + 1) * CELL);
      for (let t = 0; t < VEG_TYPES.length; t++) {
        const sp = VEG_SPACING[VEG_TYPES[t]];
        cellFromGrid(ix, iz, sp, Math.floor(TILE / sp), (x0, z0, a, b) => endlessPropAt(road, t, sp, 0, x0, z0, a, b), out);
      }
      return out;
    },
  };
}

/** Fixed solids at given points (the Sandbox's masts): `list` of { x, z, r, h }. */
export function fixedScenery(list) {
  return {
    cell(ix, iz, out = []) {
      for (const m of list) {
        if (Math.floor(m.x / CELL) === ix && Math.floor(m.z / CELL) === iz) out.push({ kind: 'trunk', x: m.x, y: m.y ?? 0, z: m.z, r: m.r, h: m.h, mat: MATERIALS.steel });
      }
      return out;
    },
  };
}
