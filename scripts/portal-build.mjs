#!/usr/bin/env node
// npm run build:crazygames | build:gamedistribution — a portal build (store/portals/SUBMIT.md).
//
//   node scripts/portal-build.mjs <crazygames|gamedistribution> [--no-zip]
//
// 1. `vite build` with CG_PORTAL set (vite.config.js): relative paths, src/portal/entry.js, the portal's SDK in place of
//    Marquee and Box Office, into dist-portals/<portal>/game/ (gitignored). The production build is untouched.
// 2. Prunes what the web's public/ carries that a portal must not ship: the iPhone beta and guide pages (outbound and
//    store links), the privacy page (it describes the web's analytics, which are not here), the web app manifest and its
//    icons (no install prompt), link-preview art.
// 3. Gates the result: no mutaafaziz.com, Marquee (/ads/v1), Box Office (/boxoffice) or root-absolute path anywhere in
//    its text files, an index.html at the top, the file count and size inside the portals' limits.
// 4. Zips it: dist-portals/cold-gas-<portal>.zip (index.html at the zip's root), and prints the sizes.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PORTALS } from './portal-html.mjs';

const ROOT = resolve(fileURLToPath(import.meta.url), '../..');
export const PRUNE = ['beta', 'guide', 'privacy', 'screenshots', 'icons', 'og.png', 'manifest.webmanifest', 'apple-touch-icon.png'];
export const FORBIDDEN = [
  [/mutaafaziz/i, 'the mutaafaziz.com address'],
  [/\/ads\/v1\//, 'Marquee (/ads/v1/)'],
  [/\/boxoffice\//, 'Box Office (/boxoffice/)'],
  [/["'`(]\/coldgas\//, 'a root-absolute /coldgas/ path'],
  [/(?:src|href)="\/(?!\/)/, 'a root-absolute src or href'],
  [/serviceWorker\.register|beforeinstallprompt/, 'a service worker or install prompt'],
];
// The portals' limits (docs.crazygames.com/requirements/technical, 2026-11-13): 250 MB and 1,500 files in all; the
// initial download (to the first gameplayStart) ≤ 50 MB, ≤ 20 MB for the mobile homepage.
export const MAX_FILES = 1500, MAX_BYTES = 250e6, WARN_BYTES = 20e6;

function walk(dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p)); else out.push(p);
  }
  return out;
}

export function gate(dir) {
  const problems = [];
  if (!existsSync(join(dir, 'index.html'))) problems.push('no index.html at the top');
  const files = walk(dir);
  let bytes = 0;
  for (const f of files) {
    bytes += statSync(f).size;
    if (!/\.(html|js|mjs|css|json|txt|svg|webmanifest)$/.test(f)) continue;
    const text = readFileSync(f, 'utf8');
    for (const [re, what] of FORBIDDEN) if (re.test(text)) problems.push(`${relative(dir, f)}: ${what} (${text.match(re)[0]})`);
  }
  for (const p of PRUNE) if (existsSync(join(dir, p))) problems.push(`${p} should have been pruned`);
  if (files.length > MAX_FILES) problems.push(`${files.length} files (max ${MAX_FILES})`);
  if (bytes > MAX_BYTES) problems.push(`${(bytes / 1e6).toFixed(1)} MB (max 250)`);
  return { problems, files: files.length, bytes };
}

const mb = (n) => `${(n / 1e6).toFixed(2)} MB`;

function main() {
  const [portal, ...flags] = process.argv.slice(2);
  if (!PORTALS.includes(portal)) { console.error(`usage: node scripts/portal-build.mjs <${PORTALS.join('|')}> [--no-zip]`); process.exit(2); }
  const out = join(ROOT, 'dist-portals', portal);
  const game = join(out, 'game');
  rmSync(out, { recursive: true, force: true });
  execFileSync(process.execPath, [join(ROOT, 'node_modules/vite/bin/vite.js'), 'build', '--logLevel', 'warn'], { cwd: ROOT, stdio: 'inherit', env: { ...process.env, CG_PORTAL: portal, ...(process.env.CG_GD_GAME_ID ? { VITE_CG_GD_GAME_ID: process.env.CG_GD_GAME_ID } : {}) } });
  for (const p of PRUNE) rmSync(join(game, p), { recursive: true, force: true });
  const { problems, files, bytes } = gate(game);
  if (problems.length) { console.error(`portal build ${portal}: ${problems.length} problem(s)\n  ${problems.join('\n  ')}`); process.exit(1); }
  console.log(`portal build ${portal}: ${files} files, ${mb(bytes)} unzipped → ${relative(ROOT, game)}`);
  if (bytes > WARN_BYTES) console.warn(`  note: over 20 MB in all; the mobile homepage counts only the download to the first gameplayStart`);
  if (portal === 'gamedistribution') {
    const cfg = readFileSync(join(ROOT, 'src/portal/config.js'), 'utf8');
    const placeholder = !process.env.CG_GD_GAME_ID && /export const GD_GAME_ID = import\.meta\.env\?\.VITE_CG_GD_GAME_ID \|\| 'PASTE-GAMEDISTRIBUTION-GAME-ID'/.test(cfg);
    if (placeholder) console.warn('\n  WARNING: no GameDistribution game id yet: this build loads no SDK and shows no ads.\n  Paste the id into src/portal/config.js (GD_GAME_ID) and run this again before uploading (store/portals/SUBMIT.md).\n');
  }
  if (flags.includes('--no-zip')) return;
  const zip = join(ROOT, 'dist-portals', `cold-gas-${portal}.zip`);
  rmSync(zip, { force: true });
  execFileSync('zip', ['-q', '-r', '-X', '-9', zip, '.'], { cwd: game, stdio: 'inherit' });
  console.log(`  zip: ${relative(ROOT, zip)} (${mb(statSync(zip).size)})`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
