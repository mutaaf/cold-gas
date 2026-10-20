// Torn-off parts as small rigid bodies: a box (the part's bounds) with mass and inertia that falls,
// strikes the concrete on its corners (an impulse with restitution and Coulomb friction at each
// corner below the ground), tumbles and settles flat. Cosmetic only (the sim never sees them), so
// plain Math is fine here. Allocation-free per frame.
import * as THREE from 'three';

const G = 9.81, E = 0.25, MU = 0.55, SUB = 2;
const CORNERS = [];
for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) CORNERS.push(new THREE.Vector3(x, y, z));

const r = new THREE.Vector3(), p = new THREE.Vector3(), vp = new THREE.Vector3(), t = new THREE.Vector3(), a = new THREE.Vector3(), b = new THREE.Vector3(), dq = new THREE.Quaternion(), iq = new THREE.Quaternion();

export function createPieces(root, floor = () => 0) {
  const list = [];

  // A piece: `visual` is drawn centred on the body's origin; `half` is the box's half extents.
  function add(visual, half) {
    const body = new THREE.Group();
    body.add(visual);
    body.visible = false;
    root.add(body);
    const m = 1, h = half;
    const I = new THREE.Vector3((h.y * h.y + h.z * h.z) / 3, (h.x * h.x + h.z * h.z) / 3, (h.x * h.x + h.y * h.y) / 3).multiplyScalar(m);
    // Thin panels get a floor on their inertia so a 1 cm skirt edge doesn't spin like a top.
    const floor = Math.max(I.x, I.y, I.z) * 0.08;
    I.set(Math.max(I.x, floor), Math.max(I.y, floor), Math.max(I.z, floor));
    const pc = { body, half: h.clone(), I, v: new THREE.Vector3(), w: new THREE.Vector3(), on: false, still: 0 };
    list.push(pc);
    return pc;
  }

  // Inverse world inertia applied to x (in place): R · I⁻¹ · Rᵀ · x.
  function invI(pc, x) {
    iq.copy(pc.body.quaternion).invert();
    x.applyQuaternion(iq);
    x.set(x.x / pc.I.x, x.y / pc.I.y, x.z / pc.I.z);
    return x.applyQuaternion(pc.body.quaternion);
  }

  function spawn(pc, pos, quat, v, w) {
    pc.body.position.copy(pos); pc.body.quaternion.copy(quat);
    pc.v.copy(v); pc.w.copy(w);
    pc.on = true; pc.still = 0; pc.body.visible = true;
  }

  function step(pc, dt) {
    const body = pc.body;
    pc.v.y -= G * dt;
    body.position.addScaledVector(pc.v, dt);
    const wl = pc.w.length();
    if (wl > 1e-6) { dq.setFromAxisAngle(a.copy(pc.w).multiplyScalar(1 / wl), wl * dt); body.quaternion.premultiply(dq).normalize(); }
    let deepest = 0;
    const fy = floor();
    for (const c of CORNERS) {
      r.set(c.x * pc.half.x, c.y * pc.half.y, c.z * pc.half.z).applyQuaternion(body.quaternion);
      p.copy(body.position).add(r);
      if (p.y >= fy) continue;
      deepest = Math.min(deepest, p.y - fy);
      vp.crossVectors(pc.w, r).add(pc.v);
      if (vp.y >= 0) continue;
      // Normal impulse at this corner (ground normal +y).
      a.set(r.z, 0, -r.x);                       // r × n for n = +y
      const kn = 1 + a.dot(invI(pc, b.copy(a)));
      const jn = (-(1 + E) * vp.y) / kn;
      pc.v.y += jn;
      pc.w.addScaledVector(invI(pc, b.copy(a)), jn);
      // Friction against the sliding velocity at the corner, capped by μ·jn.
      vp.crossVectors(pc.w, r).add(pc.v);
      t.set(vp.x, 0, vp.z);
      const vt = t.length();
      if (vt > 1e-5) {
        t.multiplyScalar(1 / vt);
        a.crossVectors(r, t);
        const kt = 1 + a.dot(invI(pc, b.copy(a)));
        const jt = Math.min(MU * jn, vt / kt);
        pc.v.addScaledVector(t, -jt);
        pc.w.addScaledVector(invI(pc, b.copy(a)), -jt);
      }
    }
    if (deepest < 0) body.position.y -= deepest;
    if (deepest < 0 && pc.v.lengthSq() < 0.04 && pc.w.lengthSq() < 0.09) {
      pc.still += dt;
      pc.v.multiplyScalar(0.8); pc.w.multiplyScalar(0.8);
    } else pc.still = 0;
  }

  function update(dt) {
    if (dt <= 0) return;
    const h = Math.min(dt, 0.05) / SUB;
    for (const pc of list) {
      if (!pc.on || pc.still > 1) continue;
      for (let s = 0; s < SUB; s++) step(pc, h);
    }
  }

  function reset() { for (const pc of list) { pc.on = false; pc.body.visible = false; } }

  return { add, spawn, update, reset, list };
}
