// Deterministic math for the simulation. JavaScript engines may implement Math.sin, atan2, hypot,
// pow… differently (V8 versions, JavaScriptCore, the Workers runtime), and the stunt physics
// is chaotic enough that a 1-ulp difference changes a 20-second run's score. These functions use
// only +, −, ×, ÷ and √, which IEEE 754 requires to be correctly rounded everywhere, so every
// browser, phone and the Worker compute the same bits. Ported from fdlibm (Sun, 1993: "Developed
// at SunPro, a Sun Microsystems business. Permission to use, copy, modify, and distribute this
// software is freely granted, provided that this notice is preserved.").

const PIO2_1 = 1.57079632673412561417e+00;   // first 33 bits of π/2
const PIO2_1T = 6.07710050650619224932e-11;  // π/2 − PIO2_1
const INV_PIO2 = 6.36619772367581382433e-01; // 2/π
export const PI = 3.141592653589793;

const S1 = -1.66666666666666324348e-01, S2 = 8.33333333332248946124e-03, S3 = -1.98412698298579493134e-04,
  S4 = 2.75573137070700676789e-06, S5 = -2.50507602534068634195e-08, S6 = 1.58969099521155010221e-10;
const C1 = 4.16666666666666019037e-02, C2 = -1.38888888887411369855e-03, C3 = 2.48015872894767294178e-05,
  C4 = -2.75573143513906633035e-07, C5 = 2.08757232129817482790e-09, C6 = -1.13596475577881948265e-11;

function kSin(x) {
  const z = x * x, v = z * x;
  return x + v * (S1 + z * (S2 + z * (S3 + z * (S4 + z * (S5 + z * S6)))));
}
function kCos(x) {
  const z = x * x, r = z * (C1 + z * (C2 + z * (C3 + z * (C4 + z * (C5 + z * C6)))));
  const hz = 0.5 * z, w = 1 - hz;
  return w + (((1 - w) - hz) + z * r);
}
// Range-reduce to [−π/4, π/4] (fine for the angles a stunt produces, |x| ≲ 1e5). Results land
// in module scratch so the hot path never allocates.
let rr = 0, rq = 0;
function reduce(x) {
  const n = Math.round(x * INV_PIO2);
  rr = (x - n * PIO2_1) - n * PIO2_1T;
  rq = ((n % 4) + 4) % 4;
}
export function dsin(x) {
  if (x > -0.7853981633974483 && x < 0.7853981633974483) return kSin(x);
  reduce(x);
  return rq === 0 ? kSin(rr) : rq === 1 ? kCos(rr) : rq === 2 ? -kSin(rr) : -kCos(rr);
}
export function dcos(x) {
  if (x > -0.7853981633974483 && x < 0.7853981633974483) return kCos(x);
  reduce(x);
  return rq === 0 ? kCos(rr) : rq === 1 ? -kSin(rr) : rq === 2 ? -kCos(rr) : kSin(rr);
}

const ATANHI = [4.63647609000806093515e-01, 7.85398163397448278999e-01, 9.82793723247329054082e-01, 1.57079632679489655800e+00];
const ATANLO = [2.26987774529616870924e-17, 3.06161699786838301793e-17, 1.39033110312309984516e-17, 6.12323399573676603587e-17];
const AT = [3.33333333333329318027e-01, -1.99999999998764832476e-01, 1.42857142725034663711e-01, -1.11111104054623557880e-01,
  9.09088713343650656196e-02, -7.69187620504482999495e-02, 6.66107313738753120669e-02, -5.83357013379057348645e-02,
  4.97687799461593236017e-02, -3.65315727442169155270e-02, 1.62858201153657823623e-02];

export function datan(x) {
  if (x !== x) return x;
  const neg = x < 0;
  let a = neg ? -x : x, id;
  if (a >= 4.4e15) return neg ? -1.5707963267948966 : 1.5707963267948966;
  if (a < 0.4375) id = -1;
  else if (a < 0.6875) { id = 0; a = (2 * a - 1) / (2 + a); }
  else if (a < 1.1875) { id = 1; a = (a - 1) / (a + 1); }
  else if (a < 2.4375) { id = 2; a = (a - 1.5) / (1 + 1.5 * a); }
  else { id = 3; a = -1 / a; }
  const z = a * a, w = z * z;
  const s1 = z * (AT[0] + w * (AT[2] + w * (AT[4] + w * (AT[6] + w * (AT[8] + w * AT[10])))));
  const s2 = w * (AT[1] + w * (AT[3] + w * (AT[5] + w * (AT[7] + w * AT[9]))));
  let r;
  if (id < 0) r = a - a * (s1 + s2);
  else r = ATANHI[id] - ((a * (s1 + s2) - ATANLO[id]) - a);
  return neg ? -r : r;
}

