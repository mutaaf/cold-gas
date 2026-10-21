// Physics bench: the numbers a car person would check. node scripts/physics-bench.mjs
import { createVehicle, step, newInput, DT } from '../src/sim/vehicle.js';
import { initPhysics } from '../src/sim/engine.js';
await initPhysics();   // the rigid-body engine's WASM (src/sim/engine.js)
const mph = (v) => v * 2.23694;
function settle() {
  const s = createVehicle('lineup'); s.pos.x = 30; const inp = newInput();   // open concrete, clear of ramps
  for (let i = 0; i < 480; i++) step(s, inp);
  return s;
}
// 1. Ride height at rest.
{ const s = settle(); console.log('rest: com y', s.pos.y.toFixed(3), 'vel', Math.hypot(s.vel.x, s.vel.y, s.vel.z).toFixed(4), 'wheel loads', s.wheels.map((w) => Math.round(w.load)).join('/')); }
// 2. 0–60 mph variants.
for (const [label, extra] of [['tyres only (TC)', {}], ['+ fan 2g', { fan: 1 }], ['+ fan + rear thrusters', { fan: 1, thrust: 1 }], ['no TC', { assist: 0 }]]) {
  const s = settle(); const inp = { ...newInput(), throttle: 1, ...extra };
  let t = 0, t60 = null, t100 = null;
  while (t < 12) { step(s, inp); t += DT; const v = mph(Math.hypot(s.vel.x, s.vel.z)); if (t60 === null && v >= 60) t60 = t; if (t100 === null && v >= 100) { t100 = t; break; } }
  const rw = s.wheels[2];
  console.log(label.padEnd(26), '0-60', t60?.toFixed(2), 's  0-100', t100?.toFixed(2), 's  rear slip', rw.slip.toFixed(3), 'gas', s.air.toFixed(0));
}
// 3. 60–0 braking.
{
  const s = settle(); const inp = { ...newInput(), throttle: 1, fan: 0 };
  while (mph(Math.hypot(s.vel.x, s.vel.z)) < 60) step(s, inp);
  const z0 = s.pos.z; const b = { ...newInput(), brake: 1 };
  let t = 0; while (Math.hypot(s.vel.x, s.vel.z) > 0.3 && t < 10) { step(s, b); t += DT; }
  console.log('60-0 braking', (s.pos.z - z0).toFixed(1), 'm', t.toFixed(2), 's  (', ((26.82 ** 2) / (2 * (s.pos.z - z0)) / 9.81).toFixed(2), 'g )');
}
// 4. Steady-state cornering: constant steer at 25 m/s, measure lateral g.
{
  const s = settle(); const acc = { ...newInput(), throttle: 1 };
  while (Math.hypot(s.vel.x, s.vel.z) < 25) step(s, acc);
  for (const steer of [0.3, 0.6, 1.0]) {
    const inp = { ...newInput(), throttle: 0.35, steer };
    let maxLat = 0;
    for (let i = 0; i < 240 * 3; i++) { step(s, inp); const v = Math.hypot(s.vel.x, s.vel.z); const yawRate = s.angVel.y; maxLat = Math.max(maxLat, Math.abs(v * yawRate) / 9.81); }
    console.log('steer', steer, 'lateral g', maxLat.toFixed(2), 'speed', Math.hypot(s.vel.x, s.vel.z).toFixed(1));
  }
}
// 5. Steady cornering on the level (ticket 0020): full stick, speed held, 2 s settle, 1 s mean.
//    OFFICIAL (Moravy): "greater than 2 G's" with the fans, "typically 1.26 G's" on the tyres.
for (const fan of [0, 1]) {
  const row = [20, 30, 40].map((v) => {
    const s = settle(); const inp = { ...newInput(), fan };
    while (Math.hypot(s.vel.x, s.vel.z) < v) { inp.throttle = 1; step(s, inp); }
    inp.steer = 1; let g = 0, kgf = 0, n = 0;
    for (let i = 0; i < 240 * 3; i++) {
      const sp = Math.hypot(s.vel.x, s.vel.z); inp.throttle = Math.max(0, Math.min(0.85, 0.3 + (v - sp) * 0.5));
      step(s, inp);
      if (i >= 480) { g += Math.abs(sp * s.angVel.y) / 9.81; kgf += s.fanForce / 9.81; n++; }
    }
    return `${v} m/s ${(g / n).toFixed(2)} g (${(kgf / n).toFixed(0)} kgf)`;
  });
  console.log(`steady corner, fan ${fan ? 'armed' : 'off  '}`, row.join('  '));
}
