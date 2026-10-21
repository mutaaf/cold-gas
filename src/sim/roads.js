// Real roads as a course the physics can drive (Free Drive). Pure and deterministic like the rest
// of src/sim: the road comes from a baked asset (public/roads/<id>.bin.gz, built from
// OpenStreetMap and open terrain by scripts/roads/build.mjs), and everything here is +, −, ×, ÷
// and √ on numbers read out of typed arrays, so every engine computes the same bits.
//
// Frame: x east, y up (metres above sea level), z south: right-handed, like the courses. The
// road is a centreline sampled every 3 m with, per sample, its elevation, half-width, banking
// (crossfall, + = left edge higher) and flags (bridge, tunnel, and each side's barrier).
//
// `surface()` answers the one question the car asks, the signed distance to the nearest solid
// with its normal and material, from three pieces:
//   - the road ribbon: the nearest centreline segment (a uniform grid of 8 m cells lists the
//     segments that can matter there), with real width, grade and banking, a deck under it;
//   - the terrain: the DEM, conformed to the road the way a road is built (flat under the
//     shoulders, cut and fill slopes no steeper than 1:1 and 1:1.5 beyond them), precomputed on a
//     4 m grid around the road at load and bilinear everywhere else;
//   - barriers: guard rails, stone walls, tunnel walls and roofs as solids beside the ribbon.
import { MATERIALS } from './courses.js';
import { datan2 } from './dmath.js';

export const ROAD_MAGIC = 'CGR1';
export const SHOULDER = 1.2;            // m of gravel shoulder past the painted edge
const CUT = 1.0, FILL = 1.5;     // structural slopes: cut rises 1:1, fill falls 1:1.5 (a common earthwork design)
// Past the shoulder, a graded, recoverable roadside before any structural slope (FHWA/AASHTO
// Roadside Design Guide: foreslopes of 1:4 or flatter are "recoverable": a driver who runs off can
// stop and drive back). For APRON m past the shoulder the ground is graded, not natural: a smooth
// ramp from the shoulder to the natural ground at the apron's outer edge, never steeper than 1:4
// (the hinge rounded over ROUND m, as graders round it). Past the apron, the natural ground is held
// within the structural slopes, which steepen in over another ROUND m. Without it the car could not
// get back on from the grass: natural mountainside (30°+) and the 1:1.5 fill (34°) ran right up to
// the shoulder, and a rear-driven 2.4 t car on grass (μ ≈ 0.56, ≈ 60 % of its weight on the driven
// axle) climbs about 18°; the 1:1 cut tipped it over its nose on the way down, and the sharp hinge
// high-centred it on a 10 cm ride height.
const APRON_SLOPE = 0.25, APRON = 7, ROUND = 2.5;
const EXACT = APRON + ROUND + 2;   // m past the shoulder where the exact earthwork has handed over to the grid
const CELL = 8;                  // segment grid cell (m)
const FINE = 4, TILE = 16;       // conformed terrain: 4 m posts, 16×16 cells (64 m) per tile
const CONFORM_REACH = 40;        // m beyond the edge where a road still shapes the ground
const BELOW = 50;                // how deep the road counts as solid where the ground is under it

// Barriers: lateral offset of the face from the edge, thickness, height (m).
export const RAILS = {
  1: { id: 'steel', off: 0.45, t: 0.16, h: 0.75 },
  2: { id: 'stone', off: 0.3, t: 0.5, h: 0.62 },
  3: { id: 'tunnel', off: 0.6, t: 1.2, h: 6.2 },
};
const TUNNEL_ROOF = 5.4;         // m above the road

