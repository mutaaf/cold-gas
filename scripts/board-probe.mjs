// Does the board take an entry? Flies the reference Show in Node (the same sim the browser runs), then
// POSTs it to <url>api/scores with `dry: true`: the Worker runs every check and scores it from the run's
// telemetry, answers the card and the rank it would get, and stores nothing. Exit 0 only for a 200 with a
// card. Never point this at production with dry:false: it has no flag for that, on purpose.
//
//   node scripts/board-probe.mjs [url]     (default https://mutaafaziz.com/coldgas/)
import { createRun, stepRun } from '../src/sim/run.js';
import { createAutopilot } from '../src/sim/autopilot.js';
import { scoreRun } from '../src/sim/judge.js';
import { initPhysics } from '../src/sim/engine.js';

const base = (process.argv[2] || 'https://mutaafaziz.com/coldgas/').replace(/\/?$/, '/');
await initPhysics();
const run = createRun('show'); const ap = createAutopilot('show');
while (run.phase !== 'done') stepRun(run, ap(run));
const local = scoreRun(run.t, { assist: true });
// The body the game sends (src/panel.js postScore), JSON as the browser makes it (Infinity → null), with no
// initials: a Worker that knows `dry` needs none for it, and one from before `dry` answers 400 'initials'
// instead of storing the probe as a real entry. Safe against any Worker, by construction.
const body = { log: run.inputLog, t: JSON.parse(JSON.stringify(run.t)), course: 'show', dry: true };
const url = `${base}api/scores`;
const t0 = Date.now();
let res, json = null, text = '';
try {
  res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(20_000) });
  text = await res.text();
  try { json = JSON.parse(text); } catch { /* not JSON: a 1102 page, a proxy error */ }
} catch (err) {
  console.error(`board-probe: ${url} unreachable: ${err.message}`);
  process.exit(1);
}
const ms = Date.now() - t0;
console.log(`board-probe: POST ${url} (dry) → ${res.status} in ${ms} ms; local card ${local.total} ${local.verdict}`);
if (res.status !== 200 || !json?.card || !Number.isFinite(json.card.total)) {
  console.error(`board-probe: FAIL ${json ? JSON.stringify(json) : text.slice(0, 300)}`);
  process.exit(1);
}
console.log(`board-probe: OK ${json.card.total} ${json.card.verdict} · ${json.tier} · would rank #${json.rank} today on ${json.course}${json.dry ? ' (dry: nothing stored)' : ''}`);
if (Math.abs(json.card.total - local.total) > 0.05) {
  console.error(`board-probe: FAIL the server's card (${json.card.total}) differs from the local one (${local.total})`);
  process.exit(1);
}
if (json.dry !== true) console.warn('board-probe: WARNING the server did not echo dry: true (an older Worker?)');
