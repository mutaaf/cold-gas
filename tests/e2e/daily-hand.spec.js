import { test, expect } from '@playwright/test';

// 0218: on the keys a Lineup Daily is the hand's own day (src/daily.js formOf): no modelled keyboard player lands the one
// thumb's 720, so the title asks for a full turn, and the reference's clean 360 meets it. 2026-11-28 is a mark-lineup day
// (tests/e2e/challenge.spec.js flies it on one thumb).
const DAY = new Date('2026-11-28T15:00:00Z');
const ready = (page) => page.waitForFunction(() => window.__coldgas?.physicsReady?.(), null, { timeout: 90_000 });

test('a Lineup Daily on the keys asks for a full turn near the mark, and a clean 360 meets it', async ({ browser }) => {
  test.setTimeout(180_000);
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.clock.setFixedTime(DAY);
  await page.route('**/coldgas/api/**', (r) => r.abort());
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/coldgas/?gfx=low');
  await ready(page);
  const card = page.locator('[data-title-extra] .xc-daily');
  await expect(card.locator('.xc-goal')).toHaveText('Roll a full turn and land within 16 ft of the mark', { useInnerText: true });
  await expect(card.locator('[data-daily-hint]')).toHaveCount(0);   // the one thumb's "Slide up on the run-up" is not the keys'
  await page.screenshot({ path: test.info().outputPath('daily-lineup-keys-1440.png') });
  await card.locator('[data-daily-play]').click();
  const r = await page.evaluate(() => {
    const g = window.__coldgas, S = g.S;
    S.autopilot = g.createAutopilot(g.stage.course);
    g.skipCountdown();
    for (let i = 0; i < 4000 && !S.card; i++) g.liveStep(0.1);
    S.autopilot = null;
    for (let i = 0; i < 4000 && S.mode !== 'results'; i++) g.liveStep(0.1);
    return { course: S.run?.course, rotations: S.card?.facts?.rotations, padMiss: S.card?.facts?.padMiss };
  });
  expect(r.course).toBe('lineup');
  expect(r.rotations).toBe(1);
  expect(r.padMiss).toBeLessThanOrEqual(5);
  await expect(page.locator('[data-daily-line]')).toHaveText(/^Daily ✓ complete · streak 1$/);
  expect(errors).toEqual([]);
  await ctx.close();
});