// ---- Parsing the asset ---------------------------------------------------------------------------
// Layout (little-endian): 'CGR1', u32 json length, json (padded to 4), then
//   f32 x[n], f32 z[n], f32 y[n], u8 halfWidth/0.05 [n], i8 bank·1000 [n], u8 flags[n] (pad 4)
//   u16 near[nx·nz] and u16 far[nx·nz]: decimetres above `base`, each row delta-coded (pad 4)
//   u8 trees[nx·nz]: tree cover 0–255 (pad 4)
// flags: bit 0 bridge · bit 1 tunnel · bits 2–3 left barrier · bits 4–5 right barrier
export function parseRoad(buf) {
  const u8 = new Uint8Array(buf);
  const magic = String.fromCharCode(u8[0], u8[1], u8[2], u8[3]);
  if (magic !== ROAD_MAGIC) throw new Error(`not a road asset (${magic})`);
  const dv = new DataView(buf);
  const jlen = dv.getUint32(4, true);
  const meta = JSON.parse(new TextDecoder().decode(u8.subarray(8, 8 + jlen)));
  let off = 8 + jlen;
  off += (4 - (off % 4)) % 4;
  const n = meta.n;
  const f32 = () => { const a = new Float32Array(buf.slice(off, off + 4 * n)); off += 4 * n; return Float64Array.from(a); };
  const x = f32(), z = f32(), y = f32();
  const hw = new Float64Array(n), bank = new Float64Array(n), flags = new Uint8Array(n);
  for (let i = 0; i < n; i++) hw[i] = u8[off + i] * 0.05;
  off += n;
  const i8 = new Int8Array(buf, off, n);
  for (let i = 0; i < n; i++) bank[i] = i8[i] / 1000;
  off += n;
  flags.set(u8.subarray(off, off + n));
  off += n;
  off += (4 - (off % 4)) % 4;
  const grid = (g) => {
    const cnt = g.nx * g.nz, d = new Uint16Array(buf.slice(off, off + 2 * cnt));
    off += 2 * cnt; off += (4 - (off % 4)) % 4;
    const h = new Float32Array(cnt);
    for (let j = 0; j < g.nz; j++) {
      let q = 0;
      for (let i = 0; i < g.nx; i++) { q = (q + d[j * g.nx + i]) & 0xffff; h[j * g.nx + i] = g.base + q * g.scale; }
    }
    return { ...g, h };
  };
  const near = grid(meta.near), far = grid(meta.far);
  const tcnt = meta.trees.nx * meta.trees.nz;
  const trees = { ...meta.trees, data: new Uint8Array(buf.slice(off, off + tcnt)) };
  return { meta, n, x, z, y, hw, bank, flags, near, far, trees };
}

// ---- Height fields ---------------------------------------------------------------------------------
// Bilinear height and slope of a grid at (x, z); `g.out` = [h, dh/dx, dh/dz].
function gridSample(g, x, z, out) {
  let fx = (x - g.x0) / g.cell, fz = (z - g.z0) / g.cell;
  if (fx < 0) fx = 0; else if (fx > g.nx - 1.000001) fx = g.nx - 1.000001;
  if (fz < 0) fz = 0; else if (fz > g.nz - 1.000001) fz = g.nz - 1.000001;
  const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j, k = j * g.nx + i;
  const a = g.h[k], b = g.h[k + 1], c = g.h[k + g.nx], d = g.h[k + g.nx + 1];
  out[0] = (a + (b - a) * u) * (1 - v) + (c + (d - c) * u) * v;
  out[1] = ((b - a) * (1 - v) + (d - c) * v) / g.cell;
  out[2] = ((c - a) * (1 - u) + (d - b) * u) / g.cell;
  return out;
}
const inGrid = (g, x, z) => x >= g.x0 && z >= g.z0 && x <= g.x0 + (g.nx - 1) * g.cell && z <= g.z0 + (g.nz - 1) * g.cell;

// ---- The road ------------------------------------------------------------------------------------
// buildRoad(parsed) → everything the queries need, precomputed once.
export function buildRoad(data) {
  const { n, x, z, y, hw, bank, flags } = data;
  const m = n - 1;                                 // segments
  const sx = new Float64Array(m), sz = new Float64Array(m), dx = new Float64Array(m), dz = new Float64Array(m), len = new Float64Array(m), grade = new Float64Array(m);
  let hwMax = 0, minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < m; i++) {
    const ex = x[i + 1] - x[i], ez = z[i + 1] - z[i], L = Math.sqrt(ex * ex + ez * ez) || 1e-6;
    sx[i] = x[i]; sz[i] = z[i]; dx[i] = ex / L; dz[i] = ez / L; len[i] = L; grade[i] = (y[i + 1] - y[i]) / L;
  }
  for (let i = 0; i < n; i++) {
    hwMax = Math.max(hwMax, hw[i]);
    minX = Math.min(minX, x[i]); maxX = Math.max(maxX, x[i]); minZ = Math.min(minZ, z[i]); maxZ = Math.max(maxZ, z[i]);
  }
  const reach = hwMax + SHOULDER + EXACT + 8;   // over the verge's earthwork, and any other leg near enough to matter there
  // Segment grid (CSR): every segment listed in each cell its reach overlaps.
  const gx0 = minX - reach - CELL, gz0 = minZ - reach - CELL;
  const gnx = Math.ceil((maxX - gx0 + reach + CELL) / CELL) + 1, gnz = Math.ceil((maxZ - gz0 + reach + CELL) / CELL) + 1;
  const counts = new Int32Array(gnx * gnz + 1);
  const each = (i, fn) => {
    const ax = Math.min(sx[i], x[i + 1]) - reach, bx = Math.max(sx[i], x[i + 1]) + reach;
    const az = Math.min(sz[i], z[i + 1]) - reach, bz = Math.max(sz[i], z[i + 1]) + reach;
    for (let cj = Math.floor((az - gz0) / CELL); cj <= Math.floor((bz - gz0) / CELL); cj++)
      for (let ci = Math.floor((ax - gx0) / CELL); ci <= Math.floor((bx - gx0) / CELL); ci++) fn(cj * gnx + ci);
  };
  for (let i = 0; i < m; i++) each(i, (c) => { counts[c + 1]++; });
  for (let c = 0; c < gnx * gnz; c++) counts[c + 1] += counts[c];
  const list = new Int32Array(counts[gnx * gnz]), fill = counts.slice(0, gnx * gnz);
  for (let i = 0; i < m; i++) each(i, (c) => { list[fill[c]++] = i; });
  // Vertex normals (left, in plan): the bisector of the two segments meeting there, so the
  // ribbon's cross-sections are continuous through every bend (see nearestSeg).
  const vnx = new Float64Array(n), vnz = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - 1), b = Math.min(m - 1, i);
    let ex = dz[a] + dz[b], ez = -dx[a] - dx[b];
    const l = Math.sqrt(ex * ex + ez * ez) || 1;
    ex /= l; ez /= l;
    vnx[i] = ex; vnz[i] = ez;
  }

  const road = {
    data, meta: data.meta, n, m, x, z, y, hw, bank, flags, sx, sz, dx, dz, len, grade, hwMax, reach, vnx, vnz,
    grid: { x0: gx0, z0: gz0, nx: gnx, nz: gnz, start: counts, list },
    bounds: { minX, maxX, minZ, maxZ },
    length: (n - 1) * data.meta.spacing,
    conform: null,
  };
  road.conform = buildConform(road);
  return road;
}

