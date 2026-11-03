// Can the players who fly a Daily meet it? (0135) For every objective in src/daily.js, the share of its course's
// population that meets it (scripts/lib/daily-reach.mjs names the three populations and how each is flown).
// The floor is 30 % (tests/unit/daily-reach.test.js holds it on a smaller seeded sample).
//
//   node scripts/daily-reach.mjs [n=150] [--seed=12345]
import { initPhysics } from '../src/sim/engine.js';
import { reach, POPULATION } from './lib/daily-reach.mjs';
import { OBJECTIVES } from '../src/daily.js';
await initPhysics();
const args = process.argv.slice(2);
const n = +(args.find((a) => /^\d+$/.test(a)) || 150);
const seed = +((args.find((a) => a.startsWith('--seed=')) || '').slice(7) || 12345);
const FLOOR = 0.3;
console.log(`Daily reach · n ${n} per population and course · seed ${seed} · floor ${FLOOR * 100} %`);
for (const [k, v] of Object.entries(POPULATION)) console.log(`  ${k.padEnd(6)} ${v}`);
let low = 0;
for (const r of reach({ n, seed })) {
  const goal = OBJECTIVES.find((o) => o.id === r.id).goal();
  if (r.share < FLOOR) low++;
  console.log(`${r.share < FLOOR ? '✗' : '✓'} ${r.id.padEnd(13)} ${r.course.padEnd(7)} ${r.population.padEnd(6)} ${String(r.met).padStart(4)}/${r.n} ${String(Math.round(r.share * 100)).padStart(3)} %  ${goal}`);
}
console.log(low ? `${low} objective(s) under the floor` : 'every objective at or over the floor');
process.exitCode = low ? 1 : 0;
