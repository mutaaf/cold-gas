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