// The nearest segment to (x, y, z), into `q`: seg, t (along), lat (+ left), yc (centreline
// height there), hw, bank. Vertically stacked legs (a hairpin under a hairpin) are told apart
// by height. Returns false when no segment is within reach.
// A map key for grid cell (i, j), exact for |i|, |j| < 2²⁰.
export const cellKey = (i, j) => (j + 1048576) * 2097152 + (i + 1048576);
const q0 = { seg: -1, t: 0, lat: 0, yc: 0, hw: 0, bank: 0, u: 0, other: Infinity };
export function nearestSeg(road, x, y, z, q = q0) {
  const g = road.grid;
  q.seg = -1;
  let list, a, b;
  if (g.cells) {
    // An open-ended road (src/sim/endless.js): cells in a map, each its own list.
    list = g.cells.get(cellKey(Math.floor(x / g.cell), Math.floor(z / g.cell)));
    if (!list) return false;
    a = 0; b = list.length;
  } else {
    const ci = Math.floor((x - g.x0) / CELL), cj = Math.floor((z - g.z0) / CELL);
    if (ci < 0 || cj < 0 || ci >= g.nx || cj >= g.nz) return false;
    const c = cj * g.nx + ci;
    list = g.list; a = g.start[c]; b = g.start[c + 1];
  }
  const R2 = road.reach * road.reach;
  let best = Infinity;
  for (let k = a; k < b; k++) {
    const i = list[k];
    const px = x - road.sx[i], pz = z - road.sz[i];
    let t = px * road.dx[i] + pz * road.dz[i];
    if (t < 0) t = 0; else if (t > road.len[i]) t = road.len[i];
    const ex = px - road.dx[i] * t, ez = pz - road.dz[i] * t, d2 = ex * ex + ez * ez;
    if (d2 > R2) continue;
    const yc = road.y[i] + road.grade[i] * t;
    const dv = y - yc < 0 ? yc - y : y - yc;
    const score = dv > 6 ? d2 + (dv - 6) * (dv - 6) * 4 : d2;
    if (score < best) {
      best = score;
      q.seg = i; q.t = t; q.yc = yc;
      const side = px * road.dz[i] - pz * road.dx[i];        // left = (dz, −dx)
      q.lat = side < 0 ? -Math.sqrt(d2) : Math.sqrt(d2);
    }
  }
  if (q.seg < 0) return false;
  // The nearest other leg (a segment more than 30 m along the road from this one): where two legs
  // are close (a hairpin, stacked switchbacks) the ground between them is the grid's blend of both.
  q.other = Infinity;
  for (let k = a; k < b; k++) {
    const i = list[k], di = i - q.seg;
    if (di < 10 && di > -10) continue;
    const px = x - road.sx[i], pz = z - road.sz[i];
    let t = px * road.dx[i] + pz * road.dz[i];
    if (t < 0) t = 0; else if (t > road.len[i]) t = road.len[i];
    const ex = px - road.dx[i] * t, ez = pz - road.dz[i] * t, d2 = ex * ex + ez * ez;
    if (d2 < q.other) q.other = d2;
  }
  q.other = q.other === Infinity ? Infinity : Math.sqrt(q.other);
  // Continuous coordinates through the bends: the point lies on the line from P(u) along the
  // blended vertex normal N(u) (P and N interpolated along the segment). Projecting onto the
  // segment alone makes the station jump on the inside of a bend, and with grade and banking
  // that's a step under a wheel. Solve (q − P(u)) × N(u) = 0 for u (a quadratic), stepping to
  // the neighbouring segment if u leaves [0, 1].
  let i = q.seg, u = q.t / road.len[i];
  for (let hop = 0; hop < 2; hop++) {
    const ax = road.x[i], az = road.z[i], Dx = road.x[i + 1] - ax, Dz = road.z[i + 1] - az;
    const n0x = road.vnx[i], n0z = road.vnz[i], dnx = road.vnx[i + 1] - n0x, dnz = road.vnz[i + 1] - n0z;
    const rx = x - ax, rz = z - az;
    const a = -(Dx * dnz - Dz * dnx), b = (rx * dnz - rz * dnx) - (Dx * n0z - Dz * n0x), c = rx * n0z - rz * n0x;
    let w;
    if (a > -1e-9 && a < 1e-9) w = b !== 0 ? -c / b : u;
    else {
      const disc = b * b - 4 * a * c;
      if (disc < 0) w = u;
      else {
        const sq = Math.sqrt(disc), w1 = (-b + sq) / (2 * a), w2 = (-b - sq) / (2 * a);
        w = (w1 - u < 0 ? u - w1 : w1 - u) < (w2 - u < 0 ? u - w2 : w2 - u) ? w1 : w2;
      }
    }
    if (w < 0 && i > 0 && hop === 0) { i--; u = 1; continue; }
    if (w > 1 && i < road.m - 1 && hop === 0) { i++; u = 0; continue; }
    u = w < 0 ? 0 : w > 1 ? 1 : w;
    const px = ax + Dx * u, pz = az + Dz * u, Nx = n0x + dnx * u, Nz = n0z + dnz * u;
    const Nl = Math.sqrt(Nx * Nx + Nz * Nz) || 1;
    q.lat = ((x - px) * Nx + (z - pz) * Nz) / Nl;
    break;
  }
  q.seg = i; q.t = u * road.len[i];
  q.yc = road.y[i] + road.grade[i] * q.t;
  q.u = u;
  q.hw = road.hw[i] + (road.hw[i + 1] - road.hw[i]) * u;
  q.bank = road.bank[i] + (road.bank[i + 1] - road.bank[i]) * u;
  return true;
}

