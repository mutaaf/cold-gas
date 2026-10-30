import { test, expect } from '@playwright/test';

// A flaky network, a stale deploy and a server that never answers (0040, 0048, 0042's heal part):
// the game never reloads into an offline page, recovers from a deploy exactly once, keeps the
// judges' 35 s promise when their chunk stalls, and every request has a deadline, a cancel and a
// single flight.
const ready = (page, timeout = 60_000) => page.waitForFunction(() => window.__coldgas?.physicsReady?.(), null, { timeout });
const watch = (page) => {
  const errors = [], navs = [];   // navs: every page load (a reload adds one; history.replaceState doesn't)
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('load', () => navs.push(page.url()));
  return { errors, navs };
};
// The built index.html, as the server would send it after a deploy (a different entry hash).
async function newBuildHtml(page) {
  const res = await page.request.get('/coldgas/');
  return (await res.text()).replace(/assets\/index-[\w-]+\.js/, 'assets/index-NEWBUILD.js');
}
// Only the probe's fetch of the HTML (no-store), not the page's own navigation.
const probeRoute = (page, handler) => page.route((url) => url.pathname === '/coldgas/', (route) => (route.request().resourceType() === 'fetch' ? handler(route) : route.continue()));

test('offline, an optional chunk that fails (the rocket backdrop) never reloads the page; the title still plays', async ({ page, context }) => {
  const seen = watch(page);
  let rocketAborted = false;
  // The lazy backdrop chunk (fetched after the title is up; the shared rocket-* chunk loads with the
  // entry and must pass): the network drops as it's asked for.
  await page.route(/\/assets\/rocket-[\w-]+\.js$/, async (route) => {
    const wired = await page.evaluate(() => !!window.__coldgas?.physicsReady?.()).catch(() => false);
    if (!wired) return route.continue();
    await context.setOffline(true);
    rocketAborted = true;
    return route.abort('internetdisconnected');
  });
  await page.goto('/coldgas/?gfx=low');
  await ready(page);
  await expect.poll(() => rocketAborted, { timeout: 60_000 }).toBe(true);
  // The heal saw it and chose not to reload (offline).
  await expect.poll(() => page.evaluate(() => window.__coldgas.obs.snapshot().recoveries.some((r) => r.kind === 'reload' && !r.ok && /offline/.test(r.detail))), { timeout: 10_000 }).toBe(true);
  await page.waitForTimeout(2500);   // the old heal reloaded 1.2 s after the failure
  expect(seen.navs).toHaveLength(1);
  // Playable: Jump starts a run.
  await page.locator('[data-start]').click();
  await page.waitForFunction(() => ['countdown', 'live'].includes(window.__coldgas.S.mode), null, { timeout: 15_000 });
  expect(seen.errors).toEqual([]);   // no unhandled rejection
  await context.setOffline(false);
});

test('a lazy chunk 404s after a deploy: exactly one reload into the new build, then it works', async ({ page }) => {
  test.slow();   // boots the game twice on software GL (before and after the reload)
  const seen = watch(page);
  const html = await newBuildHtml(page);
  await probeRoute(page, (route) => route.fulfill({ status: 200, contentType: 'text/html', body: html }));
  await page.route(/\/assets\/drive-[\w-]+\.js$/, (route) => {
    // The old build's chunk is gone (its modulepreload and the import both 404) until the reload.
    if (seen.navs.length < 2) return route.fulfill({ status: 404, body: 'gone' });
    return route.continue();
  });
  await page.goto('/coldgas/?gfx=low');
  await ready(page);
  await page.locator('[data-drive-open]').click();
  // The heal probes, sees a new build and reloads once.
  await expect.poll(() => seen.navs.length, { timeout: 20_000 }).toBe(2);
  await ready(page, 60_000);
  // The new page works: Free Drive opens.
  await page.locator('[data-drive-open]').click();
  await expect(page.locator('.fd-card').first()).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(2000);
  expect(seen.navs).toHaveLength(2);   // no second reload
});

