#!/usr/bin/env node
// The owner's one screen on production health (0293; docs/AUDIT-2026-11-18.md "How the owner sees it"): production's
// /obs/digest, split into the web and the iPhone app (builds `ios-<version>-<build>`), with the top signatures of each,
// the flagged regressions and the last days of the players' funnel. Its exit code is the alert:
//
//   2  page someone: a P0 regression (the Worker's rule: a fatal kind, physics/webgl, or ≥ 10 % of sessions), an iPhone
//      build with ≥ 3 crashes or ≥ 5 hangs in the window, or any iPhone render/shader failure (a black stage)
//   1  look today: a P1 regression, any signature on the newest iPhone build, or the newest iPhone build slower or hotter
//      than the one before it (0300: its sessions' p95 frame time a bucket worse, or more of them hitching or running hot)
//   0  quiet
//
// 0300: the iPhone app also sends each session's performance summary and the new features it touched, packed into the
// /obs batch as rows whose frame is `perf@<build>` or `use@<build>` (ColdGasClient/Perf.swift). They're not faults: they're
// read here into a per-build table (p95 frame time, hitch rate, thermal peak, cadence, look, memory, launch), the features
// used, and the newest TestFlight build against the one before it. The digest's `top` holds 20 rows across web and iPhone,
// so a busy day can push some out: the audit's backend proposal B4 gives them their own field.
//
//   npm run obs:report                        production
//   npm run obs:report -- --json              the summary as JSON (for a tool or an agent)
//   npm run obs:report -- --digest=<url|file> another digest (env COLDGAS_OBS_DIGEST)
//
// Reads only. An iPhone crash frame `0x1a2b3c@ColdGas` symbolicates with that build's dSYM:
//   atos -arch arm64 -o ColdGas.app.dSYM/Contents/Resources/DWARF/ColdGas -l 0x100000000 0x1001a2b3c
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const ALERT = { iosCrashes: 3, iosHangs: 5, minSessions: 5, hitchShareUp: 0.2, hotShareUp: 0.2 };
const isIos = (b) => /^ios-/.test(b || '');
const verKey = (b) => (b.match(/^ios-([\d.]+)(?:-(\d+))?/) || []).slice(1).map((p, i) => (i ? Number(p || 0) : (p || '0').split('.').map(Number)));
const newerIos = (a, b) => {
  const [va, ba] = verKey(a), [vb, bb] = verKey(b);
  for (let i = 0; i < Math.max(va.length, vb.length); i++) if ((va[i] || 0) !== (vb[i] || 0)) return (va[i] || 0) > (vb[i] || 0);
  return ba > bb;
};

// --- 0300: the iPhone's session summaries (rows `perf@<build>`, `use@<build>`; Perf.swift) ---------------------------
const telemetryOf = (r) => { const m = /^(perf|use)@(ios-[\w.-]+)$/.exec(r?.fr || ''); return m ? { what: m[1], build: m[2] } : null; };
// "perf p50_9 p95_12 hitch_lt1 hz120 look_real scale_100 heat_fair mem_lt500 launch_lt2s" → { p50: '9', p95: '12', … }
export function parsePerf(msg) {
  const o = {};
  for (const t of String(msg || '').split(' ').slice(1)) {
    if (/^hz/.test(t)) o.hz = t.slice(2);
    else { const i = t.indexOf('_'); if (i > 0) o[t.slice(0, i)] = t.slice(i + 1); }
  }
  return o;
}
const EDGE_ORDER = ['6', '9', '12', '15', '17', '20', '25', '33', '50', '66', '100', '250', 'inf'];
const HITCH_ORDER = ['none', 'lt1', 'lt5', 'lt20', 'many'];
const HEAT_ORDER = ['nominal', 'fair', 'serious', 'critical'];
const FEATURES = ['look_real', 'look_anime', 'look_pixel', 'esc_on', 'esc_sport', 'esc_off', 'abs_on', 'abs_off', 'tc_on', 'tc_off', 'drift_on', 'drift_off', 'bias', 'hb',
  'roam', 'roamch', 'roamreset', 'drive', 'replay', 'club', 'mt'];
