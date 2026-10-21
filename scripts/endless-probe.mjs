// The endless road in Node: generation speed, what it's made of, and a drive along it.
//   node scripts/endless-probe.mjs [seed] [km] [drive seconds]
import { createEndlessCourse, BIOMES } from '../src/sim/endless.js';
import { createVehicle, step } from '../src/sim/vehicle.js';
import { quatFromYaw } from '../src/sim/m3.js';
import { poseAt, nearestSeg } from '../src/sim/roads.js';
import { SPEC } from '../src/sim/spec.js';
import { createPilot } from '../src/drive/pilot.js';

const [seed = 'cold-gas', km = '20', secs = '60'] = process.argv.slice(2);
let t0 = performance.now();
const course = createEndlessCourse(seed), road = course.road;
road.generate(Math.round((Number(km) * 1000) / 3));
const genMs = performance.now() - t0;
let bridges = 0, rails = 0, minY = Infinity, maxY = -Infinity, maxG = 0, minR = Infinity;
const biome = [0, 0, 0, 0];
for (let i = 0; i < road.m; i++) {
  if (road.flags[i] & 1) bridges++;
  if (road.flags[i] & 0x3c) rails++;
  minY = Math.min(minY, road.y[i]); maxY = Math.max(maxY, road.y[i]); maxG = Math.max(maxG, Math.abs(road.grade[i]));
  biome[road.biome[i]]++;
  if (i > 2 && i < road.m - 2) {
    const c = road.dx[i - 2] * road.dz[i + 2] - road.dz[i - 2] * road.dx[i + 2];
    if (Math.abs(c) > 1e-6) minR = Math.min(minR, 12 / Math.abs(c));
  }
  if (i > 0 && road.z[i] <= road.z[i - 1]) throw new Error(`z not increasing at ${i}`);
}
console.log(`seed ${seed}: ${(road.length / 1000).toFixed(1)} km in ${genMs.toFixed(0)} ms (${(genMs / (road.length / 1000)).toFixed(1)} ms/km)`);
console.log(`  elevation ${minY.toFixed(0)}–${maxY.toFixed(0)} m, max grade ${(maxG * 100).toFixed(1)} %, tightest R ≈ ${minR.toFixed(0)} m, bridges ${((bridges / road.m) * 100).toFixed(1)} %, rails ${((rails / road.m) * 100).toFixed(1)} %`);
console.log(`  biomes: ${BIOMES.map((b, k) => `${b.id} ${((biome[k] / road.m) * 100).toFixed(0)} %`).join(', ')}`);
// Surface query cost.
const out = {};
t0 = performance.now();
let acc = 0;
const M = road.m - 200;
for (let k = 0; k < 200000; k++) { const i = (k * 7) % M; acc += course.sdf(road.x[i] + (k % 17) - 8, road.y[i] + 1, road.z[i], out); }
console.log(`  sdf: ${((performance.now() - t0) / 200).toFixed(2)} µs/query (${acc > 0 ? 'ok' : '?'})`);
// Drive it.
const car = createVehicle(course), p = poseAt(road, 60, 1);
car.pos.x = p.x; car.pos.y = p.y + SPEC.comHeight + 0.04; car.pos.z = p.z; quatFromYaw(car.quat, p.yaw);
const pilot = createPilot(road, { vmax: 32 });
const q = { seg: -1, lat: 0 };
t0 = performance.now();
let off = 0, maxLat = 0;
for (let t = 0; t < 240 * Number(secs); t++) {
  step(car, pilot(car));
  if (t % 24 === 0 && nearestSeg(road, car.pos.x, car.pos.y, car.pos.z, q)) { maxLat = Math.max(maxLat, Math.abs(q.lat)); if (Math.abs(q.lat) > q.hw) off++; }
}
const ms = performance.now() - t0;
nearestSeg(road, car.pos.x, car.pos.y, car.pos.z, q);
console.log(`  drive ${secs} s: ${((q.seg * 3) / 1000).toFixed(2)} km along, ${(Math.hypot(car.vel.x, car.vel.z) * 3.6).toFixed(0)} km/h, max |lat| ${maxLat.toFixed(1)} m, off-ribbon samples ${off}, ${((ms / (240 * Number(secs))) * 1000).toFixed(0)} µs/tick, road ${(road.length / 1000).toFixed(1)} km generated`);