test('the same build answers (it was the network): a failed lazy chunk does not reload', async ({ page }) => {
  const seen = watch(page);
  await page.route(/\/assets\/drive-[\w-]+\.js$/, (route) => route.abort('connectionreset'));
  await page.goto('/coldgas/?gfx=low');
  await ready(page);
  await page.locator('[data-drive-open]').click();
  await expect.poll(() => page.evaluate(() => window.__coldgas.obs.snapshot().recoveries.some((r) => r.kind === 'reload' && /same build/.test(r.detail))), { timeout: 15_000,
    message: await page.evaluate(() => JSON.stringify(window.__coldgas.obs.snapshot().recoveries)) }).toBe(true);
  await page.waitForTimeout(2000);
  expect(seen.navs).toHaveLength(1);
  // One failed import is one report.
  const lazy = await page.evaluate(() => window.__coldgas.obs.snapshot().errors.filter((e) => e.kind === 'lazy'));
  expect(lazy.reduce((a, e) => a + e.n, 0)).toBe(1);
});

test("the judges' chunk stalls forever: local lines land by the 35 s deadline, and the next title checks the build", async ({ page }) => {
  test.slow();   // waits out the judges' 35 s deadline in real time
  await page.route(/\/assets\/theatre-[\w-]+\.js$/, () => { /* never answers */ });
  await page.goto('/coldgas/?gfx=low');
  await ready(page);
  await page.evaluate(() => { window.__coldgas.startRun('jump'); window.__coldgas.fastForward(); });
  await page.waitForFunction(() => window.__coldgas.S.mode === 'results', null, { timeout: 30_000 });
  const t0 = Date.now();
  await page.waitForFunction(() => window.__coldgas.S.words?.source === 'local', null, { timeout: 40_000 });
  expect(Date.now() - t0).toBeLessThan(37_000);
  await expect(page.locator('[data-judge="engineer"] .quote')).not.toBeEmpty({ timeout: 5000 });
  expect(await page.evaluate(() => window.__coldgas.heal.stale)).toMatch(/judges/);
  expect(await page.evaluate(() => window.__coldgas.obs.breaker('judge').state)).toBe('closed');   // not the judges' fault
  // Back to the title: the build is checked (same build here: no reload).
  await page.evaluate(() => window.__coldgas.toTitle());
  await expect.poll(() => page.evaluate(() => window.__coldgas.obs.snapshot().recoveries.some((r) => r.kind === 'reload' && /judges/.test(r.detail))), { timeout: 15_000 }).toBe(true);
  expect(await page.evaluate(() => window.__coldgas.heal.stale)).toBe('');
});

test('a road that never answers: an error card within 20 s, then Drive works again; Back cancels a load (phone)', async ({ browser }) => {
  test.slow();   // waits out the road's 12 s deadline in real time, then builds a road on software GL
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  let stall = true;
  await page.route(/\/roads\/[\w-]+\.bin\.gz$/, (route) => (stall ? undefined : route.continue()));
  await page.goto('/coldgas/?gfx=low');
  await ready(page);
  await page.locator('[data-drive-open]').tap();
  await page.locator('.fd-card[data-road="stelvio"]').tap();
  const t0 = Date.now();
  await page.locator('[data-fd-go]').tap();
  await expect(page.locator('[data-fd-load-label]')).toHaveText(/Couldn’t load this road/, { timeout: 20_000 });
  expect(Date.now() - t0).toBeLessThan(20_000);
  // Drive works again: a second press starts a new load (not blocked by the first).
  await expect(page.locator('[data-fd-go]')).toBeEnabled({ timeout: 5000 });
  await page.locator('[data-fd-go]').tap();
  await expect(page.locator('[data-fd-load-label]')).toHaveText(/Fetching the road/);
  // Back while loading cancels it: the picker closes and the drive never starts.
  await page.locator('[data-fd-back]').tap();
  await expect(page.locator('[data-drive-picker]')).toBeHidden();
  await page.waitForTimeout(1500);
  expect(await page.evaluate(() => window.__coldgas.drive.active)).toBe(false);
  expect(await page.evaluate(() => window.__coldgas.drive.state.loading)).toBe(false);
  await expect(page.locator('[data-screen="title"]')).toBeVisible();
  // And once the road answers, it drives.
  stall = false;
  await page.locator('[data-drive-open]').tap();
  await page.locator('[data-fd-go]').tap();
  await page.waitForFunction(() => window.__coldgas.drive.active, null, { timeout: 90_000 });
  await page.close();
});