// The weighted median of an ordered category (the bucket where half the sessions are at or under).
function median(counts, order) {
  const n = order.reduce((a, k) => a + (counts[k] || 0), 0);
  if (!n) return null;
  let acc = 0;
  for (const k of order) { acc += counts[k] || 0; if (acc >= n / 2) return k; }
  return order[order.length - 1];
}
const share = (counts, keys) => { const n = Object.values(counts).reduce((a, c) => a + c, 0); return n ? keys.reduce((a, k) => a + (counts[k] || 0), 0) / n : 0; };
const bump = (o, k, n) => { if (k != null) o[k] = (o[k] || 0) + n; };
const round2 = (x) => Math.round(x * 100) / 100;
const pct = (x) => `${Math.round(x * 100)} %`;

// rows → { builds: { <build>: { sessions, p50, p95, hitching, hot, … } }, features: { <build>: { <feature>: sessions } } }
export function sessionsOf(rows) {
  const perf = {}, use = {};
  for (const r of rows) {
    const t = telemetryOf(r);
    if (!t) continue;
    const n = r.n || 1;
    if (t.what === 'use') {
      const f = (use[t.build] ??= {});
      for (const k of String(r.msg).split(' ').slice(1)) if (FEATURES.includes(k)) bump(f, k, n);
      continue;
    }
    const p = parsePerf(r.msg), b = (perf[t.build] ??= { sessions: 0, p50: {}, p95: {}, hitch: {}, heat: {}, hz: {}, look: {}, scale: {}, mem: {}, launch: {} });
    b.sessions += n;
    for (const k of ['p50', 'p95', 'hitch', 'heat', 'hz', 'look', 'scale', 'mem', 'launch']) bump(b[k], p[k], n);
  }
  const builds = {};
  for (const [build, b] of Object.entries(perf)) {
    builds[build] = {
      sessions: b.sessions,
      p50: median(b.p50, EDGE_ORDER), p95: median(b.p95, EDGE_ORDER),
      hitching: round2(share(b.hitch, ['lt5', 'lt20', 'many'])),   // sessions with ≥ 1 hitch per 1,000 frames
      hot: round2(share(b.heat, ['serious', 'critical'])),           // sessions that reached a serious or critical thermal state
      heat: median(b.heat, HEAT_ORDER), hitch: median(b.hitch, HITCH_ORDER),
      at120: round2(share(b.hz, ['120'])), looks: b.look, scales: b.scale, mem: b.mem, launch: b.launch,
    };
  }
  return { builds, features: use };
}

// The newest iPhone build against the one before it: frames, heat, and its faults (keys new to it, keys gone from it).
export function compareBuilds(newest, previous, sessions, faults) {
  if (!newest) return null;
  const a = sessions.builds[newest] || null, b = previous ? sessions.builds[previous] || null : null;
  const keysOf = (build) => new Set(faults.filter((r) => r.builds.includes(build)).map((r) => r.key));
  const ka = keysOf(newest), kb = previous ? keysOf(previous) : new Set();
  const out = { newest, previous, perf: { newest: a, previous: b }, newFaults: faults.filter((r) => ka.has(r.key) && !kb.has(r.key)),
    goneFaults: faults.filter((r) => kb.has(r.key) && !ka.has(r.key)), crashes: faults.filter((r) => ka.has(r.key) && r.kind === 'unclean'), worse: [] };
  if (a && b && a.sessions >= ALERT.minSessions && b.sessions >= ALERT.minSessions) {
    if (EDGE_ORDER.indexOf(a.p95) > EDGE_ORDER.indexOf(b.p95)) out.worse.push(`p95 frame time ≤ ${a.p95} ms vs ≤ ${b.p95} ms`);
    if (a.hitching - b.hitching >= ALERT.hitchShareUp) out.worse.push(`sessions hitching ${pct(a.hitching)} vs ${pct(b.hitching)}`);
    if (a.hot - b.hot >= ALERT.hotShareUp) out.worse.push(`sessions running hot ${pct(a.hot)} vs ${pct(b.hot)}`);
  }
  return out;
}

