#!/usr/bin/env node
// Flicker budget gate (0050): compares a scripts/flicker.mjs --json run with docs/flicker-budget.json.
//
//   node scripts/flicker-budget.mjs run.json [--budget=docs/flicker-budget.json] [--write]
//
// Every region of every scenario the budget lists (pops ‰, the share of pixel-frames that pop) may
// rise by `tolerance` (25 %) over its budget, or by `floor` ‰, whichever is more (a near-zero region
// moving 0.1 → 0.3 ‰ is noise, not a regression). The z-fight probes (nudge) are budgeted the same
// way. Budgets are per label (engine, GL, screen: "chromium-swiftshader phone"), since a GPU and a
// software rasterizer don't flicker alike. --write sets this run's label to the run's numbers (after
// a change that lowered them, or for a new label); never write a budget up to make a rise pass.
// Exit 0 within budget, 1 over it, 2 when the budget has no entry for the run's label.
import { readFileSync, writeFileSync } from 'node:fs';

export const DEFAULTS = { tolerance: 0.25, floor: 0.5 };

// The pops ‰ a run measured, flattened to { 'scenario/region': ‰ } (nudge: 'nudge/<course>').
export function flatten(results) {
  const out = {};
  for (const [sc, rep] of Object.entries(results || {})) {
    if (!rep) continue;
    if (sc === 'nudge') { for (const [c, v] of Object.entries(rep)) out[`nudge/${c}`] = v.popsPerMille; continue; }
    if (sc === 'nudgeJets') { out['nudge/jets'] = rep.popsPerMille; continue; }
    for (const [r, v] of Object.entries(rep)) out[`${sc}/${r}`] = v.popsPerMille;
  }
  return out;
}

// Each budgeted key against the run: { key, budget, got, limit, status: ok | over | missing }.
// A scenario the run skipped (--only) is 'missing', and doesn't fail; a region the run has that the
// budget lacks is 'new' (reported, not failed: write it in once it is measured).
export function compare(run, budget, opts = {}) {
  const { tolerance, floor } = { ...DEFAULTS, ...opts };
  const got = flatten(run);
  const rows = [];
  for (const [key, b] of Object.entries(budget)) {
    const limit = Math.max(b * (1 + tolerance), b + floor);
    if (!(key in got)) { rows.push({ key, budget: b, got: null, limit, status: 'missing' }); continue; }
    rows.push({ key, budget: b, got: got[key], limit, status: got[key] > limit ? 'over' : 'ok' });
  }
  for (const [key, g] of Object.entries(got)) if (!(key in budget)) rows.push({ key, budget: null, got: g, limit: null, status: 'new' });
  return { rows, pass: rows.every((r) => r.status !== 'over') };
}

function main() {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith('--'));
  const budgetPath = (args.find((a) => a.startsWith('--budget=')) || '--budget=docs/flicker-budget.json').slice(9);
  if (!file) { console.error('usage: node scripts/flicker-budget.mjs run.json [--budget=…] [--write]'); process.exit(2); }
  const run = JSON.parse(readFileSync(file, 'utf8'));
  const doc = JSON.parse(readFileSync(budgetPath, 'utf8'));
  if (args.includes('--write')) {
    doc.budgets[run.label] = { ...(doc.budgets[run.label] || {}), ...flatten(run.results) };
    writeFileSync(budgetPath, JSON.stringify(doc, null, 2) + '\n');
    console.log(`flicker-budget: wrote ${Object.keys(flatten(run.results)).length} entries for "${run.label}"`);
    return;
  }
  const budget = doc.budgets[run.label];
  if (!budget) { console.error(`flicker-budget: no budget for "${run.label}" in ${budgetPath} (measure main and --write it)`); process.exit(2); }
  const { rows, pass } = compare(run.results, budget, { tolerance: doc.tolerance, floor: doc.floor });
  const f = (v) => (v == null ? '—' : v.toFixed(2));
  for (const r of rows) {
    if (r.status === 'ok') continue;
    console.log(`${r.status.padEnd(8)} ${r.key.padEnd(30)} got ${f(r.got)}‰  budget ${f(r.budget)}‰  limit ${f(r.limit)}‰`);
  }
  const n = (s) => rows.filter((r) => r.status === s).length;
  console.log(`flicker-budget "${run.label}": ${n('ok')} ok, ${n('over')} over, ${n('missing')} not run, ${n('new')} unbudgeted`);
  process.exit(pass ? 0 : 1);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
