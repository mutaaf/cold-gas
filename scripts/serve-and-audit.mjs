// The HUD and title audits as one gate (0082): serves the production build (dist/, so `npm run build`
// first) with `vite preview` on a private port, waits for it, runs scripts/hud-audit.mjs (one shard
// of it) and scripts/title-audit.mjs, stops the server, and exits with their code: 0 only when every
// count of both is zero.
//
//   npm run build && npm run audit [-- --shard=N/M] [--port=4655] [--out=audit-shots] [--set=all] [--no-title|--title-only]
//
// CI splits the HUD audit across M parallel jobs (`--shard=1/6` … `6/6`), balanced by estimated cost
// (scripts/audit-plan.mjs); the title audit is one item of that plan and runs with the shard that holds
// it (on software GL it costs about as much as five viewports). Screenshots and each report land in
// --out for the artifact.
// On software GL (CI) every wait is doubled (AUDIT_SLOW, default 2 when CI is set).
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { planShards, viewportsFor } from './audit-plan.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const flags = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => { const [k, v = 'true'] = a.slice(2).split('='); return [k, v]; }));
const port = Number(flags.port || process.env.AUDIT_PORT || 4655);
const out = flags.out || 'audit-shots';
const shard = flags.shard || '1/1';
const [shardN, shardM] = shard.split('/').map(Number);
// One address for the server and the browser: `localhost` can resolve to ::1 for vite and 127.0.0.1 for
// Node's fetch (a Docker image's /etc/hosts lists both), and the preview never answered (0083).
const url = `http://127.0.0.1:${port}/coldgas/`;
const runHud = flags['title-only'] !== 'true';
const set = flags.set || 'all';
const titleHere = !(shardM > 1) || (set === 'all' ? planShards(viewportsFor(set), shardM)[shardN - 1]?.includes('title') : shardN === 1);
const runTitle = flags['no-title'] !== 'true' && (titleHere || flags['title-only'] === 'true');

if (!existsSync(join(root, 'dist/coldgas/index.html'))) { console.error('No build: run `npm run build` first.'); process.exit(2); }
mkdirSync(out, { recursive: true });

const vite = join(root, 'node_modules/.bin/vite');
const server = spawn(vite, ['preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
let serverLog = '';
server.stdout.on('data', (d) => { serverLog += d; });
server.stderr.on('data', (d) => { serverLog += d; });
const stop = () => { if (server.exitCode == null) server.kill('SIGTERM'); };
process.on('exit', stop);
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { stop(); process.exit(130); });

// Wait for the preview to answer (it exits at once if the port is taken: --strictPort).
const t0 = Date.now();
for (;;) {
  if (server.exitCode != null) { console.error(`vite preview exited (${server.exitCode}):\n${serverLog}`); process.exit(2); }
  try { const r = await fetch(url); if (r.ok) break; } catch { /* not up yet */ }
  if (Date.now() - t0 > 60_000) { console.error(`vite preview did not answer on ${url} in 60 s:\n${serverLog}`); stop(); process.exit(2); }
  await new Promise((r) => setTimeout(r, 250));
}
console.log(`serving ${url} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);

const run = (script, args) => new Promise((resolve) => {
  const t = Date.now();
  const p = spawn(process.execPath, [join(root, 'scripts', script), ...args], { cwd: root, stdio: 'inherit' });
  p.on('exit', (code, signal) => resolve({ script, code: code ?? (signal ? 1 : 0), s: (Date.now() - t) / 1000 }));
});
const results = [];
if (runHud) results.push(await run('hud-audit.mjs', [url, out, set, `hud-${shard.replace('/', 'of')}`, flags.states || 'both', `--shard=${shard}`]));
if (runTitle) results.push(await run('title-audit.mjs', [url, out, 'title']));
stop();
for (const r of results) console.log(`${r.script}: exit ${r.code} in ${Math.round(r.s)} s`);
process.exit(results.some((r) => r.code !== 0) ? 1 : 0);
