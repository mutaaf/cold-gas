import { test, expect } from '@playwright/test';

// Marquee (src/ads.js, AGENTS.md §3.3): ads only between runs, never in one. A stand-in loader where every
// slot can fill records each call with the game's mode at that moment: nothing may fire in the countdown or
// a live run, the first results are skipped, and the opt-in rewarded break re-asks the panel.
const fake = () => {
  const calls = [];
  const mode = () => window.__coldgas?.S?.mode || 'boot';
  const cfg = { enabled: true, slots: { title: { source: 'direct' }, postrun: { source: 'direct' }, reroll: { source: 'direct' } }, campaigns: [] };
  const brk = (kind) => (id, h = {}) => {
    calls.push({ kind, id, mode: mode() });
    h.beforeAd?.();
    const paused = !!window.__coldgas?.S?.adBreak;
    return new Promise((r) => setTimeout(() => { h.afterAd?.(); calls.at(-1).paused = paused; r(kind === 'rewarded' ? true : undefined); }, 50));
  };
  window.__adCalls = calls;
  window.marquee = { v: 1, ready: () => Promise.resolve(cfg), banner: () => {}, interstitial: brk('interstitial'), rewarded: brk('rewarded') };
};
async function toResults(page) {
  await page.evaluate(() => { window.__coldgas.skipCountdown(); window.__coldgas.fastForward(); });
  await page.waitForFunction(() => window.__coldgas.S.mode === 'results', null, { timeout: 30_000 });
}

test('no ad call fires during a run; postrun skips the first results; rewarded is opt-in', async ({ page }) => {
  test.slow();
  await page.addInitScript(fake);
  await page.route('**/coldgas/api/judge/stream', (r) => r.abort());   // local lines, fast
  await page.goto('/coldgas/?gfx=low');
  await page.waitForFunction(() => window.__coldgas?.physicsReady?.(), null, { timeout: 60_000 });
  await expect(page.locator('[data-screen="title"] [data-marquee="title"]')).toHaveCount(1, { timeout: 15_000 });

  // Run 1 → Retry: the first session never gets an interstitial.
  await page.evaluate(() => window.__coldgas.startRun('jump'));
  await page.waitForFunction(() => window.__coldgas.S.mode === 'countdown' || window.__coldgas.S.mode === 'live');
  await toResults(page);
  await expect(page.locator('[data-reroll]')).toBeVisible({ timeout: 45_000 });
  await page.keyboard.press('KeyR');
  await page.waitForFunction(() => window.__coldgas.S.mode === 'live', null, { timeout: 15_000 });
  expect(await page.evaluate(() => window.__adCalls.length)).toBe(0);

  // Run 2: the rewarded break only on a press, then Retry shows the interstitial before the next run.
  await toResults(page);
  await expect(page.locator('[data-reroll]')).toBeVisible({ timeout: 45_000 });
  await page.locator('[data-reroll]').click();
  // The break is over (afterAd ran) before the next press: a press during a break is the ad's, not the game's.
  await expect.poll(() => page.evaluate(() => window.__adCalls.filter((c) => c.kind === 'rewarded' && 'paused' in c).length)).toBe(1);
  await page.waitForFunction(() => !window.__coldgas.S.adBreak);
  await expect(page.locator('[data-reroll]')).toBeHidden();   // once per run
  await page.keyboard.press('KeyR');
  await page.waitForFunction(() => window.__coldgas.S.mode === 'live', null, { timeout: 30_000 });

  const calls = await page.evaluate(() => window.__adCalls);
  expect(calls.map((c) => `${c.kind}:${c.id}`)).toEqual(['rewarded:reroll', 'interstitial:postrun']);
  for (const c of calls) {
    expect(['results', 'replay']).toContain(c.mode);   // never countdown, live, or drive
    expect(c.paused).toBe(true);                         // beforeAd held the replay and the audio
  }
  expect(await page.evaluate(() => window.__coldgas.S.adBreak)).toBe(false);
  // And a live run fires nothing (the frequency cap aside, nothing in the run asks).
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => window.__adCalls.length)).toBe(2);
});

