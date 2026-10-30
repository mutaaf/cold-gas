import { test, expect } from '@playwright/test';

// Challenge links and the daily jump (src/comeback.js), on a phone first: a finished run's Share carries
// the run (#vs=); opening that link shows the challenge card on the title, the run races the challenger's
// ghost, and the results say how it went, with a way to send it back. The daily's objective comes from
// the UTC date: the clock is fixed on 2026-11-02, whose objective is "Land within 10 ft of the mark" on
// the Show (src/daily.js; tests/unit/daily.test.js pins the pick).
const phone = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 };
const DAY = new Date('2026-11-02T15:00:00Z');
const ready = (page) => page.waitForFunction(() => window.__coldgas?.physicsReady?.(), null, { timeout: 60_000 });

// One run (already started) to its sheet. crash: full throttle into the Wall, never let go; else the
// reference flight. The autopilot hands over before the sheet, so the run counts as the player's (as
// tests/e2e/coach-onboarding.spec.js flies them).
const fly = (page, crash) => page.evaluate((crash) => {
  const g = window.__coldgas, S = g.S;
  S.autopilot = crash ? () => ({ throttle: 1, assist: 1 }) : g.createAutopilot(g.stage.course);
  g.skipCountdown();
  for (let i = 0; i < 4000 && !S.card; i++) g.liveStep(0.1);
  S.autopilot = null;
  for (let i = 0; i < 4000 && S.mode !== 'results'; i++) g.liveStep(0.1);
  return { mode: S.mode, total: S.card?.total, course: S.run?.course };
}, crash);

async function phonePage(browser, { initials = '' } = {}) {
  const ctx = await browser.newContext(phone);
  if (initials) await ctx.addInitScript((i) => { try { localStorage.setItem('coldgas_initials', i); } catch { /* blocked */ } }, initials);
  const page = await ctx.newPage();
  await page.clock.setFixedTime(DAY);
  await page.route('**/coldgas/api/**', (r) => r.abort());
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  return { ctx, page, errors };
}

test('a shared run is a rematch: the card, the challenger as the ghost, and the verdict on the results', async ({ browser }) => {
  test.setTimeout(180_000);
  // ABC crashes into the Wall; the Share link carries that run.
  const a = await phonePage(browser, { initials: 'ABC' });
  await a.page.goto('/coldgas/?gfx=low');
  await ready(a.page);
  await a.page.evaluate(() => window.__coldgas.startRun('jump', true));
  const abc = await fly(a.page, true);
  expect(abc.mode).toBe('results');
  const link = await a.page.evaluate(() => window.__coldgas.comeback.linkFor(window.__coldgas.S.card));
  expect(link).toMatch(/\/coldgas\/\?play=jump&course=show#vs=[zr][A-Za-z0-9_-]+$/);
  expect(link.length).toBeLessThan(2000);

  // A friend opens it on their phone: the title holds for the card (no straight-to-countdown).
  const b = await phonePage(browser);
  await b.page.goto(link.replace(/^https?:\/\/[^/]+/, '').replace('#', '&gfx=low#'));
  await ready(b.page);
  const card = b.page.locator('[data-title-extra] .xc-vs');
  await expect(card).toBeVisible();
  await expect(card.locator('.xc-goal')).toContainText(`ABC scored ${abc.total.toFixed(1)} on The Show`);
  await b.page.waitForFunction(() => window.__coldgas.comeback.state?.state === 'ready', null, { timeout: 120_000 });
  expect(await b.page.evaluate(() => window.__coldgas.S.mode)).toBe('title');
  const take = b.page.locator('[data-vs-take]');
  const box = await take.boundingBox();
  expect(box.height).toBeGreaterThanOrEqual(44);
  expect(box.y + box.height).toBeLessThanOrEqual(844);

  // Take it: a run on the Show with ABC's run as the ghost (the reference's warm ghost steps aside).
  await take.tap();
  await b.page.waitForFunction(() => ['countdown', 'live'].includes(window.__coldgas.S.mode), null, { timeout: 15_000 });
  expect(await b.page.evaluate(() => [window.__coldgas.S.run.course, !!window.__coldgas.comeback.ghost('show')])).toEqual(['show', true]);
  const mine = await fly(b.page, false);
  expect(mine.mode).toBe('results');
  const by = (Math.round((mine.total - abc.total) * 10) / 10).toFixed(1);
  await expect(b.page.locator('[data-vs-line]')).toHaveText(`You beat ABC by ${by}`);
  const send = b.page.locator('[data-vs-send]');
  await expect(send).toBeVisible();
  expect((await send.boundingBox()).height).toBeGreaterThanOrEqual(44);
  // The daily (land within 10 ft of the mark on the Show): the reference lands 1.5 m from it.
  await expect(b.page.locator('[data-daily-line]')).toHaveText('Daily ✓ complete · streak 1');
  expect([...a.errors, ...b.errors]).toEqual([]);
  await a.ctx.close(); await b.ctx.close();
});

test('a challenge link that can’t be read says so gently and falls back to a normal jump', async ({ browser }) => {
  const { ctx, page } = await phonePage(browser);
  await page.goto('/coldgas/?play=jump&course=show&gfx=low#vs=zNotARun');
  await ready(page);
  await expect(page.locator('[data-toast]')).toContainText('older version');
  await page.waitForFunction(() => ['countdown', 'live'].includes(window.__coldgas.S.mode), null, { timeout: 15_000 });
  expect(await page.evaluate(() => window.__coldgas.comeback.state)).toBeNull();
  await ctx.close();
});

test('the daily card: today’s objective, Play today’s picks its course, and a miss says what was missing', async ({ browser }) => {
  test.setTimeout(120_000);
  const { ctx, page, errors } = await phonePage(browser);
  await page.goto('/coldgas/?course=wall&gfx=low');
  await ready(page);
  const card = page.locator('[data-title-extra] .xc-daily');
  await expect(card).toBeVisible();
  await expect(card.locator('.xc-k')).toContainText('Daily · Nov 2');
  await expect(card.locator('.xc-goal')).toHaveText('Land within 10 ft of the mark', { useInnerText: true });
  await expect(card.locator('.xc-streak')).toContainText('Start a streak today');
  await page.locator('[data-daily-play]').tap();
  await page.waitForFunction(() => ['countdown', 'live'].includes(window.__coldgas.S.mode), null, { timeout: 15_000 });
  expect(await page.evaluate(() => window.__coldgas.S.run.course)).toBe('show');
  await fly(page, true);
  await expect(page.locator('[data-daily-line]')).toHaveText('Daily: no clean landing yet — try again');
  expect(errors).toEqual([]);
  await ctx.close();
});
