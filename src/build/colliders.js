// BUILD: collider shapes, as signed distance fields, plus the meshes drawn from the same numbers.
//
// The physics asks one question of the world (src/sim/courses.js `surface()`): the signed
// distance from a point to the nearest solid, its outward normal and its material. Every piece
// answers it here in its own local frame (src/build/catalogue.js: origin at the footprint's centre
// on the ground, +z forward, +y up, +x the driver's left), so a kicker is exactly the curve you see
// and a loop is exactly the ring you drive round. Pure: no three.js, no DOM, no allocation per call.
//
// This file is the thin collision adapter. Today the sim is an SDF sim, so `shapeSdf` is all it
// needs. When the sim moves to a rigid-body engine (Rapier-class), `shapeMesh` already gives every
// piece as a triangle mesh (and `profileOf` as an extruded convex-decomposable profile): map those
// to the engine's trimesh / convex colliders in one new adapter, and nothing above it changes.
import { SKIRT, PIECES } from './catalogue.js';
import { datan2 } from '../sim/dmath.js';

const TAU = Math.PI * 2;

// --- Profiles: the solid as a 2D region extruded across the third axis ----------------------------
// A profile is the graph of the riding surface, y = top(u), over u ∈ [u0, u1], filled down to the
// skirt. axis 'x': the profile is in (z, y) and extrudes across x (ramps); axis 'z': in (x, y),
// extruding along z (the half-pipe).
const ARC = 14;
const profiles = new Map();
export function profileOf(kind) {
  if (profiles.has(kind)) return profiles.get(kind);
  const P = PIECES[Object.keys(PIECES).find((k) => PIECES[k].shape.kind === kind)]?.shape;
  let top = [], axis = 'x', half = 0;
  if (kind === 'kicker' || kind === 'wedge') {
    const { len: L, h, w } = P;
    for (let i = 0; i <= ARC; i++) { const t = i / ARC; top.push(-L / 2 + t * L, kind === 'kicker' ? h * t * t : h * t); }
    half = w / 2;
  } else if (kind === 'quarter') {
    const { r, deck, w } = P, z0 = -(r + deck) / 2;
    // Bowl: centre (z0, r); from the foot (z0, 0) round to vertical at (z0 + r, r).
    for (let i = 0; i <= ARC; i++) { const b = (Math.PI / 2) * (1 - i / ARC); top.push(z0 + r * Math.cos(b), r - r * Math.sin(b)); }
    top.push(z0 + r + deck, r);
    half = w / 2;
  } else if (kind === 'halfpipe') {
    const { r, flat, deck, len } = P, b = flat / 2, X = b + r + deck;
    top.push(-X, r);
    for (let i = 0; i <= ARC; i++) { const g = (Math.PI / 2) * (i / ARC); top.push(-b - r * Math.cos(g), r - r * Math.sin(g)); }
    for (let i = 0; i <= ARC; i++) { const g = (Math.PI / 2) * (1 - i / ARC); top.push(b + r * Math.cos(g), r - r * Math.sin(g)); }
    top.push(X, r);
    axis = 'z'; half = len / 2;
  } else { profiles.set(kind, null); return null; }
  // Drop exact duplicates (arc ends meeting straight runs).
  const t2 = [];
  for (let i = 0; i < top.length; i += 2) if (!t2.length || Math.abs(t2[t2.length - 2] - top[i]) > 1e-9 || Math.abs(t2[t2.length - 1] - top[i + 1]) > 1e-9) t2.push(top[i], top[i + 1]);
  top = t2;
  // The closed polygon: along the top, down the far end, back along the skirt.
  const n = top.length / 2 + 2;
  const poly = new Float64Array(n * 2);
  poly.set(top);
  poly[n * 2 - 4] = top[top.length - 2]; poly[n * 2 - 3] = -SKIRT;
  poly[n * 2 - 2] = top[0]; poly[n * 2 - 1] = -SKIRT;
  const pr = { kind, axis, half, top: Float64Array.from(top), poly, n };
  profiles.set(kind, pr);
  return pr;
}

