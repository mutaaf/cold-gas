#!/usr/bin/env node
// Self-heal, agent side: pull production's /obs/digest and file a backlog ticket (docs/backlog/,
// the same format the Scout and the Critic write, validated by scripts/check-backlog.mjs) for every
// new or regressed error signature and every frame-time regression that doesn't have one yet. The
// Builder then picks them up like any other `ready` ticket (P0 first).
//
//   npm run heal                         file tickets (at most 3 a run)
//   npm run heal -- --dry                print what it would file
//   npm run heal -- --check              exit 2 if the digest flags something with no ticket (files nothing)
//   npm run heal -- --digest=<url|file>  another digest (default: production; env COLDGAS_OBS_DIGEST)
//   npm run heal -- --max=5
//
// Dedupe: each ticket carries `obs: <signature key>@<build>` in its frontmatter. A key with an open
// ticket (proposed / ready / in-progress) is skipped; one whose ticket shipped and that comes back in
// a newer build gets a new "recurred" ticket that links the old one.
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const DIR = 'docs/backlog';
const arg = (k, d = null) => { const a = process.argv.find((x) => x === `--${k}` || x.startsWith(`--${k}=`)); return a ? (a.includes('=') ? a.slice(a.indexOf('=') + 1) : true) : d; };
const DRY = !!arg('dry'), CHECK = !!arg('check'), MAX = Number(arg('max', 3)) || 3;
const SRC = arg('digest', process.env.COLDGAS_OBS_DIGEST || 'https://mutaafaziz.com/coldgas/api/obs/digest');

