// One terrain tile of the endless world, as typed arrays: positions, normals, colours and the
// vegetation on it. Runs in the terrain worker (src/world/terrain.worker.js), and in Node for the
// tests. It reads the same pure functions the physics drives on (src/sim/endless.js and roads.js),
// so a vertex sits exactly on the ground the car feels; only shading is added here.
//
// A tile at level L covers SIZE[L] metres with N × N cells, plus a skirt that drops from its rim
// (hides cracks against a neighbour of another level). Near the road the ground is lowered under
// the corridor, out of sight: the road chunks draw the ribbon and its verges over it
// (src/render/road.js), as on the baked roads.
import { createEndlessRoad } from '../sim/endless.js';
import { groundAt, nearestSeg, SHOULDER } from '../sim/roads.js';
import { hash2, fbm } from '../sim/noise.js';

export const N = 32;
export const LEVELS = [
  { size: 128, sink: [1.3, 9, 12.5], skirt: 8 },
  { size: 512, sink: [3.5, 16, 34], skirt: 40 },
  { size: 2048, sink: [9, 40, 90], skirt: 160 },
  { size: 8192, sink: [20, 120, 300], skirt: 600 },
];
export const VEG_TYPES = ['conifer', 'broad', 'shrub', 'rock'];

// Colours (sRGB), per biome: mountain, coast, desert, forest.
const C = (hex) => [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];
const PAL = {
  mGrass: C(0x5f7d3b), mMeadow: C(0x86865a), mRock: C(0x7a766f), mScree: C(0x9a958b), snow: C(0xf1f4f7), mForest: C(0x2e4a30),
  cGrass: C(0xa49556), cScrub: C(0x67733f), cRock: C(0x8d7d68), sand: C(0xdcca9c), wetSand: C(0xa89a78),
  dSand: C(0xd6ac72), dRock: C(0xa9643f), dDark: C(0x8a4e33), dScrub: C(0x8f8a59),
  fGrass: C(0x4f7c34), fDark: C(0x2b452a), fSoil: C(0x6d5c3d),
};
const mix3 = (o, a, b, t) => { o[0] = a[0] + (b[0] - a[0]) * t; o[1] = a[1] + (b[1] - a[1]) * t; o[2] = a[2] + (b[2] - a[2]) * t; return o; };
const sstep = (e0, e1, v) => { const t = Math.min(1, Math.max(0, (v - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };

// The world a seed builds, for tiles: the road (generated as far as asked) and its terrain.
export function createTileGen(seed) {
  const road = createEndlessRoad(seed);
  return { seed: road.seed, road, terrain: road.terrain };
}

const q = { seg: -1, t: 0, lat: 0, yc: 0, hw: 0, bank: 0, u: 0, other: Infinity };
const g3 = [0, 0, 0], h3 = [0, 0, 0], f3 = [0, 0, 0], wv = [0, 0, 0, 0];

// The ground the mesh draws at (x, z) for level `lvl`: the physical ground, lowered under the
// road corridor (deeper on coarser levels, whose triangles span more of it). Into out [h, dist to
// the road's edge (Infinity if none), forest density 0–1].
function sampleGround(gen, lvl, x, z, out) {
  const { road, terrain } = gen;
  const hN = terrain.heightAt(x, z, h3)[0];
  let h = groundAt(road, x, hN, z, g3)[0], edge = Infinity;
  if (nearestSeg(road, x, hN, z, q)) {
    const al = q.lat < 0 ? -q.lat : q.lat;
    edge = al - q.hw;
    const fl = road.flags[q.seg];
    if (!(fl & 3)) {
      // Under the ribbon and shoulders the ground is the road's own plane (the ribbon covers it).
      if (edge <= SHOULDER) h = q.yc + q.bank * (q.lat < -q.hw ? -q.hw : q.lat > q.hw ? q.hw : q.lat) - 0.05 * (edge > 0 ? edge : 0);
      const s = LEVELS[lvl].sink;
      if (edge < s[2]) h -= edge < s[1] ? s[0] : s[0] * (1 - (edge - s[1]) / (s[2] - s[1]));
    }
  }
  fbm(gen.seed ^ 0xf0e57, x, z, 260, 3, 0.5, f3);
  out[0] = h; out[1] = edge; out[2] = f3[0];
  return out;
}

const col = [0, 0, 0], tmpc = [0, 0, 0], vc = [0, 0, 0];
// A vertex's colour from its biome mix, height, slope (1 − n.y) and forest density.
function shade(gen, x, z, h, slope, forest, out) {
  gen.terrain.weightsAt(x, z, wv);
  const n1 = hash2(gen.seed, Math.floor(x / 7), Math.floor(z / 7)) - 0.5;
  out[0] = 0; out[1] = 0; out[2] = 0;
  const add = (c, w) => { out[0] += c[0] * w; out[1] += c[1] * w; out[2] += c[2] * w; };
  if (wv[0] > 0.001) {
    mix3(col, PAL.mGrass, PAL.mMeadow, sstep(380, 700, h + n1 * 60));
    mix3(col, col, PAL.mForest, sstep(0.05, 0.35, forest) * (1 - sstep(650, 900, h)));
    mix3(col, col, PAL.mScree, sstep(0.25, 0.42, slope + n1 * 0.1) * 0.7);
    mix3(col, col, PAL.mRock, sstep(0.38, 0.55, slope + n1 * 0.12));
    mix3(col, col, PAL.snow, sstep(820, 980, h + n1 * 80 + (1 - slope) * 60) * (1 - sstep(0.45, 0.62, slope)));
    add(col, wv[0]);
  }
  if (wv[1] > 0.001) {
    mix3(col, PAL.cGrass, PAL.cScrub, sstep(-0.05, 0.35, forest));
    mix3(col, col, PAL.cRock, sstep(0.32, 0.5, slope + n1 * 0.1));
    mix3(col, col, PAL.sand, 1 - sstep(1.2, 4, h + n1 * 2));
    mix3(col, col, PAL.wetSand, 1 - sstep(-0.6, 0.6, h));
    add(col, wv[1]);
  }
  if (wv[2] > 0.001) {
    mix3(col, PAL.dSand, PAL.dScrub, sstep(0.25, 0.55, forest) * 0.6);
    mix3(tmpc, PAL.dRock, PAL.dDark, sstep(-0.2, 0.3, n1 + Math.sin(h * 0.35) * 0.4));       // strata
    mix3(col, col, tmpc, sstep(0.18, 0.34, slope + n1 * 0.08));
    add(col, wv[2]);
  }
  if (wv[3] > 0.001) {
    mix3(col, PAL.fGrass, PAL.fDark, sstep(0.0, 0.3, forest));
    mix3(col, col, PAL.fSoil, sstep(0.35, 0.55, slope));
    add(col, wv[3]);
  }
  const v = 0.94 + n1 * 0.12;
  out[0] *= v; out[1] *= v; out[2] *= v;
  return out;
}

// The colour the terrain would have at (x, z) (the road chunks' verges are shaded to match),
// into out [r, g, b] (sRGB 0–1).
export function colourAt(gen, x, z, h, slope, out = [0, 0, 0]) {
  fbm(gen.seed ^ 0xf0e57, x, z, 260, 3, 0.5, f3);
  return shade(gen, x, z, h, slope, f3[0], out);
}

// Build tile (lvl, i, j). opts.veg: plant vegetation (spacing in m per type, or 0).
export function buildTile(gen, lvl, i, j, opts = {}) {
  const t0 = performance.now();
  const L = LEVELS[lvl], size = L.size, step = size / N, x0 = i * size, z0 = j * size;
  // Everything that shapes this tile's ground must be generated (pure: the road is the same
  // whichever worker or page builds it).
  gen.road.ensure(z0 + size);
  const P = N + 3, V = (N + 1) * (N + 1), S = 4 * N;
  // Heights on a grid one post wider all round (for normals at the rim).
  const H = new Float64Array(P * P), E = new Float64Array(P * P), F = new Float64Array(P * P);
  const s3 = [0, 0, 0];
  for (let b = 0; b < P; b++) for (let a = 0; a < P; a++) {
    sampleGround(gen, lvl, x0 + (a - 1) * step, z0 + (b - 1) * step, s3);
    H[b * P + a] = s3[0]; E[b * P + a] = s3[1]; F[b * P + a] = s3[2];
  }
  const pos = new Float32Array((V + S) * 3), nor = new Int8Array((V + S) * 4), col8 = new Uint8Array((V + S) * 4), dep = new Int8Array(V + S);
  let minY = Infinity, maxY = -Infinity;
  for (let b = 0; b <= N; b++) for (let a = 0; a <= N; a++) {
    const k = b * (N + 1) + a, g = (b + 1) * P + (a + 1);
    const h = H[g];
    // Under the sea the mesh lies flat at sea level, and remembers how deep it is (¼ m steps to
    // 31 m) for the water shading.
    pos[k * 3] = a * step; pos[k * 3 + 1] = h < 0 ? 0 : h; pos[k * 3 + 2] = b * step;
    dep[k] = h >= 0 ? 0 : h < -31.75 ? -127 : Math.round(h * 4);
    if (h < minY) minY = h; if (h > maxY) maxY = h;
    const hx = (H[g + 1] - H[g - 1]) / (2 * step), hz = (H[g + P] - H[g - P]) / (2 * step);
    const l = Math.sqrt(hx * hx + 1 + hz * hz);
    nor[k * 4] = Math.round((-hx / l) * 127); nor[k * 4 + 1] = Math.round((1 / l) * 127); nor[k * 4 + 2] = Math.round((-hz / l) * 127);
    // Shade from the physical slope (not the corridor's sink).
    shade(gen, x0 + a * step, z0 + b * step, h, 1 - 1 / l, F[g], vc);
    col8[k * 4] = Math.round(Math.min(1, vc[0]) * 255); col8[k * 4 + 1] = Math.round(Math.min(1, vc[1]) * 255); col8[k * 4 + 2] = Math.round(Math.min(1, vc[2]) * 255);
    // Alpha carries how near the road edge this post is (0 far … 255 on it): the shader keeps
    // detail noise off the corridor.
    const e = E[g];
    col8[k * 4 + 3] = e < 0 ? 255 : e > 25 ? 0 : Math.round(255 * (1 - e / 25));
  }
  // Skirt: the rim posts again, dropped.
  const border = [];
  for (let a = 0; a < N; a++) border.push(a);
  for (let b = 0; b < N; b++) border.push(b * (N + 1) + N);
  for (let a = N; a > 0; a--) border.push(N * (N + 1) + a);
  for (let b = N; b > 0; b--) border.push(b * (N + 1));
  for (let s = 0; s < S; s++) {
    const k = border[s], o = V + s;
    pos[o * 3] = pos[k * 3]; pos[o * 3 + 1] = pos[k * 3 + 1] - L.skirt; pos[o * 3 + 2] = pos[k * 3 + 2];
    for (let c = 0; c < 4; c++) { nor[o * 4 + c] = nor[k * 4 + c]; col8[o * 4 + c] = col8[k * 4 + c]; }
    dep[o] = dep[k];
  }
  const out = { lvl, i, j, x0, z0, size, minY: Math.max(0, minY) - L.skirt, maxY: Math.max(0, maxY), pos, nor, col: col8, dep, veg: null, ms: 0 };
  if (opts.veg) out.veg = plant(gen, lvl, x0, z0, size, opts.veg);
  out.ms = performance.now() - t0;
  return out;
}

// Vegetation: a jittered grid per type, kept where the biome, the slope, the height and the forest
// density say so, and clear of the road. Matrices (16 floats) and tints (3) per instance, local to
// the tile's corner. Deterministic per seed and position.
const BASE = {
  conifer: C(0x3d6639), broad: C(0x557538), oak: C(0x5b6a35), shrub: C(0x5a7238), sage: C(0x8e8a5c), scrub: C(0x6f7645),
  rock: C(0x8f8a82), redRock: C(0xae6f4d),
};
const lin = (v) => (v <= 0 ? 0 : v >= 1 ? 1 : v ** 2.2);
const vq = { seg: -1, t: 0, lat: 0, yc: 0, hw: 0, bank: 0, u: 0, other: Infinity };
function plant(gen, lvl, x0, z0, size, spacing) {
  const { terrain, road, seed } = gen;
  const lists = {};
  for (let t = 0; t < VEG_TYPES.length; t++) {
    const type = VEG_TYPES[t], sp = spacing[type];
    if (!sp) continue;
    const m = [], c = [];
    const n = Math.floor(size / sp), gi = Math.round(x0 / sp), gj = Math.round(z0 / sp);
    for (let b = 0; b < n; b++) for (let a = 0; a < n; a++) {
      const r1 = hash2(seed ^ (t * 0x9e3779b1), gi + a, gj + b), r2 = hash2(seed ^ 0x51ed ^ t, gi + a, gj + b), r3 = hash2(seed ^ 0xc0ffee ^ t, gi + a, gj + b);
      const x = x0 + (a + r1) * sp, z = z0 + (b + r2) * sp;
      const h = terrain.heightAt(x, z, h3)[0];
      const slope = Math.sqrt(h3[1] * h3[1] + h3[2] * h3[2]);
      if (h < 1.2) continue;                                    // the sea and the beach
      terrain.weightsAt(x, z, wv);
      fbm(seed ^ 0xf0e57, x, z, 260, 3, 0.5, f3);
      const forest = f3[0];
      let p = 0;
      // Each prop's chance here: its biomes, squared so a blend fades them out quickly (no spruce in
      // the desert), the forest density, and the ground it can stand on.
      const m2 = wv[0] * wv[0], c2 = wv[1] * wv[1], d2 = wv[2] * wv[2], f2 = wv[3] * wv[3];
      if (type === 'conifer') p = (m2 * (h < 820 ? 1 : 0) + f2 * 0.6) * sstep(-0.05, 0.25, forest) * (slope < 0.9 ? 1 : 0);
      else if (type === 'broad') p = (f2 * 0.55 + c2 * 0.3) * sstep(0.0, 0.3, forest) * (slope < 0.6 ? 1 : 0);
      else if (type === 'shrub') p = (d2 * 0.35 + c2 * 0.5 + m2 * 0.12 + f2 * 0.1) * (0.4 + sstep(-0.2, 0.3, forest)) * (slope < 0.7 ? 1 : 0);
      else p = m2 * (0.02 + sstep(0.3, 0.7, slope)) + d2 * (0.05 + sstep(0.2, 0.45, slope)) + c2 * sstep(0.35, 0.7, slope) * 0.6 + f2 * 0.015;
      if (r3 > p) continue;
      // Clear of the road (and its bridges' shadows): 8 m past the edge for trees, 4 for the rest.
      if (nearestSeg(road, x, h, z, vq)) {
        const edge = (vq.lat < 0 ? -vq.lat : vq.lat) - vq.hw;
        if (edge < (type === 'conifer' || type === 'broad' ? 8 : 4.5)) continue;
      }
      const yaw = r1 * 6.2831853, cy = Math.cos(yaw), sy = Math.sin(yaw);
      let sx, sy2, sz;
      if (type === 'conifer') { const hh = 9 + r2 * 16; sx = hh * (0.62 + r3 * 0.3); sy2 = hh; sz = sx; }
      else if (type === 'broad') { const hh = 7 + r2 * 8; sx = hh * (0.9 + r3 * 0.3); sy2 = hh; sz = sx; }
      else if (type === 'shrub') { const hh = 0.7 + r2 * 1.4; sx = hh * (1.4 + r3); sy2 = hh; sz = hh * (1.2 + r1); }
      else { const hh = 0.6 + r2 * r2 * (lvl ? 3 : 4.5); sx = hh * (1 + r3 * 0.8); sy2 = hh * (0.6 + r1 * 0.5); sz = hh * (0.8 + r2 * 0.6); }
      const sink = type === 'rock' ? sy2 * 0.3 : 0.3;
      // Column-major 4×4: rotation about y, scale, translation.
      m.push(cy * sx, 0, -sy * sx, 0, 0, sy2, 0, 0, sy * sz, 0, cy * sz, 0, x - x0, h - sink, z - z0, 1);
      // Final instance colour, linear (the material multiplies the geometry's vertex shading).
      const tint = 0.78 + 0.44 * r3;
      let base;
      if (type === 'conifer') base = BASE.conifer;
      else if (type === 'broad') base = wv[1] > 0.5 ? BASE.oak : BASE.broad;
      else if (type === 'shrub') base = wv[2] > 0.5 ? BASE.sage : wv[1] > 0.5 ? BASE.scrub : BASE.shrub;
      else base = mix3(tmpc, BASE.rock, BASE.redRock, wv[2]);
      c.push(lin(base[0] * tint * (0.96 + 0.08 * r1)), lin(base[1] * tint), lin(base[2] * tint * (0.94 + 0.08 * r2)));
    }
    if (m.length) lists[type] = { m: new Float32Array(m), c: new Float32Array(c), n: m.length / 16 };
  }
  return lists;
}
