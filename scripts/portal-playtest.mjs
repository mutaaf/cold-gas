#!/usr/bin/env node
// Plays a portal build the way a portal hosts it: the game's files on one origin, under a deep folder (relative paths
// only), inside a sandboxed <iframe> on a page from another origin. Build first (npm run build:<portal>).
//
//   node scripts/portal-playtest.mjs <crazygames|gamedistribution> [--blocked] [--phone] [--headed]
//
// --blocked  the portal's SDK host is refused (an ad blocker): the game must play exactly the same, with no ads
// --phone    390×844 touch: the touch controls come up
//
// It boots, presses Jump, flies a run by hand (keys or touch), lets it finish, posts to the board, leaves the results
// (Retry), flies a second run and leaves it (Home), where the midgame ad is asked for (CrazyGames' local SDK mode shows
// its stand-in ad on localhost). It fails on: any console error or page error in the game's frame, any request to
// mutaafaziz.com (Marquee, Box Office, the API), to /api/ anywhere, or to /ads/v1 or /boxoffice; no gameplayStart before
// the run (CrazyGames, SDK up); a run that never reaches its results; a post that doesn't save; a title that never comes back.
import http from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, devices } from '@playwright/test';

const ROOT = resolve(fileURLToPath(import.meta.url), '../..');
const [portal = 'crazygames', ...flags] = process.argv.slice(2);
const blocked = flags.includes('--blocked'), phone = flags.includes('--phone'), headed = flags.includes('--headed');
const GAME_DIR = join(ROOT, 'dist-portals', portal, 'game');
const GAME_PORT = Number(process.env.PT_PORT) || 4811, HOST_PORT = GAME_PORT + 1;
const DEEP = '/games/embed/cold-gas-1/';   // a portal serves from a folder of its own: nothing may assume the root
const SDK_HOSTS = { crazygames: /(^|\.)crazygames\.com$/, gamedistribution: /(^|\.)gamedistribution\.com$/ };
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.woff': 'font/woff', '.png': 'image/png', '.glb': 'model/gltf-binary', '.gz': 'application/gzip', '.bin': 'application/octet-stream' };

if (!existsSync(join(GAME_DIR, 'index.html'))) { console.error(`no build at ${GAME_DIR}: npm run build:${portal}`); process.exit(2); }

function serveGame() {
  return http.createServer((req, res) => {
    const path = decodeURIComponent(req.url.split('?')[0]);
    if (!path.startsWith(DEEP)) { res.writeHead(404); return res.end(); }
    let file = resolve(GAME_DIR, path.slice(DEEP.length) || 'index.html');
    if (file !== GAME_DIR && !file.startsWith(GAME_DIR + sep)) { res.writeHead(403); return res.end(); }
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
    if (!existsSync(file)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(readFileSync(file));
  }).listen(GAME_PORT, '127.0.0.1');
}
// The portal's page: another origin (localhost, not 127.0.0.1), the game in a sandboxed frame as the portals embed it.
function serveHost() {
  const gameUrl = `http://127.0.0.1:${GAME_PORT}${DEEP}index.html?gfx=low`;
  return http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(`<!doctype html><html><body style="margin:0;background:#111">
<iframe id="game" src="${gameUrl}" style="border:0;width:100vw;height:100vh;display:block"
  sandbox="allow-scripts allow-same-origin allow-pointer-lock allow-popups allow-forms" allow="autoplay; fullscreen; gamepad; gyroscope; accelerometer"></iframe>
</body></html>`);
  }).listen(HOST_PORT, 'localhost');
}

const fail = [];
const check = (ok, what) => { console.log(`${ok ? '  ok  ' : '  FAIL'} ${what}`); if (!ok) fail.push(what); };

