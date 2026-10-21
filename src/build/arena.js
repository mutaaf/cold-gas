// The Sandbox arena: a flat sealed-concrete apron, 400 m square, for building. A course object
// the vehicle drives like any other (src/sim/courses.js `surface` defers to `course.sdf`). Pure.
import { MATERIALS } from '../sim/courses.js';

export const ARENA = { half: 200, id: 'sandbox', name: 'Sandbox' };

export function createArenaCourse() {
  return {
    id: 'sandbox', name: 'Sandbox', boxes: [],
    start: { x: 0, z: -40 },
    runout: { zMin: -Infinity, zMax: Infinity },
    sdf(x, y, z, out) {
      out.x = 0; out.y = 1; out.z = 0; out.mat = MATERIALS.concrete; out.obstacle = false; out.body = null;
      return y;
    },
  };
}

export const inArena = (x, z, margin = 0) => Math.abs(x) <= ARENA.half - margin && Math.abs(z) <= ARENA.half - margin;
