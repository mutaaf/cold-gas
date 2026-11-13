#!/usr/bin/env node
// The portals' store art, made from the game itself (store/portals/, SUBMIT.md). Build first: npm run build:crazygames.
//
//   node scripts/portal-art.mjs [--covers] [--video] [--out store/portals/crazygames]
//
// Covers (docs.crazygames.com/requirements/game-covers, 2026-11-13): 1920×1080 (16:9), 800×1200 (2:3), 800×800 (1:1),
// the game's title and nothing else on them (no borders, no "Play", no logos or store badges). Each is a real frame of
// the reference jump (the roadster over the parked row), rendered by the game on this Mac's GPU with its interface
// hidden, then the COLD GAS wordmark set over it in the game's own face (Michroma).
//
// Videos (same page): 15–20 s, no sound, landscape 1080p 16:9 and portrait 1080p 2:3, opening on the static cover, no
// cursor, no fast-forward, no black bars or promotional text. The game's clock is stepped 1/30 s per frame (rAF and
// performance.now are driven from here), so the footage is smooth at real speed whatever the machine does; the frames
// are encoded with ffmpeg (H.264, yuv420p, no audio track).
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const ROOT = resolve(fileURLToPath(import.meta.url), '../..');
const args = process.argv.slice(2);
const want = { covers: args.includes('--covers') || !args.includes('--video'), video: args.includes('--video') || !args.includes('--covers') };
const OUT = resolve(ROOT, args.includes('--out') ? args[args.indexOf('--out') + 1] : 'store/portals/crazygames');
const GAME = join(ROOT, 'dist-portals/crazygames/game');
const TMP = join(ROOT, 'dist-portals/art-tmp');
const PORT = 4831;
const FPS = 30;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.woff': 'font/woff', '.png': 'image/png', '.glb': 'model/gltf-binary' };
if (!existsSync(join(GAME, 'index.html'))) { console.error('build first: npm run build:crazygames'); process.exit(2); }
mkdirSync(OUT, { recursive: true });
rmSync(TMP, { recursive: true, force: true });
mkdirSync(TMP, { recursive: true });

const server = http.createServer((req, res) => {
  const path = decodeURIComponent(req.url.split('?')[0]);
  let file = resolve(GAME, path.slice(1) || 'index.html');
  if (file !== GAME && !file.startsWith(GAME + sep)) { res.writeHead(403); return res.end(); }
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
  if (!existsSync(file)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' });
  res.end(readFileSync(file));
}).listen(PORT, '127.0.0.1');

const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--hide-scrollbars'] });

// The game on a stepped clock: after boot, rAF callbacks are queued and run only when advance() says, with
// performance.now() moved by exactly that much.
const CLOCK = `(() => {
  let t = performance.now(); const real = performance.now.bind(performance);
  const q = new Map(); let id = 0;
  window.__clock = {
    start() { t = real(); performance.now = () => t; window.requestAnimationFrame = (cb) => { q.set(++id, cb); return id; }; window.cancelAnimationFrame = (i) => q.delete(i); },
    advance(ms) { t += ms; const list = [...q.values()]; q.clear(); for (const cb of list) { try { cb(t); } catch (e) { console.error(e); } } },
  };
})()`;
const HIDE_UI = 'body > *:not(#stage):not(.grain) { opacity: 0 !important; }';

async function openGame({ w, h }) {
  const ctx = await browser.newContext({ viewport: { width: w / 2, height: h / 2 }, deviceScaleFactor: 2 });
  await ctx.route(/crazygames\.com/, (r) => r.abort());   // no SDK here: the art is the game alone
  const page = await ctx.newPage();
  await page.goto(`http://127.0.0.1:${PORT}/index.html?gfx=high&course=show`);
  await page.waitForFunction(() => window.__coldgas?.physicsReady?.() && window.__coldgas.refGhostReady?.('show'), null, { timeout: 120_000 });
  await page.evaluate(() => window.__coldgas.stage.ready);
  await page.waitForTimeout(2500);   // the forged models swap in on the title
  await page.evaluate(CLOCK);
  return { ctx, page };
}
// The reference jump on the stepped clock, from its first live frame.
async function startReference(page) {
  await page.evaluate(() => { window.__coldgas.startRun('reveal'); window.__coldgas.skipCountdown(); window.__clock.start(); });
  for (let i = 0; i < 4; i++) await page.evaluate(() => window.__clock.advance(1000 / 30));
}
const step = (page) => page.evaluate((ms) => window.__clock.advance(ms), 1000 / FPS);
const S = (page, fn) => page.evaluate(`(${fn})(window.__coldgas.S)`);

// The hero frame: the roadster upside down over the parked row. Reached through the run's moments in order (on the
// curl inverted, the boost off the lip, over the row), as the review shots were.
const MOMENTS = [
  (S) => S.run && S.run.phase === 'ramp' && S.run.t.invertedTime > 0.2,
  (S) => S.run && S.run.phase === 'air' && S.run.car.pos.z < -9,
  (S) => S.run && S.run.phase === 'air' && S.run.car.pos.z < -16,
];

async function rawFrame({ w, h, name }) {
  const { ctx, page } = await openGame({ w, h });
  await page.addStyleTag({ content: HIDE_UI });
  await startReference(page);
  for (const m of MOMENTS) for (let i = 0; i < 30 * 30 && !(await S(page, m)); i++) await step(page);
  const file = join(TMP, `raw-${name}.png`);
  await page.screenshot({ path: file });
  await ctx.close();
  return file;
}

// The wordmark over a frame, at an exact size. Only the title (the portals' rule).
const MICHROMA = readFileSync(join(ROOT, 'node_modules/@fontsource/michroma/files/michroma-latin-400-normal.woff2')).toString('base64');
async function composite({ raw, w, h, out }) {
  const img = readFileSync(raw).toString('base64');
  const portrait = h > w, square = h === w;
  const size = portrait ? w * 0.17 : square ? w * 0.105 : h * 0.135;
  const html = `<!doctype html><html><head><style>
    @font-face { font-family: Michroma; src: url(data:font/woff2;base64,${MICHROMA}) format('woff2'); }
    html, body { margin: 0; width: ${w}px; height: ${h}px; overflow: hidden; background: #05070c; }
    .bg { position: absolute; inset: 0; background: url(data:image/png;base64,${img}) center / cover no-repeat; }
    .scrim { position: absolute; inset: 0; background: linear-gradient(${portrait || square ? '0deg' : '-12deg'}, rgba(5,7,12,.82) 0%, rgba(5,7,12,.35) ${portrait ? 34 : 38}%, rgba(5,7,12,0) ${portrait ? 55 : 60}%); }
    h1 { position: absolute; ${portrait || square ? 'left: 8%' : 'right: 6%; text-align: right'}; bottom: ${portrait ? 7 : 9}%; margin: 0; font: 400 ${size}px/0.98 Michroma, sans-serif;
      letter-spacing: -0.01em; color: #f1f4f7; text-shadow: 0 2px 24px rgba(0,0,0,.45); }
    h1 i { display: block; width: ${Math.round(size * 0.9)}px; height: ${Math.max(2, Math.round(size * 0.045))}px; background: #ff3b30; ${portrait || square ? '' : 'margin-left: auto;'} margin-top: ${Math.round(size * 0.22)}px; }
  </style></head><body><div class="bg"></div><div class="scrim"></div><h1>COLD<br>GAS<i></i></h1></body></html>`;
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  await page.setContent(html);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: out });
  await page.close();
  return out;
}

