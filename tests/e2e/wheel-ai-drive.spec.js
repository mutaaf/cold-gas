import { test, expect } from '@playwright/test';

// AI drive (0108): Free Drive's computer-held road, on by default. Random input on the keyboard at 1280×720 and
// on a phone's stick and pedals at 390×844 keeps the car on the road; the HUD's switch (and O) turns it off and
// on; and a reset lets go of what was held (0099's rule, which Free Drive's own reset skipped).
// The sim is stepped in the page in 50 ms frames with the draw skipped: only the driving is under test.
// (Named to sort into CI's last e2e shard, the light one: shards split the files in order.)
const PHONE = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true };
const watch = (page) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/api\//.test(m.text()) && !/404/.test(m.text())) errors.push(m.text()); });
  return errors;
};
async function boot(page, road) {
  await page.goto(`/coldgas/?drive=${road}&gfx=low`);
  await page.waitForFunction(() => window.__coldgas?.drive?.active, null, { timeout: 90_000 });
  await page.evaluate(() => { window.__coldgas.stage.render = () => {}; });
}
// Step n frames; return the worst distance past the road's edge (m, car centre) and the road covered.
const drive = (page, n) => page.evaluate((n) => {
  const d = window.__coldgas.drive, r = d.road;
  let worst = -Infinity;
  for (let k = 0; k < n; k++) {
    d.frame(0.05, performance.now() / 1000);
    const c = d.car, i = d.stats().i, m = Math.min(i, r.m - 1);
    const off = Math.abs((c.pos.x - r.x[i]) * r.dz[m] - (c.pos.z - r.z[i]) * r.dx[m]) - r.hw[i];
    worst = Math.max(worst, off);
  }
  return { worst, i: d.stats().i, up: 1 - 2 * (d.car.quat.x ** 2 + d.car.quat.z ** 2) };
}, n);
// A seeded generator: the same random drive every run.
const rng = (seed) => () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

test('keyboard 1280×720: on by default, random keys stay on the road, O toggles, a reset lets go', async ({ page }) => {
  test.slow();   // a road world on software GL
  const errors = watch(page);
  await boot(page, 'stelvio');
  const sw = page.locator('[data-h-ai]');
  await expect(sw).toBeVisible();
  await expect(sw).toHaveAttribute('aria-checked', 'true');
  await expect(sw).toContainText('AI drive');
  await expect(page.locator('[data-h-ai-line]')).toContainText('Keeps you on the road');
  expect(await page.evaluate(() => window.__coldgas.driving.settings.ai)).toBe(true);
  // Random keys: ←, → or neither, ↑ most of the time, ↓ now and then, each held 0.15–1.2 s, for 40 s.
  const rnd = rng(11), held = new Set();
  const set = async (code, on) => { if (on && !held.has(code)) { await page.keyboard.down(code); held.add(code); } else if (!on && held.has(code)) { await page.keyboard.up(code); held.delete(code); } };
  const i0 = (await drive(page, 1)).i;
  let worst = -Infinity, t = 0;
  while (t < 40) {
    const s = Math.floor(rnd() * 3);
    await set('ArrowLeft', s === 0); await set('ArrowRight', s === 2);
    await set('ArrowUp', rnd() < 0.75); await set('ArrowDown', rnd() < 0.08);
    const n = 3 + Math.floor(rnd() * 21);
    const r = await drive(page, n);
    expect(r.up).toBeGreaterThan(0.5);
    worst = Math.max(worst, r.worst); t += n * 0.05;
  }
  for (const code of [...held]) await set(code, false);
  expect(worst).toBeLessThan(0.2);   // never off the tarmac (the car's centre within 0.2 m of the edge line)
  expect((await drive(page, 1)).i - i0).toBeGreaterThan(60);   // and it went somewhere (> 120 m)
  // O: off (the level drives), O again: on.
  await page.keyboard.press('KeyO');
  await expect(sw).toHaveAttribute('aria-checked', 'false');
  await page.keyboard.down('ArrowUp'); await drive(page, 4);
  expect(await page.evaluate(() => window.__coldgas.driving.get().ai)).toBe(false);
  await page.keyboard.up('ArrowUp');
  await page.keyboard.press('KeyO');
  await expect(sw).toHaveAttribute('aria-checked', 'true');
  // A reset lets go: ↑ and ← held through R put the fresh car at rest, the wheel centred, until pressed again.
  await page.keyboard.down('ArrowUp'); await page.keyboard.down('ArrowLeft');
  await drive(page, 10);
  await page.keyboard.press('KeyR');
  await page.evaluate(() => window.__coldgas.drive.frame(1 / 240, performance.now() / 1000));
  // (Before 0108 the fresh car had the wheel at −1 and full throttle, into the rail it had just left.)
  const after = await page.evaluate(() => { const g = window.__coldgas.driving.get(); return { thr: g.throttle, steer: g.steer, keys: window.__coldgas.input.held().keys.length }; });
  expect(after.thr).toBe(0);
  expect(Math.abs(after.steer)).toBeLessThan(0.05);   // AI drive's own trim on the lane, not the held lock
  expect(after.keys).toBe(0);
  await page.keyboard.up('ArrowUp'); await page.keyboard.up('ArrowLeft');
  expect(errors).toEqual([]);
});

test('touch 390×844: one tap toggles; a thumb thrown around the stick with GO held stays on the road', async ({ browser }) => {
  test.slow();
  const page = await browser.newPage(PHONE);
  const errors = watch(page);
  await boot(page, 'atlantic');
  const sw = page.locator('[data-h-ai]');
  await expect(sw).toBeInViewport();
  const box = await sw.boundingBox();
  expect(box.height).toBeGreaterThanOrEqual(44);
  await sw.tap();
  await expect(sw).toHaveAttribute('aria-checked', 'false');
  await sw.tap();
  await expect(sw).toHaveAttribute('aria-checked', 'true');
  // GO held by one finger; the other thumb lands anywhere on the stick (full lock included) every 0.2–1.5 s.
  const cdp = await page.context().newCDPSession(page);
  const g = await page.locator('[data-btn-go]').boundingBox(), st = await page.locator('[data-stick]').boundingBox();
  const go = { x: g.x + g.width / 2, y: g.y + g.height / 2, id: 1 }, c = { x: st.x + st.width / 2, y: st.y + st.height / 2 };
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [go] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [go, { ...c, id: 2 }] });
  const rnd = rng(23), i0 = (await drive(page, 1)).i;
  let worst = -Infinity, t = 0;
  while (t < 40) {
    const dx = (rnd() * 2 - 1) * 60, dy = (rnd() * 2 - 1) * 20;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [go, { x: c.x + dx, y: c.y + dy, id: 2 }] });
    const n = 4 + Math.floor(rnd() * 26);
    const r = await drive(page, n);
    expect(r.up).toBeGreaterThan(0.5);
    worst = Math.max(worst, r.worst); t += n * 0.05;
  }
  expect(await page.evaluate(() => window.__coldgas.input.held().go)).toBe(true);   // the pedal really was down
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  expect(worst).toBeLessThan(0.2);
  expect((await drive(page, 1)).i - i0).toBeGreaterThan(60);
  expect(errors).toEqual([]);
  await page.close();
});
