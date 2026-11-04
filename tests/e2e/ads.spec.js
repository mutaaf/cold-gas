import { test, expect } from '@playwright/test';

// Marquee (src/ads.js, AGENTS.md §3.3): ads only between runs, never in one. A stand-in loader where every
// slot can fill records each call with the game's mode at that moment: nothing may fire in the countdown or
// a live run, the first results are skipped, and the opt-in rewarded break re-asks the panel.
// The stand-in for Marquee's frame page: it logs the game's mode when it loads, starts the slow ad script, and Jumps.
const FRAME = `<!doctype html><html><body><script>
  const top_ = parent, mode = () => top_.__coldgas?.S?.mode || 'boot';
  const e = { start: mode() };
  top_.__adPipe.push(e);
  const s = document.createElement('script');
  s.src = 'https://ads.stand-in.example/adsbygoogle.js?' + top_.__adPipe.length;   // another origin, as AdSense's is (routed)
  s.onload = () => { e.done = mode(); };
  document.head.appendChild(s);
  if (top_.__adPipe.length === 1) top_.setTimeout(() => top_.__coldgas.startRun('jump'), 500);
  top_.postMessage({ marqueeFrame: 'title', h: 0 }, location.origin);
</script></body></html>`;
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
  // 0122: the title's slot is Marquee's frame (/ads/v1/frame.html, served below by a stand-in). Like Marquee's, the
  // stand-in frame starts an ad script download the moment it loads: here a stand-in adsbygoogle.js on another origin
  // that takes 3 s. The first frame's Jump comes 0.5 s after it, from the page itself (a poll from the test could see
  // the frame a second late on a slow runner and miss the window). Removing the frame must cancel it.
  window.__adPipe = [];
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
  const late = [];   // stand-in ad requests that finished (Playwright's view, beside the page's own)
  await page.route('https://ads.stand-in.example/**', async (r) => {
    await new Promise((res) => setTimeout(res, 3000));
    await r.fulfill({ contentType: 'text/javascript', body: `/*${'x'.repeat(400_000)}*/` }).catch(() => { /* cut off: the page is gone from it */ });
  });
  page.on('requestfinished', (r) => { if (r.url().includes('ads.stand-in.example')) late.push(r.url()); });
  await page.route('**/ads/v1/frame.html?*', (r) => r.fulfill({ contentType: 'text/html', body: FRAME }));
  // 0142: the title places its banner only where it has room beside a whole Daily card; a 1280×720 title has none (it
  // packs without an ad), so the frame's cut is tested on a tall screen, where the banner shows.
  await page.setViewportSize({ width: 1024, height: 1366 });
  await page.goto('/coldgas/?gfx=low');
  await page.waitForFunction(() => window.__coldgas?.physicsReady?.(), null, { timeout: 60_000 });
  // (Armed once the backdrop and the judges' chunk have settled, then the 4 s dwell.)
  // Run 1 → Retry: the first session never gets an interstitial.
  // 0122: the page itself Jumps at dwell + 0.5 s, with the frame's stand-in script still downloading. The frame is
  // removed with the title, and its download goes with it: it never finishes, in the countdown, the run or after.
  await page.waitForFunction(() => window.__adPipe.length === 1, null, { timeout: 45_000 });
  await page.waitForFunction(() => window.__coldgas.S.mode === 'countdown' || window.__coldgas.S.mode === 'live');
  await expect(page.locator('iframe[data-marquee-frame]')).toHaveCount(0);
  await page.waitForTimeout(3500);   // past the moment the stand-in would have finished
  expect(await page.evaluate(() => window.__adPipe)).toEqual([{ start: 'title' }]);
  expect(late).toEqual([]);
  // The rest is the breaks between runs, which don't need the tall title: back to the project's 1280×720 (on CI's software
  // GL an upright iPad's frames are slow enough that Retry → live ran past 15 s, LESSONS 2026-11-03).
  await page.setViewportSize({ width: 1280, height: 720 });
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
        if (n.dataset?.marqueeFrame === 'title') log.push({ what: 'title+', mode: mode() });
      }
      for (const n of m.removedNodes) if (n.nodeType === 1 && n.dataset?.marqueeFrame === 'title') log.push({ what: 'title-', mode: mode() });
    }
  }).observe(document, { childList: true, subtree: true });
  // And what is in the DOM in each mode the run passes through.
  setInterval(() => {
    const m = mode();
    if (m === 'countdown' || m === 'live') { if (document.querySelector('[data-marquee-frame="title"]')) log.push({ what: 'title-in-run', mode: m }); }
  }, 50);
};
async function adPage(page, url) {
  await page.addInitScript(watchAds);
  await page.route('**/ads/v1/ads.js', (r) => r.fulfill({ contentType: 'text/javascript', body: LOADER }));
  await page.route('**/ads/v1/frame.html?*', (r) => r.fulfill({ contentType: 'text/html', body: '<!doctype html>' }));
  await page.route('**/coldgas/api/judge/stream', (r) => r.abort());
  await page.goto(url);
}