const servers = [serveGame(), serveHost()];
const browser = await chromium.launch({ headless: !headed, args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext(phone ? { ...devices['iPhone 13'], viewport: { width: 390, height: 844 } } : { viewport: { width: 1280, height: 720 } });
const page = await ctx.newPage();
const errors = [], forbidden = [], sdkRequests = [], sdkLogs = [];
const thirdParty = [];
// A page error thrown by the portal's SDK or its ad scripts (their stack never touches the game's files) is theirs, not
// the game's: listed, not failed.
page.on('pageerror', (e) => (String(e.stack || '').includes(`127.0.0.1:${GAME_PORT}`) || !/https?:\/\//.test(String(e.stack || '')) ? errors : thirdParty).push(`pageerror: ${e.message} ${String(e.stack || '').split('\n').slice(1, 3).join(' ').trim()}`));
page.on('console', (m) => {
  // CrazyGames' SDK logs every call in its local mode ("Requesting gameplay start", …): the proof it was called.
  if (/HTML5 SDK/.test(m.text())) sdkLogs.push(m.text().replace(/%c|background-color[^;]*;|border-radius[^;]*;|padding[^;]*;|color:[^;]*;/g, ' '));
  if (m.type() !== 'error') return;
  const where = m.location()?.url || '';
  // Only the game's own frame and files count; an ad network's own console noise is not the game's.
  if (where && !where.startsWith(`http://127.0.0.1:${GAME_PORT}`)) return;
  errors.push(`console: ${m.text()} @ ${where}`);
});
page.on('request', (r) => {
  const u = new URL(r.url());
  // Anything to mutaafaziz.com, or the game's own origin asked for an API, Marquee or Box Office path (an ad network's
  // own /api/ calls are the portal's business).
  if (/mutaafaziz/i.test(u.hostname) || ([`127.0.0.1:${GAME_PORT}`, `localhost:${HOST_PORT}`].includes(u.host) && /\/api\/|\/ads\/v1|\/boxoffice/.test(u.pathname))) forbidden.push(r.url());
  if (SDK_HOSTS[portal]?.test(u.hostname)) sdkRequests.push(r.url());
});
if (blocked) await ctx.route((url) => SDK_HOSTS[portal].test(new URL(url).hostname), (route) => route.abort('blockedbyclient'));

console.log(`portal playtest: ${portal}${blocked ? ', SDK blocked' : ''}${phone ? ', phone' : ''}`);
await page.goto(`http://localhost:${HOST_PORT}/`);
const frameEl = await page.waitForSelector('#game');
const frame = await frameEl.contentFrame();
await frame.waitForFunction(() => !!window.__coldgas?.S && !!window.__cgPortal, null, { timeout: 90_000 });
const live = await frame.evaluate(() => window.__cgPortal.live);
check(blocked ? !live : true, `SDK ${live ? 'up' : 'not up'}${blocked ? ' (blocked, as asked)' : ''}`);
if (!blocked && portal === 'crazygames') check(live, 'CrazyGames SDK initialised (local mode)');

// Spy on the SDK's calls from here on (the adapter calls through window.CrazyGames.SDK / window.gdsdk each time).
await frame.evaluate(() => {
  window.__calls = [];
  const sdk = window.CrazyGames?.SDK;
  if (sdk?.ad?.requestAd) { const f = sdk.ad.requestAd.bind(sdk.ad); sdk.ad.requestAd = (t, cb) => { window.__calls.push(`requestAd:${t}`); return f(t, cb); }; }
  if (window.gdsdk?.showAd) { const f = window.gdsdk.showAd.bind(window.gdsdk); window.gdsdk.showAd = (...a) => { window.__calls.push(`showAd:${a[0] || 'midgame'}`); return f(...a); }; }
});
await frame.waitForFunction(() => window.__coldgas.physicsReady(), null, { timeout: 90_000 });
if (!phone) { await frame.locator('[data-course="wall"]').click(); }   // the hand-flown run is the Wall's (keys); the phone flies the Show on one thumb
check(await frame.locator('[data-start]').isVisible(), 'title up, Jump visible');
check(!(await frame.locator('.beta-chip, .beta-btn, a[href*="beta/"], a[href*="guide/"]').first().isVisible().catch(() => false)), 'no outbound links on the title');
check(!(await frame.locator('[data-ai-open]').isVisible()), 'no AI key chip');

// --- Run 1: fly it by hand ---
async function flyRun(n) {
  if (phone) await frame.locator('[data-start]').tap(); else await frame.locator('[data-start]').click();
  await frame.waitForFunction(() => ['countdown', 'live'].includes(window.__coldgas.S.mode), null, { timeout: 30_000 });
  const playing = await frame.evaluate(() => window.__cgPortal.playing);
  check(live ? playing : true, `run ${n}: gameplay started (adapter)`);
  if (portal === 'crazygames' && live) {
    await page.waitForTimeout(300);
    check(sdkLogs.some((t) => /gameplay\s*start/i.test(t)), `run ${n}: SDK gameplayStart fired (its own log)`);
  }
  await frame.evaluate(() => window.__coldgas.skipCountdown());
  await frame.waitForFunction(() => window.__coldgas.S.mode === 'live', null, { timeout: 30_000 });
  if (phone) {
    // One thumb: hold the pad from Go to the end; the flight computer flies the rest (Assist).
    check(await frame.locator('[data-onethumb]').isVisible(), `run ${n}: touch controls up`);
    const box = await frame.locator('[data-onethumb]').boundingBox();
    const cdp = await ctx.newCDPSession(page);
    const pt = [{ x: box.x + box.width / 2, y: box.y + box.height / 2 }];
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt });
    await frame.waitForFunction(() => { const r = window.__coldgas.S.run; return !r || r.phase === 'landed' || r.phase === 'done' || window.__coldgas.S.mode !== 'live'; }, null, { timeout: 120_000, polling: 500 }).catch(() => {});
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } else {
    // Keys, on the Wall: floor it, let go (Space) high on the curl, hold LAND (Shift) to the ground.
    await page.keyboard.down('ArrowUp');
    await frame.waitForFunction(() => { const r = window.__coldgas.S.run; return !r || r.phase !== 'drive' || window.__coldgas.S.mode !== 'live'; }, null, { timeout: 90_000, polling: 'raf' }).catch(() => {});
    await frame.waitForFunction(() => { const r = window.__coldgas.S.run; return !r || r.phase !== 'ramp' || r.car.pos.y > 17; }, null, { timeout: 90_000, polling: 'raf' }).catch(() => {});
    await page.keyboard.down('Space'); await page.waitForTimeout(150); await page.keyboard.up('Space');
    await page.keyboard.up('ArrowUp');
    await page.keyboard.down('Shift');
    await frame.waitForFunction(() => { const r = window.__coldgas.S.run; return !r || r.phase === 'landed' || r.phase === 'done' || window.__coldgas.S.mode !== 'live'; }, null, { timeout: 120_000, polling: 500 }).catch(() => {});
    await page.keyboard.up('Shift');
  }
  await frame.evaluate(() => window.__coldgas.fastForward());   // the rest of the run in one go (software GL is slow)
  await frame.waitForFunction(() => window.__coldgas.S.mode === 'results', null, { timeout: 60_000 });
  const card = await frame.evaluate(() => { const c = window.__coldgas.S.card; return c ? `${c.verdict} ${c.total}` : 'no card'; });
  check(true, `run ${n}: results (${card})`);
  if (live) check(!(await frame.evaluate(() => window.__cgPortal.playing)), `run ${n}: gameplay stopped on the results`);
  await frame.locator('[data-judge="engineer"] .quote').filter({ hasText: /\S/ }).first().waitFor({ timeout: 20_000 }).catch(() => {});
  const receipt = (await frame.locator('[data-receipt]').textContent().catch(() => '')) || '';
  check(/local lines/.test(receipt), `run ${n}: the judges speak local lines, and the receipt says so`);
}
await flyRun(1);
// Post to the local board, if the run is eligible (a real jump with a score).
const eligible = await frame.locator('[data-r-post]').isVisible();
if (eligible) {
  const field = frame.locator('#initials');
  if (await field.isVisible()) await field.fill('TST');
  await frame.locator('[data-r-post-btn]').click();
  await frame.locator('[data-r-submit-msg]').filter({ hasText: /Saved on this device/ }).waitFor({ timeout: 10_000 }).then(() => check(true, 'post: saved on this device'), () => check(false, 'post: saved on this device'));
} else console.log('  --   run 1 not board-eligible (no jump): post skipped');

// Leave with Retry: the first run of a session never gets an ad.
await frame.evaluate(() => window.__coldgas.toTitle());
await frame.waitForFunction(() => window.__coldgas.S.mode === 'title', null, { timeout: 30_000 });
await flyRun(2);
// Leave with Home: the midgame ad is due (second run). The title must come back, ad or no ad.
const homeBtn = frame.locator('[data-screen="results"] [data-home]').first();
if (phone) await homeBtn.tap(); else await homeBtn.click();
const leave = frame.locator('[data-leave-go]');
if (await leave.isVisible().catch(() => false)) await leave.click();
await frame.waitForFunction(() => window.__coldgas.S.mode === 'title', null, { timeout: 60_000 }).then(() => check(true, 'back on the title after the break'), () => check(false, 'back on the title after the break'));
const calls = await frame.evaluate(() => window.__calls);
if (live) check(calls.some((c) => /^(requestAd:midgame|showAd:midgame)$/.test(c)), `midgame ad asked for at the break (${calls.filter((c) => /Ad/.test(c)).join(', ') || 'none'})`);
else check(!calls.some((c) => /Ad/.test(c)), 'no ad calls with the SDK down');
check(!calls.some((c) => /rewarded/.test(c)), 'no rewarded ad (off on the portals)');
if (portal === 'crazygames' && live) {
  check(sdkLogs.some((t) => /gameplay\s*stop/i.test(t)), 'SDK gameplayStop fired (its own log)');
  check(sdkLogs.some((t) => /loading\s*stop/i.test(t)), 'SDK loadingStop fired (its own log)');
}
if (blocked) check(sdkRequests.length > 0, `the SDK was asked for and refused (${sdkRequests.length} request(s))`);

check(forbidden.length === 0, `no request to mutaafaziz.com, /api/, /ads/v1 or /boxoffice${forbidden.length ? `: ${forbidden.slice(0, 5).join(' ')}` : ''}`);
check(errors.length === 0, `no console errors in the game${errors.length ? `:\n      ${errors.slice(0, 8).join('\n      ')}` : ''}`);

if (thirdParty.length) console.log(`  note: the portal's own scripts threw (not the game): ${thirdParty.slice(0, 3).join(' | ')}`);
await browser.close();
for (const s of servers) s.close();
console.log(fail.length ? `\n${fail.length} check(s) failed` : '\nall checks passed');
process.exit(fail.length ? 1 : 0);
