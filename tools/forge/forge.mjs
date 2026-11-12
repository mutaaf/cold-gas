#!/usr/bin/env node
// The forge (0211): real Blender assets, built headless from a seeded archetype, gated, and (with --promote) put into
// the game's modes. Runs on the operator's Mac (needs Blender).
//   npm run forge -- <slot> [--seed N] [--archetype name] [--promote] [--no-turntable]
//   npm run forge -- --all [--promote]
// Slots: sedan suv semi pickup cab (the parked row) · cone barrier (Free Drive / the Sandbox's props).
// Output: tools/forge/out/<slot>-<seed>/ {model.glb, turntable.png, report.json, gate.json}.
import { join } from 'node:path';
import { SLOTS } from './lib/slots.mjs';
import { forgeJob, printVerdict, promote, ROOT } from './lib/run.mjs';

const argv = process.argv.slice(2);
const flag = (k) => argv.includes(`--${k}`);
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const pos = argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && ['--seed', '--archetype', '--script'].includes(argv[i - 1])));
const ids = flag('all') ? Object.keys(SLOTS) : pos;
if (!ids.length) {
  console.log(`usage: npm run forge -- <slot> [--seed N] [--archetype name] [--promote] [--no-turntable]\nslots: ${Object.keys(SLOTS).join(' ')}`);
  process.exit(1);
}
const seed = Number(opt('seed', 0)) | 0;
let failed = 0;
for (const id of ids) {
  const slot = SLOTS[id];
  if (!slot) { console.error(`forge: no slot '${id}' (slots: ${Object.keys(SLOTS).join(' ')})`); failed++; continue; }
  const res = await forgeJob({ slot, seed, archetype: opt('archetype'), script: opt('script'), out: join(ROOT, 'tools/forge/out', `${id}-${seed}`), turntable: !flag('no-turntable') });
  printVerdict(res, `${id} seed ${seed}`);
  if (!res.verdict.ok) { failed++; continue; }
  if (flag('promote')) console.log(`  → promoted: ${promote(res, slot)}`);
}
process.exit(failed ? 1 : 0);
