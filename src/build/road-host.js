// The build layer's host on Free Drive's real roads (src/build/layer.js documents the interface).
// Pieces may go within 120 m of the road; a quest's frame follows the road: z is distance along
// it from where the car is, x the offset right of the centreline, yaw relative to its heading.
import { roadSurface, terrainAt, nearestSample, poseAt, yawOf } from '../sim/roads.js';

const D2R = Math.PI / 180;
const sn = { x: 0, y: 0, z: 0 }, t3 = [0, 0, 0];

// The ground under (x, z): march down the road world's distance field from above it.
export function roadGround(road, x, z) {
  const i = nearestSample(road, x, z);
  let y = Math.max(terrainAt(road, x, z, t3)[0], road.y[i]) + 40;
  for (let k = 0; k < 200; k++) {
    const d = roadSurface(road, x, y, z, sn);
    if (d < 0.01) break;
    y -= Math.max(0.01, d * 0.8);
  }
  return Math.round(y * 100) / 100;
}

export function roadHost({ road, info, course, stage, carRoot, getCar, placeCar }) {
  const sp = road.meta.spacing;
  return {
    id: info.id, kind: 'road', name: info.name,
    base: course,
    groundAt: (x, z) => roadGround(road, x, z),
    inBounds(x, z) {
      const i = nearestSample(road, x, z);
      return Math.hypot(x - road.x[i], z - road.z[i]) < 120;
    },
    get scene() { return stage.scene; }, camera: stage.camera, get canvas() { return stage.renderer.domElement; }, carRoot,
    getCar, placeCar,
    questFrame(car) {
      const i0 = nearestSample(road, car.pos.x, car.pos.z);
      const m0 = Math.min(i0, road.m - 1);
      const q = car.quat, fx = 2 * (q.x * q.z + q.w * q.y), fz = 1 - 2 * (q.x * q.x + q.y * q.y);
      const dir = road.dx[m0] * fx + road.dz[m0] * fz >= 0 ? 1 : -1;
      // Start a little behind where the car is, so the first piece has a run-up; keep the whole
      // quest on the road (z runs to 600 m).
      let s0 = i0 * sp;
      s0 = dir > 0 ? Math.min(s0, road.length - 640) : Math.max(s0, 640);
      s0 = Math.max(20, Math.min(road.length - 20, s0));
      const map = (x, z, yawDeg = 0, y = 0) => {
        const s = Math.max(2, Math.min(road.length - 2, s0 + dir * z));
        const k = Math.min(road.m - 1, Math.floor(s / sp)), u = s / sp - k;
        const cx = road.x[k] + (road.x[k + 1] - road.x[k]) * u, cz = road.z[k] + (road.z[k + 1] - road.z[k]) * u;
        // Right of the direction of travel: −dir × the road's left (dz, −dx).
        const rx = -dir * road.dz[k], rz = dir * road.dx[k];
        const wx = cx + rx * x, wz = cz + rz * x;
        return { x: wx, z: wz, y: roadGround(road, wx, wz) + Math.max(0, y), yaw: yawOf(road.dx[k] * dir, road.dz[k] * dir) - yawDeg * D2R };
      };
      const p = poseAt(road, Math.max(6, Math.min(road.length - 6, s0 - dir * 14)), dir);
      map.start = { x: p.x, y: p.y, z: p.z, yaw: p.yaw };
      return map;
    },
  };
}
