// Screenshots of the build / power-up / quest layer in the Sandbox (and on a real road): build
// mode with the ghost, a course of pieces, the car in the air off a kicker, power-up gauges, a
// quest in progress, the quest board, and the AI quest theatre (with a mocked /api/quest).
//   node scripts/shots-build.mjs outdir [url] [phone]
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const [out = 'docs/shots/build', url = 'http://localhost:4617/coldgas/', phone] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const ctx = phone === 'phone'
  ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true }
  : { viewport: { width: 1440, height: 900 } };
const page = await browser.newPage(ctx);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
const tag = phone ? '-phone' : '';
const shot = async (name) => { await page.screenshot({ path: `${out}/${name}${tag}.png` }); console.log('shot', name); };

// A mocked quest designer: the theatre streams it like the real Worker.
const QUEST = {
  title: 'Canyon Run at Blue Hour', brief: 'Two rings, a long jump over the parked row, and the steel deck to land on.',
  pieces: [
    { t: 'ring', x: 0, z: 30 }, { t: 'ring', x: 6, z: 60 }, { t: 'kicker', x: 0, z: 95, s: 1.25, m: 'steel' },
    { t: 'car', x: -2.4, z: 112, yaw: 0 }, { t: 'car', x: 0, z: 112 }, { t: 'car', x: 2.4, z: 112 },
    { t: 'barge', x: 0, z: 150 },
  ],
  pickups: [{ t: 'nitrogen', x: 0, z: 75 }, { t: 'magnet', x: 0, z: 85 }],
  objectives: [{ type: 'rings', count: 2 }, { type: 'land', target: 6 }], timeLimit: 90, reward: 'title:Canyon Runner',
};
await page.route('**/coldgas/api/quest', async (route) => {
  const text = JSON.stringify(QUEST, null, 1);
  const ev = (e, d) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`;
  let body = ev('prompt', { provider: 'edge', providerLabel: 'Cloudflare Edge', vendor: 'Workers AI', model: '@cf/google/gemma-4-26b-a4b-it', where: 'Cloudflare DFW', system: 'sys', user: 'usr', inTokensEst: 1450 });
  for (const t of text.match(/.{1,6}/gs)) body += ev('token', { t });
  body += ev('done', { quest: { ...QUEST, v: 1, pieces: QUEST.pieces.map((p) => ({ y: 0, yaw: 0, s: 1, m: p.m || 'concrete', hidden: false, ...p })), id: 'qmock' }, errors: null, provider: 'edge', model: '@cf/google/gemma-4-26b-a4b-it', ttftMs: 410, totalMs: 3900, inTokens: 1452, outTokens: 388, neurons: 41.2, tokensPerSec: 112, costUsd: 0.00026, raw: text });
  await route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream' }, body });
});

await page.goto(`${url}?drive=sandbox`);
await page.waitForFunction(() => window.__coldgas?.sandbox?.active, null, { timeout: 90000 });
await page.waitForTimeout(1500);
await shot('01-sandbox');

// A course: a line of pieces down the middle, a loop, a half-pipe, a stack, pads and pickups.
await page.evaluate(() => {
  const L = window.__coldgas.sandbox.layer;
  L.api.progress.pieces.push('loop', 'halfpipe', 'car');   // unlocked for the shot
  L.api.setArcade(true);
  const P = (t, x, z, o = {}) => L.place(t, x, z, o);
  P('boost', 0, -130); P('kicker', 0, -100, { material: 'wood' }); P('ring', 0, -80, { y: 3 }); P('pad', 0, -55, { scale: 1.5 });
  P('wedge', 0, -25, { material: 'concrete' }); P('ring', 0, 0, { y: 2 });
  P('loop', 22, -40, { material: 'steel' }); P('quarter', -26, -70, { yaw: Math.PI / 2, material: 'concrete' });
  P('halfpipe', -40, 10, { material: 'concrete' }); P('block', 14, -10, {}); P('block', 14, -10, { y: 2.1 }); P('block', 18, -10, {});
  P('car', 6, -92, { yaw: Math.PI / 2 }); P('car', -6, -92, { yaw: Math.PI / 2 });
  P('barge', 30, 20, {}); P('pickup:nitrogen', -4, -140); P('pickup:overpressure', 4, -140); P('pickup:shield', 0, -120);
});
await page.waitForTimeout(600);

// Build mode: the ghost on the ground, then over budget/in the way (red).
await page.evaluate(() => { const s = window.__coldgas.sandbox; s.layer.toggleBuild(); const e = s.layer.api.editor; e.choose('kicker'); e.st.cam.dist = 70; e.st.cam.pitch = 0.5; e.st.ghost.x = 8; e.st.ghost.z = -120; e.moveGhost(0, 0); });
await page.waitForTimeout(1200);
await shot('02-build-ghost');
await page.evaluate(() => { const e = window.__coldgas.sandbox.layer.api.editor; e.choose('wedge'); e.st.ghost.x = 0; e.st.ghost.z = -160; e.moveGhost(0, 0); });
await page.waitForTimeout(800);
await shot('03-build-invalid');
await page.evaluate(() => { const e = window.__coldgas.sandbox.layer.api.editor; e.setMode('edit'); e.st.sel = window.__coldgas.sandbox.layer.store.all().find((o) => o.type === 'loop'); e.st.cam.fx = 22; e.st.cam.fz = -40; e.st.cam.dist = 46; e.rotate(1); });
await page.waitForTimeout(900);
await shot('04-build-edit-loop');
if (phone) {
  await page.click('[data-bq-fab]');
  await page.waitForTimeout(700);
  await shot('05-build-radial');
  await page.click('[data-bq-fab]');
}
await page.evaluate(() => window.__coldgas.sandbox.layer.toggleBuild());

// Drive at the kicker: a straight-line pilot at ~85 km/h.
await page.evaluate(() => {
  const s = window.__coldgas.sandbox;
  s.place(0, -170, 0);
  s.pilot((c) => ({ throttle: Math.hypot(c.vel.x, c.vel.z) < 23 ? 1 : 0, brake: 0, steer: -c.pos.x * 0.08 - c.vel.x * 0.05, pitch: 0, roll: 0, yaw: 0, lift: 0, thrust: 0, retro: 0, level: 0, fan: 0, assist: 1, manual: 0 }));
});
await page.waitForFunction(() => window.__coldgas.sandbox.car.pos.z > -96 && window.__coldgas.sandbox.car.grounded === 0, null, { timeout: 60000 });
await page.waitForTimeout(350);
await shot('06-air-off-kicker');
await page.waitForTimeout(1600);
await shot('07-powerups-landing');
await page.evaluate(() => { const s = window.__coldgas.sandbox; s.pilot(null); const P = s.layer.api.power; P.grant('fan', s.car); P.grant('shield', s.car); P.grant('slowmo', s.car); });
await page.waitForTimeout(700);
await shot('08-powerup-gauges');

// The quest board, then an AI quest through the theatre.
await page.evaluate(() => window.__coldgas.sandbox.layer.openQuests());
await page.waitForTimeout(900);
await shot('09-quest-board');
await page.fill('[data-wish]', 'a canyon jump over parked cars onto a steel deck');
await page.click('[data-gen]');
await page.waitForTimeout(phone ? 2600 : 2400);
await shot('10-ai-theatre-compute');
await page.waitForTimeout(2200);
await shot('11-ai-theatre-check');
await page.waitForFunction(() => window.__coldgas.sandbox.layer.api.quest, null, { timeout: 30000 });
await page.waitForTimeout(1200);
await shot('12-ai-quest-started');
await page.evaluate(() => { const s = window.__coldgas.sandbox; s.pilot((c) => ({ throttle: Math.hypot(c.vel.x, c.vel.z) < 22 ? 1 : 0, brake: 0, steer: -c.pos.x * 0.08 - c.vel.x * 0.05, pitch: 0, roll: 0, yaw: 0, lift: 0, thrust: 0, retro: 0, level: 0, fan: 0, assist: 1, manual: 0 })); });
await page.waitForTimeout(4200);
await shot('13-quest-rings');
console.log(JSON.stringify(await page.evaluate(() => ({ stats: window.__coldgas.sandbox.stats(), quest: window.__coldgas.sandbox.layer.api.quest?.lines() }))));

// The same layer on a real road: a quest laid along Stelvio, and build mode beside the road.
await page.evaluate(() => window.__coldgas.sandbox.exit());
await page.evaluate(() => window.__coldgas.loadDrive().then((d) => d.start('stelvio', { tod: 'day' })));
await page.waitForFunction(() => window.__coldgas.drive?.active, null, { timeout: 90000 });
await page.evaluate(() => { const d = window.__coldgas.drive; d.goto(d.road.length * 0.06, 1); });
await page.waitForTimeout(1500);
await page.evaluate(() => window.__coldgas.drive.layer.openQuests());
await page.waitForTimeout(900);
await shot('14-road-quest-board');
await page.locator('.bq-card').nth(2).click();
await page.waitForTimeout(1200);
await page.evaluate(() => { const d = window.__coldgas.drive; d.autopilot(true, { vmax: 22 }); });
await page.waitForTimeout(3500);
await shot('15-road-quest');
await page.evaluate(() => { const d = window.__coldgas.drive; d.autopilot(false); d.layer.api.endQuest(false); d.layer.toggleBuild(); const e = d.layer.api.editor; e.choose('kicker'); e.place(); e.moveGhost(0, 30); e.choose('ring'); e.place(); e.moveGhost(0, 6); });
await page.waitForTimeout(1500);
await shot('16-road-build');
console.log('errors:', errors.slice(0, 8).join(' | ') || 'none');
await browser.close();
