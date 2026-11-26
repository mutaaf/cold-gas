import { test, expect } from '@playwright/test';

// 0363: on the Lineup, Assist's run-up is the kickflip's speed. "Hold ↑ to go" on keys, or the GO pedal held on a phone,
// arrives at the line at 7–9 m/s (docs/REVEAL_RESEARCH.md §2.2), not 32 m/s into the row. The sim does it
// (src/sim/vehicle.js, LINEUP.runUp), so every input path that flies Assist gets it; this proves the page's two.
// The world isn't drawn (stage.render stubbed): the run is stepped in the page with liveStep, as a player's frames would.
const toLine = () => {
  const g = window.__coldgas, S = g.S;
  g.stage.render = () => {};
  let v = 0;
  for (let i = 0; i < 2400 && S.mode === 'live' && S.run.car.pos.z < 0; i++) {
    g.liveStep(1 / 60);
    const c = S.run.car;
    v = Math.hypot(c.vel.x, c.vel.z);
  }
  return { z: S.run.car.pos.z, v, course: S.run.course, assist: S.run.t.usedAssist, pro: S.run.t.usedPro };
};

test('keys: ↑ held down the Lineup\'s run-up meets the line at the kickflip\'s speed', async ({ page }) => {
  await page.goto('/coldgas/?play=jump&course=lineup&gfx=low');
  await page.waitForFunction(() => window.__coldgas?.S.mode === 'countdown', null, { timeout: 60_000 });
  await page.evaluate(() => window.__coldgas.skipCountdown());
  await page.keyboard.down('ArrowUp');
  const out = await page.evaluate(toLine);
  await page.keyboard.up('ArrowUp');
  expect(out.course).toBe('lineup');
  expect(out.assist).toBe(true);
  expect(out.z).toBeGreaterThanOrEqual(0);
  expect(out.v).toBeGreaterThanOrEqual(7);
  expect(out.v).toBeLessThanOrEqual(9);
});

test('phone: the GO pedal held down the Lineup\'s run-up meets the line at the kickflip\'s speed', async ({ browser }) => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  try {
    await page.addInitScript(() => localStorage.setItem('coldgas_touch', JSON.stringify({ scheme: 'classic' })));   // the stick and the pedals
    await page.goto('/coldgas/?play=jump&course=lineup&gfx=low');
    await page.waitForFunction(() => window.__coldgas?.S.mode === 'countdown', null, { timeout: 60_000 });
    await page.evaluate(() => window.__coldgas.skipCountdown());
    const go = await page.locator('[data-btn-go]').boundingBox();
    await page.dispatchEvent('[data-btn-go]', 'pointerdown', { pointerId: 7, clientX: go.x + 10, clientY: go.y + 10 });
    const out = await page.evaluate(toLine);
    await page.dispatchEvent('[data-btn-go]', 'pointerup', { pointerId: 7 });
    expect(out.course).toBe('lineup');
    expect(out.assist).toBe(true);
    expect(out.z).toBeGreaterThanOrEqual(0);
    expect(out.v).toBeGreaterThanOrEqual(7);
    expect(out.v).toBeLessThanOrEqual(9);
  } finally {
    await page.close();
  }
});
