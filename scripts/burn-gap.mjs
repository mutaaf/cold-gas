// 0169: the down-jets' one burn, read per tick (LESSONS 2026-11-06: a 0.25 s mean hid the jets going
// out). Wrap each stepRun: before(car), then after(car). gap(run) is the longest span (s), from the
// flight's peak sink to the wheels, under 0.5 g of specific force while sinking faster than 1 m/s
// (the critic's rule, docs/critique/2026-11-06-0950.md). 0 when the flight never touched down.
import { SPEC } from '../src/sim/spec.js';

export function createGapProbe() {
  const g = [], sink = [], h = [];
  let vx = 0, vy = 0, vz = 0;
  return {
    before(c) { vx = c.vel.x; vy = c.vel.y; vz = c.vel.z; },
    after(c) {
      g.push(Math.hypot((c.vel.x - vx) * 240, (c.vel.y - vy) * 240 + 9.81, (c.vel.z - vz) * 240) / 9.81);
      sink.push(-c.vel.y); h.push(c.pos.y - SPEC.comHeight);
    },
    // { gap: s, rise: m/s the sink climbs back above its lowest since the peak (above 1.2 m) }
    read(run) {
      const end = Math.min(sink.length, run.t.touchTick > 0 ? run.t.touchTick : 0);
      let pk = 0;
      for (let i = 0; i < end; i++) if (sink[i] > sink[pk]) pk = i;
      let gap = 0, cur = 0, rise = 0, low = Infinity;
      for (let i = pk; i < end; i++) {
        cur = g[i] < 0.5 && sink[i] > 1 ? cur + 1 : 0;
        gap = Math.max(gap, cur);
        if (h[i] > 1.2) { low = Math.min(low, sink[i]); rise = Math.max(rise, sink[i] - low); }
      }
      return { gap: gap / 240, rise };
    },
  };
}
