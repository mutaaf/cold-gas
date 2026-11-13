import { test, expect } from '@playwright/test';

// Challenge links and the daily jump (src/comeback.js), on a phone first: a finished run's Share carries
// the run (#vs=); opening that link shows the challenge card on the title, the run races the challenger's
// ghost, and the results say how it went, with a way to send it back. The daily's objective comes from
// the UTC date: the clock is fixed on 2026-11-02, whose objective is "Land within 11.5 ft of the mark" on
// the Show (src/daily.js; tests/unit/daily.test.js pins the pick).
const phone = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 };
const DAY = new Date('2026-11-02T15:00:00Z');
const ready = (page) => page.waitForFunction(() => window.__coldgas?.physicsReady?.(), null, { timeout: 90_000 });

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
  // The daily (land within 11.5 ft of the mark on the Show): the reference lands 1.5 m from it.
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

test('@heavy the daily card: today’s objective, Play today’s picks its course, and a miss says what was missing', async ({ browser }) => {
  // Four days, four fresh WebGL pages booted and flown one after another (0139, 0150, 0198 each added one): ≈3 min on a
  // quick CI runner, so 180 s ran out on a slower one (main red on ca82030, both tries). Budget it like the other
  // multi-boot specs; @heavy: the flake guard runs it 2×.
  test.setTimeout(300_000);
  const { ctx, page, errors } = await phonePage(browser);
  await page.goto('/coldgas/?course=wall&gfx=low');
  await ready(page);
  const card = page.locator('[data-title-extra] .xc-daily');
  await expect(card).toBeVisible();
  await expect(card.locator('.xc-k')).toContainText('Daily · Nov 2');
  await expect(card.locator('.xc-goal')).toHaveText('Land within 11.5 ft of the mark', { useInnerText: true });
  await expect(card.locator('.xc-streak')).toContainText('Start a streak today');
  const play = () => page.evaluate(() => window.__coldgas.obs.payload().play);
  expect((await play())['daily-start'] ?? 0).toBe(0);
  await page.locator('[data-daily-play]').tap();
  await page.waitForFunction(() => ['countdown', 'live'].includes(window.__coldgas.S.mode), null, { timeout: 15_000 });
  expect(await page.evaluate(() => window.__coldgas.S.run.course)).toBe('show');
  expect((await play())['daily-start']).toBe(1);   // 0136: the tap is counted, once
  await fly(page, true);
  await expect(page.locator('[data-daily-line]')).toHaveText('Daily: no clean landing yet — try again');
  // 0136: a missed Daily is a daily-miss (and still daily-run for one release), never a daily-done.
  expect(await play()).toMatchObject({ 'daily-start': 1, 'daily-miss': 1, 'daily-run': 1 });
  expect((await play())['daily-done'] ?? 0).toBe(0);

  // 0139: a gas day (2026-11-15) on one thumb, the phone's default. The card carries the hint in the streak's row (no new row:
  // the card stays whole, not packed to one line),
  // Play today's says it again as the run counts down, and a gas miss says what to change. A fresh page from the same
  // context, not a new test (LESSONS 2026-10-31: keep the file's test count).
  const p2 = await ctx.newPage();
  await p2.clock.setFixedTime(new Date('2026-11-15T15:00:00Z'));
  await p2.route('**/coldgas/api/**', (r) => r.abort());
  p2.on('pageerror', (e) => errors.push(e.message));
  await p2.goto('/coldgas/?gfx=low');
  await ready(p2);
  const gasCard = p2.locator('[data-title-extra] .xc-daily');
  await expect(gasCard.locator('.xc-goal')).toHaveText('Clear the row with more than 25 % gas left', { useInnerText: true });
  const hint = gasCard.locator('[data-daily-hint]');
  await expect(hint).toHaveText('Hold the pad from the tap');
  expect(await hint.evaluate((e) => e.scrollWidth <= e.clientWidth + 0.5)).toBe(true);   // whole, not cut off with an ellipsis
  expect(await p2.evaluate(() => document.querySelector('.title').dataset.extraFit ?? '')).toBe('');
  const [hb, cb, go] = await Promise.all([hint.boundingBox(), gasCard.boundingBox(), p2.locator('[data-daily-play]').boundingBox()]);
  expect(hb.x).toBeGreaterThanOrEqual(cb.x); expect(hb.x + hb.width).toBeLessThanOrEqual(cb.x + cb.width + 0.5);
  expect(hb.y + hb.height).toBeLessThanOrEqual(cb.y + cb.height + 0.5);
  expect(hb.y).toBeGreaterThanOrEqual(go.y + go.height - 0.5);   // under the button, never over it
  expect(cb.y + cb.height).toBeLessThanOrEqual(844);
  expect(await hint.evaluate((e) => parseFloat(getComputedStyle(e).fontSize))).toBeGreaterThanOrEqual(11);
  await p2.locator('[data-daily-play]').tap();
  await expect(p2.locator('[data-cue]')).toContainText('Tip: Hold the pad from the tap to the ground', { timeout: 15_000 });
  // The reference flight, its card's gas set under the bar (the card is decided at the run's end, shown after).
  await p2.evaluate(() => {
    const g = window.__coldgas, S = g.S;
    S.autopilot = g.createAutopilot(g.stage.course);
    g.skipCountdown();
    for (let i = 0; i < 4000 && !S.card; i++) g.liveStep(0.1);
    S.card.facts.airPct = 24;
    S.autopilot = null;
    for (let i = 0; i < 4000 && S.mode !== 'results'; i++) g.liveStep(0.1);
  });
  const line = p2.locator('[data-daily-line]');
  await expect(line).toHaveText('Daily: 24 % gas left, need 26 % · hold the pad from the tap to the ground; letting go and then sliding costs gas');
  const lb = await line.boundingBox();
  expect(lb.y).toBeGreaterThanOrEqual(0); expect(lb.y + lb.height).toBeLessThanOrEqual(844);   // in view as the sheet opens
  expect(await line.evaluate((e) => parseFloat(getComputedStyle(e).fontSize))).toBeGreaterThanOrEqual(11);

  // 0150: a skim day (2026-11-16) asks one thumb for the opposite: let go right after the tap. The card says so whole, not
  // packed; the reference (5.1 m over the roofs) misses it, the miss names the choice, and NEXT RUN never says to hold.
  await page.close(); await p2.close();   // one live WebGL page at a time: a third booting beside two timed out locally
  const p3 = await ctx.newPage();
  await p3.clock.setFixedTime(new Date('2026-11-16T15:00:00Z'));
  await p3.route('**/coldgas/api/**', (r) => r.abort());
  p3.on('pageerror', (e) => errors.push(e.message));
  await p3.goto('/coldgas/?gfx=low');
  await ready(p3);
  const skimCard = p3.locator('[data-title-extra] .xc-daily');
  const goal = skimCard.locator('.xc-goal');
  await expect(goal).toHaveText('Clear the roofs by under 4.9 ft and land clean', { useInnerText: true });
  expect(await goal.evaluate((e) => e.scrollWidth <= e.clientWidth + 0.5)).toBe(true);
  const skimHint = skimCard.locator('[data-daily-hint]');
  await expect(skimHint).toHaveText('Let go right after the tap');
  expect(await skimHint.evaluate((e) => e.scrollWidth <= e.clientWidth + 0.5)).toBe(true);
  expect(await p3.evaluate(() => document.querySelector('.title').dataset.extraFit ?? '')).toBe('');
  expect((await skimCard.boundingBox()).y + (await skimCard.boundingBox()).height).toBeLessThanOrEqual(844);
  await p3.locator('[data-daily-play]').tap();
  await expect(p3.locator('[data-cue]')).toContainText('Tip: Let go right after the tap and stay off the pad', { timeout: 15_000 });
  await fly(p3, false);
  await expect(p3.locator('[data-daily-line]')).toHaveText(/^Daily: cleared by 1\d\.\d ft · let go of the pad right after the tap and stay off it; held, it carries you high$/);
  const next = p3.locator('[data-pointer-text]');
  await expect(next).toHaveText('For the Daily: let go of the pad right after the tap and stay off it', { timeout: 10_000 });
  expect(await p3.locator('[data-coach-items]').innerText()).not.toMatch(/\bhold(ing)? the pad/i);   // nor "What happened"

  // 0198: a Lineup mark day (2026-11-28) asks the one thumb for its choice: the second turn, slid up for on the run-up.
  // The card says so; the reference's 360 (the flight a thumb held from Go gets) misses it, and the miss names the call.
  await p3.close();
  const p4 = await ctx.newPage();
  await p4.clock.setFixedTime(new Date('2026-11-28T15:00:00Z'));
  await p4.route('**/coldgas/api/**', (r) => r.abort());
  p4.on('pageerror', (e) => errors.push(e.message));
  await p4.goto('/coldgas/?gfx=low');
  await ready(p4);
  const lineCard = p4.locator('[data-title-extra] .xc-daily');
  const lineGoal = lineCard.locator('.xc-goal');
  await expect(lineGoal).toHaveText('Roll two turns and land within 13 ft of the mark', { useInnerText: true });
  expect(await lineGoal.evaluate((e) => e.scrollWidth <= e.clientWidth + 0.5)).toBe(true);
  const lineHint = lineCard.locator('[data-daily-hint]');
  await expect(lineHint).toHaveText('Slide up on the run-up');
  expect(await lineHint.evaluate((e) => e.scrollWidth <= e.clientWidth + 0.5)).toBe(true);
  expect((await lineCard.boundingBox()).y + (await lineCard.boundingBox()).height).toBeLessThanOrEqual(844);
  await p4.locator('[data-daily-play]').tap();
  await expect(p4.locator('[data-cue]')).toContainText('Tip: Slide up on the run-up, then onto the amber dot', { timeout: 15_000 });
  expect((await fly(p4, false)).course).toBe('lineup');
  await expect(p4.locator('[data-daily-line]')).toHaveText(/^Daily: rolled \d+°, need 720° · slide up on the run-up for two turns$/);
  await expect(p4.locator('[data-pointer-text]')).toHaveText('For the Daily: slide up on the run-up for two turns', { timeout: 10_000 });
  expect(errors).toEqual([]);
  await ctx.close();
});