export function datan2(y, x) {
  if (x !== x || y !== y) return NaN;
  if (x > 0) return datan(y / x);
  if (x < 0) return y >= 0 ? datan(y / x) + PI : datan(y / x) - PI;
  return y > 0 ? 1.5707963267948966 : y < 0 ? -1.5707963267948966 : 0;
}

export const dacos = (x) => datan2(Math.sqrt(Math.max(0, 1 - x * x)), x);
export const dhypot = (a, b, c = 0) => Math.sqrt(a * a + b * b + c * c);

// exp and log, fdlibm's e_exp.c and e_log.c (same notice as above): range reduction by ln 2, a
// rational/polynomial kernel, and the power of two put together from its bits (integer work), so
// they too round the same everywhere. For the rocket's atmosphere, mass ratios and the plume's
// Gaussian (src/sim/rocket.js). Accurate to < 1 ulp over the ranges we use.
const LN2_HI = 6.93147180369123816490e-01, LN2_LO = 1.90821492927058770002e-10, INV_LN2 = 1.44269504088896338700e+00;
const P1 = 1.66666666666666019037e-01, P2 = -2.77777777770155933842e-03, P3 = 6.61375632143793436117e-05,
  P4 = -1.65339022054652515390e-06, P5 = 4.13813679705723846039e-08;
const bits = new DataView(new ArrayBuffer(8));
// 2^k for an integer k in [−1022, 1023], built from its exponent bits (big-endian: no host byte order).
function pow2(k) { bits.setUint32(0, (k + 1023) << 20); bits.setUint32(4, 0); return bits.getFloat64(0); }
export function dexp(x) {
  if (x !== x) return x;
  if (x > 709.782712893384) return Infinity;
  if (x < -745.1332191019411) return 0;
  if (x > -3.725290298461914e-9 && x < 3.725290298461914e-9) return 1 + x;
  const k = Math.floor(x * INV_LN2 + 0.5);
  const hi = x - k * LN2_HI, lo = k * LN2_LO, r = hi - lo;
  const t = r * r, c = r - t * (P1 + t * (P2 + t * (P3 + t * (P4 + t * P5))));
  const y = 1 - ((lo - (r * c) / (2 - c)) - hi);
  // 2^k may fall outside a normal double at the ends: split it in two steps.
  if (k > 1023) return y * pow2(1023) * pow2(k - 1023);
  if (k < -1022) return y * pow2(k + 1000) * pow2(-1000);
  return y * pow2(k);
}
const LG1 = 6.666666666666735130e-01, LG2 = 3.999999999940941908e-01, LG3 = 2.857142874366239149e-01,
  LG4 = 2.222219843214978396e-01, LG5 = 1.818357216161805012e-01, LG6 = 1.531383769920937332e-01, LG7 = 1.479819860511658591e-01;
export function dlog(x) {
  if (x !== x || x < 0) return NaN;
  if (x === 0) return -Infinity;
  if (x === Infinity) return x;
  let k = 0;
  if (x < 2.2250738585072014e-308) { x *= 18014398509481984; k = -54; }   // subnormal: × 2^54
  bits.setFloat64(0, x);
  let hx = bits.getUint32(0);
  k += (hx >>> 20) - 1023;
  hx &= 0x000fffff;
  // Normalise the mantissa into [√2/2, √2).
  const i = (hx + 0x95f64) & 0x100000;
  bits.setUint32(0, hx | (i ^ 0x3ff00000));
  k += i >>> 20;
  const f = bits.getFloat64(0) - 1;
  const s = f / (2 + f), z = s * s, w = z * z;
  const t1 = w * (LG2 + w * (LG4 + w * LG6)), t2 = z * (LG1 + w * (LG3 + w * (LG5 + w * LG7)));
  const R = t2 + t1, hfsq = 0.5 * f * f;
  return k * LN2_HI - ((hfsq - (s * (hfsq + R) + k * LN2_LO)) - f);
}
