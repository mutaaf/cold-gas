// Tiny allocation-free 3D math on plain {x,y,z} / {x,y,z,w} objects. The sim runs 240 times a
// second and also inside the Worker (score recompute), so it must not depend on three.js and
// must not allocate in the step. Every function writes into an `out` argument and returns it.

export const v3 = (x = 0, y = 0, z = 0) => ({ x, y, z });
export const q4 = (x = 0, y = 0, z = 0, w = 1) => ({ x, y, z, w });

export function set(o, x, y, z) { o.x = x; o.y = y; o.z = z; return o; }
export function copy(o, a) { o.x = a.x; o.y = a.y; o.z = a.z; return o; }
export function add(o, a, b) { o.x = a.x + b.x; o.y = a.y + b.y; o.z = a.z + b.z; return o; }
export function sub(o, a, b) { o.x = a.x - b.x; o.y = a.y - b.y; o.z = a.z - b.z; return o; }
export function scale(o, a, s) { o.x = a.x * s; o.y = a.y * s; o.z = a.z * s; return o; }
export function addScaled(o, a, b, s) { o.x = a.x + b.x * s; o.y = a.y + b.y * s; o.z = a.z + b.z * s; return o; }
export const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
export const len = (a) => Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z);

export function cross(o, a, b) {
  const x = a.y * b.z - a.z * b.y, y = a.z * b.x - a.x * b.z, z = a.x * b.y - a.y * b.x;
  o.x = x; o.y = y; o.z = z; return o;
}

export function normalize(o, a) {
  const l = len(a) || 1;
  o.x = a.x / l; o.y = a.y / l; o.z = a.z / l; return o;
}

// Rotate vector v by unit quaternion q (body → world).
export function rotate(o, q, v) {
  const { x: qx, y: qy, z: qz, w: qw } = q;
  const tx = 2 * (qy * v.z - qz * v.y), ty = 2 * (qz * v.x - qx * v.z), tz = 2 * (qx * v.y - qy * v.x);
  const x = v.x + qw * tx + (qy * tz - qz * ty);
  const y = v.y + qw * ty + (qz * tx - qx * tz);
  const z = v.z + qw * tz + (qx * ty - qy * tx);
  o.x = x; o.y = y; o.z = z; return o;
}

// Rotate by the conjugate (world → body).
export function rotateInv(o, q, v) {
  const { x: qx, y: qy, z: qz, w: qw } = q;
  const tx = 2 * (-qy * v.z + qz * v.y), ty = 2 * (-qz * v.x + qx * v.z), tz = 2 * (-qx * v.y + qy * v.x);
  const x = v.x + qw * tx + (-qy * tz + qz * ty);
  const y = v.y + qw * ty + (-qz * tx + qx * tz);
  const z = v.z + qw * tz + (-qx * ty + qy * tx);
  o.x = x; o.y = y; o.z = z; return o;
}

// q += 0.5 * (0, w) * q * dt  (w in world frame), then renormalise.
export function integrateQuat(q, w, dt) {
  const hx = w.x * dt * 0.5, hy = w.y * dt * 0.5, hz = w.z * dt * 0.5;
  const { x, y, z, w: qw } = q;
  q.x = x + hx * qw + hy * z - hz * y;
  q.y = y + hy * qw + hz * x - hx * z;
  q.z = z + hz * qw + hx * y - hy * x;
  q.w = qw - hx * x - hy * y - hz * z;
  const l = Math.sqrt(q.x * q.x + q.y * q.y + q.z * q.z + q.w * q.w) || 1;
  q.x /= l; q.y /= l; q.z /= l; q.w /= l;
  return q;
}

export function quatFromYaw(q, yaw) {
  q.x = 0; q.y = Math.sin(yaw / 2); q.z = 0; q.w = Math.cos(yaw / 2); return q;
}

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