test('board: a slow Today asked first never overwrites All time asked after it', async ({ page }) => {
  const row = (ini, total) => ({ initials: ini, verdict: 'Clean', facts: { rollDeg: 360, sink: 0.5 }, total });
  await page.route(/\/api\/scores\?board=today/, async (route) => {
    await new Promise((r) => setTimeout(r, 2500));
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ rows: [row('TOD', 50)] }) }).catch(() => {});
  });
  await page.route(/\/api\/scores\?board=all/, (route) => route.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify({ rows: [row('ALL', 90), { initials: 'BAD', facts: null }, null] }) }));
  await page.goto('/coldgas/?gfx=low');
  await ready(page);
  await page.locator('[data-board-open]').click();
  await page.locator('[data-board="all"]').click();
  await expect(page.locator('[data-board-rows] .ini')).toHaveText(['ALL']);   // the malformed rows are skipped
  await page.waitForTimeout(3500);   // the slow Today has answered by now (or been cancelled)
  await expect(page.locator('[data-board-rows] .ini')).toHaveText(['ALL']);
  await expect(page.locator('[data-board="all"]')).toHaveAttribute('aria-pressed', 'true');
});

test('double-click Submit posts once', async ({ page }) => {
  let posts = 0;
  await page.route(/\/api\/scores$/, async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    posts++;
    await new Promise((r) => setTimeout(r, 800));
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, rank: 3 }) });
  });
  await page.route(/\/api\/judge\/stream$/, (route) => route.abort());
  await page.goto('/coldgas/?gfx=low');
  await ready(page);
  await page.evaluate(() => { window.__coldgas.startRun('jump'); window.__coldgas.fastForward(); });
  await page.waitForFunction(() => window.__coldgas.S.mode === 'results', null, { timeout: 30_000 });
  await expect(page.locator('[data-theatre]')).toBeHidden({ timeout: 30_000 });
  await page.locator('#initials').fill('ABC');
  const btn = page.locator('[data-r-submit] button[type="submit"]');
  await btn.dblclick();
  await expect(page.locator('[data-r-submit-msg]')).toHaveText(/Posted\. #3 today\./, { timeout: 10_000 });
  await btn.click();
  await expect(page.locator('[data-r-submit-msg]')).toHaveText('Already posted.');
  expect(posts).toBe(1);
});

test('the boot watchdog offers a reload when the game never wires its title', async ({ page }) => {
  test.slow();   // waits out the watchdog's 15 s
  await page.route(/\/assets\/index-[\w-]+\.js$/, (route) => route.abort('connectionreset'));
  await page.goto('/coldgas/');
  const offer = page.locator('[data-boot-watchdog]');
  await expect(offer).toBeVisible({ timeout: 20_000 });
  await expect(offer).toContainText(/problem while starting|longer than it should/);
  await expect(offer.locator('button')).toHaveText('Reload');
  await page.unroute(/\/assets\/index-[\w-]+\.js$/);
  await offer.locator('button').click();
  await ready(page);
  await expect(page.locator('[data-boot-watchdog]')).toHaveCount(0);
});