// --- Covers ---
const raws = {};
if (want.covers || want.video) {
  raws.landscape = await rawFrame({ w: 1920, h: 1080, name: 'landscape' });
  raws.portrait = await rawFrame({ w: 1080, h: 1620, name: 'portrait' });
}
if (want.covers) {
  raws.square = await rawFrame({ w: 800, h: 800, name: 'square' });
  await composite({ raw: raws.landscape, w: 1920, h: 1080, out: join(OUT, 'cover-landscape-1920x1080.png') });
  await composite({ raw: raws.portrait, w: 800, h: 1200, out: join(OUT, 'cover-portrait-800x1200.png') });
  await composite({ raw: raws.square, w: 800, h: 800, out: join(OUT, 'cover-square-800x800.png') });
  console.log('covers →', OUT);
  // GameDistribution's dashboard asks for its own set of images when the game is created; these are the sizes its
  // asset template lists (not in its public docs: check them against the upload form). The same frames, the same rule.
  const GD = join(OUT, '../gamedistribution');
  mkdirSync(GD, { recursive: true });
  for (const [w, h] of [[1280, 720], [1280, 550], [512, 384], [512, 340]]) await composite({ raw: raws.landscape, w, h, out: join(GD, `image-${w}x${h}.png`) });
  await composite({ raw: raws.square, w: 512, h: 512, out: join(GD, 'image-512x512.png') });
  console.log('GameDistribution images →', GD);
}

// --- Videos ---
async function video({ w, h, name, cover }) {
  const dir = join(TMP, `frames-${name}`);
  mkdirSync(dir, { recursive: true });
  let n = 0;
  const frame = (page) => page.screenshot({ path: join(dir, `f${String(n++).padStart(4, '0')}.png`) });
  // 1 s on the static cover (the docs: the first frame is the cover).
  const coverPng = await composite({ raw: cover, w, h, out: join(dir, 'cover.png') });
  for (let i = 0; i < FPS; i++) execFileSync('cp', [coverPng, join(dir, `f${String(n++).padStart(4, '0')}.png`)]);
  const { ctx, page } = await openGame({ w, h });
  await startReference(page);
  const MAX = 19 * FPS;
  let landedAt = -1;
  while (n < MAX) {
    await frame(page);
    await step(page);
    if (landedAt < 0 && await S(page, (S) => !S.run || S.run.phase === 'landed' || S.run.phase === 'done' || S.mode === 'results')) landedAt = n;
    if (landedAt >= 0 && n - landedAt > 2.5 * FPS && n >= 15 * FPS) break;
  }
  await ctx.close();
  const out = join(OUT, `video-${name}.mp4`);
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', join(dir, 'f%04d.png'), '-vf', `scale=${w}:${h}:flags=lanczos`,
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '20', '-pix_fmt', 'yuv420p', '-an', '-movflags', '+faststart', out]);
  console.log(`video ${name}: ${(n / FPS).toFixed(1)} s, ${(statSync(out).size / 1e6).toFixed(1)} MB → ${out}`);
}
if (want.video) {
  await video({ w: 1920, h: 1080, name: 'landscape-1920x1080', cover: raws.landscape });
  await video({ w: 1080, h: 1620, name: 'portrait-1080x1620', cover: raws.portrait });
}

writeFileSync(join(TMP, '.done'), '');
await browser.close();
server.close();