export function readTickets(dir = DIR) {
  return readdirSync(dir).filter((f) => /^\d{4}-.+\.md$/.test(f)).map((file) => {
    const text = readFileSync(join(dir, file), 'utf8');
    const fm = {};
    for (const line of (text.match(/^---\n([\s\S]*?)\n---\n/)?.[1] || '').split('\n')) {
      const kv = line.match(/^(\w[\w-]*):\s*(.*?)\s*(#.*)?$/);
      if (kv) fm[kv[1]] = kv[2];
    }
    const [key, build] = (fm.obs || '').split('@');
    return { file, id: Number(fm.id), status: fm.status, key: key || null, build: build || null };
  });
}

// → [{ reg, recurredFrom? }] to file, in priority order.
export function plan(digest, tickets) {
  const out = [];
  for (const reg of digest?.regressions || []) {
    const mine = tickets.filter((t) => t.key === reg.key);
    if (mine.some((t) => ['proposed', 'ready', 'in-progress'].includes(t.status))) continue;
    const shipped = mine.filter((t) => t.status === 'shipped');
    if (mine.length && !shipped.length) continue;                       // dropped on purpose
    if (shipped.some((t) => t.build === reg.cur.build)) continue;       // already ticketed for this build
    out.push({ reg, recurredFrom: shipped.length ? shipped[shipped.length - 1] : null });
  }
  return out;
}

const slug = (s) => String(s).toLowerCase().replace(/<[^>]+>/g, ' ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'obs';
const pct = (x) => `${Math.round(x * 1000) / 10} %`;
const MODULE_FILES = {
  physics: 'src/sim/ (engine.js, world.js, vehicle.js) and the WASM build (src/vendor/rapier3d.js)', webgl: 'src/render/scene.js, src/obs/heal.js (context restore)',
  shader: 'src/render/ (the material named in the program log)', render: 'src/render/', audio: 'src/audio.js', judge: 'src/ai/ and src/worker/ai/',
  world: 'src/world/ (endless-world.js, terrain.worker.js)', rocket: 'src/render/rocket.js', net: 'src/net.js and the route named in the message',
  lazy: 'the dynamic import named in the stack (vite chunking)', nerds: 'src/nerds.js', frame: 'src/main.js frameBody and the function in the top frame',
  page: 'whatever ran out of memory or hung: check the frame regressions too', app: 'the function in the top frame',
};

export function ticketFor({ reg, recurredFrom }, id, today) {
  const frames = reg.type === 'frames';
  const title = frames
    ? `Frame time regressed on ${reg.dc} at ${reg.tier}: p95 ${reg.prev.p95} → ${reg.cur.p95} ms in build ${reg.cur.build}`
    : `${recurredFrom ? 'Recurred' : reg.status === 'new' ? 'New' : 'Regressed'} in ${reg.cur.build}: ${reg.mod} ${reg.kind} "${reg.msg.slice(0, 70)}"`;
  const evidence = frames
    ? [`- Device class ${reg.dc}, tier ${reg.tier}.`,
      `- Build ${reg.cur.build}: ${reg.cur.frames.toLocaleString('en-US')} frames, p50 ${reg.cur.p50} · p95 ${reg.cur.p95} · p99 ${reg.cur.p99} ms, ${reg.cur.hitchesPerKFrames} hitches per 1k frames.`,
      `- Build ${reg.prev.build}: ${reg.prev.frames.toLocaleString('en-US')} frames, p50 ${reg.prev.p50} · p95 ${reg.prev.p95} · p99 ${reg.prev.p99} ms, ${reg.prev.hitchesPerKFrames} hitches per 1k frames.`]
    : [`- Signature key \`${reg.key}\` (sig \`${reg.sig}\` in ${reg.cur.build}), module **${reg.mod}**, kind **${reg.kind}**.`,
      `- Message: \`${reg.msg}\``,
      `- Top frame: \`${reg.fr || 'none'}\``,
      `- Build ${reg.cur.build}: ${reg.cur.n} occurrences in ${reg.cur.sessions} session(s), ${pct(reg.cur.rate)} of sessions' worth.`,
      reg.prev ? `- Build ${reg.prev.build}: ${reg.prev.n} occurrences in ${reg.prev.sessions} session(s), ${pct(reg.prev.rate)}.` : '- Not seen in any earlier build in the 14-day window.',
      ...(reg.stacks || []).map((s) => `- Stack (${s.build}): \`${s.st}\``)];
  const fm = [
    '---', `id: ${String(id).padStart(4, '0')}`, `title: ${title.replace(/[\n#]/g, ' ')}`, 'status: ready', `priority: ${reg.severity === 'P0' ? 'P0' : 'P1'}`, 'size: M',
    `lens: ${frames ? 'performance' : 'tech-health'}`, `created: ${today}`, 'pr:', 'by: operator', `obs: ${reg.key}@${reg.cur.build}`, '---', '',
  ];
  const body = [
    '## Why',
    `Production's observability digest (\`GET /coldgas/api/obs/digest\`, filed by \`scripts/heal.mjs\`) flags this as **${recurredFrom ? `recurred (it shipped in ${recurredFrom.file})` : reg.status}** against the previous build. Players hit it in the field; nobody reported it.`,
    '', ...evidence, '',
    '## What',
    frames
      ? `Find what made frames slower on ${reg.dc} at the ${reg.tier} tier between ${reg.prev.build} and ${reg.cur.build} (\`git log ${reg.prev.build}..${reg.cur.build}\`), and win the time back. Profile with \`node scripts/perf.mjs\` / \`scripts/perf-drive.mjs\` at that tier; For nerds → Health shows the live histogram.`
      : `Reproduce from the stack and fix the cause in ${MODULE_FILES[reg.mod] || MODULE_FILES.app}. The self-heal layer (src/obs/heal.js) already contains it in the page; the fix removes it. ${reg.prev ? `Diff ${reg.prev.build}..${reg.cur.build} first.` : `It is new in ${reg.cur.build}: \`git log -5 ${reg.cur.build}\` names the suspects.`}`,
    '',
    '## Acceptance criteria',
    frames
      ? `- [ ] p95 on ${reg.dc} at ${reg.tier} back to ≤ ${Math.round(reg.prev.p95 * 1.1 * 10) / 10} ms in the next digest (≥ 1,000 frames)`
      : `- [ ] A unit or e2e test reproduces \`${reg.msg.slice(0, 60)}\` and passes after the fix`,
    frames ? '- [ ] The perf probe that shows it is in the PR body, before and after' : `- [ ] Key \`${reg.key}\` is absent from the next build's digest regressions`,
    '- [ ] Works at 390x844 touch and 1280x720 keyboard/mouse',
    '- [ ] No frame-time regression (e2e perf probe within budget)',
    '',
    '## Test plan',
    frames ? 'Measure with the perf scripts at the regressed tier before and after; after merge, `npm run heal -- --check` must not flag this key once the new build has data.'
      : 'Add the failing test first (tests/unit for logic, tests/e2e for a flow), fix, then confirm the next digest no longer lists the key.',
    '',
    '## Out of scope',
    'Silencing the error or widening the self-heal: the point is to remove the cause.',
    '',
  ];
  return { file: `${String(id).padStart(4, '0')}-obs-${slug(frames ? `${reg.dc}-${reg.tier}-frames` : `${reg.mod}-${reg.msg}`)}.md`, text: [...fm, ...body].join('\n') };
}

async function loadDigest(src) {
  if (/^https?:/.test(src)) {
    const res = await fetch(src, { headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error(`digest ${res.status}`);
    return res.json();
  }
  return JSON.parse(readFileSync(src, 'utf8'));
}

async function main() {
  const digest = await loadDigest(SRC);
  const tickets = readTickets();
  const todo = plan(digest, tickets);
  console.log(`heal: digest ${digest.current?.build || '—'} vs ${digest.previous?.build || '—'} · ${digest.regressions?.length || 0} flagged · ${todo.length} without a ticket`);
  if (CHECK) { for (const t of todo) console.log(`  needs a ticket: ${t.reg.key} ${t.reg.status} ${t.reg.msg || t.reg.dc}`); process.exit(todo.length ? 2 : 0); }
  let id = Math.max(0, ...tickets.map((t) => t.id).filter(Number.isFinite));
  const today = new Date().toISOString().slice(0, 10);
  for (const item of todo.slice(0, MAX)) {
    const t = ticketFor(item, ++id, today);
    if (DRY) { console.log(`\n--- ${t.file}\n${t.text}`); continue; }
    if (existsSync(join(DIR, t.file))) { console.log(`  exists: ${t.file}`); continue; }
    writeFileSync(join(DIR, t.file), t.text);
    console.log(`  filed ${t.file}`);
  }
  if (todo.length > MAX) console.log(`  ${todo.length - MAX} more next run (--max=${MAX})`);
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((err) => { console.error('heal:', err.message); process.exit(1); });
