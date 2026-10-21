// Headless probe for the build layer: drive the roadster at a piece on the flat Sandbox and report
// what happens (highest point, longest airtime, inverted at some point, where it ended, upright).
//   node scripts/build-probe.mjs kicker 20 [scale] [fan 0|1]
//   node scripts/build-probe.mjs all
import { createArenaCourse } from '../src/build/arena.js';
import { createObjectStore, composeCourse } from '../src/build/objects.js';
import { createVehicle, step, DT, newInput } from '../src/sim/vehicle.js';
import { SPEC } from '../src/sim/spec.js';

export function probe(type, speed, { scale = 1, fan = 0, secs = 8, yaw = 0, z = 0, x = 0, material, carX = 0 } = {}) {
  const store = createObjectStore();
  store.addObject({ type, transform: { x, y: 0, z, yaw, scale }, material });
  const course = composeCourse(createArenaCourse(), store);
  const car = createVehicle(course);
  car.pos.x = carX; car.pos.z = -60; car.pos.y = SPEC.comHeight + 0.02;
  car.vel.z = speed;
  for (const w of car.wheels) w.omega = speed / 0.36;
  const inp = newInput();
  let maxY = 0, air = 0, maxAir = 0, inverted = false, maxX = 0;
  for (let t = 0; t < secs / DT; t++) {
    const v = Math.hypot(car.vel.x, car.vel.z);
    inp.throttle = v < speed ? 1 : 0; inp.fan = fan; inp.assist = 1;
    step(car, inp);
    maxY = Math.max(maxY, car.pos.y);
    const upY = 1 - 2 * (car.quat.x * car.quat.x + car.quat.z * car.quat.z);
    if (upY < -0.5) inverted = true;
    if (car.grounded === 0 && !car.hullContact) { air += DT; maxAir = Math.max(maxAir, air); } else air = 0;
    if (!Number.isFinite(car.pos.y)) return { nan: true };
    maxX = Math.max(maxX, Math.abs(car.pos.x - carX));
  }
  const upY = 1 - 2 * (car.quat.x * car.quat.x + car.quat.z * car.quat.z);
  return { maxY: +maxY.toFixed(2), maxAir: +maxAir.toFixed(2), inverted, end: { x: +car.pos.x.toFixed(1), y: +car.pos.y.toFixed(2), z: +car.pos.z.toFixed(1) }, upright: upY > 0.8, maxX: +maxX.toFixed(1) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const runs = args[0] === 'all' || !args.length
    ? [['kicker', 20], ['wedge', 20], ['quarter', 12], ['block', 10], ['pad', 15], ['halfpipe', 15], ['loop', 18, 1, 1], ['loop', 22, 1, 0], ['barge', 15]]
    : [[args[0], Number(args[1] || 20), Number(args[2] || 1), Number(args[3] || 0)]];
  for (const [type, sp, sc = 1, fan = 0] of runs) console.log(type, sp, sc, fan, JSON.stringify(probe(type, sp, { scale: sc, fan })));
}
