import { test, expect } from '@playwright/test';

// 0245: the Phase 2 funnel's events reach Box Office (a stub `window.boxoffice` that records calls; on localhost
// src/insights.js sends only to one that is already there), in order, with numbers and enums only, and only at a calm
// moment (the title, the results), never mid-run. The runs are stepped from the test: the reference autopilot flies
// the "player's" Jump to its card (as first-landing.spec.js does), so the landing is real and the card is scoreRun's.
test.slow();

const PHONE = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true };

async function boot(page, { firstVisit = true } = {}) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript((firstVisit) => {
    window.boxoffice = { calls: [], track(name, props) { this.calls.push([name, props, window.__coldgas?.S?.mode || 'boot']); } };
    if (firstVisit && !localStorage.getItem('coldgas_howto')) localStorage.setItem('coldgas_howto', 'new');
  }, firstVisit);
  await page.goto('/coldgas/?gfx=low');
  await page.waitForFunction(() => window.__coldgas?.physicsReady?.(), null, { timeout: 60_000 });
  await page.evaluate(() => { window.__coldgas.stage.render = () => {}; });
  return errors;
}
const calls = (page) => page.evaluate(() => window.boxoffice.calls.map(([n, p, mode]) => ({ n, p, mode })));
// The Jump on screen, flown by the reference to its card and on to the sheet.
const flyToSheet = (page, { crash = false } = {}) => page.evaluate(({ crash }) => {
  const g = window.__coldgas, S = g.S;
  S.holdLive = true;
  S.autopilot = crash ? () => ({ throttle: 1, assist: 1 }) : g.createAutopilot(g.stage.course);
  g.skipCountdown();
  for (let i = 0; i < 4000 && !S.card; i++) g.liveStep(0.1);
  const mid = window.boxoffice.calls.length;
  S.autopilot = null;
  for (let i = 0; i < 4000 && S.mode !== 'results'; i++) g.liveStep(0.1);
  S.holdLive = false;
  return { mid, landed: !S.card.facts.crashed, total: S.card.total };
}, { crash });

test('a first visit: load → first tap → jump → landing → retry sends the funnel in order, numbers and enums only', async ({ browser }) => {
  const page = await browser.newPage(PHONE);
  const errors = await boot(page);
  // The title's primary action is the first input.
  await page.locator('[data-start]').tap();
  // (0247 drops the how-to card from a first run; until then, Got it · Jump.)
  const go = page.locator('[data-howto-go]');
  if (await go.isVisible()) await go.tap();
  await page.waitForFunction(() => ['countdown', 'live'].includes(window.__coldgas.S.mode));
  const before = (await calls(page)).length;
  const one = await flyToSheet(page);
  expect(one.landed).toBe(true);
  expect(one.mid).toBe(before);   // nothing sent while the run was live
  await page.locator('[data-screen="results"] [data-again]').first().tap();
  await page.waitForFunction(() => ['countdown', 'live'].includes(window.__coldgas.S.mode));
  await flyToSheet(page);
  const got = await calls(page);
  const ours = got.filter((c) => !['game_start', 'game_over', 'share'].includes(c.n));
  expect(ours.map((c) => c.n)).toEqual(['session_start', 'first_input', 'jump_start', 'jump_end', 'first_landing', 'jump_start', 'jump_end']);
  expect(ours[0].p).toEqual({ returning: 0, days_since_last: 0 });
  expect(ours[1].p.ms_since_load).toBeGreaterThan(0);
  expect(ours[2].p).toEqual({ n: 1, course: 'show', tier: 'assist' });
  expect(ours[3].p).toMatchObject({ n: 1, course: 'show', tier: 'assist', landed: 1 });
  expect(ours[3].p.score).toBeCloseTo(one.total, 3);
  expect(ours[4].p).toEqual({ n: 1 });
  expect(ours[5].p.n).toBe(2);
  expect(ours[6].p.n).toBe(2);
  // Sent on the title (from boot, before the page's hooks exist) or the results only.
  expect(ours[0].mode).toBe('boot');
  for (const c of ours.slice(1)) expect(['title', 'results'], `${c.n} sent in ${c.mode}`).toContain(c.mode);
  for (const c of ours) for (const v of Object.values(c.p)) expect(['number', 'string']).toContain(typeof v);
  // The three events PostHog's dashboards already read are still there.
  expect(got.filter((c) => c.n === 'game_start')).toHaveLength(2);
  expect(got.filter((c) => c.n === 'game_over')).toHaveLength(2);
  expect(errors).toEqual([]);
  await page.close();
});

test('a returning visit, a wreck and a share: returning 1, no first landing, share_tap then share_done by copy', async ({ browser }) => {
  const ctx = await browser.newContext({ ...PHONE, permissions: ['clipboard-read', 'clipboard-write'] });
  await ctx.addInitScript(() => { if (!localStorage.getItem('coldgas_seen')) localStorage.setItem('coldgas_seen', String(Math.floor(Date.now() / 86_400_000) - 2)); });
  const page = await ctx.newPage();
  const errors = await boot(page, { firstVisit: false });
  await page.evaluate(() => { window.__coldgas.startRun('jump', true); });
  await page.waitForFunction(() => ['countdown', 'live'].includes(window.__coldgas.S.mode));
  const wreck = await flyToSheet(page, { crash: true });
  expect(wreck.landed).toBe(false);
  // No share sheet here (desktop Chromium has none on Linux): the link is copied, and that's how it left.
  await page.evaluate(() => { delete navigator.share; });
  await page.locator('[data-screen="results"] [data-share]').first().tap();
  await expect(page.locator('[data-toast]')).toContainText(/copied/);
  const ours = (await calls(page)).filter((c) => !['game_start', 'game_over', 'share'].includes(c.n));
  expect(ours.map((c) => c.n)).toEqual(['session_start', 'jump_start', 'jump_end', 'share_tap', 'share_done']);
  expect(ours[0].p).toEqual({ returning: 1, days_since_last: 2 });
  expect(ours[2].p.landed).toBe(0);
  expect(ours[3].p).toEqual({ course: 'show' });
  expect(ours[4].p).toEqual({ course: 'show', via: 'copy' });
  expect(errors).toEqual([]);
  await ctx.close();
});