// The ground right beside the road (under the ribbon, the shoulders and up to the fill/cut
// slopes) as the conformed terrain builds it: height at lateral offset `lat` given the
// centreline height and banking (a shoulder falls 5 % away from the edge).
function shoulderHeight(yc, bank, hw, lat) {
  const al = lat < 0 ? -lat : lat;
  const edge = lat < 0 ? -hw : hw;
  if (al <= hw) return yc + bank * lat - 0.04;
  return yc + bank * edge - 0.04 - 0.05 * (al - hw);
}

// The earthwork's rise (cut) or drop (fill) `run` m past the shoulder, toward a structural slope
// `steep`, and its gradient there (into ew[0], ew[1]): slope 0 → APRON_SLOPE over ROUND m, held to
// APRON, then → steep over ROUND m, held beyond. Piecewise-quadratic, C¹, + − × ÷ only.
const ew = [0, 0];
export function earthwork(run, steep, out = ew) {
  const a = APRON_SLOPE, r = ROUND;
  if (run <= 0) { out[0] = 0; out[1] = 0; return out; }
  if (run < r) { out[0] = (a * run * run) / (2 * r); out[1] = (a * run) / r; return out; }
  const d1 = (a * r) / 2;
  if (run < APRON) { out[0] = d1 + a * (run - r); out[1] = a; return out; }
  const d2 = d1 + a * (APRON - r), u = run - APRON;
  if (u < r) { out[0] = d2 + a * u + ((steep - a) * u * u) / (2 * r); out[1] = a + ((steep - a) * u) / r; return out; }
  out[0] = d2 + a * r + ((steep - a) * r) / 2 + steep * (u - r); out[1] = steep;
  return out;
}

// The graded apron's full rise or drop (m) at its outer edge, and the roadside's height `run` m past
// the shoulder: out = [height, lateral slope rising away from the road, 1 if the earthwork set it
// (0: the natural ground stands)]. (fx, fz) is the shoulder's foot on the centreline, (px, pz) the
// unit direction away from the road on this side, hNat the natural (or conformed) ground there.
const APRON_RISE = earthwork(APRON, APRON_SLOPE)[0];
const rs = [0, 0, 0], rs2 = [0, 0];
function roadside(road, yEdge, hw, run, fx, fz, px, pz, hNat, out = rs) {
  if (run <= APRON) {
    const o = hw + SHOULDER + APRON;
    let d = naturalAt(road, fx + px * o, fz + pz * o) - yEdge;
    if (d > APRON_RISE) d = APRON_RISE; else if (d < -APRON_RISE) d = -APRON_RISE;
    earthwork(run, APRON_SLOPE, rs2);
    out[0] = yEdge + (d * rs2[0]) / APRON_RISE; out[1] = (d * rs2[1]) / APRON_RISE; out[2] = 1;
    return out;
  }
  earthwork(run, FILL, rs2);
  const lo = yEdge - rs2[0], sLo = rs2[1];
  earthwork(run, CUT, rs2);
  const hi = yEdge + rs2[0], sHi = rs2[1];
  if (hNat < lo) { out[0] = lo; out[1] = -sLo; out[2] = 1; }
  else if (hNat > hi) { out[0] = hi; out[1] = sHi; out[2] = 1; }
  else { out[0] = hNat; out[1] = 0; out[2] = 0; }
  return out;
}
const s3r = [0, 0, 0];

