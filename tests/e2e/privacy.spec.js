import { test, expect } from '@playwright/test';

// 0155: the privacy page, as a phone opens it. It asks nothing of any other host (the zone's analytics
// beacon is kept off by no-transform in dist/_headers, tests/unit/privacy.test.js; Cloudflare only injects
// it on the real zone, so this guards everything the page itself loads), fits 390 px with no sideways
// scroll, and every line of its text holds 4.5:1 against the page.
test('the privacy page loads only from its own origin, fits a phone and holds 4.5:1', async ({ browser, baseURL }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const own = new URL(baseURL).host;
  const foreign = [];
  page.on('request', (r) => { const u = new URL(r.url()); if (/^https?:$/.test(u.protocol) && u.host !== own) foreign.push(r.url()); });
  const res = await page.goto('/coldgas/privacy/', { waitUntil: 'load' });
  expect(res.status()).toBe(200);
  await expect(page.getByRole('heading', { name: 'Privacy' })).toBeVisible();
  await expect(page.getByText(/web game shows ads from Google/)).toBeVisible();

  expect(foreign).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);

  const worst = await page.evaluate(() => {
    const rgba = (c) => (c.match(/[\d.]+/g) || []).map(Number);
    const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
    const bg = rgba(getComputedStyle(document.body).backgroundColor);
    let min = { ratio: Infinity };
    for (const el of document.querySelectorAll('body *')) {
      if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
      const [r, g, b, a = 1] = rgba(getComputedStyle(el).color);
      const fg = [r * a + bg[0] * (1 - a), g * a + bg[1] * (1 - a), b * a + bg[2] * (1 - a)];
      const [hi, lo] = [lum(fg), lum(bg)].sort((x, y) => y - x);
      const ratio = (hi + 0.05) / (lo + 0.05);
      if (ratio < min.ratio) min = { ratio, tag: el.tagName, cls: el.className, text: el.textContent.trim().slice(0, 40) };
    }
    return min;
  });
  expect(worst.ratio, JSON.stringify(worst)).toBeGreaterThanOrEqual(4.5);
  await ctx.close();
});