// Signed distance to a closed polygon (crossing-number sign), closest-point normal into n2.
// Exact for any simple polygon (after Inigo Quilez's sdPolygon).
const n2 = [0, 0];
function sdPoly(pr, px, py) {
  const v = pr.poly, n = pr.n;
  let d = Infinity, s = 1, bx = 0, by = 1;
  for (let i = 0, j = n - 1; i < n; j = i, i++) {
    const vix = v[2 * i], viy = v[2 * i + 1], ex = v[2 * j] - vix, ey = v[2 * j + 1] - viy;
    const wx = px - vix, wy = py - viy;
    const ee = ex * ex + ey * ey;
    let t = ee > 0 ? (wx * ex + wy * ey) / ee : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const qx = wx - ex * t, qy = wy - ey * t, dd = qx * qx + qy * qy;
    if (dd < d) {
      d = dd;
      if (dd > 1e-18) { bx = qx; by = qy; } else { bx = ey; by = -ex; }   // on the edge: its perpendicular
    }
    const c1 = py >= viy, c2 = py < v[2 * j + 1], c3 = ex * wy > ey * wx;
    if ((c1 && c2 && c3) || (!c1 && !c2 && !c3)) s = -s;
  }
  const dist = Math.sqrt(d), bl = Math.sqrt(bx * bx + by * by) || 1;
  n2[0] = (s * bx) / bl; n2[1] = (s * by) / bl;
  return s * dist;
}

// Combine a 2D field (d2, normal in its plane) with a lateral slab |a| ≤ half (an extrusion).
// Writes the local normal into nl = [x, y, z]; `axis` says which local axis is lateral.
function extrude(d2, nu, ny, a, half, axis, nl) {
  const dl = (a < 0 ? -a : a) - half, sg = a < 0 ? -1 : 1;
  let d, lu, ll, ly;
  if (d2 > 0 && dl > 0) { d = Math.sqrt(d2 * d2 + dl * dl); lu = (nu * d2) / d; ly = (ny * d2) / d; ll = (sg * dl) / d; }
  else if (d2 >= dl) { d = d2; lu = nu; ly = ny; ll = 0; }
  else { d = dl; lu = 0; ly = 0; ll = sg; }
  if (axis === 'x') { nl[0] = ll; nl[1] = ly; nl[2] = lu; } else { nl[0] = lu; nl[1] = ly; nl[2] = ll; }
  return d;
}

// The loop: a ring of radius r (riding on its inside) and thickness t, centre (0, r), lane width w,
// whose lane slides sideways by `shift` over the turn so the exit runs beside the entry (a real
// loop is a helix). Guide rails on both edges keep the car on the lane. φ = 0 at the foot,
// increasing forward and up: entry at φ = 0 heading +z, exit at φ = 2π heading +z, `shift` over.
export const loopShift = (sh) => sh.w + 0.9;
function loopSdf(sh, lx, ly, lz, nl) {
  const { r, w, t, rail } = sh, hw = w / 2, shift = loopShift(sh), RT = 0.15;
  const dz = lz, dy = ly - r, rr = Math.sqrt(dz * dz + dy * dy) || 1e-9;
  let phi = datan2(dz, -dy);
  if (phi < 0) phi += TAU;
  const xc = shift / 2 - (shift * phi) / TAU, xl = lx - xc;
  const ax = xl < 0 ? -xl : xl, sg = xl < 0 ? -1 : 1;
  const rz = dz / rr, ry = dy / rr;
  // The deck: radial band [r, r + t] across the lane and both rails.
  const din = r - rr, dout = rr - r - t;
  let d2 = din > dout ? din : dout, nu = din > dout ? -rz : rz, nv = din > dout ? -ry : ry;
  let dl = ax - hw - RT;
  let d, ex, ey, ez;
  if (d2 > 0 && dl > 0) { d = Math.sqrt(d2 * d2 + dl * dl); ez = (nu * d2) / d; ey = (nv * d2) / d; ex = (sg * dl) / d; }
  else if (d2 >= dl) { d = d2; ez = nu; ey = nv; ex = 0; }
  else { d = dl; ez = 0; ey = 0; ex = sg; }
  // The rails: radial band [r − rail, r], lateral band [hw, hw + RT].
  const ri = r - rail - rr, ro = rr - r;
  const dr2 = ri > ro ? ri : ro, ru = ri > ro ? -rz : rz, rv = ri > ro ? -ry : ry;
  const li = hw - ax, lo = ax - hw - RT;
  const drl = li > lo ? li : lo, ls = li > lo ? -sg : sg;
  let e, fx, fy, fz;
  if (dr2 > 0 && drl > 0) { e = Math.sqrt(dr2 * dr2 + drl * drl); fz = (ru * dr2) / e; fy = (rv * dr2) / e; fx = (ls * drl) / e; }
  else if (dr2 >= drl) { e = dr2; fz = ru; fy = rv; fx = 0; }
  else { e = drl; fz = 0; fy = 0; fx = ls; }
  if (e < d) { d = e; ex = fx; ey = fy; ez = fz; }
  nl[0] = ex; nl[1] = ey; nl[2] = ez;
  return d;
}