// Conformed terrain on 4 m posts in 64 m tiles around the road (tiles only where a road is near).
function buildConform(road) {
  const { bounds, data } = road;
  const span = FINE * TILE, pad = CONFORM_REACH + road.hwMax + span;
  const x0 = Math.floor((bounds.minX - pad) / span) * span, z0 = Math.floor((bounds.minZ - pad) / span) * span;
  const tw = Math.ceil((bounds.maxX + pad - x0) / span), th = Math.ceil((bounds.maxZ + pad - z0) / span);
  const tiles = new Int32Array(tw * th).fill(-1);
  // Which tiles a road touches (within the conform reach).
  const near = CONFORM_REACH + road.hwMax;
  let count = 0;
  for (let i = 0; i < road.n; i++) {
    for (let a = Math.floor((road.x[i] - near - x0) / span); a <= Math.floor((road.x[i] + near - x0) / span); a++)
      for (let b = Math.floor((road.z[i] - near - z0) / span); b <= Math.floor((road.z[i] + near - z0) / span); b++)
        if (a >= 0 && b >= 0 && a < tw && b < th && tiles[b * tw + a] < 0) tiles[b * tw + a] = count++;
  }
  const P = TILE + 1;
  const h = new Float32Array(count * P * P);
  // A coarse grid of segments for the wider conform reach.
  const C2 = 32, cx0 = x0, cz0 = z0, cnx = Math.ceil((tw * span) / C2) + 1, cnz = Math.ceil((th * span) / C2) + 1;
  const buckets = Array.from({ length: cnx * cnz }, () => []);
  for (let i = 0; i < road.m; i++) {
    if (road.flags[i] & 3) continue;              // bridges and tunnels don't shape the ground
    const r = near;
    const ax = Math.min(road.x[i], road.x[i + 1]) - r, bx = Math.max(road.x[i], road.x[i + 1]) + r;
    const az = Math.min(road.z[i], road.z[i + 1]) - r, bz = Math.max(road.z[i], road.z[i + 1]) + r;
    for (let cj = Math.max(0, Math.floor((az - cz0) / C2)); cj <= Math.min(cnz - 1, Math.floor((bz - cz0) / C2)); cj++)
      for (let ci = Math.max(0, Math.floor((ax - cx0) / C2)); ci <= Math.min(cnx - 1, Math.floor((bx - cx0) / C2)); ci++) buckets[cj * cnx + ci].push(i);
  }
  const s3 = [0, 0, 0];
  const cand = [];
  for (let b = 0; b < th; b++) for (let a = 0; a < tw; a++) {
    const t = tiles[b * tw + a];
    if (t < 0) continue;
    for (let j = 0; j < P; j++) for (let i = 0; i < P; i++) {
      const px = x0 + a * span + i * FINE, pz = z0 + b * span + j * FINE;
      let hgt = demAt(data, px, pz, s3);
      const bucket = buckets[Math.min(cnz - 1, Math.floor((pz - cz0) / C2)) * cnx + Math.min(cnx - 1, Math.floor((px - cx0) / C2))];
      // Every segment within reach constrains the ground; nearest last, so it wins.
      cand.length = 0;
      for (const k of bucket) {
        const ex = px - road.sx[k], ez = pz - road.sz[k];
        let tt = ex * road.dx[k] + ez * road.dz[k];
        if (tt < 0) tt = 0; else if (tt > road.len[k]) tt = road.len[k];
        const fx = ex - road.dx[k] * tt, fz = ez - road.dz[k] * tt, d = Math.sqrt(fx * fx + fz * fz);
        const u = tt / road.len[k], hwk = road.hw[k] + (road.hw[k + 1] - road.hw[k]) * u;
        if (d > hwk + CONFORM_REACH) continue;
        cand.push(d, k, tt, ex * road.dz[k] - ez * road.dx[k] < 0 ? -d : d, hwk);
      }
      // Sort candidates by distance, descending (insertion sort on 5-tuples; few of them).
      for (let p = 5; p < cand.length; p += 5) {
        for (let r = p; r > 0 && cand[r - 5] < cand[r]; r -= 5) for (let w = 0; w < 5; w++) { const tmp = cand[r - 5 + w]; cand[r - 5 + w] = cand[r + w]; cand[r + w] = tmp; }
      }
      // Past every apron, the natural ground held within each road's structural slopes (farthest
      // first, so the nearest constrains last). Within a road's apron the ground is graded: where
      // two legs' aprons meet (a hairpin's inside, stacked switchbacks) their grades are blended by
      // inverse distance⁴, so the ground runs smoothly from one to the other instead of stepping.
      let wSum = 0, hSum = 0;
      for (let p = 0; p < cand.length; p += 5) {
        const d = cand[p], k = cand[p + 1], tt = cand[p + 2], lat = cand[p + 3], hwk = cand[p + 4];
        const u = tt / road.len[k], yc = road.y[k] + road.grade[k] * tt, bk = road.bank[k] + (road.bank[k + 1] - road.bank[k]) * u;
        const e = d - hwk;
        let hk;
        if (e <= SHOULDER) hk = shoulderHeight(yc, bk, hwk, lat);
        else {
          const sd = lat < 0 ? -1 : 1;
          const yEdge = shoulderHeight(yc, bk, hwk, sd * (hwk + SHOULDER));
          const nbx = road.vnx[k] + (road.vnx[k + 1] - road.vnx[k]) * u, nbz = road.vnz[k] + (road.vnz[k + 1] - road.vnz[k]) * u;
          const nl = sd / (Math.sqrt(nbx * nbx + nbz * nbz) || 1);
          roadside(road, yEdge, hwk, e - SHOULDER, road.sx[k] + road.dx[k] * tt, road.sz[k] + road.dz[k] * tt, nbx * nl, nbz * nl, hgt);
          if (e - SHOULDER > APRON) { hgt = rs[0]; continue; }
          hk = rs[0];
        }
        const r = (e > 0 ? e : 0) + 1, w = 1 / (r * r * r * r);
        wSum += w; hSum += w * hk;
      }
      if (wSum > 0) hgt = hSum / wSum;
      h[t * P * P + j * P + i] = hgt;
    }
  }
  return { x0, z0, tw, th, span, tiles, h, P };
}

