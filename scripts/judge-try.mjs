import { createRun, stepRun, simulate } from '../src/sim/run.js';
import { createAutopilot } from '../src/sim/autopilot.js';
import { scoreRun } from '../src/sim/judge.js';
for (const o of [{}, {rolls:2,apex:9}, {speed:19}, {apex:4}, {rolls:0}]) {
  const run = createRun(); const ap = createAutopilot(o);
  while (run.phase !== 'done') stepRun(run, ap(run));
  const s = scoreRun(run.t);
  const re = simulate(run.inputLog); const s2 = scoreRun(re.t);
  console.log(JSON.stringify(o), s.total, s.verdict, JSON.stringify(s.categories), 'replay-match', s2.total === s.total && re.tick === run.tick, 'log', run.inputLog.length);
}