// A box from the skirt up to h: half extents (w/2, ·, d/2).
function boxSdf(hx, h, hz, lx, ly, lz, nl) {
  const cy = (h - SKIRT) / 2, hy = (h + SKIRT) / 2;
  const px = (lx < 0 ? -lx : lx) - hx, py = (ly - cy < 0 ? cy - ly : ly - cy) - hy, pz = (lz < 0 ? -lz : lz) - hz;
  const qx = px > 0 ? px : 0, qy = py > 0 ? py : 0, qz = pz > 0 ? pz : 0;
  const out = Math.sqrt(qx * qx + qy * qy + qz * qz);
  if (out > 0) {
    nl[0] = ((lx < 0 ? -1 : 1) * qx) / out; nl[1] = ((ly < cy ? -1 : 1) * qy) / out; nl[2] = ((lz < 0 ? -1 : 1) * qz) / out;
    return out;
  }
  // Inside: the nearest face (never the buried bottom).
  let d = px, k = 0;
  if (ly > cy && py > d) { d = py; k = 1; }
  if (pz > d) { d = pz; k = 2; }
  nl[0] = k === 0 ? (lx < 0 ? -1 : 1) : 0; nl[1] = k === 1 ? 1 : 0; nl[2] = k === 2 ? (lz < 0 ? -1 : 1) : 0;
  return d;
}

// Signed distance from a LOCAL point to a piece's solid at scale 1; the local normal into nl.
// Sensor pieces (rings, pads, crates) have no solid: +Infinity.
export function shapeSdf(sh, lx, ly, lz, nl) {
  switch (sh.kind) {
    case 'kicker': case 'wedge': case 'quarter': {
      const pr = profileOf(sh.kind);
      const d2 = sdPoly(pr, lz, ly);
      return extrude(d2, n2[0], n2[1], lx, pr.half, 'x', nl);
    }
    case 'halfpipe': {
      const pr = profileOf('halfpipe');
      const d2 = sdPoly(pr, lx, ly);
      return extrude(d2, n2[0], n2[1], lz, pr.half, 'z', nl);
    }
    case 'loop': return loopSdf(sh, lx, ly, lz, nl);
    case 'box': return boxSdf(sh.w / 2, sh.h, sh.d / 2, lx, ly, lz, nl);
    default: return Infinity;
  }
}

// The local bounding box of a piece at scale 1: [minX, minY, minZ, maxX, maxY, maxZ].
export function shapeBounds(sh, out = new Float64Array(6)) {
  let x = 0, y0 = -SKIRT, y1 = 0, z = 0;
  switch (sh.kind) {
    case 'kicker': case 'wedge': x = sh.w / 2; y1 = sh.h; z = sh.len / 2; break;
    case 'quarter': x = sh.w / 2; y1 = sh.r; z = (sh.r + sh.deck) / 2; break;
    case 'halfpipe': x = sh.flat / 2 + sh.r + sh.deck; y1 = sh.r; z = sh.len / 2; break;
    case 'loop': x = loopShift(sh) / 2 + sh.w / 2 + 0.2; y1 = 2 * sh.r + sh.t; z = sh.r + sh.t; break;
    case 'box': x = sh.w / 2; y1 = sh.h; z = sh.d / 2; break;
    case 'pad': x = sh.w / 2; y0 = 0; y1 = 0.06; z = sh.d / 2; break;
    case 'ring': x = sh.r + sh.tube; y0 = sh.lift - sh.r - sh.tube; y1 = sh.lift + sh.r + sh.tube; z = sh.tube + 0.3; break;
    case 'crate': x = sh.s / 2; y0 = 0; y1 = sh.s; z = sh.s / 2; break;
    default: break;
  }
  out[0] = -x; out[1] = y0; out[2] = -z; out[3] = x; out[4] = y1; out[5] = z;
  return out;
}

