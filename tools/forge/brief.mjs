#!/usr/bin/env node
// The forge from a brief (0211): Claude writes a Blender build script against the forge's kit, the forge runs it headless,
// gates it (budget, the slot's physics box, closed solids, no lettering or emblems, no real names) and saves everything
// for review. Runs on the operator's Mac (needs Blender, and ANTHROPIC_API_KEY for the model).
//   npm run forge:brief -- "<a trope or an era>" [--slot cab] [--seed N] [--tries 3] [--promote]
//   npm run forge:brief -- --script path/to/build.py [--slot cab] [--brief "…"]   (no model call: check and run a script)
// Pop culture means TROPES AND ERAS ONLY: never a specific film/show/game vehicle or character, a brand, a badge, a logo
// or a real model. The prompt says so (lib/prompt.mjs), the brief and the script are screened for real names, and the
// gate refuses lettering-like geometry. Nothing about the operator goes into the request: the brief, the slot's spec and
// the kit's reference only.
// Output: tools/forge/briefs/<date>-<slug>/ {brief.txt, request.json, reply-N.md, build-N.py, build.py, model.glb,
// turntable.png, report.json, gate.json, usage.json}.
import { copyFileSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { SLOTS } from './lib/slots.mjs';
import { forgeJob, printVerdict, promote, ROOT } from './lib/run.mjs';
import { bannedIn } from './lib/gate.mjs';
import { buildPrompt, scriptFrom, repairPrompt } from './lib/prompt.mjs';

export const MODEL = 'claude-opus-5-5';

const argv = process.argv.slice(2);
const flag = (k) => argv.includes(`--${k}`);
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const valued = ['--slot', '--seed', '--tries', '--script', '--brief', '--out'];
const brief = (opt('brief') || argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && valued.includes(argv[i - 1]))).join(' ')).trim();
const slot = SLOTS[opt('slot', 'cab')];
const seed = Number(opt('seed', 0)) | 0;
const tries = Math.max(1, Math.min(5, Number(opt('tries', 3)) | 0));
const die = (msg, code = 1) => { console.error(`forge:brief: ${msg}`); process.exit(code); };

if (!slot) die(`no slot '${opt('slot')}' (slots: ${Object.keys(SLOTS).join(' ')})`);
if (!brief && !opt('script')) die('usage: npm run forge:brief -- "<a trope or an era, e.g. an 80s rally hatch with light pods>" [--slot cab] [--promote]');
const names = bannedIn(brief);
if (names.length) die(`the brief names something real (${names.join(', ')}). Briefs are tropes and eras only: describe the genre and the decade, not a make, a model, a film or a character.`);

const slug = (brief || 'script').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'brief';
const dir = opt('out') ? join(ROOT, opt('out')) : join(ROOT, 'tools/forge/briefs', `${new Date().toISOString().slice(0, 10)}-${slug}`);
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, 'brief.txt'), `${brief}\nslot: ${slot.id}\nseed: ${seed}\n`);

async function runScript(path, n) {
  const src = readFileSync(path, 'utf8');
  const found = bannedIn(src);
  if (found.length) return { verdict: { ok: false, failures: [`the script names something real: ${found.join(', ')}`], facts: {} }, report: {} };
  if (join(ROOT, path) !== join(dir, `build-${n}.py`) && path !== join(dir, `build-${n}.py`)) copyFileSync(path, join(dir, `build-${n}.py`));
  const res = await forgeJob({ slot, seed, script: join(dir, `build-${n}.py`), out: dir, id: `${slot.id}-brief-${slug}` });
  printVerdict(res, `${slug} (try ${n})`);
  return res;
}

let result;
if (opt('script')) {
  result = await runScript(opt('script'), 1);
} else {
  if (!process.env.ANTHROPIC_API_KEY) {
    die('no ANTHROPIC_API_KEY in the environment. The brief path asks Claude to write the build script, so it needs a key.\n' +
      'The parametric forge works without one: npm run forge -- <slot> [--seed N]. To run a script you already have: npm run forge:brief -- --script <file.py> --slot <slot>.', 2);
  }
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic();
  const { system, user } = buildPrompt({ brief, slot, root: ROOT });
  const messages = [{ role: 'user', content: user }];
  writeFileSync(join(dir, 'request.json'), JSON.stringify({ model: MODEL, system, messages }, null, 1));
  const usage = [];
  for (let n = 1; n <= tries; n++) {
    const stream = client.beta.messages.stream({
      model: MODEL, max_tokens: 32000, system, messages,
      thinking: { type: 'adaptive' }, output_config: { effort: 'high' },
      betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default',
    });
    const reply = await stream.finalMessage();
    usage.push({ try: n, model: reply.model, stop: reply.stop_reason, usage: reply.usage });
    writeFileSync(join(dir, 'usage.json'), JSON.stringify(usage, null, 1));
    if (reply.stop_reason === 'refusal') die(`the model declined the brief (${reply.stop_details?.category ?? 'no category'}). Rephrase it as a trope or an era.`);
    const text = reply.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
    writeFileSync(join(dir, `reply-${n}.md`), text);
    const code = scriptFrom(text);
    if (!code) {
      messages.push({ role: 'assistant', content: reply.content }, { role: 'user', content: 'Answer with the whole script in one ```python block.' });
      continue;
    }
    writeFileSync(join(dir, `draft-${n}.py`), code);
    result = await runScript(join(dir, `draft-${n}.py`), n);
    if (result.verdict.ok) break;
    messages.push({ role: 'assistant', content: reply.content }, { role: 'user', content: repairPrompt(result.verdict.failures, result.report?.trace) });
  }
}
if (!result) die('no script came back that could be run');
if (existsSync(join(dir, 'build-1.py'))) {
  const last = [5, 4, 3, 2, 1].find((k) => existsSync(join(dir, `build-${k}.py`)));
  copyFileSync(join(dir, `build-${last}.py`), join(dir, 'build.py'));
}
console.log(`forge:brief: ${result.verdict.ok ? 'PASS' : 'FAIL'} · review ${dir}/turntable.png`);
if (result.verdict.ok && flag('promote')) console.log(`  → promoted into the ${slot.id} slot: ${promote(result, slot, { brief })}`);
process.exit(result.verdict.ok ? 0 : 1);
