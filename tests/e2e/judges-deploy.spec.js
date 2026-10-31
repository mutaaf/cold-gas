import { test, expect } from '@playwright/test';

// 0083: a deploy mid-session never silences the judges, and local lines always say they are local.
// The judges' chunk is fetched once while the title idles, so a deploy after that (every old asset
// answers 404) changes nothing for this page; when the lines are local the receipt says so and why.
const ready = (page) => page.waitForFunction(() => window.__coldgas?.physicsReady?.(), null, { timeout: 60_000 });
const sse = () => {
  const ev = (e, d) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`;
  const words = { headline: 'Clean over the row', engineer: 'Sink rate 0.6 m/s.', coordinator: 'That is the stunt.', designer: 'One unbroken line.', source: 'ai' };
  return ev('verify', { ticks: 2400, ms: 30, card: { total: 90 } })
    + ev('prompt', { provider: 'edge', providerLabel: 'Free', vendor: 'Workers AI', model: '@cf/test/model', where: 'Cloudflare edge', system: 's', user: 'u', inTokensEst: 600 })
    + ev('token', { t: 'ENGINEER: Sink rate 0.6 m/s.' })
    + ev('done', { words, inTokens: 600, outTokens: 4, ttftMs: 300, totalMs: 900, tokensPerSec: 40, neurons: 13, costUsd: null });
};
const fly = (page) => page.evaluate(() => { window.__coldgas.startRun('jump'); window.__coldgas.fastForward(); });
const toResults = (page) => page.waitForFunction(() => window.__coldgas.S.mode === 'results', null, { timeout: 60_000 });

for (const phone of [false, true]) {
  test(`a deploy after the title idled: the judges still judge${phone ? ' (390×844 touch)' : ' (1280×720)'}`, async ({ browser }) => {
    test.slow();   // two judged runs on software GL
    const page = await browser.newPage(phone ? { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true } : { viewport: { width: 1280, height: 720 } });
    const theatreGets = [];
    page.on('request', (r) => { if (/\/assets\/theatre-[\w-]+\.js(\?|$)/.test(r.url())) theatreGets.push(r.url()); });
    await page.route('**/coldgas/api/judge/stream', (route) => route.fulfill({ status: 200, contentType: 'text/event-stream', body: sse() }));
    await page.goto('/coldgas/?gfx=low');
    await ready(page);
    await page.waitForFunction(() => window.__coldgas.judgesReady(), null, { timeout: 30_000 });
    // The deploy: every asset of this build is gone.
    let gone = 0;
    await page.route(/\/coldgas\/assets\//, (route) => { gone++; return route.fulfill({ status: 404, body: 'gone' }); });
    for (let i = 0; i < 2; i++) {
      await page.evaluate(() => { window.__prevCall = window.__coldgas.S.callMeta; });
      await fly(page);
      await toResults(page);
      // This run's own call (the receipt keeps the last run's text while hidden): judged by the model.
      await page.waitForFunction(() => { const S = window.__coldgas.S; return S.callMeta && S.callMeta !== window.__prevCall && S.callMeta.ok === true && S.words?.source === 'ai'; }, null, { timeout: 90_000 });
      await expect(page.locator('[data-receipt]')).toBeVisible();
      await expect(page.locator('[data-receipt]')).toContainText('Judged by');
    }
    expect(theatreGets).toHaveLength(1);   // fetched once for the session, not per run
    console.log('assets 404ed after the deploy:', gone);
    await page.close();
  });
}

test('the judges’ chunk never loads: the receipt says AI unavailable, local lines', async ({ page }) => {
  await page.route(/\/assets\/theatre-[\w-]+\.js(\?|$)/, (route) => route.abort('connectionreset'));
  await page.goto('/coldgas/?gfx=low');
  await ready(page);
  await fly(page);
  await toResults(page);
  const receipt = page.locator('[data-receipt]');
  await expect(receipt).toBeVisible({ timeout: 35_000 });
  await expect(receipt).toContainText('AI unavailable');
  await expect(receipt).toContainText('local lines');
  await expect(receipt.locator('[data-rc-replay]')).toHaveCount(0);   // no call to replay
  expect(await page.evaluate(() => window.__coldgas.S.words?.source)).toBe('local');
});

test('the judges’ chunk 404s on a stale build: the receipt says a new version is live', async ({ page }) => {
  const html = (await (await page.request.get('/coldgas/')).text()).replace(/assets\/index-[\w-]+\.js/, 'assets/index-NEWBUILD.js');
  await page.route((url) => url.pathname === '/coldgas/', (route) => (route.request().resourceType() === 'fetch'
    ? route.fulfill({ status: 200, contentType: 'text/html', body: html }) : route.continue()));
  await page.route(/\/assets\/theatre-[\w-]+\.js(\?|$)/, (route) => route.fulfill({ status: 404, body: 'gone' }));
  // The warm fetch may fail on the title, where the heal reloads into the new build: as if it had just
  // reloaded, it doesn't (a reload loop guard), so this page stays the stale one under test.
  await page.addInitScript(() => { try { sessionStorage.setItem('coldgas_heal_reload', String(Date.now())); } catch { /* blocked */ } });
  const navs = [];
  page.on('load', () => navs.push(page.url()));
  await page.goto('/coldgas/?gfx=low');
  await ready(page);
  await fly(page);
  await toResults(page);
  const receipt = page.locator('[data-receipt]');
  await expect(receipt).toContainText('A new version is live', { timeout: 35_000 });
  await expect(receipt).toContainText('local lines');
  expect(navs).toHaveLength(1);
});

test('the judge breaker is open: the receipt says so, beside the cue', async ({ page }) => {
  await page.goto('/coldgas/?gfx=low');
  await ready(page);
  await page.evaluate(() => { const b = window.__coldgas.obs.breaker('judge'); b.failure(new Error('t')); b.failure(new Error('t')); });
  expect(await page.evaluate(() => window.__coldgas.obs.breaker('judge').state)).toBe('open');
  // Held open past its 30 s cooldown (software GL can take that long to reach the results): no trial call.
  await page.evaluate(() => { window.__coldgas.obs.breaker('judge').allow = () => false; });
  await fly(page);
  await toResults(page);
  const receipt = page.locator('[data-receipt]');
  await expect(receipt).toBeVisible({ timeout: 10_000 });
  await expect(receipt).toContainText('AI unavailable');
  await expect(receipt).toContainText('The judges are resting');
  await expect(receipt).toContainText('local lines');
});