// digest → { web, ios, regressions, players, sessions, compare, alerts: [{ level, why }], exit }
export function summarize(digest) {
  const top = digest?.top || [];
  const web = top.filter((r) => !(r.builds || []).every(isIos));
  const iosAll = top.filter((r) => (r.builds || []).length && (r.builds || []).every(isIos));
  const ios = iosAll.filter((r) => !telemetryOf(r));   // faults only: the summaries are read below, never alerted on as faults
  const sessions = sessionsOf(iosAll);
  const iosBuilds = [...new Set([...ios.flatMap((r) => r.builds), ...iosAll.map((r) => telemetryOf(r)?.build).filter(Boolean)])]
    .sort((a, b) => (newerIos(a, b) ? -1 : 1));
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
  const compare = compareBuilds(newest, iosBuilds[1] || null, sessions, ios);
  if (compare?.worse.length) alerts.push({ level: 1, why: `iPhone ${newest} is worse than ${compare.previous}: ${compare.worse.join('; ')}` });
  const players = (digest?.players?.days || []).slice(0, 3);
  const exit = alerts.reduce((m, a) => Math.max(m, a.level), 0);
  return { generated: digest?.generated || null, current: digest?.current?.build || null, previous: digest?.previous?.build || null,
    web, ios, iosBuilds, regressions, players, sessions, compare, alerts, exit };
}

const row = (r) => `  ${String(r.n).padStart(6)}  ${`${r.mod}/${r.kind}`.padEnd(16)} ${r.msg.slice(0, 70).padEnd(70)}  ${r.fr || ''}`;
export function render(s) {
  const out = [];
  out.push(`COLD GAS health · digest ${s.generated || '?'} · web ${s.current || '—'} vs ${s.previous || '—'}`);
  out.push('', `Web: top signatures (${s.web.length})`);
  out.push(...(s.web.length ? s.web.slice(0, 10).map(row) : ['  none']));
  out.push('', `iPhone: top signatures (${s.ios.length}) · builds ${s.iosBuilds.join(', ') || '—'}`);
  out.push(...(s.ios.length ? s.ios.slice(0, 10).map(row) : ['  none']));
  out.push('', 'iPhone: performance by build (session summaries)');
  const perfBuilds = Object.keys(s.sessions?.builds || {}).sort((a, b) => (newerIos(a, b) ? -1 : 1));
  if (!perfBuilds.length) out.push('  none yet');
  else out.push(`  ${'build'.padEnd(24)} ${'sessions'.padStart(8)}  ${'p50'.padStart(6)}  ${'p95'.padStart(6)}  ${'hitching'.padStart(8)}  ${'hot'.padStart(5)}  ${'120 Hz'.padStart(6)}  looks / memory / launch`);
  const most = (o) => Object.entries(o || {}).sort((x, y) => y[1] - x[1]).map(([k, n]) => `${k}×${n}`).slice(0, 3).join(' ');
  for (const b of perfBuilds) {
    const p = s.sessions.builds[b];
    out.push(`  ${b.padEnd(24)} ${String(p.sessions).padStart(8)}  ${`≤${p.p50}`.padStart(6)}  ${`≤${p.p95}`.padStart(6)}  ${pct(p.hitching).padStart(8)}  ${pct(p.hot).padStart(5)}  ${pct(p.at120).padStart(6)}  ${most(p.looks)} / ${most(p.mem)} / ${most(p.launch)}`);
  }
  out.push('', 'iPhone: features used (sessions that touched each)');
  const fb = Object.keys(s.sessions?.features || {}).sort((a, b) => (newerIos(a, b) ? -1 : 1));
  if (!fb.length) out.push('  none yet');
  for (const b of fb) out.push(`  ${b.padEnd(24)} ${Object.entries(s.sessions.features[b]).sort((x, y) => y[1] - x[1]).map(([k, n]) => `${k} ${n}`).join(' · ')}`);
  if (s.compare) {
    const c = s.compare, f = (p) => (p ? `${p.sessions} sessions, p95 ≤ ${p.p95} ms, hitching ${pct(p.hitching)}, hot ${pct(p.hot)}` : 'no summaries');
    out.push('', `iPhone: newest build ${c.newest} vs ${c.previous || '—'}`);
    out.push(`  frames   ${f(c.perf.newest)}  vs  ${f(c.perf.previous)}`);
    out.push(`  faults   new ${c.newFaults.length} · gone ${c.goneFaults.length} · crashes ${c.crashes.reduce((a, r) => a + r.n, 0)}`);
    for (const r of c.newFaults.slice(0, 5)) out.push(`    new: ${r.mod}/${r.kind} "${r.msg}"`);
    out.push(`  verdict  ${c.worse.length ? `worse: ${c.worse.join('; ')}` : c.newFaults.length ? 'new faults to look at' : 'no worse than the one before'}`);
  }
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