// DEM: the near grid where it has data, the far grid beyond.
function demAt(data, x, z, out) {
  return gridSample(inGrid(data.near, x, z) ? data.near : data.far, x, z, out)[0];
}
// The natural ground's height: the baked DEM, or a road's own ground function (`road.dem(x, z,
// out)` → [h, dh/dx, dh/dz], src/sim/endless.js).
const naturalAt = (road, x, z) => (road.dem ? road.dem(x, z, s3r)[0] : demAt(road.data, x, z, s3r));

// Terrain height and slope at (x, z): conformed near the road, DEM elsewhere. out = [h, dhdx, dhdz].
export function terrainAt(road, x, z, out) {
  if (road.dem) return road.dem(x, z, out);
  const c = road.conform;
  const fa = (x - c.x0) / c.span, fb = (z - c.z0) / c.span;
  const a = Math.floor(fa), b = Math.floor(fb);
  if (a >= 0 && b >= 0 && a < c.tw && b < c.th) {
    const t = c.tiles[b * c.tw + a];
    if (t >= 0) {
      const lx = (fa - a) * TILE, lz = (fb - b) * TILE;
      let i = Math.floor(lx), j = Math.floor(lz);
      if (i > TILE - 1) i = TILE - 1;
      if (j > TILE - 1) j = TILE - 1;
      const u = lx - i, v = lz - j, P = c.P, k = t * P * P + j * P + i;
      const h00 = c.h[k], h10 = c.h[k + 1], h01 = c.h[k + P], h11 = c.h[k + P + 1];
      out[0] = (h00 + (h10 - h00) * u) * (1 - v) + (h01 + (h11 - h01) * u) * v;
      out[1] = ((h10 - h00) * (1 - v) + (h11 - h01) * v) / FINE;
      out[2] = ((h01 - h00) * (1 - u) + (h11 - h10) * u) / FINE;
      return out;
    }
  }
  return gridSample(inGrid(road.data.near, x, z) ? road.data.near : road.data.far, x, z, out);
}