test('a WebGL context lost while the tab is hidden: no reload, however long it stays hidden', async ({ page }) => {
  test.slow();   // 20 s hidden in real time, then a restore that recompiles every shader on software GL
  const seen = watch(page);
  await page.goto('/coldgas/?gfx=low');
  await ready(page);
  await page.evaluate(() => {
    const ext = window.__coldgas.stage.renderer.getContext().getExtension('WEBGL_lose_context');
    window.__realRestore = ext.restoreContext.bind(ext);
    ext.restoreContext = () => {};   // a GPU that doesn't come back by itself
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
    ext.loseContext();
  });
  await expect.poll(() => page.evaluate(() => window.__coldgas.obs.glLost)).toBe(true);
  await page.waitForTimeout(20_000);
  expect(seen.navs).toHaveLength(1);
  expect(await page.evaluate(() => window.__coldgas.obs.snapshot().recoveries.some((r) => r.kind === 'reload'))).toBe(false);
  // Visible again, the context comes back and the stage is rebuilt.
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    document.dispatchEvent(new Event('visibilitychange'));
    window.__realRestore();
  });
  await expect.poll(() => page.evaluate(() => window.__coldgas.obs.glLost), { timeout: 20_000 }).toBe(false);
  expect(seen.navs).toHaveLength(1);
});

// 0057: a failed import is forgotten, so the next press asks again (the first press says it couldn't load).
test('Free Drive and the Sandbox: a chunk that fails once loads on the next press', async ({ page }) => {
  const seen = watch(page);
  const fail = { drive: true, sandbox: true };
  await page.route(/\/assets\/(drive|sandbox)-[\w-]+\.js$/, (route, req) => {
    const k = /\/drive-/.test(req.url()) ? 'drive' : 'sandbox';
    return fail[k] ? route.abort('connectionreset') : route.continue();
  });
  await page.goto('/coldgas/?gfx=low');
  await ready(page);
  const cue = page.locator('[data-cue]');
  await page.locator('[data-drive-open]').click();
  await expect(cue).toHaveText(/Free Drive couldn’t load/, { timeout: 15_000 });
  fail.drive = false;
  await page.locator('[data-drive-open]').click();
  await expect(page.locator('.fd-card').first()).toBeVisible({ timeout: 20_000 });
  await page.locator('[data-fd-back]').click();
  await expect(page.locator('[data-drive-picker]')).toBeHidden();
  await page.locator('[data-sandbox-open]').click();
  await expect(cue).toHaveText(/The Sandbox couldn’t load/, { timeout: 15_000 });
  fail.sandbox = false;
  await page.locator('[data-sandbox-open]').click();
  await page.waitForFunction(() => window.__coldgas.sandbox?.active, null, { timeout: 60_000 });
  expect(seen.navs).toHaveLength(1);   // the same build answered: no reload
  expect(seen.errors).toEqual([]);
});

// 0057: the chunk spent 30 of the judges' 35 s; the provider's answer is late for the 5 s left. That deadline
// is the network's, not the judges': the breaker that turns the AI panel off (persisted) doesn't count it.
test("the judges' chunk stalls 30 s and the provider answers late: the judge breaker doesn't count it", async ({ page }) => {
  test.slow();   // the judges' 35 s in real time
  let release = null;
  const held = new Promise((r) => { release = r; });
  await page.route(/\/assets\/theatre-[\w-]+\.js$/, async (route) => { await held; await route.continue().catch(() => {}); });
  await page.route(/\/api\/judge\/stream$/, () => { /* the provider: answers after the deadline */ });
  await page.goto('/coldgas/?gfx=low');
  await ready(page);
  expect(await page.evaluate(() => window.__coldgas.obs.breaker('judge').snapshot().fails)).toBe(0);
  await page.evaluate(() => { window.__coldgas.startRun('jump'); window.__coldgas.fastForward(); });
  await page.waitForFunction(() => window.__coldgas.S.mode === 'results', null, { timeout: 30_000 });
  await page.waitForTimeout(30_000);
  release();
  await page.waitForFunction(() => window.__coldgas.S.words?.source === 'local', null, { timeout: 15_000 });
  await expect.poll(() => page.evaluate(() => window.__coldgas.S.callMeta?.error || ''), { timeout: 5000 }).toMatch(/too long/);
  await page.waitForTimeout(1000);
  const b = await page.evaluate(() => window.__coldgas.obs.breaker('judge').snapshot());
  expect(b.fails).toBe(0);
  expect(b.state).toBe('closed');
});
