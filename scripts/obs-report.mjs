#!/usr/bin/env node
// The owner's one screen on production health (0293; docs/AUDIT-2026-11-18.md "How the owner sees it"): production's
// /obs/digest, split into the web and the iPhone app (builds `ios-<version>-<build>`), with the top signatures of each,
// the flagged regressions and the last days of the players' funnel. Its exit code is the alert:
//
//   2  page someone: a P0 regression (the Worker's rule: a fatal kind, physics/webgl, or ≥ 10 % of sessions), an iPhone
//      build with ≥ 3 crashes or ≥ 5 hangs in the window, or any iPhone render/shader failure (a black stage)
//   1  look today: a P1 regression, or any signature on the newest iPhone build
//   0  quiet
//
//   npm run obs:report                        production
//   npm run obs:report -- --json              the summary as JSON (for a tool or an agent)
//   npm run obs:report -- --digest=<url|file> another digest (env COLDGAS_OBS_DIGEST)
//
// Reads only. An iPhone crash frame `0x1a2b3c@ColdGas` symbolicates with that build's dSYM:
//   atos -arch arm64 -o ColdGas.app.dSYM/Contents/Resources/DWARF/ColdGas -l 0x100000000 0x1001a2b3c
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const ALERT = { iosCrashes: 3, iosHangs: 5 };
const isIos = (b) => /^ios-/.test(b || '');
const verKey = (b) => (b.match(/^ios-([\d.]+)(?:-(\d+))?/) || []).slice(1).map((p, i) => (i ? Number(p || 0) : (p || '0').split('.').map(Number)));
const newerIos = (a, b) => {
  const [va, ba] = verKey(a), [vb, bb] = verKey(b);
  for (let i = 0; i < Math.max(va.length, vb.length); i++) if ((va[i] || 0) !== (vb[i] || 0)) return (va[i] || 0) > (vb[i] || 0);
  return ba > bb;
};

// digest → { web, ios, regressions, players, alerts: [{ level, why }], exit }
export function summarize(digest) {
  const top = digest?.top || [];
  const web = top.filter((r) => !(r.builds || []).every(isIos));
  const ios = top.filter((r) => (r.builds || []).length && (r.builds || []).every(isIos));
  const iosBuilds = [...new Set(ios.flatMap((r) => r.builds))].sort((a, b) => (newerIos(a, b) ? -1 : 1));
  const newest = iosBuilds[0] || null;
  const regressions = digest?.regressions || [];
  const alerts = [];
  for (const r of regressions) alerts.push({ level: r.severity === 'P0' ? 2 : 1, why: `${r.severity} ${r.status} ${r.type === 'frames' ? `frames ${r.dc}/${r.tier}` : `${r.mod}/${r.kind} "${r.msg}"`} on ${r.cur?.build}` });
  const crashes = ios.filter((r) => r.kind === 'unclean').reduce((a, r) => a + r.n, 0);
  const hangs = ios.filter((r) => r.kind === 'frame').reduce((a, r) => a + r.n, 0);
  if (crashes >= ALERT.iosCrashes) alerts.push({ level: 2, why: `iPhone: ${crashes} crashes or kills in the window (≥ ${ALERT.iosCrashes})` });
  if (hangs >= ALERT.iosHangs) alerts.push({ level: 2, why: `iPhone: ${hangs} hangs or slow launches in the window (≥ ${ALERT.iosHangs})` });
  for (const r of ios.filter((x) => x.mod === 'render' || x.mod === 'shader')) alerts.push({ level: 2, why: `iPhone: the stage failed to draw: "${r.msg}" ×${r.n} (${r.builds.join(', ')})` });
  if (newest) for (const r of ios.filter((x) => x.builds.includes(newest))) alerts.push({ level: 1, why: `iPhone ${newest}: ${r.mod}/${r.kind} "${r.msg}" ×${r.n}` });
  const players = (digest?.players?.days || []).slice(0, 3);
  const exit = alerts.reduce((m, a) => Math.max(m, a.level), 0);
  return { generated: digest?.generated || null, current: digest?.current?.build || null, previous: digest?.previous?.build || null,
    web, ios, iosBuilds, regressions, players, alerts, exit };
}

const row = (r) => `  ${String(r.n).padStart(6)}  ${`${r.mod}/${r.kind}`.padEnd(16)} ${r.msg.slice(0, 70).padEnd(70)}  ${r.fr || ''}`;
export function render(s) {
  const out = [];
  out.push(`COLD GAS health · digest ${s.generated || '?'} · web ${s.current || '—'} vs ${s.previous || '—'}`);
  out.push('', `Web: top signatures (${s.web.length})`);
  out.push(...(s.web.length ? s.web.slice(0, 10).map(row) : ['  none']));
  out.push('', `iPhone: top signatures (${s.ios.length}) · builds ${s.iosBuilds.join(', ') || '—'}`);
  out.push(...(s.ios.length ? s.ios.slice(0, 10).map(row) : ['  none']));
  out.push('', `Regressions flagged (${s.regressions.length})`);
  out.push(...(s.regressions.length ? s.regressions.map((r) => `  ${r.severity} ${r.status.padEnd(9)} ${r.type === 'frames' ? `frames ${r.dc}/${r.tier}` : `${r.mod}/${r.kind} ${r.msg}`}`) : ['  none']));
  out.push('', 'Players (last days)');
  for (const d of s.players) out.push(`  ${d.day}  people ${d.human ?? 0}  runs ${d.run ?? 0}  landed ${d['run-landed'] ?? 0}  wrecked ${d['run-wrecked'] ?? 0}  posts ${d.post ?? 0}  post-fail ${d['post-fail'] ?? 0}`);
  out.push('', s.alerts.length ? `ALERT (exit ${s.exit})` : 'Quiet (exit 0)');
  for (const a of s.alerts) out.push(`  [${a.level}] ${a.why}`);
  return out.join('\n');
}

async function load(src) {
  if (/^https?:/.test(src)) {
    const res = await fetch(src, { headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error(`digest ${res.status}`);
    return res.json();
  }
  return JSON.parse(readFileSync(src, 'utf8'));
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const arg = (k, d = null) => { const a = process.argv.find((x) => x === `--${k}` || x.startsWith(`--${k}=`)); return a ? (a.includes('=') ? a.slice(a.indexOf('=') + 1) : true) : d; };
  const src = arg('digest', process.env.COLDGAS_OBS_DIGEST || 'https://mutaafaziz.com/coldgas/api/obs/digest');
  try {
    const s = summarize(await load(src));
    console.log(arg('json') ? JSON.stringify(s, null, 2) : render(s));
    process.exit(s.exit);
  } catch (err) {
    console.error(`obs:report: couldn't read the digest (${err.message})`);
    process.exit(3);
  }
}