// ---- The query ---------------------------------------------------------------------------------
const tq = [0, 0, 0];
const qs = { seg: -1, t: 0, lat: 0, yc: 0, hw: 0, bank: 0, u: 0, other: Infinity };
// The ground (not the ribbon): the natural terrain, or the conformed grid, with the exact
// earthwork right beside the road. Reads the nearest-segment query already in `qs`.
function groundWith(road, x, z, on, fl, al, out) {
  terrainAt(road, x, z, out);
  // Right beside the road the ground is the earthwork itself, exactly: the 4 m grid can't hold
  // the crease at the shoulder's edge, and a wheel rolling off the shoulder must not meet a step.
  // It hands over to the grid (which also blends neighbouring legs) over the last 2 m of EXACT.
  const run = al - qs.hw - SHOULDER, exact = road.exact || EXACT;
  if (on && !(fl & 3) && run > 0 && run < exact) {
    const side = qs.lat < 0 ? -1 : 1, i0 = qs.seg;
    const yEdge = shoulderHeight(qs.yc, qs.bank, qs.hw, side * (qs.hw + SHOULDER));
    const px = road.dz[i0] * side, pz = -road.dx[i0] * side;
    // The apron's outer edge along the blended normal (continuous through bends, as `lat` is).
    const u = qs.u, nbx = road.vnx[i0] + (road.vnx[i0 + 1] - road.vnx[i0]) * u, nbz = road.vnz[i0] + (road.vnz[i0 + 1] - road.vnz[i0]) * u;
    const nl = side / (Math.sqrt(nbx * nbx + nbz * nbz) || 1);
    roadside(road, yEdge, qs.hw, run, road.x[i0] + (road.x[i0 + 1] - road.x[i0]) * u, road.z[i0] + (road.z[i0 + 1] - road.z[i0]) * u, nbx * nl, nbz * nl, out[0]);
    // The earthwork's slope points across the road, and it climbs with the road's grade along it.
    const g = road.grade[i0], hx = rs[1] * px + g * road.dx[i0], hz = rs[1] * pz + g * road.dz[i0];
    // Hand over at the end of EXACT, and wherever another leg is about as near as this one.
    let f = run <= exact - 2 ? 0 : (run - (exact - 2)) / 2;
    const gap = qs.other - al;
    if (gap < 6) { const f2 = gap <= 2 ? 1 : (6 - gap) / 4; if (f2 > f) f = f2; }
    // …and near a bridge's or a tunnel's end, where the grid carries the natural ground.
    for (let d = 1; d <= 5 && f < 1; d++) {
      // Samples from here to the structure (continuous along the road).
      let dist = 99;
      if (i0 + d < road.m && road.flags[i0 + d] & 3) dist = d - u;
      if (i0 - d >= 0 && road.flags[i0 - d] & 3 && u + d - 1 < dist) dist = u + d - 1;
      if (dist < 4) { const f3 = 1 - dist / 4; if (f3 > f) f = f3; }
    }
    const k = f * f * (3 - 2 * f);
    out[0] = rs[0] + (out[0] - rs[0]) * k; out[1] = hx + (out[1] - hx) * k; out[2] = hz + (out[2] - hz) * k;
  }
  return out;
}

// Height and slope of the ground at (x, z) as the car feels it, [h, dh/dx, dh/dz] (the renderer
// builds terrain meshes from this; y picks the leg where roads are stacked).
export function groundAt(road, x, y, z, out) {
  const on = nearestSeg(road, x, y, z, qs);
  return groundWith(road, x, z, on, on ? road.flags[qs.seg] : 0, qs.lat < 0 ? -qs.lat : qs.lat, out);
}

// Signed distance from (x, y, z) to the road world; out gets the normal {x, y, z}, `mat`, and
// `obstacle` (true for barriers, so the crash code treats a wall as a wall).
export function roadSurface(road, x, y, z, out) {
  let phi = Infinity, nx = 0, ny = 1, nz = 0, mat = MATERIALS.grass;
  out.obstacle = false; out.body = null;
  const on = nearestSeg(road, x, y, z, qs);
  const i = qs.seg;
  const fl = on ? road.flags[i] : 0;
  const tunnel = (fl & 2) !== 0, bridge = (fl & 1) !== 0;
  const al = qs.lat < 0 ? -qs.lat : qs.lat;
  let skipTerrain = false;
  if (on) {
    const ddx = road.dx[i], ddz = road.dz[i], lx = ddz, lz = -ddx;
    const g = road.grade[i], bk = qs.bank;
    // Surface slope in world xz: grade along the road, banking across it.
    const gx = g * ddx + bk * lx, gz = g * ddz + bk * lz;
    const k = 1 / Math.sqrt(1 + gx * gx + gz * gz);
    if (al <= qs.hw + (bridge ? 0.6 : SHOULDER)) {
      // On the ribbon (and the shoulders, which are the same plane falling 5 % away).
      const yr = shoulderHeight(qs.yc, bk, qs.hw, qs.lat) + 0.04;
      const deck = bridge ? 1.4 : BELOW;
      if (y >= yr - deck) {
        phi = (y - yr) * k; nx = -gx * k; ny = k; nz = -gz * k;
      } else {
        phi = yr - deck - y; nx = 0; ny = -1; nz = 0;          // under a bridge deck
      }
      mat = al <= qs.hw ? MATERIALS.asphalt : MATERIALS.gravel;
      // The ribbon is the ground here (on a bridge, the deck: the ground near its abutments,
      // shaped by the approaches, mustn't come up through it).
      skipTerrain = bridge ? y > yr - deck - 0.3 : phi > -0.5 && y > yr - 3;
    }
    if (tunnel && al < qs.hw + 3) {
      skipTerrain = true;
      const roof = qs.yc + TUNNEL_ROOF - y;                      // the roof, from below
      if (roof < phi) { phi = roof; nx = 0; ny = -1; nz = 0; mat = MATERIALS.barrier; }
    }
    // Barriers on either side: a box in the road's cross-section (lateral × height), from a
    // metre below the edge to its top, along this segment.
    const side = qs.lat < 0 ? (fl >> 4) & 3 : (fl >> 2) & 3;
    if (side) {
      const r = RAILS[side];
      const c = qs.hw + r.off + r.t / 2;
      const base = qs.yc + bk * (qs.lat < 0 ? -c : c);
      const qa = (al - c < 0 ? c - al : al - c) - r.t / 2;
      const ym = base + (r.h - 1) / 2, qy = (y - ym < 0 ? ym - y : y - ym) - (r.h + 1) / 2;
      let d, wl, wy;
      if (qa > 0 || qy > 0) {
        const ax = qa > 0 ? qa : 0, ay = qy > 0 ? qy : 0;
        d = Math.sqrt(ax * ax + ay * ay);
        wl = ax / d; wy = ay / d;
      } else if (qa > qy) { d = qa; wl = 1; wy = 0; } else { d = qy; wl = 0; wy = 1; }
      if (d < phi) {
        // Lateral direction away from the barrier's centre line, in world terms.
        const sgn = (al > c ? 1 : -1) * (qs.lat < 0 ? -1 : 1);
        const sy = y > ym ? 1 : -1;
        phi = d; nx = lx * sgn * wl; nz = lz * sgn * wl; ny = sy * wy;
        mat = MATERIALS.barrier; out.obstacle = true;
      }
    }
  }
  if (!skipTerrain) {
    groundWith(road, x, z, on, fl, al, tq);
    const hx = tq[1], hz = tq[2], k = 1 / Math.sqrt(1 + hx * hx + hz * hz);
    const pt = (y - tq[0]) * k;
    if (pt < phi) {
      phi = pt; nx = -hx * k; ny = k; nz = -hz * k;
      out.obstacle = false;
      mat = on && al <= qs.hw + SHOULDER + 0.6 ? MATERIALS.gravel : road.matAt ? road.matAt(x, z, ny) : ny < 0.8 ? MATERIALS.rock : MATERIALS.grass;
    }
  }
  out.x = nx; out.y = ny; out.z = nz; out.mat = mat;
  return phi;
}