// --- Meshes from the same numbers (the renderer, and a future rigid-body adapter's trimesh) -------
// Returns { position: Float32Array, normal: Float32Array, index: Uint32Array } at scale 1, local
// frame, or null for shapes the renderer draws itself (ring, crate, pad).
export function shapeMesh(sh) {
  const pos = [], nor = [], idx = [];
  const vert = (x, y, z, nx, ny, nz) => { pos.push(x, y, z); nor.push(nx, ny, nz); return pos.length / 3 - 1; };
  const quad = (a, b, c, d) => idx.push(a, b, c, a, c, d);
  // A flat quad from four points with one normal (outward is (b−a)×(d−a)).
  const flat = (p) => {
    const ux = p[3] - p[0], uy = p[4] - p[1], uz = p[5] - p[2], vx = p[9] - p[0], vy = p[10] - p[1], vz = p[11] - p[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1; nx /= l; ny /= l; nz /= l;
    const a = vert(p[0], p[1], p[2], nx, ny, nz), b = vert(p[3], p[4], p[5], nx, ny, nz), c = vert(p[6], p[7], p[8], nx, ny, nz), d = vert(p[9], p[10], p[11], nx, ny, nz);
    quad(a, b, c, d);
  };
  if (sh.kind === 'box') {
    const hx = sh.w / 2, hz = sh.d / 2, y0 = -SKIRT, y1 = sh.h;
    flat([-hx, y1, -hz, -hx, y1, hz, hx, y1, hz, hx, y1, -hz]);        // top
    flat([-hx, y0, hz, hx, y0, hz, hx, y1, hz, -hx, y1, hz]);           // +z
    flat([hx, y0, -hz, -hx, y0, -hz, -hx, y1, -hz, hx, y1, -hz]);       // −z
    flat([hx, y0, hz, hx, y0, -hz, hx, y1, -hz, hx, y1, hz]);           // +x
    flat([-hx, y0, -hz, -hx, y0, hz, -hx, y1, hz, -hx, y1, -hz]);       // −x
  } else if (sh.kind === 'kicker' || sh.kind === 'wedge' || sh.kind === 'quarter' || sh.kind === 'halfpipe') {
    const pr = profileOf(sh.kind), T = pr.top, m = T.length / 2, H = pr.half;
    // Map (u, y, lateral) → local xyz.
    const P = (u, y, l) => (pr.axis === 'x' ? [l, y, u] : [u, y, l]);
    // Top: smooth normals from the profile's tangent.
    const rows = [];
    for (let i = 0; i < m; i++) {
      const a = Math.max(0, i - 1), b = Math.min(m - 1, i + 1);
      let tu = T[2 * b] - T[2 * a], ty = T[2 * b + 1] - T[2 * a + 1];
      const tl = Math.sqrt(tu * tu + ty * ty) || 1; tu /= tl; ty /= tl;
      const nu = -ty, ny = tu;   // left of the tangent: up for a rising graph
      const p0 = P(T[2 * i], T[2 * i + 1], -H), p1 = P(T[2 * i], T[2 * i + 1], H), nn = P(nu, ny, 0);
      rows.push([vert(...p0, ...nn), vert(...p1, ...nn)]);
    }
    for (let i = 0; i < m - 1; i++) {
      if (pr.axis === 'x') quad(rows[i][0], rows[i][1], rows[i + 1][1], rows[i + 1][0]);
      else quad(rows[i][0], rows[i + 1][0], rows[i + 1][1], rows[i][1]);
    }
    // Side caps (the profile itself), as strips down to the skirt.
    for (const side of [-1, 1]) {
      const nn = P(0, 0, side);
      for (let i = 0; i < m - 1; i++) {
        const a = vert(...P(T[2 * i], T[2 * i + 1], side * H), ...nn), b = vert(...P(T[2 * i + 2], T[2 * i + 3], side * H), ...nn);
        const c = vert(...P(T[2 * i + 2], -SKIRT, side * H), ...nn), d = vert(...P(T[2 * i], -SKIRT, side * H), ...nn);
        const flip = (pr.axis === 'x') === (side > 0);
        if (flip) quad(a, d, c, b); else quad(a, b, c, d);
      }
    }
    // Ends (u0 and u1), vertical.
    const u0 = T[0], y0 = T[1], u1 = T[2 * m - 2], y1 = T[2 * m - 1];
    const e0 = [...P(u0, -SKIRT, -H), ...P(u0, -SKIRT, H), ...P(u0, Math.max(y0, -SKIRT + 0.001), H), ...P(u0, Math.max(y0, -SKIRT + 0.001), -H)];
    const e1 = [...P(u1, -SKIRT, H), ...P(u1, -SKIRT, -H), ...P(u1, y1, -H), ...P(u1, y1, H)];
    if (pr.axis === 'x') { flat(e1); flat(e0); } else { flat(reorder(e1)); flat(reorder(e0)); }
  } else if (sh.kind === 'loop') {
    const { r, w, t, rail } = sh, hw = w / 2, shift = loopShift(sh), RT = 0.15, N = 72;
    const ring = (rad, x0, x1, inward) => {
      const rowsA = [];
      for (let i = 0; i <= N; i++) {
        const phi = (i / N) * TAU, xc = shift / 2 - (shift * phi) / TAU;
        const sz = Math.sin(phi), cy = -Math.cos(phi);
        const nz = inward ? -sz : sz, ny = inward ? -cy : cy;
        rowsA.push([vert(xc + x0, r + rad * cy, rad * sz, 0, ny, nz), vert(xc + x1, r + rad * cy, rad * sz, 0, ny, nz)]);
      }
      for (let i = 0; i < N; i++) { if (inward) quad(rowsA[i][0], rowsA[i][1], rowsA[i + 1][1], rowsA[i + 1][0]); else quad(rowsA[i][0], rowsA[i + 1][0], rowsA[i + 1][1], rowsA[i][1]); }
    };
    ring(r, -hw, hw, true);                        // the riding surface (between the rails)
    ring(r + t, -hw - RT, hw + RT, false);          // the outside
    ring(r - rail, -hw - RT, -hw, true);            // rail tops
    ring(r - rail, hw, hw + RT, true);
    // Rail faces and deck edges: radial strips at fixed lateral offsets.
    const wallStrip = (xo, r0, r1, nxs) => {
      const rowsB = [];
      for (let i = 0; i <= N; i++) {
        const phi = (i / N) * TAU, xc = shift / 2 - (shift * phi) / TAU, sz = Math.sin(phi), cy = -Math.cos(phi);
        rowsB.push([vert(xc + xo, r + r0 * cy, r0 * sz, nxs, 0, 0), vert(xc + xo, r + r1 * cy, r1 * sz, nxs, 0, 0)]);
      }
      for (let i = 0; i < N; i++) { if (nxs > 0) quad(rowsB[i][0], rowsB[i][1], rowsB[i + 1][1], rowsB[i + 1][0]); else quad(rowsB[i][0], rowsB[i + 1][0], rowsB[i + 1][1], rowsB[i][1]); }
    };
    wallStrip(-hw, r - rail, r, 1); wallStrip(hw, r - rail, r, -1);
    wallStrip(-hw - RT, r - rail, r + t, -1); wallStrip(hw + RT, r - rail, r + t, 1);
  } else return null;
  // Wind every triangle to agree with its normals (outward), whatever order it was built in.
  for (let i = 0; i < idx.length; i += 3) {
    const a = idx[i] * 3, b = idx[i + 1] * 3, c = idx[i + 2] * 3;
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
    const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
    const gx = uy * vz - uz * vy, gy = uz * vx - ux * vz, gz = ux * vy - uy * vx;
    if (gx * nor[a] + gy * nor[a + 1] + gz * nor[a + 2] < 0) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; }
  }
  return { position: Float32Array.from(pos), normal: Float32Array.from(nor), index: Uint32Array.from(idx) };
}
const reorder = (q) => [q[9], q[10], q[11], q[6], q[7], q[8], q[3], q[4], q[5], q[0], q[1], q[2]];
