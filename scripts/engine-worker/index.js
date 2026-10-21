// The Worker leg of the engine determinism check (docs/PHYSICS_ENGINE.md): the same spike, and a
// full replay of the reference runs, inside workerd. Test-only; never deployed.
//   npx wrangler dev --config scripts/engine-worker/wrangler.jsonc --port 8799
//   curl localhost:8799            → { spike: { hash }, runs: { show: {...}, ... } }
import wasm from '@dimforge/rapier3d-deterministic/rapier_wasm3d_bg.wasm';
import { initPhysics, RAPIER } from '../../src/sim/engine.js';
import { engineSpike } from '../engine-spike.js';

export default {
  async fetch(req) {
    await initPhysics(wasm);
    const out = { spike: engineSpike(RAPIER) };
    if (req.method === 'POST') {
      const { simulate } = await import('../../src/sim/run.js');
      const { scoreRun } = await import('../../src/sim/judge.js');
      const logs = await req.json();
      out.runs = {};
      for (const [course, log] of Object.entries(logs)) {
        const run = simulate(log, course), c = run.car;
        out.runs[course] = { tick: run.tick, bits: [c.pos.x, c.pos.y, c.pos.z, c.quat.w, c.air, ...c.world.bodies.flatMap((b) => [b.cx, b.cy, b.cz, b.qw])].map((v) => v.toString()).join(','), total: scoreRun(run.t, { assist: true }).total };
      }
    }
    return Response.json(out);
  },
};