// A course object the vehicle drives like any other (src/sim/courses.js `surface` defers to
// `course.sdf`). No parked bodies; the start is on the right-hand lane at `s` metres.
export function createRoadCourse(road, { name = road.meta.id } = {}) {
  const course = {
    id: `road:${road.meta.id}`, name, road, boxes: [],
    start: { x: road.x[0], z: road.z[0] },
    runout: { zMin: -Infinity, zMax: Infinity },
    sdf: (x, y, z, out) => roadSurface(road, x, y, z, out),
  };
  return course;
}

const qp = { seg: -1, t: 0, lat: 0, yc: 0, hw: 0, bank: 0, u: 0, other: Infinity };
// A pose on the road at distance s (m), in the right-hand lane, facing along the road
// (dir = +1) or back down it (−1): { x, y, z, yaw } with yaw about +y (the car's +z forward).
export function poseAt(road, s, dir = 1, out = { x: 0, y: 0, z: 0, yaw: 0, i: 0 }) {
  const sp = road.meta.spacing;
  let i = Math.floor(s / sp);
  if (i < 0) i = 0; else if (i > road.m - 1) i = road.m - 1;
  const u = Math.min(1, Math.max(0, s / sp - i));
  const tx = road.dx[i] * dir, tz = road.dz[i] * dir;
  const hw = road.hw[i] + (road.hw[i + 1] - road.hw[i]) * u;
  const lat = -Math.min(1.9, hw * 0.48) * dir;          // right-hand lane: right is −left
  const cx = road.x[i] + (road.x[i + 1] - road.x[i]) * u, cz = road.z[i] + (road.z[i + 1] - road.z[i]) * u;
  out.x = cx + road.dz[i] * lat; out.z = cz - road.dx[i] * lat;
  out.y = road.y[i] + (road.y[i + 1] - road.y[i]) * u + road.bank[i] * lat;
  // The ribbon's own height there (through a bend the lane's station isn't the centreline's).
  if (nearestSeg(road, out.x, out.y + 0.5, out.z, qp)) out.y = qp.yc + qp.bank * qp.lat;
  out.yaw = yawOf(tx, tz);
  out.i = i;
  return out;
}

// Heading of a unit (x, z) direction as a yaw about +y, with the dmath arctangent.
export const yawOf = (tx, tz) => datan2(tx, tz);

// The sample nearest (x, z), searching ±window around a hint (−1: the whole road).
export function nearestSample(road, x, z, hint = -1, window = 60) {
  let a = 0, b = road.n - 1;
  if (hint >= 0) { a = Math.max(0, hint - window); b = Math.min(road.n - 1, hint + window); }
  let best = -1, bd = Infinity;
  for (let i = a; i <= b; i++) {
    const ex = road.x[i] - x, ez = road.z[i] - z, d = ex * ex + ez * ez;
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}
