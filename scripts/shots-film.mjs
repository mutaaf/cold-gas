// The look, frame by frame: the Show's title, the Wall climb, the carry over the row, the landing,
// the Lineup and a phone, plus (where the backdrop exists) a static fire on the title.
//   node scripts/shots-film.mjs <outdir> [url] [only=a,b]
// Waits for the backdrop to stream in (stage.backdrop) and its lights to come up before each shot.
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
const [out, url = 'http://localhost:4320/coldgas/', onlyArg] = process.argv.slice(2);
const only = onlyArg ? onlyArg.split(',') : null;
const want = (n) => !only || only.some((o) => n.startsWith(o));
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const errors = [];
async function open(phone, query = '') {
  const page = await browser.newPage(phone ? { viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } : { viewport: { width: 1440, height: 900 } });
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/api\/|404/.test(m.text())) errors.push(m.text()); });
  await page.goto(url + query);
  await page.waitForFunction(() => window.__coldgas?.stage?.ready, null, { timeout: 60000 });
  await page.evaluate(() => window.__coldgas.stage.ready);
  await page.evaluate(() => window.__coldgas.stage.backdrop);
  await page.waitForTimeout(3500);
  return page;
}
const shot = (page, name) => page.screenshot({ path: `${out}/${name}.png` });
const until = (page, pred) => page.waitForFunction(`(${pred.toString()})(window.__coldgas.S)`, null, { timeout: 60000 }).catch(() => console.log('missed', pred.toString()));

if (want('1') || want('2') || want('3') || want('4') || want('5')) {
  const page = await open(false);
  if (want('1')) await shot(page, '1-title');
  if (want('5')) {
    await page.evaluate(() => { const G = window.__coldgas; G.stage.rocket?.fire(G.S.time); });
    await page.waitForTimeout(3200);
    await shot(page, '5-static-fire');
    await page.waitForTimeout(6000);
    await shot(page, '5b-steam');
  }
  if (want('2') || want('3') || want('4')) {
    await page.evaluate(() => { window.__coldgas.startRun('reveal'); window.__coldgas.skipCountdown(); });
    await until(page, (S) => S.run.phase === 'ramp' && S.run.car.pos.y > 8);
    if (want('2')) await shot(page, '2-climb');
    await until(page, (S) => S.run.phase === 'air' && S.run.car.pos.z < -16);
    if (want('3')) await shot(page, '3-over-row');
    await until(page, (S) => S.run.phase === 'landed');
    await page.waitForTimeout(500);
    if (want('4')) await shot(page, '4-landing');
  }
  await page.close();
}
if (want('8')) {
  // The vehicle itself, closer than any game camera goes: for judging the model and its light.
  const page = await open(false);
  await page.evaluate(() => {
    const G = window.__coldgas, r = G.stage.rocket.group;
    G.director.update = () => {};
    const p = r.position, f = new (G.camera.position.constructor)(Math.sin(r.rotation.y), 0, Math.cos(r.rotation.y));
    G.camera.clearViewOffset?.();
    G.camera.position.set(p.x + f.x * 150 + f.z * 40, 12, p.z + f.z * 150 - f.x * 40);
    G.camera.lookAt(p.x, 38, p.z); G.camera.fov = 30; G.camera.updateProjectionMatrix();
  });
  await page.waitForTimeout(600);
  await shot(page, '8-rocket-close');
  await page.close();
}
if (want('6')) {
  const page = await open(false, '?course=lineup');
  await shot(page, '6-lineup-title');
  await page.evaluate(() => { window.__coldgas.startRun('reveal'); window.__coldgas.skipCountdown(); });
  await page.waitForTimeout(2500);
  await shot(page, '6b-lineup-run');
  await page.close();
}
if (want('7')) {
  const page = await open(true);
  await shot(page, '7-phone-title');
  await page.evaluate(() => { window.__coldgas.startRun('reveal'); window.__coldgas.skipCountdown(); });
  await until(page, (S) => S.run.phase === 'air' && S.run.car.pos.z < -16);
  await shot(page, '7b-phone-carry');
  await page.close();
}
console.log('errors:', errors.slice(0, 6).join(' | ') || 'none');
await browser.close();
