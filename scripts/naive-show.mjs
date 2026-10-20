// Can an ordinary player fly the Show with Assist? Crawl up at the cue's speed (4–9 m/s), climb, tap RELEASE at the ledge, hold BOOST for
// a while to carry out over the row, then just hold LAND. The physics decides who clears the roofs.
import { createRun, stepRun, wallProgress } from '../src/sim/run.js';
import { newInput } from '../src/sim/vehicle.js';
import { scoreRun } from '../src/sim/judge.js';
const strategies = [];
for (const climb of [4, 6, 9]) for (const releaseAt of [0.85, 0.97, 1.01]) for (const boost of [0, 0.15, 0.25, 0.35, 0.5, 0.8]) strategies.push({ climb, releaseAt, boost });
let landed = 0, cleared = 0;
for (const st of strategies) {
  const run = createRun('show');
  let released = false, boostT = 0;
  while (run.phase !== 'done') {
    const c = run.car, inp = newInput(); inp.assist = 1;
    inp.steer = Math.max(-1, Math.min(1, c.pos.x * 0.25));
    if (run.phase === 'drive') { inp.throttle = Math.hypot(c.vel.x, c.vel.z) < 6 ? 1 : 0; inp.fan = 1; }
    else if (run.phase === 'ramp' && !released) {
      const v = Math.hypot(c.vel.x, c.vel.y, c.vel.z);
      inp.throttle = v < st.climb ? 0.8 : 0; inp.brake = v > st.climb + 1.5 ? 0.3 : 0; inp.fan = 1;   // crawl, as the cue says
      if (wallProgress(c.pos) >= st.releaseAt) released = true;
      if (released) inp.lift = 1;
    } else if (run.phase === 'ramp' || run.phase === 'air') {
      if (boostT < st.boost) { inp.thrust = 1; boostT += 1 / 240; } else inp.level = 1;
    } else inp.brake = 1;
    stepRun(run, inp);
  }
  const s = scoreRun(run.t, { assist: true }), t = run.t;
  const ok = t.settledUpright && !t.landedOnRamp && !t.fellOff && t.touchTick > 0 && !t.contact;
  if (ok) landed++;
  if (ok && t.crossedRow) cleared++;
  console.log(JSON.stringify(st).padEnd(52), ok ? (t.crossedRow ? 'CLEARED' : 'short  ') : 'crash  ', s.verdict.padEnd(18), String(s.total).padStart(5), 'clear', Number.isFinite(t.minClearance) ? t.minClearance.toFixed(1) : '-', 'sink', t.sink.toFixed(1), 'gas', s.facts.airPct, 'end', t.endReason, 'landZ', t.landZ.toFixed(0));
}
console.log(`${landed}/${strategies.length} landed clean, ${cleared} of them over the row`);