// One test, three pages (each in its own context): ads.spec keeps main's test count, so no e2e shard's cut moves (docs/LESSONS.md, 0117).
test('no loader on a local preview; with ?marquee= (0117) the loader and the title slot stay out of the countdown and the run', async ({ page, browser, baseURL }) => {
  test.slow();
  test.setTimeout(test.info().timeout + 150_000);   // 0142's two pages (a phone and the upright iPad, ≈ 15 s held on the title) on top

  const asked = [];
  page.on('request', (r) => { if (/\/ads\//.test(new URL(r.url()).pathname)) asked.push(r.url()); });
  await page.goto('/coldgas/?gfx=low');
  await page.waitForFunction(() => window.__coldgas?.physicsReady?.(), null, { timeout: 60_000 });
  await page.evaluate(() => window.__coldgas.startRun('jump'));
  await toResults(page);
  await page.keyboard.press('KeyR');
  await page.waitForFunction(() => window.__coldgas.S.mode === 'live', null, { timeout: 15_000 });
  await expect(page.locator('[data-marquee], [data-marquee-frame]')).toHaveCount(0);
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
    await expect(p.locator('[data-marquee-frame="title"]')).toHaveCount(0);
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
    await expect(p.locator('[data-marquee-frame="title"]')).toHaveCount(0);
    const log = await p.evaluate(() => window.__adLog);
    expect(log.filter((e) => e.what === 'loader').map((e) => e.mode)).toEqual(['results']);
    expect(log.filter((e) => e.what === 'title+')).toEqual([]);
    await p.context().close();
  }

  // 0142 · the title's banner never costs the Daily its room, and an undrawn frame moves and paints nothing. Where the title
  // has no room for a banner (an upright phone) no frame is placed, so no ad is asked for. Where it has (the upright iPad), the
  // stand-in frame reports 90 px from an empty, reserved unit (as Google's lazy unit does before it decides): it stays out of the
  // flow and hidden; then the test draws a sponsor's image into it (same origin) and the banner shows, the Daily whole.
  // Fresh pages from fresh contexts, as above (the file keeps its test count).
  for (const view of [{ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }, { viewport: { width: 1024, height: 1366 }, hasTouch: true, isMobile: true }]) {
    const w = view.viewport.width;
    const ctx = await browser.newContext({ baseURL, ...view, colorScheme: 'light' });
    const p = await ctx.newPage();
    await p.clock.setFixedTime(new Date('2026-11-15T15:00:00Z'));   // a long goal: "Clear the row with more than 25 % gas left"
    await p.route('**/ads/v1/ads.js', (r) => r.fulfill({ contentType: 'text/javascript', body: LOADER }));
    await p.route('**/ads/v1/frame.html?*', (r) => r.fulfill({ contentType: 'text/html', body: RESERVED_FRAME }));
    await p.route('**/coldgas/api/**', (r) => r.abort());
    await p.goto('/coldgas/?gfx=low&marquee=1');
    await p.waitForFunction(() => window.__coldgas?.physicsReady?.(), null, { timeout: 90_000 });
    const tops = () => p.evaluate(() => ['[data-title-extra] .xc', '[data-start]'].map((q) => Math.round(document.querySelector(q).getBoundingClientRect().top)));
    const card = () => p.evaluate(() => {
      const t = document.querySelector('.title'), goal = t.querySelector('.xc-goal'), streak = t.querySelector('.xc-streak');
      return { fit: t.dataset.extraFit ?? '', cut: goal.scrollWidth > goal.clientWidth + 0.5, streak: !!streak && streak.offsetHeight > 0 };
    });
    const whole = async (why) => expect(await card(), `${w}: ${why}`).toEqual({ fit: '', cut: false, streak: true });
    await p.waitForTimeout(2000);   // past the title's rise-in (the tops are read with transforms)
    await whole('before the frame');
    const before = await tops();
    const frame = p.locator('iframe[data-marquee-frame="title"]');
    if (w === 390) {
      // No room: the slot is never placed (decided after the dwell), nothing is asked for, the card stays whole.
      await p.waitForFunction(() => document.querySelector('.title').dataset.adRoom === 'none', null, { timeout: 45_000 });
      await expect(frame).toHaveCount(0);
      expect(await p.evaluate(() => window.__frameSaid90 ?? false)).toBe(false);
      await whole('no room, no frame');
      expect(await tops()).toEqual(before);
      await ctx.close();
      continue;
    }
    await p.waitForFunction(() => window.__frameSaid90 === true, null, { timeout: 45_000 });   // placed after the dwell; it reported 90 px
    for (const scheme of ['light', 'dark']) {
      await p.emulateMedia({ colorScheme: scheme });
      // Unfilled, for the 15 s after its report: out of the flow, not painted (no opaque canvas under a light OS), its
      // reported size kept for the ad inside, and nothing on the title moved.
      for (let i = 0; i < (scheme === 'light' ? 4 : 2); i++) {
        await p.waitForTimeout(2500);
        expect(await frame.evaluate((e) => { const c = getComputedStyle(e); return [e.offsetHeight, c.position, c.visibility, c.colorScheme, 'filled' in e.dataset]; }))
          .toEqual([90, 'absolute', 'hidden', 'light dark', false]);
        expect(await tops()).toEqual(before);
        await whole(`unfilled frame, ${scheme}`);
      }
    }
    // Drawn (a direct sponsor's image, loaded): the banner shows at its 90 px, and the Daily is still whole.
    await frame.evaluate((e) => {
      const d = e.contentDocument, img = d.createElement('img');
      img.style.cssText = 'display:block;width:100%;height:90px';
      img.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
      d.querySelector('[data-marquee]').appendChild(img);
    });
    await expect.poll(() => frame.evaluate((e) => [e.offsetHeight, getComputedStyle(e).visibility, getComputedStyle(e).position])).toEqual([90, 'visible', 'static']);
    await whole('filled frame');
    await ctx.close();
  }
});
// 0142: Marquee's frame as Google's lazy unit leaves it before a verdict: an empty unit holding 90 px, reported as such.
const RESERVED_FRAME = `<!doctype html><html><head><meta name="color-scheme" content="light dark">
<style>html,body{margin:0;background:transparent;overflow:hidden}body{display:flow-root}[data-marquee]{width:100%}</style></head>
<body><div data-marquee="title"><ins class="adsbygoogle" style="display:block;width:100%;height:90px"></ins></div><script>
  const send = () => { parent.postMessage({ marqueeFrame: 'title', h: Math.ceil(document.body.getBoundingClientRect().height) }, location.origin); parent.__frameSaid90 = true; };
  new ResizeObserver(send).observe(document.body); addEventListener('load', send);   // as Marquee's frame reports
</script></body></html>`;
