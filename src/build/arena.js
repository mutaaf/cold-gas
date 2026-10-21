// The Sandbox arena: a flat sealed-concrete apron, 400 m square, for building. A course object
// the vehicle drives like any other (src/sim/courses.js `surface` defers to `course.sdf`). Pure.
import { MATERIALS } from '../sim/courses.js';
import { fixedScenery } from '../sim/scenery.js';

export const ARENA = { half: 200, id: 'sandbox', name: 'Sandbox' };
// The marker masts at the apron's corners (src/build/arena-render.js draws them: 24 m tall, radius
// 0.24 m at the foot to 0.18 m at the top): solid, as steel posts of the mean radius.
export const MASTS = [-1, 1].flatMap((sx) => [-1, 1].map((sz) => ({ x: sx * ARENA.half, z: sz * ARENA.half, r: 0.22, h: 24 })));

export function createArenaCourse() {
  return {
    id: 'sandbox', name: 'Sandbox', boxes: [],
    start: { x: 0, z: -40 },
    runout: { zMin: -Infinity, zMax: Infinity },
    scenery: fixedScenery(MASTS),
    sdf(x, y, z, out) {
      out.x = 0; out.y = 1; out.z = 0; out.mat = MATERIALS.concrete; out.obstacle = false; out.body = null;
      return y;
    },
  };
}

export const inArena = (x, z, margin = 0) => Math.abs(x) <= ARENA.half - margin && Math.abs(z) <= ARENA.half - margin;
