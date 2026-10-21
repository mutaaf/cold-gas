// Steps in the ground beside the road: walk lines parallel to each road at fixed offsets past the
// edge, 10 cm at a time, and report the biggest height jumps (a wheel feels anything over a few cm).
//   node scripts/verge-steps.mjs [roads]
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { parseRoad, buildRoad, roadSurface } from '../src/sim/roads.js';

const ids = (process.argv[2] || 'stelvio,transfagarasan,bigsur,atlantic').split(',');
const sn = {};
export function groundY(road, x, z, yHint) {
  let lo = yHint - 60, hi = yHint + 60;
  for (let k = 0; k < 50; k++) { const m = (lo + hi) / 2; if (roadSurface(road, x, m, z, sn) > 0) hi = m; else lo = m; }
  return hi;
}
for (const id of ids) {
  const raw = gunzipSync(readFileSync(new URL(`../public/roads/${id}.bin.gz`, import.meta.url)));
  const road = buildRoad(parseRoad(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength)));
  const worst = [];
  for (const off of [2, 4, 6, 8, 10, 12]) for (const side of [1, -1]) {
    for (let a = 100; a < road.length - 100; a += 401) {
      let prev = null, px = 0, pz = 0;
      for (let s = a; s < a + 40; s += 0.1) {
        const i = Math.floor(s / 3), u = s / 3 - i;
        if (road.flags[i] & 0x3f || road.flags[i + 1] & 0x3f) { prev = null; continue; }
        const lx = road.dz[i], lz = -road.dx[i], hw = road.hw[i];
        const x = road.x[i] + (road.x[i + 1] - road.x[i]) * u + lx * side * (hw + off);
        const z = road.z[i] + (road.z[i + 1] - road.z[i]) * u + lz * side * (hw + off);
        const y = groundY(road, x, z, road.y[i]);
        if (prev !== null && Math.abs(y - prev) > 0.03) {
          // A slope shrinks when you look closer; a step doesn't. Bisect to 5 mm and see what's left.
          let ax = px, az = pz, ay = prev, bx = x, bz = z, by = y;
          for (let k = 0; k < 6; k++) {
            const mx = (ax + bx) / 2, mz = (az + bz) / 2, my = groundY(road, mx, mz, road.y[i]);
            if (Math.abs(my - ay) > Math.abs(by - my)) { bx = mx; bz = mz; by = my; } else { ax = mx; az = mz; ay = my; }
          }
          const d = Math.hypot(bx - ax, bz - az), jump = Math.abs(by - ay) - d * 1.5;   // beyond a 1.5 slope
          if (jump > 0.03) worst.push([jump, `off ${off} side ${side} s ${s.toFixed(1)} step ${(by - ay).toFixed(3)} m over ${(d * 1000).toFixed(0)} mm`]);
        }
        prev = y; px = x; pz = z;
      }
    }
  }
  worst.sort((a, b) => b[0] - a[0]);
  console.log(`${id}: ${worst.length} steps over 3 cm`);
  for (const [, w] of worst.filter((x) => /over [0-9] mm/.test(x[1])).slice(0, 12)) console.log('   ', w);
}
