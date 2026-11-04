import { test, expect } from '@playwright/test';

// 0142 · the title's ad banner never costs the Daily its room, and an undrawn frame moves and paints nothing. Where the
// title has no room for a banner (an upright phone) no frame is placed, so no ad is asked for. Where it has (the upright
// iPad), the stand-in frame reports 90 px from an empty, reserved unit (as Google's lazy unit does before it decides): it
// stays out of the flow and hidden; then the test draws a sponsor's image into it (same origin) and the banner shows, the
// Daily whole. Its own file (not folded into ads.spec): the tall title's frames on CI's software GL loaded ads.spec's run
// waits past their timeouts three times on #239. One test, two fresh contexts (one boot each), no run flown.

// The real loader's stand-in (as ads.spec's 0117 one): a title slot that can fill from the network.
const LOADER = `(() => {
  const cfg = { enabled: true, slots: { title: { source: 'network' }, postrun: { source: 'none' }, reroll: { source: 'none' } }, campaigns: [] };
  const api = { v: 1, ready: () => Promise.resolve(cfg), banner: () => {}, interstitial: async () => {}, rewarded: async () => false };
  const q = (window.marquee && window.marquee.q) || [];
  window.marquee = api;
  for (const f of q) f(api);
})();`;
// Marquee's frame as Google's lazy unit leaves it before a verdict: an empty unit holding 90 px, reported as such.
const RESERVED_FRAME = `<!doctype html><html><head><meta name="color-scheme" content="light dark">
<style>html,body{margin:0;background:transparent;overflow:hidden}body{display:flow-root}[data-marquee]{width:100%}</style></head>
<body><div data-marquee="title"><ins class="adsbygoogle" style="display:block;width:100%;height:90px"></ins></div><script>
  const send = () => { parent.postMessage({ marqueeFrame: 'title', h: Math.ceil(document.body.getBoundingClientRect().height) }, location.origin); parent.__frameSaid90 = true; };
  new ResizeObserver(send).observe(document.body); addEventListener('load', send);   // as Marquee's frame reports
</script></body></html>`;

test('0142: the title banner shows only beside a whole Daily, and an undrawn frame moves and paints nothing', async ({ browser, baseURL }) => {
  test.slow();
  for (const view of [{ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }, { viewport: { width: 820, height: 1180 }, hasTouch: true, isMobile: true }]) {
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
      // No room: the slot is never placed (decided after the dwell; armed once main.js's late loads settle, ≤ 20 s),
      // nothing is asked for, the card stays whole.
      await p.waitForFunction(() => document.querySelector('.title').dataset.adRoom === 'none', null, { timeout: 60_000 });
      await expect(frame).toHaveCount(0);
      expect(await p.evaluate(() => window.__frameSaid90 ?? false)).toBe(false);
      await whole('no room, no frame');
      expect(await tops()).toEqual(before);
      await ctx.close();
      continue;
    }
    await p.waitForFunction(() => window.__frameSaid90 === true, null, { timeout: 60_000 });   // placed after the dwell; it reported 90 px
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
    // (The image's load and Chromium's mutation delivery under CI's load: 30 s, not expect.poll's 5 s.)
    await expect.poll(() => frame.evaluate((e) => [e.offsetHeight, getComputedStyle(e).visibility, getComputedStyle(e).position]), { timeout: 30_000 })
      .toEqual([90, 'visible', 'static']);
    await whole('filled frame');
    await ctx.close();
  }
});
