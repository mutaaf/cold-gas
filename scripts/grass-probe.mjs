// Off the road and back on: put the car on the verge beside each road (no barrier on that side),
// facing back toward it at an angle, and drive at it. Reports where it can't get back, and why.
//   node scripts/grass-probe.mjs [roads] [metres past the edge] [approach angle °]
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { parseRoad, buildRoad, createRoadCourse, poseAt, nearestSeg, roadSurface } from '../src/sim/roads.js';
import { createVehicle, step, newInput } from '../src/sim/vehicle.js';
import { quatFromYaw } from '../src/sim/m3.js';
import { SPEC } from '../src/sim/spec.js';
import { initPhysics } from '../src/sim/engine.js';
await initPhysics();   // the rigid-body engine's WASM (src/sim/engine.js)

// The car's attitude sitting on ground with normal n, nose along (tx, tz): body +x left, +y up, +z
// forward, so the rotation's columns are (up × fwd, up, fwd).
function alignTo(q, tx, tz, n) {
  let fx = tx, fy = 0, fz = tz;
  const d = fx * n.x + fz * n.z;
  fx -= n.x * d; fy -= n.y * d; fz -= n.z * d;
  const l = Math.hypot(fx, fy, fz); fx /= l; fy /= l; fz /= l;
  const ux = n.x, uy = n.y, uz = n.z;
  const lx = uy * fz - uz * fy, ly = uz * fx - ux * fz, lz = ux * fy - uy * fx;
  const m00 = lx, m01 = ux, m02 = fx, m10 = ly, m11 = uy, m12 = fy, m20 = lz, m21 = uz, m22 = fz;
  const tr = m00 + m11 + m22;
  if (tr > 0) { const S = Math.sqrt(tr + 1) * 2; q.w = 0.25 * S; q.x = (m21 - m12) / S; q.y = (m02 - m20) / S; q.z = (m10 - m01) / S; }
  else if (m00 > m11 && m00 > m22) { const S = Math.sqrt(1 + m00 - m11 - m22) * 2; q.w = (m21 - m12) / S; q.x = 0.25 * S; q.y = (m01 + m10) / S; q.z = (m02 + m20) / S; }
  else if (m11 > m22) { const S = Math.sqrt(1 + m11 - m00 - m22) * 2; q.w = (m02 - m20) / S; q.x = (m01 + m10) / S; q.y = 0.25 * S; q.z = (m12 + m21) / S; }
  else { const S = Math.sqrt(1 + m22 - m00 - m11) * 2; q.w = (m10 - m01) / S; q.x = (m02 + m20) / S; q.y = (m12 + m21) / S; q.z = 0.25 * S; }
  return q;
}
const ids = (process.argv[2] || 'stelvio,transfagarasan,bigsur,atlantic').split(',');
const off = Number(process.argv[3] || 8), ang = (Number(process.argv[4] || 40) * Math.PI) / 180;
const verbose = process.argv.includes('-v'), steer = !process.argv.includes('--nosteer');
for (const id of ids) {
  const raw = gunzipSync(readFileSync(new URL(`../public/roads/${id}.bin.gz`, import.meta.url)));
  const road = buildRoad(parseRoad(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength)));
  const course = createRoadCourse(road);
  let tried = 0, ok = 0, steep = 0;
  const list = [];
  for (let s = 150; s < road.length - 150; s += 173) {
    for (const side of [1, -1]) {
      const p = poseAt(road, s, 1), i = p.i;
      if (road.flags[i] & 3) continue;
      const rail = side > 0 ? (road.flags[i] >> 2) & 3 : (road.flags[i] >> 4) & 3;
      if (rail) continue;
      const lx = road.dz[i], lz = -road.dx[i];
      const lat = side * (road.hw[i] + off);
      const x = road.x[i] + lx * lat, z = road.z[i] + lz * lat;
      const sn = {};
      const top = road.y[i] + 80;
      let gy = top;
      { let lo = road.y[i] - 200, hi = top; for (let k = 0; k < 60; k++) { const m = (lo + hi) / 2; if (roadSurface(road, x, m, z, sn) > 0) hi = m; else lo = m; } gy = hi; roadSurface(road, x, gy + 0.01, z, sn); }
      if (sn.y < 0.6) { steep++; continue; }          // a cut face or a cliff: not drivable anyway
      const car = createVehicle(course);
      car.pos.x = x; car.pos.y = gy + SPEC.comHeight + 0.15; car.pos.z = z;
      const sa = Math.sin(ang), ca = Math.cos(ang);
      const tx = road.dx[i] * sa - lx * side * ca, tz = road.dz[i] * sa - lz * side * ca;
      quatFromYaw(car.quat, Math.atan2(tx, tz));
      alignTo(car.quat, tx, tz, sn);
      { const hold = newInput(); hold.brake = 1; for (let t = 0; t < 240; t++) step(car, hold); }
      const inp = newInput(); inp.throttle = Number(process.env.TH || 1);
      const q = { seg: -1, t: 0, lat: 99, yc: 0, hw: 0, bank: 0, u: 0 };
      let back = false, hull = 0, minLat = 99;
      for (let t = 0; t < 240 * 8; t++) {
        // A driver: steer at a point on the road 12 m on from the nearest one (what a person does).
        if (steer && nearestSeg(road, car.pos.x, car.pos.y, car.pos.z, q)) {
          const j = Math.min(road.m - 1, q.seg + 4), qq = car.quat;
          const fx = 2 * (qq.x * qq.z + qq.w * qq.y), fz = 1 - 2 * (qq.x * qq.x + qq.y * qq.y);
          const ex = road.x[j] - car.pos.x, ez = road.z[j] - car.pos.z;
          const right = -(ex * fz - ez * fx), ahead = ex * fx + ez * fz;
          inp.steer = Math.max(-1, Math.min(1, Math.atan2(right, ahead) * 2));
        }
        step(car, inp);
        if (car.hullContact) hull++;
        if (nearestSeg(road, car.pos.x, car.pos.y, car.pos.z, q)) {
          minLat = Math.min(minLat, Math.abs(q.lat) - q.hw);
          if (Math.abs(q.lat) < q.hw && car.grounded >= 3 && Math.abs(car.pos.y - SPEC.comHeight - (q.yc + q.bank * q.lat)) < 0.4) { back = true; break; }
        }
      }
      tried++;
      if (back) { ok++; continue; }
      const v = Math.hypot(car.vel.x, car.vel.z);
      nearestSeg(road, car.pos.x, car.pos.y, car.pos.z, q);
      list.push(`s=${s} side=${side} closest=${minLat.toFixed(2)} m past edge, now lat=${q.lat.toFixed(1)} dy=${(car.pos.y - SPEC.comHeight - q.yc).toFixed(2)} v=${v.toFixed(1)} grounded=${car.grounded} hullTicks=${hull} start ground ${(gy - road.y[i]).toFixed(1)} m vs road, n.y=${sn.y.toFixed(2)} ${sn.mat.id} up.y=${(1 - 2 * (car.quat.x * car.quat.x + car.quat.z * car.quat.z)).toFixed(2)} slip=${car.wheels.map((w) => w.slip.toFixed(1)).join("|")}`);
    }
  }
  console.log(`${id}: ${off} m past the edge, ${ang * 180 / Math.PI}°: ${ok}/${tried} back on (${steep} too steep to stand on, skipped)`);
  for (const w of list.slice(0, verbose ? 99 : 8)) console.log('   ', w);
}