// 0117: the real loader's work (and the AdSense pipeline a placed title slot starts) must never land in the
// countdown or a run. A stand-in for /ads/v1/ads.js is served (?marquee=1 wants it locally); a MutationObserver
// records S.mode whenever the loader's script tag or the title's slot goes in or comes out.
const LOADER = `(() => {
  const cfg = { enabled: true, slots: { title: { source: 'network' }, postrun: { source: 'none' }, reroll: { source: 'none' } }, campaigns: [] };
  const later = new Promise((r) => setTimeout(() => r(cfg), 1500));   // a config that takes a moment, as on a phone
  const api = { v: 1, ready: () => later, banner: () => {}, interstitial: async () => {}, rewarded: async () => false };
  const q = (window.marquee && window.marquee.q) || [];
  window.marquee = api;
  for (const f of q) f(api);
})();`;
const watchAds = () => {
  const log = (window.__adLog = []);
  const mode = () => window.__coldgas?.S?.mode || 'boot';
  new MutationObserver((muts) => {
    for (const m of muts) {
      for (const n of m.addedNodes) {
        if (n.nodeType !== 1) continue;
        if (n.tagName === 'SCRIPT' && /\/ads\/v1\/ads\.js$/.test(n.src)) log.push({ what: 'loader', mode: mode() });
        if (n.dataset?.marquee === 'title') log.push({ what: 'title+', mode: mode() });
      }
      for (const n of m.removedNodes) if (n.nodeType === 1 && n.dataset?.marquee === 'title') log.push({ what: 'title-', mode: mode() });
    }
  }).observe(document, { childList: true, subtree: true });
  // And what is in the DOM in each mode the run passes through.
  setInterval(() => {
    const m = mode();
    if (m === 'countdown' || m === 'live') { if (document.querySelector('[data-marquee="title"]')) log.push({ what: 'title-in-run', mode: m }); }
  }, 50);
};
async function adPage(page, url) {
  await page.addInitScript(watchAds);
  await page.route('**/ads/v1/ads.js', (r) => r.fulfill({ contentType: 'text/javascript', body: LOADER }));
  await page.route('**/coldgas/api/judge/stream', (r) => r.abort());
  await page.goto(url);
}

// One test, three pages (each in its own context): ads.spec keeps main's test count, so no e2e shard's cut moves (docs/LESSONS.md, 0117).
test('no loader on a local preview; with ?marquee= (0117) the loader and the title slot stay out of the countdown and the run', async ({ page, browser, baseURL }) => {
  test.slow();

  const asked = [];
  page.on('request', (r) => { if (/\/ads\//.test(new URL(r.url()).pathname)) asked.push(r.url()); });
  await page.goto('/coldgas/?gfx=low');
  await page.waitForFunction(() => window.__coldgas?.physicsReady?.(), null, { timeout: 60_000 });
  await page.evaluate(() => window.__coldgas.startRun('jump'));
  await toResults(page);
  await page.keyboard.press('KeyR');
  await page.waitForFunction(() => window.__coldgas.S.mode === 'live', null, { timeout: 15_000 });
  await expect(page.locator('[data-marquee]')).toHaveCount(0);
  await expect(page.locator('[data-reroll]')).toBeHidden();
  expect(asked).toEqual([]);
  // Each 0117 flight gets a fresh context, as if it were its own test: no storage from this page, and no run left
  // going in a same-origin tab beside it (on CI's software GL a second tab's boot ran past 60 s, #183).
  await page.close();
  const freshPage = async () => (await browser.newContext({ baseURL, viewport: { width: 1280, height: 720 } })).newPage();

  // 0117 · a Jump before the title banner is asked for leaves no slot and no loader work in the run.
  {
    const p = await freshPage();
    await adPage(p, '/coldgas/?gfx=low&marquee=1');
    await p.waitForFunction(() => window.__coldgas?.physicsReady?.(), null, { timeout: 60_000 });
    // The loader goes in on the title, at idle; Jump at once, before its config resolves.
    await p.waitForFunction(() => window.__adLog.some((e) => e.what === 'loader'), null, { timeout: 15_000 });
    await p.evaluate(() => window.__coldgas.startRun('jump'));
    await p.waitForFunction(() => window.__coldgas.S.mode === 'countdown' || window.__coldgas.S.mode === 'live');
    await p.waitForTimeout(2500);   // the config resolves in the run
    await expect(p.locator('[data-marquee="title"]')).toHaveCount(0);
    // (The dwell before the title asks again, and the slot leaving with the title: tests/unit/ads.test.js.)
    const log = await p.evaluate(() => window.__adLog);
    expect(log.filter((e) => e.what === 'loader')).toEqual([{ what: 'loader', mode: 'title' }]);
    expect(log.filter((e) => e.what === 'title+')).toEqual([]);
    expect(log.filter((e) => e.what === 'title-in-run')).toEqual([]);
    await p.context().close();
  }

  // 0117 · under ?play=jump the loader waits for the first results.
  {
    const p = await freshPage();
    await adPage(p, '/coldgas/?gfx=low&marquee=1&play=jump');
    await p.waitForFunction(() => window.__coldgas?.physicsReady?.(), null, { timeout: 60_000 });
    await p.waitForFunction(() => window.__coldgas.S.mode === 'countdown' || window.__coldgas.S.mode === 'live', null, { timeout: 30_000 });
    await toResults(p);
    await p.waitForFunction(() => window.__adLog.some((e) => e.what === 'loader'), null, { timeout: 15_000 });
    await p.waitForTimeout(2000);   // the config resolves on the results: the title's slot stays out
    await expect(p.locator('[data-marquee="title"]')).toHaveCount(0);
    const log = await p.evaluate(() => window.__adLog);
    expect(log.filter((e) => e.what === 'loader').map((e) => e.mode)).toEqual(['results']);
    expect(log.filter((e) => e.what === 'title+')).toEqual([]);
    await p.context().close();
  }
});
