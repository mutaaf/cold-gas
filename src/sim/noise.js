// Deterministic noise for the endless world (src/sim/endless.js). Pure like the rest of src/sim:
// integer hashing with Math.imul and shifts (exact everywhere), then +, −, ×, ÷ on doubles, so the
// same seed builds the same hills, bit for bit, in every engine, in the page and in its worker.
//
// Value noise with a quintic fade and analytic derivatives: every function writes [v, dv/dx, dv/dz]
// into `out`, so the physics gets the ground's true slope without finite differences.

// A 32-bit seed from any string (FNV-1a), or a number as is.
export function seedOf(s) {
  if (typeof s === 'number' && Number.isFinite(s)) return s >>> 0;
  const str = String(s ?? '');
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

// Hash of a seed and two integers → [0, 1).
export function hash2(seed, i, j) {
  let h = seed ^ Math.imul(i | 0, 0x27d4eb2d) ^ Math.imul(j | 0, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
// Hash of a seed and one integer → [0, 1).
export const hash1 = (seed, i) => hash2(seed, i, 0x5bd1e995);

// 2D value noise in [−1, 1] with its gradient.
export function vnoise(seed, x, z, out) {
  const i = Math.floor(x), j = Math.floor(z), fx = x - i, fz = z - j;
  const a = hash2(seed, i, j), b = hash2(seed, i + 1, j), c = hash2(seed, i, j + 1), d = hash2(seed, i + 1, j + 1);
  const ux = fx * fx * fx * (fx * (fx * 6 - 15) + 10), uz = fz * fz * fz * (fz * (fz * 6 - 15) + 10);
  const dux = 30 * fx * fx * (fx - 1) * (fx - 1), duz = 30 * fz * fz * (fz - 1) * (fz - 1);
  const k1 = b - a, k2 = c - a, k3 = a - b - c + d;
  out[0] = 2 * (a + k1 * ux + k2 * uz + k3 * ux * uz) - 1;
  out[1] = 2 * dux * (k1 + k3 * uz);
  out[2] = 2 * duz * (k2 + k3 * ux);
  return out;
}

// 1D value noise in [−1, 1] along t (a road's arc length), with its derivative.
export function vnoise1(seed, t, out) {
  const i = Math.floor(t), f = t - i;
  const a = hash1(seed, i), b = hash1(seed, i + 1);
  const u = f * f * f * (f * (f * 6 - 15) + 10), du = 30 * f * f * (f - 1) * (f - 1);
  out[0] = 2 * (a + (b - a) * u) - 1;
  out[1] = 2 * (b - a) * du;
  return out;
}

const n3 = [0, 0, 0];
// Fractal sum of `oct` octaves at wavelength `wl` (m), each octave half the wavelength and `gain`
// of the amplitude; normalised to about [−1, 1].
export function fbm(seed, x, z, wl, oct, gain, out) {
  let f = 1 / wl, amp = 1, sum = 0, gx = 0, gz = 0, norm = 0;
  for (let o = 0; o < oct; o++) {
    vnoise(seed + o * 1013, x * f + o * 17.31, z * f - o * 9.73, n3);
    sum += amp * n3[0]; gx += amp * n3[1] * f; gz += amp * n3[2] * f;
    norm += amp; amp *= gain; f *= 2.03;
  }
  out[0] = sum / norm; out[1] = gx / norm; out[2] = gz / norm;
  return out;
}

// Ridged fractal: sharp crests where the noise crosses zero (mountain ranges), in [0, 1].
export function ridged(seed, x, z, wl, oct, gain, out) {
  let f = 1 / wl, amp = 1, sum = 0, gx = 0, gz = 0, norm = 0, weight = 1, wgx = 0, wgz = 0;
  for (let o = 0; o < oct; o++) {
    vnoise(seed + o * 7919, x * f + o * 31.7, z * f + o * 11.3, n3);
    const s = n3[0] < 0 ? -1 : 1;
    const r = 1 - n3[0] * s, rx = -s * n3[1] * f, rz = -s * n3[2] * f;
    // r² sharpens the crests; each octave is weighted by the one before (detail on the ridges).
    const v = r * r * weight, vx = 2 * r * rx * weight + r * r * wgx, vz = 2 * r * rz * weight + r * r * wgz;
    sum += amp * v; gx += amp * vx; gz += amp * vz;
    norm += amp;
    weight = v < 1 ? v : 1; wgx = v < 1 ? vx : 0; wgz = v < 1 ? vz : 0;
    amp *= gain; f *= 2.07;
  }
  out[0] = sum / norm; out[1] = gx / norm; out[2] = gz / norm;
  return out;
}

// Smoothstep from e0 to e1 of v, with its derivative w.r.t. v: out = [s, ds/dv].
export function smooth(e0, e1, v, out) {
  let t = (v - e0) / (e1 - e0);
  if (t <= 0) { out[0] = 0; out[1] = 0; return out; }
  if (t >= 1) { out[0] = 1; out[1] = 0; return out; }
  out[0] = t * t * (3 - 2 * t); out[1] = (6 * t * (1 - t)) / (e1 - e0);
  return out;
}
