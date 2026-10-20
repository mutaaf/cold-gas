// Crash probe: flies the reference runs and a set of crash cases, prints each score and what the
// impacts looked like (peak body rate, how far it tipped, bounces, impact events, where the parked
// bodies ended up). A physics-change gate next to physics-bench and naive-players:
//   node scripts/crash-probe.mjs
import { createRun, stepRun } from '../src/sim/run.js';
import { createAutopilot } from '../src/sim/autopilot.js';
import { scoreRun } from '../src/sim/judge.js';
import { newInput, bodyRates, up } from '../src/sim/vehicle.js';
import { v3 } from '../src/sim/m3.js';

const r3 = v3(), u3 = v3();
function fly(course, opts, label = course) {
  const run = createRun(course);
  const ap = typeof opts === 'function' ? opts : createAutopilot(course, opts);
  let maxW = 0, minUp = 1, bounces = 0, wasAir = false;
  while (run.phase !== 'done') {
    stepRun(run, ap(run));
    const c = run.car;
    if (run.t.touchTick > 0 || run.t.contact) {
      bodyRates(c, r3); up(c, u3);
      maxW = Math.max(maxW, Math.hypot(r3.x, r3.y, r3.z)); minUp = Math.min(minUp, u3.y);
      const air = c.grounded === 0 && !c.hullContact;
      if (air && !wasAir) bounces++;
      wasAir = air;
    }
  }
  const card = scoreRun(run.t, { assist: true });
  const imp = run.impacts;
  let peak = 0, parts = '';
  if (imp) {
    const seen = {};
    for (let i = 0; i < imp.count; i++) {
      peak = Math.max(peak, imp.speed[i]);
      seen[imp.part[i]] = (seen[imp.part[i]] || 0) + 1;
    }
    parts = Object.entries(seen).map(([k, n]) => `${k}×${n}`).join(',');
  }
  console.log(label.padEnd(18), card.total.toFixed(2).padStart(6), card.verdict.padEnd(16), run.t.endReason.padEnd(8), String(run.tick).padStart(6),
    '| maxW', maxW.toFixed(1).padStart(4), 'crush', (run.car.crush ? Math.max(...run.car.crush) : 0).toFixed(2), 'minUp', minUp.toFixed(2).padStart(5), 'bounces', bounces, 'flipped', run.t.flipped,
    '| impacts', imp ? `${imp.count} peak ${peak.toFixed(1)} m/s [${parts}]` : '-',
    '| bodies', run.car.world.bodies.map((b) => `${b.id}(${b.cx.toFixed(2)},${b.cz.toFixed(2)},${b.yaw.toFixed(2)})`).join(' '));
  return run;
}
fly('show');
fly('wall');
fly('lineup');
fly('show', { carry: 5 }, 'show carry5');
fly('show', { carry: 3 }, 'show carry3');
fly('show', { carry: 13 }, 'show carry13');
fly('lineup', { apex: 2.5 }, 'lineup apex2.5');
fly('lineup', { rolls: 0.5 }, 'lineup roll180');
fly('lineup', { rolls: 1.25 }, 'lineup roll450');
fly('wall', { releaseAt: 0.6 }, 'wall early');
fly('lineup', (run) => ({ ...newInput(), throttle: Math.hypot(run.car.vel.z) < 12 ? 1 : 0 }), 'lineup ram12');
fly('show', () => ({ ...newInput(), throttle: 1, fan: 1 }), 'show fullthrottle');
