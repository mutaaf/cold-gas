#!/usr/bin/env node
// The soak's verdict (0302; ios/scripts/soak.sh): reads the app's `SOAK step …` lines and says whether memory kept growing
// or anything was reported. Pure, so tests/unit/soak-check.test.js holds the rule.
//
//   node scripts/soak-check.mjs <log>          prints the verdict; exit 0 pass, 1 fail, 2 the soak never finished
//
// The rule: the baseline is the mean footprint of the first full cycle after the warm-up (every stage, flight and world
// built once); the end is the mean of the last cycle. It fails when the end is more than GROWTH_MB and GROWTH_SHARE above
// the baseline (a leak shows as a climb, cycle after cycle; a cache filling once doesn't), or when any fault was reported.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const SOAK = { stepsPerCycle: 5, warmupCycles: 1, growthMb: 64, growthShare: 0.2 };

const STEP = /^SOAK step (\d+) cycle (\d+) (\S+) mem (\d+) faults (\d+)/;
const DONE = /^SOAK done cycles (\d+) steps (\d+) mem first (\d+) last (\d+) peak (\d+) faults (\d+)(?: · (.*))?/;

export function parseSoak(text) {
  const steps = [], out = { steps, done: null };
  for (const line of String(text).split('\n')) {
    let m = STEP.exec(line);
    if (m) { steps.push({ step: +m[1], cycle: +m[2], what: m[3], mem: +m[4], faults: +m[5] }); continue; }
    m = DONE.exec(line);
    if (m) out.done = { cycles: +m[1], steps: +m[2], first: +m[3], last: +m[4], peak: +m[5], faults: +m[6], what: m[7] || '' };
  }
  return out;
}

const mean = (xs) => (xs.length ? xs.reduce((a, x) => a + x, 0) / xs.length : 0);

// → { ok, finished, cycles, baseline, end, growth, peak, faults, why: [] }
export function verdict(parsed, rule = SOAK) {
  const { steps, done } = parsed;
  const why = [];
  const byCycle = new Map();
  for (const s of steps) { if (!byCycle.has(s.cycle)) byCycle.set(s.cycle, []); byCycle.get(s.cycle).push(s); }
  const full = [...byCycle.entries()].filter(([, ss]) => ss.length >= rule.stepsPerCycle).sort((a, b) => a[0] - b[0]);
  const base = full.find(([c]) => c >= rule.warmupCycles) || null;
  const last = full.length ? full[full.length - 1] : null;
  const baseline = base ? Math.round(mean(base[1].map((s) => s.mem))) : null;
  const end = last ? Math.round(mean(last[1].map((s) => s.mem))) : null;
  const growth = baseline != null && end != null ? end - baseline : null;
  const faults = done ? done.faults : steps.reduce((m, s) => Math.max(m, s.faults), 0);
  if (!done) why.push('the soak never printed SOAK done (it crashed, hung or was cut short)');
  if (!base || !last || base[0] === last[0]) why.push(`too few cycles to judge memory (${full.length} full)`);
  else if (growth > rule.growthMb && growth > rule.growthShare * baseline) why.push(`memory grew ${growth} MB (${baseline} → ${end} MB, more than ${rule.growthMb} MB and ${Math.round(rule.growthShare * 100)} %)`);
  if (faults > 0) why.push(`${faults} fault(s) reported${done?.what ? `: ${done.what}` : ''}`);
  return { ok: why.length === 0, finished: !!done, cycles: full.length, baseline, end, growth, peak: done?.peak ?? Math.max(0, ...steps.map((s) => s.mem)), faults, why };
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const file = process.argv[2];
  if (!file) { console.error('usage: node scripts/soak-check.mjs <log>'); process.exit(64); }
  const v = verdict(parseSoak(readFileSync(file, 'utf8')));
  console.log(`soak: ${v.cycles} full cycles · memory ${v.baseline ?? '?'} → ${v.end ?? '?'} MB (growth ${v.growth ?? '?'} MB, peak ${v.peak} MB) · faults ${v.faults}`);
  for (const w of v.why) console.log(`  ✗ ${w}`);
  console.log(v.ok ? 'PASS' : 'FAIL');
  process.exit(v.ok ? 0 : v.finished ? 1 : 2);
}
