// Engine determinism spike (docs/PHYSICS_ENGINE.md): a scripted, chaotic Rapier scene (a curved
// trimesh ramp, a floor, a stack of boxes, a "car" box driven by raycast spring forces and a
// scripted thrust, rolling into the boxes) stepped 2,400 times at 240 Hz, then a hash of every
// body's pose and velocity bits. Same hash in Node, Chromium, Firefox, WebKit and the Worker ⇒
// the engine is bit-exact across them. Pure: takes the initialised RAPIER namespace.
import { dsin, dcos } from '../src/sim/dmath.js';

export function engineSpike(R, steps = 2400) {
  const world = new R.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = 1 / 240;
  world.createCollider(R.ColliderDesc.cuboid(200, 0.5, 200).setTranslation(0, -0.5, 0).setFriction(0.9));
  // A quarter-pipe of 120 facets, radius 8 m, 4 m wide.
  const verts = [], idx = [], N = 120;
  for (let i = 0; i <= N; i++) {
    const a = (-Math.PI / 2) + (i / N) * (Math.PI / 2) * 1.6;
    const z = 30 + 8 * dcos(a), y = 8 + 8 * dsin(a);
    verts.push(-2, y, z, 2, y, z);
    if (i < N) { const k = 2 * i; idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3); }
  }
  world.createCollider(R.ColliderDesc.trimesh(new Float32Array(verts), new Uint32Array(idx), R.TriMeshFlags.FIX_INTERNAL_EDGES).setFriction(1));
  const boxes = [];
  for (let i = 0; i < 6; i++) {
    const b = world.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation((i % 2) * 0.3, 0.75 + 1.52 * Math.floor(i / 2), 12 + (i % 3) * 0.1));
    world.createCollider(R.ColliderDesc.cuboid(0.9, 0.75, 2.3).setDensity(300 + 50 * i).setFriction(0.6).setRestitution(0.1), b);
    boxes.push(b);
  }
  const car = world.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(0.4, 1.0, -10).setCanSleep(false));
  const carCol = world.createCollider(R.ColliderDesc.cuboid(1, 0.35, 2.2).setMass(2400).setFriction(0.5), car);
  const anchors = [[-0.85, -0.2, 1.4], [0.85, -0.2, 1.4], [-0.85, -0.2, -1.4], [0.85, -0.2, -1.4]];
  const ray = new R.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
  const prev = [0, 0, 0, 0];
  for (let t = 0; t < steps; t++) {
    const p = car.translation(), q = car.rotation();
    for (let w = 0; w < 4; w++) {
      const a = anchors[w];
      // Body point to world (q · a · q*).
      const tx = 2 * (q.y * a[2] - q.z * a[1]), ty = 2 * (q.z * a[0] - q.x * a[2]), tz = 2 * (q.x * a[1] - q.y * a[0]);
      const wx = a[0] + q.w * tx + (q.y * tz - q.z * ty), wy = a[1] + q.w * ty + (q.z * tx - q.x * tz), wz = a[2] + q.w * tz + (q.x * ty - q.y * tx);
      ray.origin.x = p.x + wx; ray.origin.y = p.y + wy; ray.origin.z = p.z + wz;
      const hit = world.castRayAndGetNormal(ray, 0.8, true, undefined, undefined, carCol);
      if (!hit) { prev[w] = 0; continue; }
      const comp = 0.8 - hit.timeOfImpact, f = Math.max(0, 90000 * comp + 6000 * (comp - prev[w]) * 240);
      prev[w] = comp;
      car.addForceAtPoint({ x: hit.normal.x * f, y: hit.normal.y * f, z: hit.normal.z * f }, ray.origin, true);
      const col = hit.collider, body = col.parent();
      if (body && body.handle !== car.handle) body.addForceAtPoint({ x: -hit.normal.x * f, y: -hit.normal.y * f, z: -hit.normal.z * f }, ray.origin, true);
    }
    const push = t < 600 ? 9000 : t < 900 ? -4000 : 2500;
    car.addForce({ x: (t % 97) * 3, y: 0, z: push }, true);
    car.addTorque({ x: 0, y: t > 1200 && t < 1300 ? 4000 : 0, z: t > 1500 && t < 1530 ? 30000 : 0 }, true);
    world.step();
    car.resetForces(true); car.resetTorques(true);
    for (const b of boxes) { b.resetForces(false); }
  }
  // FNV-1a over the f32 bits of every pose and velocity.
  const f = new Float32Array(1), u = new Uint32Array(f.buffer);
  let h = 0x811c9dc5;
  const mixIn = (v) => { f[0] = v; h ^= u[0]; h = Math.imul(h, 0x01000193) >>> 0; };
  const all = [car, ...boxes];
  for (const b of all) {
    const p = b.translation(), q = b.rotation(), v = b.linvel(), w = b.angvel();
    for (const x of [p.x, p.y, p.z, q.x, q.y, q.z, q.w, v.x, v.y, v.z, w.x, w.y, w.z]) mixIn(x);
  }
  const cp = car.translation();
  world.free();
  return { hash: h.toString(16).padStart(8, '0'), car: [cp.x, cp.y, cp.z].map((x) => x.toFixed(4)).join(',') };
}
