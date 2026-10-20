// Drive the Wall with the fan on at a set entry speed and trace the climb.
import { createVehicle, step, newInput, up, DT } from '../src/sim/vehicle.js';
import { WALL } from '../src/sim/courses.js';
const v0 = Number(process.argv[2] || 30), fanOn = process.argv[3] !== 'nofan';
const s = createVehicle('wall'); for (let i = 0; i < 240; i++) step(s, newInput());
const u = {}; let t = 0, maxY = 0, invT = 0, lastLog = -1;
while (t < 24) {
  const sp = Math.hypot(s.vel.x, s.vel.y, s.vel.z);
  const onRamp = s.pos.z > -2;
  const inp = { ...newInput(), throttle: onRamp ? Number(process.argv[4] ?? 1) : sp < v0 ? 1 : 0, brake: !onRamp && sp > v0 + 0.5 ? 0.3 : 0, steer: -s.pos.x * 0.3 - s.vel.x * 0.2, fan: fanOn ? 1 : 0 };
  step(s, inp); t += DT; up(s, u);
  maxY = Math.max(maxY, s.pos.y); if (u.y < -0.5 && s.grounded) invT += DT;
  if (s.pos.z > -3 && (Math.floor(t * 8) !== lastLog)) { lastLog = Math.floor(t * 8);
    console.log(t.toFixed(2), 'pos', s.pos.z.toFixed(2), s.pos.y.toFixed(2), 'x', s.pos.x.toFixed(2), 'v', sp.toFixed(1), 'up', u.z.toFixed(2), u.y.toFixed(2), 'g', s.grounded, 'wall', s.onWall, 'fanN', (s.fanForce / 1000).toFixed(1) + 'k', 'gap', s.floorGap === Infinity ? '-' : s.floorGap.toFixed(2), 'hull', s.hullContact, 'loads', s.wheels.map((w) => (w.load / 1000).toFixed(1)).join('/')); }
  if (maxY > 3 && s.pos.y < 0.7 && s.grounded && s.pos.z < -3) break;
}
console.log('maxY', maxY.toFixed(2), 'inverted on wall', invT.toFixed(2), 's   lip at', WALL.lip.y.toFixed(1));
